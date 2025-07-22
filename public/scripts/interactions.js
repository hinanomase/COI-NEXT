/**
 * APIをたたく
 */


import { dataChannel, transcriptionDataChannel } from './session.js';
import { Agent } from './agent.js';
import { webSocket } from './websocket.js';
import { playAudioBlob, enableMic, disableMic } from './audio.js';
import { TTS_ENDPOINT } from './config.js';

export async function fetchQuestion() {
  console.log("fetch Question");

  return new Promise((resolve) => {
    const onQuestion = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "question") {
        webSocket.removeEventListener("message", onQuestion);
        console.log("question:", msg.text);
        resolve(msg.text);
      }
    };

    webSocket.addEventListener("message", onQuestion);

    webSocket.send(JSON.stringify({
      type: "next_question"
    }));
  });
}

export async function playTextAsAudio(text) {
  console.log("play question");

  const instruction = "次に送られるassistantのテキストはそのままユーザーへの質問として日本語で読み上げてください。自分で内容を変えたり追加しないでください。";
  await sendInstruction(instruction);
  await sendConversation(text, "assistant");
  await requestResponse();
  Agent.startAgentSpeak();

  addBubble(text);

  return new Promise(resolve => {
    const onMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "output_audio_buffer.stopped") {
        Agent.stopAgentSpeak();
        dataChannel.removeEventListener("message", onMessage);
        resolve();
      }
    };
    dataChannel.addEventListener("message", onMessage);
  });

  // const resp = await fetch(TTS_ENDPOINT, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ text, voice: "shimmer" }),
  // });

  // if (!resp.ok) {
  //   console.error("TTS API エラー");
  //   return;
  // }

  // const blob = await resp.blob();
  // playAudioBlob(blob);
  // addBubble(text);
}

export function getUserResponse() {
  console.log("user response");
  enableMic();
  document.getElementById("btnMic").disabled = false;

  return new Promise(resolve => {
    const onMessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const userText = msg.transcript ?? "";
        if (userText) {
          addBubble(userText, true);
          transcriptionDataChannel.removeEventListener("message", onMessage);
          disableMic();
          document.getElementById("btnMic").disabled = true;
          console.log("user text", userText);
          resolve(userText);
        }
      }
    };

    transcriptionDataChannel.addEventListener("message", onMessage);
  });
}

export async function playAgentReaction(userText) {
  console.log("agent reaction");

  const instruction = "次の回答ではユーザーの回答に対して軽くリアクションしてください．追加で質問はしないでください";
  await sendInstruction(instruction);
  await sendConversation(userText, "user");
  await requestResponse();

  Agent.startAgentSpeak();

  return new Promise(resolve => {
    const onMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "output_audio_buffer.stopped") {
        Agent.stopAgentSpeak();
        dataChannel.removeEventListener("message", onMessage);
        resolve();
      }
    };
    dataChannel.addEventListener("message", onMessage);
  });

  // return new Promise(resolve => {
  //   const onMessage = (e) => {
  //     const msg = JSON.parse(e.data);
  //     if (msg.type === "response.audio_transcript.done") {
  //       const aiText = msg.transcript;
  //       if (aiText) {
  //         dataChannel.removeEventListener("message", onMessage);
  //         resolve(aiText);
  //       }
  //     }
  //   };
  //   dataChannel.addEventListener("message", onMessage);
  // });
}

export async function sendUserResponse(text) {
  webSocket.send(JSON.stringify({
    type: "user_response",
    text
  }));
}

export async function requestAdvicePrompt() {
  webSocket.send(JSON.stringify({
    type: "generate_prompt",
    isRealtime: true
  }));
}

export async function generateAdvice(prompt) {
  await sendInstruction(prompt);
  await requestResponse();
  Agent.startAgentSpeak();

  let transcriptText = null;

  // 音声終了を待つ Promise
  const waitForAudioStop = new Promise(resolve => {
    const onAudioMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "output_audio_buffer.stopped") {
        Agent.stopAgentSpeak();
        dataChannel.removeEventListener("message", onAudioMessage);
        resolve();
      }
    };
    dataChannel.addEventListener("message", onAudioMessage);
  });

  // transcript を即時 addBubble する Promise（終了を待つ）
  const waitForTranscript = new Promise(resolve => {
    const onTextMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "response.output_item.done") {
        dataChannel.removeEventListener("message", onTextMessage);

        transcriptText = msg.item?.content?.[0]?.transcript?.trim();
        if (transcriptText) {
          addBubble(transcriptText);  // 👈 すぐに UI に反映
        }

        resolve(transcriptText);  // Promise は終わらせる
      }
    };
    dataChannel.addEventListener("message", onTextMessage);
  });

  // 両方完了するのを待つ（音声は最後まで再生させる）
  await Promise.all([waitForAudioStop, waitForTranscript]);

  return transcriptText;  // 必要なら返す
}

export async function sendConversation(text, role) {
  const type = role === "user" ? "input_text" : "text";
  const event = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: role,
      content: [
        {
          type: type,
          text: text,
        }
      ]
    },
  };
  dataChannel.send(JSON.stringify(event));
}

export async function sendInstruction(text) {
  const event = {
    type: "session.update",
    session: {
      instructions: text
    },
  };
  dataChannel.send(JSON.stringify(event));
}

export async function requestResponse() {
  dataChannel.send(JSON.stringify({ type: 'response.create' }));
}

function addBubble(text, isUser = false) {
  const chatContainer = document.getElementById("chatContainer");
  const div = document.createElement("div");
  div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
  div.textContent = text;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

export async function restoreConversationHistory(state) {
  const currentQuestion = state.current_index || 0;
  for (let i = 0; i < currentQuestion; i++) {
    const q = state.questions?.[i];
    const r = state.responses?.find(res => res.index === i);
    if (q) {
      addBubble(q, false);
      await sendConversation(q, "assistant");
    }
    if (r?.text) {
      addBubble(r.text, true);
      await sendConversation(r.text, "user");
    }
  }
}


