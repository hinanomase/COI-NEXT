// public/scripts/main.js
// ========================================================
// Start→キャリブ完了まではエージェント非表示 / 完了後に表示
// 10秒経過 or Stop押下 で終了（非表示）
// 口パク機能なし。既存構成を変えずにCanvas表示のみ制御。
// + 追加: キャリブの視線可視化イベントを使って左右注視割合を集計
// ========================================================

import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopMediaPipeAll,
  resetCollectedData,
  startCollecting,
  stopCollecting,
  pauseProcessing,
  resumeProcessing,
} from "./mediapipe.js";
import { Agent } from './agent.js';
import { playVoiceFile } from "./audio.js";
import { addBubble, clearBubbles } from "./interactions.js";
import { runCalibration, computeEyeOpenRatio } from "./calibration.js";
import { DataAnalyzer } from "./dataAnalyzer.js";
import { chatTextToText, chatTextToAudio, transcribeAudioVAD, ttsSpeak } from "./interactions.js";

document.addEventListener("DOMContentLoaded", () => {
    // URL からグループを判別してグローバルに保持（?group=1|2 または ?group=movie1|movie2）
    function parseGroupFromUrl() {
      try {
        const params = new URLSearchParams(window.location.search);
        let g = params.get('group') || params.get('cond') || params.get('movie') || null;
        if (!g) return 'movie1';
        g = String(g).toLowerCase();
        if (g === '1') return 'movie1';
        if (g === '2') return 'movie2';
        if (/^movie[12]$/.test(g)) return g;
        return g;
      } catch (e) { return 'movie1'; }
    }
    const participantGroup = parseGroupFromUrl();
    window.__participantGroup = participantGroup;
    window.__participantGroupLabel = (participantGroup === 'movie1') ? 'horror' : (participantGroup === 'movie2') ? 'calm' : participantGroup;
    console.debug('[Main] participantGroup:', window.__participantGroup, window.__participantGroupLabel);
    // Ensure participant has given consent; use sessionStorage for transient consent (cleared on reload)
    try {
      const sess = sessionStorage.getItem('participantConsentSession');
      if (sess) {
        try { window.__participantConsent = JSON.parse(sess); } catch(e) { window.__participantConsent = { agreed: true, ts: Date.now() }; }
        try { sessionStorage.removeItem('participantConsentSession'); } catch(e){}
      } else {
        const raw = localStorage.getItem('participantConsent');
        if (raw) {
          try { window.__participantConsent = JSON.parse(raw); } catch(e) { window.__participantConsent = { agreed: true, ts: Date.now() }; }
          // remove from localStorage so consent does not persist after arriving at index
          try { localStorage.removeItem('participantConsent'); } catch(e){}
        } else {
          // redirect to consent page before proceeding, include current URL so we can return with query params
          try {
            const next = encodeURIComponent(window.location.href || './index.html');
            window.location.href = `./consent.html?next=${next}`;
          } catch(e) {
            window.location.href = './consent.html';
          }
          return;
        }
      }
    } catch (e) {
      window.__participantConsent = null;
    }
    // helper: decide which movie id to play based on parsed group
    function getMovieForParticipant() {
      try {
        const g = (window.__participantGroup || 'movie1').toString().toLowerCase();
        if (g === 'movie2' || g === '2') return 'movie2';
        // support movie1/movie2 or numeric 1/2
        if (g === 'movie1' || g === '1') return 'movie1';
        // if group already encodes a movie filename, return it
        if (/^movie[0-9\-a-z]+$/i.test(g)) return g;
        return 'movie1';
      } catch (e) { return 'movie1'; }
    }

  // ===== DOM参照 =====
  const appContainer = document.getElementById("app");
  const dividerToggle = document.getElementById("dividerToggle");

  // const btnToggle =
  //   document.getElementById("btnToggle") ||
  //   document.getElementById("btnToggleStartStop");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");

  const canvas1 = document.getElementById("myCanvas1");
  const canvas2 = document.getElementById("myCanvas2");

  const coordLog = document.getElementById("coordLog");
  const frameInfo = document.getElementById("frameInfo");
  const openInfo  = document.getElementById("openInfo");
  const closedInfo = document.getElementById("closedInfo");

  const dataPanel = document.getElementById("dataPanel");
  const analyzer = new DataAnalyzer(20);

  // participant name (filled by modal)
  let participantNameRaw = null; // human-readable, may contain Japanese
  let participantNameSafe = null; // file-safe encoded name

  // toggleDebugMode(false);

  // create a simple modal for participant name input
  function createNameModal() {
    const modal = document.createElement('div');
    modal.id = 'nameModal';
    Object.assign(modal.style, { position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 20000 });
    const box = document.createElement('div');
    Object.assign(box.style, { background: '#fff', padding: '18px', borderRadius: '8px', minWidth: '360px', textAlign: 'center', fontSize: '15px' });
    const title = document.createElement('div'); title.textContent = '参加者情報'; title.style.fontWeight = '700'; title.style.marginBottom = '8px'; title.style.color = 'black'; title.style.fontSize = '25px';
    const desc = document.createElement('div'); desc.textContent = '以下の情報を入力してください（必須）'; desc.style.marginBottom = '10px'; desc.style.color = 'black'; desc.style.fontSize = '15px';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'participantName';
    input.name = 'participantName';
    input.setAttribute('aria-label', '参加者名');
    input.placeholder = '氏名';
    input.style.width = '100%';
    input.style.padding = '8px';
    input.style.marginBottom = '10px';
    input.style.fontSize = '20px';

    // Gender select (include '回答しない')
    const genderWrap = document.createElement('div'); genderWrap.style.marginBottom = '10px'; genderWrap.style.textAlign = 'left';
    const genderLabel = document.createElement('label'); genderLabel.textContent = '性別（必須）'; genderLabel.style.display = 'block'; genderLabel.style.fontSize = '15px'; genderLabel.style.marginBottom = '6px'; genderLabel.style.color = 'black';
    const genderSelect = document.createElement('select'); genderSelect.id = 'participantGender'; genderSelect.style.width = '100%'; genderSelect.style.padding = '8px'; genderSelect.style.fontSize = '20px';
    genderSelect.innerHTML = `<option value="">選択してください</option><option value="male">男性</option><option value="female">女性</option><option value="other">その他</option><option value="no_answer">回答しない</option>`;
    genderWrap.appendChild(genderLabel); genderWrap.appendChild(genderSelect);

    // Age select (list to choose from)
    const ageWrap = document.createElement('div'); ageWrap.style.marginBottom = '12px'; ageWrap.style.textAlign = 'left';
    const ageLabel = document.createElement('label'); ageLabel.textContent = '年齢（必須）'; ageLabel.style.display = 'block'; ageLabel.style.fontSize = '15px'; ageLabel.style.marginBottom = '6px'; ageLabel.style.color = 'black';
    const ageSelect = document.createElement('select'); ageSelect.id = 'participantAge'; ageSelect.style.width = '100%'; ageSelect.style.padding = '8px'; ageSelect.style.fontSize = '20px';
    // build per-year options (6歳〜99歳) and a 100歳以上 option
    let ageOptions = '<option value="">選択してください</option>';
    for (let y = 6; y <= 99; y++) {
      ageOptions += `<option value="${y}">${y}歳</option>`;
    }
    ageOptions += '<option value="100plus">100歳以上</option>';
    ageSelect.innerHTML = ageOptions;
    ageWrap.appendChild(ageLabel); ageWrap.appendChild(ageSelect);

    const btn = document.createElement('button'); btn.textContent = '開始'; btn.style.padding = '10px 14px'; btn.style.cursor = 'pointer'; btn.disabled = true; btn.style.opacity = '0.6'; btn.style.fontSize = '20px';
    const note = document.createElement('div'); note.style.fontSize = '12px'; note.style.color = '#666'; note.style.marginTop = '6px'; note.textContent = 'すべて必須項目です';

    box.appendChild(title); box.appendChild(desc); box.appendChild(input); box.appendChild(genderWrap); box.appendChild(ageWrap); box.appendChild(btn); box.appendChild(note);
    modal.appendChild(box);
    document.body.appendChild(modal);
    function validateModal() {
      const nameOk = (input.value || '').trim().length > 0;
      const genderOk = (genderSelect.value || '') !== '';
      const ageOk = (ageSelect.value || '') !== '';
      const ok = nameOk && genderOk && ageOk;
      btn.disabled = !ok;
      btn.style.opacity = ok ? '1' : '0.6';
      return ok;
    }

    input.addEventListener('input', () => { input.style.border = ''; validateModal(); });
    genderSelect.addEventListener('change', () => validateModal());
    ageSelect.addEventListener('change', () => validateModal());

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (validateModal()) btn.click(); } });
    btn.addEventListener('click', () => {
      const v = (input.value || '').trim();
      if (!v) { input.style.border = '1px solid #f44'; return; }
      if (!validateModal()) return;
      participantNameRaw = v;
      const g = genderSelect.value || null;
      const a = ageSelect.value || null;
      try { participantNameSafe = encodeURIComponent(participantNameRaw); } catch(e) { participantNameSafe = participantNameRaw.replace(/[/\\]/g,'_'); }
      // expose selected gender/age globally for saving
      try { window.__participantGender = g; window.__participantAge = a; } catch(e){}
      modal.remove();
      // show the agent overlay after name entry and wait until it's hidden before proceeding
      (async () => {
        try {
          console.debug('[Main] calling Agent.showAgent');
          await Agent.showAgent();
          // console.debug('[Main] calling chatTextToAudio');
          
          // try {
            // await ttsSpeak(
            //   "少し明るめで淡々と説明するように", 
            //   `はじめまして、${participantNameRaw}さん。これから実験を始めます。よろしくお願いします。
            //   まずは視線の計測から始めます。顔を動かさないように画面の黄色い点を目で追ってください。`,
            // );
            // const transcription = await transcribeAudioVAD();
            // console.debug('[Main] transcribeAudioVAD returned', transcription);
            // const response = await chatTextToText("ツールから返された文章は「」の中をそのまま一字一句違わず音声で繰り返してください。「」内の言葉遣いを変えたり前後に文章を付け加えたりしないでください。", "実験の説明をしてください。");
            // const response = await chatTextToAudio(
            //   "「experiment_description」と言われたら関数呼び出しを行ってください。", 
            //   "experiment_description"
            // );
            // const response = await chatTextToAudio(
            //   "「」の中をそのまま一字一句違わず音声で繰り返してください。「」内の言葉遣いを変えたり前後に文章を付け加えたりしないでください。合図地や返事も不要です。明るい声でゆっくりはっきり喋ってください。", 
            //   "「これから実験を始めます。最初に視線の計測を行います。顔を動かさず、画面の点を目で追ってください。」"
            // );
            // console.debug('[Main] chatTextToText returned', response);
            // const response = await chatTextToText("映画を観た感想は？という質問に対する回答です。1文で短くリアクションしてください。追加で質問はしないでください。", transcription.text);
            // // await ttsSpeak("少し明るめで淡々と説明するように", response.text);
            // await ttsSpeak(
            //   "少し明るめで淡々と説明するように", 
            //   response.text
            // );
            // console.debug('[Main] chatTextToAudio returned');
            try {
              await new Promise((resolve) => {
                const onProcess = (ev) => {
                  try {
                    if (ev?.detail?.status === 'DisplayCompletedBoyA') {
                      document.removeEventListener('processCompleted', onProcess);
                      resolve();
                    }
                  } catch (e) { /* ignore */ }
                };
                document.addEventListener('processCompleted', onProcess);
              });
            } catch (err) {
              console.debug('[Main] waiting for processCompleted failed', err);
            }

            // 実験開始前アンケート（pre）を実施
            try {
              await new Promise(r => setTimeout(r, 2000));
              try {
                await playVoiceFile(1);
              } catch (e) { console.debug('[Main] playVoiceFile pre-valence failed', e); }
              const valence_pre = await showSurveyQuestion('valence', 'Valence（快‐不快）', '今の気分を選んでください\n（1=非常に不快、9=非常に快）', '非常不快', '非常快');
              clearBubbles();

              try { await playVoiceFile(3); } catch (e) { console.debug('[Main] playVoiceFile pre-arousal failed', e); }
              const arousal_pre = await showSurveyQuestion('arousal', 'Arousal（覚醒）', '今の覚醒状態（落ち着き‐興奮）を選んでください\n（1=とても落ち着いている、9=とても興奮/緊張している）', '落ち着き', '興奮/緊張');
              clearBubbles();

              // await playVoiceFile(4);
              // const attention = await showSurveyQuestion('attention', '', 'この設問では「3」を選択してください。', '', '');
              // clearBubbles();

              try { await playVoiceFile(5); } catch (e) { console.debug('[Main] playVoiceFile pre-anxiety failed', e); }
              const anxiety_pre = await showSurveyQuestion('anxiety', 'Anxiety（不安）', '今、不安はどのくらいですか？\n（1=まったく不安がない、9=とても不安）', 'まったく不安がない', 'とても不安');
              clearBubbles();

              try { await playVoiceFile(6); } catch (e) { console.debug('[Main] playVoiceFile pre-dominance failed', e); }
              const dominance_pre = await showSurveyQuestion('dominance', 'Dominance（支配感）', 'いまのあなたは、この状況をどれくらい自分でコントロールできていると感じますか？\n（左＝圧倒されている／右＝コントロールできている）', '圧倒されている', 'コントロールできている');
              clearBubbles();

              try { await playVoiceFile(7, 130); } catch (e) { console.debug('[Main] playVoiceFile pre-complete failed', e); }

              // 保存に pre を明示
              saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'valence', value: valence_pre, when: 'pre', ts: Date.now() }, 'survey_valence_pre');
              saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'arousal', value: arousal_pre, when: 'pre', ts: Date.now() }, 'survey_arousal_pre');
              // saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'attention', value: attention, when: 'post', ts: Date.now() }, 'survey_attention_check');
              saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'anxiety', value: anxiety_pre, when: 'pre', ts: Date.now() }, 'survey_anxiety_pre');
              saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'dominance', value: dominance_pre, when: 'pre', ts: Date.now() }, 'survey_dominance_pre');
            } catch (e) {
              console.debug('[Main] pre-survey flow failed', e);
            }

          // 再生終了後に「次へ」ボタンを表示し，クリックでエージェントを閉じる
          await new Promise((resolve) => {
            try {
              const overlay = document.getElementById('agentOverlay');
              if (!overlay) { resolve(); return; }

              // 既存ボタンがあれば除去
              const existing = document.getElementById('agentNextBtn');
              if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

              const btn = document.createElement('button');
              btn.id = 'agentNextBtn';
              btn.textContent = '次へ';
              Object.assign(btn.style, {
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: '6vh',
                zIndex: 20150,
                padding: '10px 18px',
                fontSize: '18px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                background: 'linear-gradient(90deg,#4b8cff,#3366ff)',
                color: '#fff',
                boxShadow: '0 8px 20px rgba(0,0,0,0.18)'
              });

              overlay.appendChild(btn);

              btn.addEventListener('click', async () => {
                try { btn.remove(); } catch (e) {}
                try { 
                  await Agent.hideAgent();
                  await handleStart();
                  // showImages();
                  // await runExperimentSequence();
                 } catch (e) { console.debug('[Main] Agent.hideAgent failed', e); }
                resolve();
              }, { once: true });
            } catch (e) {
              console.debug('[Main] failed to create next button', e);
              resolve();
            }
          });

        } catch (e) { console.debug('[Main] Agent.showAgent failed', e); }
        // after agent overlay closed, continue with start flow (user gesture performed)
        // setTimeout(() => { if (typeof btnStart?.click === 'function') btnStart.click(); else if (typeof handleStart === 'function') handleStart(); }, 50);
      })();
    });
    return modal;
  }

  // simple overlay message (center) for short notifications
  function showMessage(text, secs=3) {
    const id = 'mainMessageOverlay';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div'); el.id = id;
      Object.assign(el.style, { position: 'fixed', background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '12px 18px', borderRadius: '8px', zIndex: 15000, fontWeight: 600 });
      document.body.appendChild(el);
    }
    el.textContent = text;
    // position centered over myCanvas3 (both horizontally and vertically)
    const canvas3 = document.getElementById('myCanvas3');
    if (canvas3) {
      const r = canvas3.getBoundingClientRect();
      // center point of canvas3
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top = (r.top + r.height / 2) + 'px';
      // translate to truly center on both axes
      el.style.transform = 'translate(-50%, -50%)';
      // constrain overlay width relative to canvas
      el.style.maxWidth = Math.max(180, Math.round(r.width * 0.9)) + 'px';
      el.style.textAlign = 'center';
    } else {
      el.style.left = '50%'; el.style.top = '50%'; el.style.transform = 'translate(-50%, -50%)';
    }
    el.style.display = '';
    // if a previous action requested that images be shown after the next message, do it now
    if (typeof __deferShowImagesAfterNextMessage !== 'undefined' && __deferShowImagesAfterNextMessage) {
      __deferShowImagesAfterNextMessage = false;
      (async () => {
        try {
          // wait for a layout frame then a short delay to ensure wrappers are visible
          await new Promise(r => requestAnimationFrame(r));
          await new Promise(r => setTimeout(r, 60));
          try { showImages(); } catch (e) { console.debug('[Main] deferred showImages failed', e); }
          try { if (leftImg && typeof leftImg.refresh === 'function') leftImg.refresh(); } catch (e) { console.debug('[Main] deferred leftImg.refresh failed', e); }
          try { if (rightImg && typeof rightImg.refresh === 'function') rightImg.refresh(); } catch (e) { console.debug('[Main] deferred rightImg.refresh failed', e); }
        } catch (e) {
          console.debug('[Main] error while performing deferred showImages', e);
        }
      })();
    }
    if (secs > 0) setTimeout(() => { try { el.style.display = 'none'; } catch(e){} }, secs*1000);
  }

  // show a countdown timer overlay for minutes (used for 5min rest)
  function showTimer(minutes) {
    const id = 'mainTimerOverlay';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div'); el.id = id;
      Object.assign(el.style, { position: 'fixed', left: '50%', top: '20%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.95)', color: '#000', padding: '16px 22px', borderRadius: '8px', zIndex: 15000, textAlign: 'center', fontSize: '20px', fontWeight: 700 });
      // create a dedicated text container
      const txt = document.createElement('div'); txt.className = 'main-timer-text'; txt.style.margin = '0';
      el.appendChild(txt);
      document.body.appendChild(el);
    }

    let remain = minutes * 60;
    // ensure any previous interval is cleared
    try { if (el._timerInterval) { clearInterval(el._timerInterval); el._timerInterval = null; } } catch(e){}

    // create or find debug skip button
    let debugSkipBtn = el.querySelector('.main-timer-skip');
    if (isDebugMode() && !debugSkipBtn) {
      debugSkipBtn = document.createElement('button');
      debugSkipBtn.className = 'main-timer-skip';
      debugSkipBtn.textContent = '休憩を残り3秒にする';
      debugSkipBtn.style.display = 'block';
      debugSkipBtn.style.margin = '8px auto 0';
      debugSkipBtn.style.padding = '6px 10px';
      debugSkipBtn.style.fontSize = '14px';
      debugSkipBtn.addEventListener('click', () => { remain = 3; });
      el.appendChild(debugSkipBtn);
    }

    const txtEl = el.querySelector('.main-timer-text');
    const tick = () => {
      const m = Math.floor(remain/60); const s = remain%60;
      if (txtEl) txtEl.textContent = `休憩: ${m}分 ${s}秒`;
      if (remain <= 0) { try { if (el._timerInterval) { clearInterval(el._timerInterval); el._timerInterval = null; } } catch(e){}; try { el.remove(); } catch(e){}; return; }
      remain -= 1;
    };
    // run immediately and then every second
    tick();
    el._timerInterval = setInterval(tick, 1000);
  }

  // === Video preloading and Wake Lock helpers ===
  // map of preloaded video elements by id
  window.__preloadedMovies = window.__preloadedMovies || {};
  let __wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !__wakeLock) {
        __wakeLock = await navigator.wakeLock.request('screen');
        __wakeLock.addEventListener('release', () => { console.debug('[Main] WakeLock released'); __wakeLock = null; });
        console.debug('[Main] WakeLock acquired');
      }
    } catch (e) {
      console.debug('[Main] failed to acquire WakeLock', e);
      __wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    try {
      if (__wakeLock) {
        await __wakeLock.release();
        __wakeLock = null;
      }
    } catch (e) {
      console.debug('[Main] failed to release WakeLock', e);
      __wakeLock = null;
    }
  }

  // Preload an array of movie ids (without extension)
  async function preloadMovies(movieIds = []) {
    const promises = [];
    movieIds.forEach(id => {
      try {
        if (window.__preloadedMovies[id]) return; // already
        const v = document.createElement('video');
        v.preload = 'auto';
        v.playsInline = true;
        v.muted = true; // mute during preload to avoid autoplay restrictions
        v.src = `assets/mp4/${id}.mp4`;
        v.style.display = 'none';
        document.body.appendChild(v);
        window.__preloadedMovies[id] = v;
        // attempt to load; resolve when metadata loaded
        const p = new Promise((res) => {
          const onLoaded = () => { try { v.removeEventListener('loadedmetadata', onLoaded); } catch(e){}; res(); };
          v.addEventListener('loadedmetadata', onLoaded);
          // fallback timeout to avoid hanging
          setTimeout(() => { try { v.removeEventListener('loadedmetadata', onLoaded); } catch(e){}; res(); }, 8000);
        });
        promises.push(p);
        // call load to start network fetch
        try { v.load(); } catch(e) {}
      } catch (e) { console.debug('[Main] preloadMovies failed for', id, e); }
    });
    try { await Promise.all(promises); } catch(e){}
    console.debug('[Main] preloadMovies finished', Object.keys(window.__preloadedMovies));
  }

  // debug mode detection and toggle
  function isDebugMode() {
    try {
      if (window.__DEBUG === true) return true;
      const p = new URLSearchParams(window.location.search);
      if (p.get('debug') === '1') return true;
      if (localStorage.getItem('COI_DEBUG') === '1') return true;
    } catch(e){}
    return false;
  }

  function toggleDebugMode(on) {
    const val = (typeof on === 'boolean') ? on : !isDebugMode();
    try { localStorage.setItem('COI_DEBUG', val ? '1' : '0'); } catch(e){}
    try { window.__DEBUG = val; } catch(e){}
    showMessage(`Debug mode: ${val ? 'ON' : 'OFF'}`, 2);
    // if a modal movie is open, update its controls
    const vid = document.querySelector('#movieModal video');
    if (vid) {
      vid.controls = val;
    }
    return val;
  }

  // keyboard shortcut to toggle debug mode: Shift+D
  window.addEventListener('keydown', (ev) => {
    if (ev.shiftKey && (ev.key === 'D' || ev.key === 'd')) {
      toggleDebugMode();
    }
  });

  // ===== 画像描画ヘルパー（キャンバスに画像をフィット描画、切替対応） =====
  const __canvasControllers = {};
  function createCanvasImageController(canvasId, src, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    // ensure canvas backing store matches CSS size for sharp rendering
    const ctx = canvas.getContext('2d');
    let img = new Image();
    let currentSrc = null;
    const alignment = opts.alignment || 'center'; // 'left' | 'right' | 'center'
    const margin = (typeof opts.margin === 'number') ? opts.margin : 12; // CSS pixels

    function ensureSize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      // debug: log rect so we can see if canvas is laid out
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[Main] ensureSize', canvasId, 'rect=', {w: rect.width, h: rect.height, dpr});
      }
      const desiredW = Math.max(1, Math.round(rect.width * dpr));
      const desiredH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== desiredW || canvas.height !== desiredH) {
        canvas.width = desiredW;
        canvas.height = desiredH;
        // scale drawing context to account for DPR
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    function render() {
      if (!img || !img.naturalWidth) return;
      ensureSize();
      // note: ctx has been transform-scaled for DPR so use CSS pixels
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr, ch = canvas.height / dpr;
      // maintain aspect ratio but prefer filling vertical available space so top/bottom gaps ~= margin
      const targetW = Math.max(1, cw - 2 * margin);
      const targetH = Math.max(1, ch - 2 * margin);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      // prefer scaling so image height == targetH (so top/bottom gap == margin)
      let scale = targetH / ih;
      let w = Math.round(iw * scale), h = Math.round(ih * scale);
      // if that makes the image too wide for horizontal target, clamp to targetW
      if (w > targetW) {
        scale = targetW / iw;
        w = Math.round(iw * scale);
        h = Math.round(ih * scale);
      }
      // x: aligned to left/right/center within available area
      let x;
      if (alignment === 'left') {
        x = margin;
      } else if (alignment === 'right') {
        x = Math.round(cw - margin - w);
      } else {
        x = Math.round((cw - w) / 2);
      }
      // y: center vertically within area between margins so top/bottom gaps ~= margin
      const y = Math.round(margin + ((targetH - h) / 2));
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, x, y, w, h);
    }

    function setSrc(s) {
      if (!s) return;
      if (s === currentSrc && img && img.naturalWidth) return;
      currentSrc = s;
      img = new Image();
      img.onload = () => { try { 
          console.debug('[Main] image loaded', canvasId, s, 'natural=', img.naturalWidth+'x'+img.naturalHeight);
          render();
        } catch(e){} };
      img.onerror = () => { console.debug('[Main] failed to load image', s); };
      img.src = s;
    }

    function clear() {
      try {
        currentSrc = null;
        img = new Image();
        // ensure canvas backing store matches current layout then clear visually
        ensureSize();
        const dpr = window.devicePixelRatio || 1;
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;
        try { ctx.clearRect(0, 0, cw, ch); } catch(e) { /* ignore */ }
      } catch (e) {
        console.debug('[Main] clear canvas failed', canvasId, e);
      }
    }

    // expose
  const ctrl = { setSrc, refresh: render, clear, img };
    __canvasControllers[canvasId] = ctrl;
    // if a src was provided, set it after a short delay to allow layout
    if (src) setTimeout(() => setSrc(src), 250);
    return ctrl;
  }

    // initialize left/right canvases with default emotion images (left-aligned / right-aligned)
  const leftImg = createCanvasImageController('myCanvas1', 'assets/img/joy/joy (1).png', { alignment: 'left', margin: 12 });
  const rightImg = createCanvasImageController('myCanvas2', 'assets/img/sad/sad (1).png', { alignment: 'right', margin: 12 });
  // global helper for runtime switching (for debugging/testing)
  window.setCanvasImage = (canvasId, src) => {
    const c = __canvasControllers[canvasId]; if (c) c.setSrc(src); else console.debug('no canvas controller', canvasId);
  };

  // debug helpers: inspect sizes and force redraw from console
  window.debugCanvasInfo = () => {
    ['myCanvas1','myCanvas2'].forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) { console.debug('no canvas', id); return; }
      const wrap = canvas.closest('.canvas-square');
      console.group(`canvas:${id}`);
      console.debug('elementRect:', canvas.getBoundingClientRect());
      if (wrap) console.debug('wrapperRect:', wrap.getBoundingClientRect());
      const cs = window.getComputedStyle(wrap || canvas);
      console.debug('display:', cs.display, 'visibility:', cs.visibility, 'width/height:', cs.width, cs.height);
      console.groupEnd();
    });
    console.debug('agent-row:', document.querySelector('.agent-row')?.getBoundingClientRect());
    console.debug('topGrid:', document.getElementById('topGrid')?.getBoundingClientRect());
  };

  window.refreshCanvas = (canvasId) => {
    const c = __canvasControllers[canvasId]; if (c && typeof c.refresh === 'function') { c.refresh(); console.debug('[Main] refreshed', canvasId); }
    else console.debug('no refreshable canvas controller for', canvasId);
  };

  // ===== 追加: 視線集計用の状態 =====
  let gazeStartedAt = 0;
  let gazeCounts = null;
  let onGazeIn = null;
  let onGazeOOB = null;
  // current displayed pair mapping: which side currently shows `joy` ("left" or "right")
  let currentPairJoySide = 'left';
  // history of mappings for the duration of aggregation: { idx, joySide, ts }
  let pairMappingHistory = [];
  // normalized openRatio series (ema used for display)
  window.__normalizedOpenSeries = window.__normalizedOpenSeries || [];

  // ===== 状態 =====
  let isRunning = false;
  let calib = null;
  let emaOpen = null;
  let autoStopTimer = null; // ← 自動停止用タイマーID
  // when true, the next call to showMessage() will unhide images and refresh canvases once
  let __deferShowImagesAfterNextMessage = false;


  const hideImages = () => {
    clearImages();
    const wrap1 = canvas1?.closest('.canvas-square');
    const wrap2 = canvas2?.closest('.canvas-square');
    if (wrap1) wrap1.style.display = 'none'; else if (canvas1) canvas1.style.display = 'none';
    if (wrap2) wrap2.style.display = 'none'; else if (canvas2) canvas2.style.display = 'none';
  };
  const showImages = () => {
    const wrap1 = canvas1?.closest('.canvas-square');
    const wrap2 = canvas2?.closest('.canvas-square');
    if (wrap1) wrap1.style.display = 'block'; else if (canvas1) canvas1.style.display = 'block';
    if (wrap2) wrap2.style.display = 'block'; else if (canvas2) canvas2.style.display = 'block';
  };

  // 初期状態：非表示
  // hideImages();
  // keep images hidden until calibration completes
  hideImages();
  // btnToggle.style.display = 'none';

  // show name entry modal on load
  try { createNameModal(); } catch(e) { console.debug('failed to create name modal', e); }

  // ===== Start / Stop =====
  const handleStart = async () => {
    if (isRunning) return;
    isRunning = true;
    setBtnState(true);
    // btnToggle.style.display = 'none';
    hideImages();

    try {
      console.debug("[Main] Start → MediaPipe初期化");
      await mediapipeInitAndStart();

      // preload movies to reduce buffering during experiment
      // try { preloadMovies(['movie1-1','movie1-2','movie2-1','movie2-2']); } catch(e) { console.debug('[Main] preloadMovies failed', e); }
      // try { preloadMovies(['movie1']); } catch(e) { console.debug('[Main] preloadMovies failed', e); }

      // try to acquire wake lock to prevent screen dimming
      try { await requestWakeLock(); } catch(e) { /* ignore */ }

      console.debug("[Main] キャリブレーション開始");
      calib = await runCalibration();

  // expose calibration info globally so save routine can include baselines and gaze coeffs
  try { window.__lastCalibration = calib; } catch (e) { window.__lastCalibration = null; }

  analyzer.reset();
  // reset normalized series
  window.__normalizedOpenSeries = [];
  // align mediapipe storage start with normalized open series start
  try { resetCollectedData(); } catch(e) { console.debug('[Main] failed to reset collected data', e); }

      // === 視線割合の集計を開始（キャリブ完了後〜Stopまで） ===
      setupGazeAggregation();

  console.debug("[Main] キャリブレーション完了 → エージェント表示");
  showImages();


      // start the experiment orchestration after calibration
      await runExperimentSequence();

    } catch (e) {
      console.debug("[Main] Startフロー失敗:", e);
      // alert("キャリブレーションまたは初期化に失敗しました。");
      isRunning = false;
      setBtnState(false);
      hideImages();
      teardownGazeAggregation(); // 念のため
    }
  };

  const handleStop = async () => {
    if (!isRunning) return;
    isRunning = false;
    setBtnState(false);

    console.debug("[Main] Stop → 停止処理開始");

    // タイマー解除
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }

    // cancel running sequence if present
    try { if (window.__sequenceCancel) window.__sequenceCancel(); } catch(e) {}

    // compute final gaze aggregation now so we can include it in saved files
    const gazeResult = (typeof teardownGazeAggregation === "function")
      ? teardownGazeAggregation()
      : (window.__lastGazeResult || {left:0,right:0,durationSec:0,samplesIn:0,oobSamples:0});
    // expose for saving
    window.__lastGazeResult = gazeResult;

    // compute open/close summary from DataAnalyzer and expose for saving
    try {
      const openSummary = analyzer.summarize();
      window.__lastOpenSummary = openSummary;
    } catch (e) {
      console.debug('[Main] failed to produce open summary for saving', e);
      window.__lastOpenSummary = null;
    }

    try { await sendEyeLandmarkData(); } catch {}
    try { await stopMediaPipeAll(); } catch {}

  // release wake lock if held
  try { await releaseWakeLock(); } catch(e) { console.debug('[Main] releaseWakeLock failed', e); }

    hideImages();

  
    // 既存の開閉統計を先に描画
    analyzer.renderToPanel(dataPanel);

    // render the final results (gazeResult already computed above)
    const gazeResultToRender = window.__lastGazeResult || {left:0,right:0,durationSec:0,samplesIn:0,oobSamples:0};
    renderFinalResults(dataPanel, gazeResultToRender);


    emaOpen = null;
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo)  openInfo.textContent = "Open: —%";
    if (closedInfo) closedInfo.setAttribute("aria-hidden", "true");

    console.debug("[Main] 停止処理完了");
  };

  // ===== ボタン配線 =====
  // --- experiment helpers inserted here ---
  function setPairForIndex(i) {
    const leftSrc = `assets/img/joy/joy (${i}).png`;
    const rightSrc = `assets/img/sad/sad (${i}).png`;
    // default: left=joy, right=sad
    if (leftImg) leftImg.setSrc(leftSrc);
    if (rightImg) rightImg.setSrc(rightSrc);
    // record mapping (joy on left)
    try { currentPairJoySide = 'left'; pairMappingHistory.push({ idx: i, joySide: 'left', ts: Date.now() }); } catch(e){}
  }

  function clearImages() {
    try { if (leftImg && typeof leftImg.clear === 'function') leftImg.clear(); else if (leftImg) leftImg.setSrc(null); } catch(e){}
    try { if (rightImg && typeof rightImg.clear === 'function') rightImg.clear(); else if (rightImg) rightImg.setSrc(null); } catch(e){}
  }

  async function showImageRange(startIdx, endIdx, setMs = 3000) {
    const total = endIdx - startIdx + 1;
    for (let k = 0; k < total; k++) {
      const idx = startIdx + k;
      // decide randomly whether to swap left/right for this pair
      const swap = (Math.random() < 0.5);
      if (swap) {
        // right = joy, left = sad
        const leftSrc = `assets/img/sad/sad (${idx}).png`;
        const rightSrc = `assets/img/joy/joy (${idx}).png`;
        if (leftImg) leftImg.setSrc(leftSrc);
        if (rightImg) rightImg.setSrc(rightSrc);
        try { currentPairJoySide = 'right'; pairMappingHistory.push({ idx: idx, joySide: 'right', ts: Date.now() }); } catch(e){}
      } else {
        // left = joy, right = sad
        setPairForIndex(idx);
        try { /* setPairForIndex already pushed mapping */ } catch(e){}
      }
      await new Promise(r => requestAnimationFrame(r));
      try { if (leftImg && typeof leftImg.refresh === 'function') leftImg.refresh(); } catch (e) {}
      try { if (rightImg && typeof rightImg.refresh === 'function') rightImg.refresh(); } catch (e) {}
      await new Promise(r => setTimeout(r, setMs));
    }
  }

  async function savePhaseData(phaseLabel) {
    try {
      // finalize aggregation summaries for this block
      try { window.__lastGazeResult = teardownGazeAggregation(); } catch (e) {}
      try { window.__lastOpenSummary = analyzer.summarize(); } catch (e) {}
      await sendEyeLandmarkData({ name: participantNameRaw || null, nameSafe: participantNameSafe || null, phase: phaseLabel, group: window.__participantGroup || null });
    } catch (e) { console.debug('[Main] failed to save phase data', e); }
  }

  async function playMovie(movieId, durationSec = 300) {
    return new Promise(async (resolve) => {
      const modalId = 'movieModal';
      // remove existing modal if any
      const existing = document.getElementById(modalId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      const modal = document.createElement('div'); modal.id = modalId;
      Object.assign(modal.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20000 });
      const box = document.createElement('div'); Object.assign(box.style, { width: '90%', maxWidth: '1400px', background: '#000', padding: '6px', borderRadius: '6px', textAlign: 'center' });

      // prefer a preloaded video element if available
      let video = window.__preloadedMovies && window.__preloadedMovies[movieId];
          let ownVideo = false;
      if (video && video.tagName === 'VIDEO') {
        // reuse preloaded element but clone to avoid muting/preload flags
        try {
          const clone = document.createElement('video');
          clone.controls = isDebugMode(); clone.style.width = '100%'; clone.style.height = 'auto'; clone.playsInline = true; clone.preload = 'auto';
          // use same src
          clone.src = video.currentSrc || video.src || `assets/mp4/${movieId}.mp4`;
          video = clone;
          ownVideo = true;
        } catch(e) { video = null; }
      }
      if (!video) {
        video = document.createElement('video');
        video.controls = isDebugMode(); video.style.width = '100%'; video.style.height = 'auto'; video.playsInline = true; video.preload = 'auto';
        video.src = `assets/mp4/${movieId}.mp4`;
        ownVideo = true;
      }

      box.appendChild(video);
      // const btn = document.createElement('button'); btn.textContent = '再生（クリック）'; btn.style.marginTop = '8px'; btn.style.padding = '8px 12px'; btn.style.fontSize = '16px';
      // box.appendChild(btn);
      modal.appendChild(box); document.body.appendChild(modal);

      // try autoplay; if blocked user can click button to start
      try { const p = video.play(); if (p && p.catch) p.catch(()=>{}); } catch(e) { /* ignore */ }
      // btn.addEventListener('click', async () => { try { await video.play(); } catch(e){} });

      // ensure we resolve only when playback ends (not on timeout)
      const timeoutId = setTimeout(() => {
        // fallback: if video didn't end within durationSec, we'll still clean up but do NOT auto-advance; prefer ended event
        console.debug('[Main] playMovie fallback timeout reached for', movieId);
      }, durationSec*1000 + 1500);

      function onEnded() { clearTimeout(timeoutId); cleanup(); resolve(); }
      function cleanup() { try { video.removeEventListener('ended', onEnded); } catch(e){}; if (modal && modal.parentNode) modal.parentNode.removeChild(modal); try { releaseWakeLock(); } catch(e){}; if (ownVideo) try { video.src = ''; } catch(e){} }
      video.addEventListener('ended', onEnded);
    });
  }

  async function runExperimentSequence() {
    // Phase 1
    showMessage('次に10ペアの画像が表示されます。', 5);
    await new Promise(r => setTimeout(r, 6000));
    // ensure collector and normalized series start aligned
    window.__normalizedOpenSeries = [];
    try { resetCollectedData(); } catch(e){}
    // resume processing and start collecting only for image display
    try { resumeProcessing(); startCollecting(); } catch(e){}
    setupGazeAggregation();
    await showImageRange(1, 10, 3000);
    // after image block, stop collecting and pause processing to save and be lightweight
    try { stopCollecting(); pauseProcessing(); } catch(e){}
    await savePhaseData('1-1');
    // hide images when block finishes and show next instruction
    try { hideImages(); } catch(e){}
    showMessage('続いて動画を再生します。動画が再生されるまで時間がかかる場合があります。', 5);
    await new Promise(r => setTimeout(r, 5000));
    await playMovie(getMovieForParticipant(), 300);

      // images 1-2
    try { showImages(); } catch(e){}
    showMessage('次に10ペアの画像が表示されます。', 3);
    await new Promise(r => setTimeout(r, 4000));
    window.__normalizedOpenSeries = [];
    try { resetCollectedData(); } catch(e){}
    try { resumeProcessing(); startCollecting(); } catch(e){}
    // ensure images are visible for the next block
    setupGazeAggregation();
    await showImageRange(11, 20, 3000);
    try { stopCollecting(); pauseProcessing(); } catch(e){}
    await savePhaseData('1-2');
    // 5 minute rest
    try { hideImages(); } catch(e){}
    await new Promise(r => setTimeout(r, 2000));
    // アンケート
    await Agent.showAgent();
    await new Promise(r => setTimeout(r, 2000));
    try{
      // 1回目: Valence
      await playVoiceFile(2, 130);
      const valence = await showSurveyQuestion('valence', 'Valence（快‐不快）', '今の気分を選んでください\n（1=非常に不快、9=非常に快）', '非常不快', '非常快');
      clearBubbles();
      
      // 2回目: Arousal
      await playVoiceFile(3);
      const arousal = await showSurveyQuestion('arousal', 'Arousal（覚醒）', '今の覚醒状態（落ち着き‐興奮）を選んでください\n（1=とても落ち着いている、9=とても興奮/緊張している）', '落ち着き', '興奮/緊張');
      clearBubbles();

      // 3回目: アテンションチェック
      await playVoiceFile(4);
      const attention = await showSurveyQuestion('attention', '', 'この設問では「3」を選択してください。', '', '');
      clearBubbles();

      // 4回目: anxiety
      await playVoiceFile(5);
      const anxiety = await showSurveyQuestion('anxiety', 'Anxiety（不安）', '今、不安はどのくらいですか？\n（1=まったく不安がない、9=とても不安）', 'まったく不安がない', 'とても不安');
      clearBubbles();

      // 5回目: Dominance（支配感）
      await playVoiceFile(6);
      const dominance = await showSurveyQuestion('dominance', 'Dominance（支配感）', 'いまのあなたは、この状況をどれくらい自分でコントロールできていると感じますか？\n（左＝圧倒されている／右＝コントロールできている）', '圧倒されている', 'コントロールできている');
      clearBubbles();

      await playVoiceFile(8);
      
      saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'valence', value: valence, when: 'post', ts: Date.now() }, 'survey_valence_post');
      saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'arousal', value: arousal, when: 'post', ts: Date.now() }, 'survey_arousal_post');
      saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'attention', value: attention, when: 'post', ts: Date.now() }, 'survey_attention_check');
      saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'anxiety', value: anxiety, when: 'post', ts: Date.now() }, 'survey_anxiety_post');
      saveSurveyResults({ participant: participantNameRaw, participantSafe: participantNameSafe, type: 'dominance', value: dominance, when: 'post', ts: Date.now() }, 'survey_dominance_post');
    } catch (err) {
      console.debug('[Main] Question flow failed', err);
    }
    // showMessage('5分間の休憩を取ります。', 5);
    // await new Promise(r => setTimeout(r, 5000));
    // showTimer(5);
    // await new Promise(r => setTimeout(r, 5*60*1000));
    // // await new Promise(r => setTimeout(r, 3*1000));
    // showMessage('次に動画（5分）を再生します。動画が再生されるまで時間がかかる場合があります。', 5);
    // await new Promise(r => setTimeout(r, 5000));
    // await playMovie('movie1-2', 300);

      // images 1-3
    // try { showImages(); } catch(e){}
    // showMessage('次に10ペアの画像が表示されます。', 3);
    // await new Promise(r => setTimeout(r, 4000));
    // window.__normalizedOpenSeries = [];
    // try { resetCollectedData(); } catch(e){}
    // try { resumeProcessing(); startCollecting(); } catch(e){}
    // setupGazeAggregation();
    // await showImageRange(21, 30, 3000);
    // try { stopCollecting(); pauseProcessing(); } catch(e){}
    // await savePhaseData('1-3');

      // End of Phase 1
    // try { hideImages(); } catch(e){}


    //   showMessage('フェーズ1終了です', 5);
    //   await new Promise(r => setTimeout(r, 5000));
    //   // show Next button (rich style) centered over #myCanvas3
    //   const nextBtn = document.createElement('button');
    //   nextBtn.textContent = '次へ';
    //   Object.assign(nextBtn.style, {
    //     position: 'fixed',
    //     zIndex: 16000,
    //     padding: '12px 22px',
    //     fontSize: '18px',
    //     fontWeight: '700',
    //     color: '#fff',
    //     background: 'linear-gradient(90deg,#4b8cff,#3366ff)',
    //     border: 'none',
    //     borderRadius: '12px',
    //     boxShadow: '0 8px 24px rgba(51,102,255,0.22)',
    //     cursor: 'pointer',
    //     transform: 'translate(-50%, -50%)',
    //     transition: 'transform .12s ease, box-shadow .12s ease',
    //   });
    //   nextBtn.setAttribute('aria-label', '次へ (フェーズ2へ進む)');
    //   document.body.appendChild(nextBtn);

    //   const canvas3 = document.getElementById('myCanvas3');
    //   function positionNextBtn() {
    //     try {
    //       if (canvas3) {
    //         const r = canvas3.getBoundingClientRect();
    //         const cx = r.left + r.width / 2;
    //         const cy = r.top + r.height / 2;
    //         nextBtn.style.left = cx + 'px';
    //         nextBtn.style.top = cy + 'px';
    //       } else {
    //         nextBtn.style.left = (window.innerWidth / 2) + 'px';
    //         nextBtn.style.top = (window.innerHeight / 2) + 'px';
    //       }
    //     } catch (e) {
    //       nextBtn.style.left = '50%'; nextBtn.style.top = '50%';
    //     }
    //   }
    //   positionNextBtn();
    //   window.addEventListener('resize', positionNextBtn);

    //   // when Next is pressed, make sure images are shown and canvases refresh before continuing
    //   await new Promise(resolve => {
    //     nextBtn.addEventListener('click', async () => {
    //       try {
    //         // visual press effect
    //         nextBtn.style.transform = 'translate(-50%, -50%) scale(0.98)';  
    //       } catch (err) {
    //         console.debug('[Main] error during Next click preparation', err);
    //       }
    //       try { window.removeEventListener('resize', positionNextBtn); } catch(e){}
    //       try { nextBtn.remove(); } catch(e){}
    //       resolve();
    //     }, { once: true });
    //   });

    //   // Phase 2 (mirror of Phase 1 but with movie2 IDs)
    // try { showImages(); } catch (e) { console.debug('[Main] showImages failed on Next click', e); }
    // // allow layout to settle
    // await new Promise(r => requestAnimationFrame(r));
    // await new Promise(r => setTimeout(r, 60));
    // // refresh canvas controllers to recalc backing store
    // try { if (leftImg && typeof leftImg.refresh === 'function') leftImg.refresh(); } catch (e) { console.debug('[Main] leftImg.refresh failed', e); }
    // try { if (rightImg && typeof rightImg.refresh === 'function') rightImg.refresh(); } catch (e) { console.debug('[Main] rightImg.refresh failed', e); }
    // showMessage('次に10ペアの画像が表示されます。', 3);
    // await new Promise(r => setTimeout(r, 4000));
    // window.__normalizedOpenSeries = [];
    // try { resetCollectedData(); } catch(e){}
    // try { resumeProcessing(); startCollecting(); } catch(e){}
    // setupGazeAggregation();
    // await showImageRange(31, 40, 3000);
    // try { stopCollecting(); pauseProcessing(); } catch(e){}
    // await savePhaseData('2-1');
    // try { hideImages(); } catch(e){}
    // showMessage('続いて動画（5分）を再生します。動画が再生されるまで時間がかかる場合があります。', 5);
    // await new Promise(r => setTimeout(r, 5000));
    // await playMovie('movie2-1', 300);

    // try { showImages(); } catch(e){}
    // showMessage('次に10ペアの画像が表示されます。', 3);
    // await new Promise(r => setTimeout(r, 4000));
    // window.__normalizedOpenSeries = [];
    // try { resetCollectedData(); } catch(e){}
    // try { resumeProcessing(); startCollecting(); } catch(e){}
    // setupGazeAggregation();
    // await showImageRange(41, 50, 3000);
    // try { stopCollecting(); pauseProcessing(); } catch(e){}
    // await savePhaseData('2-2');

    // try { hideImages(); } catch(e){}
    // showMessage('5分間の休憩を取ります。', 5);
    //   await new Promise(r => setTimeout(r, 5000));
    //   showTimer(5);
    //   await new Promise(r => setTimeout(r, 5*60*1000));
      // await new Promise(r => setTimeout(r, 3*1000));
    // showMessage('次に動画（5分）を再生します。動画が再生されるまで時間がかかる場合があります。', 5);
    // await new Promise(r => setTimeout(r, 5000));
    // await playMovie('movie2-2', 300);
    
    // try { showImages(); } catch(e){}
    // showMessage('次に10ペアの画像が表示されます。', 3);
    // await new Promise(r => setTimeout(r, 4000));
    // window.__normalizedOpenSeries = [];
    // try { resetCollectedData(); } catch(e){}
    // try { resumeProcessing(); startCollecting(); } catch(e){}
    // setupGazeAggregation();
    // await showImageRange(51, 60, 3000);
    // try { stopCollecting(); pauseProcessing(); } catch(e){}
    // await savePhaseData('2-3');

    // try { hideImages(); } catch(e){}
    // showMessage('実験が終了しました。ご協力ありがとうございました。', 5);
  }
  // if (btnToggle) {
  //   btnToggle.addEventListener("click", async () => {
  //     if (!isRunning) await handleStart();
  //     else await handleStop();
  //   });
  // }
  if (btnStart) btnStart.addEventListener("click", handleStart);
  if (btnStop)  btnStop.addEventListener("click", handleStop);

  // ===== トグル（既存動作維持） =====
  if (dividerToggle && appContainer) {
    dividerToggle.setAttribute("aria-expanded", "true");
    dividerToggle.addEventListener("click", () => {
      const collapsed = appContainer.classList.toggle("preview-collapsed");
      dividerToggle.setAttribute("aria-expanded", String(!collapsed));
    });
    dividerToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        dividerToggle.click();
      }
    });
    dividerToggle.click(); // 初期状態を collapsed に
  }

  // ===== MediaPipeフレーム更新 =====
  window.addEventListener("mp:eye_frame", (e) => {
    const { ts, count, eye } = e.detail || {};
    if (!eye) return;

    if (calib?.openBaseline?.avg && calib?.closedBaseline?.avg) {
      const ratio = computeEyeOpenRatio(eye).avg;
      const closedV = calib.closedBaseline.avg || 1e-6;
      const openV   = calib.openBaseline.avg  || (closedV + 1e-6);
      let norm = (ratio - closedV) / (openV - closedV);
      if (!isFinite(norm)) norm = 0;

      const openPctRaw = clamp(norm * 100, 0, 130);
      const alpha = 0.25;
      emaOpen = (emaOpen == null) ? openPctRaw : alpha * openPctRaw + (1 - alpha) * emaOpen;

      // 既存 DataAnalyzer（開閉率）にフィード
      analyzer.add(emaOpen);

      if (openInfo) openInfo.textContent = `Open: ${Math.round(emaOpen)}%`;
      if (closedInfo) {
        const isClosed = emaOpen < 20;
        closedInfo.setAttribute("aria-hidden", isClosed ? "false" : "true");
      }

      // 保存用: UI 表示と一致する正規化系列を記録（timestamp + EMA + raw% + norm）
      try {
        window.__normalizedOpenSeries = window.__normalizedOpenSeries || [];
        window.__normalizedOpenSeries.push({
          ts: ts || Date.now(),
          ema: Number((emaOpen || 0).toFixed(2)),
          rawOpenPct: Number((openPctRaw || 0).toFixed(2)),
          norm: Number((norm || 0).toFixed(4))
        });
      } catch (e) {
        console.debug('[Main] failed to push normalized open series', e);
      }
    }

    if (coordLog) {
      coordLog.textContent = eye.map((p) => `#${p.idx}\tx:${p.x}\ty:${p.y}\tz:${p.z}`).join("\n");
      coordLog.scrollTop = coordLog.scrollHeight;
    }

    if (frameInfo) {
      const t = new Date(ts);
      frameInfo.textContent = `pts:${count} | ${t.toLocaleTimeString()}`;
    }
  });

  window.addEventListener("mp:clear", () => {
    emaOpen = null;
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo)  openInfo.textContent = "Open: —%";
    if (closedInfo) closedInfo.setAttribute("aria-hidden", "true");
  });

