// Armazenamento local (IndexedDB) — tudo fica salvo no próprio tablet.
const DB_NAME = 'caderno-estudos';
const VERSION = 3;
const STORES = ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades'];
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const d = r.result;
        // outra aba com versão nova: fecha esta conexão para não travar
        d.onversionchange = () => { d.close(); location.reload(); };
        res(d);
      };
      r.onblocked = () => {
        document.dispatchEvent(new CustomEvent('caderno-db-blocked'));
      };
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const db = {
  all: s => run(s, 'readonly', st => st.getAll()),
  get: (s, id) => run(s, 'readonly', st => st.get(id)),
  put: (s, v) => run(s, 'readwrite', st => st.put(v)),
  del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  clear: s => run(s, 'readwrite', st => st.clear()),
  // grava muitos itens numa única transação (restauração de backup)
  bulkPut: (s, items) => run(s, 'readwrite', st => { for (const it of items) st.put(it); return null; }),
  STORES,
};

// Configurações simples
const SKEY = 'caderno-config';
const DEFAULTS = {
  fingerDraw: true,
  penSeen: false,
  lang: 'pt_BR',
  autoMode: 'off', // off | text | math
  shapes: true,
  eraserMode: 'partial',
  sort: 'updated',
  aiKey: '',
  aiModel: 'claude-opus-5-5',
};
export const settings = (() => {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { v = {}; }
  return { ...DEFAULTS, ...v };
})();
export function saveSettings() {
  try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* ignora */ }
}
