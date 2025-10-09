// public/scripts/dataAnalyzer.js
// ========================================================
// 開眼率解析 + 瞬目カウント機能
// ========================================================

export class DataAnalyzer {
  constructor(threshold = 20) {
    this.threshold = threshold;
    this.reset();
  }

  // ===== 初期化 =====
  reset() {
    this.totalFrames = 0;
    this.closedFrames = 0;
    this.values = [];
    this.blinkCount = 0;
    this.prevClosed = false; // 直前の状態が「閉眼」か
  }

  // ===== フレーム追加 =====
  add(openPercent) {
    if (openPercent == null || isNaN(openPercent)) return;

    this.totalFrames++;
    this.values.push(openPercent);

    const isClosed = openPercent < this.threshold;

    // 瞬目カウント判定
    if (isClosed && !this.prevClosed) {
      // 開眼→閉眼 の瞬間を記録
      this.blinkCount++;
    }

    // 閉眼フレームのカウント
    if (isClosed) this.closedFrames++;

    // 状態を保持
    this.prevClosed = isClosed;
  }

  // ===== 集計 =====
  summarize() {
    const total = this.totalFrames;
    const closed = this.closedFrames;
    const ratio = total > 0 ? (closed / total) * 100 : 0;
    const avgOpen =
      this.values.length > 0
        ? this.values.reduce((a, b) => a + b, 0) / this.values.length
        : 0;

    return {
      totalFrames: total,
      closedFrames: closed,
      closedRatio: ratio,
      averageOpen: avgOpen,
      blinkCount: this.blinkCount,
      threshold: this.threshold,
    };
  }

  // ===== パネルに出力 =====
  renderToPanel(panelEl) {
    if (!panelEl) {
      console.warn("[DataAnalyzer] dataPanelが見つかりません");
      return;
    }

    const coordLog = panelEl.querySelector("#coordLog");

    let el = panelEl.querySelector(".closed-ratio");
    if (!el) {
      el = document.createElement("div");
      el.className = "closed-ratio";
      el.style.margin = "6px 0";
      el.style.color = "#ffae00";
      el.style.fontWeight = "bold";
      el.style.fontSize = "14px";
      if (coordLog?.parentNode) coordLog.parentNode.insertBefore(el, coordLog);
      else panelEl.appendChild(el);
    }

    const r = this.summarize();
    el.textContent = 
      `開眼率${r.threshold}%未満時間割合: ${r.closedRatio.toFixed(1)}%　` +
      `平均開眼率: ${r.averageOpen.toFixed(1)}%　` +
      `瞬目回数: ${r.blinkCount}回`;

    console.log("[DataAnalyzer] 出力:", el.textContent);
  }
}
