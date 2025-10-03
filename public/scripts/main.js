// public/scripts/main.js
import {
  mediapipeInitAndStart,
  sendEyeLandmarkData,
  stopCollecting,
  stopMediaPipeAll
} from "./mediapipe.js";

// agent.js は動的 import で安全に初期化
async function initAgentSafely(canvas) {
  try {
    const mod = await import("./agent.js");
    if (mod?.default) {
      const Agent = mod.default;
      const agent = new Agent(canvas);
      if (agent.init) await agent.init();
      if (agent.start) agent.start();
      return;
    }
    if (mod?.Agent) {
      const Agent = mod.Agent;
      const agent = new Agent(canvas);
      if (agent.init) await agent.init();
      if (agent.start) agent.start();
      return;
    }
    if (typeof mod?.initAgent === "function") {
      await mod.initAgent(canvas);
      return;
    }
  } catch (e) {
    console.warn("[main] agent.js import に失敗。window.initAgent を探します。", e);
  }
  if (typeof window.initAgent === "function") {
    await window.initAgent(canvas);
  } else {
    console.warn("[main] agent 初期化スキップ（agent.js を確認してください）");
  }
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
  const coordLog  = document.getElementById("coordLog");

  // 初期状態：プレビュー表示
  app.classList.remove("preview-collapsed");
  divider?.setAttribute("aria-expanded", "true");

  // Start：測定開始（UIの表示/非表示に関わらず継続）
  btnStart.onclick = async () => {
    btnStart.disabled = true;
    btnStop.disabled  = false;
    try {
      await mediapipeInitAndStart();
    } catch (e) {
      console.error("[main] MediaPipe 起動失敗:", e);
      alert("カメラ起動に失敗しました。ブラウザの許可設定やHTTPS/localhostを確認してください。");
      btnStart.disabled = false;
      btnStop.disabled  = true;
    }
  };

  // Stop：★完全停止（測定・プレビュー・座標更新すべて止める）
  btnStop.onclick = async () => {
    btnStop.disabled  = true;
    btnStart.disabled = false;

    // 収集停止 → サーバ送信（任意）
    stopCollecting();
    await sendEyeLandmarkData().catch(() => {});

    // プレビュー/イベントも止める
    await stopMediaPipeAll();

    // UIリセット（座標パネルを空に）
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";

    //（任意）プレビュー領域も畳む
    // app.classList.add("preview-collapsed");
    // divider?.setAttribute("aria-expanded", "false");
  };

  // 仕切りトグル（UIだけ畳む。測定のON/OFFには影響しない）
  const togglePreview = () => {
    const collapsed = app.classList.toggle("preview-collapsed");
    divider?.setAttribute("aria-expanded", String(!collapsed));
  };
  divider?.addEventListener("click", togglePreview);
  divider?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePreview(); }
  });

  // ===== 座標パネル更新（測定中のみ受け取れる） =====
  window.addEventListener("mp:eye_frame", (e) => {
    const { ts, count, eye } = e.detail;
    const lines = eye.map(p => `#${p.idx}\tx:${p.x}\ty:${p.y}\tz:${p.z}`);
    if (coordLog) {
      coordLog.textContent = lines.join("\n");
      coordLog.scrollTop = coordLog.scrollHeight;
    }
    if (frameInfo) {
      frameInfo.textContent = `pts: ${count} | ${new Date(ts).toLocaleTimeString()}`;
    }
  });

  // ★ Stop 時のUIクリア通知
  window.addEventListener("mp:clear", () => {
    if (coordLog)  coordLog.textContent = "";
    if (frameInfo) frameInfo.textContent = "—";
  });
});
