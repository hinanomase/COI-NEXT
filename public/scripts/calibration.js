/**
 * calibration.js
 *  - MediaPipe からの mp:eye_frame イベントを使い、特徴量を収集して
 *    3x3 グリッドで最小二乗フィッティングを行う（eye-tracking の移植版）。
 *  - キャリブ表示点は #myCanvas3 上に重ねて描画する。
 */

// const GRID = [
//   [0.15,0.15],[0.5,0.15],[0.85,0.15],
//   [0.15,0.5 ],[0.5,0.5 ],[0.85,0.5 ],
//   [0.15,0.85],[0.5,0.85],[0.85,0.85],
// ];
const GRID = [
  [0.05,0.05],[0.5,0.05],[0.95,0.05],
  [0.05,0.5 ],[0.5,0.5 ],[0.95,0.5 ],
  [0.05,0.95],[0.5,0.95],[0.95,0.95],
];

// === exported API ===
export async function runCalibration() {
  const canvas = document.getElementById("myCanvas3");
  const overlay = createAgentOverlay(canvas);
  // build the UI inside the agent overlay wrapper so it appears on top of myCanvas3
  const overlayWrapper = document.getElementById('agentCalibOverlay') || canvas;
  const ui = buildOverlayUI(overlayWrapper); // place guide panel on myCanvas3 overlay

  try {
  // ========= 1) 開眼ベースライン（3秒） =========
  // setStep(ui, "自然に目を開けて表示される青い点を見てください", "");
  // overlay.place(0.5, 0.5);
  // await sleep(350);
  // const openSamples = await sampleEyeMetrics(3000);
  // const openBaseline = summarizeOpenBaseline(openSamples); // EARの分位トリム
  // overlay.hide();

  // ========= 1b) 閉眼ベースライン（改良フロー） =========
  // 流れ：指示を3秒表示 -> 消す -> 青い点を表示して開眼データを3秒取得 -> 点を消す
  setStep(ui, "自然に目を開けて、表示される青い点を見てください", "");
  await sleep(3000);
  // clear instruction before showing the point
  setStep(ui, "", "");
  // show a single blue point at center and give a short moment to fixate
  overlay.place(0.5, 0.5);
  if (ui && typeof ui.repositionAvoid === 'function') ui.repositionAvoid(0.5, 0.5);
  await sleep(350);
  const openSamples = await sampleEyeMetrics(3000);
  const openBaseline = summarizeOpenBaseline(openSamples); // EARの分位トリム
  overlay.hide();

  // instruct to close eyes for 5s (we will sample 3s within that period)
  setStep(ui, "この表示が消えたら目を5秒閉じてください", "");
  // show the instruction briefly (so user reads it), then remove it before sampling
  await sleep(3000);
  // hide instruction
  setStep(ui, "", "");
  // wait 0.5s then sample closed eyes for 3s
  await sleep(500);
  const closedSamples = await sampleEyeMetrics(3000);
  const closedBaseline = summarizeOpenBaseline(closedSamples);

    // 2) 新：視線キャリブ（GRID 各点で特徴量を収集）
  const calibSamples = [];
    const N_PER_POINT = 90; // approx 3s @ 30fps

    // show practice instruction: keep face still and follow the blue dot with eyes only
    setStep(ui, "顔を動かさないように視線だけで青い点を追ってください", "");
    await sleep(5000);
    setStep(ui, "", "");

    // iterate GRID from top-left to bottom-right
  // collect all raw eye frames across all grid points so we can compute reference eye center / IOD
  const allEyes = [];
  for (const [ux, uy] of GRID) {
      // place target
      placeTargetOnAgent(overlay, ux, uy);
      // ensure the guide panel doesn't overlap the calibration point
      if (ui && typeof ui.repositionAvoid === 'function') ui.repositionAvoid(ux, uy);
      // show point, wait 0.5s for user to fixate
      await sleep(500);

      // collect features for 3s
      const feats = await sampleFeatures(3000);
      if (feats.length === 0) {
        overlay.hideTarget();
        await sleep(500);
        continue;
      }
      // median(robust) over feature columns
      const med = feats[0].feat.map((_,i) => {
        const col = feats.map(r=>r.feat[i]).sort((a,b)=>a-b);
        return col[Math.floor(col.length/2)];
      });
      // accumulate raw eye frames for REF computation
      feats.forEach(f => { if (f && f.eye) allEyes.push(f.eye); });
      const px = ux * canvas.width;
      const py = uy * canvas.height;
      calibSamples.push({ feat: med, x: px, y: py });
      // hide point and wait 0.5s before next
      overlay.hideTarget();
      await sleep(500);
    }

  // 学習（FEAT -> W_x, W_y）
    const X = calibSamples.map(s => FEAT(s.feat));
    const yx = calibSamples.map(s => s.x);
    const yy = calibSamples.map(s => s.y);
    const W_x = fitLeastSquares(X, yx);
    const W_y = fitLeastSquares(X, yy);

    // 保存
    try { localStorage.setItem('gaze_calib_v1', JSON.stringify({W_x,W_y})); } catch(e){}

    // compute reference eye center and IOD from collected raw eye frames (median)
    let REF_EYE_CX = 0.5034, REF_EYE_CY = 0.6058, REF_IOD = 0.45;
    try {
      if (allEyes.length) {
        const centersX = [], centersY = [], iods = [];
        for (const eyeArr of allEyes) {
          if (!eyeArr || !eyeArr.length) continue;
          const m = new Map(eyeArr.map(p=>[p.idx,p]));
          const left = m.get(33) || eyeArr[0];
          const right = m.get(263) || eyeArr[eyeArr.length-1];
          const eyeCx = ((left.x||0) + (right.x||0)) / 2;
          const eyeCy = ((left.y||0) + (right.y||0)) / 2;
          const iod = Math.hypot((right.x||0) - (left.x||0), (right.y||0) - (left.y||0)) || 1e-6;
          centersX.push(eyeCx); centersY.push(eyeCy); iods.push(iod);
        }
        const median = arr => { if(!arr.length) return null; arr.sort((a,b)=>a-b); return arr[Math.floor(arr.length/2)]; };
        const mx = median(centersX), my = median(centersY), mi = median(iods);
        if (mx != null) REF_EYE_CX = mx; if (my != null) REF_EYE_CY = my; if (mi != null) REF_IOD = mi;
      }
    } catch(e) { /* keep defaults on error */ }

    // setStep(ui, "キャリブ完了", "ありがとうございます。測定を開始します。", true);
    await sleep(600);

    // キャリブ完了後、自動で視線可視化を開始する
    startGazeVisualization();

    const result = {
      openBaseline, closedBaseline,
      gaze: { W_x, W_y },
      ref: { REF_EYE_CX, REF_EYE_CY, REF_IOD },
      ts: Date.now()
    };
    // expose last calibration globally for other modules (mediapipe, visualization)
    try { window.__lastCalibration = result; } catch(e) {}
    return result;
  } finally {
    overlay.destroy();
    if (ui?.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
  }
}

/* ===========================
   Feature extraction helpers
   =========================== */

// FEAT vector: [1, features..., quadratic terms...]
export const FEAT = (f) => [1, ...f, ...poly2(f)];
function poly2(v){
  const out = [];
  for(let i=0;i<v.length;i++) out.push(v[i]*v[i]);
  for(let i=0;i<v.length;i++) for(let j=i+1;j<v.length;j++) out.push(v[i]*v[j]);
  return out;
}

// 最小二乗 (ridge)
function fitLeastSquares(X, y){
  const N = X.length, D = X[0].length, lambda = 1e-4;
  const A = Array.from({length:D}, _ => Array(D).fill(0));
  const b = Array(D).fill(0);
  for(let n=0;n<N;n++){
    const xn = X[n];
    for(let i=0;i<D;i++){
      b[i] += xn[i]*y[n];
      for(let j=0;j<D;j++) A[i][j] += xn[i]*xn[j];
    }
  }
  for(let d=0;d<D;d++) A[d][d] += lambda;
  return solveLinearSystem(A, b);
}
function solveLinearSystem(A, b){
  const n = A.length;
  const M = A.map((row,i)=>[...row, b[i]]);
  for(let i=0;i<n;i++){
    let pivot = i;
    for(let r=i+1;r<n;r++) if(Math.abs(M[r][i])>Math.abs(M[pivot][i])) pivot=r;
    if(pivot!==i){ const tmp=M[i]; M[i]=M[pivot]; M[pivot]=tmp; }
    const div = M[i][i] || 1e-12;
    for(let c=i;c<=n;c++) M[i][c]/=div;
    for(let r=0;r<n;r++){
      if(r===i) continue;
      const f=M[r][i];
      for(let c=i;c<=n;c++) M[r][c]-=f*M[i][c];
    }
  }
  return M.map(row=>row[n]);
}

/* ===========================
   mp:eye_frame -> feature
   =========================== */
/**
 * mp:eye_frame の e.detail.eye は EYE_LANDMARKS に対応する
 * { idx, x, y, z } の配列です。ここから eyeFeatures を算出する。
 */
export function computeFeatureFromEye(eyeArray) {
  const m = new Map(eyeArray.map(p => [p.idx, p]));
  const L_IN=133, L_OUT=33, R_IN=362, R_OUT=263;
  const L_IRIS=[468,469,470,471,472], R_IRIS=[473,474,475,476,477];

  const li = m.get(L_IN), lo = m.get(L_OUT), ri = m.get(R_IN), ro = m.get(R_OUT);
  if (!li || !lo || !ri || !ro) return null;

  const meanPt = (ids) => {
    const pts = ids.map(i=>m.get(i)).filter(Boolean);
    if (!pts.length) return null;
    const s = pts.reduce((acc,p)=>({x:acc.x+p.x, y:acc.y+p.y}), {x:0,y:0});
    return { x: s.x/pts.length, y: s.y/pts.length };
  };
  const Lc = meanPt(L_IRIS), Rc = meanPt(R_IRIS);
  if (!Lc || !Rc) return null;

  const leftW = Math.hypot(li.x-lo.x, li.y-lo.y) + 1e-6;
  const rightW = Math.hypot(ri.x-ro.x, ri.y-ro.y) + 1e-6;

  const Lx = (Lc.x - (li.x + lo.x)/2) / leftW;
  const Ly = (Lc.y - (li.y + lo.y)/2) / leftW;
  const Rx = (Rc.x - (ri.x + ro.x)/2) / rightW;
  const Ry = (Rc.y - (ri.y + ro.y)/2) / rightW;

  // 顔中心の代わりに両眼中心の平均を使う (nose may be absent)
  const faceCx = ( (li.x+lo.x+ri.x+ro.x) / 4 );
  const faceCy = ( (li.y+lo.y+ri.y+ro.y) / 4 );

  return [Lx, Ly, Rx, Ry, faceCx, faceCy];
}

// Module-level: apply same position+scale correction to eye landmarks (returns normalized coords)
export function correctEyeArrayForGaze(eyeArray) {
  try {
    if (!eyeArray || !eyeArray.length) return null;
    const L_OUT = 33, R_OUT = 263;
    const m = new Map(eyeArray.map(p => [p.idx, p]));
    const left = m.get(L_OUT) || eyeArray[0];
    const right = m.get(R_OUT) || eyeArray[eyeArray.length-1];
    const eyeCx = ((left.x || 0) + (right.x || 0)) / 2;
    const eyeCy = ((left.y || 0) + (right.y || 0)) / 2;
    const iod = Math.hypot((right.x || 0) - (left.x || 0), (right.y || 0) - (left.y || 0)) || 1e-6;
    // prefer calibrated reference values when available
    const def = { REF_EYE_CX: 0.5034, REF_EYE_CY: 0.6058, REF_IOD: 0.45 };
    const ref = (window && window.__lastCalibration && window.__lastCalibration.ref) ? window.__lastCalibration.ref : def;
    const REF_EYE_CX = ref.REF_EYE_CX ?? def.REF_EYE_CX;
    const REF_EYE_CY = ref.REF_EYE_CY ?? def.REF_EYE_CY;
    const REF_IOD = ref.REF_IOD ?? def.REF_IOD;
    const scale = REF_IOD / iod;
    return eyeArray.map(p => ({ idx: p.idx, x: ((p.x || 0) - eyeCx) * scale + REF_EYE_CX, y: ((p.y || 0) - eyeCy) * scale + REF_EYE_CY, z: p.z }));
  } catch (e) { return null; }
}

// exported: correct a gaze point (px/py in canvas pixels) using current REF and observed eyeArray
export function correctGazePoint(px, py, eyeArray, canvasEl) {
  try {
    if (!eyeArray || !eyeArray.length || !canvasEl) return { px, py };
    const L_OUT = 33, R_OUT = 263;
    const m = new Map(eyeArray.map(p => [p.idx, p]));
    const left = m.get(L_OUT) || eyeArray[0];
    const right = m.get(R_OUT) || eyeArray[eyeArray.length-1];
    const eyeCx = ((left.x || 0) + (right.x || 0)) / 2;
    const eyeCy = ((left.y || 0) + (right.y || 0)) / 2;
    const iod = Math.hypot((right.x || 0) - (left.x || 0), (right.y || 0) - (left.y || 0)) || 1e-6;
    const def = { REF_EYE_CX: 0.5034, REF_EYE_CY: 0.6058, REF_IOD: 0.45 };
    const ref = (window && window.__lastCalibration && window.__lastCalibration.ref) ? window.__lastCalibration.ref : def;
    const REF_EYE_CX = ref.REF_EYE_CX ?? def.REF_EYE_CX;
    const REF_EYE_CY = ref.REF_EYE_CY ?? def.REF_EYE_CY;
    const REF_IOD = ref.REF_IOD ?? def.REF_IOD;
    const ux = px / canvasEl.width;
    const uy = py / canvasEl.height;
    const scale = REF_IOD / iod;
    let nx = (ux - eyeCx) * scale + REF_EYE_CX;
    let ny = (uy - eyeCy) * scale + REF_EYE_CY;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    return { px: nx * canvasEl.width, py: ny * canvasEl.height };
  } catch (e) { return { px, py }; }
}

// サンプル収集：一定時間 (ms) に来た mp:eye_frame を特徴量化して返す
function sampleFeatures(ms=1200){
  return new Promise(resolve => {
    const out = [];
    function onFrame(e){
      // For calibration, use raw eye landmarks (do not apply runtime correction here).
      const rawEye = e.detail && e.detail.eye ? e.detail.eye : null;
      const feats = rawEye ? computeFeatureFromEye(rawEye) : null;
      if (feats) out.push({ feat: feats, eye: rawEye });
    }
    window.addEventListener("mp:eye_frame", onFrame);
    setTimeout(()=>{ window.removeEventListener("mp:eye_frame", onFrame); resolve(out); }, ms);
  });
}

/* ===========================
   Agent overlay target helpers
   =========================== */
function createAgentOverlay(canvas){
  const rect = canvas.getBoundingClientRect();
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "absolute", left: `${rect.left + window.scrollX}px`, top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: "none", zIndex: 9999
  });
  wrapper.id = "agentCalibOverlay";
  const target = document.createElement("div");
  Object.assign(target.style, {
    position:"absolute", width:"14px", height:"14px", borderRadius:"999px",
    background:"#2d7ff9", boxShadow:"0 0 0 6px rgba(45,127,249,.18)", transform:"translate(-50%,-50%)",
    opacity: "0"
  });
  wrapper.appendChild(target);
  document.body.appendChild(wrapper);

  function place(x,y){
    target.style.left = `${x*100}%`;
    target.style.top = `${y*100}%`;
    target.style.opacity = "1";
  }
  function hide(){ target.style.opacity = "0"; }
  function destroy(){ if(wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); }

  // allow external color control for the marker and expose target for advanced uses
  function setColor(color) {
    try {
      target.style.background = color;
      // update halo to a translucent version of the color when possible
      target.style.boxShadow = `0 0 0 6px ${hexToRgba(color, 0.18)}`;
    } catch (e) {}
  }
  // helper: convert hex or color to rgba(...,alpha) fallback to a simple translucent red if fails
  function hexToRgba(c, a=0.18) {
    // if c already contains rgba/transparent keywords, return it lightly
    if (!c) return `rgba(255,51,51,${a})`;
    if (c.startsWith('rgba') || c.startsWith('hsla') || c.startsWith('transparent')) return c;
    // basic hex parsing (#rrggbb)
    try {
      if (c.startsWith('#')) {
        const v = c.slice(1);
        const r = parseInt(v.slice(0,2),16);
        const g = parseInt(v.slice(2,4),16);
        const b = parseInt(v.slice(4,6),16);
        return `rgba(${r},${g},${b},${a})`;
      }
      return `rgba(255,51,51,${a})`;
    } catch(e){ return `rgba(255,51,51,${a})`; }
  }

  return { place, hide, destroy, hideTarget: hide, setColor, target };
}

