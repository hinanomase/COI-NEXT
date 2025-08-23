// public/scripts/interactions.js
import { TTS_ENDPOINT } from "./config.js";
import { sendUserText } from "./session.js";

/** 画面のログ領域（id="assistantText"）にアシスタントのテキストを追記 */
export function appendAssistantText(text) {
  const el = document.getElementById("assistantText");
  if (el) {
    el.textContent += (el.textContent ? "\n" : "") + "Assistant: " + text;
    el.scrollTop = el.scrollHeight;
  } else {
    console.log("[Assistant]", text);
  }
}

/** 画面のログ領域（id="assistantText"）にユーザーのテキストを追記 */
export function appendUserText(text) {
  const el = document.getElementById("assistantText");
  if (el) {
    el.textContent += (el.textContent ? "\n" : "") + "You: " + text;
    el.scrollTop = el.scrollHeight;
  } else {
    console.log("[You]", text);
  }
}

/** 既存の Google Cloud TTS エンドポイントで読み上げ */
export async function playTextAsAudio(text) {
  if (!text) return;
  const url = `${TTS_ENDPOINT}?text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("TTS 生成に失敗しました");
  const blob = await res.blob();
  const audio = new Audio(URL.createObjectURL(blob));
  await audio.play();
}

/* ======= 簡易UIハンドラ（フォームから送る場合） ======= */
/* HTML に以下の要素がある前提：
   <form id="chatForm">
     <input id="chatInput" type="text" />
     <button type="submit">Send</button>
   </form>
   <pre id="assistantText"></pre>
*/

const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
if (form && input) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = String(input.value || "").trim();
    if (!text) return;
    sendUserText(text);
    input.value = "";
  });
}

// 既存の会話履歴復元が必要ならここを拡張
export async function restoreConversationHistory(_state) { /* no-op */ }
