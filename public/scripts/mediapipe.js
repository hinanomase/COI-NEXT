// public/scripts/mediapipe.js
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import { BACKEND_URL, EYE_LANDMARKS } from "./config.js";

let collecting = false;
let startTime = 0;
let collectedData = [];
let faceLandmarker;
let videoEl;

// ★ 追加：オーバーレイ用
let overlayCanvas, overlayCtx;
let renderW = 320, renderH = 240; // デフォルト（CSSと一致）

export async function mediapipeInitAndStart() {
  await setupCamera();
  await initFaceLandmarker();
  if (faceLandmarker) faceLandmarker.detectForVideo(videoEl, Date.now());
  startCollecting();
  predict();
}

function startCollecting() {
  collectedData = [];
  startTime = performance.now();
  collecting = true;
}

export function stopCollecting() {
  collecting = false;
}

async function setupCamera() {
  videoEl = document.getElementById("mpPreview");
  overlayCanvas = document.getElementById("mpOverlay");
  overlayCtx = overlayCanvas.getContext("2d");

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  videoEl.srcObject = stream;
  await videoEl.play();

  // 動的に実サイズを反映（メタデータ読み込み後に取得できる）
  const applySize = () => {
    const vw = videoEl.videoWidth || renderW;
    const vh = videoEl.videoHeight || renderH;
    // 表示はCSSでスケーリングしているので、内部解像度だけ合わせる
    overlayCanvas.width = vw;
    overlayCanvas.height = vh;
    renderW = vw;
    renderH = vh;
  };

  if (videoEl.readyState >= 2) {
    applySize();
  } else {
    videoEl.addEventListener("loadedmetadata", applySize, { once: true });
  }
}

async function initFaceLandmarker() {
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

function predict() {
  if (!faceLandmarker) {
    requestAnimationFrame(predict);
    return;
  }
  const now = Date.now();
  const result = faceLandmarker.detectForVideo(videoEl, now);

  // ★ 追加：毎フレームCanvasをクリア
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (result.faceLandmarks && result.faceLandmarks.length > 0) {
    const landmarks = result.faceLandmarks[0];

    // ★ 追加：目のランドマークを描画（点）
    drawEyeLandmarks(landmarks);

    if (collecting) {
      const eye = EYE_LANDMARKS.map(idx => landmarks[idx]);
      const elapsed = performance.now() - startTime;
      collectedData.push({ elapsed, eyeLandmarks: eye });
    }
  }

  requestAnimationFrame(predict);
}

// ★ 追加：目ランドマークを点で描画
function drawEyeLandmarks(landmarks) {
  overlayCtx.save();
  overlayCtx.lineWidth = 2;
  overlayCtx.globalAlpha = 0.95;

  // 目だけ強調（小さな円）
  overlayCtx.beginPath();
  for (const idx of EYE_LANDMARKS) {
    const p = landmarks[idx]; // {x,y,z}
    const x = p.x * overlayCanvas.width;
    const y = p.y * overlayCanvas.height;
    overlayCtx.moveTo(x + 2, y);
    overlayCtx.arc(x, y, 2, 0, Math.PI * 2);
  }
  overlayCtx.stroke(); // 色はデフォルト（CSSや環境依存）※色を指定したい場合は strokeStyle を設定
  overlayCtx.restore();

  // 任意：目の外周を軽く結ぶ（視認性アップ）
  // connectSequence(landmarks, [33, 160, 158, 133, 153, 145, 144, 33]);  // 左目 周辺
  // connectSequence(landmarks, [263, 387, 385, 362, 380, 374, 373, 263]); // 右目 周辺
}

function connectSequence(landmarks, seq) {
  overlayCtx.save();
  overlayCtx.beginPath();
  for (let i = 0; i < seq.length; i++) {
    const p = landmarks[seq[i]];
    const x = p.x * overlayCanvas.width;
    const y = p.y * overlayCanvas.height;
    if (i === 0) overlayCtx.moveTo(x, y);
    else overlayCtx.lineTo(x, y);
  }
  overlayCtx.stroke();
  overlayCtx.restore();
}

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

function getOrCreateSessionId() {
  let id = localStorage.getItem("session_id");
  if (!id) {
    id = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    localStorage.setItem("session_id", id);
  }
  return id;
}
