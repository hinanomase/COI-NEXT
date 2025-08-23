// public/scripts/session.js
import { LIVE_WS_BASE } from "./config.js";
import { playTextAsAudio, appendAssistantText, appendUserText } from "./interactions.js";

export let liveSocket = null;
let ready = false;

// 受信JSONの組み立て用ラインバッファ
let lineBuffer = [];

/** Start ボタンから呼ぶ */
export async function startSession() {
  const overlay = document.getElementById("overlay");
  const btnStart = document.getElementById("btnStart");
  if (overlay) overlay.classList.remove("hidden");
  if (btnStart) btnStart.disabled = true;

  try {
    const wsUrl = LIVE_WS_BASE; // config.js 側で ?key=APIキー を付与しておく
    console.log("[FRONT] WS", wsUrl);

    liveSocket = new WebSocket(wsUrl);
    liveSocket.binaryType = "blob"; // Blobで来ることがある

    liveSocket.onopen = () => {
      console.log("[LIVE] open");

      // 初期セットアップ（camelCase & Content 形式）
      const setup = {
        setup: {
          model: "models/gemini-live-2.5-flash-preview",
          generationConfig: {
            responseModalities: ["TEXT"],
            temperature: 0.4,
          },
          systemInstruction: {
            role: "user",
            parts: [
              {
                text:
                  "あなたはメンタルヘルス対話のアシスタントです。日本語で、やさしく短く、一度に質問は1つだけ返答してください。",
              },
            ],
          },
        },
      };
      liveSocket.send(JSON.stringify(setup));
    };

    // 受信（テキスト/Blob/ArrayBuffer全部対応 & 行ごとに組み立て）
    liveSocket.onmessage = async (ev) => {
      const chunkText = await toText(ev.data);
      if (!chunkText) return;

      // 1) 改行で分割して一行ずつバッファへ
      const lines = chunkText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        lineBuffer.push(line);

        // 2) ここまでの行を結合して JSON を試しにパース
        const candidate = lineBuffer.join("\n");
        const obj = tryParseJSON(candidate);

        if (!obj) {
          // まだJSONにならない → 次のチャンク/行を待つ
          continue;
        }

        // JSONとして成立したので、バッファをクリアし処理へ
        lineBuffer = [];
        handleLiveMessage(obj);
      }
    };

    liveSocket.onerror = (e) => {
      console.error("[LIVE] error", e);
      alert("Live API WebSocket エラーが発生しました");
    };

    liveSocket.onclose = (ev) => {
      console.log("[LIVE] close", { code: ev.code, reason: ev.reason });
      ready = false;
      liveSocket = null;
      lineBuffer = [];
      if (btnStart) btnStart.disabled = false;
    };

    if (overlay) overlay.classList.add("hidden");
  } catch (err) {
    console.error("セッション開始エラー:", err);
    alert(err.message || "接続に失敗しました");
    if (overlay) overlay.classList.add("hidden");
    if (btnStart) btnStart.disabled = false;
    endSession();
  }
}

/** 終了 */
export function endSession() {
  try {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) liveSocket.close();
  } catch {}
  liveSocket = null;
  ready = false;
  lineBuffer = [];
}

/** UI から呼ぶ：ユーザーの入力を送信 */
export function sendUserText(text) {
  if (!text || !text.trim()) return;
  appendUserText(text);
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    alert("未接続です。Start を押してください。");
    return;
  }
  if (!ready) {
    // setup 完了直後に送られた場合の保険
    setTimeout(() => _sendUserTextNow(text), 200);
    return;
  }
  _sendUserTextNow(text);
}

/** 実送信（camelCase） */
function _sendUserTextNow(text) {
  const payload = {
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [{ text }],
        },
      ],
      turnComplete: true,
    },
  };
  liveSocket?.send(JSON.stringify(payload));
  console.log("[LIVE][send]", text);
}

window.sendToGemini = (t) => sendUserText(t);

/* ================= ヘルパー ================= */

async function toText(data) {
  try {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return await data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(data);
  } catch {
    // 変換できないものは無視
  }
  console.log("[LIVE][raw]", data);
  return "";
}

function tryParseJSON(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Live API からの1件のメッセージ(JSON)を処理 */
function handleLiveMessage(msg) {
  // setup 完了（setupComplete または最初の serverContent）
  if (!ready && (msg.setupComplete || msg.serverContent)) {
    ready = true;
    console.log("[LIVE] ready");
    _sendUserTextNow("こんにちは。私は準備できています。あなたの体調について簡単に教えてください。");
    return;
  }

  // モデル返答（TEXT）
  const parts = msg?.serverContent?.modelTurn?.parts || [];
  const texts = parts.map((p) => p.text).filter(Boolean);
  if (texts.length) {
    const text = texts.join("\n");
    appendAssistantText(text);
    playTextAsAudio(text).catch((e) => console.warn("TTS failed:", e));
  }
}
