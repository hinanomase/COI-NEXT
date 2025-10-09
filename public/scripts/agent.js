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
  constructor(debug, serverURL, modelPath, resourcePath, position, canvasId, libraryName) {
    this.debug = debug;
    this.serverURL = serverURL;
    this.modelPathPath = modelPath;
    this.resourcePath = resourcePath;
    this.position = position;
    this.canvasId = canvasId;
    this.indexLibrary = null;
    this.libraryName = libraryName;
    this.init();
  }

  async init() {
    // SDK群を一度だけ読み込み（複数インスタンスが同時に init しても一度だけ実行されるようにする）
    if (!window._Live2D_Core_Promise) {
      window._Live2D_Core_Promise = (async () => {
        await loadScript("https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js");
        await loadScript("https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js");
        window._Live2D_Core_Loaded = true;
        console.log("[Agent] Live2D Core loaded (global)");
      })();
    }

    try {
      await window._Live2D_Core_Promise;
    } catch (e) {
      console.error('[Agent] Live2D core load failed in init:', e);
      // ここで止める
      return;
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
    // 既存スクリプトを starts-with でチェック（?v= の違いで重複追加されないように）
    const exists = Array.from(document.scripts).some(s => s.src && s.src.indexOf(url) === 0);
    if (exists) {
      console.log(`[Agent] loadScript: script already present for ${url}`);
      resolve();
      return;
    }

    const script = document.createElement("script");
    // キャッシュ防止のクエリを付ける
    script.src = url + "?v=" + Date.now();
    script.onload = () => {
      console.log(`[Agent] loadScript: loaded ${url}`);
      resolve();
    };
    script.onerror = (e) => {
      console.error(`[Agent] loadScript: failed to load ${url}`, e);
      reject(e);
    };
    document.head.appendChild(script);
  });
}

// ========================================================
// エージェントは順次生成する（片方の表示完了・表情適用後に次を生成）
// Agents オブジェクトは後でセットされる（初期は null）
export const Agents = { left: null, right: null };
// const AgentLeft = new SetAgent(
//   false,
//   "",
//   modelPath_Agent,
//   resourcePath_Left,
//   position_AgentL,
//   "myCanvas1"
// );
// const AgentRight = new SetAgent(
//   false,
//   "",
//   modelPath_Agent,
//   resourcePath_Right,
//   position_AgentR,
//   "myCanvas2"
// );

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

// 指定エージェントの indexLibrary に対して特定の表情メソッドを呼ぶヘルパー
// getter: () => Agents.left?.indexLibrary など
// methodName: 'App_set_Joy' など
// arg: 数値引数
async function applyExpressionToAgent(getter, methodName, arg, retries = 20, delay = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      const lib = getter();
      if (lib && typeof lib[methodName] === 'function') {
        lib[methodName](arg);
        return true;
      }
    } catch (e) {
      console.warn('[Agent] applyExpressionToAgent attempt failed', methodName, e);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  console.error('[Agent] applyExpressionToAgent: 最大リトライ回数に達しました', methodName);
  return false;
}

// 表情適用は model の表示が完了したことを示すカスタムイベントを受けてから行う
// indexLibrary_boyB.js などが `processCompleted` イベントを dispatch するので、
// `detail.status` に `DisplayCompleted` を含むイベントを受け取ったら実行する。
// トラッキング用の状態: left/right が個別に完了したか（ここで宣言）
const _displayCompletedState = { left: false, right: false };

