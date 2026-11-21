// Caderno de erros: tudo o que você errou (simulado, flashcard errado de novo, conta marcada com ✗)
// cai aqui. Revise até acertar 2 vezes seguidas: aí o erro vira "resolvido". A IA explica cada erro.
import { ic, esc, toast, confirmBox, richText } from './ui.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';

let A;
let E = [];
let filter = 'all';
let practice = null; // { queue: [ids], i, picked, shown }
export const ERROR_VIEWS = { errors: { title: 'Caderno de erros', icon: 'alert' } };
const SRC = { quiz: '📝 Simulado', enem: '🎯 Simulado ENEM', card: '🃏 Flashcard', conta: '🧮 Conta', manual: '✏️ Anotado' };
const L = 'ABCDEF';
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function initErrors(api) { A = api; E = await A.db.all('errors'); }
export async function reloadErrors() { E = await A.db.all('errors'); }
export const errorsData = () => E;
export const openErrors = () => E.filter(e => !e.resolvedAt);
export const errorsCount = () => openErrors().length;

// Registra um erro (sem repetir: o mesmo erro de novo só volta a ficar pendente)
export async function addError(e) {
  const key = e.ref ? `${e.src}:${e.ref}` : `${e.src}:${norm(e.q)}`;
  const old = E.find(x => x.key === key);
  if (old) {
    Object.assign(old, { mine: e.mine ?? old.mine, times: (old.times || 1) + 1, streak: 0, resolvedAt: null, updatedAt: Date.now() });
    await A.db.put('errors', old);
    return old;
  }
  const item = { id: A.uid(), key, src: e.src, folderId: e.folderId || '', subject: e.subject || '', q: String(e.q || '').slice(0, 2000),
    opts: Array.isArray(e.opts) ? e.opts : null, c: Number.isInteger(e.c) ? e.c : null, answer: String(e.answer || ''), mine: String(e.mine ?? ''),
    ex: String(e.ex || ''), noteId: e.noteId || '', times: 1, streak: 0, resolvedAt: null, createdAt: Date.now(), updatedAt: Date.now() };
  E.push(item);
  await A.db.put('errors', item);
  return item;
}
export async function addErrors(list) { for (const e of list) await addError(e); if (list.length) A.onChange(true); }

async function save(e) { e.updatedAt = Date.now(); await A.db.put('errors', e); }
async function markRight(e) {
  e.streak = (e.streak || 0) + 1;
  if (e.streak >= 2) e.resolvedAt = Date.now();
  await save(e);
  return !!e.resolvedAt;
}
async function markWrong(e) { e.streak = 0; e.times = (e.times || 1) + 1; await save(e); }

function card(e) {
  const folder = A.folderName(e.folderId);
  return `<div class="panel er-card ${e.resolvedAt ? 'done' : ''}" data-id="${e.id}">
    <div class="row"><span class="er-src">${SRC[e.src] || SRC.manual}</span>${folder || e.subject ? `<span class="muted small">${esc(folder || e.subject)}</span>` : ''}
      <span class="grow"></span>${e.resolvedAt ? '<span class="status good">✓ Resolvido</span>' : `<span class="muted small">${e.streak ? `acertou ${e.streak}× · falta 1` : e.times > 1 ? `errou ${e.times}×` : ''}</span>`}</div>
    <div class="er-q">${esc(e.q)}</div>
    ${e.mine ? `<p class="small late">Você respondeu: ${esc(e.mine)}</p>` : ''}
    <p class="small"><b>Certo:</b> ${esc(e.answer)}</p>
    ${e.ex ? `<p class="small muted">${esc(e.ex)}</p>` : ''}
    <div class="ai-out er-ai" hidden></div>
    <div class="row wrap er-acts">
      <button class="btn small-btn" data-ex="${e.id}">${ic('magic')}<span>Explicar com IA</span></button>
      ${e.resolvedAt ? `<button class="btn small-btn" data-reopen="${e.id}">${ic('repeat')}<span>Revisar de novo</span></button>` : `<button class="btn small-btn" data-know="${e.id}">${ic('check')}<span>Já sei</span></button>`}
      <span class="grow"></span><button class="icon-btn small" data-del="${e.id}" aria-label="Apagar">${ic('trash')}</button></div></div>`;
}

