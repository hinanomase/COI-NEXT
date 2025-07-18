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

  // const instruction = "次の回答では質問文をユーザーにそのまま返してください";
  // await sendInstruction(instruction);
  await sendConversation(text, "assistant");
  // await requestResponse();
  // Agent.startAgentSpeak();

  // addBubble(text);

  // return new Promise(resolve => {
  //   const onMessage = (e) => {
  //     const msg = JSON.parse(e.data);
  //     if (msg.type === "output_audio_buffer.stopped") {
  //       Agent.stopAgentSpeak();
  //       dataChannel.removeEventListener("message", onMessage);
  //       resolve();
  //     }
  //   };
  //   dataChannel.addEventListener("message", onMessage);
  // });

  // Google TTS
    const response = await fetch(`${TTS_ENDPOINT}?text=${encodeURIComponent(text)}`);
    const audioBlob = await response.blob();
    await playAudioBlob(audioBlob);

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
  // await playAudioBlob(blob);
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

  // Agent.startAgentSpeak();
  // return new Promise(resolve => {
  //   const onMessage = (e) => {
  //     const msg = JSON.parse(e.data);
  //     if (msg.type === "output_audio_buffer.stopped") {
  //       Agent.stopAgentSpeak();
  //       dataChannel.removeEventListener("message", onMessage);
  //       resolve();
  //     }
  //   };
  //   dataChannel.addEventListener("message", onMessage);
  // });

  return new Promise(resolve => {
    const onMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "response.audio_transcript.done") {
        const aiText = msg.transcript;
        if (aiText) {
          dataChannel.removeEventListener("message", onMessage);
          resolve(aiText);
        }
      }
      else if(msg.type === "response.output_item.done") {
        const aiText = msg.item?.content?.[0]?.text?.trim();
        if (aiText) {
          dataChannel.removeEventListener("message", onMessage);
          resolve(aiText);
        }
      }
    };
    dataChannel.addEventListener("message", onMessage);
  });
}

export async function sendUserResponse(text) {
  webSocket.send(JSON.stringify({
    type: "user_response",
    text
  }));
}

export async function requestAdvicePrompt() {
  webSocket.send(JSON.stringify({
    type: "generate_prompt"
  }));
}

export async function generateAdvice(prompt) {
  await sendInstruction(prompt);
  await requestResponse();

  
  const adviceText = await new Promise((resolve) => {
    const onMessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "response.output_item.done") {
        const content = msg.item?.content?.[0]?.text?.trim();
        if (content) {
          dataChannel.removeEventListener("message", onMessage);
          resolve(content);
        }
      }
    };
    dataChannel.addEventListener("message", onMessage);
  });

  const { formattedText, indexList } = parseAdviceText(adviceText);
  
  console.log("📌 アドバイス整形済み:\n", formattedText);
  console.log("📎 抽出されたindex:", indexList);

  return formattedText;
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

export function addBubble(text, isUser = false) {
  const chatContainer = document.getElementById("chatContainer");
  const div = document.createElement("div");
  div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
  // div.textContent = text;
  div.innerHTML = text.replace(/\n/g, "<br>");
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

function parseAdviceText(adviceText) {
  const indexList = [];
  const formattedLines = [];

  // 正規表現でアドバイス部分を抽出
  const regex = /index:\s*(\d+),\s*advice:\s*([^\n]+)/g;
  let match;

  while ((match = regex.exec(adviceText)) !== null) {
    const index = parseInt(match[1], 10);
    const advice = match[2].trim();

    indexList.push(index);
    formattedLines.push(`・${advice}`);
  }

  // 前後のナラティブ（「いくつかアドバイスを...」など）を残したい場合
  const intro = adviceText.split("index:")[0]?.trim();
  const finalText = [intro, ...formattedLines].filter(Boolean).join("\n");

  return {
    formattedText: finalText,
    indexList: indexList,
  };
}