function _onProcessCompleted(e) {
  try {
    const status = e && e.detail && e.detail.status ? String(e.detail.status) : '';
    if (/DisplayCompleted/.test(status)) {
      console.log('[Agent] processCompleted received:', status);
      // どのエージェントが完了したかをステータスで判定し、個別に表情を適用する
      if (/BoyA/i.test(status)) {
        // 左エージェントに Joy を適用
        applyExpressionToAgent(() => Agents.left?.indexLibrary, 'App_set_Joy', 7).then((ok) => {
          if (ok) {
            console.log('[Agent] 左: 笑顔適用成功 (from event)');
            _displayCompletedState.left = true;
          } else {
            console.warn('[Agent] 左: 笑顔適用に失敗 (from event)');
          }
          if (_displayCompletedState.left && _displayCompletedState.right) {
            console.log('[Agent] 両方の表示完了を受信 → processCompleted リスナを解除');
            document.removeEventListener('processCompleted', _onProcessCompleted);
          }
        });
      } else if (/BoyB/i.test(status)) {
        // 右エージェントに Sadness を適用
        applyExpressionToAgent(() => Agents.right?.indexLibrary, 'App_set_Sadness', 3).then((ok) => {
          if (ok) {
            console.log('[Agent] 右: 悲しい顔適用成功 (from event)');
            _displayCompletedState.right = true;
          } else {
            console.warn('[Agent] 右: 悲しい顔適用に失敗 (from event)');
          }
          if (_displayCompletedState.left && _displayCompletedState.right) {
            console.log('[Agent] 両方の表示完了を受信 → processCompleted リスナを解除');
            document.removeEventListener('processCompleted', _onProcessCompleted);
          }
        });
      } else {
        // 汎用 DisplayCompleted -> 両方適用
        applyInitialExpressions();
        _displayCompletedState.left = true;
        _displayCompletedState.right = true;
        console.log('[Agent] 汎用 DisplayCompleted を受信 → 両方に表情を適用しリスナ解除');
        document.removeEventListener('processCompleted', _onProcessCompleted);
      }
    } else {
      console.log('[Agent] processCompleted received but status not display-completed:', status);
    }
  } catch (err) {
    console.error('[Agent] processCompleted handler error', err);
  }
}

document.addEventListener('processCompleted', _onProcessCompleted);

// processCompleted イベントが来るのを一度だけ待つユーティリティ
function waitForProcessCompleted(matcher, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    function handler(e) {
      const status = e && e.detail && e.detail.status ? String(e.detail.status) : '';
      if (matcher.test(status)) {
        document.removeEventListener('processCompleted', handler);
        if (timer) clearTimeout(timer);
        resolve(status);
      }
    }
    document.addEventListener('processCompleted', handler);
    timer = setTimeout(() => {
      document.removeEventListener('processCompleted', handler);
      reject(new Error('waitForProcessCompleted timeout'));
    }, timeout);
  });
}

// 左→右の順で初期化・表示待ち・表情適用を行う
export async function initAgentsSequentially(debug = false) {
  // 左を生成
  Agents.left = new SetAgent(debug, '', modelPath_Agent, resourcePath_Left, position_AgentL, 'myCanvas1');
  try {
    // 左の表示完了イベント (DisplayCompletedBoyA 等) を待つ
    await waitForProcessCompleted(/DisplayCompleted.*BoyA/i, 15000);
    console.log('[Agent] 左が表示完了 → 表情適用を試行');
    await applyExpressionToAgent(() => Agents.left?.indexLibrary, 'App_set_Joy', 7);
  } catch (e) {
    console.warn('[Agent] 左の表示待ちまたは表情適用で問題:', e);
  }

  // 少し待ってから右を生成
  await new Promise((r) => setTimeout(r, 200));
  Agents.right = new SetAgent(debug, '', modelPath_Agent, resourcePath_Right, position_AgentR, 'myCanvas2');
  try {
    await waitForProcessCompleted(/DisplayCompleted.*BoyB/i, 15000);
    console.log('[Agent] 右が表示完了 → 表情適用を試行');
    await applyExpressionToAgent(() => Agents.right?.indexLibrary, 'App_set_Sadness', 3);
  } catch (e) {
    console.warn('[Agent] 右の表示待ちまたは表情適用で問題:', e);
  }

  return Agents;
}
initAgentsSequentially();
// export const Agents = {
//   left: AgentLeft,
//   right: AgentRight,
//   startSpeak() {
//     this.left.startAgentSpeak();
//     this.right.startAgentSpeak();
//   },
//   stopSpeak() {
//     this.left.stopAgentSpeak();
//     this.right.stopAgentSpeak();
//   },
// };

// // 互換性維持（既存コードが import { Agent } を使用していても動く）
// export const Agent = Agents;
