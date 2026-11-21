// Service worker: deixa o app funcionando offline.
const CACHE = 'caderno-v30';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/editor.js', 'js/ink.js', 'js/shapes.js', 'js/recognize.js', 'js/store.js', 'js/export.js', 'js/ui.js',
  'js/ai.js', 'js/aipanel.js', 'js/importer.js', 'js/hub.js', 'js/perf.js', 'js/plus.js', 'js/sound.js', 'js/nav.js', 'js/goals.js', 'js/quiz.js', 'js/data.js', 'js/voice.js', 'js/quicknotes.js', 'js/tutor.js', 'js/recorder.js', 'js/suggest.js', 'js/events.js', 'js/chave.js', 'js/flow.js', 'js/formulas.js', 'js/imagesearch.js', 'js/notify.js', 'js/avisos-core.js', 'js/errors.js', 'js/subjects.js', 'js/plan.js', 'js/inkindex.js', 'js/templates.js', 'js/elements.js', 'js/tools.js', 'js/lock.js', 'js/drive.js', 'js/archie.js', 'js/quickparse.js', 'js/quickadd.js', 'js/swipe.js', 'fonts/caveat.woff2', 'fonts/patrick-hand.woff2', 'fonts/indie-flower.woff2', 'fonts/kalam.woff2', 'fonts/shadows-into-light-two.woff2', 'fonts/dancing-script.woff2', 'js/vendor/pdf.min.mjs', 'js/vendor/pdf.worker.min.mjs',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/badge-96.png', 'icons/archie-aviso.png', 'icons/sc-hoje.png', 'icons/sc-foco.png', 'icons/sc-anotar.png', 'icons/sc-leitura.png', 'icons/archie/analista.webp', 'icons/archie/animado.webp', 'icons/archie/cansado.webp', 'icons/archie/concluiu.webp', 'icons/archie/confiante.webp', 'icons/archie/descansando.webp', 'icons/archie/estudando.webp', 'icons/archie/estudante.webp', 'icons/archie/evolucao.webp', 'icons/archie/feliz.webp', 'icons/archie/focado.webp', 'icons/archie/iniciante.webp', 'icons/archie/lendario.webp', 'icons/archie/mentor.webp', 'icons/archie/neutro.webp', 'icons/archie/pensando.webp', 'icons/archie/planejando.webp', 'icons/archie/retrato.webp', 'icons/archie/surpreso.webp',
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
  // "Compartilhar" de outro app (gravador do Android, galeria, PDF): guarda os arquivos e abre o app para recebê-los
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/compartilhar')) { e.respondWith(receberCompartilhado(req)); return; }
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
  const d = e.notification.data || {};
  // "Adiar 15 min": guarda para avisar de novo (o próprio motor dos avisos entrega na hora)
  if (e.action === 'snooze') { e.waitUntil(adiar(d, 15)); return; }
  const url = d.url || './?v=focus';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => {
    if (!cs.length) return self.clients.openWindow(url);
    const c = cs[0];
    return c.focus().then(() => { try { c.navigate && c.navigate(url); } catch { /* */ } });
  }));
});
async function receberCompartilhado(req) {
  try {
    const fd = await req.formData();
    const files = fd.getAll('arquivos').filter(f => f && f.size).map(f => ({ name: f.name || 'arquivo', type: f.type || '', blob: f, lastModified: f.lastModified || Date.now() }));
    await new Promise(res => {
      const r = indexedDB.open('caderno-estudos');
      r.onerror = () => res();
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); res(); return; }
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ id: 'compartilhado', files, text: String(fd.get('text') || fd.get('title') || ''), at: Date.now() });
        tx.oncomplete = tx.onerror = () => { db.close(); res(); };
      };
    });
  } catch { /* */ }
  return Response.redirect('./?compartilhado=1', 303);
}
function adiar(d, minutes) {
  return new Promise(res => {
    const r = indexedDB.open('caderno-estudos');
    r.onerror = () => res();
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); res(); return; }
      const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
      const g = st.get('avisos');
      g.onsuccess = () => {
        const kv = g.result || { id: 'avisos', fired: {} };
        kv.snoozed = kv.snoozed || {};
        const now = Date.now(), base = String(d.id || 'aviso').replace(/^z-/, '').replace(/-\d+$/, '');
        kv.snoozed[`z-${base}-${now}`] = { at: now + minutes * 60000, title: d.title || 'Lembrete', body: d.body || '', url: d.url || './' };
        st.put(kv);
      };
      tx.oncomplete = tx.onerror = () => { db.close(); res(); };
    };
  });
}

// Avisos com o app fechado: o Chrome acorda o app instalado de vez em quando ("periodic background sync")
// e aqui o mesmo motor da Central de Avisos (js/avisos-core.js) confere o que já devia ter tocado.
importScripts('js/avisos-core.js');
self.addEventListener('periodicsync', e => { if (e.tag === 'lembretes') e.waitUntil(lembretes()); });
const STORES_AVISOS = ['events', 'tasks', 'grades', 'classes', 'cards', 'habits', 'folders', 'sessions', 'errors', 'plans'];
function lembretes(now = Date.now()) {
  return new Promise(res => {
    const r = indexedDB.open('caderno-estudos');
    r.onupgradeneeded = () => r.transaction.abort(); // o banco ainda não existe: nada a fazer
    r.onerror = () => res({ found: 0, shown: 0 });
    r.onsuccess = () => {
      const db = r.result;
      const stores = STORES_AVISOS.filter(s => db.objectStoreNames.contains(s));
      if (!db.objectStoreNames.contains('kv')) { db.close(); res({ found: 0, shown: 0 }); return; }
      const tx = db.transaction([...stores, 'kv']);
      const data = {}; let kv = null;
      for (const s of stores) { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { data[s] = q.result; }; }
      const k = tx.objectStore('kv').get('avisos'); k.onsuccess = () => { kv = k.result || { id: 'avisos', fired: {} }; };
      tx.oncomplete = async () => {
        const C = self.AvisosCore;
        const due = C.due(C.withSnoozes(C.compute(data, kv.prefs || {}, now), kv.snoozed, now), kv.fired || {}, now);
        if (!due.length) { db.close(); res({ found: 0, shown: 0 }); return; }
        kv.fired = kv.fired || {};
        const shown = [];
        for (const a of due) {
          try {
            await self.registration.showNotification(a.title, { body: a.body, tag: a.id, icon: C.ICON, badge: 'icons/badge-96.png', data: { url: a.url, id: a.id, title: a.title, body: a.body }, actions: C.ACTIONS });
            kv.fired[a.id] = now;
            shown.push(a);
          } catch { /* sem permissão: fica para a próxima (o app mostra quando abrir) */ }
        }
        kv.fired = C.prune(kv.fired, now);
        kv.snoozed = C.cleanSnoozes(kv.snoozed, kv.fired, now);
        // o histórico guarda só o que apareceu de verdade
        if (shown.length) kv.history = C.logHistory(kv.history, shown, now);
        const w = db.transaction('kv', 'readwrite');
        w.objectStore('kv').put(kv);
        w.oncomplete = w.onerror = () => { db.close(); res({ found: due.length, shown: shown.length }); };
      };
      tx.onerror = () => { db.close(); res({ found: 0, shown: 0 }); };
    };
  });
}
// (para testes: a página pode pedir ao service worker para conferir os avisos agora)
self.addEventListener('message', e => { if (e.data === 'conferir-avisos') e.waitUntil(lembretes().then(n => e.source && e.source.postMessage({ avisos: n.found, mostrados: n.shown }))); });
