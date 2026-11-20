// Service worker: deixa o app funcionando offline.
const CACHE = 'caderno-v14';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/editor.js', 'js/ink.js', 'js/shapes.js', 'js/recognize.js', 'js/store.js', 'js/export.js', 'js/ui.js',
  'js/ai.js', 'js/aipanel.js', 'js/importer.js', 'js/hub.js', 'js/perf.js', 'js/plus.js', 'js/sound.js', 'js/nav.js', 'js/goals.js', 'js/quiz.js', 'js/data.js', 'js/voice.js', 'js/quicknotes.js', 'js/tutor.js', 'js/recorder.js', 'js/suggest.js', 'js/events.js', 'js/chave.js', 'js/flow.js', 'js/formulas.js', 'fonts/caveat.woff2', 'fonts/patrick-hand.woff2', 'fonts/indie-flower.woff2', 'fonts/kalam.woff2', 'fonts/shadows-into-light-two.woff2', 'fonts/dancing-script.woff2', 'js/vendor/pdf.min.mjs', 'js/vendor/pdf.worker.min.mjs',
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
  const url = (e.notification.data && e.notification.data.url) || './?v=focus';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow(url)));
});

// Avisos da agenda com o app fechado: o Chrome acorda o app instalado de vez em quando ("periodic sync")
// e aqui conferimos os eventos de amanhã e de hoje direto no banco de dados.
self.addEventListener('periodicsync', e => { if (e.tag === 'lembretes') e.waitUntil(lembretes()); });
const dia = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function lembretes() {
  return new Promise(res => {
    const r = indexedDB.open('caderno-estudos');
    r.onupgradeneeded = () => r.transaction.abort(); // o banco ainda não existe: nada a fazer
    r.onerror = () => res();
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('events')) { db.close(); res(); return; }
      const q = db.transaction('events').objectStore('events').getAll();
      q.onerror = () => { db.close(); res(); };
      q.onsuccess = async () => {
        const hoje = dia(new Date()), amanha = dia(new Date(Date.now() + 86400000));
        const mudou = [];
        for (const ev of q.result) {
          if (ev.remind === false) continue;
          const n = ev.notified || {};
          const tipo = ev.date === amanha && n.before !== ev.date ? 'before' : ev.date === hoje && n.day !== ev.date ? 'day' : null;
          if (!tipo) continue;
          try {
            await self.registration.showNotification(`📅 ${tipo === 'before' ? 'Amanhã' : 'Hoje'}: ${ev.title}`, {
              body: `${ev.time ? `Às ${ev.time}` : 'O dia todo'}${+ev.prio === 3 ? ' · prioridade ALTA' : ''}${ev.notes ? `\n${ev.notes}` : ''}`,
              icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `ev-${ev.id}-${tipo}`, data: { url: './?v=calendar' },
            });
            ev.notified = { ...n, [tipo]: ev.date, ...(tipo === 'day' ? { before: ev.date } : {}) };
            mudou.push(ev);
          } catch { /* sem permissão */ }
        }
        if (!mudou.length) { db.close(); res(); return; }
        const tx = db.transaction('events', 'readwrite');
        for (const ev of mudou) tx.objectStore('events').put(ev);
        tx.oncomplete = tx.onerror = () => { db.close(); res(); };
      };
    };
  });
}
