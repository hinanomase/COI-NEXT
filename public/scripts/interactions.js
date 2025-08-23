// public/scripts/interactions.js
import { webSocket } from './websocket.js';
import { playAudioBlob } from './audio.js';
import { TTS_ENDPOINT } from './config.js';
import {
  sendToGemini,
  primeOneSentenceReaction,
  awaitUtteranceEnd,
  awaitStableTranscript,
  suspendRealtimeInput,
  resumeRealtimeInput,
  beginUserTurn,
  getLastUtterMs,
} from './session.js';

let lastQuestion = "";

export function fetchQuestion() {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "question") {
        webSocket.removeEventListener("message", onMessage);
        lastQuestion = msg.text || "";
        resolve(msg.text);
      }
    };
    webSocket.addEventListener("message", onMessage);
    webSocket.send(JSON.stringify({ type: "next_question" }));
  });
}

export async function playTextAsAudio(text) {
  addBubble(text, false);
  // TTS の回り込み中は送信停止
  suspendRealtimeInput();
  try {
    const res = await fetch(`${TTS_ENDPOINT}?text=${encodeURIComponent(text)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    await playAudioBlob(blob);
  } finally {
    resumeRealtimeInput();
  }
}

// Stop不要：VAD → 最終テキスト（500ms静穏）を採用
export async function getUserResponse() {
  beginUserTurn();            // この質問の回答受付を開始
  primeOneSentenceReaction(); // 返答は短いリアクションに限定

  for (let attempt = 0; attempt < 3; attempt++) {
    // 1) 発話の終わり（VAD）を待つ
    await awaitUtteranceEnd(15000);
    // 2) さらに 500ms 変化がないのを待ち、"最終版" を決定
    const finalText = (await awaitStableTranscript(500, 2000)).trim();
    const ok = isValidTranscript(finalText, getLastUtterMs());
    if (ok) { addBubble(finalText, true); return finalText; }

    // 取りこぼし：丁寧にもう一度お願いして、同じ質問のまま待つ
    await playTextAsAudio("もう一度お願いします");
    beginUserTurn(); // もう一度この質問の回答を受付
  }
  return "";
}

/**
 * Gemini に「自然で共感的な1〜2文」のリアクションを生成させる
 */
export async function playAgentReaction(userText) {
  if (!userText) return ""; // 未取得なら反応しない（同じ質問を継続）

  const prompt = [
    "あなたはメンタルヘルス対話の日本語アシスタントです。",
    "次の[質問]に対する[ユーザーの回答]を踏まえ、自然で共感的なリアクションを 1〜2 文だけ返してください。",
    "必ず敬体（です・ます）。相手の言葉を軽く要約し、気持ちに寄り添ってください。",
    "一般的なお礼だけの返答（例:「ありがとうございます。」のみ）は禁止。",
    "指示: 質問や追質問は付けない。アドバイスは短い励ましや共感の一言に留める。",
    "",
    `[質問]\n${lastQuestion}`,
    `[ユーザーの回答]\n${userText}`
  ].join("\n");

  const aiText = (await sendToGemini(prompt).catch(() => ""))?.trim() || "";
  const finalText = aiText || "お話しありがとうございます。お気持ちが伝わってきました。";
  return finalText;
}

// 回答をサーバへ保存
export async function sendUserResponse(text) {
  webSocket.send(JSON.stringify({ type: "user_response", text }));
}

/* =========================
   ★ 追加: 最後のアドバイス生成
   ========================= */

// サーバに「アドバイス用の集約プロンプトを作って送って」と依頼
export function requestAdvicePrompt() {
  webSocket.send(JSON.stringify({ type: "generate_prompt" }));
}

// 受け取ったプロンプトを Gemini に投げて、簡潔な最終メッセージを作る
export async function generateAdvice(prompt) {
  const guide = [
    "あなたはメンタルヘルスの日本語アシスタントです。",
    "以下の情報をもとに、ユーザーに向けた短いまとめメッセージを 3〜6 文で作成してください。",
    "- これまでの発話から感じられる気持ちの要約（共感）",
    "- 日常で取り入れやすい1〜2個の優しい提案（選べる形/押し付けない）",
    "- 努力や工夫を認める一言",
    "禁止: 医療的診断/危険な助言/断定的表現/長すぎる文章。",
    "出力フォーマット（厳守）:",
    "intro: 1文の導入（共感）",
    "index: 1, advice: ～（20〜40字）",
    "index: 2, advice: ～（20〜40字）",
    "outro: 1文の締め（励まし）",
    "",
    "[素材]",
    prompt || ""
  ].join("\n");

  const aiText = (await sendToGemini(guide).catch(() => ""))?.trim() || "";
  const { formattedText } = parseAdviceText(aiText);
  return formattedText || aiText || "";
}

/* ====== UI ====== */
export function addBubble(text, isUser = false) {
  const chatContainer = document.getElementById("chatContainer");
  const div = document.createElement("div");
  div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
  div.innerHTML = (text || "").replace(/\n/g, "<br>");
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/* ====== ユーティリティ ====== */
// 最短 250ms / 1文字以上。日本語文字を推奨。
function isValidTranscript(text, utterMs) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 1) return false;
  if ((utterMs || 0) < 250) return false;
  const hasJa = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(t);
  return hasJa || t.length >= 4;
}

// アドバイスの整形（フォーマットを吸収）
function parseAdviceText(adviceText) {
  if (!adviceText) return { formattedText: "" };
  const formatted = [];
  const intro = adviceText.match(/intro:\s*(.+?)(?=\n|$)/s)?.[1]?.trim() || "";
  const outro = adviceText.match(/outro:\s*(.+?)(?=\n|$)/s)?.[1]?.trim() || "";
  const regex = /index:\s*(\d+),\s*advice:\s*([^\n]+)/g;
  let m;
  while ((m = regex.exec(adviceText)) !== null) {
    const advice = (m[2] || "").trim();
    if (advice) formatted.push(`・${advice}`);
  }
  const finalText = [intro, ...formatted, outro].filter(Boolean).join("\n");
  return { formattedText: finalText };
}
