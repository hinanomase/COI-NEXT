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
  localStream.getAudioTracks().forEach(track => track.enabled = true);
  document.getElementById('btnMic').textContent = "Mic Off";
}

export function disableMic(localStream) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(track => track.enabled = false);
  document.getElementById('btnMic').textContent = "Mic On";
}

export function toggleMic(localStream) {
  if (!localStream) return;
  const enabled = !localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = enabled;
  document.getElementById('btnMic').textContent = enabled ? "Mic Off" : "Mic On";
}
