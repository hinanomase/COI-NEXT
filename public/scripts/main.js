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
      img.onerror = () => { console.warn('[Main] failed to load image', s); };
      img.src = s;
    }

    // expose
    const ctrl = { setSrc, refresh: render, img };
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
    const c = __canvasControllers[canvasId]; if (c) c.setSrc(src); else console.warn('no canvas controller', canvasId);
  };

  // debug helpers: inspect sizes and force redraw from console
  window.debugCanvasInfo = () => {
    ['myCanvas1','myCanvas2'].forEach(id => {
      const canvas = document.getElementById(id);
      if (!canvas) { console.warn('no canvas', id); return; }
      const wrap = canvas.closest('.canvas-square');
      console.group(`canvas:${id}`);
      console.log('elementRect:', canvas.getBoundingClientRect());
      if (wrap) console.log('wrapperRect:', wrap.getBoundingClientRect());
      const cs = window.getComputedStyle(wrap || canvas);
      console.log('display:', cs.display, 'visibility:', cs.visibility, 'width/height:', cs.width, cs.height);
      console.groupEnd();
    });
    console.log('agent-row:', document.querySelector('.agent-row')?.getBoundingClientRect());
    console.log('topGrid:', document.getElementById('topGrid')?.getBoundingClientRect());
  };

  window.refreshCanvas = (canvasId) => {
    const c = __canvasControllers[canvasId]; if (c && typeof c.refresh === 'function') { c.refresh(); console.log('[Main] refreshed', canvasId); }
    else console.warn('no refreshable canvas controller for', canvasId);
  };

  // ===== 追加: 視線集計用の状態 =====
  let gazeStartedAt = 0;
  let gazeCounts = null;
  let onGazeIn = null;
  let onGazeOOB = null;
  // normalized openRatio series (ema used for display)
  window.__normalizedOpenSeries = window.__normalizedOpenSeries || [];

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
  const hideImages = () => {
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

  // ===== Start / Stop =====
  const handleStart = async () => {
    if (isRunning) return;
    isRunning = true;
    setBtnState(true);
    btnToggle.style.display = 'none';
    hideImages();

    try {
      console.log("[Main] Start → MediaPipe初期化");
      await mediapipeInitAndStart();

      console.log("[Main] キャリブレーション開始");
      calib = await runCalibration();

  analyzer.reset();
  // reset normalized series
  window.__normalizedOpenSeries = [];

      // === 視線割合の集計を開始（キャリブ完了後〜Stopまで） ===
      setupGazeAggregation();

      console.log("[Main] キャリブレーション完了 → エージェント表示");
      showImages();

        // Run 10 sets × 3s (total 30s). rotate paired images each set.
        // If user presses Stop early, this sequence will be cancelled.
        const TOTAL_SETS = 10;
        const SET_MS = 3000; // 3 seconds per set
        let currentSet = 0;
        let sequenceCancelled = false;

        // helper to set images for set index (1-based)
        function setPairForIndex(i) {
          const leftSrc = `assets/img/joy/joy (${i}).png`;
          const rightSrc = `assets/img/sad/sad (${i}).png`;
          if (leftImg) leftImg.setSrc(leftSrc);
          if (rightImg) rightImg.setSrc(rightSrc);
        }

  // wait a browser frame so canvases are laid out after showImages(), then set first pair
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  setPairForIndex(1);
  // force refresh in case the image was set while canvas sizing was not yet stable
  try { if (leftImg && typeof leftImg.refresh === 'function') leftImg.refresh(); } catch(e){}
  try { if (rightImg && typeof rightImg.refresh === 'function') rightImg.refresh(); } catch(e){}

        // schedule rotation across sets
        if (autoStopTimer) clearTimeout(autoStopTimer);
        autoStopTimer = setTimeout(function runNextSet() {
          currentSet += 1;
          if (sequenceCancelled || currentSet >= TOTAL_SETS) {
            // finished all sets (or cancelled by stop) -> call handleStop after a tiny delay to allow last-frame processing
            console.log('[Main] 全セット完了または中断: 終了処理へ移行');
            // allow UI to update then stop
            setTimeout(() => { handleStop(); }, 120);
            return;
          }
          const nextIndex = currentSet + 1; // next set is 1-based
          setPairForIndex(Math.min(nextIndex, TOTAL_SETS));
          autoStopTimer = setTimeout(runNextSet, SET_MS);
        }, SET_MS);

        // expose a flag that other handlers (handleStop) can use to cancel the sequence
        window.__sequenceCancel = () => { sequenceCancelled = true; if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; } };

    } catch (e) {
      console.error("[Main] Startフロー失敗:", e);
      alert("キャリブレーションまたは初期化に失敗しました。");
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

    console.log("[Main] Stop → 停止処理開始");

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
      console.warn('[Main] failed to produce open summary for saving', e);
      window.__lastOpenSummary = null;
    }

    try { await sendEyeLandmarkData(); } catch {}
    try { await stopMediaPipeAll(); } catch {}

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
        console.warn('[Main] failed to push normalized open series', e);
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
