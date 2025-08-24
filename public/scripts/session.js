// public/scripts/session.js
import { setupWebSocket } from './websocket.js';
import { startConversation } from './conversation.js';
import { EPHEMERAL_ENDPOINT } from './config.js';

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
let liveReady = false;          // setupComplete 受信後
let liveCanSend = false;        // 送信許可（open ＆ setupComplete 後）
let sendQueue = [];             // setup前に来た制御メッセージを一時キュー
let lineBuffer = [];

let lastInputTranscript = "";
let lastTranscriptAt = 0;

// ---- Audio / VAD ----
let audioCtx = null;
let mediaStream = null;
let srcNode = null;
let workletNode = null;
let uploadEnabled = false;
let uploadGate = 0;             // TTS中は >0
let capturingTurn = false;
let lastUtterMs = 0;
let INPUT_SR = 16000;
let turnHadAudio = false;       // このターンで一度でも音声チャンクを送ったか

// ---- 応答相関（nonce） ----
let expectedNonce = null;
let activeNonce = null;
let accText = "";
let accTimer = null;
let accResolve = null;
let accReject = null;
let accTimeout = null;

// ========= ヘルパ =========
function isLiveOpen() { return !!(liveWS && liveWS.readyState === WebSocket.OPEN); }
function flushQueue() {
  if (!isLiveOpen() || !liveCanSend) return;
  const q = sendQueue;
  sendQueue = [];
  for (const obj of q) {
    try { liveWS.send(JSON.stringify(obj)); } catch {}
  }
}
function sendLive(obj, opts = { queue: false, warn: true }) {
  if (isLiveOpen() && liveCanSend) {
    try { liveWS.send(JSON.stringify(obj)); return true; }
    catch (e) { if (opts.warn) console.error("[LIVE] send failed:", e); return false; }
  }
  if (opts.queue) { sendQueue.push(obj); return true; }
  if (opts.warn) console.warn("[LIVE] drop send (ws not open)", obj);
  return false;
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function makeNonce() { return "N" + Math.random().toString(36).slice(2,7); }
function resetAccumulator() {
  activeNonce = null; accText = "";
  if (accTimer) { clearTimeout(accTimer); accTimer = null; }
  if (accTimeout) { clearTimeout(accTimeout); accTimeout = null; }
  accResolve = null; accReject = null;
}

// ========= 外部API =========
export function primeOneSentenceReaction() {
  // 指示は setup 前なら queue しておく
  lastInputTranscript = "";
  const directive = [
    "以後のユーザー発話には、日本語で自然かつ共感的な 1〜2 文の短いリアクションのみを返してください。",
    "『ありがとうございます。』だけの返答は禁止。質問は付けないでください。"
  ].join("\n");
  sendLive({ clientContent: { turns: [{ role: "user", parts: [{ text: directive }] }] } }, { queue: true, warn: false });
}

export function beginUserTurn() {
  capturingTurn = true;
  lastInputTranscript = "";
  lastTranscriptAt = 0;
  lastUtterMs = 0;
  turnHadAudio = false;
}
export function getLastUtterMs() { return lastUtterMs; }

/** VAD 終了後の “最終版” を待つ */
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

/** この関数はターン毎に相関IDを付けて送信し、そのIDの本文だけを集約して返す */
export function sendToGemini(userText) {
  if (!isLiveOpen()) throw new Error("Gemini Live に未接続です");

  resetAccumulator();
  expectedNonce = makeNonce();
  const guard = `※必ず返答の先頭に [ID:${expectedNonce}] を厳密に付けてから本文を書いてください。` +
                `出力例: [ID:${expectedNonce}] 了解しました。`;
  const guidedText = `${userText}\n\n${guard}`;

  return new Promise((resolve, reject) => {
    accResolve = resolve; accReject = reject;
    accTimeout = setTimeout(() => { resetAccumulator(); reject(new Error("モデル応答の取得がタイムアウトしました")); }, 15000);

    // setup 完了前でも queue しておく（ここ重要）
    sendLive({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: guidedText }] }],
        turnComplete: true
      }
    }, { queue: true, warn: false });
  });
}

// ========= TTS回り込み制御 =========
export function suspendRealtimeInput() { uploadGate++; }
export function resumeRealtimeInput() { uploadGate = Math.max(0, uploadGate - 1); }

/** VADの終了待ち（worklet 側で VAD-end を検知後、300ms 後に解決） */
export function awaitUtteranceEnd(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      const txt = lastInputTranscript || "";
      capturingTurn = false;
      resolve(txt);
    }, timeoutMs);
    const finalize = () => { clearTimeout(t); capturingTurn = false; resolve(lastInputTranscript || ""); };
    awaitUtteranceEnd._resolve = finalize;
  });
}

// ========= セッション開始/終了 =========
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
    await openLiveWS();       // ← 先にWS
    await ensureMicReady();   // ← その後にMic
    overlay.classList.add("hidden");
    startConversation();
  } catch (e) {
    console.error("セッション開始エラー:", e);
    alert(e.message || "接続に失敗しました");
    overlay.classList.add("hidden");
    btnStart.disabled = false;
    endSession();
  } finally {
    starting = false;
  }
}

export function endSession() {
  try { if (isLiveOpen()) liveWS.close(); } catch {}
  liveWS = null; liveReady = false; liveCanSend = false; sendQueue = [];
  uploadEnabled = false; capturingTurn = false; turnHadAudio = false;
  cleanupAudio();
  const btnStart = document.getElementById('btnStart');
  const overlay = document.getElementById('overlay');
  if (btnStart) btnStart.disabled = false;
  if (overlay) overlay.classList.add("hidden");
}

