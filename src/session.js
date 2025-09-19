// public/scripts/session.js
// import { setupWebSocket } from './websocket.js';
// import { startConversation } from './conversation.js';
import { EPHEMERAL_ENDPOINT, PROJECT_ID, REGION } from './config.js';
// import { GoogleGenAI, Modality } from '@google/genai';
import { GoogleGenAI, Modality } from "@google/genai";
import { setupWebSocket } from './websocket.js';
import { disableMic, isMicEnabled } from './audio.js';
import { addBubble, getInstruction } from './interactions.js';

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
// let liveWS = null;
// let liveReady = false;          // setupComplete 受信後
// let liveCanSend = false;        // 送信許可（open ＆ setupComplete 後）
// let sendQueue = [];             // setup前に来た制御メッセージを一時キュー
// let lineBuffer = [];

// let lastInputTranscript = "";
// let lastTranscriptAt = 0;


// --- モジュール間の連携用 ---
// イベントリスナーを管理するシンプルなイベントエミッター
const events = new EventTarget();
export function on(eventName, listener) {
    events.addEventListener(eventName, (e) => listener(e.detail));
}
function emit(eventName, data) {
    events.dispatchEvent(new CustomEvent(eventName, { detail: data }));
}
export function off(eventName, listener) {
    events.removeEventListener(eventName, listener);
}

// --- SDKインスタンス管理 ---
let liveClient = null;
let liveStream = null;
let mediaStream = null;
let isSessionActive = false;

// ---- Audio / VAD ----
let audioCtx = null;
// let mediaStream = null;
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
// export function primeOneSentenceReaction() {
//   // 指示は setup 前なら queue しておく
//   lastInputTranscript = "";
//   const directive = [
//     "以後のユーザー発話には、日本語で自然かつ共感的な 1〜2 文の短いリアクションのみを返してください。",
//     "『ありがとうございます。』だけの返答は禁止。質問は付けないでください。"
//   ].join("\n");
//   sendLive({ clientContent: { turns: [{ role: "user", parts: [{ text: directive }] }] } }, { queue: true, warn: false });
// }

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
// export function sendToGemini(userText) {
//   if (!isLiveOpen()) throw new Error("Gemini Live に未接続です");

//   resetAccumulator();
//   expectedNonce = makeNonce();
//   const guard = `※必ず返答の先頭に [ID:${expectedNonce}] を厳密に付けてから本文を書いてください。` +
//                 `出力例: [ID:${expectedNonce}] 了解しました。`;
//   const guidedText = `${userText}\n\n${guard}`;

//   return new Promise((resolve, reject) => {
//     accResolve = resolve; accReject = reject;
//     accTimeout = setTimeout(() => { resetAccumulator(); reject(new Error("モデル応答の取得がタイムアウトしました")); }, 15000);

//     // setup 完了前でも queue しておく（ここ重要）
//     sendLive({
//       clientContent: {
//         turns: [{ role: "user", parts: [{ text: guidedText }] }],
//         turnComplete: true
//       }
//     }, { queue: true, warn: false });
//   });
// }

// ========= TTS回り込み制御 =========
// export function suspendRealtimeInput() { uploadGate++; }
// export function resumeRealtimeInput() { uploadGate = Math.max(0, uploadGate - 1); }

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
// let starting = false;
// export async function startSession() {
//   if (starting) return;
//   starting = true;

//   const overlay = document.getElementById('overlay');
//   const btnStart = document.getElementById('btnStart');
//   overlay.classList.remove("hidden");
//   btnStart.disabled = true;

//   try {
//     await setupWebSocket();
//     await openLiveWS();       // ← 先にWS
//     await ensureMicReady();   // ← その後にMic
//     overlay.classList.add("hidden");
//     startConversation();
//   } catch (e) {
//     console.error("セッション開始エラー:", e);
//     alert(e.message || "接続に失敗しました");
//     overlay.classList.add("hidden");
//     btnStart.disabled = false;
//     endSession();
//   } finally {
//     starting = false;
//   }
// }

// export function endSession() {
//   try { if (isLiveOpen()) liveWS.close(); } catch {}
//   liveWS = null; liveReady = false; liveCanSend = false; sendQueue = [];
//   uploadEnabled = false; capturingTurn = false; turnHadAudio = false;
//   cleanupAudio();
//   const btnStart = document.getElementById('btnStart');
//   const overlay = document.getElementById('overlay');
//   if (btnStart) btnStart.disabled = false;
//   if (overlay) overlay.classList.add("hidden");
// }

