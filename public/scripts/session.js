/**
 * Realtime APIやFastAPIサーバーとの通信を確立する
 */

import { setupWebSocket } from './websocket.js';
import { waitForConnectionState, waitForDataChannelOpen, createDummyAudioTrack } from './utils.js';
import { startConversation } from './conversation.js';
import { BACKEND_URL, PROXY_ENDPOINT, TRANSCRIPT_PROXY_ENDPOINT } from './config.js';
import { restoreConversationHistory } from './interactions.js';

export let peerConnection;
export let dataChannel;
export let transcriptionPC;
export let transcriptionDataChannel;
export let webSocket;
export let bufferedSessionState = null;
export let pendingCalls = {};
export let localStream;
export let currentQuestion = 0;
export let questionNum = 0;

export async function startSession() {
  const overlay = document.getElementById('overlay');
  const btnStart = document.getElementById('btnStart');

  overlay.classList.remove("hidden");
  btnStart.disabled = true;

  try {
    peerConnection = new RTCPeerConnection();
    transcriptionPC = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    peerConnection.ontrack = (event) => {
      audioEl.srcObject = event.streams[0];
      console.log("onTrack");
    };

    peerConnection.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        endSession();
      }
    };

    transcriptionPC.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(transcriptionPC.connectionState)) {
        endSession();
      }
    };

    const dummyTrack = createDummyAudioTrack();
    peerConnection.addTrack(dummyTrack, new MediaStream([dummyTrack]));

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => transcriptionPC.addTrack(track, localStream));

    dataChannel = peerConnection.createDataChannel("oai-events");
    transcriptionDataChannel = transcriptionPC.createDataChannel("oai-events");

    const webSocketPromise = setupWebSocket();

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

    await Promise.all([
      waitForConnectionState(peerConnection),
      waitForConnectionState(transcriptionPC),
      waitForDataChannelOpen(dataChannel),
      waitForDataChannelOpen(transcriptionDataChannel),
      webSocketPromise
    ]);

    dataChannel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[DataChannel]", msg);
      } catch (err) {
        console.error("Invalid DataChannel message:", event.data);
      }
    };
    transcriptionDataChannel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[DataChannel]", msg);
      } catch (err) {
        console.error("Invalid DataChannel message:", event.data);
      }
    };

    if(getBufferedSessionState()) 
      await restoreConversationHistory(getBufferedSessionState());

    overlay.classList.add("hidden");
    startConversation();
  } catch (error) {
    console.error("セッション開始中にエラー:", error);
    alert("接続に失敗しました。もう一度お試しください。");
    overlay.classList.add("hidden");
    btnStart.disabled = false;
    endSession();
  }
}

export function endSession() {
  const sessionId = localStorage.getItem("session_id");

  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify({
      type: "end_session",
      session_id: sessionId
    }));
  }

  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (dataChannel) dataChannel.close();
  if (webSocket) webSocket.close();
  if (peerConnection) peerConnection.close();

  document.getElementById('btnStart').disabled = false;
  document.getElementById('overlay').classList.add("hidden");

  localStorage.removeItem("session_id");
}


export function getQuestionNum() {
  return questionNum;
}

export function setQuestionNum(value) {
  questionNum = value;
}

export function getCurrentQuestion() {
  return currentQuestion;
}

export function setCurrentQuestion(value) {
  currentQuestion = value;
}

export function getBufferedSessionState() {
  return bufferedSessionState;
}

export function setBufferedSessionState(state) {
  bufferedSessionState = state;
}
