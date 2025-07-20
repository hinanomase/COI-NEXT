/**
 * 一連の流れを管理
 */

import { addBubble, fetchQuestion, playTextAsAudio, getUserResponse, playAgentReaction, sendUserResponse, generateAdvice } from './interactions.js';
import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';

export async function startConversation() {
  while (getCurrentQuestion() < getQuestionNum()) {
    const question = await fetchQuestion();
    addBubble(question);
    await playTextAsAudio(question);
    const userText = await getUserResponse();
    const aiText = await playAgentReaction(userText);
    await playTextAsAudio(aiText);
    await sendUserResponse(userText);
    setCurrentQuestion(getCurrentQuestion()+1);
  }
  await generateAdvice();

  // endSession();
}