// ========= Mic 初期化 =========
export async function ensureMicReady() {
  if (audioCtx) {
    console.log("[Mic] AudioContext already initialized");
    return;
  }
  console.log("[Mic] Requesting user media...");
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  console.log("[Mic] MediaStream acquired:", mediaStream);
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  await audioCtx.audioWorklet.addModule("src/pcm16-worklet.js");
  console.log("[Mic] AudioWorklet loaded");

  INPUT_SR = audioCtx.sampleRate; // 例: 48000 or 44100
  console.log("[Mic] SampleRate:", INPUT_SR);

  srcNode = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm16-worklet");

  workletNode.port.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg) return;

    if (msg.type === "vad") {
      console.log(`[VAD] state: ${msg.state}`, msg);
      if (msg.state === "start") {
        // 音声送出は「このターン受付中」かつ「TTS非再生」かつ「setup 完了」のときだけ
        // uploadEnabled = capturingTurn && (uploadGate === 0) && liveCanSend;
        // console.log("capturingTurn:", capturingTurn, "uploadGate:", uploadGate, "liveCanSend:", liveCanSend);
        console.log("[VAD] Speech start. micEnabled:", isMicEnabled(getLocalStream()));
      } else if (msg.state === "end") {
        // このターンで音声を一度も送ってなければ、audioStreamEnd も送らない
        if (turnHadAudio) {
            // liveStream.sendRealtimeInput(
            //     {
            //         audio: 
            //     }
            // );
        //   sendLive({ realtimeInput: { audioStreamEnd: true } }, { queue: false, warn: false });
          console.log("[VAD] Speech end. audioStreamEnd sent.");
        }
        turnHadAudio = false;
        lastUtterMs = msg.utterMs || 0;
        // 300ms 後に最終文字起こしが来るのを待って resolve
        // setTimeout(() => { if (awaitUtteranceEnd._resolve) awaitUtteranceEnd._resolve(); }, 300);
      }
      return;
    }

    if (msg.type === "audio") {
        const int16 = new Int16Array(msg.samples);
        if (int16.length && liveStream && isMicEnabled(getLocalStream())) {
            const rate = msg.rate || INPUT_SR;
            const b64 = int16ToBase64(int16);
            liveStream.sendRealtimeInput({
                audio: {
                    data: b64,
                    mimeType: `audio/pcm;rate=${rate}`
                }
            });
        }
    }
  };

  srcNode.connect(workletNode);
  console.log("[Mic] Audio pipeline connected");
}

// ========= Gemini Live 接続 =========
// async function openLiveWS() {
//   try { if (liveWS && liveWS.readyState <= WebSocket.CLOSING) liveWS.close(); } catch {}

//   // ❶ バックエンドからエフェメラルトークン取得
//   const resp = await fetch(EPHEMERAL_ENDPOINT, { method: "POST" });
//   if (!resp.ok) {
//     const t = await resp.text().catch(() => "");
//     throw new Error(`ephemeral token failed: ${resp.status} ${t}`);
//   }
//   const data = await resp.json();
//   const token = data.token || data.access_token || data.ephemeralToken;
//   if (!token) {
//     throw new Error("バックエンドからトークンが返されませんでした。");
//   }
//   console.log("トークン取得完了。");
//   let wsUrl = data.wsUrl || data.ws_url;
//   if (!wsUrl) {
//     if (!token) throw new Error("No ephemeral token from backend.");
//     const encoded = encodeURIComponent(token);
//     wsUrl =
//       "wss://generativelanguage.googleapis.com/ws/" +
//       "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
//       `?access_token=${encoded}`;
//   }

//   liveReady = false; liveCanSend = false; sendQueue = [];

//   liveWS = new WebSocket(wsUrl);
//   liveWS.binaryType = "blob";

//   await new Promise((resolve, reject) => {
//     const t = setTimeout(() => reject(new Error("Gemini Live WS接続タイムアウト")), 8000);
//     liveWS.onopen  = () => { clearTimeout(t); resolve(); };
//     liveWS.onerror = () => { clearTimeout(t); reject(new Error("Gemini Live WSエラー")); };
//   });

//   liveWS.onclose = (ev) => {
//     console.warn("[LIVE] closed:", ev.code, ev.reason);
//     liveReady = false; liveCanSend = false; sendQueue = [];
//     uploadEnabled = false; capturingTurn = false; turnHadAudio = false;
//     resetAccumulator();
//   };

