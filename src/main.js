
// public/scripts/main.js
import { initializeConversation } from './conversation.js';
import { startSession } from './session.js';
import { Agent } from './agent.js';

// DOMが読み込まれたら初期化処理を実行
window.addEventListener('DOMContentLoaded', () => {
    initializeConversation();
    document.addEventListener('processCompleted', (e) => {
        if (e.detail && e.detail.status === 'DisplayCompletedBoyA') {
            console.log("Agent(BoyA)表示完了。セッション初期化を開始します。");
            startSession();
        }
    });
});