import { Agent } from './agent.js';
import { addBubble, addBubbleTyped } from './interactions.js';
import { AGENT_TEXT } from './config.js';

const audio = new Audio();

audio.onplay = () => { try { Agent.startAgentSpeak(); } catch(e){} };
audio.onended = () => { try { Agent.stopAgentSpeak(); } catch(e){} };

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

export function playVoiceFile(number, chatInterval = 150) {
  return new Promise((resolve, reject) => {
    if (!number) {
      reject(new Error('file number is required'));
      return;
    }
    console.debug('[Audio] playVoiceFile called with number:', number);
    // const audioURL = `/COI-NEXT-frontend/public/assets/voice/agent_voice_${number}.wav`;
    const audioURL = `/public/assets/voice/agent_voice_${number}.wav`;
    const player = new Audio(audioURL);
    player.preload = 'auto';

    player.addEventListener('playing', () => {
      try { 
        Agent.startAgentSpeak();
       } catch (e) {}
      console.debug('[Audio] calling addBubble for number:', number);
      addBubbleTyped(AGENT_TEXT[number - 1], false, chatInterval);
    });

    player.addEventListener('ended', () => {
      try { Agent.stopAgentSpeak(); } catch (e) {}
      resolve();
    });

    player.addEventListener('error', (e) => {
      try { Agent.stopAgentSpeak(); } catch (err) {}
      reject(e);
    });

    player.play().catch(err => {
      try { Agent.stopAgentSpeak(); } catch (e) {}
      reject(err);
    });
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