//   // setup は queue=false でもOK（open直後なので送れる想定）。念のため queue=true にしておく。
//   const setup = {
//     setup: {
//       model: "models/gemini-2.0-flash-live-001",
//       // model: "models/gemini-live-2.5-flash-preview",
//       generationConfig: { responseModalities: ["TEXT"], temperature: 0.6, maxOutputTokens: 120 },
//       inputAudioTranscription: {},
//       realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 900 } },
//       systemInstruction: {
//         role: "user",
//         parts: [
//           { text: "あなたはメンタルヘルス対話のアシスタントです。" },
//           { text: "入出力は日本語。ユーザーの音声は日本語として扱ってください。" },
//           { text: "返答は自然で共感的な 1〜2 文。相手の言葉を軽く要約し、気持ちに寄り添ってください。" },
//           { text: "『ありがとうございます。』だけの返答は禁止。質問は付けないでください。" }
//         ]
//       }
//     }
//   };
//   sendLive(setup, { queue: true, warn: false });

//   liveWS.onmessage = async (ev) => {
//     const textChunk = await toText(ev.data);
//     if (!textChunk) return;

//     const lines = textChunk.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
//     for (const line of lines) {
//       lineBuffer.push(line);
//       const obj = tryParseJSON(lineBuffer.join("\n"));
//       if (!obj) continue;
//       else console.log("[LIVE] RECV:", obj);
//       lineBuffer = [];

//       // setupComplete を受けたら送信解禁＆キューフラッシュ
//       if (obj.setupComplete && !liveReady) {
//         liveReady = true;
//         liveCanSend = true;
//         flushQueue();
//         continue;
//       }

//       // 入力の文字起こし
//       const tr = obj?.serverContent?.inputTranscription?.text;
//       if (tr) {
//         lastInputTranscript = tr;
//         lastTranscriptAt = Date.now();
//       }

//       // モデル応答（nonce相関で厳密に採用）
//       const parts = obj?.serverContent?.modelTurn?.parts || [];
//       const texts = parts.map(p => p.text).filter(Boolean);
//       if (!texts.length) continue;

//       const combined = texts.join("");
//       if (!expectedNonce) continue;

//       const m = combined.match(/^\s*\[ID:([^\]]+)\]\s*(.*)$/s);
//       if (m) {
//         const id = m[1]; const rest = m[2] || "";
//         if (id !== expectedNonce) { continue; }
//         activeNonce = id;
//         accText += rest;
//       } else {
//         if (activeNonce && activeNonce === expectedNonce) {
//           accText += combined;
//         } else {
//           continue;
//         }
//       }

//       // 300ms 静穏で確定
//       if (accTimer) clearTimeout(accTimer);
//       accTimer = setTimeout(() => {
//         const text = (accText || "").trim();
//         const r = accResolve;
//         resetAccumulator();
//         expectedNonce = null;
//         if (r) r(text);
//       }, 300);
//     }
//   };
// }

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
function createApiRequestBody(prompt) {
    return {
        contents: [{
            parts: [{
                text: prompt
            }]
        }]
    };
}
export function getLocalStream() {
    if (mediaStream) return mediaStream;
}

/**
 * Gemini Liveとのセッションを開始します。
 * 認証、マイク準備、ストリーム開始、レスポンス待受を行います。
 */
