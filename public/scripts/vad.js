// VAD helper using the provided PCM16 AudioWorklet (pcm16-worklet.js)
// Exports: recordVAD(options) -> Promise<{ blob: Blob, sampleRate, durationMs }>

export async function recordVAD({ maxDurationSec = 30, debug = false } = {}) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // load worklet module (served from /scripts/pcm16-worklet.js)
  try {
    await audioContext.audioWorklet.addModule('/scripts/pcm16-worklet.js');
  } catch (e) {
    if (debug) console.error('[VAD] failed to load worklet', e);
    throw e;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = audioContext.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioContext, 'pcm16-worklet');

  src.connect(node);

  let chunks = [];
  let sampleRate = audioContext.sampleRate || 48000;
  let inSpeech = false;
  let resolved = false;

  const stopAll = () => {
    try { src.disconnect(node); } catch (e) {}
    try { node.disconnect(); } catch (e) {}
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { audioContext.close(); } catch (e) {}
  };

  const toWavBlob = (int16Chunks, rate) => {
    // concat
    let totalLen = int16Chunks.reduce((s, a) => s + a.length, 0);
    const out = new Int16Array(totalLen);
    let offset = 0;
    for (const c of int16Chunks) {
      out.set(c, offset); offset += c.length;
    }

    // WAV header + PCM16 little endian
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample * 1; // mono
    const byteRate = rate * blockAlign;
    const dataSize = out.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let p = 0;
    function writeString(s) { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); }
    writeString('RIFF'); view.setUint32(p, 36 + dataSize, true); p += 4; writeString('WAVE');
    writeString('fmt '); view.setUint32(p, 16, true); p += 4; view.setUint16(p, 1, true); p += 2; // PCM
    view.setUint16(p, 1, true); p += 2; // channels
    view.setUint32(p, rate, true); p += 4; view.setUint32(p, byteRate, true); p += 4;
    view.setUint16(p, blockAlign, true); p += 2; view.setUint16(p, bytesPerSample * 8, true); p += 2;
    writeString('data'); view.setUint32(p, dataSize, true); p += 4;
    // PCM data
    const dv = new DataView(buffer, 44);
    let idx = 0;
    for (let i = 0; i < out.length; i++) { dv.setInt16(idx, out[i], true); idx += 2; }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stopAll();
        if (chunks.length) {
          const blob = toWavBlob(chunks, sampleRate);
          resolve({ blob, sampleRate, durationMs: Math.round((chunks.reduce((s,a)=>s+a.length,0)/sampleRate)*1000) });
        } else {
          reject(new Error('No audio captured before timeout'));
        }
      }
    }, maxDurationSec * 1000);

    node.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'audio') {
        // samples is transferred ArrayBuffer containing Int16 data
        try {
          const ab = msg.samples;
          const int16 = new Int16Array(ab);
          chunks.push(int16);
        } catch (e) { if (debug) console.error('[VAD] audio chunk error', e); }
      } else if (msg.type === 'vad') {
        if (msg.state === 'start') {
          inSpeech = true;
          if (debug) console.debug('[VAD] start');
        } else if (msg.state === 'end') {
          // finalize
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            stopAll();
            try {
              const blob = toWavBlob(chunks, sampleRate);
              const durationMs = msg.utterMs || Math.round((chunks.reduce((s,a)=>s+a.length,0)/sampleRate)*1000);
              resolve({ blob, sampleRate, durationMs });
            } catch (e) { reject(e); }
          }
        }
      }
    };
  });

  return promise;
}

export default { recordVAD };
