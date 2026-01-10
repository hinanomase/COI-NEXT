// public/scripts/mediapipe.js
import { BACKEND_URL, EYE_LANDMARKS } from "./config.js";
import { computeEyeOpenRatio, correctEyeArrayForGaze, correctGazePoint } from "./calibration.js";
import {
  FilesetResolver,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

let collecting = false;     // データ収集フラグ
let running = false;        // 推論ループ稼働フラグ（Stopでfalseに）
let startTime = 0;
// split storage: meta + per-frame eye landmarks (only EYE_LANDMARKS) + gaze points + open ratios
let collectedMeta = {};
let collectedEyeFrames = [];
let collectedGazeFrames = [];
// raw open ratios are not stored anymore; use normalizedOpenSeries (from main.js) instead
let collectedOpenRatios = null;
// backward-compatible container (some code may still reference collectedData)
let collectedData = null;

let faceLandmarker;
let videoEl;
let overlayCanvas, overlayCtx;
let rafId = null;
let stream = null;

export async function mediapipeInitAndStart() {
  console.debug("[MediaPipe] Initializing and starting MediaPipe face landmarking");
  // releaseAllAgentWebGLContexts(); // 古いコンテキストを破棄
  // await new Promise((resolve) => setTimeout(resolve, 250)); // 少し待つ
  // 既存ストリームが止まっていたら再準備
  try{
    await setupCamera();
    await initFaceLandmarker();
    console.debug("[MediaPipe] Camera and FaceLandmarker initialized");

    // 初回ウォームアップ
    if (faceLandmarker && videoEl?.readyState >= 2) {
      faceLandmarker.detectForVideo(videoEl, Date.now());
    }
    console.debug("[MediaPipe] Initial warmup done");
    // フラグ類
    // reset split storage
    collectedMeta = { startedAt: performance.now() };
    collectedEyeFrames = [];
    collectedGazeFrames = [];
    // collectedOpenRatios intentionally left null
    // compatibility: provide an alias array for collectedData that mirrors eyeFrames
    collectedData = collectedEyeFrames;
    startTime = performance.now();
    collecting = true;
    running = true;

    // ループ開始
    loop();
  } catch (e) {
    console.error("[MediaPipe] mediapipeInitAndStart failed", e);
    throw e;
  }
  console.debug("[MediaPipe] MediaPipe face landmarking started");
}

// allow main.js to align collection timing with normalizedOpenSeries start
export function resetCollectedData() {
  collectedMeta = { startedAt: performance.now() };
  collectedEyeFrames = [];
  collectedGazeFrames = [];
  collectedData = collectedEyeFrames;
}

export function stopCollecting() {
  // 旧仕様の互換：収集のみ停止（プレビューは止めない）
  collecting = false;
}

export function startCollecting() {
  collecting = true;
}

// lightweight pause/resume of processing (keeps camera stream alive but stops inference loop)
export function pauseProcessing() {
  running = false;
}

export function resumeProcessing() {
  if (running) return;
  running = true;
  // restart loop
  try { loop(); } catch(e) {}
}

/** ★完全停止：測定・イベント・プレビューすべて停止 */
export async function stopMediaPipeAll() {
  // 収集停止
  collecting = false;

  // ループ停止
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // オーバーレイ消去
  if (overlayCtx && overlayCanvas) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  // カメラ停止
  if (videoEl && videoEl.srcObject) {
    const tracks = videoEl.srcObject.getTracks();
    tracks.forEach(t => t.stop());
    videoEl.pause();
    videoEl.srcObject = null;
  }
  stream = null;

  // UI側にクリアを通知（座標パネル等を消すため）
  window.dispatchEvent(new CustomEvent("mp:clear"));
}

/** サーバ送信（必要に応じて） */
export async function sendEyeLandmarkData(options = {}) {
  try {
    // include participant group in saved filenames/meta if present
    const groupFromWindow = (typeof window !== 'undefined' && window.__participantGroup) ? window.__participantGroup : null;
    const group = options.group || groupFromWindow || null;
     const session_id = getOrCreateSessionId();
     const ts = Date.now();
     const name = options.name ? String(options.name) : null; // display name (can be Japanese)
     const nameSafe = options.nameSafe ? String(options.nameSafe) : null; // file-safe name
     const phase = options.phase ? String(options.phase) : null;
    const groupPart = group ? `_${group}` : '';
    const basePrefix = nameSafe ? `${nameSafe}${groupPart}` : (name ? `${encodeURIComponent(name)}${groupPart}` : `eye_capture_${session_id}${groupPart}`);
    const baseName = phase ? `${basePrefix}_${phase}_${ts}` : `${basePrefix}_${ts}`;
     // NOTE: meta is included in finalResults.json, so do not emit a separate meta JSON to avoid duplication
     // eye frames
    // ensure meta contains group
    try { if (!collectedMeta) collectedMeta = {}; collectedMeta.group = group || null; } catch(e){}
    // include participant metadata if available on window
    try { if (!collectedMeta) collectedMeta = {}; collectedMeta.participantGender = (typeof window !== 'undefined' && window.__participantGender) ? window.__participantGender : null; } catch(e){}
    try { if (!collectedMeta) collectedMeta = {}; collectedMeta.participantAge = (typeof window !== 'undefined' && window.__participantAge) ? window.__participantAge : null; } catch(e){}
    try { if (!collectedMeta) collectedMeta = {}; collectedMeta.participantConsent = (typeof window !== 'undefined' && window.__participantConsent) ? window.__participantConsent : null; } catch(e){}
     const eyeBlob = new Blob([JSON.stringify(collectedEyeFrames, null, 2)], { type: 'application/json' });
     downloadBlob(eyeBlob, `${baseName}_eyeFrames.json`);
     // gaze frames
     const gazeBlob = new Blob([JSON.stringify(collectedGazeFrames, null, 2)], { type: 'application/json' });
     downloadBlob(gazeBlob, `${baseName}_gazeFrames.json`);
     // NOTE: raw openRatios are no longer emitted; use normalizedOpenSeries.json instead

    // additional: normalized open series from main.js (if present)
    try {
      const norm = window.__normalizedOpenSeries || [];
      const normBlob = new Blob([JSON.stringify(norm, null, 2)], { type: 'application/json' });
      downloadBlob(normBlob, `${baseName}_normalizedOpenSeries.json`);
    } catch(e){}

    // additional: final combined results (open summary + gaze summary)
    // NOTE: normalizedOpenSeries and meta are NOT duplicated here (meta is included but meta.json not emitted separately)
    try {
      const openSummary = window.__lastOpenSummary || null;
      const gazeSummary = window.__lastGazeResult || null;
      // compose enriched meta: include canvas bounding rects and calibration/coef information if available
      const meta = Object.assign({}, collectedMeta || {});
      // also ensure final meta contains participant gender/age if available globally
      try { meta.participantGender = meta.participantGender || ((typeof window !== 'undefined' && window.__participantGender) ? window.__participantGender : null); } catch(e){}
      try { meta.participantAge = meta.participantAge || ((typeof window !== 'undefined' && window.__participantAge) ? window.__participantAge : null); } catch(e){}
      try { meta.participantConsent = meta.participantConsent || ((typeof window !== 'undefined' && window.__participantConsent) ? window.__participantConsent : null); } catch(e){}
  // add participant name/phase if provided
  if (name) meta.participant = name;
  if (phase) meta.phase = phase;
      try {
        const c1 = document.getElementById('myCanvas1');
        const c2 = document.getElementById('myCanvas2');
        const c3 = document.getElementById('myCanvas3');
        meta.canvasRects = {
          myCanvas1: c1 ? c1.getBoundingClientRect() : null,
          myCanvas2: c2 ? c2.getBoundingClientRect() : null,
          myCanvas3: c3 ? c3.getBoundingClientRect() : null
        };
      } catch(e){}
      try {
        // calibration baselines and gaze coeffs are exposed by main.js to window.__lastCalibration
        const lastCalib = window.__lastCalibration || null;
        if (lastCalib) {
          meta.calibration = {
            openBaseline: lastCalib.openBaseline || null,
            closedBaseline: lastCalib.closedBaseline || null,
            gazeCoeffs: lastCalib.gaze || null,
            ref: lastCalib.ref || null
          };
        } else {
          // fallback: try localStorage stored gaze coefficients
          try { const stored = JSON.parse(localStorage.getItem('gaze_calib_v1')); if (stored) meta.calibration = { gazeCoeffs: stored }; } catch(e){}
        }
      } catch(e){}

      const finalResults = { session_id, ts, meta, openSummary, gazeSummary };
      // include group in final results meta if available
      try { finalResults.meta = finalResults.meta || {}; if (group) finalResults.meta.group = group; } catch(e){}
     const finalBlob = new Blob([JSON.stringify(finalResults, null, 2)], { type: 'application/json' });
     downloadBlob(finalBlob, `${baseName}_finalResults.json`);
   } catch(e){}

  console.log(`[MediaPipe] Downloaded data files (eye:${collectedEyeFrames.length}, gaze:${collectedGazeFrames.length})`);
  } catch (e) {
    console.error('[MediaPipe] failed to save locally', e);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ===== 内部処理 ===== */

async function setupCamera() {
  videoEl = document.getElementById("mpPreview");
  overlayCanvas = document.getElementById("mpOverlay");
  overlayCtx = overlayCanvas.getContext("2d");

  // もし前回のストリームが残っていたら一旦止める
  if (videoEl?.srcObject) {
    try {
      videoEl.srcObject.getTracks().forEach(t => t.stop());
    } catch {}
    videoEl.srcObject = null;
  }

  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  videoEl.srcObject = stream;
  await videoEl.play();

  const applySize = () => {
    const vw = videoEl.videoWidth || 640;
    const vh = videoEl.videoHeight || 360;
    overlayCanvas.width = vw;
    overlayCanvas.height = vh;
  };
  if (videoEl.readyState >= 2) applySize();
  else videoEl.addEventListener("loadedmetadata", applySize, { once: true });
}

async function initFaceLandmarker() {
  if (faceLandmarker) return; // 1回だけロード
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task",
      delegate: "GPU"
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1
  });
  console.log("[MediaPipe] FaceLandmarker ready");
}

function loop() {
  if (!running) return;

  const now = Date.now();
  const result = faceLandmarker?.detectForVideo(videoEl, now);

  // 描画クリア
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (result?.faceLandmarks?.length > 0) {
    const landmarks = result.faceLandmarks[0];

    // 目ランドマークを描画
    drawEyeLandmarks(landmarks);

    // UI更新用イベント（目の座標のみ）
    const eye = EYE_LANDMARKS.map(idx => {
      const p = landmarks[idx];
      return { idx, x: +(p.x).toFixed(4), y: +(p.y).toFixed(4), z: +(p.z ?? 0).toFixed(4) };
    });
    // running が true の間だけ送信（Stop で止まる）
    window.dispatchEvent(new CustomEvent("mp:eye_frame", {
      detail: { ts: now, count: eye.length, eye }
    }));

    // compute open ratio per-frame from eye array (not full landmarks)
    let openRatio = null;
    try { openRatio = computeEyeOpenRatio(eye).avg; } catch (e) { openRatio = null; }

    // get gaze from last recorded gaze point if available (set by calibration.js)
    const lastGaze = window.__lastGazePoint || null;

    // Save only eye landmarks (subset) for lightweight storage
    const eyeOnly = EYE_LANDMARKS.map(i => ({ idx: i, x: +(landmarks[i].x).toFixed(4), y: +(landmarks[i].y).toFixed(4), z: +(landmarks[i].z ?? 0).toFixed(4) }));

    // compute corrected eye landmarks for storage (normalized into reference space)
    let correctedEyeForStorage = null;
    try {
      correctedEyeForStorage = correctEyeArrayForGaze(eyeOnly) || eyeOnly;
    } catch(e) { correctedEyeForStorage = eyeOnly; }

    // persist per-frame into separate arrays using corrected coordinates
    collectedEyeFrames.push({ ts: now, eye: correctedEyeForStorage });

    // for gaze frames, try to correct lastGaze (if available) into the same reference space
    let gazeToStore = null;
    try {
      if (lastGaze && lastGaze.px != null && lastGaze.py != null) {
        // lastGaze px/py are canvas pixels relative to myCanvas3; correct using eye landmarks
        const canvasEl = document.getElementById('myCanvas3');
        const corrected = correctGazePoint(lastGaze.px, lastGaze.py, eyeOnly, canvasEl);
        gazeToStore = { px: corrected.px, py: corrected.py, ux: corrected.px / (canvasEl ? canvasEl.width : 1), uy: corrected.py / (canvasEl ? canvasEl.height : 1) };
      } else {
        gazeToStore = lastGaze;
      }
    } catch(e) { gazeToStore = lastGaze; }

    collectedGazeFrames.push({ ts: now, gaze: gazeToStore });
  // raw openRatio intentionally not stored; normalized series from main.js is saved separately

    // 記録 フラグにより追加処理可能
    if (collecting) {
      // keep collectedMeta alive (e.g., session start ts)
      if (!collectedMeta.startedAt) collectedMeta.startedAt = startTime;
    }
  }

  rafId = requestAnimationFrame(loop);
}

function drawEyeLandmarks(landmarks) {
  if (!overlayCtx || !overlayCanvas) return;

  // Iris indices per MediaPipe
  const IRIS_SET = new Set([468, 469, 470, 471, 472, 473, 474, 475, 476, 477]);

  overlayCtx.save();
  overlayCtx.globalAlpha = 0.95;

  // point size scales with canvas short side
  const shortSide = Math.min(overlayCanvas.width, overlayCanvas.height) || 320;
  const pointSize = Math.max(1, Math.round(shortSide * 0.005));
  overlayCtx.lineWidth = Math.max(1, Math.round(pointSize / 2));

  const contourColor = "#00ff08ff"; // cyan-ish for eye contour
  const irisColor = "#ff03d5ff";    // amber for iris

  for (const idx of EYE_LANDMARKS) {
    const p = landmarks[idx];
    const x = Math.round(p.x * overlayCanvas.width);
    const y = Math.round(p.y * overlayCanvas.height);

    const color = IRIS_SET.has(idx) ? irisColor : contourColor;

    // draw each point individually so styles don't bleed between points
    overlayCtx.beginPath();
    overlayCtx.fillStyle = color;
    overlayCtx.strokeStyle = color; // match outline and fill
    const radius = Math.max(1, Math.round(pointSize / 2));
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.stroke();
  }

  overlayCtx.restore();
}

function getOrCreateSessionId() {
  let id = localStorage.getItem("session_id");
  if (!id) {
    id = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    localStorage.setItem("session_id", id);
  }
  return id;
}
