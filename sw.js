// Service worker: deixa o app funcionando offline.
const CACHE = 'caderno-v5';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/editor.js', 'js/ink.js', 'js/shapes.js', 'js/recognize.js', 'js/store.js', 'js/export.js', 'js/ui.js',
  'js/ai.js', 'js/aipanel.js', 'js/importer.js', 'js/hub.js', 'js/perf.js', 'js/vendor/anthropic-sdk.mjs', 'js/vendor/pdf.min.mjs', 'js/vendor/pdf.worker.min.mjs',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (para receber atualizações), cache se estiver offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./?v=focus')));
});
