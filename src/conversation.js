// // public/scripts/conversation.js
// import {
//   fetchQuestion,
//   playTextAsAudio,
//   getUserResponse,
//   playAgentReaction,
//   sendUserResponse,
//   requestAdvicePrompt,
//   generateAdvice
// } from './interactions.js';
// import { getCurrentQuestion, setCurrentQuestion, getQuestionNum, endSession } from './session.js';
// import { waitForAdvicePrompt } from './websocket.js';

// export async function startConversation() {
//   while (getCurrentQuestion() < getQuestionNum()) {
//     // 1) 質問を取得して読み上げ
//     const question = await fetchQuestion();
//     await playTextAsAudio(question);

//     // 2) 音声でユーザー回答（自動区切り）
//     const userText = await getUserResponse();

//     // 取りこぼし時は同じ質問をもう一度繰り返す
//     if (!userText) {
//       // ここではサーバ側には保存せず、同じループを継続
//       continue;
//     }

//     // 3) リアクションを生成して読み上げ
//     const aiText = await playAgentReaction(userText);
//     if (aiText) await playTextAsAudio(aiText);

//     // 4) 回答を保存し、次の質問へ
//     await sendUserResponse(userText);
//     setCurrentQuestion(getCurrentQuestion() + 1);
//   }

//   // 最後にアドバイス
//   requestAdvicePrompt();
//   const prompt = await waitForAdvicePrompt();
//   const advice = await generateAdvice(prompt);
//   if (advice) await playTextAsAudio(advice);

//   endSession();
// }

// public/scripts/conversation.js
import * as session from './session.js';
import {
  fetchQuestion,
  playTextAsAudio,
  getUserResponse,
  playAgentReaction,
  sendUserResponse,
  requestAdvicePrompt,
  generateAdvice
} from './interactions.js';
import { audioQueue, currentSource, disableMic, enableMic, playBase64PCM, playBase64PCMQueued } from './audio.js';

// ---- UI要素 ----
const chatContainer = document.getElementById("chatContainer");
const btnStart = document.getElementById('btnStart');
const overlay = document.getElementById('overlay');

// ---- 状態管理 ----
let currentQuestionIndex = 0;
const questions = [
    "最近、心が晴れるような出来事はありましたか？",
    "どんな時にリラックスできると感じますか？",
    "もし一日自由に時間を使えるとしたら、何をしたいですか？"
    // ...質問を追加
];
let userResponses = [];
let resolveUserResponse = null;
let resolveTurnEnd = null;
let audioPlayed = false;

// ========= 初期化とイベント設定 =========
export function initializeConversation() {
    btnStart.addEventListener('click', start);
    btnStart.disabled = true;
    overlay.classList.remove("hidden");
    session.on('session-started', onSessionStarted);
    session.on('session-ended', onSessionEnded);
    session.on('final-transcript', onFinalTranscript);
    session.on('model-text', onModelText);
    session.on('model-audio', onModelAudio);
    session.on('turn-finished', onTurnFinished);
}

function start() {
    btnStart.disabled = true;
    runConversationFlow();
}

function onSessionStarted() {
    btnStart.disabled = false;
    overlay.classList.add("hidden");
    // runConversationFlow(); // セッションが確立されたら対話フローを開始
}

function onSessionEnded() {
    // addBubble("セッションが終了しました。", false);
    // btnStart.disabled = false;
    // overlay.classList.add("hidden");
}

// ========= 対話フロー制御 =========

async function runConversationFlow() {
    currentQuestionIndex = 0;
    userResponses = [];
    
    // 1. 各質問を順番に処理
    while (session.getCurrentQuestion() < session.getQuestionNum()) {
        // 質問を読み上げ
        disableMic(session.getLocalStream());
        const question = await fetchQuestion();
        await askQuestion(question);
        await waitForModelSpeechEnd();
        console.log("complete askQuestion");
        // ユーザーの回答を待つ
        enableMic(session.getLocalStream());
        const userText = await waitForUserResponse();
        disableMic(session.getLocalStream());
        userResponses.push(userText);
        if (!userText) {
            addBubble("うまく聞き取れませんでした。次の質問に進みます。", false);
            continue; // 聞き取れなかったら次へ
        }
        
        // AIのリアクションを待つ
        await waitForTurn();
        session.setCurrentQuestion(session.getCurrentQuestion() + 1);
    }
    
    // 2. 最後にアドバイスを生成
    await generateFinalAdvice();

    // 3. セッション終了
    addBubble("本日はありがとうございました。", false);
    await new Promise(r => setTimeout(r, 1000));
    session.endSession();
}