function placeTargetOnAgent(overlay, ux, uy){
  overlay.place(ux, uy);
}

/* ===========================
   Gaze visualization (exported)
   =========================== */

let _gazeListener = null;
let _gazeOverlay = null;
let _gazeSmoother = { x: null, y: null };
let _gazeW = null;
let _gazeOutHandler = null;
let _gazeInHandler = null;
let _dividerHandler = null;

/** 開始：localStorage か引数から係数を読み取り、mp:eye_frame を購読して可視化 */
export function startGazeVisualization(coeffs) {
  // 既に走っていれば何もしない
  if (_gazeListener) return;

  // 係数の読み込み
  let obj = coeffs;
  if (!obj) {
    try { obj = JSON.parse(localStorage.getItem('gaze_calib_v1')); } catch(e){ obj=null; }
  }
  if (!obj || !obj.W_x || !obj.W_y) {
    console.warn("視線係数が見つかりません。キャリブを実行してください。");
    return;
  }
  _gazeW = { W_x: obj.W_x, W_y: obj.W_y };

  const canvas = document.getElementById("myCanvas3");
  if (!canvas) return;
  _gazeOverlay = createAgentOverlay(canvas);

  // --- position & scale correction for gaze points (no rotation) ---
  // Uses eye landmarks (normalized 0..1) to compute observed eye-center and inter-ocular distance,
  // then scales/translates the raw gaze ux/uy to compensate for face distance/translation.
  function correctGazePosition(px, py, eyeArray, canvasEl) {
    try {
      if (!eyeArray || !eyeArray.length || !canvasEl) return { px, py };
      // landmark indices for outer eye corners
      const L_OUT = 33, R_OUT = 263;
      const m = new Map(eyeArray.map(p => [p.idx, p]));
      const left = m.get(L_OUT) || eyeArray[0];
      const right = m.get(R_OUT) || eyeArray[eyeArray.length-1];

      // observed eye center (normalized space)
      const eyeCx = ((left.x || 0) + (right.x || 0)) / 2;
      const eyeCy = ((left.y || 0) + (right.y || 0)) / 2;

      // observed inter-ocular distance (normalized)
      const iod = Math.hypot((right.x || 0) - (left.x || 0), (right.y || 0) - (left.y || 0)) || 1e-6;

  // reference values: prefer values from last calibration if available
  const def = { REF_EYE_CX: 0.5034, REF_EYE_CY: 0.6058, REF_IOD: 0.45 };
  const ref = (window && window.__lastCalibration && window.__lastCalibration.ref) ? window.__lastCalibration.ref : def;
  const REF_EYE_CX = ref.REF_EYE_CX ?? def.REF_EYE_CX;
  const REF_EYE_CY = ref.REF_EYE_CY ?? def.REF_EYE_CY;
  const REF_IOD = ref.REF_IOD ?? def.REF_IOD;

      // convert px/py to normalized ux/uy
      const ux = px / canvasEl.width;
      const uy = py / canvasEl.height;

      // scale factor to map observed size to reference
      const scale = REF_IOD / iod;

      // translate ux/uy to eye-centered, scale, then translate to reference-centered
      let nx = (ux - eyeCx) * scale + REF_EYE_CX;
      let ny = (uy - eyeCy) * scale + REF_EYE_CY;

      // clamp to [0,1]
      nx = Math.max(0, Math.min(1, nx));
      ny = Math.max(0, Math.min(1, ny));

      return { px: nx * canvasEl.width, py: ny * canvasEl.height };
    } catch (e) {
      return { px, py };
    }
  }

  // map eye landmarks through the same translation+scale correction (returns normalized [0..1] coords)
  function mapEyeLandmarksCorrected(eyeArray) {
    try {
      if (!eyeArray || !eyeArray.length) return null;
      const L_OUT = 33, R_OUT = 263;
      const m = new Map(eyeArray.map(p => [p.idx, p]));
      const left = m.get(L_OUT) || eyeArray[0];
      const right = m.get(R_OUT) || eyeArray[eyeArray.length-1];
      const eyeCx = ((left.x || 0) + (right.x || 0)) / 2;
      const eyeCy = ((left.y || 0) + (right.y || 0)) / 2;
      const iod = Math.hypot((right.x || 0) - (left.x || 0), (right.y || 0) - (left.y || 0)) || 1e-6;
  const def = { REF_EYE_CX: 0.5034, REF_EYE_CY: 0.6058, REF_IOD: 0.45 };
  const ref = (window && window.__lastCalibration && window.__lastCalibration.ref) ? window.__lastCalibration.ref : def;
  const REF_EYE_CX = ref.REF_EYE_CX ?? def.REF_EYE_CX;
  const REF_EYE_CY = ref.REF_EYE_CY ?? def.REF_EYE_CY;
  const REF_IOD = ref.REF_IOD ?? def.REF_IOD;
  const scale = REF_IOD / iod;
      return eyeArray.map(p => {
        const nx = ( (p.x || 0) - eyeCx ) * scale + REF_EYE_CX;
        const ny = ( (p.y || 0) - eyeCy ) * scale + REF_EYE_CY;
        return { idx: p.idx, x: nx, y: ny };
      });
    } catch (e) { return null; }
  }

  // listener
  _gazeListener = (e) => {
    const app = document.getElementById('app');
    const collapsed = app && app.classList && app.classList.contains('preview-collapsed');

    const feat = computeFeatureFromEye(e.detail.eye);
    const c1 = document.getElementById('myCanvas1');
    const c2 = document.getElementById('myCanvas2');
    const r1 = c1 ? c1.getBoundingClientRect() : null;
    const r2 = c2 ? c2.getBoundingClientRect() : null;

    if (!feat) {
      // no landmarks -> treat as out-of-bounds for aggregation
      const canvasRect = canvas.getBoundingClientRect();
      const pageX = canvasRect.left; const pageY = canvasRect.top;
      window.dispatchEvent(new CustomEvent('gaze:out_of_bounds', { detail: { pageX, pageY, canvas1Rect: r1, canvas2Rect: r2 } }));
      if (!collapsed && _gazeOverlay) _gazeOverlay.hideTarget();
      return;
    }

    const f = FEAT(feat);
    const dot = (w) => f.reduce((s,v,i)=>s + v * (w[i]||0), 0);
    let px = dot(_gazeW.W_x), py = dot(_gazeW.W_y);
    // keep raw for debug
    const rawUx = px / canvas.width;
    const rawUy = py / canvas.height;
    // apply position & scale correction (do not apply rotation here)
    let corrected = null;
    try {
      corrected = correctGazePosition(px, py, e.detail.eye, canvas);
      px = corrected.px; py = corrected.py;
    } catch (e) { /* ignore */ }
    const corrUx = px / canvas.width;
    const corrUy = py / canvas.height;

    // debug draw: raw vs corrected gaze + eye landmarks on debugGazeCanvas if present
    try {
      const dbg = document.getElementById('debugGazeCanvas');
      if (dbg && dbg.getContext) {
        const dctx = dbg.getContext('2d');
        // fade slightly to see trail
        dctx.fillStyle = 'rgba(0,0,0,0.12)';
        dctx.fillRect(0,0,dbg.width, dbg.height);

        // draw raw gaze (small red)
        dctx.beginPath(); dctx.fillStyle = '#ff4444'; dctx.arc(rawUx * dbg.width, rawUy * dbg.height, 4, 0, Math.PI*2); dctx.fill();
        // draw corrected gaze (small green)
        dctx.beginPath(); dctx.fillStyle = '#44ff44'; dctx.arc(corrUx * dbg.width, corrUy * dbg.height, 4, 0, Math.PI*2); dctx.fill();

        // draw eye landmarks: raw (orange) and corrected (cyan)
        const rawEye = e.detail.eye || [];
        const corrEye = mapEyeLandmarksCorrected(rawEye) || [];
        // raw landmarks
        dctx.fillStyle = '#ff8844';
        for (const p of rawEye) {
          const x = (p.x || 0) * dbg.width;
          const y = (p.y || 0) * dbg.height;
          dctx.fillRect(x-1, y-1, 3, 3);
        }
        // corrected landmarks
        dctx.fillStyle = '#44ffff';
        for (const p of corrEye) {
          const x = (p.x || 0) * dbg.width;
          const y = (p.y || 0) * dbg.height;
          dctx.fillRect(x-1, y-1, 3, 3);
        }

        // legend
        dctx.fillStyle = '#fff'; dctx.font = '11px monospace';
        dctx.fillText('raw gaze', 6, dbg.height - 36); dctx.fillStyle = '#ff4444'; dctx.fillRect(66, dbg.height - 44, 12, 12);
        dctx.fillStyle = '#fff'; dctx.fillText('corrected gaze', 6, dbg.height - 20); dctx.fillStyle = '#44ff44'; dctx.fillRect(100, dbg.height - 28, 12, 12);
        dctx.fillStyle = '#fff'; dctx.fillText('raw eye', 150, dbg.height - 36); dctx.fillStyle = '#ff8844'; dctx.fillRect(186, dbg.height - 44, 12, 12);
        dctx.fillStyle = '#fff'; dctx.fillText('corr eye', 150, dbg.height - 20); dctx.fillStyle = '#44ffff'; dctx.fillRect(186, dbg.height - 28, 12, 12);
      }
    } catch(e) {}
    // expose latest gaze point for capture (page/canvas pixels and normalized ux/uy)
    try { 
      // console.log("Gaze point:", px, py);
      window.__lastGazePoint = {
        px, py, ux: px / canvas.width, uy: py / canvas.height
      };
    } catch(e) {
      // console.warn("Failed to set __lastGazePoint:", e);
      window.__lastGazePoint = null;
    }

    // determine whether gaze (px,py) on myCanvas3 maps into myCanvas1 or myCanvas2
    const canvasRect = canvas.getBoundingClientRect();
    const pageX = canvasRect.left + (px / canvas.width) * canvasRect.width;
    const pageY = canvasRect.top  + (py / canvas.height) * canvasRect.height;

    const in1 = r1 && pageX >= r1.left && pageX <= r1.right && pageY >= r1.top && pageY <= r1.bottom;
    const in2 = r2 && pageX >= r2.left && pageX <= r2.right && pageY >= r2.top && pageY <= r2.bottom;

    if (!in1 && !in2) {
      // outside both target canvases -> out of bounds
      window.dispatchEvent(new CustomEvent('gaze:out_of_bounds', { detail: { pageX, pageY, canvas1Rect: r1, canvas2Rect: r2 } }));
      if (!collapsed) {
        try { canvas.style.backgroundColor = 'rgba(255,64,64,0.12)'; } catch (e) {}
        const clampedPx = clamp(px, 0, canvas.width);
        const clampedPy = clamp(py, 0, canvas.height);
        const uxEdge = clampedPx / canvas.width;
        const uyEdge = clampedPy / canvas.height;
        try { _gazeOverlay.setColor('#ff3333'); _gazeOverlay.place(uxEdge, uyEdge); } catch (e) { if (_gazeOverlay) _gazeOverlay.hideTarget(); }
      }
      return;
    }

    // clamp to canvas (redundant when in-bounds, but keep for safety)
    px = clamp(px, 0, canvas.width);
    py = clamp(py, 0, canvas.height);

    // normalize for overlay.place (0..1)
    const ux = px / canvas.width;
    const uy = py / canvas.height;

    // smoothing
    const alpha = 0.35;
    if (_gazeSmoother.x == null) { _gazeSmoother.x = ux; _gazeSmoother.y = uy; }
    else {
      _gazeSmoother.x = _gazeSmoother.x * (1 - alpha) + ux * alpha;
      _gazeSmoother.y = _gazeSmoother.y * (1 - alpha) + uy * alpha;
    }

    // dispatch in-bounds for aggregation
    const inEv = new CustomEvent('gaze:in_bounds', { detail: { px, py, ux: _gazeSmoother.x, uy: _gazeSmoother.y } });
    window.dispatchEvent(inEv);

    if (!collapsed) {
      // clear any OOB tint when gaze returns in-bounds and restore marker color
      try { canvas.style.backgroundColor = ''; _gazeOverlay.setColor('#2d7ff9'); } catch (e) {}
      _gazeOverlay.place(_gazeSmoother.x, _gazeSmoother.y);
    }
  };

  window.addEventListener("mp:eye_frame", _gazeListener);
  console.log("[Calibration] Gaze visualization started");

    // --- highlight helpers ---
    function clearHighlights() {
      const c1 = document.getElementById('myCanvas1');
      const c2 = document.getElementById('myCanvas2');
      const c3 = document.getElementById('myCanvas3');
      [c1, c2, c3].forEach(el => {
        if (!el) return;
        el.style.boxShadow = '';
        el.style.outline = '';
      });
    }
    function highlightEl(el, color) {
      clearHighlights();
      if (!el) return;
      el.style.boxShadow = `0 0 0 6px ${color}`;
    }

    // gaze out/in handlers (use normalized ux from event to decide left/right)
    _gazeOutHandler = (ev) => {
      const app = document.getElementById('app');
      const collapsed = app && app.classList && app.classList.contains('preview-collapsed');
      if (collapsed) { clearHighlights(); return; }
      const c3 = document.getElementById('myCanvas3');
      highlightEl(c3, '#ff3333'); // red for out-of-bounds
    };
    _gazeInHandler = (ev) => {
      const app = document.getElementById('app');
      const collapsed = app && app.classList && app.classList.contains('preview-collapsed');
      if (collapsed) { clearHighlights(); return; }
      const ux = (ev && ev.detail && typeof ev.detail.ux === 'number') ? ev.detail.ux : null;
      const c1 = document.getElementById('myCanvas1');
      const c2 = document.getElementById('myCanvas2');
      if (ux == null) {
        // fallback: highlight canvas3
        const c3 = document.getElementById('myCanvas3');
        highlightEl(c3, 'greenyellow');
        return;
      }
      // if canvas1 and canvas2 exist, highlight the one corresponding to left/right
      if (c1 && c2) {
        if (ux < 0.5) highlightEl(c1, 'greenyellow');
        else highlightEl(c2, 'greenyellow');
      } else {
        // fallback: use left/right half of canvas3
        const c3 = document.getElementById('myCanvas3');
        if (!c3) return;
        highlightEl(c3, 'greenyellow');
      }
    };

    window.addEventListener('gaze:out_of_bounds', _gazeOutHandler);
    window.addEventListener('gaze:in_bounds', _gazeInHandler);

    // respect dividerToggle: when preview collapsed, clear highlights and disable
    const dividerToggle = document.getElementById('dividerToggle');
    _dividerHandler = () => {
      // allow main.js to toggle class first
      setTimeout(() => {
        const app = document.getElementById('app');
        const collapsed = app && app.classList && app.classList.contains('preview-collapsed');
        if (collapsed) {
          // clear visuals
          if (typeof clearHighlights === 'function') clearHighlights();
        }
      }, 0);
    };
    if (dividerToggle) dividerToggle.addEventListener('click', _dividerHandler);
}

