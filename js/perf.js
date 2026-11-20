// Desempenho: Leitura (com Kindle), Notas e provas, Relatório semanal, Conquistas,
// Atalhos para outros apps e Busca global.
import { ic, esc, h, toast, modal, confirmBox, menu, richText } from './ui.js';
import { speak } from './voice.js';
import { dayStr, addDays, hubData, reviewsByDay, studyStreak, markHabitToday, startFocus, calendarOn } from './hub.js';
import { aiConfigured, streamChat, cleanText, extractTasks } from './ai.js';
import { quickData } from './quicknotes.js';
import { chatsData, openChat } from './tutor.js';

let A;
const P = { books: [], reads: [], grades: [] };
export const PERF_VIEWS = {
  reading: { title: 'Leitura', icon: 'bookOpen' },
  grades: { title: 'Notas e provas', icon: 'award' },
  report: { title: 'Relatório', icon: 'chart' },
};
export const PERF_NEW_LABEL = { reading: 'Novo livro', grades: 'Nova nota / prova', report: 'Analisar com IA' };

const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDay(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; };
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const daysUntil = s => Math.round((parseDay(s) - parseDay(dayStr())) / 86400000);

export async function initPerf(api) {
  A = api;
  [P.books, P.reads, P.grades] = await Promise.all(['books', 'reads', 'grades'].map(s => A.db.all(s)));
}
export async function reloadPerf() {
  [P.books, P.reads, P.grades] = await Promise.all(['books', 'reads', 'grades'].map(s => A.db.all(s)));
}
export function perfCounts() {
  const today = dayStr();
  return { exams: P.grades.filter(g => g.score == null && g.date >= today && daysUntil(g.date) <= 7).length, reading: P.books.filter(b => !b.finishedAt).length };
}

// ======================= ATALHOS (Kindle e outros apps) =======================
const SKEY = 'caderno-atalhos';
const DEFAULT_SHORTCUTS = [
  { id: 'kindle', name: 'Kindle', icon: '📚', url: 'https://read.amazon.com/', pkg: 'com.amazon.kindle', scheme: 'kindle://home' },
  { id: 'classroom', name: 'Classroom', icon: '🏫', url: 'https://classroom.google.com/', pkg: 'com.google.android.apps.classroom' },
  { id: 'drive', name: 'Drive', icon: '📁', url: 'https://drive.google.com/', pkg: 'com.google.android.apps.docs' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', url: 'https://www.youtube.com/', pkg: 'com.google.android.youtube' },
  { id: 'translate', name: 'Tradutor', icon: '🌐', url: 'https://translate.google.com/', pkg: 'com.google.android.apps.translate' },
  { id: 'khan', name: 'Khan Academy', icon: '🎓', url: 'https://pt.khanacademy.org/', pkg: 'org.khanacademy.android' },
];
function shortcuts() {
  try { const v = JSON.parse(localStorage.getItem(SKEY)); if (Array.isArray(v)) return v; } catch { /* */ }
  return DEFAULT_SHORTCUTS;
}
function saveShortcuts(list) { try { localStorage.setItem(SKEY, JSON.stringify(list)); } catch { /* */ } }
const isAndroid = () => /Android/i.test(navigator.userAgent);

// No Android tenta abrir o app instalado; se não conseguir, abre a versão web.
export function shortcutURL(s, android = isAndroid()) {
  const web = s.url;
  if (!android || !s.pkg) return web;
  const fb = `S.browser_fallback_url=${encodeURIComponent(web)}`;
  const m = s.scheme && s.scheme.match(/^([a-z][\w+.-]*):\/\/(.*)$/i);
  if (m) return `intent://${m[2]}#Intent;scheme=${m[1]};package=${s.pkg};${fb};end`;
  const u = new URL(web);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${s.pkg};${fb};end`;
}
export function openShortcut(s) {
  if (s.id === 'kindle' && s.pkg === 'com.amazon.kindle') { openKindle(); return; }
  const target = shortcutURL(s);
  if (target.startsWith('intent:')) location.href = target;
  else window.open(target, '_blank', 'noopener');
}

// Kindle: o app do Kindle não abre por um link de site, então tentamos os caminhos que abrem o app instalado,
// um de cada vez. Se um caminho não funcionar, o Chrome volta para o Caderno (?kt=N) e oferecemos o próximo.
// O caminho que funcionou fica guardado e é usado direto nas próximas vezes.
const KINDLE_TRIES = [
  'intent://book/#Intent;scheme=kindle;package=com.amazon.kindle;{fb}end',
  'intent://home#Intent;scheme=kindle;package=com.amazon.kindle;{fb}end',
  'intent://read.amazon.com/kindle-library#Intent;scheme=https;package=com.amazon.kindle;{fb}end',
  'intent://details?id=com.amazon.kindle#Intent;scheme=market;package=com.android.vending;end',
];
const KINDLE_KEY = 'caderno-kindle-jeito';
export const kindleURL = (i, base = location.origin + location.pathname) =>
  KINDLE_TRIES[Math.min(i, KINDLE_TRIES.length - 1)].replace('{fb}', `S.browser_fallback_url=${encodeURIComponent(`${base}?kt=${i + 1}`)};`);
export function openKindle(start) {
  if (!isAndroid()) { window.open('https://read.amazon.com/', '_blank', 'noopener'); return; }
  const i = Math.min(KINDLE_TRIES.length - 1, Math.max(0, start ?? (+localStorage.getItem(KINDLE_KEY) || 0)));
  try { localStorage.setItem(KINDLE_KEY, String(i)); } catch { /* */ }
  location.href = kindleURL(i);
}
// O Chrome voltou para o Caderno: aquele caminho não abriu o app
export async function kindleRetry(n) {
  const i = Math.min(KINDLE_TRIES.length - 1, Math.max(1, n));
  try { localStorage.setItem(KINDLE_KEY, String(i)); } catch { /* */ }
  const last = i === KINDLE_TRIES.length - 1;
  const a = await modal({
    title: '📚 Abrir o Kindle',
    body: `<p>${last ? 'O Kindle não abriu pelos caminhos diretos. Vou abrir a página do Kindle na <b>Play Store</b>: lá, toque em <b>Abrir</b>. (Se aparecer <b>Instalar</b>, o app não está instalado neste tablet.)'
      : `Esse caminho não abriu o app do Kindle. Toque em <b>Tentar de novo</b> para usar outro caminho (${i + 1} de ${KINDLE_TRIES.length}). Quando funcionar, o app lembra e abre direto nas próximas vezes.`}</p>`,
    actions: [{ label: 'Kindle na web', value: 'web' }, { label: last ? 'Abrir a Play Store' : 'Tentar de novo', value: 'try', primary: true }],
  });
  if (a === 'try') openKindle(i);
  else if (a === 'web') window.open('https://read.amazon.com/', '_blank', 'noopener');
}

function shortcutsHTML() {
  return `<div class="shortcuts">${shortcuts().map(s => `<button class="shortcut" data-sc="${esc(s.id)}"><span class="sc-ic">${esc(s.icon || '🔗')}</span><span>${esc(s.name)}</span></button>`).join('')}
    <button class="shortcut add" data-sc-edit="1"><span class="sc-ic">${ic('settings')}</span><span>Editar</span></button></div>`;
}
function bindShortcuts(el) {
  el.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => {
    const s = shortcuts().find(x => x.id === b.dataset.sc);
    if (s) openShortcut(s);
  });
  el.querySelectorAll('[data-sc-edit]').forEach(b => b.onclick = editShortcuts);
}
async function editShortcuts() {
  let list = shortcuts().map(s => ({ ...s }));
  const body = h('<div><p class="muted small">Atalhos para abrir outros apps e sites de estudo. No tablet, o app é aberto se estiver instalado; senão, abre o site.</p><div class="sc-edit"></div><button class="btn" type="button" id="sc-add">' + ic('plus') + '<span>Adicionar atalho</span></button> <button class="btn" type="button" id="sc-reset">Restaurar padrão</button></div>');
  const draw = () => {
    body.querySelector('.sc-edit').innerHTML = list.map((s, i) => `<div class="sc-row" data-i="${i}">
      <input class="input sc-emoji" data-f="icon" value="${esc(s.icon || '')}" maxlength="4" aria-label="Ícone">
      <input class="input" data-f="name" value="${esc(s.name)}" placeholder="Nome" aria-label="Nome">
      <input class="input" data-f="url" value="${esc(s.url)}" placeholder="https://…" aria-label="Endereço">
      <button class="icon-btn small" data-rm="${i}" type="button" aria-label="Remover">${ic('trash')}</button></div>`).join('');
  };
  draw();
  body.addEventListener('input', e => {
    const row = e.target.closest('.sc-row'); if (!row) return;
    list[+row.dataset.i][e.target.dataset.f] = e.target.value;
  });
  body.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { list.splice(+rm.dataset.rm, 1); draw(); }
    if (e.target.closest('#sc-add')) { list.push({ id: A.uid(), name: '', icon: '🔗', url: 'https://' }); draw(); }
    if (e.target.closest('#sc-reset')) { list = DEFAULT_SHORTCUTS.map(s => ({ ...s })); draw(); }
  });
  const ok = await modal({ title: 'Atalhos de apps', body, wide: true, actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', value: true, primary: true }] });
  if (!ok) return;
  const clean = list.filter(s => s.name.trim() && /^https?:\/\/\S+\.\S+/.test(s.url.trim())).map(s => ({ ...s, name: s.name.trim(), url: s.url.trim() }));
  if (clean.length < list.length) toast('Atalhos sem nome ou com endereço inválido foram ignorados');
  saveShortcuts(clean);
  A.onChange();
}

// ======================= LEITURA =======================
function bookPace(b) {
  const since = addDays(dayStr(), -13);
  const pages = P.reads.filter(r => r.bookId === b.id && r.date >= since).reduce((a, r) => a + r.pages, 0);
  return pages / 14;
}
function readingStreak() {
  const set = new Set(P.reads.filter(r => r.pages > 0).map(r => r.date));
  let d = dayStr(); if (!set.has(d)) d = addDays(d, -1);
  let n = 0; while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
const RGOAL = 'caderno-meta-leitura';
const readGoal = () => +(localStorage.getItem(RGOAL) || 20);

async function bookDialog(b) {
  const isNew = !b;
  b = b ? { ...b } : { id: A.uid(), title: '', author: '', totalPages: '', currentPage: 0, format: 'kindle', createdAt: Date.now(), quotes: [] };
  const res = await modal({
    title: isNew ? 'Novo livro' : 'Editar livro',
    body: `<label class="lbl">Título</label><input class="input" id="bk-title" value="${esc(b.title)}" placeholder="Ex.: Dom Casmurro">
      <label class="lbl">Autor</label><input class="input" id="bk-author" value="${esc(b.author)}">
      <div class="row"><div class="grow"><label class="lbl">Total de páginas (ou %)</label><input class="input" id="bk-total" type="number" min="1" inputmode="numeric" value="${esc(b.totalPages)}" placeholder="Ex.: 256"></div>
      <div class="grow"><label class="lbl">Página atual</label><input class="input" id="bk-cur" type="number" min="0" inputmode="numeric" value="${esc(b.currentPage)}"></div></div>
      <label class="lbl">Formato</label><select class="select full" id="bk-format">${[['kindle', 'Kindle / e-book'], ['fisico', 'Livro físico'], ['pdf', 'PDF / apostila'], ['audio', 'Audiolivro']].map(([k, l]) => `<option value="${k}" ${b.format === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <p class="muted small">No Kindle, se o livro mostra só a porcentagem, use 100 como total de páginas.</p>`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', primary: true,
      validate: el => {
        if (!el.querySelector('#bk-title').value.trim()) { toast('Digite o título'); return false; }
        if (!(num(el.querySelector('#bk-total').value) > 0)) { toast('Informe o total de páginas'); return false; }
        return true;
      },
      value: el => ({
        title: el.querySelector('#bk-title').value.trim(), author: el.querySelector('#bk-author').value.trim(),
        totalPages: Math.round(num(el.querySelector('#bk-total').value)), currentPage: Math.max(0, Math.round(num(el.querySelector('#bk-cur').value) || 0)),
        format: el.querySelector('#bk-format').value,
      }),
    }],
  });
  if (!res) return;
  Object.assign(b, res);
  b.currentPage = Math.min(b.currentPage, b.totalPages);
  if (b.currentPage >= b.totalPages && !b.finishedAt) b.finishedAt = dayStr();
  await A.db.put('books', b);
  const i = P.books.findIndex(x => x.id === b.id);
  if (i >= 0) P.books[i] = b; else P.books.push(b);
  A.onChange();
}

