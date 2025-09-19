export function createDummyAudioTrack() {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const dst = oscillator.connect(ctx.createMediaStreamDestination());
  oscillator.start();
  return dst.stream.getAudioTracks()[0];
}

export function waitForDataChannelOpen(channel) {
  return new Promise((resolve, reject) => {
    if (channel.readyState === "open") return resolve();
    channel.onopen = () => resolve();
    channel.onerror = () => reject(new Error("DataChannel接続に失敗しました"));
  });
}

export function waitForConnectionState(pc) {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === "connected") return resolve();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") resolve();
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        reject(new Error("WebRTC接続に失敗しました"));
      }
    };
  });
}
