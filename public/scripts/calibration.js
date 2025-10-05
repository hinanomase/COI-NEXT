// public/scripts/calibration.js
// Start直後に呼び出して、(1) 開眼ベースライン, (2) 左右視線キャリブ を行う。
// MediaPipeの "mp:eye_frame" を購読して計測する。

/** 外部公開：キャリブレーション本体 */
export async function runCalibration() {
  const wrap = document.getElementById("mpPreviewWrap");
  const ui = buildOverlayUI(wrap);

  try {
    // ========= 1) 開眼ベースライン（3秒） =========
    setStep(ui, "開眼ベースライン", "自然に目を開けてください（3秒）");
    await sleep(350);
    const openSamples = await sampleEyeMetrics(3000);
    const openBaseline = summarizeOpenBaseline(openSamples); // EARの分位トリム

    // ========= 2) 視線キャリブ（左右3点 x=0.2/0.5/0.8, y=0.5） =========
    const targets = [
      { label: "左の点を見てください", x: 0.2, y: 0.5, ms: 1200 },
      { label: "中央の点を見てください", x: 0.5, y: 0.5, ms: 1200 },
      { label: "右の点を見てください", x: 0.8, y: 0.5, ms: 1200 },
    ];
    const obs = [];

    for (const t of targets) {
      setStep(ui, "視線キャリブレーション", t.label);
      placeTarget(ui, t.x, t.y);
      await sleep(250);
      const gazeSamples = await sampleGaze(t.ms);
      const mean = meanGaze(gazeSamples); // 計測された (x_meas, y_meas)
      obs.push({ tx: t.x, ty: t.y, mx: mean.x, my: mean.y });
    }

    // 線形変換：x_true ≒ sx * x_meas + bx （左右2点でスケール、中心で微調整）
    const left  = obs[0], center = obs[1], right = obs[2];
    const sx = (right.tx - left.tx) / ((right.mx - left.mx) || 1e-6);
    let  bx = left.tx - sx * left.mx;
    const bx2 = center.tx - sx * center.mx;
    bx = (bx + bx2) / 2; // 中央で補正平均

    // y はバイアスのみ（傾き1想定）
    const yBias = center.ty - center.my;

    const result = {
      openBaseline,           // {left,right,avg}
      gaze: { sx, bx, yBias }, // 水平スケール/バイアス & 垂直バイアス
      ts: Date.now(),
    };
    localStorage.setItem("calibration", JSON.stringify(result));

    setStep(ui, "キャリブ完了", "ありがとうございます。測定を開始します。", true);
    await sleep(600);
    return result;
  } finally {
    if (ui?.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
  }
}

/* ========= 開眼率(EAR) =========
   目の縦距離の平均 / 横距離（目頭-目尻）で定義。スケール不変なのでカメラ距離の影響を受けにくい。 */
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

/* ========= 視線の簡易正規化（両眼の虹彩中心） ========= */
function computeGazeNorm(eyeArray) {
  const m = new Map(eyeArray.map(p => [p.idx, p]));
  const L_OUT=33, L_IN=133, L_TOP=159, L_BOT=145;
  const R_OUT=263, R_IN=362, R_TOP=386, R_BOT=374;
  const L_IRIS=[468,469,470,471,472], R_IRIS=[473,474,475,476,477];

  const meanPt = (arr)=>({ x: avg(arr.map(p=>p.x)), y: avg(arr.map(p=>p.y)) });
  const lRect = { x1: m.get(L_OUT).x, y1: m.get(L_TOP).y, x2: m.get(L_IN).x,  y2: m.get(L_BOT).y };
  const rRect = { x1: m.get(R_IN).x,  y1: m.get(R_TOP).y, x2: m.get(R_OUT).x, y2: m.get(R_BOT).y };
  const lIris = meanPt(L_IRIS.map(i=>m.get(i)));
  const rIris = meanPt(R_IRIS.map(i=>m.get(i)));

  const normIn = (pt, rect) => ({
    x: clamp((pt.x - Math.min(rect.x1, rect.x2)) / Math.abs(rect.x2 - rect.x1), 0, 1),
    y: clamp((pt.y - Math.min(rect.y1, rect.y2)) / Math.abs(rect.y2 - rect.y1), 0, 1),
  });
  const ln = normIn(lIris, lRect);
  const rn = normIn(rIris, rRect);
  return { x: (ln.x + rn.x)/2, y: (ln.y + rn.y)/2 };
}

/* ========= サンプリング & 集約 ========= */

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

function sampleGaze(ms=1200){
  return new Promise(resolve=>{
    const xs=[];
    const onFrame=(e)=>{
      xs.push(computeGazeNorm(e.detail.eye));
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
function meanGaze(samples){
  return { x: avg(trim(samples.map(s=>s.x))), y: avg(trim(samples.map(s=>s.y))) };
}

/* ========= UI ========= */

function buildOverlayUI(host){
  const root = document.createElement("div");
  Object.assign(root, { id:"calibOverlay" });
  Object.assign(root.style,{
    position:"absolute", inset:"0", display:"grid",
    gridTemplateRows:"auto 1fr", pointerEvents:"none", zIndex:1001
  });

  const panel = document.createElement("div");
  Object.assign(panel, { id:"calibPanel" });
  Object.assign(panel.style,{
    pointerEvents:"auto", alignSelf:"start", justifySelf:"center",
    marginTop:"12px", background:"rgba(10,14,26,.75)", color:"#e6e9ef",
    border:"1px solid rgba(255,255,255,.12)", borderRadius:"10px",
    padding:"8px 12px", font:"600 14px system-ui, sans-serif",
    textAlign:"center", boxShadow:"0 10px 24px rgba(0,0,0,.35)"
  });

  const title = document.createElement("div");
  title.id="calibTitle";
  title.textContent="キャリブレーション";

  const desc = document.createElement("div");
  desc.id="calibDesc";
  Object.assign(desc.style,{ fontSize:"12px", opacity:"0.85" });

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
  (host || document.body).appendChild(root);

  return {
    root,
    setText:(t,d)=>{ title.textContent=t||""; desc.textContent=d||""; },
    setTarget:(x,y)=>{ target.style.left=`${x*100}%`; target.style.top=`${y*100}%`; target.style.opacity="1"; },
    hideTarget:()=>{ target.style.opacity="0"; },
  };
}
function setStep(ui, t, d, done=false){ ui?.setText(t,d); if(done) ui?.hideTarget(); }
function placeTarget(ui,x,y){ ui?.setTarget(x,y); }

/* ========= utils ========= */
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function avg(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function clamp(x,min=0,max=1){ return Math.max(min, Math.min(max, x)); }
function trim(arr,cut=0.05){ if(!arr.length) return arr; const a=[...arr].sort((x,y)=>x-y); const n=a.length;
  const s=Math.floor(n*cut), e=Math.ceil(n*(1-cut)); return a.slice(s,e); }
