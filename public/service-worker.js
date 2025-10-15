const CACHE_NAME = 'coi-next-v1';
const ASSETS_TO_CACHE = [
  './',              // maps to /public/
  './index.html',
  './styles.css',
  './manifest.json',
  './scripts/main.js',
  './scripts/mediapipe.js',
  './scripts/interactions.js',
  './scripts/agent.js',
  './scripts/audio.js',
  // 必要に応じて他の静的ファイルを追加
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API は network-first にする（/api/ を例外）
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // それ以外は cache-first
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});