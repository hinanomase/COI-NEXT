/**
 * 一連の流れを管理
 */

import { addBubble, fetchQuestion, playTextAsAudio, getUserResponse, playAgentReaction, sendUserResponse, generateAdvice } from './interactions.js';
import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';
import { pendingAdvice } from './websocket.js';
import { startCollecting, stopCollecting, sendEyeLandmarkData } from './mediapipe.js';

export async function startConversation() {
  while (getCurrentQuestion() < getQuestionNum()) {
    const question = await fetchQuestion();
    addBubble(question);

    // エージェント発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "agent", "question");
    await playTextAsAudio(question);
    stopCollecting();

    // ユーザー発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "user", "answer");
    const userText = await getUserResponse();
    await sendUserResponse(userText);
    stopCollecting();

    const isLast = getCurrentQuestion() === getQuestionNum() - 1;
    if (isLast) {
      generateAdvice(); // 非同期で先に投げる（awaitしない）
    }


    // エージェント発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "agent", "reaction");
    const aiText = await playAgentReaction(userText);
    await playTextAsAudio(aiText);
    stopCollecting();

    setCurrentQuestion(getCurrentQuestion()+1);
  }
  // ここで pendingAdvice が届いていれば再生
  if (pendingAdvice) {
    startCollecting(getCurrentQuestion(), "agent", "advice");
    addBubble(pendingAdvice);
    await playTextAsAudio(pendingAdvice);
    stopCollecting();
    await sendEyeLandmarkData();
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
    startCollecting(getCurrentQuestion(), "agent", "advice");
    const advice = await waitForAdvice;
    addBubble(advice);
    await playTextAsAudio(advice);
    stopCollecting();
    await sendEyeLandmarkData();
    endSession();
  }
}
