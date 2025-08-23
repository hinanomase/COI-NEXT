// public/scripts/session.js
import { setupWebSocket } from './websocket.js';
import { startConversation } from './conversation.js';
import { LIVE_WS_BASE } from './config.js';

// ---- 既存互換の公開状態 ----
export let bufferedSessionState = null;
export let pendingCalls = {};
export let currentQuestion = 0;
export let questionNum = 0;
export function getBufferedSessionState() { return bufferedSessionState; }
export function setBufferedSessionState(s) { bufferedSessionState = s; }
export function getCurrentQuestion() { return currentQuestion; }
export function setCurrentQuestion(v) { currentQuestion = v; }
export function getQuestionNum() { return questionNum; }
export function setQuestionNum(v) { questionNum = v; }

// ---- Gemini Live ----
let liveWS = null;
let liveReady = false;
let lineBuffer = [];
const modelTextQueue = [];
let modelTextWaiters = [];
let awaitingReaction = false;

let lastInputTranscript = "";
let lastTranscriptAt = 0;
let transcriptWaiters = [];

// ---- AudioWorklet / VAD ----
let audioCtx = null;
let mediaStream = null;
let srcNode = null;
let workletNode = null;
let uploadEnabled = false;
let uploadGate = 0;
let capturingTurn = false;
let lastUtterMs = 0;
let INPUT_SR = 16000; // 実際は AudioContext から取得する

// 1発話の終了待ち
let uttResolvers = [];

/* ===== ヘルパ ===== */
function isLiveOpen() { return !!(liveWS && liveWS.readyState === WebSocket.OPEN); }
function sendLive(obj) {
  if (!isLiveOpen()) { console.warn("[LIVE] drop send (ws not open)", obj); return false; }
  try { liveWS.send(JSON.stringify(obj)); return true; } catch (e) { console.error("[LIVE] send failed:", e); return false; }
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

/* ===== 公開API ===== */
export function primeOneSentenceReaction() {
  if (!isLiveOpen()) return;
  lastInputTranscript = "";
  const directive = [
    "以後のユーザー発話には、日本語で自然かつ共感的な 1〜2 文の短いリアクションのみを返してください。",
    "『ありがとうございます。』だけの返答は禁止。質問は付けないでください。"
  ].join("\n");
  sendLive({ clientContent: { turns: [{ role: "user", parts: [{ text: directive }] }] } });
}
export function beginUserTurn() { capturingTurn = true; lastInputTranscript = ""; lastTranscriptAt = 0; lastUtterMs = 0; }
export function getLastUtterMs() { return lastUtterMs; }

export async function awaitStableTranscript(quiesceMs = 500, maxWaitMs = 2000) {
  const start = Date.now();
  if (!lastTranscriptAt) return lastInputTranscript || "";
  while (Date.now() - start < maxWaitMs) {
    const idle = Date.now() - lastTranscriptAt;
    if (idle >= quiesceMs) break;
    await sleep(Math.min(quiesceMs - idle, 120));
  }
  return lastInputTranscript || "";
}

export function sendToGemini(userText) {
  if (!isLiveOpen()) throw new Error("Gemini Live に未接続です");
  awaitingReaction = true;
  const wait = awaitNextModelText();
  sendLive({
    clientContent: { turns: [{ role: "user", parts: [{ text: userText }] }], turnComplete: true }
  });
  return wait;
}
export function awaitNextModelText(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("モデル応答の取得がタイムアウトしました")), timeoutMs);
    const cached = modelTextQueue.shift();
    if (cached) { clearTimeout(timer); awaitingReaction = false; resolve(cached); return; }
    modelTextWaiters.push((text) => { clearTimeout(timer); awaitingReaction = false; resolve(text); });
  });
}
export function suspendRealtimeInput() { uploadGate++; }
export function resumeRealtimeInput() { uploadGate = Math.max(0, uploadGate - 1); }
export function awaitUtteranceEnd(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { const txt = lastInputTranscript || ""; uttResolvers = []; capturingTurn = false; resolve(txt); }, timeoutMs);
    uttResolvers.push(() => { clearTimeout(t); capturingTurn = false; resolve(lastInputTranscript || ""); });
  });
}

/* ===== セッション開始/終了 ===== */
let starting = false;
export async function startSession() {
  if (starting) return;
  starting = true;
  const overlay = document.getElementById('overlay');
  const btnStart = document.getElementById('btnStart');
  overlay.classList.remove("hidden");
  btnStart.disabled = true;
  try {
    await setupWebSocket();
    await openLiveWS();
    await ensureMicReady();
    overlay.classList.add("hidden");
    startConversation();
  } catch (e) {
    console.error("セッション開始エラー:", e);
    alert(e.message || "接続に失敗しました");
    overlay.classList.add("hidden");
    btnStart.disabled = false;
    endSession();
  } finally { starting = false; }
}
export function endSession() {
  try { if (isLiveOpen()) liveWS.close(); } catch {}
  liveWS = null; liveReady = false; lineBuffer = [];
  uploadEnabled = false; capturingTurn = false;
  cleanupAudio();
  const btnStart = document.getElementById('btnStart');
  const overlay = document.getElementById('overlay');
  if (btnStart) btnStart.disabled = false;
  if (overlay) overlay.classList.add("hidden");
}

