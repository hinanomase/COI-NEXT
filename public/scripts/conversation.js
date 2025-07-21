/**
 * 一連の流れを管理
 */

import { addBubble, fetchQuestion, playTextAsAudio, getUserResponse, playAgentReaction, sendUserResponse, generateAdvice } from './interactions.js';
import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';
import { pendingAdvice } from './websocket.js';

export async function startConversation() {
  while (getCurrentQuestion() < getQuestionNum()) {
    const question = await fetchQuestion();
    addBubble(question);
    await playTextAsAudio(question);

    const userText = await getUserResponse();
    await sendUserResponse(userText);

    const isLast = getCurrentQuestion() === getQuestionNum() - 1;
    if (isLast) {
      generateAdvice(); // 非同期で先に投げる（awaitしない）
    }

    const aiText = await playAgentReaction(userText);
    await playTextAsAudio(aiText);

    setCurrentQuestion(getCurrentQuestion()+1);
  }
  // ここで pendingAdvice が届いていれば再生
  if (pendingAdvice) {
    addBubble(pendingAdvice);
    await playTextAsAudio(pendingAdvice);
    endSession();
  } else {
    // 念のため遅延で待つ（アドバイスが遅れて届くケース）
    const waitForAdvice = new Promise(resolve => {
      const check = () => {
        if (pendingAdvice) {
          resolve(pendingAdvice);
        } else {
          setTimeout(check, 200); // 0.2秒ごとに確認
        }
      };
      check();
    });

    const advice = await waitForAdvice;
    addBubble(advice);
    await playTextAsAudio(advice);
    endSession();
  }
}
