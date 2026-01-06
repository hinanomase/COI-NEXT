/**
 * APIをたたく
 */


import { dataChannel, transcriptionDataChannel } from './session.js';
import { Agent } from './agent.js';
import { webSocket } from './websocket.js';
import { playAudioBlob, enableMic, disableMic } from './audio.js';
import { CHAT_COMPLETION_ENDPOINT, TRANSCRIPTION_ENDPOINT, TTS_ENDPOINT } from './config.js';
import { recordVAD } from './vad.js';

export async function fetchQuestion() {
  console.debug("fetch Question");

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
  console.debug("play question");

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

/**
 * Front-end only: send text to OpenAI Chat Completions (gpt-audio-2025-08-28)
 * and play returned audio. Caller must provide a valid `apiKey`.
 * opts: { role = 'user', temperature = 0.2, voice = 'alloy', format = 'wav' }
 */
// Deprecated: chatTextToAudio client-side usage removed — server now handles chat completions.

/**
 * Front-end only: record short audio from mic and send it to model, receive audio response and play.
 * Caller must provide apiKey. durationSeconds defaults to 5.
 * opts similar to chatTextToAudio.
 */
// Deprecated: chatAudioToAudio removed — server will handle chat completions and transcription.

/**
 * Record audio and send to backend for transcription/chat processing.
 * Backend endpoint: POST /api/chat_audio (multipart/form-data with 'file' and optional 'instruction')
 * Returns JSON: { text: string, raw: any }
 */

// VAD-based recording is provided by recordVAD (see bottom of file for export)

export async function chatTextToText(instruction = '', text) {
  console.debug('[interactions] chatTextToText start', { instruction, textLength: (text||'').length });
  const resp = await fetch(CHAT_COMPLETION_ENDPOINT, 
    { method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ instruction: instruction, text: text }) 
    });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('Server transcription failed: ' + resp.status + ' ' + txt);
  }
  const data = await resp.json();
  // if (data?.text) addBubble(data.text);
  console.debug('[interactions] chatTextToText response', data);
  return data;
}

// Text -> (browser) audio: call chat completion to get text, then speak locally (no server TTS)
export async function chatTextToAudio(instruction = '', text) {
  console.debug('[interactions] chatTextToAudio start', { instruction, textLength: (text||'').length });
  const data = await chatTextToText(instruction, text);

  // Attempt to extract transcript and any base64 audio from the chat completion "raw" field.
  let transcript = null;
  let audioBase64 = null;
  try {
    const raw = data?.raw;
    if (raw && typeof raw === 'object') {
      const choice = raw.choices?.[0];
      const msg = choice?.message;
      if (msg?.audio?.transcript) transcript = msg.audio.transcript;
      else if (msg?.transcript) transcript = msg.transcript;
      if (msg?.audio?.data) audioBase64 = msg.audio.data;
    } else if (raw && typeof raw === 'string') {
      // Example raw string contains "audio=ChatCompletionAudio(..., data='BASE64...', ..., transcript='...')"
      const tmatch = raw.match(/transcript=['"]([^'"]+)['"]/s);
      if (tmatch) transcript = tmatch[1];
      const amatch = raw.match(/data=['"]([A-Za-z0-9+/=]+)['"]/s);
      if (amatch) audioBase64 = amatch[1];
    }
  } catch (e) {
    console.debug('[interactions] transcript/audio extraction error', e);
  }

  // fallback to returned text if transcript not present
  if (!transcript) transcript = (data && data.text) ? String(data.text).trim() : '';

  // If we found base64 audio data, decode and play it via playAudioBlob
  if (audioBase64) {
    try {
      const binaryString = atob(audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      const blob = new Blob([bytes.buffer], { type: 'audio/wav' });
      await playAudioBlob(blob);
      if (transcript) addBubble(transcript);
      return { ...data, transcript };
    } catch (e) {
      console.error('[interactions] failed to decode/play base64 audio', e);
    }
  }
  // Ultimately return data with transcript (may be empty)
  return { ...data, transcript };
}

/**
 * Upload arbitrary audio Blob to /api/transcription and return transcription JSON.
 * If you want VAD-based capture, use `transcribeAudioVAD` which wraps `recordVAD`.
 */
export async function transcribeAudioFile(blob, filename = 'audio.wav') {
  const form = new FormData();
  form.append('file', blob, filename);

  const resp = await fetch(TRANSCRIPTION_ENDPOINT, { method: 'POST', body: form });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('Transcription failed: ' + resp.status + ' ' + txt);
  }
  return resp.json();
}

export async function transcribeAudioVAD(durationSeconds = 30) {
  const rec = await recordVAD({ maxDurationSec: durationSeconds, debug: false });
  return await transcribeAudioFile(rec.blob, 'utterance.wav');
}

/**
 * Text → TTS using Audio Speeches/gpt-4o-mini-tts-2025-12-15
 * Tries the speech endpoint first, then falls back to chat completions if needed.
 * opts: { voice = 'alloy', format = 'wav' }
 */
export async function ttsSpeak(instructions, text) {
  // console.debug('[interactions] ttsSpeak start (proxy->/api/tts)', { voice, format, textLength: (text||'').length });
  try {
      const resp = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "marin", instructions: instructions, speed: 1.0 }),
    });

    if (!resp.ok) {
      console.error("TTS API エラー");
      return;
    }

    const blob = await resp.blob();
    await playAudioBlob(blob);
    addBubble(text);
  } catch (e) {
    console.debug('[interactions] /api/tts request error', e);
  }
}