/** 質問を投げかけ、Geminiに読み上げさせる */
async function askQuestion(questionText) {
    // addBubble(questionText, false);
    audioPlayed = false;
    let questionReasked = false;

    // turnCompleteイベントハンドラ
    async function onTurnFinished() {
        session.off('turn-finished', onTurnFinished);

        if (!audioPlayed) {
            if (questionReasked) {
                alert("音声が再生されませんでした。ページを再読み込みしてください。");
                return;
            }
            questionReasked = true;
            overlay.classList.remove("hidden");
            console.warn("音声が再生されなかったため、セッションを再接続します");
            await session.endSession();
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機
            session.on('session-started', onReStarted);
            await session.startSession();
        }
    }

    // turnCompleteまたは音声再生を待つPromise
    function waitForTurnCompleteOrAudio() {
        return new Promise(resolve => {
            function finish() {
                session.off('turn-finished', finish);
                session.off('model-audio', finish);
                resolve();
            }
            session.on('turn-finished', finish);
            session.on('model-audio', finish);
        });
    }

    async function onReStarted() {
        console.log("セッションが再接続されました");
        session.off('session-started', onReStarted);
            // 再接続後、TTSリクエストを再送
        await new Promise(resolve => setTimeout(resolve, 1000));
        await session.requestQuestionTTS(questionText);
        // 再リクエスト後、turnCompleteを待つ（再帰的に呼び出し）
        btnStart.disabled = true;
        overlay.classList.add("hidden");
        await waitForTurnCompleteOrAudio();

    }

    // イベント監視開始
    session.on('turn-finished', onTurnFinished);

    // TTSリクエスト送信
    await session.requestQuestionTTS(questionText);

    // turnCompleteまたは音声再生を待つ
    await waitForTurnCompleteOrAudio();

    // イベントハンドラ解除
    session.off('turn-finished', onTurnFinished);
}

function waitForModelSpeechEnd() {
    return new Promise(resolve => {
        let turnFinished = false;
        let audioEnded = false;

        function checkEnd() {
            // turn-finished受信済み & audioQueueが空 & currentSourceがnull
            if (turnFinished && audioQueue.length === 0 && currentSource === null) {
                session.off('turn-finished', onTurnFinished);
                // audio.js側でsource.onended時にcheckEnd()を呼ぶ必要あり
                resolve();
            }
        }

        function onTurnFinished() {
            turnFinished = true;
            checkEnd();
        }

        // audio.js側でsource.onended時にcheckEnd()を呼ぶ
        function onAudioEnded() {
            audioEnded = true;
            checkEnd();
        }

        session.on('turn-finished', onTurnFinished);

        // audio.jsでsource.onended時にコールバックを呼ぶ仕組みを追加
        window.addEventListener('model-audio-ended', onAudioEnded);
    });
}

/** ユーザーの音声入力を待ち、最終的なテキストを返す */
function waitForUserResponse() {
    return new Promise(resolve => {
        resolveUserResponse = resolve;
    });
}

/** AIの応答ターン（音声再生など）の完了を待つ */
function waitForTurn() {
    return new Promise(resolve => {
        resolveTurnEnd = resolve;
    });
}

/** 最終的なアドバイスを生成 */
async function generateFinalAdvice() {
    // addBubble("最後に、ここまでの内容を元にしたメッセージをお送りします。", false);
    // const prompt = `以下のユーザーとの対話履歴を元に、ユーザーを励ますポジティブなまとめのメッセージを3文で生成してください。\n\n履歴:\n${userResponses.join("\n")}`;
    // session.sendTextToGemini(prompt);
    // await waitForTurn();
    session.requestAdvice();
}


// ========= session.jsからのイベントハンドラ =========

function onFinalTranscript(transcript) {
    if (resolveUserResponse) {
        addBubble(transcript, true);
        resolveUserResponse(transcript);
        resolveUserResponse = null; // 一度解決したらクリア
    }
}

function onModelText(text) {
    addBubble(text, false);
}

function onModelAudio(audioBuffer) {
    if (audioBuffer && audioBuffer.base64 && audioBuffer.mimeType) {
        playBase64PCMQueued(audioBuffer.base64, audioBuffer.mimeType);
        audioPlayed = true;
    }
}

function onTurnFinished() {
    if (resolveTurnEnd) {
        resolveTurnEnd();
        resolveTurnEnd = null; // 一度解決したらクリア
    }
}


// ========= UIヘルパー =========
function addBubble(text, isUser = false) {
    const div = document.createElement("div");
    div.className = isUser ? "bubble bubble-user" : "bubble bubble-ai";
    div.innerHTML = (text || "").replace(/\n/g, "<br>");
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}