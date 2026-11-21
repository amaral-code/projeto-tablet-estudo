// Busca na letra à mão: o app lê (em segundo plano, com internet) o que você escreveu à mão em cada página
// e guarda o texto reconhecido na anotação. Assim a 🔍 e a busca do Caderno acham palavras escritas à mão.
import { groupLines, recognizeStrokes } from './recognize.js';
import { settings } from './store.js';

let A;
let busy = false;
// texto lido da letra de cada anotação (também em memória, para a busca achar mesmo antes de recarregar)
const inkById = new Map();
const timers = new Map();
const MAX_LINES = 30; // por página, para não demorar demais

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
  if (!navigator.onLine || off()) return null;
  let pagesChanged = false;
  for (const pg of content.pages) {
    const sig = sigOf(pg);
    if (pg.inkSig === sig) continue;
    const parts = [];
    for (const l of groupLines(inkOf(pg)).slice(0, MAX_LINES)) {
      let c;
      try { c = await recognizeStrokes(l.strokes, settings.lang); } catch { return pagesChanged ? { pagesChanged } : null; } // sem internet no meio: continua depois
      if (c && c[0]) parts.push(c[0]);
    }
    pg.inkText = parts.join(' ');
    pg.inkSig = sig;
    pagesChanged = true;
  }
  meta.inkText = content.pages.map(p => p.inkText || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
  // marca que leu, mesmo sem mudança (senão a anotação volta para a fila toda vez)
  meta.inkIndexedAt = Date.now();
  inkById.set(meta.id, meta.inkText);
  return { pagesChanged };
}

// Grava só o resultado da leitura, por cima do que está no banco AGORA (nunca a cópia antiga das páginas:
// se você escreveu nesse meio-tempo, nada se perde)
export async function saveIndex(meta, content, res) {
  if (res.pagesChanged) {
    const fresh = await A.db.get('pages', meta.id);
    if (fresh) {
      const byId = new Map(content.pages.map(p => [p.id, p]));
      let any = false;
      for (const p of fresh.pages) { const ix = byId.get(p.id); if (ix && ix.inkSig === sigOf(p)) { p.inkText = ix.inkText; p.inkSig = ix.inkSig; any = true; } }
      if (any) await A.db.put('pages', fresh);
    }
  }
  const curMeta = (await A.db.get('notes', meta.id)) || meta;
  curMeta.inkText = meta.inkText; curMeta.inkIndexedAt = meta.inkIndexedAt;
  await A.db.put('notes', curMeta);
  syncState(meta);
}

// Depois de salvar uma anotação, lê a letra dela alguns segundos depois (quando você para de escrever)
export function scheduleIndex(meta, content) {
  clearTimeout(timers.get(meta.id));
  timers.set(meta.id, setTimeout(async () => {
    timers.delete(meta.id);
    try { const r = await indexContent(meta, content); if (r) await saveIndex(meta, content, r); } catch { /* tenta de novo na próxima vez */ }
  }, 5000));
}
function syncState(meta) { const n = A.state.notes.find(x => x.id === meta.id); if (n && n !== meta) { n.inkText = meta.inkText; n.inkIndexedAt = meta.inkIndexedAt; } inkById.set(meta.id, meta.inkText || ''); }

// Anotações antigas (ou escritas sem internet) são lidas aos poucos em segundo plano
export async function backfill(limit = 6) {
  if (busy || !navigator.onLine || !A) return 0;
  busy = true;
  let n = 0;
  try {
    const open = A.openNoteId ? A.openNoteId() : null;
    const todo = A.state.notes.filter(m => m.id !== open && (!m.inkIndexedAt || (m.updatedAt || 0) > m.inkIndexedAt)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    for (const m of todo) {
      const content = await A.loadContent(m.id);
      if (!content) continue;
      const r = await indexContent(m, content);
      // abriram a anotação enquanto lia: deixa para depois (o editor é quem manda nela agora)
      if (!r || (A.openNoteId && A.openNoteId() === m.id)) continue;
      await saveIndex(m, content, r); n++;
      await new Promise(r => setTimeout(r, 300));
    }
  } finally { busy = false; }
  return n;
}
export const inkSearchText = n => `${n.searchText || ''} ${n.inkText || inkById.get(n.id) || ''}`;
