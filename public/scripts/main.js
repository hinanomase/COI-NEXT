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

  // ===== 追加: 視線集計用の状態 =====
  let gazeStartedAt = 0;
  let gazeCounts = null;
  let onGazeIn = null;
  let onGazeOOB = null;

  // ===== 状態 =====
  let isRunning = false;
  let calib = null;
  let emaOpen = null;
  let autoStopTimer = null; // ← 自動停止用タイマーID

  // Service Worker 登録（PWA） — DOMContentLoaded の中に置く
  // if ('serviceWorker' in navigator) {
  //   // service-worker.js is served from /public/, so the registration scope must be within /public/
  //   navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
  //     .then(reg => {
  //       console.log('ServiceWorker registered (scope: ' + reg.scope + ')');

  //       // 更新を検知してユーザーに通知するサンプル（任意）
  //       reg.addEventListener('updatefound', () => {
  //         const newSW = reg.installing;
  //         newSW.addEventListener('statechange', () => {
  //           if (newSW.state === 'installed') {
  //             // 新しいコンテンツがキャッシュされ、次回ロード時に使われます
  //             if (navigator.serviceWorker.controller) {
  //               console.log('New content available - please refresh.');
  //               // ここで UI を出して「更新」ボタンを促すなどの処理を入れる
  //             } else {
  //               console.log('Content cached for offline use.');
  //             }
  //           }
  //         });
  //       });
  //     })
  //     .catch(err => console.warn('ServiceWorker registration failed:', err));
  // }

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

      // === 視線割合の集計を開始（キャリブ完了後〜Stopまで） ===
      setupGazeAggregation();

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
      teardownGazeAggregation(); // 念のため
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

  
    // 既存の開閉統計を先に描画
    analyzer.renderToPanel(dataPanel);

    const gazeResult = (typeof teardownGazeAggregation === "function")
      ? teardownGazeAggregation()           // 直前までの集計関数がある場合
      : (window.__lastGazeResult || {left:0,right:0,durationSec:0,samplesIn:0,oobSamples:0});
    renderFinalResults(dataPanel, gazeResult);


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
  const R = Math.max(0, Math.min(100, Math.round(gazeRes.right ?? 0)));
  const N = Math.max(0, Math.min(100, Math.round(gazeRes.none  ?? 0)));
  const dur = Math.max(0, gazeRes.durationSec ?? 0);
  const tot = Math.max(0, gazeRes.samplesTotal ?? 0);

  box.innerHTML = `
    <h4 style="margin:0 0 6px;">最終結果</h4>
    <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:baseline;">
      <div>左: <b>${L}%</b>　右: <b>${R}%</b>　領域外: <b>${N}%</b></div>
      <small style="opacity:.8">計測 ${dur}s・samples:${tot}</small>
    </div>
  `;
}



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

  // ===== 追加: 視線割合の集計ロジック =====
  function setupGazeAggregation(){
    // 初期化
    gazeCounts = { left: 0, right: 0, oob: 0, totalIn: 0 };
    gazeStartedAt = performance.now();

    // キャリブ側が dispatch しているイベントを購読（detail.ux を使用）
    // in-bounds: detail.ux [0..1]（0.5未満=左、以上=右）
    onGazeIn = (ev) => {
      const ux = ev?.detail?.ux;
      if (typeof ux !== "number") return;
      if (ux < 0.5) gazeCounts.left += 1;
      else          gazeCounts.right += 1;
      gazeCounts.totalIn += 1;
      // console.debug("[Gaze] in ux=", ux.toFixed(3));
    };
    onGazeOOB = () => {
      gazeCounts.oob += 1;
      // console.debug("[Gaze] out-of-bounds");
    };

    window.addEventListener("gaze:in_bounds", onGazeIn);
    window.addEventListener("gaze:out_of_bounds", onGazeOOB);

    console.log("[Main] 視線割合集計を開始");
  }

  function teardownGazeAggregation(){
    if (onGazeIn)  window.removeEventListener("gaze:in_bounds", onGazeIn);
    if (onGazeOOB) window.removeEventListener("gaze:out_of_bounds", onGazeOOB);
    const durMs = performance.now() - gazeStartedAt;

    const leftCount  = gazeCounts?.left  || 0;
    const rightCount = gazeCounts?.right || 0;
    const noneCount  = gazeCounts?.oob   || 0;     // ← 見てない（out of bounds）
    const inCount    = gazeCounts?.totalIn || 0;

    const totalSamples = leftCount + rightCount + noneCount;
    const denom = Math.max(1, totalSamples);       // 0割回避

    const pL = Math.round((leftCount  / denom) * 100);
    const pR = Math.round((rightCount / denom) * 100);
    const pN = Math.round((noneCount  / denom) * 100);

    const result = {
      // 割合（合計≒100%）
      left: pL,
      right: pR,
      none: pN,
      // 素のカウントも残す
      leftCount,
      rightCount,
      noneCount,
      // 参考情報
      samplesIn: inCount,
      samplesTotal: totalSamples,
      durationSec: Math.round(durMs / 1000)
    };

    console.log("[Main] 視線割合集計結果:", result);

    onGazeIn = null; onGazeOOB = null; gazeCounts = null;
    return result;
  }


  
});
