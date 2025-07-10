document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  const btnMic = document.getElementById('btnMic');
  const overlay = document.getElementById('overlay');
  const chatContainer = document.getElementById("chatContainer");

  const BACKEND_URL = "https://coi-next.onrender.com";
  // const BACKEND_URL = "http://127.0.0.1:8000";
  const PROXY_ENDPOINT = `${BACKEND_URL}/api/realtime-proxy`;
  const TRANSCRIPT_PROXY_ENDPOINT = `${BACKEND_URL}/api/transcription-proxy`;
  const WEBSOCKET_ENDPOINT = `${BACKEND_URL.replace('http', 'ws')}/ws/function-call`;

  let peerConnection;
  let dataChannel;
  let transcriptionPC;
  let transcriptionDataChannel;
  let functionCallSocket;
  let pendingCalls = {};
  let localStream;
  let currentQuestion = 0;
  const MAX_QUESTIONS = 10;
  let isWaitingForUser = false;


  btnStart.onclick = startSession;
  btnMic.onclick = toggleMic;

  function addBubble(text, isUser = false) {
    const div = document.createElement("div");
    div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  async function startSession() {
    overlay.classList.remove("hidden");
    btnStart.disabled = true;

    peerConnection = new RTCPeerConnection();
    transcriptionPC = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    peerConnection.ontrack = (event) => {
      audioEl.srcObject = event.streams[0]; // 音声再生
      // Agent.startAgentSpeak();
      // audioEl.onended = Agent.stopAgentSpeak;
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Peer connection state:", peerConnection.connectionState);
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        endSession();
      }
      if (peerConnection.connectionState === "connected") {
        console.log("WebRTC connection established");
      }
    };

    transcriptionPC.onconnectionstatechange = () => {
      console.log("Transcription Peer connection state:", transcriptionPC.connectionState);
      if (["failed", "disconnected", "closed"].includes(transcriptionPC.connectionState)) {
        endSession();
      }
      if (transcriptionPC.connectionState === "connected") {
        console.log("Transcription WebRTC connection established");
      }
    };

    try {
      const dummyTrack = createDummyAudioTrack();
      peerConnection.addTrack(dummyTrack, new MediaStream([dummyTrack]));

      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.getTracks().forEach(track => transcriptionPC.addTrack(track, localStream));
    } catch (e) {
      alert("マイクが使えません");
      overlay.classList.add("hidden");
      return;
    }

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      console.log("DataChannel is open - session established");
      startConversation();
    };
    dataChannel.onmessage = handleOpenAIMessage;

    transcriptionDataChannel = transcriptionPC.createDataChannel("oai-events");
    transcriptionDataChannel.onopen = () => {
      console.log("transcription data channel is open - session established");

    };
    transcriptionDataChannel.onmessage = handleOpenAIMessage;

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

    const transcriptOffer = await transcriptionPC.createOffer();
    await transcriptionPC.setLocalDescription(transcriptOffer);

    const resp = await fetch(TRANSCRIPT_PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: transcriptOffer.sdp,
    });

    const answer = await resp.text();
    await transcriptionPC.setRemoteDescription({ type: "answer", sdp: answer });
 

    overlay.classList.add("hidden");
  }

  function createDummyAudioTrack() {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    return dst.stream.getAudioTracks()[0];
  }

  async function startConversation() { // 対話プロセス
    while (currentQuestion < MAX_QUESTIONS) {
      const question = await fetchQuestion();
      await playTextAsAudio(question);
      const userText = await getUserResponse();
      await playAgentReaction(userText);
      await sendUserResponse(userText);
      currentQuestion++;
    }

    endSession();
  }

  async function fetchQuestion() {
    console.log("fetch Question");
    return new Promise((resolve) => {
      const onQuestion = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "question" && msg.index === currentQuestion) {
          functionCallSocket.removeEventListener("message", onQuestion);
          console.log("question:", msg.text);
          resolve(msg.text);
        }
      };
      functionCallSocket.addEventListener("message", onQuestion);

      functionCallSocket.send(JSON.stringify({
        type: "next_question"
      }));
    });
  }

  async function playTextAsAudio(text) { // 質問をTTSリクエスト
    console.log("play question");
    addBubble(text);
    const sessionEvent = {
      type: "session.update",
      session: {
        instructions: "次の回答では質問文をユーザーにそのまま返してください"
      },
    };
    const conversationEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: text,
          }
        ]
      },
    };
    dataChannel.send(JSON.stringify(sessionEvent));
    dataChannel.send(JSON.stringify(conversationEvent));
    dataChannel.send(JSON.stringify({type: 'response.create'}));
    Agent.startAgentSpeak();

    return new Promise(resolve => {
      const onMessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "output_audio_buffer.stopped") {
          Agent.stopAgentSpeak();
          dataChannel.removeEventListener("message", onMessage);
          resolve();
        }
      };
      dataChannel.addEventListener("message", onMessage);
    });
  }

  function getUserResponse() { // ユーザーの回答を文字起こし
    console.log("user response");
    enableMic();
    btnMic.disabled = false;
    return new Promise(resolve => {
      const onMessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const userText = msg.transcript ?? "";
          if (userText) {
            addBubble(userText, true);
            transcriptionDataChannel.removeEventListener("message", onMessage);
            disableMic();
            btnMic.disabled = true;
            console.log("user text", userText);
            resolve(userText);
          }
        }
      };

      transcriptionDataChannel.addEventListener("message", onMessage);
    });
  }

  async function playAgentReaction(text) { // ユーザーの回答に対するリアクション
    console.log("agent reaction");
    const sessionEvent = {
      type: "session.update",
      session: {
        instructions: "次の回答ではユーザーの回答に対して軽くリアクションしてください．追加で質問はしないでください"
      },
    };
    const conversationEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: text,
          }
        ]
      },
    };
    dataChannel.send(JSON.stringify(sessionEvent));
    dataChannel.send(JSON.stringify(conversationEvent));
    dataChannel.send(JSON.stringify({type: 'response.create'}));
    Agent.startAgentSpeak();
    return new Promise(resolve => {
      const onMessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "output_audio_buffer.stopped") {
          Agent.stopAgentSpeak();
          dataChannel.removeEventListener("message", onMessage);
          resolve();
        }
      };
      dataChannel.addEventListener("message", onMessage);
    });
  }
  
  async function sendUserResponse(userText) {
    functionCallSocket.send(JSON.stringify({
      type: "user_response",
      text: userText
    }));
  }


  function handleOpenAIMessage(event) { // エラーハンドリング用
    const msg = JSON.parse(event.data);
    console.log("DataChannel message:", msg);
  }

  function enableMic() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(track => track.enabled = true);
    btnMic.textContent = "Mic Off";
  }

  function disableMic() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(track => track.enabled = false);
    btnMic.textContent = "Mic On";
  }

  function toggleMic() {
    if (!localStream) return;
    const enabled = !localStream.getAudioTracks()[0].enabled;
    localStream.getAudioTracks()[0].enabled = enabled;
    btnMic.textContent = enabled ? "Mic Off" : "Mic On";
  }

  function setupFunctionCallSocket() {
    functionCallSocket = new WebSocket(WEBSOCKET_ENDPOINT);

    functionCallSocket.onopen = () => {
      console.log("Function call WebSocket connected");
    };

    functionCallSocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.call_id) {
        const { call_id, status, result, message } = msg;
        if (pendingCalls[call_id]) {
          if (status === "success") {
            pendingCalls[call_id].resolve(result);
          } else {
            pendingCalls[call_id].reject(new Error(message));
          }
          delete pendingCalls[call_id];
          return;
        }
      }

      switch (msg.type) {
        case "question":
          console.log("次の質問:", msg.text);
          break;

        case "end":
          console.log("すべての質問が終了しました");
          break;

        case "error":
          console.warn("サーバーからのエラー:", msg.message);
          break;

        default:
          console.warn("未知のメッセージ:", msg);
      }
    };
  }

  function callBackendFunction(name, args = {}) {
    return new Promise((resolve, reject) => {
      const call_id = crypto.randomUUID();
      const message = {
        call_id,
        name,
        arguments: JSON.stringify(args)
      };

      pendingCalls[call_id] = { resolve, reject };
      functionCallSocket.send(JSON.stringify(message));
    });
  }

  function endSession() {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (dataChannel) dataChannel.close();
    if (functionCallSocket) functionCallSocket.close();
    if (peerConnection) peerConnection.close();

    btnStart.disabled = false;
    overlay.classList.add("hidden");
    console.log("Session ended");
  }
});
