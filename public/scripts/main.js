import { startSession } from './session.js';

document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  btnStart.onclick = startSession;
});
