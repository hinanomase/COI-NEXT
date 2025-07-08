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
    this.canvasId = canvasId;
    this.init();
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
        this.indexLibrary.onload();
        return;
      }
      $.getScript(requiredScripts[i], () => loadNext(i + 1));
    };
    loadNext(0);
  }

  startAgentSpeak() {
    if (this.indexLibrary) this.indexLibrary.App_StartSpeak(1.5, 0.25);
  }

  stopAgentSpeak() {
    if (this.indexLibrary) this.indexLibrary.App_StopSpeak();
  }
}

const Agent = new SetAgent(false, "", modelPath_Agent, resourcePath_Agent, position_Agent, "myCanvas1");
