// public/scripts/main.js
import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopCollecting,
  stopMediaPipeAll
} from "./mediapipe.js";

import { runCalibration, computeEyeOpenRatio } from "./calibration.js";

// agent.js は動的 import で安全に初期化
async function initAgentSafely(canvas) {
  try {
    const mod = await import("./agent.js");
    if (mod?.default) { const A = mod.default; const a = new A(canvas); if(a.init) await a.init(); if(a.start) a.start(); return; }
    if (mod?.Agent)    { const A = mod.Agent;   const a = new A(canvas); if(a.init) await a.init(); if(a.start) a.start(); return; }
    if (typeof mod?.initAgent === "function") { await mod.initAgent(canvas); return; }
  } catch(e){
    console.warn("[main] agent.js import 失敗。window.initAgent を探します。", e);
  }
  if (typeof window.initAgent === "function") await window.initAgent(canvas);
}

document.addEventListener("DOMContentLoaded", async () => {
  // エージェント初期化（失敗しても他は動く）
  const canvas = document.getElementById("myCanvas1");
  await initAgentSafely(canvas);

  const app      = document.getElementById("app");
  const btnStart = document.getElementById("btnStart");
  const btnStop  = document.getElementById("btnStop");
  const divider  = document.getElementById("dividerToggle");

  const frameInfo = document.getElementById("frameInfo");
  const openInfo  = document.getElementById("openInfo");
  const coordLog  = document.getElementById("coordLog");

  app.classList.remove("preview-collapsed");
  divider?.setAttribute("aria-expanded", "true");

  // === 状態 ===
  let calib = null;          // { openBaseline:{avg,...}, gaze:{sx,bx,yBias}, ts }
  let emaOpen = null;        // 開眼率表示の平滑化（指数移動平均）

  // Start：推論→キャリブ（測定は継続）
  btnStart.onclick = async () => {
    btnStart.disabled = true;
    btnStop.disabled  = false;
    try {
      await mediapipeInitAndStart();
      calib = await runCalibration();
    } catch (e) {
      console.error("[main] 起動/キャリブ失敗:", e);
      alert("起動またはキャリブに失敗しました。カメラ/権限をご確認ください。");
      btnStart.disabled = false;
      btnStop.disabled  = true;
    }
  };

  // Stop：完全停止（描画/イベント/プレビューも止める）
  btnStop.onclick = async () => {
    btnStop.disabled  = true;
    btnStart.disabled = false;
    stopCollecting();
    await sendEyeLandmarkData().catch(()=>{});
    await stopMediaPipeAll();
    if (coordLog) coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo) openInfo.textContent = "Open: —%";
    emaOpen = null;
  };

  // 仕切り（UIのみ畳む）
  const togglePreview = () => {
    const collapsed = app.classList.toggle("preview-collapsed");
    divider?.setAttribute("aria-expanded", String(!collapsed));
  };
  divider?.addEventListener("click", togglePreview);
  divider?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePreview(); }
  });

  // === 毎フレーム：座標と開眼率の表示 ===
  window.addEventListener("mp:eye_frame", (e) => {
    const { ts, count, eye } = e.detail;

    // 1) 開眼率（EAR / baseline）
    if (calib?.openBaseline?.avg) {
      const ratio = computeEyeOpenRatio(eye).avg;
      const openPctRaw = clamp((ratio / (calib.openBaseline.avg || 1e-6)) * 100, 0, 130);
      // EMAで平滑化
      const alpha = 0.25;
      emaOpen = (emaOpen == null) ? openPctRaw : (alpha*openPctRaw + (1-alpha)*emaOpen);
      if (openInfo) openInfo.textContent = `Open: ${Math.round(emaOpen)}%`;
    }

    // 2) データ表示（元のランドマーク一覧）
    const lines = eye.map(p => `#${p.idx}\tx:${p.x}\ty:${p.y}\tz:${p.z}`);
    if (coordLog) { coordLog.textContent = lines.join("\n"); coordLog.scrollTop = coordLog.scrollHeight; }
    if (frameInfo) frameInfo.textContent = `pts: ${count} | ${new Date(ts).toLocaleTimeString()}`;
  });

  // Stop時のUIクリア通知
  window.addEventListener("mp:clear", () => {
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
    if (openInfo)  openInfo.textContent  = "Open: —%";
    emaOpen = null;
  });
});

/* ===== helpers ===== */
function clamp(x,min=0,max=1){ return Math.max(min, Math.min(max, x)); }
