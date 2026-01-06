const position_Agent = { boxWidth: 2500, boxHeight: 2500, modelScale: 0.56, modelX: 200, modelY: 2000 };

const modelPath_Agent = "https://cdn.jsdelivr.net/gh/TeradaLab-Agents/Agent-Misaki@1f5d8f07eb2b7396c5309b200a4d8a6515c06ba4/GeminoidF/moc/GeminoidF_new2/GeminoidF_new2.model3.json";
const resourcePath_Agent = "https://cdn.jsdelivr.net/gh/TeradaLab-Agents/Agent-Misaki@1f5d8f07eb2b7396c5309b200a4d8a6515c06ba4/js/indexLibrary_boyA.js";

class SetAgent {
  constructor(debug, serverURL, modelPath, resourcePath, position, canvasId) {
    this.debug = debug;
    this.serverURL = serverURL;
    this.modelPathPath = modelPath;
    this.resourcePath = resourcePath;
    this.position = position;
    this.canvasId = canvasId || null;
    this.indexLibrary = null;
    // do not auto-init here; init when showAgent is called so we don't touch existing canvases
  }

  init() {
    const requiredScripts = [
      "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
      "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
      this.resourcePath
    ];
    const loadNext = (i) => {
      if (i >= requiredScripts.length) {
        this.indexLibrary = new IndexLibrary(this.debug, this.serverURL, this.modelPathPath, this.position, this.canvasId);
        try { this.indexLibrary.onload(); } catch (e) { console.warn('[Agent] indexLibrary.onload failed', e); }
        // resolve any pending init promise
        try { if (typeof this._onInitResolve === 'function') { this._onInitResolve(); this._onInitResolve = null; } } catch(e){}
        return;
      }
      $.getScript(requiredScripts[i], () => loadNext(i + 1));
    };
    loadNext(0);
  }

  startAgentSpeak() {
    if (this.indexLibrary && typeof this.indexLibrary.App_StartSpeak === 'function') this.indexLibrary.App_StartSpeak(1.5, 0.25);
  }

  stopAgentSpeak() {
    if (this.indexLibrary && typeof this.indexLibrary.App_StopSpeak === 'function') this.indexLibrary.App_StopSpeak();
  }