async function logReading(b) {
  const res = await modal({
    title: `Registrar leitura — ${b.title}`,
    body: `<div class="row"><div class="grow"><label class="lbl">Parei na página</label><input class="input" id="rd-page" type="number" inputmode="numeric" min="0" max="${b.totalPages}" value="${b.currentPage}"></div>
      <div class="grow"><label class="lbl">Minutos lendo (opcional)</label><input class="input" id="rd-min" type="number" inputmode="numeric" min="0" placeholder="Ex.: 30"></div></div>
      <p class="muted small">Você estava na página ${b.currentPage} de ${b.totalPages}.</p>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: el => ({ page: Math.round(num(el.querySelector('#rd-page').value)), min: Math.round(num(el.querySelector('#rd-min').value) || 0) }) }],
  });
  if (!res || !isFinite(res.page)) return;
  const page = Math.max(0, Math.min(b.totalPages, res.page));
  const pages = page - b.currentPage;
  if (pages < 0 && !(await confirmBox('Voltar a página?', `A página ${page} é anterior à atual (${b.currentPage}). Corrigir mesmo assim?`, 'Corrigir', false))) return;
  if (pages !== 0 || res.min > 0) {
    const r = { id: A.uid(), bookId: b.id, date: dayStr(), pages: Math.max(0, pages), minutes: Math.max(0, res.min) };
    P.reads.push(r); await A.db.put('reads', r);
  }
  b.currentPage = page;
  if (page >= b.totalPages && !b.finishedAt) b.finishedAt = dayStr();
  if (page < b.totalPages) delete b.finishedAt;
  await A.db.put('books', b);
  let msg = pages > 0 ? `+${pages} páginas registradas 📖` : 'Leitura atualizada';
  if (b.finishedAt === dayStr() && page >= b.totalPages) msg = `Parabéns! Você terminou “${b.title}” 🎉`;
  if (pages > 0) { const hb = await markHabitToday(/\bler\b|leitura|livro/i); if (hb) msg += ` · hábito “${hb.name}” marcado`; }
  toast(msg, 3500);
  A.onChange();
}

async function quotesDialog(b) {
  const body = h(`<div><form class="row wrap" id="q-form"><textarea class="input grow" id="q-text" rows="2" placeholder="Trecho, ideia ou citação…"></textarea>
    <input class="input" id="q-page" type="number" inputmode="numeric" placeholder="pág." style="width:90px"><button class="btn primary" type="submit">Salvar</button></form>
    <div class="quotes"></div></div>`);
  const draw = () => {
    const qs = b.quotes || [];
    body.querySelector('.quotes').innerHTML = qs.map((q, i) => `<div class="quote"><p>“${esc(q.text)}”</p><div class="row"><span class="muted small grow">${q.page ? `pág. ${esc(q.page)} · ` : ''}${fmtDate(q.date)}</span>
      <button class="chip small" data-card="${i}" type="button">${ic('cards')}<span>Virar flashcard</span></button>
      <button class="icon-btn small" data-rm="${i}" type="button" aria-label="Excluir">${ic('trash')}</button></div></div>`).join('') || '<p class="muted small">Nenhuma citação ainda.</p>';
  };
  draw();
  body.querySelector('#q-form').onsubmit = async e => {
    e.preventDefault();
    const text = body.querySelector('#q-text').value.trim();
    if (!text) return;
    b.quotes = [{ text, page: body.querySelector('#q-page').value, date: dayStr() }, ...(b.quotes || [])];
    await A.db.put('books', b);
    body.querySelector('#q-text').value = ''; body.querySelector('#q-page').value = '';
    draw();
  };
  body.querySelector('.quotes').onclick = async e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { b.quotes.splice(+rm.dataset.rm, 1); await A.db.put('books', b); draw(); return; }
    const c = e.target.closest('[data-card]');
    if (c) {
      const q = b.quotes[+c.dataset.card];
      const r = await A.saveFlashcards([{ front: `${b.title}${q.page ? ` (pág. ${q.page})` : ''}: complete ou explique o trecho`, back: q.text }], { deckName: `Leitura — ${b.title}`, folderId: '' });
      toast(`Flashcard criado em “${r.deck.name}” ✓`);
    }
  };
  await modal({ title: `Citações — ${b.title}`, body, wide: true, actions: [{ label: 'Fechar', value: true, primary: true }] });
}

function renderReading(el) {
  const today = dayStr();
  const todayPages = P.reads.filter(r => r.date === today).reduce((a, r) => a + r.pages, 0);
  const year = today.slice(0, 4);
  const finished = P.books.filter(b => b.finishedAt && b.finishedAt.startsWith(year));
  const reading = P.books.filter(b => !b.finishedAt).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const goal = readGoal();
  const book = b => {
    const pct = Math.round((b.currentPage / b.totalPages) * 100);
    const pace = bookPace(b);
    const left = b.totalPages - b.currentPage;
    const eta = pace > 0 && left > 0 ? addDays(today, Math.ceil(left / pace)) : null;
    return `<div class="panel book">
      <div class="book-top"><span class="book-ic">${b.format === 'kindle' ? '📱' : b.format === 'audio' ? '🎧' : b.format === 'pdf' ? '📄' : '📕'}</span>
        <div class="grow"><b>${esc(b.title)}</b><div class="muted small">${esc(b.author || '')}</div></div>
        <button class="icon-btn small" data-bmore="${b.id}" aria-label="Opções">${ic('more')}</button></div>
      <div class="goal-bar"><i style="width:${pct}%"></i></div>
      <div class="muted small">Página ${b.currentPage} de ${b.totalPages} · <b>${pct}%</b>${b.finishedAt ? ` · terminado em ${fmtDate(b.finishedAt)} ✓` : eta ? ` · no seu ritmo, termina em ${fmtDate(eta)}` : ''}</div>
      <div class="row wrap">${b.finishedAt ? '' : `<button class="btn primary" data-log="${b.id}">${ic('plus')}<span>Registrar leitura</span></button>`}
        ${b.format === 'kindle' ? `<button class="btn" data-kindle="1">📚<span>Abrir no Kindle</span></button>` : ''}
        <button class="btn" data-quotes="${b.id}">${ic('edit')}<span>Citações (${(b.quotes || []).length})</span></button></div></div>`;
  };
  el.innerHTML = `<div class="panel kindle-hero">
      <div class="grow"><h3>📚 Kindle</h3><p class="muted small">Abra seus livros do Kindle e depois registre aqui até onde leu. As páginas contam no relatório, nas conquistas e no hábito de leitura.</p></div>
      <div class="row wrap"><button class="btn primary big" data-kindle="1">📱<span>Abrir app Kindle</span></button>
      <button class="btn" data-kindleweb="1">${ic('share')}<span>Kindle na web</span></button></div></div>
    <div class="stats">
      <div><b>${todayPages}</b><span>páginas hoje (meta ${goal})</span></div>
      <div><b>${readingStreak()}</b><span>${readingStreak() === 1 ? 'dia seguido lendo' : 'dias seguidos lendo'}</span></div>
      <div><b>${finished.length}</b><span>livros terminados em ${year}</span></div>
    </div>
    <div class="goal"><div class="goal-bar"><i style="width:${Math.min(100, (todayPages / goal) * 100)}%"></i></div>
      <span class="muted small">Meta diária: ${goal} páginas · <button class="link" id="rd-goal">mudar meta</button></span></div>
    <h3 class="sec">Lendo agora</h3>
    <div class="book-grid">${reading.map(book).join('') || '<p class="muted">Nenhum livro em andamento.</p>'}
      <button class="panel book new-deck" id="bk-new">${ic('plus')}<span>Novo livro</span></button></div>
    ${P.books.some(b => b.finishedAt) ? `<h3 class="sec">Terminados</h3><div class="book-grid">${P.books.filter(b => b.finishedAt).sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1)).map(book).join('')}</div>` : ''}
    <h3 class="sec">Atalhos de apps</h3>${shortcutsHTML()}`;
  el.querySelectorAll('[data-kindle]').forEach(b => b.onclick = openKindle);
  el.querySelector('[data-kindleweb]').onclick = () => window.open('https://read.amazon.com/', '_blank', 'noopener');
  el.querySelector('#bk-new').onclick = () => bookDialog();
  el.querySelector('#rd-goal').onclick = async () => {
    const v = await modal({ title: 'Meta diária de leitura', body: `<input class="input" type="number" min="1" inputmode="numeric" value="${goal}"> <p class="muted small">páginas por dia</p>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: e2 => Math.round(num(e2.querySelector('input').value)) }] });
    if (v > 0) { localStorage.setItem(RGOAL, String(v)); A.onChange(); }
  };
  el.querySelectorAll('[data-log]').forEach(b => b.onclick = () => logReading(P.books.find(x => x.id === b.dataset.log)));
  el.querySelectorAll('[data-quotes]').forEach(b => b.onclick = () => quotesDialog(P.books.find(x => x.id === b.dataset.quotes)));
  el.querySelectorAll('[data-bmore]').forEach(btn => btn.onclick = async () => {
    const b = P.books.find(x => x.id === btn.dataset.bmore);
    const a = await menu(b.title, [
      { label: 'Editar', icon: 'edit', value: 'edit' },
      { label: b.finishedAt ? 'Marcar como não terminado' : 'Marcar como terminado', icon: 'check', value: 'fin' },
      { label: 'Excluir', icon: 'trash', value: 'del', danger: true },
    ]);
    if (a === 'edit') bookDialog(b);
    else if (a === 'fin') {
      if (b.finishedAt) delete b.finishedAt; else { b.finishedAt = dayStr(); b.currentPage = b.totalPages; }
      await A.db.put('books', b); A.onChange();
    } else if (a === 'del' && await confirmBox('Excluir livro', `Excluir “${b.title}” e o histórico de leitura?`, 'Excluir')) {
      for (const r of P.reads.filter(r => r.bookId === b.id)) await A.db.del('reads', r.id);
      P.reads = P.reads.filter(r => r.bookId !== b.id);
      await A.db.del('books', b.id); P.books = P.books.filter(x => x.id !== b.id); A.onChange();
    }
  });
  bindShortcuts(el);
}