export async function startSession() {
    if (isSessionActive) return;
    isSessionActive = true;
    console.log("セッション開始処理を開始します...");

    try {
        // サーバーと接続
        await setupWebSocket();
        // マイクを準備
        await ensureMicReady();
        console.log("マイクを準備しました。", getLocalStream());
        disableMic(getLocalStream());
        const instruction = await getInstruction();
        // バックエンドから認証トークンを取得
        const resp = await fetch(EPHEMERAL_ENDPOINT, { method: "POST" });
        if (!resp.ok) throw new Error(`認証トークンの取得に失敗: ${resp.status}`);
        const { token } = await resp.json();
        if (!token) throw new Error("バックエンドからトークンが返されませんでした。");
        console.log("認証トークンを取得しました。", token);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機

        const ai = new GoogleGenAI({
            apiKey: token,
            // location: REGION,
            // projectId: PROJECT_ID,
            httpOptions: { apiVersion: 'v1alpha' }
        });
        // const ai = new GoogleGenAI({
        //     apiKey: token,
        //     vertexai: true,
        //     apiVersion: 'v1'
        // });
        console.log("GoogleGenAIクライアント初期化", ai);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機


        // const model = 'gemini-live-2.5-flash-preview';
        // const model = 'gemini-2.0-flash-live-preview-04-09';
        const model = 'gemini-2.0-flash-live-001';
        // const model = 'gemini-2.5-flash-preview-native-audio-dialog';
        const config = {
            responseModalities: [Modality.AUDIO],            
            speechConfig: { 
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
                speechConfig: { languageCode: "ja-JP" }
            },
            systemInstruction: instruction,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            temperature: 0.2,
            maxOutputTokens: 500,
        };
        const responseQueue = [];
        const session = await ai.live.connect({
            model: model,
            config: config,
            callbacks: {
                onopen: function () {
                    console.log('Opened');
                },
                onmessage: function (message) {
                    responseQueue.push(message);
                    handleSingleResponse(message); // ここで即時処理
                    console.log('Message:', message);
                },
                onerror: function (e) {
                    console.log('Error:', e.message);
                },
                onclose: function (e) {
                    console.log('Close:', e.reason);
                },
            },
        });
        console.log("sessionを初期化", session);
        
        liveStream = session;

        async function waitMessage() {
            let done = false;
            let message = undefined;
            while (!done) {
            message = responseQueue.shift();
            if (message) {
                done = true;
            } else {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            }
            return message;
        }

        async function handleTurn() {
            const turns = [];
            let done = false;
            while (!done) {
            const message = await waitMessage();
            turns.push(message);
            if (message.serverContent && message.serverContent.turnComplete) {
                done = true;
            }
            }
            console.log("Turn complete: ", turns);
            return turns;
        }
        // console.log("sending text...");
        // const inputTurns = '好きなものは何ですか？';
        // session.sendClientContent({ turns: inputTurns });
        // console.log('Sent text: %s\n', inputTurns);

        const turns = await handleTurn();
        for (const turn of turns) {
            if (turn.serverContent && turn.serverContent.outputTranscription) {
            console.log('Received output transcription: %s\n', turn.serverContent.outputTranscription.text);
            }
            else if (turn.serverContent && turn.serverContent.inputTranscription) {
            console.log('Received input transcription: %s\n', turn.serverContent.inputTranscription.text);
            }
            if (turn.data) {
            console.log('Received inline data');
            }
            else if (turn.text) {
            console.log('Received text: %s\n', turn.text);
            }
        }

    } catch (e) {
        console.error("セッション開始エラー:", e);
        alert(e.message || "接続に失敗しました");
        endSession();
    }
}

// Geminiに指示を送る
export function sendInstruction(text) {
    if (!liveStream) {
        console.error("ストリームがアクティブではありません。");
        return;
    }
    console.log(`[SEND] Instruction: "${text}"`);
    liveStream.sendClientContent({
        turns: [{
            role: "user",
            parts: [{ text: text }]
        }],
        turnComplete: false // 返事を求めない
    });
}

// 質問のTTSを要求
export function requestQuestionTTS(question) {
    if (!liveStream) {
        console.error("ストリームがアクティブではありません。");
        return Promise.reject("ストリームがアクティブではありません。");
    }
    const text = `次の「」で囲まれた文章のみを読み上げてください．「${question}」`;
    console.log(`[SEND] Request TTS for question: "${text}"}`);

    // リクエスト送信
    liveStream.sendClientContent({
        turns: [{
            role: "user",
            parts: [{ text: text }]
        }],
        turnComplete: true, // 返事を求める
    });
}

// アドバイスを生成
export function requestAdvice(text) {
    if (!liveStream) {
        console.error("ストリームがアクティブではありません。");
        return;
    }
    console.log(`[SEND] Request advice for: "${text}"`);
    liveStream.sendClientContent({
        turns: [{
            role: "user",
            parts: [{ text: text }]
        }],
        turnComplete: true // 返事を求める
    });
}

// アドバイスプロンプトを取得
function getAdvicePrompt() {
}

/**
 * セッションを終了し、リソースを解放します。
 */
export async function endSession() {
    if (!isSessionActive) return;
    console.log("セッションを終了します。");

    if (liveClient) liveClient.close();
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());

    liveClient = null;
    liveStream = null;
    mediaStream = null;
    isSessionActive = false;
    emit('session-ended'); // UI更新などを通知
}

/**
 * テキストメッセージをGeminiに送信します。
 * @param {string} text 送信するテキスト
 */
