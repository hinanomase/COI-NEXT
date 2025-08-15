/**
 * 一連の流れを管理
 */

import { fetchQuestion, playTextAsAudio, getUserResponse, playAgentReaction, sendUserResponse, requestAdvicePrompt, generateAdvice } from './interactions.js';
import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';
import { waitForAdvicePrompt } from './websocket.js';
import { startCollecting, stopCollecting, sendEyeLandmarkData } from './mediapipe.js';

export async function startConversation() {
  while (getCurrentQuestion() < getQuestionNum()) {
    const question = await fetchQuestion();

    // エージェント発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "agent", "question");
    await playTextAsAudio(question);
    stopCollecting();

    // ユーザー発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "user", "answer");
    const userText = await getUserResponse();
    stopCollecting();

    // エージェント発話中の目データ収集開始
    startCollecting(getCurrentQuestion(), "agent", "reaction");
    const aiText = await playAgentReaction(userText);
    stopCollecting();

    await sendUserResponse(userText);
    setCurrentQuestion(getCurrentQuestion()+1);
  }
  startCollecting(getCurrentQuestion(), "agent", "advice");
  requestAdvicePrompt();
  const prompt = await waitForAdvicePrompt();
  const advice = await generateAdvice(prompt);
  stopCollecting();
  await sendEyeLandmarkData();

  endSession();
}