// ======================= NOTAS E PROVAS =======================
const TKEY = 'caderno-metas-nota';
const targets = () => { try { return JSON.parse(localStorage.getItem(TKEY) || '{}'); } catch { return {}; } };
const targetOf = f => { const t = targets()[f || '']; return isFinite(t) ? t : 6; };
function subjectStats(folderId) {
  const gs = P.grades.filter(g => (g.folderId || '') === (folderId || '') && g.score != null);
  const W = gs.reduce((a, g) => a + g.weight, 0);
  const avg = W ? gs.reduce((a, g) => a + (g.score / g.max) * 10 * g.weight, 0) / W : null;
  return { gs, W, avg };
}
// Quanto precisa tirar (0 a 10) numa avaliação de peso w para chegar na meta
function needed(folderId, w = 1) {
  const { gs, W } = subjectStats(folderId);
  const sum = gs.reduce((a, g) => a + (g.score / g.max) * 10 * g.weight, 0);
  return (targetOf(folderId) * (W + w) - sum) / w;
}
async function gradeDialog(g) {
  const isNew = !g;
  g = g ? { ...g } : { id: A.uid(), folderId: '', title: '', date: dayStr(), score: null, max: 10, weight: 1, createdAt: Date.now() };
  const res = await modal({
    title: isNew ? 'Nova nota ou prova' : 'Editar',
    body: `<label class="lbl">Matéria</label><select class="select full" id="gr-folder">${A.folderOptions(g.folderId, 'Geral')}</select>
      <label class="lbl">Avaliação</label><input class="input" id="gr-title" value="${esc(g.title)}" placeholder="Ex.: Prova 1, Trabalho de grupo, Simulado">
      <div class="row"><div class="grow"><label class="lbl">Data</label><input class="input" type="date" id="gr-date" value="${esc(g.date)}"></div>
      <div class="grow"><label class="lbl">Peso</label><input class="input" id="gr-weight" inputmode="decimal" value="${fmt1(g.weight)}"></div></div>
      <div class="row"><div class="grow"><label class="lbl">Nota tirada</label><input class="input" id="gr-score" inputmode="decimal" value="${g.score == null ? '' : fmt1(g.score)}" placeholder="vazio = prova ainda vai acontecer"></div>
      <div class="grow"><label class="lbl">Vale quanto</label><input class="input" id="gr-max" inputmode="decimal" value="${fmt1(g.max)}"></div></div>
      <p class="muted small">Deixe a nota em branco para cadastrar uma prova futura: ela aparece com contagem regressiva no painel Hoje e na Agenda.</p>`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', primary: true,
      validate: el => {
        const t = el.querySelector('#gr-title').value.trim(), sc = el.querySelector('#gr-score').value.trim();
        const mx = num(el.querySelector('#gr-max').value), w = num(el.querySelector('#gr-weight').value);
        if (!t) { toast('Dê um nome à avaliação'); return false; }
        if (!el.querySelector('#gr-date').value) { toast('Escolha a data'); return false; }
        if (!(mx > 0)) { toast('“Vale quanto” precisa ser maior que zero'); return false; }
        if (!(w > 0)) { toast('O peso precisa ser maior que zero'); return false; }
        if (sc && (!(num(sc) >= 0) || num(sc) > mx)) { toast(`A nota precisa estar entre 0 e ${fmt1(mx)}`); return false; }
        return true;
      },
      value: el => {
        const sc = el.querySelector('#gr-score').value.trim();
        return {
          folderId: el.querySelector('#gr-folder').value, title: el.querySelector('#gr-title').value.trim(), date: el.querySelector('#gr-date').value,
          weight: num(el.querySelector('#gr-weight').value), max: num(el.querySelector('#gr-max').value), score: sc ? num(sc) : null,
        };
      },
    }],
  });
  if (!res) return;
  Object.assign(g, res);
  await A.db.put('grades', g);
  const i = P.grades.findIndex(x => x.id === g.id);
  if (i >= 0) P.grades[i] = g; else P.grades.push(g);
  if (g.score != null) {
    const st = subjectStats(g.folderId);
    toast(`Média em ${A.folderName(g.folderId) || 'Geral'}: ${fmt1(st.avg)}`);
  } else toast(`Prova marcada para ${fmtDate(g.date)} — faltam ${daysUntil(g.date)} dia(s)`);
  A.onChange();
}
function renderGrades(el) {
  const today = dayStr();
  const subjects = [...new Set(['', ...A.state.folders.map(f => f.id), ...P.grades.map(g => g.folderId || '')])]
    .filter(f => f === '' ? P.grades.some(g => !g.folderId) : true);
  const upcoming = P.grades.filter(g => g.score == null && g.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const card = f => {
    const st = subjectStats(f);
    const tgt = targetOf(f);
    const up = P.grades.filter(g => (g.folderId || '') === f && g.score == null);
    const ok = st.avg != null && st.avg >= tgt;
    const nextW = up.length ? up[0].weight : 1;
    const need = needed(f, nextW);
    return `<div class="panel subject">
      <div class="deck-top"><span class="dot" style="background:${f ? A.folderColor(f) : '#9aa0a6'}"></span><b class="grow">${esc(f ? A.folderName(f) : 'Geral')}</b>
        <button class="chip small" data-target="${f}">Meta ${fmt1(tgt)}</button></div>
      <div class="avg-row">${st.avg == null ? '' : `<div class="big-num">${fmt1(st.avg)}</div>`}
        ${st.avg == null ? '<span class="muted small">sem notas ainda</span>' : `<span class="status ${ok ? 'good' : 'bad'}">${ok ? ic('check') + 'Acima da meta' : '! Abaixo da meta'}</span>`}</div>
      ${st.avg != null ? `<p class="small">${need <= 0 ? '🎉 Você já garantiu a meta.' : need > 10 ? `Para chegar a ${fmt1(tgt)} seria preciso mais de 10 na próxima — fale com o professor sobre recuperação.` : `Precisa de <b>${fmt1(Math.max(0, need))}</b> na próxima avaliação${up.length ? ` (${esc(up[0].title)}, peso ${fmt1(nextW)})` : ''} para ficar com ${fmt1(tgt)}.`}</p>` : ''}
      <div class="grade-list">${P.grades.filter(g => (g.folderId || '') === f).sort((a, b) => (a.date < b.date ? -1 : 1)).map(g => `
        <button class="grade-row" data-g="${g.id}"><span class="grow">${esc(g.title)} <span class="muted small">· ${fmtDate(g.date)}${g.weight !== 1 ? ` · peso ${fmt1(g.weight)}` : ''}</span></span>
        ${g.score == null ? `<span class="muted small">${daysUntil(g.date) >= 0 ? `em ${daysUntil(g.date)} dia(s)` : 'sem nota'}</span>` : `<b class="${(g.score / g.max) * 10 >= tgt ? 'ok' : 'low'}">${fmt1(g.score)}/${fmt1(g.max)}</b>`}</button>`).join('') || '<p class="muted small">Nenhuma avaliação.</p>'}</div>
    </div>`;
  };
  el.innerHTML = `${upcoming.length ? `<div class="panel"><h3>${ic('calendar')}Próximas provas</h3><div class="exam-list">${upcoming.map(g => {
      const d = daysUntil(g.date);
      return `<button class="exam ${d <= 3 ? 'soon' : ''}" data-g="${g.id}"><span class="exam-d"><b>${d === 0 ? 'HOJE' : d}</b>${d === 0 ? '' : d === 1 ? 'dia' : 'dias'}</span>
        <span class="grow"><b>${esc(g.title)}</b><span class="muted small"> · ${esc(A.folderName(g.folderId) || 'Geral')} · ${fmtDate(g.date)}</span></span>
        <span class="chip small" data-plan="${g.id}">${ic('magic')}<span>Plano de revisão</span></span></button>`;
    }).join('')}</div></div>` : ''}
    <div class="subject-grid">${subjects.map(card).join('')}
      <button class="panel subject new-deck" id="gr-new">${ic('plus')}<span>Nova nota ou prova</span></button></div>
    ${A.state.folders.length ? '' : '<p class="muted">Dica: crie pastas para cada matéria (Matemática, Português…) para ver a média de cada uma.</p>'}`;
  el.querySelector('#gr-new').onclick = () => gradeDialog();
  el.querySelectorAll('[data-target]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const f = b.dataset.target;
    const v = await modal({ title: 'Média que você quer alcançar', body: `<input class="input" inputmode="decimal" value="${fmt1(targetOf(f))}"><p class="muted small">de 0 a 10</p>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: e2 => num(e2.querySelector('input').value) }] });
    if (v >= 0 && v <= 10) { const t = targets(); t[f] = v; localStorage.setItem(TKEY, JSON.stringify(t)); A.onChange(); }
    else if (v != null) toast('A meta precisa estar entre 0 e 10');
  });
  el.querySelectorAll('[data-plan]').forEach(b => b.onclick = e => { e.stopPropagation(); examPlan(P.grades.find(g => g.id === b.dataset.plan)); });
  el.querySelectorAll('[data-g]').forEach(b => b.onclick = async e => {
    if (e.target.closest('[data-plan]')) return;
    const g = P.grades.find(x => x.id === b.dataset.g);
    const a = await menu(g.title, [{ label: g.score == null ? 'Lançar nota / editar' : 'Editar', icon: 'edit', value: 'edit' }, { label: 'Excluir', icon: 'trash', value: 'del', danger: true }]);
    if (a === 'edit') gradeDialog(g);
    else if (a === 'del' && await confirmBox('Excluir', `Excluir “${g.title}”?`, 'Excluir')) { await A.db.del('grades', g.id); P.grades = P.grades.filter(x => x.id !== g.id); A.onChange(); }
  });
}
// Cria tarefas de revisão nos dias que faltam até a prova
async function examPlan(g) {
  const d = daysUntil(g.date);
  if (d < 1) { toast('A prova é hoje — bons estudos! 💪'); return; }
  const subj = A.folderName(g.folderId) || 'a matéria';
  const steps = d >= 7 ? [[-7, 'Fazer resumo do conteúdo'], [-5, 'Revisar flashcards e anotações'], [-3, 'Resolver exercícios'], [-2, 'Fazer um simulado'], [-1, 'Revisão final dos pontos difíceis']]
    : d >= 3 ? [[-3, 'Resumo e flashcards'], [-2, 'Resolver exercícios'], [-1, 'Revisão final']] : [[-1, 'Revisão final e exercícios']];
  const list = steps.map(([off, t]) => ({ due: addDays(g.date, off), title: `${t} — ${g.title} (${subj})` })).filter(x => x.due >= dayStr());
  const ok = await modal({
    title: `Plano de revisão — ${g.title}`,
    body: `<p>Criar ${list.length} tarefa(s) até a prova (${fmtDate(g.date)}):</p><ul>${list.map(x => `<li><b>${fmtDate(x.due)}</b> — ${esc(x.title)}</li>`).join('')}</ul>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Criar tarefas', primary: true, value: true }],
  });
  if (!ok) return;
  for (const x of list) await A.addTask({ title: x.title, due: x.due, prio: 3, folderId: g.folderId || '' });
  toast(`${list.length} tarefas de revisão criadas ✓`);
  A.onChange();
}

// ======================= CONQUISTAS / NÍVEL =======================
function totals() {
  const H = hubData();
  const rv = reviewsByDay();
  return {
    focus: H.sessions.reduce((a, s) => a + s.minutes, 0),
    tasks: A.state.tasks.filter(t => t.done).length,
    reviews: Object.values(rv).reduce((a, n) => a + n, 0),
    pages: P.reads.reduce((a, r) => a + r.pages, 0),
    books: P.books.filter(b => b.finishedAt).length,
    habits: H.habits.reduce((a, hb) => a + Object.keys(hb.days).length, 0),
    notes: A.state.notes.length,
    streak: studyStreak(),
    grades: P.grades.filter(g => g.score != null).length,
  };
}
function xpOf(t) { return t.focus + t.tasks * 10 + t.reviews * 2 + Math.round(t.pages / 2) + t.books * 50 + t.habits * 5 + t.notes * 5 + t.grades * 5; }
function levelOf(xp) {
  let lvl = 1, need = 100, acc = 0;
  while (xp >= acc + need) { acc += need; lvl++; need = Math.round(need * 1.25); }
  return { lvl, into: xp - acc, need };
}
const BADGES = [
  ['🌱', 'Primeiros passos', 'Crie sua primeira anotação', t => t.notes >= 1],
  ['⏱️', 'Primeiro foco', 'Complete um Pomodoro', t => t.focus >= 1],
  ['🔥', 'Uma semana', '7 dias seguidos estudando', t => t.streak >= 7],
  ['🏆', 'Um mês', '30 dias seguidos estudando', t => t.streak >= 30],
  ['🧠', '10 horas de foco', 'Some 10 horas de foco', t => t.focus >= 600],
  ['🚀', '50 horas de foco', 'Some 50 horas de foco', t => t.focus >= 3000],
  ['🃏', 'Memória afiada', 'Revise 100 flashcards', t => t.reviews >= 100],
  ['✅', 'Fazedor', 'Conclua 25 tarefas', t => t.tasks >= 25],
  ['📖', 'Leitor', 'Leia 500 páginas', t => t.pages >= 500],
  ['📚', 'Livro concluído', 'Termine um livro', t => t.books >= 1],
  ['💪', 'Constância', 'Marque hábitos 50 vezes', t => t.habits >= 50],
  ['📊', 'De olho nas notas', 'Lance 5 notas', t => t.grades >= 5],
];
export function levelBadge() {
  const { lvl, into, need } = levelOf(xpOf(totals()));
  return `<button class="level" data-goto="report" title="Ver conquistas"><span>Nível <b>${lvl}</b></span><span class="lvl-bar"><i style="width:${(into / need) * 100}%"></i></span></button>`;
}

// ======================= RELATÓRIO SEMANAL =======================
let reportWeek = 0; // 0 = últimos 7 dias, 1 = os 7 anteriores
function weekRange(back) {
  const end = addDays(dayStr(), -7 * back);
  return { start: addDays(end, -6), end };
}
function metrics({ start, end }) {
  const H = hubData();
  const inR = d => d >= start && d <= end;
  const rv = reviewsByDay();
  let habitDone = 0, habitSlots = 0;
  for (const hb of H.habits) {
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (hb.createdAt && dayStr(new Date(hb.createdAt)) > d) continue;
      habitSlots++; if (hb.days[d]) habitDone++;
    }
  }
  const bySubj = new Map();
  for (const s of H.sessions) if (inR(s.date)) bySubj.set(s.folderId || '', (bySubj.get(s.folderId || '') || 0) + s.minutes);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push({ d, m: H.sessions.filter(s => s.date === d).reduce((a, s) => a + s.minutes, 0) });
  return {
    focus: days.reduce((a, x) => a + x.m, 0), days, bySubj,
    tasks: A.state.tasks.filter(t => t.doneAt && inR(dayStr(new Date(t.doneAt)))).length,
    reviews: Object.entries(rv).filter(([d]) => inR(d)).reduce((a, [, n]) => a + n, 0),
    pages: P.reads.filter(r => inR(r.date)).reduce((a, r) => a + r.pages, 0),
    habitsPct: habitSlots ? Math.round((habitDone / habitSlots) * 100) : null,
    grades: P.grades.filter(g => g.score != null && inR(g.date)),
    late: A.state.tasks.filter(t => !t.done && t.due && t.due < dayStr()).length,
  };
}
function delta(a, b, unit = '') {
  if (b == null || a == null) return '';
  const d = a - b;
  if (d === 0) return '<span class="delta">= semana anterior</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit} vs. anterior</span>`;
}
function reportText(m, prev) {
  const subj = [...m.bySubj.entries()].map(([f, min]) => `${A.folderName(f) || 'Geral'}: ${min} min`).join('; ') || 'nenhuma sessão';
  const forgotten = A.state.folders.filter(f => !m.bySubj.has(f.id)).map(f => f.name).join(', ') || 'nenhuma';
  const exams = P.grades.filter(g => g.score == null && g.date >= dayStr()).map(g => `${g.title} (${A.folderName(g.folderId) || 'Geral'}) em ${daysUntil(g.date)} dias`).join('; ') || 'nenhuma';
  const avgs = A.state.folders.map(f => { const st = subjectStats(f.id); return st.avg != null ? `${f.name}: média ${fmt1(st.avg)} (meta ${fmt1(targetOf(f.id))})` : null; }).filter(Boolean).join('; ') || 'sem notas';
  return `Dados dos meus estudos nos últimos 7 dias (entre parênteses, a semana anterior):
- Foco: ${m.focus} min (${prev.focus} min). Por dia: ${m.days.map(x => `${x.d.slice(5)} ${x.m}min`).join(', ')}
- Tempo por matéria: ${subj}
- Matérias sem nenhum foco na semana: ${forgotten}
- Tarefas concluídas: ${m.tasks} (${prev.tasks}); tarefas atrasadas agora: ${m.late}
- Flashcards revisados: ${m.reviews} (${prev.reviews})
- Páginas lidas: ${m.pages} (${prev.pages})
- Hábitos cumpridos: ${m.habitsPct ?? '—'}% (${prev.habitsPct ?? '—'}%)
- Sequência atual de dias estudando: ${studyStreak()}
- Médias: ${avgs}
- Próximas provas: ${exams}

Analise minha semana como um treinador de estudos: diga em poucas linhas o que foi bem, o que piorou e por quê (com base nos números), e dê 3 a 5 recomendações práticas e específicas para a próxima semana (quando estudar, quais matérias priorizar, como usar foco, flashcards e leitura). Termine com uma seção "# Tarefas" com 3 a 6 tarefas curtas, uma por linha começando com "- ".`;
}
let aiReport = null;
// ----- mapa de estudos do ano (um quadradinho por dia; mais escuro = mais estudo) -----
function heatmapHTML() {
  const H = hubData(), rv = reviewsByDay();
  const today = dayStr();
  const minutes = new Map(), active = new Set();
  for (const s of H.sessions) minutes.set(s.date, (minutes.get(s.date) || 0) + s.minutes);
  for (const d of Object.keys(rv)) active.add(d);
  for (const r of P.reads) if (r.pages > 0) active.add(r.date);
  for (const t of A.state.tasks) if (t.doneAt) active.add(dayStr(new Date(t.doneAt)));
  for (const hb of H.habits) for (const d of Object.keys(hb.days)) if (hb.days[d]) active.add(d);
  // começa num domingo, ~52 semanas atrás
  let start = addDays(today, -364);
  while (parseDay(start).getDay() !== 0) start = addDays(start, -1);
  const cells = [];
  let studied = 0, best = 0, totalMin = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const m = minutes.get(d) || 0;
    const lvl = m >= 90 ? 4 : m >= 45 ? 3 : m >= 15 ? 2 : (m > 0 || active.has(d)) ? 1 : 0;
    if (lvl) studied++;
    best = Math.max(best, m); totalMin += m;
    const label = `${parseDay(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}: ${m ? fmtMin(m) + ' de foco' : lvl ? 'estudou' : 'sem estudo'}`;
    cells.push(`<i class="hm l${lvl}" title="${label}" data-tip="${label}"></i>`);
  }
  const months = [];
  for (let w = 0; w * 7 < cells.length; w++) {
    const d = parseDay(addDays(start, w * 7));
    months.push(d.getDate() <= 7 ? `<span style="grid-column:${w + 1}">${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>` : '');
  }
  return `<div class="panel heat"><h3>${ic('calendar')}Mapa de estudos do ano</h3>
    <p class="muted small"><b>${studied}</b> ${studied === 1 ? "dia" : "dias"} com estudo no último ano · <b>${fmtMin(totalMin)}</b> de foco · recorde: <b>${fmtMin(best)}</b> num dia</p>
    <div class="hm-scroll"><div class="hm-months">${months.join('')}</div><div class="hm-grid" role="img" aria-label="Dias com estudo no último ano">${cells.join('')}</div></div>
    <div class="hm-legend"><span class="muted small" id="hm-tip">Toque num dia para ver os detalhes</span><span class="grow"></span><span class="muted small">Menos</span><i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i><span class="muted small">Mais</span></div>
  </div>`;
}

