// Busca na letra à mão: o app lê (em segundo plano, com internet) o que você escreveu à mão em cada página
// e guarda o texto reconhecido na anotação. Assim a 🔍 e a busca do Caderno acham palavras escritas à mão.
import { groupLines, recognizeStrokes } from './recognize.js';
import { settings } from './store.js';

let A;
let busy = false;
// texto lido da letra de cada anotação (também em memória, para a busca achar mesmo antes de recarregar)
const inkById = new Map();
const timers = new Map();
const MAX_LINES = 40; // por página, para não demorar demais

export function initInkIndex(api) {
  A = api;
  setTimeout(() => backfill(), 8000);
  window.addEventListener('online', () => setTimeout(() => backfill(), 3000));
}

const inkOf = pg => (pg.strokes || []).filter(s => s.tool !== 'marker' && s.points && s.points.length);
const sigOf = pg => { const s = inkOf(pg); return `${s.length}:${s.length ? s[s.length - 1].id : ''}`; };

// Lê as páginas que mudaram desde a última leitura. Devolve true se algo mudou.
// (os testes automáticos desligam a leitura em segundo plano com esta chave, para não misturar com outros testes)
const off = () => { try { return localStorage.getItem('caderno-indice-off') === '1'; } catch { return false; } };
export async function indexContent(meta, content) {
  if (!navigator.onLine || off()) return false;
  let changed = false;
  for (const pg of content.pages) {
    const sig = sigOf(pg);
    if (pg.inkSig === sig) continue;
    const parts = [];
    for (const l of groupLines(inkOf(pg)).slice(0, MAX_LINES)) {
      let c;
      try { c = await recognizeStrokes(l.strokes, settings.lang); } catch { return changed; } // sem internet no meio: continua depois
      if (c && c[0]) parts.push(c[0]);
    }
    pg.inkText = parts.join(' ');
    pg.inkSig = sig;
    changed = true;
  }
  if (changed || !meta.inkIndexedAt) {
    meta.inkText = content.pages.map(p => p.inkText || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
    meta.inkIndexedAt = Date.now();
    inkById.set(meta.id, meta.inkText);
    changed = true;
  }
  return changed;
}

// Depois de salvar uma anotação, lê a letra dela alguns segundos depois (quando você para de escrever)
export function scheduleIndex(meta, content) {
  clearTimeout(timers.get(meta.id));
  timers.set(meta.id, setTimeout(async () => {
    timers.delete(meta.id);
    try { if (await indexContent(meta, content)) { await A.db.put('pages', content); await A.db.put('notes', meta); syncState(meta); } } catch { /* tenta de novo na próxima vez */ }
  }, 5000));
}
function syncState(meta) { const n = A.state.notes.find(x => x.id === meta.id); if (n && n !== meta) { n.inkText = meta.inkText; n.inkIndexedAt = meta.inkIndexedAt; } }

// Anotações antigas (ou escritas sem internet) são lidas aos poucos em segundo plano
export async function backfill(limit = 15) {
  if (busy || !navigator.onLine || !A) return 0;
  busy = true;
  let n = 0;
  try {
    const open = A.openNoteId ? A.openNoteId() : null;
    const todo = A.state.notes.filter(m => m.id !== open && (!m.inkIndexedAt || (m.updatedAt || 0) > m.inkIndexedAt)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    for (const m of todo) {
      const content = await A.loadContent(m.id);
      if (!content) continue;
      if (await indexContent(m, content)) { await A.db.put('pages', content); await A.db.put('notes', m); n++; }
      await new Promise(r => setTimeout(r, 300));
    }
  } finally { busy = false; }
  return n;
}
export const inkSearchText = n => `${n.searchText || ''} ${n.inkText || inkById.get(n.id) || ''}`;
