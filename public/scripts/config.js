/**
 * 定数の管理
 */

export const BACKEND_URL = "https://coi-next.onrender.com";
// export const BACKEND_URL = "http://127.0.0.1:8000";
export const PROXY_ENDPOINT = `${BACKEND_URL}/api/realtime-proxy`;
export const TRANSCRIPT_PROXY_ENDPOINT = `${BACKEND_URL}/api/transcription-proxy`;
export const TTS_ENDPOINT = `${BACKEND_URL}/api/tts`;
export const WEBSOCKET_ENDPOINT = `${BACKEND_URL.replace('http', 'ws')}/ws/function-call`;