function renderReport(el) {
  const r = weekRange(reportWeek), m = metrics(r), prev = metrics(weekRange(reportWeek + 1));
  const t = totals(), xp = xpOf(t), L = levelOf(xp);
  const max = Math.max(30, ...m.days.map(x => x.m));
  const best = [...m.days].sort((a, b) => b.m - a.m)[0];
  const forgotten = A.state.folders.filter(f => !m.bySubj.has(f.id));
  el.innerHTML = `<div class="row wrap report-head">
      <div class="seg" id="rp-week"><button data-w="0" class="${reportWeek === 0 ? 'active' : ''}">Últimos 7 dias</button><button data-w="1" class="${reportWeek === 1 ? 'active' : ''}">7 dias anteriores</button></div>
      <span class="muted small grow">${fmtDate(r.start)} a ${fmtDate(r.end)}</span>
      <button class="btn ai-btn" id="rp-ai">${ic('magic')}<span>Analisar minha semana com IA</span></button></div>
    <div class="kpis">
      <div class="panel kpi"><span>Foco</span><b>${fmtMin(m.focus)}</b>${delta(m.focus, prev.focus, ' min')}</div>
      <div class="panel kpi"><span>Tarefas concluídas</span><b>${m.tasks}</b>${delta(m.tasks, prev.tasks)}</div>
      <div class="panel kpi"><span>Flashcards revisados</span><b>${m.reviews}</b>${delta(m.reviews, prev.reviews)}</div>
      <div class="panel kpi"><span>Páginas lidas</span><b>${m.pages}</b>${delta(m.pages, prev.pages)}</div>
      <div class="panel kpi"><span>Hábitos cumpridos</span><b>${m.habitsPct == null ? '—' : m.habitsPct + '%'}</b>${m.habitsPct != null && prev.habitsPct != null ? delta(m.habitsPct, prev.habitsPct, ' pontos') : ''}</div>
      <div class="panel kpi"><span>Tarefas atrasadas</span><b class="${m.late ? 'low' : ''}">${m.late}</b></div>
    </div>
    <div class="report-grid">
      <div class="panel"><h3>${ic('timer')}Foco por dia</h3>
        <div class="bars" role="img" aria-label="Minutos de foco por dia">${m.days.map(x => `<div class="bar-col" tabindex="0"><div class="bar-tip">${fmtDate(x.d)}: ${fmtMin(x.m)}</div>
          <div class="bar-val">${best && x.d === best.d && x.m ? fmtMin(x.m) : ''}</div>
          <div class="bar-track"><div class="bar ${best && x.d === best.d ? 'today' : ''}" style="height:${x.m ? Math.max(4, (x.m / max) * 100) : 0}%"></div></div>
          <div class="bar-lbl">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][parseDay(x.d).getDay()]}</div></div>`).join('')}</div>
        ${best && best.m ? `<p class="small">Seu melhor dia foi <b>${fmtDate(best.d)}</b>, com ${fmtMin(best.m)}.</p>` : '<p class="muted small">Nenhum foco registrado neste período.</p>'}
        ${forgotten.length ? `<p class="small">⚠️ Matérias sem foco no período: <b>${forgotten.map(f => esc(f.name)).join(', ')}</b></p>` : ''}
      </div>
      <div class="panel"><h3>${ic('award')}Nível ${L.lvl} · ${xp} XP</h3>
        <div class="goal-bar"><i style="width:${(L.into / L.need) * 100}%"></i></div><p class="muted small">${L.need - L.into} XP para o nível ${L.lvl + 1}. Ganhe XP com foco (1/min), tarefas (10), flashcards (2), leitura (1 a cada 2 páginas), livros (50), hábitos (5), anotações (5) e notas (5).</p>
        <div class="badges">${BADGES.map(([e, n, d, f]) => `<div class="badge ${f(t) ? 'on' : ''}" title="${esc(d)}"><span>${e}</span><b>${esc(n)}</b><small>${esc(d)}</small></div>`).join('')}</div>
      </div>
    </div>
    <div class="panel ai-report" ${aiReport ? '' : 'hidden'}><h3>${ic('magic')}Análise da IA</h3><div class="ai-out" id="rp-out"></div><div class="row wrap" id="rp-actions"></div></div>
    ${heatmapHTML()}`;
  el.querySelector('#rp-week').onclick = e => { const b = e.target.closest('[data-w]'); if (b) { reportWeek = +b.dataset.w; renderReport(el); } };
  el.querySelector('#rp-ai').onclick = () => analyzeWeek(el, m, prev);
  el.querySelector('.hm-grid')?.addEventListener('click', e => { const c = e.target.closest('.hm'); if (c) el.querySelector('#hm-tip').textContent = c.dataset.tip; });
  // se não couber, mostra o fim (os dias mais recentes)
  const sc = el.querySelector('.hm-scroll'); if (sc) sc.scrollLeft = sc.scrollWidth;
  if (aiReport) showAIReport(el);
}
function showAIReport(el) {
  const out = el.querySelector('#rp-out'), box = el.querySelector('.ai-report');
  if (!out) return;
  box.hidden = false;
  out.classList.toggle('error', !!aiReport.error);
  if (aiReport.error) out.textContent = aiReport.text; else out.innerHTML = richText(cleanText(aiReport.text || (aiReport.busy ? 'Analisando…' : '')));
  const acts = el.querySelector('#rp-actions');
  acts.innerHTML = '';
  if (!aiReport.busy && !aiReport.error && aiReport.text) {
    const tasks = extractTasks(aiReport.text);
    if (tasks.length) {
      const b = h(`<button class="btn primary">${ic('tasks')}<span>Criar ${tasks.length} tarefas</span></button>`);
      b.onclick = async () => { for (const t of tasks) await A.addTask({ title: t, due: '', prio: 2, folderId: '' }); toast(`${tasks.length} tarefas criadas ✓`); b.remove(); A.onChange(true); };
      acts.appendChild(b);
    }
    const sp = h(`<button class="btn">${ic('speaker')}<span>Ouvir</span></button>`);
    sp.onclick = () => speak(cleanText(aiReport.text), { button: sp });
    acts.appendChild(sp);
    const c = h(`<button class="btn">${ic('copy')}<span>Copiar</span></button>`);
    c.onclick = async () => { try { await navigator.clipboard.writeText(cleanText(aiReport.text)); toast('Copiado'); } catch { toast('Não foi possível copiar'); } };
    acts.appendChild(c);
  }
}
async function analyzeWeek(el, m, prev) {
  if (!aiConfigured()) { toast('Configure a IA em Ajustes → Inteligência artificial'); return; }
  if (aiReport && aiReport.busy) return;
  aiReport = { text: '', busy: true };
  showAIReport(el);
  try {
    const s = streamChat([{ role: 'user', content: reportText(m, prev) }], t => {
      aiReport.text += t;
      const out = document.getElementById('rp-out');
      if (out) out.innerHTML = richText(cleanText(aiReport.text));
    });
    const r = await s.done;
    aiReport = { text: r.text, busy: false };
  } catch (e) { aiReport = { text: e.message, busy: false, error: true }; }
  const cur = document.getElementById('rp-out');
  if (cur) showAIReport(cur.closest('.view') || el);
}

