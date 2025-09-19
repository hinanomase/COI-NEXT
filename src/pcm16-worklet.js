// public/scripts/pcm16-worklet.js
class PCM16WorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inRate = sampleRate; 
    this.buf = [];

    // ---- 1次ローパス（~3kHz）----
    const fc = 3000;
    const x = Math.exp(-2 * Math.PI * fc / this.inRate);
    this.lpfA = 1 - x;   // y += a*(x - y)
    this.lpfY = 0;

    // ---- 簡易VAD（msで管理）----
    this.energyMA = 0;
    this.alpha = 0.08;
    this.thHi = 0.006;     // 開始
    this.thLo = 0.001;     // 終了
    this.silenceMs = 1200;  // 無音 900ms で終了
    this.silentSamplesNeeded = Math.round(this.inRate * this.silenceMs / 1000);
    this.silentSamples = 0;
    this.inSpeech = false;
    this.utterSamples = 0;

    // ---- プレロール（語頭欠落防止） ~220ms ----
    this.preMs = 220;
    this.preN = Math.max(1, Math.round(this.inRate * this.preMs / 1000));
    this.pre = new Int16Array(this.preN);
    this.preIdx = 0;
    this.preFilled = false;
    this.pendingPre = null;              // VAD開始時に一度だけ送る

    // 100ms単位で送る（ネイティブレートのまま）
    this.chunkSamples = Math.round(this.inRate / 10);
    console.log("[Worklet] PCM16WorkletProcessor initialized. inRate:", this.inRate);
  }

  _pushPre(v) {
    this.pre[this.preIdx] = v;
    this.preIdx = (this.preIdx + 1) % this.preN;
    if (this.preIdx === 0) this.preFilled = true;
  }
  _snapshotPre() {
    const n = this.preFilled ? this.preN : this.preIdx;
    const out = new Int16Array(n);
    if (!n) return out;
    if (this.preFilled) {
      const tail = this.preN - this.preIdx;
      out.set(this.pre.subarray(this.preIdx), 0);
      out.set(this.pre.subarray(0, this.preIdx), tail);
    } else {
      out.set(this.pre.subarray(0, n), 0);
    }
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      // LPF
      this.lpfY += this.lpfA * (ch[i] - this.lpfY);
      const s = Math.max(-1, Math.min(1, this.lpfY));

      // VAD
      const prevInSpeech = this.inSpeech;
      this.energyMA = (1 - this.alpha) * this.energyMA + this.alpha * Math.abs(s);
      if (!this.inSpeech && this.energyMA > this.thHi) {
        this.inSpeech = true;
        this.silentSamples = 0;
        this.utterSamples = 0;
        this.pendingPre = this._snapshotPre();
        this.port.postMessage({ type: "vad", state: "start" });
        // デバッグ出力
        console.log("[Worklet][VAD] start, energyMA:", this.energyMA);
      }
      if (this.inSpeech) {
        if (this.energyMA < this.thLo) {
          this.silentSamples++;
          if (this.silentSamples >= this.silentSamplesNeeded) {
            this.inSpeech = false;
            const utterMs = Math.round(this.utterSamples * 1000 / this.inRate);
            this.port.postMessage({ type: "vad", state: "end", utterMs });
            // デバッグ出力
            console.log("[Worklet][VAD] end, utterMs:", utterMs);
          }
        } else {
          this.silentSamples = 0;
        }
        this.utterSamples++;
      }

      // float -> int16
      const v = s < 0 ? s * 0x8000 : s * 0x7FFF;
      this._pushPre(v);
      this.buf.push(v);
    }

    if (this.buf.length >= this.chunkSamples) {
      let payload;
      if (this.pendingPre && this.pendingPre.length) {
        // 最初のチャンクにプレロールを先頭結合
        payload = new Int16Array(this.pendingPre.length + this.buf.length);
        payload.set(this.pendingPre, 0);
        payload.set(this.buf, this.pendingPre.length);
        this.pendingPre = null;
      } else {
        payload = new Int16Array(this.buf.length);
        for (let i = 0; i < this.buf.length; i++) payload[i] = this.buf[i];
      }
      this.buf = [];
      this.port.postMessage(
        { type: "audio", rate: this.inRate, samples: payload.buffer },
        [payload.buffer]
      );
      // デバッグ出力
      // console.log("[Worklet][AUDIO] chunk sent, samples:", payload.length);
    }
    return true;
  }
}
registerProcessor("pcm16-worklet", PCM16WorkletProcessor);