// ========= Mic 初期化 =========
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
        // 音声送出は「このターン受付中」かつ「TTS非再生」かつ「setup 完了」のときだけ
        uploadEnabled = capturingTurn && (uploadGate === 0) && liveCanSend;
      } else if (msg.state === "end") {
        uploadEnabled = false;
        // このターンで音声を一度も送ってなければ、audioStreamEnd も送らない
        if (turnHadAudio) {
          sendLive({ realtimeInput: { audioStreamEnd: true } }, { queue: false, warn: false });
        }
        turnHadAudio = false;
        lastUtterMs = msg.utterMs || 0;
        // 300ms 後に最終文字起こしが来るのを待って resolve
        setTimeout(() => { if (awaitUtteranceEnd._resolve) awaitUtteranceEnd._resolve(); }, 300);
      }
      return;
    }

    if (msg.type === "audio") {
      // setup 完了前やTTS中は捨てる（警告なし）
      if (!uploadEnabled || uploadGate !== 0 || !liveCanSend) return;
      const int16 = new Int16Array(msg.samples);
      if (int16.length) {
        const rate = msg.rate || INPUT_SR;
        const b64 = int16ToBase64(int16);
        if (sendLive({ realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${rate}` } } }, { queue: false, warn: false })) {
          turnHadAudio = true;
        }
      }
    }
  };

  srcNode.connect(workletNode);
}

// ========= Gemini Live 接続 =========
async function openLiveWS() {
  try { if (liveWS && liveWS.readyState <= WebSocket.CLOSING) liveWS.close(); } catch {}

  // ❶ バックエンドからエフェメラルトークン取得
  const resp = await fetch(EPHEMERAL_ENDPOINT, { method: "POST" });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`ephemeral token failed: ${resp.status} ${t}`);
  }
  const data = await resp.json();
  const token = data.token || data.access_token || data.ephemeralToken;
  let wsUrl = data.wsUrl || data.ws_url;
  if (!wsUrl) {
    if (!token) throw new Error("No ephemeral token from backend.");
    const encoded = encodeURIComponent(token);
    wsUrl =
      "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
      `?access_token=${encoded}`;
  }

  liveReady = false; liveCanSend = false; sendQueue = [];

  liveWS = new WebSocket(wsUrl);
  liveWS.binaryType = "blob";

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini Live WS接続タイムアウト")), 8000);
    liveWS.onopen  = () => { clearTimeout(t); resolve(); };
    liveWS.onerror = () => { clearTimeout(t); reject(new Error("Gemini Live WSエラー")); };
  });

  liveWS.onclose = (ev) => {
    console.warn("[LIVE] closed:", ev.code, ev.reason);
    liveReady = false; liveCanSend = false; sendQueue = [];
    uploadEnabled = false; capturingTurn = false; turnHadAudio = false;
    resetAccumulator();
  };

  // setup は queue=false でもOK（open直後なので送れる想定）。念のため queue=true にしておく。
  const setup = {
    setup: {
      model: "models/gemini-live-2.5-flash-preview",
      generationConfig: { responseModalities: ["TEXT"], temperature: 0.6, maxOutputTokens: 120 },
      inputAudioTranscription: {},
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
  sendLive(setup, { queue: true, warn: false });

  liveWS.onmessage = async (ev) => {
    const textChunk = await toText(ev.data);
    if (!textChunk) return;

    const lines = textChunk.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      lineBuffer.push(line);
      const obj = tryParseJSON(lineBuffer.join("\n"));
      if (!obj) continue;
      lineBuffer = [];

      // setupComplete を受けたら送信解禁＆キューフラッシュ
      if (obj.setupComplete && !liveReady) {
        liveReady = true;
        liveCanSend = true;
        flushQueue();
        continue;
      }

      // 入力の文字起こし
      const tr = obj?.serverContent?.inputTranscription?.text;
      if (tr) {
        lastInputTranscript = tr;
        lastTranscriptAt = Date.now();
      }

      // モデル応答（nonce相関で厳密に採用）
      const parts = obj?.serverContent?.modelTurn?.parts || [];
      const texts = parts.map(p => p.text).filter(Boolean);
      if (!texts.length) continue;

      const combined = texts.join("");
      if (!expectedNonce) continue;

      const m = combined.match(/^\s*\[ID:([^\]]+)\]\s*(.*)$/s);
      if (m) {
        const id = m[1]; const rest = m[2] || "";
        if (id !== expectedNonce) { continue; }
        activeNonce = id;
        accText += rest;
      } else {
        if (activeNonce && activeNonce === expectedNonce) {
          accText += combined;
        } else {
          continue;
        }
      }

      // 300ms 静穏で確定
      if (accTimer) clearTimeout(accTimer);
      accTimer = setTimeout(() => {
        const text = (accText || "").trim();
        const r = accResolve;
        resetAccumulator();
        expectedNonce = null;
        if (r) r(text);
      }, 300);
    }
  };
}

// ========= ユーティリティ =========
function cleanupAudio() {
  try { if (srcNode) srcNode.disconnect(); } catch {}
  try { if (workletNode) workletNode.disconnect(); } catch {}
  try { if (audioCtx) audioCtx.close(); } catch {}
  try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch {}
  audioCtx = null; mediaStream = null; srcNode = null; workletNode = null;
}
async function toText(d) {
  try {
    if (typeof d === "string") return d;
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
