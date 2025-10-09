// public/scripts/gazeAnalyzer.js
// ========================================================
// 視線割合（左/右エージェント注視）の計測ユーティリティ
// 既存の「視線可視化ドット」が gaze:point を出していればそれを使用。
// 出していなくても、ランドマーク中心(x,y)から推定できるフォールバック付き。
// ========================================================

export class GazeAnalyzer {
  /**
   * @param {Object} opts
   * @param {boolean} [opts.mirror=false]  // 前面カメラの鏡像がある場合は true
   * @param {number}  [opts.expand=40]     // 当たり判定を広げる余白(px)
   */
  constructor(opts = {}) {
    this.mirror = !!opts.mirror;
    this.expand = Number.isFinite(opts.expand) ? opts.expand : 40;

    this.lastTs = null;
    this.leftMs = 0;
    this.rightMs = 0;

    this._lastDot = null; // {x:0..1, y:0..1, ts:ms}

    // 可視化ドットのイベント（あれば使う）
    this._eventHandler = (ev) => {
      const x = ev?.detail?.x;
      const y = ev?.detail?.y;
      if (x == null || y == null) return;
      let gx = Math.max(0, Math.min(1, Number(x)));
      let gy = Math.max(0, Math.min(1, Number(y)));
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
      if (this.mirror) gx = 1 - gx;
      this._lastDot = { x: gx, y: gy, ts: (ev?.detail?.ts ?? performance.now()) };
    };
  }

  start() {
    window.addEventListener("gaze:point", this._eventHandler);
    this.reset();
  }
  stop() {
    window.removeEventListener("gaze:point", this._eventHandler);
  }
  reset() {
    this.lastTs = null;
    this.leftMs = 0;
    this.rightMs = 0;
    this._lastDot = null;
  }

  _expandRect(r, pad) {
    if (!r) return null;
    return {
      left:   r.left - pad,
      top:    r.top - pad,
      right:  r.right + pad,
      bottom: r.bottom + pad,
    };
  }
  _dotToPage(gx, gy) {
    // 優先: キャリブ可視化のオーバーレイ（存在するなら）
    const wrapper = document.getElementById("agentCalibOverlay");
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + gx * rect.width,
        y: rect.top  + window.scrollY + gy * rect.height,
      };
    }
    // 次点: myCanvas3（上段全面）
    const c3 = document.getElementById("myCanvas3");
    if (c3) {
      const rect = c3.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + gx * rect.width,
        y: rect.top  + window.scrollY + gy * rect.height,
      };
    }
    // 最後の手段: 画面上半分を上段とみなす
    return {
      x: window.scrollX + gx * window.innerWidth,
      y: window.scrollY + gy * (window.innerHeight / 2),
    };
  }

  /**
   * 1フレーム更新
   * @param {number} ts  - フレームのタイムスタンプ(ms)
   * @param {Array}  eye - ランドマーク配列（フォールバック用）
   */
  update(ts, eye) {
    let src = this._lastDot;
    let gx = null, gy = null;

    // 1) 可視化ドットが直近で取得できていればそれを使用
    if (src && (ts == null || src.ts <= ts + 33)) {
      gx = src.x; gy = src.y;
    } else if (eye && eye.length) {
      // 2) フォールバック：ランドマーク中心 x/y を 0..1 として利用
      const mid = eye[Math.floor(eye.length / 2)];
      gx = Math.max(0, Math.min(1, Number(mid?.x ?? 0.5)));
      gy = Math.max(0, Math.min(1, Number(mid?.y ?? 0.5)));
      if (this.mirror) gx = 1 - gx;
    } else {
      return;
    }

    // ページ座標へ
    const pos = this._dotToPage(gx, gy);
    const c1 = document.getElementById("myCanvas1");
    const c2 = document.getElementById("myCanvas2");
    if (!c1 || !c2) return;

    const r1 = this._expandRect(c1.getBoundingClientRect(), this.expand);
    const r2 = this._expandRect(c2.getBoundingClientRect(), this.expand);

    // 左右の境界（キャンバス間の中点X）
    const midX = ((r1.right + r2.left) / 2) + window.scrollX;

    const now = (typeof ts === "number") ? ts : performance.now();
    const dt  = this.lastTs ? Math.max(0, now - this.lastTs) : 0;
    this.lastTs = now;

    if (dt > 0) {
      if (pos.x <= midX) this.leftMs += dt;
      else               this.rightMs += dt;
    }
  }

  getRatio() {
    const total = this.leftMs + this.rightMs;
    if (total <= 0) return { left: 0, right: 0 };
    return {
      left:  Math.round((this.leftMs  / total) * 100),
      right: Math.round((this.rightMs / total) * 100),
    };
  }

  renderToPanel(panel) {
    if (!panel) return;
    // coordLog の上に固定しておくとログで消されない
    const coordLog = panel.querySelector("#coordLog");
    let el = document.getElementById("attentionInfo");
    if (!el) {
      el = document.createElement("div");
      el.id = "attentionInfo";
      el.style.margin = "6px 0";
      el.style.fontSize = "12px";
      el.style.opacity = "0.9";
      if (coordLog?.parentNode) {
        coordLog.parentNode.insertBefore(el, coordLog);
      } else {
        panel.appendChild(el);
      }
    }
    const { left, right } = this.getRatio();
    el.textContent = `注視割合: 左 ${left}% / 右 ${right}%`;
  }
}
