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
  async showAgent() {
    // hide main app UI
    try { const app = document.getElementById('app'); if (app) app.style.display = 'none'; } catch(e){}

    // create overlay and a dedicated canvas (do not reuse existing canvases)
    if (!document.getElementById('agentOverlay')) {
      const overlay = document.createElement('div'); overlay.id = 'agentOverlay';
      Object.assign(overlay.style, { position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 20000 });
      const container = document.createElement('div'); container.id = 'agentOverlayContainer';
      Object.assign(container.style, { width: 'min(720px, 90vw)', maxWidth: '900px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' });
      const canvas = document.createElement('canvas'); canvas.id = 'agentOverlayCanvas';
      canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.maxHeight = '80vh';
      container.appendChild(canvas);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
    }

    // ensure we initialize the live2d/index library against the new canvas
    this.canvasId = 'agentOverlayCanvas';
    if (!this.indexLibrary) {
      await new Promise((resolve) => { this._onInitResolve = resolve; this.init(); });
    }

    // optional: if the indexLibrary has a method to set a display name, call it
    // try { if (this.indexLibrary && typeof this.indexLibrary.setParticipantName === 'function') this.indexLibrary.setParticipantName(participantName); } catch(e){}

    // start idle animation if available
    // try { this.startAgentSpeak(); } catch (e) {}

    // return when initialization is complete (do not wait for hide)
    return Promise.resolve();
  }

  hideAgent() {
    try { this.stopAgentSpeak(); } catch(e){}
    const overlay = document.getElementById('agentOverlay'); if (overlay) overlay.remove();
    try { const app = document.getElementById('app'); if (app) app.style.display = ''; } catch(e){}
    // no-op for hide promise handling
  }

  // no waitUntilHidden; hide is immediate
}

const Agent = new SetAgent(false, "", modelPath_Agent, resourcePath_Agent, position_Agent, "myCanvas1");

export { Agent }