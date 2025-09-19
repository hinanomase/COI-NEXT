import { Agent } from './agent.js';

const audio = new Audio();

audio.onplay = () => Agent.startAgentSpeak();
audio.onended = () => Agent.stopAgentSpeak();

export function playAudioBlob(blob) {
  return new Promise((resolve, reject) => {
    const audioURL = URL.createObjectURL(blob);
    const audio = new Audio(audioURL);

    audio.addEventListener('playing', () => {
      Agent.startAgentSpeak();
    });

    audio.addEventListener('ended', () => {
      Agent.stopAgentSpeak();
      URL.revokeObjectURL(audioURL); // メモリ解放
      resolve();
    });

    audio.addEventListener('error', (e) => {
      reject(e);
    });

    audio.play().catch(reject);
  });
}

export function enableMic(localStream) {
  if (!localStream) return;
  console.log("Enabling mic");
  localStream.getAudioTracks().forEach(track => track.enabled = true);
  document.getElementById('btnMic').textContent = "Mic Off";
}

export function disableMic(localStream) {
  if (!localStream) return;
  console.log("Disabling mic");
  localStream.getAudioTracks().forEach(track => track.enabled = false);
  document.getElementById('btnMic').textContent = "Mic On";
}

export function toggleMic(localStream) {
  if (!localStream) return;
  const enabled = !localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = enabled;
  document.getElementById('btnMic').textContent = enabled ? "Mic Off" : "Mic On";
}

export function isMicEnabled(localStream) {
  if (!localStream) {
    // console.log("No mic stream");
    return false;
  }
  return localStream.getAudioTracks()[0].enabled;
}

// public/scripts/audio.js
let audioContext;
export let currentSource = null;
export let audioQueue = [];
let isPlaying = false;

function getAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

/**
 * AudioBufferを再生します。
 * @param {AudioBuffer} audioBuffer 再生する音声バッファ
 */
// export async function playAudioBuffer(audioBuffer) {
//     try {
//         const context = getAudioContext();
//         await context.resume(); // ユーザー操作後にコンテキストを再開
//         const source = context.createBufferSource();
        
//         // SDKから受け取ったraw PCMデータをAudioBufferに変換
//         const pcmBuffer = context.createBuffer(1, audioBuffer.length, context.sampleRate);
//         pcmBuffer.copyToChannel(new Float32Array(audioBuffer), 0);
        
//         source.buffer = pcmBuffer;
//         source.connect(context.destination);
//         Agent.startAgentSpeak();
//         source.start();

//         return new Promise(resolve => {
//             source.onended = resolve;
//             Agent.stopAgentSpeak();
//         });
//     } catch (e) {
//         console.error("音声の再生に失敗しました:", e);
//     }
// }

// base64 PCMデータを再生する関数
export async function playBase64PCM(base64, mimeType, onStarted) {
    const sampleRate = parseInt((mimeType.match(/rate=(\d+)/) || [])[1] || "24000", 10);
    const binary = atob(base64);
    const len = binary.length / 2;
    const pcm16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
        pcm16[i] = (binary.charCodeAt(i * 2 + 1) << 8) | binary.charCodeAt(i * 2);
    }
    // PCM16をFloat32に変換
    const float32 = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        float32[i] = pcm16[i] / 32768;
    }
    // const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const audioCtx = getAudioContext();
    await audioCtx.resume();

    const buffer = audioCtx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    currentSource = source;

    // 再生開始時にコールバック
    if (typeof onStarted === "function") onStarted();
    const overlay = document.getElementById('overlay');
    overlay.classList.add("hidden");

    source.start();

    return new Promise(resolve => {
        source.onended = () => {
            if (currentSource === source) currentSource = null;
            window.dispatchEvent(new Event('model-audio-ended'));
            resolve();
        };
    });
}

export async function playBase64PCMQueued(base64, mimeType, onStarted) {
    audioQueue.push({ base64, mimeType, onStarted });
    if (!isPlaying) {
        playNextInQueue();
    }
}

async function playNextInQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }
    isPlaying = true;
    const { base64, mimeType, onStarted } = audioQueue.shift();
    await playBase64PCM(base64, mimeType, onStarted);
    playNextInQueue();
}