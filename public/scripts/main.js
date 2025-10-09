// public/scripts/main.js
// ========================================================
// Start/Stop 兼用ボタン + トグル開閉 + MediaPipe/キャリブ制御
// 既存の agent.js（左右2体）をそのまま利用
// ========================================================

import { Agents } from "./agent.js";
import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopMediaPipeAll,
} from "./mediapipe.js";
import { runCalibration, computeEyeOpenRatio } from "./calibration.js";

document.addEventListener("DOMContentLoaded", () => {
  // --- DOM参照 ---
  const btnToggle = document.getElementById("btnToggle");
  const dividerToggle = document.getElementById("dividerToggle");
  const appContainer = document.getElementById("app");

  const coordLog = document.getElementById("coordLog");
  const frameInfo = document.getElementById("frameInfo");
  const openInfo = document.getElementById("openInfo");
  const closedInfo = document.getElementById("closedInfo");

  // --- 状態 ---
  let isRunning = false;
  let calib = null;      // キャリブ結果
  let emaOpen = null;    // 開眼率のEMA

  // ======================================================
  // Start / Stop 兼用ボタン
  // ======================================================
  if (btnToggle) {
    btnToggle.addEventListener("click", async () => {
      if (!isRunning) {
        // ---------- Start ----------
        isRunning = true;
        setBtnState(btnToggle, true);

        try {
          await mediapipeInitAndStart();     // MediaPipe初期化＋開始
          calib = await runCalibration();    // キャリブ
          Agents.startSpeak();               // 口パク開始
        } catch (e) {
          console.error("[Main] 起動エラー:", e);
          alert("MediaPipeまたはカメラの初期化に失敗しました。");
          isRunning = false;
          setBtnState(btnToggle, false);
        }
      } else {
        // ---------- Stop ----------
        isRunning = false;
        setBtnState(btnToggle, false);

        try {
          await sendEyeLandmarkData();       // 取得データの保存要求（失敗しても致命ではない）
        } catch (e) {
          console.warn("[Main] 保存スキップ:", e);
        }

        try {
          await stopMediaPipeAll();          // MediaPipe完全停止
        } finally {
          Agents.stopSpeak();                // 口パク停止
        }

        // UIリセット
        emaOpen = null;
        if (coordLog) coordLog.textContent = "";
        if (frameInfo) frameInfo.textContent = "—";
        if (openInfo) openInfo.textContent = "Open: —%";
        if (closedInfo) closedInfo.setAttribute("aria-hidden", "true");
      }
    });
  }

  // ======================================================
  // トグル（下段のプレビュー＋データを開閉）
  // CSS 側は #app.preview-collapsed { --bottomH:0vh; } を想定
  // ======================================================
  if (dividerToggle && appContainer) {
    // 初期 aria (開いている= true)
    dividerToggle.setAttribute("aria-expanded", "true");

    dividerToggle.addEventListener("click", () => {
      const collapsed = appContainer.classList.toggle("preview-collapsed");
      // collapsed=true -> 閉じた なので aria-expanded=false
      dividerToggle.setAttribute("aria-expanded", String(!collapsed));
    });

    // キーボード操作（Enter/Space）対応
    dividerToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        dividerToggle.click();
      }
    });
  }

  // ======================================================
  // MediaPipe の1フレーム更新（カスタムイベント mp:eye_frame）
  // mediapipe.js 側が e.detail = { ts, count, eye } を投げる想定
  // ======================================================
  window.addEventListener("mp:eye_frame", (e) => {
    const { ts, count, eye } = e.detail || {};
    if (!eye) return;

    // --- 開眼率 ---
    if (calib?.openBaseline?.avg && calib?.closedBaseline?.avg) {
      const ratio = computeEyeOpenRatio(eye).avg;

      const closedV = calib.closedBaseline.avg || 1e-6;
      const openV   = calib.openBaseline.avg   || (closedV + 1e-6);
      let norm = (ratio - closedV) / (openV - closedV);
      if (!isFinite(norm)) norm = 0;

      const openPctRaw = clamp(norm * 100, 0, 130);
      const alpha = 0.25; // EMAスムージング係数
      emaOpen = (emaOpen == null) ? openPctRaw : alpha * openPctRaw + (1 - alpha) * emaOpen;

      if (openInfo) openInfo.textContent = `Open: ${Math.round(emaOpen)}%`;
      if (closedInfo) {
        const isClosed = emaOpen < 20;
        closedInfo.setAttribute("aria-hidden", isClosed ? "false" : "true");
      }
    }

    // --- 座標ログ ---
    if (coordLog) {
      coordLog.textContent = eye.map((p) => `#${p.idx}\tx:${p.x}\ty:${p.y}\tz:${p.z}`).join("\n");
      coordLog.scrollTop = coordLog.scrollHeight;
    }

    // --- フレーム情報 ---
    if (frameInfo) {
      const t = new Date(ts);
      frameInfo.textContent = `pts:${count} | ${t.toLocaleTimeString()}`;
    }
  });

  // MediaPipe側からのクリア通知（任意）
  window.addEventListener("mp:clear", () => {
    emaOpen = null;
    if (coordLog) coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo) openInfo.textContent = "Open: —%";
    if (closedInfo) closedInfo.setAttribute("aria-hidden", "true");
  });
});

// ========================================================
// 小物
// ========================================================
function setBtnState(btn, running) {
  if (!btn) return;
  if (running) {
    btn.textContent = "Stop";
    btn.classList.add("active");
  } else {
    btn.textContent = "Start";
    btn.classList.remove("active");
  }
}
function clamp(x, min = 0, max = 1) {
  return Math.max(min, Math.min(max, x));
}
