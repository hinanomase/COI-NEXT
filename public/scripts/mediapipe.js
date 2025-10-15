// public/scripts/mediapipe.js
import { BACKEND_URL, EYE_LANDMARKS } from "./config.js";
import {
  FilesetResolver,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

let collecting = false;     // データ収集フラグ
let running = false;        // 推論ループ稼働フラグ（Stopでfalseに）
let startTime = 0;
let collectedData = [];

let faceLandmarker;
let videoEl;
let overlayCanvas, overlayCtx;
let rafId = null;
let stream = null;

export async function mediapipeInitAndStart() {
  // 既存ストリームが止まっていたら再準備
  await setupCamera();
  await initFaceLandmarker();

  // 初回ウォームアップ
  if (faceLandmarker && videoEl?.readyState >= 2) {
    faceLandmarker.detectForVideo(videoEl, Date.now());
  }

  // フラグ類
  collectedData = [];
  startTime = performance.now();
  collecting = true;
  running = true;

  // ループ開始
  loop();
}

export function stopCollecting() {
  // 旧仕様の互換：収集のみ停止（プレビューは止めない）
  collecting = false;
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
export async function sendEyeLandmarkData() {
  const session_id = getOrCreateSessionId();
  try {
    const resp = await fetch(`${BACKEND_URL}/api/eye-landmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, data: collectedData })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log(`[MediaPipe] Saved ${collectedData.length} frames`);
  } catch (e) {
    console.error("[MediaPipe] Save failed", e);
  }
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
      delegate: "CPU"
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

    // 記録
    if (collecting) {
      const elapsed = performance.now() - startTime;
      collectedData.push({ elapsed, eyeLandmarks: EYE_LANDMARKS.map(i => landmarks[i]) });
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
