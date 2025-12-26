/**
 * 定数の管理
 */

// export const BACKEND_URL = "https://coi-next.onrender.com";
export const BACKEND_URL = "http://127.0.0.1:8000";
export const PROXY_ENDPOINT = `${BACKEND_URL}/api/realtime-proxy`;
export const TRANSCRIPT_PROXY_ENDPOINT = `${BACKEND_URL}/api/transcription-proxy`;
export const TTS_ENDPOINT = `${BACKEND_URL}/api/tts`;
export const TRANSCRIPTION_ENDPOINT = `${BACKEND_URL}/api/transcription`;
export const CHAT_COMPLETION_ENDPOINT = `${BACKEND_URL}/api/chat_completion`;
export const WEBSOCKET_ENDPOINT = `${BACKEND_URL.replace('http', 'ws')}/ws/function-call`;
export const EYE_LANDMARKS = [
  33, 133, 160, 159, 158, 144, 145, 153, 468, 469, 470, 471, 472, // 左目
  362, 263, 387, 386, 385, 373, 374, 380, 473, 474, 475, 476, 477  // 右目
];