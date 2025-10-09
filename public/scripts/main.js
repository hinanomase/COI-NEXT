// public/scripts/main.js
// ========================================================
// Start→キャリブ完了まではエージェント非表示 / 完了後に表示
// 10秒経過 or Stop押下 で終了（非表示）
// 口パク機能なし。既存構成を変えずにCanvas表示のみ制御。
// ========================================================

import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopMediaPipeAll,
} from "./mediapipe.js";
import { runCalibration, computeEyeOpenRatio } from "./calibration.js";
import { DataAnalyzer } from "./dataAnalyzer.js"; 

document.addEventListener("DOMContentLoaded", () => {
  // ===== DOM参照 =====
  const appContainer = document.getElementById("app");
  const dividerToggle = document.getElementById("dividerToggle");

  const btnToggle =
    document.getElementById("btnToggle") ||
    document.getElementById("btnToggleStartStop");
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


  // ===== 状態 =====
  let isRunning = false;
  let calib = null;
  let emaOpen = null;
  let autoStopTimer = null; // ← 自動停止用タイマーID

  // ===== エージェントの表示/非表示 =====
  const hideAgents = () => {
    if (canvas1) canvas1.style.display = "none";
    if (canvas2) canvas2.style.display = "none";
  };
  const showAgents = () => {
    if (canvas1) canvas1.style.display = "block";
    if (canvas2) canvas2.style.display = "block";
  };

  // 初期状態：非表示
  hideAgents();
  // btnToggle.style.display = 'none';

  // ===== Start / Stop =====
  const handleStart = async () => {
    if (isRunning) return;
    isRunning = true;
    setBtnState(true);
    btnToggle.style.display = 'none';
    hideAgents();

    try {
      console.log("[Main] Start → MediaPipe初期化");
      await mediapipeInitAndStart();

      console.log("[Main] キャリブレーション開始");
      calib = await runCalibration();

      analyzer.reset();

      console.log("[Main] キャリブレーション完了 → エージェント表示");
      showAgents();

      // 10秒後に自動停止
      if (autoStopTimer) clearTimeout(autoStopTimer);
      autoStopTimer = setTimeout(() => {
        console.log("[Main] 10秒経過 → 自動停止実行");
        handleStop();
      }, 10000);

    } catch (e) {
      console.error("[Main] Startフロー失敗:", e);
      alert("キャリブレーションまたは初期化に失敗しました。");
      isRunning = false;
      setBtnState(false);
      hideAgents();
    }
  };

  const handleStop = async () => {
    if (!isRunning) return;
    isRunning = false;
    setBtnState(false);

    console.log("[Main] Stop → 停止処理開始");

    // タイマー解除
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }

    try { await sendEyeLandmarkData(); } catch {}
    try { await stopMediaPipeAll(); } catch {}

    hideAgents();

    analyzer.renderToPanel(dataPanel); 

    emaOpen = null;
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo)  openInfo.textContent = "Open: —%";
    if (closedInfo) closedInfo.setAttribute("aria-hidden", "true");

    console.log("[Main] 停止処理完了");
  };

  // ===== ボタン配線 =====
  if (btnToggle) {
    btnToggle.addEventListener("click", async () => {
      if (!isRunning) await handleStart();
      else await handleStop();
    });
  }
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
      analyzer.add(emaOpen);

      
      if (openInfo) openInfo.textContent = `Open: ${Math.round(emaOpen)}%`;
      if (dataPanel) {
        const isClosed = emaOpen < 20;
        dataPanel.classList.toggle('eyes-closed', isClosed);
        // Keep aria-hidden on the badge for screen readers as well
        if (closedInfo) closedInfo.setAttribute("aria-hidden", isClosed ? "false" : "true");
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

  // ===== Utility =====
  function setBtnState(running) {
    if (btnToggle) {
      btnToggle.textContent = running ? "Stop" : "Start";
      btnToggle.classList.toggle("active", running);
    }
    if (btnStart) btnStart.disabled = running;
    if (btnStop)  btnStop.disabled  = !running;
  }
  function clamp(x, min = 0, max = 1) {
    return Math.max(min, Math.min(max, x));
  }
});