/** 停止 */
export function stopGazeVisualization() {
  if (_gazeListener) {
    window.removeEventListener("mp:eye_frame", _gazeListener);
    _gazeListener = null;
  }
  if (_gazeOverlay) {
    _gazeOverlay.destroy();
    _gazeOverlay = null;
  }
  _gazeSmoother = { x: null, y: null };
  _gazeW = null;
  // remove our added event handlers
  if (_gazeOutHandler) { window.removeEventListener('gaze:out_of_bounds', _gazeOutHandler); _gazeOutHandler = null; }
  if (_gazeInHandler) { window.removeEventListener('gaze:in_bounds', _gazeInHandler); _gazeInHandler = null; }
  if (_dividerHandler) { const dividerToggle = document.getElementById('dividerToggle'); if (dividerToggle) dividerToggle.removeEventListener('click', _dividerHandler); _dividerHandler = null; }

  // clear visual highlights
  const c1 = document.getElementById('myCanvas1');
  const c2 = document.getElementById('myCanvas2');
  const c3 = document.getElementById('myCanvas3');
  [c1, c2, c3].forEach(el => { if (!el) return; el.style.boxShadow = ''; el.style.outline = ''; });
  console.log("[Calibration] Gaze visualization stopped");
}

/* ===========================
   既存の helper 関数はそのまま
   (computeEyeOpenRatio, sampleEyeMetrics, summarizeOpenBaseline, buildOverlayUI など)
   =========================== */

