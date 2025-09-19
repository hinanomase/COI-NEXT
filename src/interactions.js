// public/scripts/interactions.js
import { webSocket } from './websocket.js';
import { playAudioBlob } from './audio.js';
import { TTS_ENDPOINT } from './config.js';
import {
  // sendToGemini,
  // primeOneSentenceReaction,
  awaitUtteranceEnd,
  awaitStableTranscript,
  // suspendRealtimeInput,
  // resumeRealtimeInput,
  beginUserTurn,
  getLastUtterMs,
} from './session.js';

let lastQuestion = "";

export async function getInstruction() {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "instruction") {
        webSocket.removeEventListener("message", onMessage);
        resolve(msg.instruction || "");
      }
    };
    webSocket.addEventListener("message", onMessage);
    webSocket.send(JSON.stringify({ type: "get_instruction" }));
  });
}

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

export async function getUserResponse() {
  beginUserTurn();            
  primeOneSentenceReaction(); 

  for (let attempt = 0; attempt < 3; attempt++) {
    await awaitUtteranceEnd(15000);
    const finalText = (await awaitStableTranscript(500, 2000)).trim();
    const ok = isValidTranscript(finalText, getLastUtterMs());
    if (ok) { addBubble(finalText, true); return finalText; }

    await playTextAsAudio("もう一度お願いします");
    beginUserTurn(); 
  }
  return "";
}


export async function playAgentReaction(userText) {
  if (!userText) return ""; 

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


export function requestAdvicePrompt() {
  webSocket.send(JSON.stringify({ type: "generate_prompt" }));
}


export async function generateAdvice(prompt) {
  const guide = [
    "あなたはメンタルヘルスの日本語アシスタントです。",
    "以下の情報をもとに、ユーザーに向けた短いまとめメッセージを 3〜6 文で作成してください。",
    "- これまでの発話から感じられる気持ちの要約（共感）",
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

function isValidTranscript(text, utterMs) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 1) return false;
  if ((utterMs || 0) < 250) return false;
  const hasJa = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(t);
  return hasJa || t.length >= 4;
}


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
