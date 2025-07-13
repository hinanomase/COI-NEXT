import { Agent } from './agent.js';

const audio = new Audio();

audio.onplay = () => Agent.startAgentSpeak();
audio.onended = () => Agent.stopAgentSpeak();

export function playAudioBlob(blob) {
  const url = URL.createObjectURL(blob);
  audio.src = url;
  audio.play();
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