/* ===== Mic 初期化 ===== */
export async function ensureMicReady() {
  if (audioCtx) return;
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  await audioCtx.audioWorklet.addModule("./scripts/pcm16-worklet.js");

  INPUT_SR = audioCtx.sampleRate; // 例: 48000 or 44100

  srcNode = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm16-worklet");

  workletNode.port.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg) return;

    if (msg.type === "vad") {
      if (msg.state === "start") {
        uploadEnabled = capturingTurn && (uploadGate === 0);
      } else if (msg.state === "end") {
        uploadEnabled = false;
        lastUtterMs = msg.utterMs || 0;
        // 明示的に区切りを通知
        sendLive({ realtimeInput: { audioStreamEnd: true } });
        // 文字起こしの最終到着を少し待つ
        setTimeout(() => {
          const resolvers = uttResolvers;
          uttResolvers = [];
          resolvers.forEach((r) => r());
        }, 300);
      }
      return;
    }

    // 音声チャンク送出（WSクローズ時はドロップ）
    if (msg.type === "audio" && uploadEnabled && uploadGate === 0) {
      const int16 = new Int16Array(msg.samples);
      if (int16.length) {
        const b64 = int16ToBase64(int16);
        const rate = msg.rate || INPUT_SR;
        sendLive({ realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${rate}` } } });
      }
    }
  };

  srcNode.connect(workletNode);
}

/* ===== Gemini Live 接続 ===== */
async function openLiveWS() {
  try { if (liveWS && liveWS.readyState <= WebSocket.CLOSING) liveWS.close(); } catch {}
  liveWS = new WebSocket(LIVE_WS_BASE); // ?key=... を含むURL
  liveWS.binaryType = "blob";

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini Live WS接続タイムアウト")), 8000);
    liveWS.onopen  = () => { clearTimeout(t); resolve(); };
    liveWS.onerror = () => { clearTimeout(t); reject(new Error("Gemini Live WSエラー")); };
  });

  liveWS.onclose = (ev) => {
    console.warn("[LIVE] closed:", ev.code, ev.reason);
    liveReady = false;
    uploadEnabled = false;
    capturingTurn = false;
  };

  const setup = {
    setup: {
      model: "models/gemini-live-2.5-flash-preview",
      generationConfig: { responseModalities: ["TEXT"], temperature: 0.6, maxOutputTokens: 120 },
      inputAudioTranscription: {}, // 文字起こしを有効化（言語は日本語前提の指示でバイアス）
      realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 900 } },
      systemInstruction: {
        role: "user",
        parts: [
          { text: "あなたはメンタルヘルス対話のアシスタントです。" },
          { text: "入出力は日本語。ユーザーの音声は日本語として扱ってください。" },
          { text: "返答は自然で共感的な 1〜2 文。相手の言葉を軽く要約し、気持ちに寄り添ってください。" },
          { text: "『ありがとうございます。』だけの返答は禁止。質問は付けないでください。" }
        ]
      }
    }
  };
  sendLive(setup);

  liveWS.onmessage = async (ev) => {
    const textChunk = await toText(ev.data);
    if (!textChunk) return;

    const lines = textChunk.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      lineBuffer.push(line);
      const obj = tryParseJSON(lineBuffer.join("\n"));
      if (!obj) continue;
      lineBuffer = [];

      if (!liveReady && (obj.setupComplete || obj.serverContent)) liveReady = true;

      // 入力の文字起こし（到着のたびに更新時刻を刻む）
      const tr = obj?.serverContent?.inputTranscription?.text;
      if (tr) {
        lastInputTranscript = tr;
        lastTranscriptAt = Date.now();
        const waiters = transcriptWaiters;
        transcriptWaiters = [];
        waiters.forEach(fn => fn(tr));
      }

      // モデルのテキスト応答（sendToGemini を起点とするものだけ採用）
      const parts = obj?.serverContent?.modelTurn?.parts || [];
      const texts = parts.map(p => p.text).filter(Boolean);
      if (texts.length) {
        if (!awaitingReaction) continue;
        const text = texts.join("\n");
        modelTextQueue.push(text);
        const waiter = modelTextWaiters.shift();
        if (waiter) waiter(text);
        awaitingReaction = false;
      }
    }
  };
}

/* ===== ユーティリティ ===== */
function cleanupAudio() {
  try { if (srcNode) srcNode.disconnect(); } catch {}
  try { if (workletNode) workletNode.disconnect(); } catch {}
  try { if (audioCtx) audioCtx.close(); } catch {}
  try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch {}
  audioCtx = null; mediaStream = null; srcNode = null; workletNode = null;
}
async function toText(d) {
  try { if (typeof d === "string") return d;
        if (d instanceof Blob) return await d.text();
        if (d instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(d);
  } catch {}
  return "";
}
function tryParseJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function int16ToBase64(int16) {
  const u8 = new Uint8Array(int16.buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(binary);
}
