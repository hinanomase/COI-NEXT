/**
 * 定数の管理
 */

//export const BACKEND_URL = "https://coi-next.onrender.com";
export const BACKEND_URL = "http://127.0.0.1:8000";
export const EPHEMERAL_ENDPOINT = `${BACKEND_URL}/api/gemini/ephemeral`;   // ← これで一時トークンを取る
export const TTS_ENDPOINT       = `${BACKEND_URL}/api/tts`;
export const WEBSOCKET_ENDPOINT = `${BACKEND_URL.replace("http", "ws")}/ws/function-call`;