/* 以下は既存ファイルの computeEyeOpenRatio / sampleEyeMetrics / summarizeOpenBaseline / UI サポート等を
   そのまま残してください（ここに続く既存コードを維持） */
export function computeEyeOpenRatio(eyeArray) {
  const m = new Map(eyeArray.map(p => [p.idx, p]));
  const dist = (a,b) => Math.hypot((a.x-b.x), (a.y-b.y));

  // 左目（外33, 内133, 垂直 159-145/160-144/158-153）
  const L_OUT=33, L_IN=133;
  const L_V=[[159,145],[160,144],[158,153]];
  const lh = dist(m.get(L_OUT), m.get(L_IN)) || 1e-6;
  const lv = avg(L_V.map(([u,d]) => dist(m.get(u), m.get(d))));
  const left = lv / lh;

  // 右目（外263, 内362, 垂直 386-374/387-373/385-380）
  const R_OUT=263, R_IN=362;
  const R_V=[[386,374],[387,373],[385,380]];
  const rh = dist(m.get(R_OUT), m.get(R_IN)) || 1e-6;
  const rv = avg(R_V.map(([u,d]) => dist(m.get(u), m.get(d))));
  const right = rv / rh;

  return { left, right, avg: (left + right) / 2 };
}

function sampleEyeMetrics(ms=3000){
  return new Promise(resolve=>{
    const xs=[];
    const onFrame=(e)=>{
      const r = computeEyeOpenRatio(e.detail.eye);
      xs.push(r);
    };
    window.addEventListener("mp:eye_frame", onFrame);
    setTimeout(()=>{ window.removeEventListener("mp:eye_frame", onFrame); resolve(xs); }, ms);
  });
}

