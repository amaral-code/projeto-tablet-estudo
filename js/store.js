// Banco de dados local (IndexedDB) — tudo fica salvo no próprio tablet, sem precisar de conta.
const DB_NAME = 'caderno-estudos';
const VERSION = 10;
// Coleções com os dados do estudante (entram no backup)
const STORES = ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads',
  'grades', 'classes', 'journal', 'goals', 'quizzes', 'quicknotes', 'chats', 'recordings', 'events', 'images', 'errors', 'plans'];
// Coleções internas
const INTERNAL = ['snapshots', 'kv']; // kv: dados internos (ex.: avisos já mostrados, lidos também com o app fechado)
export const STORE_LABELS = {
  folders: 'Pastas', notes: 'Anotações', pages: 'Páginas das anotações', tasks: 'Tarefas', sessions: 'Sessões de foco',
  habits: 'Hábitos', decks: 'Baralhos', cards: 'Flashcards', books: 'Livros', reads: 'Registros de leitura',
  grades: 'Notas e provas', classes: 'Aulas do horário', journal: 'Dias do diário', goals: 'Metas', quizzes: 'Simulados',
  quicknotes: 'Notas rápidas', chats: 'Conversas com o tutor', recordings: 'Gravações de aula', events: 'Eventos da agenda', images: 'Imagens salvas',
  errors: 'Caderno de erros', plans: 'Planos de estudo',
};
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of [...STORES, ...INTERNAL]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const d = r.result;
        // outra aba com versão nova: fecha esta conexão para não travar
        d.onversionchange = () => { document.dispatchEvent(new Event('caderno-salvar-ja')); d.close(); location.reload(); };
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

// hora da última gravação no banco (guardada também fora da memória, no máximo a cada 5 s)
const LAST_KEY = 'caderno-ultima-gravacao';
let lastWrite = 0, lastKept = 0;
const keepLast = () => { if (lastWrite - lastKept > 5000) { lastKept = lastWrite; try { localStorage.setItem(LAST_KEY, String(lastWrite)); } catch { /* */ } } };
async function run(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => {
      if (mode === 'readwrite') { lastWrite = Date.now(); keepLast(); document.dispatchEvent(new CustomEvent('caderno-salvo')); }
      res(out);
    };
    t.onerror = () => rej(friendly(t.error));
    t.onabort = () => rej(friendly(t.error));
  });
}
function friendly(err) {
  if (err && err.name === 'QuotaExceededError') {
    const e = new Error('Sem espaço para salvar. Libere espaço no tablet ou exporte e apague gravações antigas em Dados e backup.');
    e.name = 'QuotaExceededError';
    return e;
  }
  return err;
}

export const db = {
  all: s => run(s, 'readonly', st => st.getAll()),
  get: (s, id) => run(s, 'readonly', st => st.get(id)),
  put: (s, v) => run(s, 'readwrite', st => st.put(v)),
  del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  clear: s => run(s, 'readwrite', st => st.clear()),
  count: s => run(s, 'readonly', st => st.count()),
  // grava muitos itens numa única transação (restauração de backup)
  bulkPut: (s, items) => run(s, 'readwrite', st => { for (const it of items) st.put(it); return null; }),
  lastWrite: () => lastWrite || +(localStorage.getItem(LAST_KEY) || 0),
  STORES,
};

// Configurações simples
const SKEY = 'caderno-config';
const DEFAULTS = {
  fingerDraw: true,
  penSeen: false,
  lang: 'pt_BR',
  autoMode: 'off', // off | text | math | flow (escrita organizada)
  handFont: 'auto', // fonte da escrita convertida: 'auto' (igual à letra: cursiva ou de forma), uma das manuscritas ou 'normal'
  fontChosen: false,
  flowSize: 30,
  flowIndent: 80,
  shapes: true,
  eraserMode: 'partial',
  sort: 'updated',
  geminiKey: '',
  theme: 'auto', // auto | light | dark
  uiScale: 1, // tamanho do texto da biblioteca
  autoBackup: true, // cópia automática diária dentro do banco
};
// A IA agora é só o Gemini (versão rápida): apaga as configurações antigas de outros serviços
const OLD_KEYS = ['aiKey', 'aiModel', 'aiProvider', 'groqKey', 'groqModel', 'geminiModel'];
export const settings = (() => {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { v = {}; }
  const out = { ...DEFAULTS, ...v };
  for (const k of OLD_KEYS) delete out[k];
  // a fonte "Caveat" era só o padrão antigo: quem não escolheu nenhuma passa para "igual à minha letra"
  if (!out.fontChosen && out.handFont === 'caveat') out.handFont = 'auto';
  return out;
})();
export function saveSettings() {
  try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* ignora */ }
}
// remove já na abertura as chaves antigas que estavam gravadas
try { const raw = JSON.parse(localStorage.getItem(SKEY) || '{}'); if (OLD_KEYS.some(k => k in raw)) saveSettings(); } catch { /* */ }

// Preferências e históricos guardados fora do banco (entram no backup; a chave da IA não).
// Ficam de fora as coisas que só valem para este tablet: a lista das cópias automáticas e a data
// do último backup. Do foco vão só as configurações (tempos, meta, som), não o relógio rodando.
const LOCAL_ONLY = ['caderno-copias', 'caderno-ultimo-backup', 'caderno-ultima-gravacao'];
const FOCUS_KEY = 'caderno-foco';
export function exportPrefs() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('caderno-') || LOCAL_ONLY.includes(k)) continue;
    if (k === SKEY) {
      try { const c = JSON.parse(localStorage.getItem(k)); delete c.geminiKey; out[k] = JSON.stringify(c); } catch { /* */ }
    } else if (k === FOCUS_KEY) {
      try { const f = JSON.parse(localStorage.getItem(k)); if (f && f.cfg) out[k] = JSON.stringify({ cfg: f.cfg }); } catch { /* */ }
    } else out[k] = localStorage.getItem(k);
  }
  return out;
}
export function importPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(prefs)) {
    if (!k.startsWith('caderno-') || LOCAL_ONLY.includes(k) || typeof v !== 'string') continue;
    if (k === SKEY) {
      // mantém a chave da IA deste tablet
      try { const c = JSON.parse(v); c.geminiKey = settings.geminiKey; Object.assign(settings, c); for (const o of OLD_KEYS) delete settings[o]; saveSettings(); n++; } catch { /* */ }
    } else if (k === FOCUS_KEY) {
      // só as configurações do foco; um relógio rodando neste tablet continua rodando
      try { const cur = JSON.parse(localStorage.getItem(k) || '{}') || {}; const inc = JSON.parse(v) || {}; cur.cfg = { ...(cur.cfg || {}), ...(inc.cfg || {}) }; localStorage.setItem(k, JSON.stringify(cur)); document.dispatchEvent(new CustomEvent('caderno-foco-cfg', { detail: cur.cfg })); n++; } catch { /* */ }
    } else { try { localStorage.setItem(k, v); n++; } catch { /* */ } }
  }
  return n;
}
