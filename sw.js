// Service Worker：network-first 优先拉取最新资源，离线时回退缓存（错题数据在 IndexedDB，无需缓存）
const CACHE = 'cuotiben-v2';
const ASSETS = ['./', './index.html', './css/styles.css', './js/app.js', './js/db.js', './js/config.js', './js/ocr.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 网络优先：先请求最新，成功则更新缓存并返回；网络失败才用缓存
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./')))
  );
});
