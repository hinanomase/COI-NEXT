// public/scripts/agent.js
// ========================================================
// 左右2体のエージェントを表示（右のみローカルboyB版）
// 追加: 左=笑顔(joy)、右=悲しい顔(Sadness) を内部APIで適用
// ========================================================

// モデルパス（両者共通）
const modelPath_Agent =
  "https://cdn.jsdelivr.net/gh/TeradaLab-Agents/Agent-Misaki@1f5d8f07eb2b7396c5309b200a4d8a6515c06ba4/GeminoidF/moc/GeminoidF_new2/GeminoidF_new2.model3.json";

// 左エージェント：CDNのboyA版を使用
const resourcePath_Left =
  "https://cdn.jsdelivr.net/gh/TeradaLab-Agents/Agent-Misaki@1f5d8f07eb2b7396c5309b200a4d8a6515c06ba4/js/indexLibrary_boyA.js";

// 右エージェント：ローカルに保存したboyB版を使用
const resourcePath_Right = "./scripts/indexLibrary_boyB.js";

// 配置位置（左右対称）
const position_AgentL = {
  boxWidth: 2500,
  boxHeight: 2500,
  modelScale: 0.36,
  modelX: 350,
  modelY: 1350,
};
const position_AgentR = {
  boxWidth: 2500,
  boxHeight: 2500,
  modelScale: 0.36,
  modelX: 50,
  modelY: 1350,
};

// ========================================================
// Live2D エージェントクラス
// ========================================================
class SetAgent {
  constructor(debug, serverURL, modelPath, resourcePath, position, canvasId) {
    this.debug = debug;
    this.serverURL = serverURL;
    this.modelPathPath = modelPath;
    this.resourcePath = resourcePath;
    this.position = position;
    this.canvasId = canvasId;
    this.indexLibrary = null;
    this.init();
  }

  async init() {
    // SDK群を一度だけ読み込み
    if (!window._Live2D_Core_Loaded) {
      await loadScript(
        "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
      );
      await loadScript(
        "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"
      );
      window._Live2D_Core_Loaded = true;
      console.log("[Agent] Live2D Core loaded");
    }

    // indexLibrary_*（boyA/boyB）を読み込む
    await loadScript(this.resourcePath);

    // モデル初期化
    this.indexLibrary = new IndexLibrary(
      this.debug,
      this.serverURL,
      this.modelPathPath,
      this.position,
      this.canvasId
    );
    this.indexLibrary.onload();
  }

  startAgentSpeak() {
    if (this.indexLibrary) this.indexLibrary.App_StartSpeak(1.5, 0.25);
  }

  stopAgentSpeak() {
    if (this.indexLibrary) this.indexLibrary.App_StopSpeak();
  }
}

// ========================================================
// スクリプト読み込みユーティリティ
// ========================================================
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = url + "?v=" + Date.now(); // キャッシュ防止
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ========================================================
// 左右のエージェントを生成
// ========================================================
const AgentLeft = new SetAgent(
  false,
  "",
  modelPath_Agent,
  resourcePath_Left,
  position_AgentL,
  "myCanvas1"
);
const AgentRight = new SetAgent(
  false,
  "",
  modelPath_Agent,
  resourcePath_Right,
  position_AgentR,
  "myCanvas2"
);

// ========================================================
// 初期表情の設定（左=笑顔 / 右=悲しい）
//   ・左右どちらも適用できるまでリトライ
//   ・ロード順のブレで片方だけになる問題を解消
// ========================================================
function applyInitialExpressions() {
  let leftDone = false;
  let rightDone = false;

  const maxRetry = 40;     // 最大リトライ回数（40回）
  const intervalMs = 250;  // 間隔（ms）
  let tries = 0;

  const tick = () => {
    // 左（boyA）: 笑顔 (Joy)
    if (!leftDone) {
      const leftLib = Agents.left?.indexLibrary;
      if (leftLib && typeof leftLib.App_set_Joy === "function") {
        try {
          leftLib.App_set_Joy(4); // ← あなたの指定値をそのまま使用
          leftDone = true;
          console.log("[Agent] 左: 笑顔(App_set_Joy(7)) を適用");
        } catch (e) {
          console.warn("[Agent] 左: 笑顔適用失敗", e);
        }
      }
    }

    // 右（boyB）: 悲しい (Sadness)
    if (!rightDone) {
      const rightLib = Agents.right?.indexLibrary;
      if (rightLib && typeof rightLib.App_set_Sadness === "function") {
        try {
          rightLib.App_set_Sadness(2); // ← あなたの指定値をそのまま使用
          rightDone = true;
          console.log("[Agent] 右: 悲しい顔(App_set_Sadness(3)) を適用");
        } catch (e) {
          console.warn("[Agent] 右: 悲しい顔適用失敗", e);
        }
      }
    }

    // 両方適用できたら終了
    if (leftDone && rightDone) {
      clearInterval(timer);
      return;
    }

    // 規定回数を超えたら終了（どちらか未適用なら警告）
    tries++;
    if (tries >= maxRetry) {
      clearInterval(timer);
      if (!leftDone)  console.warn("[Agent] 左: 表情適用に失敗（タイムアウト）");
      if (!rightDone) console.warn("[Agent] 右: 表情適用に失敗（タイムアウト）");
    }
  };

  // すぐ1回試し、その後インターバルで粘る
  const timer = setInterval(tick, intervalMs);
  tick();
}

window.addEventListener("load", applyInitialExpressions);


// ========================================================
// 両者をまとめて制御
// ========================================================
export const Agents = {
  left: AgentLeft,
  right: AgentRight,
  startSpeak() {
    this.left.startAgentSpeak();
    this.right.startAgentSpeak();
  },
  stopSpeak() {
    this.left.stopAgentSpeak();
    this.right.stopAgentSpeak();
  },
};

// 互換性維持（既存コードが import { Agent } を使用していても動く）
export const Agent = Agents;
