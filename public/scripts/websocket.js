/**
 * FastAPIサーバーとのWebSocket通信
 */

import { WEBSOCKET_ENDPOINT } from './config.js';
import { pendingCalls, setBufferedSessionState, setCurrentQuestion, setQuestionNum } from './session.js';

export let webSocket;

export function setupWebSocket() {
  return new Promise((resolve, reject) => {
    webSocket = new WebSocket(WEBSOCKET_ENDPOINT);

    webSocket.onopen = () => {
      console.log("WebSocket connected");
      webSocket.send(JSON.stringify({
        type: "init_session",
        session_id: localStorage.getItem("session_id") ?? null
      }));
      resolve();
    };

    webSocket.onerror = () => reject(new Error("WebSocket接続に失敗しました"));
    webSocket.onclose = () => reject(new Error("WebSocketが閉じられました"));

    webSocket.onmessage = (event) => {
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
        case "session_initialized":
          console.log("新しいセッションが初期化されました:", msg.session_id);
          localStorage.setItem("session_id", msg.session_id);
          setQuestionNum(msg.question_length || 0);
          break;

        case "session_loaded":
          console.log("セッションが復元されました:", msg.session_id);
          localStorage.setItem("session_id", msg.session_id);
          setBufferedSessionState(msg.state);
          setCurrentQuestion(msg.state.current_index || 0);
          setQuestionNum(msg.state.questions?.length || 0);
          break;

        case "question":
          console.log("次の質問:", msg.text);
          break;

        case "response_stored":
          console.log("回答が保存されました");
          break;

        case "end":
          console.log("すべての質問が終了しました");
          break;

        case "session_timeout":
          console.log(msg.message);
          alert(msg.message);
          break;

        case "error":
          console.warn("サーバーからのエラー:", msg.message);
          break;

        default:
          console.warn("未知のメッセージ:", msg);
      }
    };
  });
}
