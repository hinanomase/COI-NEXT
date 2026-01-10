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
export const AGENT_TEXT = [
  "今から、あなたの心の状態を測定するテストを行います。数分間の映画のワンシーンを見て、簡単な実験とアンケートを行います。\n\
  まず初めにアンケートに回答していただきます。\n\
  3つの質問に対し、今のあなたの状態を9段階から選んでください。\n\
  \n\
  まず、「今の気分」を選んでください。", 

  "ありがとうございました。最後にアンケートに回答していただきます。\n\
  3つの質問に対し、今のあなたの状態を9段階から選んでください。\n\
  まず、「今の気分」を選んでください。",

  "次に「今の覚醒状態」を選んでください。",

  "この設問では「3」を選んでください。",

  "次に「今の不安」はどのくらいですか？",

  "最後に、今のあなたは、この状況をどれくらい自分でコントロールできていると感じますか？",

  "ご回答ありがとうございました。\n\
  この実験では視線の動きを取得するため、キャリブレーションを行います。画面の指示に従い、視線だけで黄色い点を追ってください。\n\
  キャリブレーション終了後も、なるべく頭を動かさないようにリラックスしてください。\n\
  またこの後は、次に私が出てくるまで画面を操作する必要はありません。画面の指示に従って進めてください。\n\
  では、準備ができたら「次へ」を押してください。",

  "ご回答ありがとうございました。これにて実験は終了となります。お疲れ様でした。"
];