// ======================= HOJE: cartões extras =======================
export const extraToday = {
  html() {
    const today = dayStr();
    const exams = P.grades.filter(g => g.score == null && g.date >= today && daysUntil(g.date) <= 14).sort((a, b) => (a.date < b.date ? -1 : 1));
    const reading = P.books.filter(b => !b.finishedAt).slice(0, 2);
    const pagesToday = P.reads.filter(r => r.date === today).reduce((a, r) => a + r.pages, 0);
    return `${exams.length ? `<div class="panel t-exams"><div class="p-head"><h3>${ic('award')}Próximas provas</h3><button class="icon-btn small" data-goto="grades" aria-label="Ver notas">${ic('right')}</button></div>
        ${exams.slice(0, 4).map(g => { const d = daysUntil(g.date); return `<div class="exam-mini ${d <= 3 ? 'soon' : ''}"><b>${d === 0 ? 'HOJE' : `${d}d`}</b><span class="grow">${esc(g.title)} <span class="muted small">· ${esc(A.folderName(g.folderId) || 'Geral')}</span></span></div>`; }).join('')}</div>` : ''}
      <div class="panel t-reading"><div class="p-head"><h3>${ic('bookOpen')}Leitura</h3><button class="icon-btn small" data-goto="reading" aria-label="Ver leitura">${ic('right')}</button></div>
        <p class="small"><b>${pagesToday}</b> de ${readGoal()} páginas hoje</p>
        ${reading.map(b => `<div class="read-mini"><span class="grow">${esc(b.title)}</span><span class="muted small">${Math.round((b.currentPage / b.totalPages) * 100)}%</span></div><div class="goal-bar thin"><i style="width:${(b.currentPage / b.totalPages) * 100}%"></i></div>`).join('') || '<p class="muted small">Cadastre o livro que está lendo.</p>'}
        <div class="row"><button class="btn primary" data-kindle="1">📚<span>Abrir Kindle</span></button>${reading[0] ? `<button class="btn" data-logbook="${reading[0].id}">Registrar</button>` : ''}</div></div>
      <div class="panel t-shortcuts"><div class="p-head"><h3>${ic('share')}Atalhos</h3></div>${shortcutsHTML()}</div>`;
  },
  bind(el) {
    el.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => A.goTo({ kind: b.dataset.goto }));
    el.querySelectorAll('[data-kindle]').forEach(b => b.onclick = openKindle);
    el.querySelectorAll('[data-logbook]').forEach(b => b.onclick = () => logReading(P.books.find(x => x.id === b.dataset.logbook)));
    bindShortcuts(el);
  },
};