export function getUserResponse() {
  console.debug("user response");
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
          console.debug("user text", userText);
          resolve(userText);
        }
      }
    };

    transcriptionDataChannel.addEventListener("message", onMessage);
  });
}

export async function playAgentReaction(userText) {
  console.debug("agent reaction");

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

export function addBubble(text, isUser = false) {
  console.debug('[addBubble] called', { textPreview: (typeof text === 'string' ? text.slice(0,80) : String(text)), isUser });

  // まず既存のグローバル chatContainer を取得（フォールバックあり）
  const defaultChat = document.getElementById("chatContainer");

  // エージェントオーバーレイが存在すれば、その中の右側に表示する専用コンテナを使う
  const overlay = document.getElementById('agentOverlay');
  console.debug('[addBubble] overlayPresent:', !!overlay, 'defaultChatPresent:', !!defaultChat);
  let targetContainer = defaultChat;

  if (overlay) {
    // ensure overlay has a positioning context for absolute child
    try { if (!overlay.style.position) overlay.style.position = 'fixed'; } catch(e){}

    let aChat = overlay.querySelector('#agentOverlayChat');
    if (!aChat) {
      aChat = document.createElement('div');
      aChat.id = 'agentOverlayChat';
      Object.assign(aChat.style, {
        position: 'absolute',
        left: '0',
        right: 'auto',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '200px',
        maxWidth: '45vw',
        width: 'auto',
        pointerEvents: 'auto',
        zIndex: 20100,
        color: '#fff',
        alignItems: 'flex-start',
        /* make bubbles readable even if global styles missing */
        background: 'transparent',
        padding: '4px'
      });
      overlay.appendChild(aChat);
      console.debug('[addBubble] created agentOverlayChat');
    }
    targetContainer = aChat;
  } else if (!targetContainer) {
    // 最終フォールバック: 新規 chatContainer を body に作る
    const c = document.createElement('div');
    c.id = 'chatContainer';
    Object.assign(c.style, {
      position: 'fixed', right: '20px', bottom: '20px', maxWidth: '320px', zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px'
    });
    document.body.appendChild(c);
    targetContainer = c;
    console.debug('[addBubble] created fallback chatContainer');
  }

  const div = document.createElement("div");
  div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
  div.innerHTML = text.replace(/\n/g, "<br>");
  // ensure bubble is visible even without CSS by applying minimal inline styles
  Object.assign(div.style, {
    background: isUser ? 'rgba(50,120,230,0.95)' : 'rgba(0,0,0,0.6)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '14px',
    maxWidth: 'none',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
    wordBreak: 'break-word',
    fontSize: '14px',
    textAlign: 'left',
    alignSelf: 'flex-start'
  });
  // keep user bubbles visually distinct but left-aligned
  if (isUser) Object.assign(div.style, { background: 'linear-gradient(180deg,#4b9dff,#2b6fd6)' });

  targetContainer.appendChild(div);
  console.debug('[addBubble] appended to', targetContainer.id || targetContainer);
  if (defaultChat && targetContainer === defaultChat) {
    defaultChat.scrollTop = defaultChat.scrollHeight;
  }
}

// addBubbleTyped: type text into a bubble character-by-character
// returns a Promise that resolves when typing completes
export function addBubbleTyped(text, isUser = false, charInterval = 40) {
  return new Promise((resolve) => {
    try {
      // reuse target container resolution logic from addBubble
      const defaultChat = document.getElementById("chatContainer");
      let overlay = document.getElementById('agentOverlay');
      let targetContainer = defaultChat;

      if (overlay) {
        try { if (!overlay.style.position) overlay.style.position = 'fixed'; } catch(e){}
        let aChat = overlay.querySelector('#agentOverlayChat');
        if (!aChat) {
          aChat = document.createElement('div');
          aChat.id = 'agentOverlayChat';
          Object.assign(aChat.style, {
            position: 'absolute', left: '50%', right: 'auto', top: '40%', transform: 'translateY(-50%)',
            display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px', maxWidth: '45vw', width: 'auto',
            pointerEvents: 'auto', zIndex: 20100, color: '#fff', alignItems: 'flex-start', background: 'transparent', padding: '4px'
          });
          overlay.appendChild(aChat);
        }
        targetContainer = aChat;
      } else if (!targetContainer) {
        const c = document.createElement('div');
        c.id = 'chatContainer';
        Object.assign(c.style, { position: 'fixed', right: '20px', bottom: '20px', maxWidth: '320px', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' });
        document.body.appendChild(c);
        targetContainer = c;
      }

      const div = document.createElement("div");
      div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
      // start empty, append as we type
      div.innerHTML = "";
      Object.assign(div.style, {
        background: isUser ? 'rgba(50,120,230,0.95)' : 'rgba(0,0,0,0.6)',
        color: '#fff', padding: '10px 14px', borderRadius: '14px', maxWidth: 'none', boxShadow: '0 6px 18px rgba(0,0,0,0.35)', wordBreak: 'break-word', fontSize: '14px',
        textAlign: 'left', alignSelf: 'flex-start'
      });
      if (isUser) Object.assign(div.style, { background: 'linear-gradient(180deg,#4b9dff,#2b6fd6)' });

      targetContainer.appendChild(div);

      let i = 0;
      let stopped = false;
      const raw = String(text || '');

      const finish = () => {
        if (stopped) return;
        stopped = true;
        // set full text (convert newlines to <br>)
        div.innerHTML = raw.replace(/\n/g, '<br>');
        resolve();
      };

      // click to skip typing and show full text
      const onClick = () => { finish(); try { div.removeEventListener('click', onClick); } catch(e){} };
      div.addEventListener('click', onClick);

      const timer = setInterval(() => {
        if (stopped) { clearInterval(timer); return; }
        i++;
        const partial = raw.slice(0, i);
        div.innerHTML = partial.replace(/\n/g, '<br>');
        // if finished
        if (i >= raw.length) {
          clearInterval(timer);
          try { div.removeEventListener('click', onClick); } catch(e){}
          stopped = true;
          resolve();
        }
      }, Math.max(8, Number(charInterval) || 40));

      // safety: if element removed externally, stop
      const mo = new MutationObserver(() => {
        if (!div.isConnected) {
          try { clearInterval(timer); } catch(e){}
          try { mo.disconnect(); } catch(e){}
          if (!stopped) resolve();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });

    } catch (e) {
      console.debug('[addBubbleTyped] failed', e);
      resolve();
    }
  });
}

// clear bubbles added by `addBubble`
// mode: 'agent' (default) clears only agent overlay chat;
//       'all' clears both overlay chat and global chatContainer;
//       'user' clears only user bubbles; 'ai' clears only ai bubbles in both places.
export function clearBubbles(mode = 'agent') {
  console.debug('[clearBubbles] mode', mode);
  try {
    const overlayChat = document.getElementById('agentOverlayChat');
    const chat = document.getElementById('chatContainer');

    const removeBySelector = (root, selector) => {
      if (!root) return;
      root.querySelectorAll(selector).forEach(n => { try { n.remove(); } catch(e){} });
    };

    if (mode === 'agent' || mode === 'all') {
      if (overlayChat) overlayChat.innerHTML = '';
      if (mode === 'agent') return;
    }

    if (mode === 'all') {
      if (chat) chat.innerHTML = '';
      return;
    }

    if (mode === 'user') {
      if (overlayChat) removeBySelector(overlayChat, '.bubble-user');
      if (chat) removeBySelector(chat, '.bubble-user');
      return;
    }

    if (mode === 'ai') {
      if (overlayChat) removeBySelector(overlayChat, '.bubble-ai');
      if (chat) removeBySelector(chat, '.bubble-ai');
      return;
    }

    // fallback: if no mode matched, clear overlay if exists
    if (overlayChat) overlayChat.innerHTML = '';
  } catch (e) {
    console.warn('[clearBubbles] failed', e);
  }
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

  // intro: を取り出す
  const introMatch = adviceText.match(/intro:\s*(.+?)(?=\n|$)/s);
  const intro = introMatch ? introMatch[1].trim() : "";

  // outro: を取り出す
  const outroMatch = adviceText.match(/outro:\s*(.+?)(?=\n|$)/s);
  const outro = outroMatch ? outroMatch[1].trim() : "";

  // "index: ..." をすべて取り出す（含まれなくても大丈夫）
  const regex = /index:\s*(\d+),\s*advice:\s*([^\n]+)/g;
  let match;
  while ((match = regex.exec(adviceText)) !== null) {
    const index = parseInt(match[1], 10);
    const advice = match[2].trim();

    indexList.push(index);
    formattedLines.push(`・${advice}`);
  }
  const finalText = [intro, ...formattedLines, outro].filter(Boolean).join("\n");

  return {
    formattedText: finalText,
    indexList: indexList,
  };
}

