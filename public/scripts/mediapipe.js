import {
  FilesetResolver,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import { BACKEND_URL, EYE_LANDMARKS } from "./config.js";

let collecting = false;
let startTime = 0;
let collectedData = [];
let currentQuestionIndex = 0;
let currentSpeaker = "user"; // "user" or "agent"
let currentPhase = "question"; // "question", "answer", "reaction", "advice"

export function startCollecting(questionIndex, speakerType, phase) {
  startTime = performance.now();
  collecting = true;
  currentQuestionIndex = questionIndex;
  currentSpeaker = speakerType;
  currentPhase = phase;
}

export function stopCollecting() {
  collecting = false;
  if (collectedData.length > 0) {
    console.log("Collected data:", collectedData);
  } else {
    console.warn("No data collected.");
  }
}

function logDebug(message, ...args) {
  console.log("[MediaPipe]", message, ...args);
}

let faceLandmarker;
let videoElement;

async function setupCamera() {
  videoElement = document.createElement('video');
  videoElement.style.display = 'none';
  videoElement.setAttribute('autoplay', true);
  document.body.appendChild(videoElement);  

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  videoElement.srcObject = stream;
  return new Promise((resolve) => {
    videoElement.onloadedmetadata = () => {
      resolve();
    };
  });
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
  logDebug("FaceLandmarker初期化成功");
}

function predict() {
  if (!faceLandmarker) {
    logDebug("FaceLandmarker未初期化");
    requestAnimationFrame(predict);
    return;
  }
  if (!collecting) {
    requestAnimationFrame(predict);
    return;
  }
  const now = Date.now();
  const result = faceLandmarker.detectForVideo(videoElement, now);
  // logDebug("顔ランドマーク検出結果:", result);

  if (result.faceLandmarks && result.faceLandmarks.length > 0) {
    for (const landmarks of result.faceLandmarks) {
      // 目のランドマークのみ抽出
      const eyeLandmarks = EYE_LANDMARKS.map(idx => landmarks[idx]);
      // データ収集
      const elapsed = performance.now() - startTime;
      collectedData.push({
        elapsed,
        questionIndex: currentQuestionIndex,
        speakerType: currentSpeaker,
        phase: currentPhase,
        eyeLandmarks
      });
    }
  }
  requestAnimationFrame(predict);
}

export async function sendEyeLandmarkData() {
  logDebug("目のランドマークデータ送信:", collectedData);
  const sessionId = localStorage.getItem("session_id");
  if (!sessionId) {
    console.warn("[MediaPipe] session_idが取得できません。データ送信をスキップします。");
    return;
  }
  try {
    const response = await fetch(`${BACKEND_URL}/api/eye-landmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        data: collectedData
      })
    });
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }
    logDebug("データ送信成功", collectedData.length, "件");
  } catch (e) {
    console.error("[MediaPipe] データ送信エラー:", e);
  }
}

export async function mediapipeInit() {
  await setupCamera();
  await initFaceLandmarker();
  // 一度推論を走らせてフレームを準備
  if(faceLandmarker){
    faceLandmarker.detectForVideo(videoElement, Date.now());
  }
  predict();
}

// ページロード時に初期化
window.addEventListener("DOMContentLoaded", () => {
  mediapipeInit();
});