function summarizeOpenBaseline(samples){
  const L = trim(samples.map(s=>s.left));
  const R = trim(samples.map(s=>s.right));
  const left = avg(L), right = avg(R), avgv = (left+right)/2;
  return { left, right, avg: avgv };
}

/* UI overlay helper (keep existing version or slightly adapt) */
function buildOverlayUI(host){
  // host: optional element to mount the UI into (e.g. overlay wrapper on myCanvas3)
  const mount = host && host.appendChild ? host : document.body;

  const root = document.createElement("div");
  Object.assign(root, { id:"calibOverlay" });
  Object.assign(root.style,{
    position:"absolute", inset:"0", display:"grid",
    gridTemplateRows:"auto 1fr", pointerEvents:"none", zIndex:1001
  });

  const panel = document.createElement("div");
  Object.assign(panel, { id:"calibPanel" });
  Object.assign(panel.style,{
    pointerEvents:"auto", alignSelf:"center", justifySelf:"center",
    marginTop:"0px", background:"rgba(10,14,26,.85)", color:"#e6e9ef",
    border:"1px solid rgba(255,255,255,.12)", borderRadius:"10px",
    padding:"10px 14px", font:"600 14px system-ui, sans-serif",
    textAlign:"center", boxShadow:"0 10px 24px rgba(0,0,0,.45)",
    maxWidth: "360px",
    // start hidden: when there is no text we want the whole panel to be invisible (not just empty)
    display: 'none',
  });

  const title = document.createElement("div");
  title.id="calibTitle";
  title.textContent=""; // start empty (don't show initial 'キャリブレーション')

  const desc = document.createElement("div");
  desc.id="calibDesc";
  Object.assign(desc.style,{ fontSize:"13px", opacity:"0.95", marginTop: "6px" });

  panel.appendChild(title); panel.appendChild(desc);

  const stage = document.createElement("div");
  stage.id="calibStage"; Object.assign(stage.style,{ position:"relative" });

  const target = document.createElement("div");
  target.id="calibTarget";
  Object.assign(target.style,{
    position:"absolute", width:"12px", height:"12px", borderRadius:"999px",
    background:"#2d7ff9", boxShadow:"0 0 0 4px rgba(45,127,249,.25)",
    transform:"translate(-50%,-50%)", opacity:"0"
  });

  stage.appendChild(target);
  root.appendChild(panel); root.appendChild(stage);
  mount.appendChild(root);

  // repositionAvoid: keep panel near center but avoid overlapping a point at ux,uy (0..1)
  function repositionAvoid(ux, uy) {
    try {
      // mount is expected to be the overlay wrapper positioned over the canvas
      const mr = mount.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      // desired center position in page coords: center of mount
      const centerX = mr.left + mr.width/2;
      const centerY = mr.top + mr.height/2;

      // point page coords
      const px = mr.left + ux * mr.width;
      const py = mr.top + uy * mr.height;

      // if the point would overlap the panel's bounding box at center, nudge panel up or down
      const halfH = panelRect.height / 2;
      const halfW = panelRect.width / 2;

      // target relative to center
      const relY = py - centerY;
      const relX = px - centerX;

      let offsetY = 0;
      // overlap if abs(relY) < halfH + padding and abs(relX) < halfW + padding
      const padding = 12;
      if (Math.abs(relX) < (halfW + padding) && Math.abs(relY) < (halfH + padding)) {
        // push panel away vertically: if point is above center, move panel down, else move up
        offsetY = (relY < 0) ? (halfH + padding - relY) : -(halfH + padding + relY);
      }

      // clamp offset so panel stays within mount bounds
      const maxOffsetY = Math.max(0, (mr.height/2) - halfH - 8);
      offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY));

      // ensure panel is positioned absolutely centered first, then apply vertical offset
      panel.style.position = 'absolute';
      panel.style.left = '50%';
      panel.style.top = '50%';
      // keep base transform as centered; repositionAvoid will modify translateY portion only
      panel.style.transform = `translate(calc(-50%), calc(-50% + ${Math.round(offsetY)}px))`;
    } catch (e) { /* ignore */ }
  }

  // central helper: set title/desc and toggle panel visibility as a whole.
  function setTextInternal(t, d) {
    title.textContent = t || "";
    desc.textContent = d || "";
    // if both are empty, hide the entire panel (including border/background)
    if ((!title.textContent || title.textContent.trim() === "") && (!desc.textContent || desc.textContent.trim() === "")) {
      panel.style.display = 'none';
    } else {
      // ensure visible and reset transform to centered baseline so repositionAvoid can nudge from center
      panel.style.display = '';
      panel.style.position = 'absolute';
      panel.style.left = '50%';
      panel.style.top = '50%';
      panel.style.transform = 'translate(-50%, -50%)';
    }
  }

  return {
    root,
    setText: setTextInternal,
    setTarget:(x,y)=>{ target.style.left=`${x*100}%`; target.style.top=`${y*100}%`; target.style.opacity="1"; },
    hideTarget:()=>{ target.style.opacity="0"; },
    repositionAvoid,
  };
}
function setStep(ui, t, d, done=false){ ui?.setText(t,d); if(done) ui?.hideTarget(); }
function placeTarget(ui,x,y){ ui?.setTarget(x,y); }

/* utils */
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function avg(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function clamp(x,min=0,max=1){ return Math.max(min, Math.min(max, x)); }
function trim(arr,cut=0.05){ if(!arr.length) return arr; const a=[...arr].sort((x,y)=>x-y); const n=a.length;
  const s=Math.floor(n*cut), e=Math.ceil(n*(1-cut)); return a.slice(s,e); }
