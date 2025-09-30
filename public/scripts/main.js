// public/scripts/main.js
import { mediapipeInitAndStart, sendEyeLandmarkData, stopCollecting } from "./mediapipe.js";
import { Agent } from "./agent.js";

document.addEventListener("DOMContentLoaded", () => {
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");

  btnStart.onclick = async () => {
    btnStart.disabled = true;
    btnStop.disabled = false; // Stopを有効化
    await mediapipeInitAndStart();
  };

  btnStop.onclick = async () => {
    btnStop.disabled = true;
    stopCollecting();
    await sendEyeLandmarkData(); // サーバに送信
    alert("データを送信しました");
    btnStart.disabled = false; // 再度Start可能にする
  };
});