export function renderErrors(el) {
  if (practice) return renderPractice(el);
  const open = openErrors(), done = E.filter(e => e.resolvedAt);
  const folders = [...new Set(E.map(e => e.folderId).filter(Boolean))].filter(f => A.folderName(f));
  const list = (filter === 'done' ? done : filter === 'all' ? open : open.filter(e => e.folderId === filter)).sort((a, b) => b.updatedAt - a.updatedAt);
  el.innerHTML = `<div class="er-wrap">
    <div class="panel er-head"><div class="grow"><h3>${ic('alert')}Seus erros viram acertos</h3>
      <p class="muted small">Tudo o que você erra no simulado, nos flashcards e nas contas do caderno vem para cá. Acerte 2 vezes seguidas para resolver.</p>
      <div class="er-stats"><b>${open.length}</b> para revisar · <b>${done.length}</b> resolvidos</div></div>
      <button class="btn primary big" id="er-go" ${open.length ? '' : 'disabled'}>${ic('play')}<span>Revisar ${open.length ? `(${Math.min(open.length, 15)})` : ''}</span></button></div>
    <div class="row wrap er-filter"><button class="chip small ${filter === 'all' ? 'on' : ''}" data-f="all">Para revisar (${open.length})</button>
      ${folders.map(f => `<button class="chip small ${filter === f ? 'on' : ''}" data-f="${f}">${esc(A.folderName(f))} (${open.filter(e => e.folderId === f).length})</button>`).join('')}
      <button class="chip small ${filter === 'done' ? 'on' : ''}" data-f="done">✓ Resolvidos (${done.length})</button></div>
    ${list.length ? list.slice(0, 120).map(card).join('') : `<div class="empty">${ic('alert')}<p>${filter === 'done' ? 'Nenhum erro resolvido ainda.' : 'Nenhum erro para revisar. 🎉'}</p><p class="muted">Faça um simulado, revise flashcards ou confira contas no caderno: o que você errar aparece aqui.</p></div>`}
  </div>`;
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; renderErrors(el); });
  el.querySelector('#er-go').onclick = () => {
    const pool = (filter !== 'all' && filter !== 'done' ? open.filter(e => e.folderId === filter) : open).sort((a, b) => (b.times || 1) - (a.times || 1) || a.updatedAt - b.updatedAt);
    practice = { queue: pool.slice(0, 15).map(e => e.id), i: 0, picked: null, shown: false, right: 0, solved: 0 };
    renderErrors(el);
  };
  el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => explain(E.find(x => x.id === b.dataset.ex), b.closest('.er-card').querySelector('.er-ai'), b));
  el.querySelectorAll('[data-know]').forEach(b => b.onclick = async () => { const e = E.find(x => x.id === b.dataset.know); e.resolvedAt = Date.now(); await save(e); toast('Marcado como resolvido ✓'); A.onChange(true); renderErrors(el); });
  el.querySelectorAll('[data-reopen]').forEach(b => b.onclick = async () => { const e = E.find(x => x.id === b.dataset.reopen); e.resolvedAt = null; e.streak = 0; await save(e); renderErrors(el); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Apagar erro', 'Tirar este erro do caderno de erros?', 'Apagar'))) return;
    await A.db.del('errors', b.dataset.del); E = E.filter(x => x.id !== b.dataset.del); A.onChange(true); renderErrors(el);
  });
}

// A IA explica por que a resposta certa é a certa e onde você se confundiu
async function explain(e, out, btn) {
  if (!aiConfigured()) { toast('Ligue a IA em Ajustes → Inteligência artificial'); return; }
  out.hidden = false; out.innerHTML = '<div class="ai-typing"><i></i><i></i><i></i></div>';
  if (btn) btn.disabled = true;
  let txt = '';
  try {
    const r = streamChat([{ role: 'user', content: errorPrompt(e) }], t => { txt += t; out.innerHTML = richText(cleanText(txt)); });
    await r.done;
  } catch (err) { out.innerHTML = `<span class="late">${esc(err.message)}</span>`; }
  finally { if (btn) btn.disabled = false; }
}
export function errorPrompt(e) {
  return `Sou estudante e errei esta questão. Explique de forma simples, em português do Brasil, por que a resposta certa é a certa${e.mine ? ' e onde provavelmente me confundi' : ''}. Termine com uma dica curta para eu não errar de novo. Seja breve (até 8 linhas).
Questão: ${e.q}
${e.opts ? `Alternativas: ${e.opts.map((o, k) => `${L[k]}) ${o}`).join(' | ')}\n` : ''}Resposta certa: ${e.answer}
${e.mine ? `Minha resposta: ${e.mine}` : ''}`;
}

