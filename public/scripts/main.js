import { startSession } from './session.js';
import { toggleMic } from './audio.js';

document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  const btnMic = document.getElementById('btnMic');

  btnStart.onclick = startSession;
  btnMic.onclick = toggleMic;
});