function renderFinalResults(panel, gazeRes) {
  if (!panel || !gazeRes) return;
  let box = document.getElementById("finalResultsBox");
  if (!box) {
    box = document.createElement("section");
    box.id = "finalResultsBox";
    box.style.marginTop = "12px";
    box.style.padding = "10px";
    box.style.borderTop = "1px solid #ddd";
    box.style.background = "rgba(255,255,255,0.6)";
    const coordLog = panel.querySelector("#coordLog");
    if (coordLog?.parentNode) {
      coordLog.parentNode.insertBefore(box, coordLog);
    } else {
      panel.appendChild(box);
    }
  }
  const L = Math.max(0, Math.min(100, Math.round(gazeRes.left  ?? 0)));
  // prefer emotion-based labels (joy/sad) if present
  const J = Math.max(0, Math.min(100, Math.round(gazeRes.joy  ?? (gazeRes.left ?? 0))));
  const S = Math.max(0, Math.min(100, Math.round(gazeRes.sad  ?? (gazeRes.right ?? 0))));
  const N = Math.max(0, Math.min(100, Math.round(gazeRes.none  ?? 0)));
  const dur = Math.max(0, gazeRes.durationSec ?? 0);
  const tot = Math.max(0, gazeRes.samplesTotal ?? 0);
  box.innerHTML = `
    <h4 style="margin:0 0 6px;">最終結果</h4>
    <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:baseline;">
      <div>joy: <b>${J}%</b>　sad: <b>${S}%</b>　領域外: <b>${N}%</b></div>
      <small style="opacity:.8">計測 ${dur}s・samples:${tot}</small>
    </div>
  `;
}



  // ===== Utility =====
  function setBtnState(running) {
    // if (btnToggle) {
    //   btnToggle.textContent = running ? "Stop" : "Start";
    //   btnToggle.classList.toggle("active", running);
    // }
    if (btnStart) btnStart.disabled = running;
    if (btnStop)  btnStop.disabled  = !running;
  }
  function clamp(x, min = 0, max = 1) {
    return Math.max(min, Math.min(max, x));
  }

  // ===== 追加: 視線割合の集計ロジック =====
  function setupGazeAggregation(){
    // 初期化
    // track counts by emotion (joy/sad) instead of absolute left/right
    gazeCounts = { joy: 0, sad: 0, oob: 0, totalIn: 0 };
    pairMappingHistory = [];
    currentPairJoySide = 'left';
    gazeStartedAt = performance.now();

    // キャリブ側が dispatch しているイベントを購読（detail.ux を使用）
    // in-bounds: detail.ux [0..1]（0.5未満=左、以上=右）
    onGazeIn = (ev) => {
      const ux = ev?.detail?.ux;
      if (typeof ux !== "number") return;
      if (!gazeCounts) { console.debug('[Main] onGazeIn called but gazeCounts is null'); return; }
      // determine which side user is looking at now
      const gazeSide = (ux < 0.5) ? 'left' : 'right';
      // map side to emotion based on currentPairJoySide
      if (gazeSide === currentPairJoySide) {
        gazeCounts.joy += 1;
      } else {
        gazeCounts.sad += 1;
      }
      gazeCounts.totalIn += 1;
      // console.debug("[Gaze] in ux=", ux.toFixed(3), 'mappedTo', (gazeSide===currentPairJoySide?'joy':'sad'));
    };
    onGazeOOB = () => {
      if (!gazeCounts) { console.debug('[Main] onGazeOOB called but gazeCounts is null'); return; }
      gazeCounts.oob += 1;
      // console.debug("[Gaze] out-of-bounds");
    };

    window.addEventListener("gaze:in_bounds", onGazeIn);
    window.addEventListener("gaze:out_of_bounds", onGazeOOB);

    console.debug("[Main] 視線割合集計を開始");
  }

  function teardownGazeAggregation(){
    if (onGazeIn)  window.removeEventListener("gaze:in_bounds", onGazeIn);
    if (onGazeOOB) window.removeEventListener("gaze:out_of_bounds", onGazeOOB);
    const durMs = performance.now() - gazeStartedAt;

    const joyCount  = gazeCounts?.joy  || 0;
    const sadCount  = gazeCounts?.sad  || 0;
    const noneCount = gazeCounts?.oob  || 0;     // ← 見てない（out of bounds）
    const inCount   = gazeCounts?.totalIn || 0;

    const totalSamples = joyCount + sadCount + noneCount;
    const denom = Math.max(1, totalSamples);

    const pJoy = Math.round((joyCount / denom) * 100);
    const pSad = Math.round((sadCount / denom) * 100);
    const pN = Math.round((noneCount / denom) * 100);

    const result = {
      // 割合（合計≒100%）
      joy: pJoy,
      sad: pSad,
      none: pN,
      // 生のカウント
      joyCount,
      sadCount,
      noneCount,
      // 参考情報
      samplesIn: inCount,
      samplesTotal: totalSamples,
      durationSec: Math.round(durMs / 1000),
      // mapping history for later analysis: sequence of which side held joy
      mappingHistory: Array.isArray(pairMappingHistory) ? pairMappingHistory.slice() : []
    };

    console.debug("[Main] 視線割合集計結果:", result);

    onGazeIn = null; onGazeOOB = null; gazeCounts = null; currentPairJoySide = 'left'; pairMappingHistory = [];
    return result;
  }


  // アンケート表示（agentOverlay 内，agentOverlayContainer の横・agentOverlayChat の下に表示）
  // id: 任意の識別子, title: 見出し, prompt: 質問文, leftLabel/rightLabel: スライダー端ラベル
  function showSurveyQuestion(id, title, prompt, leftLabel, rightLabel) {
    return new Promise((resolve) => {
      try {
        const overlay = document.getElementById('agentOverlay');
        if (!overlay) { resolve(null); return; }

        // remove existing survey
        const prev = document.getElementById('agentSurveyWrapper');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

        const chat = overlay.querySelector('#agentOverlayChat');
        const container = overlay.querySelector('#agentOverlayContainer');

        const wrapper = document.createElement('div');
        wrapper.id = 'agentSurveyWrapper';
        wrapper.style.position = 'absolute';
        wrapper.style.zIndex = 20200;
        wrapper.style.pointerEvents = 'auto';
        wrapper.style.background = 'rgba(255,255,255,0.95)';
        wrapper.style.color = '#111';
        wrapper.style.borderRadius = '10px';
        wrapper.style.padding = '12px';
        wrapper.style.boxShadow = '0 8px 30px rgba(0,0,0,0.25)';
        // ensure a sensible minimum width so the survey UI remains legible
        wrapper.style.minWidth = '500px';
        wrapper.style.maxWidth = '42vw';
        wrapper.style.fontFamily = 'sans-serif';
        wrapper.style.fontSize = '20px';

        // position: prefer under chat, otherwise to the right of container
        const place = () => {
          let left = null, top = null;
          if (chat) {
            const r = chat.getBoundingClientRect();
            left = r.left + window.scrollX;
            top = r.bottom + window.scrollY + 8;
            // ensure it doesn't overflow right edge
            if (left + wrapper.offsetWidth > window.innerWidth - 8) {
              left = window.innerWidth - wrapper.offsetWidth - 8;
            }
          } else if (container) {
            const rc = container.getBoundingClientRect();
            left = rc.right + window.scrollX + 12;
            top = (rc.top + rc.height/2) + window.scrollY - wrapper.offsetHeight/2;
            if (left + wrapper.offsetWidth > window.innerWidth - 8) left = window.innerWidth - wrapper.offsetWidth - 8;
          } else {
            left = Math.max(8, window.innerWidth - wrapper.offsetWidth - (window.innerWidth * 0.06));
            top = window.innerHeight/2 - wrapper.offsetHeight/2 + window.scrollY;
          }
          wrapper.style.left = (left !== null ? `${left}px` : 'auto');
          wrapper.style.top  = (top  !== null ? `${top}px`  : '50%');
        };

        wrapper.innerHTML = `
          <div style="font-weight:700; margin-bottom:6px; font-size:16px;">${title}</div>
          <div style="font-size:20px; margin-bottom:8px; white-space:pre-wrap;">${prompt}</div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span style="font-size:15px; width:48px; text-align:left;">${leftLabel}</span>
            <input id="agentSurveyRange" type="range" min="1" max="9" step="1" value="5" style="flex:1;">
            <span style="font-size:15px; width:48px; text-align:right;">${rightLabel}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <small id="agentSurveyValue" style="opacity:.85">選択値: 5</small>
            <button id="agentSurveySubmit" style="padding:8px 12px; background:#3366ff; color:#fff; border:none; border-radius:8px; cursor:pointer;">送信</button>
          </div>
        `;
        overlay.appendChild(wrapper);

        // ensure layout computed before placing
        requestAnimationFrame(() => {
          place();
        });

        const range = wrapper.querySelector('#agentSurveyRange');
        const valEl = wrapper.querySelector('#agentSurveyValue');
        const submit = wrapper.querySelector('#agentSurveySubmit');

        const onChange = () => { valEl.textContent = `選択値: ${range.value}`; };
        range.addEventListener('input', onChange);

        const cleanup = (v) => {
          try { range.removeEventListener('input', onChange); } catch(e){}
          try { if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); } catch(e){}
          resolve(Number(v));
        };

        submit.addEventListener('click', () => cleanup(range.value), { once: true });

        // allow Enter key on wrapper to submit
        wrapper.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); cleanup(range.value); }
        });

        // focus for keyboard
        range.focus();
        // reposition on resize/scroll
        const onWin = () => { try { place(); } catch(e){} };
        window.addEventListener('resize', onWin);
        window.addEventListener('scroll', onWin);
        // remove listeners when resolved
        const originalResolve = resolve;
        resolve = (v) => {
          window.removeEventListener('resize', onWin);
          window.removeEventListener('scroll', onWin);
          originalResolve(v);
        };
      } catch (e) {
        console.debug('[Main] showSurveyQuestion failed', e);
        resolve(null);
      }
    });
  }

  // アンケート結果をローカルに保存（他の Gaze と同様の命名規則）
  function saveSurveyResults(obj, tag = 'survey') {
    try {
      // attach group info
      try { obj.group = window.__participantGroup || null; } catch(e){}
      // attach participant metadata if available
      try { obj.gender = window.__participantGender || null; } catch(e){}
      try { obj.age = window.__participantAge || null; } catch(e){}
      try { obj.consent = (typeof window !== 'undefined' && window.__participantConsent) ? window.__participantConsent : null; } catch(e){}
      const base = participantNameSafe || 'participant';
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const groupPart = (window.__participantGroup) ? `${window.__participantGroup}` : 'group';
      const filename = `${base}_${tag}_${groupPart}_${ts}.json`;
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); } catch(e){} }, 1000);
      console.debug('[Main] saved survey file', filename);
    } catch (e) {
      console.debug('[Main] saveSurveyResults failed', e);
    }
  }
});