  // show the agent in a centered, full-screen overlay.
  // Resolves when the agent visuals are initialized and ready.
  async showAgent(opts = {}) {
    console.debug('[Agent] showAgent called with opts:', opts);
    console.log('[Agent] showAgent called with opts:', opts);
    // fallback visibility for errors
    try { console.debug('[Agent][dbg] opts (debug)', opts); } catch(e){}
    // hide main app UI
    try { const app = document.getElementById('app'); if (app) app.style.display = 'none'; } catch(e){}

    // If an indexLibrary exists, attempt to fully destroy it so it won't hold onto a stale WebGL context.
    if (this.indexLibrary) {
      try {
        console.debug('[Agent] pre-show cleanup of existing indexLibrary');
        if (typeof this.indexLibrary.destroy === 'function') {
          try { this.indexLibrary.destroy(); } catch(e) { console.debug('[Agent] indexLibrary.destroy() threw', e); }
        }
        // common names used by various libs
        try { if (this.indexLibrary.app && typeof this.indexLibrary.app.destroy === 'function') this.indexLibrary.app.destroy(true); } catch(e) { console.debug('[Agent] app.destroy failed', e); }
        try { if (this.indexLibrary.pixiApp && typeof this.indexLibrary.pixiApp.destroy === 'function') this.indexLibrary.pixiApp.destroy(true); } catch(e) { console.debug('[Agent] pixiApp.destroy failed', e); }
        try { if (this.indexLibrary.renderer && typeof this.indexLibrary.renderer.destroy === 'function') this.indexLibrary.renderer.destroy(true); } catch(e) { console.debug('[Agent] renderer.destroy failed', e); }
      } catch(e) { console.debug('[Agent] pre-show cleanup error', e); }
      // always clear reference to force fresh init
      this.indexLibrary = null;
    }

    // remove any previous overlay/canvas to ensure fresh context
    try { const prev = document.getElementById('agentOverlay'); if (prev && prev.parentNode) prev.parentNode.removeChild(prev); } catch(e){}

    // create overlay and a dedicated canvas (always create new canvas to avoid stale WebGL)
    const uniqueCanvasId = 'agentOverlayCanvas_' + Date.now();
    const overlay = document.createElement('div'); overlay.id = 'agentOverlay';
    // reserve right-side space for agentOverlayChat (right:6vw + maxWidth:36vw = 42vw)
    Object.assign(overlay.style, { position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 20000, paddingRight: '42vw', boxSizing: 'border-box' });
    const container = document.createElement('div'); container.id = 'agentOverlayContainer';
    // limit container width so it doesn't extend into the reserved chat area
    Object.assign(container.style, { width: 'min(720px, calc(90vw - 42vw))', maxWidth: '900px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', boxSizing: 'border-box' });
    const canvas = document.createElement('canvas'); canvas.id = uniqueCanvasId;
    canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.maxHeight = '80vh';
    container.appendChild(canvas);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // ensure we initialize the live2d/index library against the new canvas
    this.canvasId = uniqueCanvasId;
    // Always initialize fresh indexLibrary to ensure a new WebGL context bound to the new canvas.
    try { this.indexLibrary = null; } catch(e){}
    await new Promise((resolve) => { this._onInitResolve = resolve; this.init(); });

    // optional: if the indexLibrary has a method to set a display name, call it
    // try { if (this.indexLibrary && typeof this.indexLibrary.setParticipantName === 'function') this.indexLibrary.setParticipantName(participantName); } catch(e){}

    // start idle animation if available
    // try { this.startAgentSpeak(); } catch (e) {}

    // debug: print a short summary after a small delay so internals have time to attach
    try {
      setTimeout(() => {
        try {
          console.debug('[Agent] post-init summary', {
            canvasId: this.canvasId,
            canvasEl: document.getElementById(this.canvasId),
            hasIndexLibrary: !!this.indexLibrary,
            indexLibraryKeys: this.indexLibrary ? Object.keys(this.indexLibrary) : null,
            hasPixiApp: this.indexLibrary ? !!this.indexLibrary.pixiApp : null,
            hasRenderer: this.indexLibrary ? !!this.indexLibrary.renderer : null
          });
        } catch (e) { console.debug('[Agent] post-init debug failed', e); }
      }, 200);
    } catch (e) {}

    // return when initialization is complete (do not wait for hide)
    return Promise.resolve();
  }

  hideAgent() {
    try { this.stopAgentSpeak(); } catch(e){}
    // attempt to clean up indexLibrary if it provides a destroy method
    try {
      if (this.indexLibrary) {
        try { if (typeof this.indexLibrary.destroy === 'function') this.indexLibrary.destroy(); } catch(e) { console.debug('[Agent] indexLibrary.destroy failed', e); }
        // keep reference cleared so next show triggers full init
        this.indexLibrary = null;
      }
    } catch(e) { console.debug('[Agent] hideAgent cleanup failed', e); }
    // attempt to lose any WebGL contexts created by our canvases
    try {
      const canvases = document.querySelectorAll('[id^="agentOverlayCanvas_"]');
      canvases.forEach(c => {
        try {
          const gl = c.getContext('webgl') || c.getContext('webgl2') || c.getContext('experimental-webgl');
          if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext && typeof ext.loseContext === 'function') {
              try { ext.loseContext(); } catch(e) { console.debug('[Agent] loseContext failed', e); }
            }
          }
        } catch (e) { console.debug('[Agent] canvas context lose failed', e); }
      });
    } catch(e) { console.debug('[Agent] canvases iterate failed', e); }

    const overlay = document.getElementById('agentOverlay'); if (overlay) overlay.remove();
    try { const app = document.getElementById('app'); if (app) app.style.display = ''; } catch(e){}
    // no-op for hide promise handling
  }

  // no waitUntilHidden; hide is immediate
}

const Agent = new SetAgent(false, "", modelPath_Agent, resourcePath_Agent, position_Agent, null);
// const Agent = new SetAgent(false, "", modelPath_Agent, resourcePath_Agent, position_Agent, "myCanvas1");

export { Agent }