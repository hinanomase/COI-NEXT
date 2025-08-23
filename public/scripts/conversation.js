// public/scripts/conversation.js
import {
  fetchQuestion,
  playTextAsAudio,
  getUserResponse,
  playAgentReaction,
  sendUserResponse,
  requestAdvicePrompt,
  generateAdvice
} from './interactions.js';
import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';
import { waitForAdvicePrompt } from './websocket.js';

export async function startConversation() {
  while (getCurrentQuestion() < getQuestionNum()) {
    // 1) 質問を取得して読み上げ
    const question = await fetchQuestion();
    await playTextAsAudio(question);

    // 2) 音声でユーザー回答（自動区切り）
    const userText = await getUserResponse();

    // 取りこぼし時は同じ質問をもう一度繰り返す
    if (!userText) {
      // ここではサーバ側には保存せず、同じループを継続
      continue;
    }

    // 3) リアクションを生成して読み上げ
    const aiText = await playAgentReaction(userText);
    if (aiText) await playTextAsAudio(aiText);

    // 4) 回答を保存し、次の質問へ
    await sendUserResponse(userText);
    setCurrentQuestion(getCurrentQuestion() + 1);
  }

  // 最後にアドバイス
  requestAdvicePrompt();
  const prompt = await waitForAdvicePrompt();
  const advice = await generateAdvice(prompt);
  if (advice) await playTextAsAudio(advice);

  endSession();
}
