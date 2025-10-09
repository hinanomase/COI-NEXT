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
//   ※ boyA/boyB の IndexLibrary 内部APIを使用
//     - App_set_Affiliation(1) : 笑顔（親しみ）
//     - App_set_Sadness(1)     : 悲しい
//   モデル初期化は非同期なので、起動後に数回リトライします
// ========================================================
// ========================================================
// 初期表情の設定（左=笑顔 / 右=悲しい）
// ========================================================
function applyInitialExpressions() {
  const tryApply = () => {
    let appliedAny = false;

    // 左（boyA）: 笑顔 (joy)
    const leftLib = Agents.left?.indexLibrary;
    if (leftLib) {
      if (typeof leftLib.App_set_Joy === "function") {
        try {
          leftLib.App_set_Joy(3); 
          console.log("[Agent] 左: 笑顔(App_set_Joy)を適用");
          appliedAny = true;
        } catch (e) {
          console.warn("[Agent] 左: 笑顔適用失敗", e);
        }
      } else {
        console.warn("[Agent] 左: App_set_Joy が未定義");
      }
    }

    // 右（boyB）: 悲しい (Sadness)
    const rightLib = Agents.right?.indexLibrary;
    if (rightLib) {
      if (typeof rightLib.App_set_Sadness === "function") {
        try {
          rightLib.App_set_Sadness(4); 
          console.log("[Agent] 右: 悲しい顔(App_set_Sadness(10))を適用");
          appliedAny = true;
        } catch (e) {
          console.warn("[Agent] 右: 悲しい顔適用失敗", e);
        }
      } else {
        console.warn("[Agent] 右: App_set_Sadness が未定義");
      }
    }

    return appliedAny;
  };

  let retry = 0;
  const maxRetry = 12;
  const timer = setInterval(() => {
    const ok = tryApply();
    retry++;
    if (ok || retry >= maxRetry) {
      clearInterval(timer);
      if (!ok) console.warn("[Agent] 表情適用APIが見つからず、適用を断念しました");
    }
  }, 400);
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