function renderPractice(el) {
  const P = practice;
  const e = E.find(x => x.id === P.queue[P.i]);
  if (!e) {
    el.innerHTML = `<div class="review"><div class="panel review-done"><div class="qz-score ok">✓</div><h2>Revisão concluída</h2>
      <p class="muted">Você acertou ${P.right} de ${P.queue.length}${P.solved ? ` e resolveu ${P.solved} erro${P.solved > 1 ? 's' : ''} de vez 🎉` : ''}.</p>
      <button class="btn primary" id="er-back">${ic('alert')}<span>Voltar ao caderno de erros</span></button></div></div>`;
    el.querySelector('#er-back').onclick = () => { practice = null; A.onChange(true); renderErrors(el); };
    return;
  }
  const answered = P.picked != null;
  el.innerHTML = `<div class="review quiz-run">
    <div class="row"><button class="btn" id="er-quit">${ic('close')}<span>Sair</span></button><div class="grow progress"><i style="width:${(P.i / P.queue.length) * 100}%"></i></div><span class="muted">${P.i + 1} / ${P.queue.length}</span></div>
    <div class="panel qz-q"><div class="muted small">${SRC[e.src] || ''}${A.folderName(e.folderId) ? ` · ${esc(A.folderName(e.folderId))}` : ''}</div><h2>${esc(e.q)}</h2></div>
    ${e.opts && e.c != null
      ? `<div class="qz-opts">${e.opts.map((o, k) => `<button class="qz-opt ${answered ? (k === e.c ? 'right' : k === P.picked ? 'wrong' : 'dim') : ''}" data-o="${k}" ${answered ? 'disabled' : ''}><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div>`
      : P.shown ? `<div class="panel"><b>Resposta:</b><p>${esc(e.answer)}</p>${e.ex ? `<p class="muted small">${esc(e.ex)}</p>` : ''}</div>
        ${answered ? '' : `<div class="row er-self"><button class="btn big grow danger" data-self="0">Errei</button><button class="btn big grow primary" data-self="1">Acertei</button></div>`}`
        : '<button class="btn primary big full" id="er-show">Mostrar a resposta</button>'}
    ${answered ? `<div class="panel qz-ex ${P.ok ? 'ok' : 'no'}"><b>${P.ok ? (P.solvedNow ? '✓ Certo! Erro resolvido 🎉' : '✓ Certo! Acerte mais uma vez para resolver') : '✗ Ainda não. Ele volta na próxima revisão.'}</b>${e.ex && e.opts ? `<p>${esc(e.ex)}</p>` : ''}
        <div class="ai-out er-ai" hidden></div>${P.ok ? '' : `<button class="btn small-btn" id="er-explain">${ic('magic')}<span>Explicar com IA</span></button>`}</div>
      <button class="btn primary big full" id="er-next">${P.i === P.queue.length - 1 ? 'Terminar' : 'Próximo'}</button>` : ''}
  </div>`;
  el.querySelector('#er-quit').onclick = () => { practice = null; A.onChange(true); renderErrors(el); };
  el.querySelector('#er-show')?.addEventListener('click', () => { P.shown = true; renderPractice(el); });
  const answer = async (ok, picked) => {
    if (P.picked != null || P.busy) return; // toque duplo: conta uma vez só
    P.busy = true;
    P.ok = ok; P.picked = picked;
    try { if (ok) { P.right++; P.solvedNow = await markRight(e); if (P.solvedNow) P.solved++; } else { P.solvedNow = false; await markWrong(e); } }
    finally { P.busy = false; }
    renderPractice(el);
  };
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { const k = +b.dataset.o; answer(k === e.c, k); });
  el.querySelectorAll('[data-self]').forEach(b => b.onclick = () => answer(b.dataset.self === '1', +b.dataset.self));
  el.querySelector('#er-explain')?.addEventListener('click', ev => explain(e, el.querySelector('.er-ai'), ev.currentTarget));
  el.querySelector('#er-next')?.addEventListener('click', () => { P.i++; P.picked = null; P.shown = false; P.ok = null; renderPractice(el); });
}
export function leaveErrors() { if (practice && practice.i >= practice.queue.length) practice = null; }