// export function sendTextToGemini(text) {
//     if (!liveStream) {
//         console.error("ストリームがアクティブではありません。");
//         return;
//     }
//     console.log(`[SEND] Text: "${text}"`);
//     liveStream.sendText(text);
// }

/**
 * Geminiからのレスポンスを処理するメインループ
 */
// async function handleResponses() {
//     try {
//         for await (const response of liveStream.responses) {
//             console.log("[RECV]", response);

//             // ユーザーの音声の文字起こし結果
//             if (response.speechRecognition?.results.length > 0) {
//                 const result = response.speechRecognition.results[0];
//                 const transcript = result.alternatives[0].transcript;
//                 if (result.is_final) {
//                     console.log(`[RECV] Final Transcript: "${transcript}"`);
//                     emit('final-transcript', transcript); // 最終結果を通知
//                 }
//             }

//             // モデルからのテキスト応答
//             if (response.text) {
//                 emit('model-text', response.text);
//             }

//             // ★★★ モデルからの音声応答 ★★★
//             if (response.audio) {
//                 emit('model-audio', response.audio.buffer); // 音声バッファを通知
//             }

//             // モデルの応答ターンが完了したか
//             if (response.turnFinished) {
//                 emit('turn-finished');
//             }
//         }
//     } catch (error) {
//         console.error("レスポンス処理中にエラー:", error);
//     } finally {
//         // ストリームが自然に閉じた場合
//         if (isSessionActive) {
//             endSession();
//         }
//     }
// }

let userTurnTranscripts = [];
let modelTurnTranscripts = [];

/** 「」を外してテキストを返す */
function stripQuotes(text) {
    if (!text) return "";
    // return text.replace(/^[「『]/, "").replace(/[」』]$/, "");
    return text
        .replace(/^[「『\s\u3000]+/, "")   // 先頭の「『と空白類
        .replace(/[」』\s\u3000]+$/, "")   // 末尾の」』と空白類
        .replace(/\s+/g, "");       // 中間の空白類を削除
}

/** turnTranscriptsをまとめてaddBubbleする */
export function addBubbleForUserTurn() {
    if (!userTurnTranscripts.length) return;
    const joined = userTurnTranscripts.map(t => stripQuotes(t).trim()).join(" ");
    addBubble(joined, true);
    userTurnTranscripts = [];
}

/** モデル応答をまとめてaddBubble */
export function addBubbleForModelTurn() {
    if (!modelTurnTranscripts.length) return;
    const joined = modelTurnTranscripts.map(t => stripQuotes(t).trim()).join(" ");
    addBubble(joined, false);
    modelTurnTranscripts = [];
}

async function handleSingleResponse(response) {
    if (response == null) return;
    if (response.setupComplete) {
        console.log("セットアップが完了しました。");
        emit('session-started');
    }
    // --- ユーザーの音声の文字起こし結果 ---
    // if (response.speechRecognition?.results?.length > 0) {
    //     const result = response.speechRecognition.results[0];
    //     const transcript = result.alternatives[0].transcript;
    //     if (result.is_final) {
    //         console.log(`[RECV] Final Transcript: "${transcript}"`);
    //         emit('final-transcript', transcript); // 最終結果を通知
    //     }
    // }

    // --- モデルからのテキスト応答 ---
    // if (response.text) {
    //     emit('model-text', response.text);
    // }

    // --- Gemini Live APIの新しいレスポンス形式への対応 ---
    // LiveServerMessage { serverContent: { modelTurn: { parts: [...] } } }

    // --- transcript収集 ---
    const inputText = response?.serverContent?.inputTranscription?.text;
    if (inputText) {
        userTurnTranscripts.push(inputText);
    }
    const outputText = response?.serverContent?.outputTranscription?.text;
    if (outputText) {
        addBubbleForUserTurn();
        disableMic(getLocalStream());
        modelTurnTranscripts.push(outputText);
    }

    const parts = response?.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
        for (const part of parts) {
            // テキスト応答
            if (part.text) {
                emit('model-text', part.text);
            }
            // 音声応答（inlineData: base64 PCM）
            if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                // base64 PCMデータをemit
                emit('model-audio', {
                    base64: part.inlineData.data,
                    mimeType: part.inlineData.mimeType
                });
            }
        }
    }

    // --- モデルの応答ターンが完了したか ---
    if (response.turnFinished || response?.serverContent?.turnComplete) {
        console.log("[RECV] Turn finished");
        await new Promise(resolve => setTimeout(resolve, 1000));
        addBubbleForModelTurn();
        emit('turn-finished');
    }
}