// ======================= BUSCA GLOBAL (Ctrl+K) =======================
export async function openPalette() {
  if (document.querySelector('.palette')) return;
  const items = () => {
    const acts = [
      ['Nova anotação', 'plus', () => A.newNote()], ['Nova tarefa', 'tasks', () => A.taskDialog({})],
      ['Começar foco (Pomodoro)', 'timer', () => { startFocus(); A.goTo({ kind: 'focus' }); }],
      ['Abrir Kindle', 'bookOpen', openKindle], ['Registrar leitura', 'bookOpen', () => A.goTo({ kind: 'reading' })],
      ['Lançar nota ou prova', 'award', () => gradeDialog()], ['Revisar flashcards', 'cards', () => A.goTo({ kind: 'cards' })],
      ['Relatório da semana', 'chart', () => A.goTo({ kind: 'report' })], ['Importar PDF', 'upload', () => A.importPdf()],
      ['Ajustes e IA', 'settings', () => A.settings()],
      ['Nova nota rápida', 'sticky', () => A.quick('quicknote')], ['Novo evento na agenda', 'calendar', () => A.quick('event')], ['Gravar a aula (áudio)', 'mic', () => A.quick('record')],
      ['Perguntar ao tutor IA', 'chat', () => A.goTo({ kind: 'tutor' })],
      ...Object.entries(A.views()).map(([k, v]) => [`Ir para ${v.title}`, v.icon, () => A.goTo({ kind: k })]),
    ].map(([label, icon, run]) => ({ label, icon, run, kind: 'Ação' }));
    // busca também dentro do conteúdo (texto digitado das anotações, notas rápidas, conversas, flashcards)
    const notes = A.state.notes.map(n => ({ label: n.title, text: n.searchText || '', icon: 'page', kind: 'Anotação', run: () => A.openNote(n.id) }));
    const tasks = A.state.tasks.filter(t => !t.done).map(t => ({ label: t.title, text: [t.notes, ...(t.subtasks || []).map(x => x.title)].join(' '), icon: 'tasks', kind: 'Tarefa', run: () => A.taskDialog(t) }));
    const quick = quickData().map(q => ({ label: q.text.split('\n')[0].replace(/^\s*\[( |x)\]\s*/i, '').slice(0, 60) || 'Nota rápida', text: q.text, icon: 'sticky', kind: 'Nota rápida', run: () => A.goTo({ kind: 'quick' }) }));
    const chats = chatsData().map(c => ({ label: c.title, text: c.messages.map(m => m.text || '').join(' ').slice(0, 6000), icon: 'chat', kind: 'Conversa', run: () => openChat(c.id) }));
    const cards = hubData().cards.map(c => ({ label: c.front.slice(0, 70), text: c.back, icon: 'cards', kind: 'Flashcard', run: () => A.goTo({ kind: 'cards' }) }));
    const decks = hubData().decks.map(d => ({ label: d.name, icon: 'cards', kind: 'Baralho', run: () => A.goTo({ kind: 'cards' }) }));
    const books = P.books.map(b => ({ label: b.title, icon: 'bookOpen', kind: 'Livro', run: () => logReading(b) }));
    const events = (A.ev ? A.ev.eventsData() : []).map(e => ({ label: e.title, text: `${e.notes || ''} ${e.date.split('-').reverse().join('/')}`, icon: 'calendar', kind: 'Evento', run: () => calendarOn(e.date) }));
    const folders = A.state.folders.map(f => ({ label: f.name, icon: 'folder', kind: 'Pasta', run: () => A.goTo({ kind: 'notes', filter: f.id }) }));
    return [...acts, ...events, ...notes, ...tasks, ...quick, ...folders, ...decks, ...books, ...chats, ...cards];
  };
  const all = items();
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const back = h(`<div class="modal-back show palette-back"><div class="palette" role="dialog" aria-label="Busca global">
    <div class="pal-in">${ic('search')}<input placeholder="Buscar em tudo: anotações, tarefas, notas, conversas… ou uma ação" aria-label="Buscar"></div>
    <div class="pal-list" role="listbox"></div></div></div>`);
  const input = back.querySelector('input'), list = back.querySelector('.pal-list');
  let sel = 0, shown = [];
  const close = () => { back.remove(); };
  const draw = () => {
    const q = norm(input.value.trim());
    if (q) {
      const byTitle = all.filter(x => norm(x.label).includes(q));
      const byText = all.filter(x => !byTitle.includes(x) && x.text && norm(x.text).includes(q)).map(x => {
        const t = norm(x.text), i = t.indexOf(q);
        return { ...x, snippet: (i > 30 ? '…' : '') + x.text.slice(Math.max(0, i - 30), i + q.length + 50).trim() + '…' };
      });
      shown = [...byTitle, ...byText].slice(0, 40);
    } else shown = all.filter(x => x.kind === 'Ação').slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((x, i) => `<button class="pal-item ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">${ic(x.icon)}<span class="grow">${esc(x.label)}${x.snippet ? `<small class="pal-snip">${esc(x.snippet)}</small>` : ''}</span><em>${x.kind}</em></button>`).join('') || '<p class="muted small pad">Nada encontrado.</p>';
  };
  const run = i => { const x = shown[i]; if (!x) return; close(); x.run(); };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') run(sel);
    else if (e.key === 'Escape') close();
  };
  list.onclick = e => { const b = e.target.closest('[data-i]'); if (b) run(+b.dataset.i); };
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.body.appendChild(back);
  draw();
  setTimeout(() => input.focus(), 30);
}

// ======================= roteamento =======================
export function renderPerf(kind, el) {
  ({ reading: renderReading, grades: renderGrades, report: renderReport })[kind](el);
}
export function perfNewAction(kind) {
  if (kind === 'reading') return bookDialog();
  if (kind === 'grades') return gradeDialog();
  if (kind === 'report') { const el = document.getElementById('view-hub'); const r = weekRange(reportWeek); return analyzeWeek(el, metrics(r), metrics(weekRange(reportWeek + 1))); }
}
// ----- dados para Metas e Simulado -----
export const perfData = () => P;
export const subjectAverage = f => subjectStats(f).avg;
export async function saveGrade(g) {
  const item = { id: A.uid(), folderId: '', title: '', date: dayStr(), score: null, max: 10, weight: 1, createdAt: Date.now(), ...g };
  await A.db.put('grades', item);
  P.grades.push(item);
  return item;
}
export function openBookOrNew() { const b = P.books.find(x => !x.finishedAt); return b ? logReading(b) : bookDialog(); }
export const newGrade = () => gradeDialog();

// Provas futuras aparecem na Agenda
export function examsOn(day) { return P.grades.filter(g => g.date === day); }
