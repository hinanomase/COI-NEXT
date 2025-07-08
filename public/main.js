document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  const btnMic = document.getElementById('btnMic');
  const overlay = document.getElementById('overlay');

  const BACKEND_URL = "https://coi-next.onrender.com";
  const PROXY_ENDPOINT = `${BACKEND_URL}/api/realtime-proxy`;
  const WEBSOCKET_ENDPOINT = `${BACKEND_URL.replace('http', 'ws')}/ws/function-call`;

  let peerConnection;
  let dataChannel;
  let functionCallSocket;
  let localStream;

  btnStart.onclick = startSession;
  btnMic.onclick = toggleMic;

  function addBubble(text, isUser = false) {
    const container = document.getElementById("chatContainer");
    const div = document.createElement("div");
    div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function startSession() {
    overlay.classList.remove("hidden");
    btnStart.disabled = true;

    peerConnection = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    peerConnection.ontrack = (event) => {
      audioEl.srcObject = event.streams[0];
      Agent.startAgentSpeak();
      audioEl.onended = Agent.stopAgentSpeak;
    };

    peerConnection.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        endSession();
      }
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    } catch (e) {
      alert("マイクが使えません");
      overlay.classList.add("hidden");
      return;
    }

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onmessage = handleOpenAIMessage;

    setupFunctionCallSocket();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResp = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: offer.sdp
    });

    const answerSdp = await sdpResp.text();
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

    overlay.classList.add("hidden");

    // ← 初回の質問（サーバー側が生成）をトリガー
    const requestEvent = { type: "response.create" };
    dataChannel.send(JSON.stringify(requestEvent));
  }

  function handleOpenAIMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.type === "response.done") {
      const content = msg.response?.output?.[0]?.content?.[0]?.transcript ?? "";
      if (content) {
        addBubble(content);
      }
    }

    if (msg.type === "response.content_part.added") {
      Agent.startAgentSpeak();
    }

    if (msg.type === "output_audio_buffer.stopped") {
      Agent.stopAgentSpeak();
      btnMic.disabled = false;
    }
  }

  function toggleMic() {
    if (!localStream) return;
    const enabled = !localStream.getAudioTracks()[0].enabled;
    localStream.getAudioTracks()[0].enabled = enabled;
    btnMic.textContent = enabled ? "Mic Off" : "Mic On";
  }

  function setupFunctionCallSocket() {
    functionCallSocket = new WebSocket(WEBSOCKET_ENDPOINT);
    functionCallSocket.onmessage = (event) => {
      console.log("FunctionCall WS:", event.data);
    };
  }

  function endSession() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (dataChannel) dataChannel.close();
    if (functionCallSocket) functionCallSocket.close();
    if (peerConnection) peerConnection.close();

    btnStart.disabled = false;
    overlay.classList.add("hidden");
  }
});
