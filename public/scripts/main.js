// public/scripts/main.js
import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopMediaPipeAll
} from "./mediapipe.js";
import { runCalibration, computeEyeOpenRatio } from "./calibration.js";

document.addEventListener("DOMContentLoaded", async () => {
  const btnToggle = document.getElementById("btnToggle");
  const coordLog = document.getElementById("coordLog");
  const frameInfo = document.getElementById("frameInfo");
  const openInfo = document.getElementById("openInfo");
  const closedInfo = document.getElementById("closedInfo");

  let isRunning = false;
  let calib = null;
  let emaOpen = null;

  // ========= Start/Stop兼用 =========
  btnToggle.addEventListener("click", async () => {
    if (!isRunning) {
      // ---- Start ----
      btnToggle.textContent = "Stop";
      btnToggle.classList.add("active");
      isRunning = true;
      console.log("[Main] ▶ Start");

      try {
        await mediapipeInitAndStart(); // カメラ＋FaceLandmarker初期化
        calib = await runCalibration(); // キャリブレーション
      } catch (e) {
        console.error("[Main] 起動エラー:", e);
        alert("MediaPipeまたはカメラの初期化に失敗しました。");
        btnToggle.textContent = "Start";
        btnToggle.classList.remove("active");
        isRunning = false;
        return;
      }

    } else {
      // ---- Stop ----
      btnToggle.textContent = "Start";
      btnToggle.classList.remove("active");
      isRunning = false;
      console.log("[Main] ■ Stop");

      try {
        await sendEyeLandmarkData(); // データ保存
      } catch (e) {
        console.warn("[Main] 保存スキップ:", e);
      }

      await stopMediaPipeAll(); // MediaPipe完全停止

      // UIクリア
      if (coordLog) coordLog.textContent = "";
      if (frameInfo) frameInfo.textContent = "—";
      if (openInfo) openInfo.textContent = "Open: —%";
      emaOpen = null;
    }
  });

// ===== トグル制御 =====
const dividerToggle = document.getElementById("dividerToggle");
const appContainer = document.getElementById("app");

if (dividerToggle && appContainer) {
  dividerToggle.addEventListener("click", () => {
    appContainer.classList.toggle("preview-collapsed");
  });
}



  // ========= 毎フレーム：mp:eye_frame更新 =========
  window.addEventListener("mp:eye_frame", (e) => {
    const { ts, count, eye } = e.detail;

    if (calib?.openBaseline?.avg && calib?.closedBaseline?.avg) {
      const ratio = computeEyeOpenRatio(eye).avg;
      const closedV = calib.closedBaseline.avg || 1e-6;
      const openV = calib.openBaseline.avg || (closedV + 1e-6);
      let norm = (ratio - closedV) / (openV - closedV);
      if (!isFinite(norm)) norm = 0;
      const openPctRaw = clamp(norm * 100, 0, 130);
      const alpha = 0.25;
      emaOpen =
        emaOpen == null
          ? openPctRaw
          : alpha * openPctRaw + (1 - alpha) * emaOpen;
      if (openInfo)
        openInfo.textContent = `Open: ${Math.round(emaOpen)}%`;
      const closed = emaOpen != null && emaOpen < 20;
      closedInfo.setAttribute("aria-hidden", closed ? "false" : "true");
    }

    // 座標ログ出力
    const lines = eye.map(
      (p) => `#${p.idx}\tx:${p.x}\ty:${p.y}\tz:${p.z}`
    );
    if (coordLog) {
      coordLog.textContent = lines.join("\n");
      coordLog.scrollTop = coordLog.scrollHeight;
    }
    if (frameInfo)
      frameInfo.textContent = `pts:${count} | ${new Date(ts).toLocaleTimeString()}`;
  });

  // MediaPipe停止通知
  window.addEventListener("mp:clear", () => {
    if (coordLog) coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo) openInfo.textContent = "Open: —%";
    emaOpen = null;
  });
});

/* ==== ヘルパー ==== */
function clamp(x, min = 0, max = 1) {
  return Math.max(min, Math.min(max, x));
}


