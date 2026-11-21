// Notas rápidas: ideias, lembretes e listas de marcar (estilo post-it), com voz e "virar tarefa".
import { ic, esc, h, toast, modal, menu, keepDraft } from './ui.js';
import { speak, attachDictation } from './voice.js';
import { shareText } from './export.js';

let A;
let Q = [];
let filter = '';
export const QUICK_VIEWS = { quick: { title: 'Notas rápidas', icon: 'sticky' } };
const COLORS = { amarelo: '#fff4b8', verde: '#d9f5d4', azul: '#d6e8ff', rosa: '#ffd9ea', roxo: '#e9ddff', branco: '#ffffff' };
const CHECK = /^\s*(?:-\s*)?\[( |x|X)\]\s?(.*)$/;

export async function initQuick(api) { A = api; Q = await A.db.all('quicknotes'); }
export async function reloadQuick() { Q = await A.db.all('quicknotes'); }
export const quickData = () => Q;
// a cor de fundo vem do CSS ([data-qc]), que já troca sozinha no tema escuro
const qc = c => (COLORS[c] ? c : 'amarelo');

async function save(n) {
  n.updatedAt = Date.now();
  await A.db.put('quicknotes', n);
  const i = Q.findIndex(x => x.id === n.id);
  if (i >= 0) Q[i] = n; else Q.push(n);
}
export async function addQuick(text, extra = {}) {
  const n = { id: A.uid(), text: text.trim(), color: 'amarelo', pinned: false, createdAt: Date.now(), ...extra };
  await save(n);
  return n;
}

// texto → HTML com caixinhas de marcar nas linhas "[ ] item"
function bodyHTML(n) {
  return String(n.text).split('\n').map((line, i) => {
    const m = line.match(CHECK);
    if (m) return `<label class="qn-check ${m[1] !== ' ' ? 'done' : ''}"><input type="checkbox" data-line="${i}" ${m[1] !== ' ' ? 'checked' : ''}><span>${esc(m[2])}</span></label>`;
    return line.trim() ? `<p>${esc(line)}</p>` : '<p class="qn-gap"></p>';
  }).join('');
}
const progress = n => {
  const lines = String(n.text).split('\n').map(l => l.match(CHECK)).filter(Boolean);
  return lines.length ? `${lines.filter(m => m[1] !== ' ').length}/${lines.length}` : '';
};

async function editDialog(n) {
  const isNew = !n;
  n = n ? { ...n } : { id: A.uid(), text: '', color: 'amarelo', pinned: false, createdAt: Date.now() };
  const body = h(`<div class="qn-edit">
    <textarea class="input" id="qn-text" rows="8" placeholder="Escreva aqui… Use o botão de lista para criar itens de marcar.">${esc(n.text)}</textarea>
    <div class="row wrap">
      <button class="chip" type="button" id="qn-list">${ic('tasks')}<span>Item de lista</span></button>
      <button class="chip" type="button" id="qn-mic">${ic('mic')}<span>Ditar</span></button>
      <div class="qn-colors">${Object.keys(COLORS).map(c => `<button type="button" class="qn-color ${n.color === c ? 'active' : ''}" data-c="${c}" data-qc="${c}" aria-label="Cor ${c}"></button>`).join('')}</div>
    </div></div>`);
  const ta = body.querySelector('#qn-text');
  attachDictation(body.querySelector('#qn-mic'), ta);
  body.querySelector('#qn-list').onclick = () => {
    const v = ta.value;
    ta.value = v + (v && !v.endsWith('\n') ? '\n' : '') + '[ ] ';
    ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
  };
  body.querySelector('.qn-colors').onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    n.color = b.dataset.c; body.querySelectorAll('.qn-color').forEach(x => x.classList.toggle('active', x === b));
  };
  const ok = await modal({
    title: isNew ? 'Nova nota rápida' : 'Editar nota', body, wide: true,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', primary: true, value: true }],
  });
  if (!ok) return;
  n.text = ta.value.replace(/\s+$/, '');
  if (!n.text) { if (!isNew) await remove(n.id); return; }
  await save(n);
  A.onChange();
}

async function remove(id) {
  const n = Q.find(x => x.id === id);
  if (!n) return;
  await A.db.del('quicknotes', id);
  Q = Q.filter(x => x.id !== id);
  A.onChange();
  toast('Nota apagada', 5000, { label: 'Desfazer', run: async () => { await save(n); A.onChange(); toast('Nota recuperada ✓'); } });
}

// Itens não marcados viram tarefas (ou a nota inteira vira uma tarefa)
async function toTasks(n) {
  const items = String(n.text).split('\n').map(l => l.match(CHECK)).filter(m => m && m[1] === ' ').map(m => m[2].trim()).filter(Boolean);
  if (items.length) {
    for (const t of items) await A.addTask({ title: t, notes: 'Da nota rápida' });
    toast(`${items.length} tarefa(s) criada(s) com os itens da lista ✓`);
  } else {
    const [first, ...rest] = String(n.text).split('\n');
    await A.addTask({ title: first.replace(CHECK, '$2').trim().slice(0, 120) || 'Tarefa', notes: rest.join('\n').trim() });
    toast('Tarefa criada ✓');
  }
  A.onChange(true);
}

function card(n) {
  const pr = progress(n);
  return `<div class="qn-card ${n.pinned ? 'pinned' : ''}" data-qc="${qc(n.color)}" data-id="${n.id}">
    <div class="qn-body" data-edit="${n.id}">${bodyHTML(n)}</div>
    <div class="qn-foot">
      <span class="muted small">${new Date(n.updatedAt || n.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${pr ? ` · ✓ ${pr}` : ''}</span>
      <span class="grow"></span>
      <button class="icon-btn small ${n.pinned ? 'on' : ''}" data-pin="${n.id}" title="${n.pinned ? 'Desafixar' : 'Fixar no topo'}" aria-label="Fixar">${ic('pin')}</button>
      <button class="icon-btn small" data-say="${n.id}" title="Ler em voz alta" aria-label="Ler em voz alta">${ic('speaker')}</button>
      <button class="icon-btn small" data-task="${n.id}" title="Virar tarefa" aria-label="Virar tarefa">${ic('tasks')}</button>
      <button class="icon-btn small" data-more="${n.id}" aria-label="Mais opções">${ic('more')}</button>
    </div></div>`;
}

export function renderQuick(el) {
  const q = filter.trim().toLowerCase();
  const list = Q.filter(n => !q || n.text.toLowerCase().includes(q)).sort((a, b) => (b.pinned - a.pinned) || ((b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)));
  const pinned = list.filter(n => n.pinned), others = list.filter(n => !n.pinned);
  el.innerHTML = `<form class="panel qn-capture" id="qn-form" autocomplete="off">
      <textarea class="input" id="qn-new" rows="2" placeholder="Anote uma ideia, um lembrete ou uma lista…  (Enter salva · Shift+Enter pula linha)"></textarea>
      <div class="row wrap">
        <button class="chip" type="button" id="qn-newmic">${ic('mic')}<span>Ditar</span></button>
        <button class="chip" type="button" id="qn-newlist">${ic('tasks')}<span>Lista</span></button>
        <span class="grow"></span>
        <input class="input qn-search" id="qn-search" type="search" placeholder="Procurar nas notas" value="${esc(filter)}">
        <button class="btn primary" type="submit">${ic('plus')}<span>Salvar</span></button>
      </div></form>
    ${pinned.length ? `<h3 class="sec">${ic('pin')} Fixadas</h3><div class="qn-grid">${pinned.map(card).join('')}</div>` : ''}
    ${others.length ? `${pinned.length ? '<h3 class="sec">Outras</h3>' : ''}<div class="qn-grid">${others.map(card).join('')}</div>` : ''}
    ${list.length ? '' : `<div class="empty">${ic('sticky')}<p>${q ? 'Nada encontrado.' : 'Nenhuma nota rápida ainda.'}</p><p class="muted">${q ? '' : 'Escreva acima: ideias, lembretes, listas de material…'}</p></div>`}`;
  const ta = el.querySelector('#qn-new');
  const clearDraft = keepDraft(ta, 'nota-rapida');
  attachDictation(el.querySelector('#qn-newmic'), ta);
  el.querySelector('#qn-newlist').onclick = () => { ta.value += (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + '[ ] '; ta.focus(); };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('#qn-form').requestSubmit(); } });
  el.querySelector('#qn-form').onsubmit = async e => {
    e.preventDefault();
    if (!ta.value.trim()) { ta.focus(); return; }
    await addQuick(ta.value);
    clearDraft();
    A.onChange();
    setTimeout(() => document.getElementById('qn-new')?.focus(), 50);
  };
  const search = el.querySelector('#qn-search');
  search.oninput = () => { filter = search.value; const pos = search.selectionStart; renderQuick(el); const s2 = el.querySelector('#qn-search'); s2.focus(); s2.setSelectionRange(pos, pos); };
  el.querySelectorAll('.qn-check input').forEach(cb => cb.onchange = async e => {
    e.stopPropagation();
    const n = Q.find(x => x.id === cb.closest('.qn-card').dataset.id);
    const lines = n.text.split('\n');
    const m = lines[+cb.dataset.line].match(CHECK);
    lines[+cb.dataset.line] = `[${cb.checked ? 'x' : ' '}] ${m[2]}`;
    n.text = lines.join('\n');
    await save(n);
    renderQuick(el);
  });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = e => { if (e.target.closest('.qn-check')) return; editDialog(Q.find(x => x.id === b.dataset.edit)); });
  el.querySelectorAll('[data-pin]').forEach(b => b.onclick = async () => { const n = Q.find(x => x.id === b.dataset.pin); n.pinned = !n.pinned; await save(n); A.onChange(); });
  el.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(Q.find(x => x.id === b.dataset.say).text, { button: b }));
  el.querySelectorAll('[data-task]').forEach(b => b.onclick = () => toTasks(Q.find(x => x.id === b.dataset.task)));
  el.querySelectorAll('[data-more]').forEach(b => b.onclick = async () => {
    const n = Q.find(x => x.id === b.dataset.more);
    const a = await menu('Nota rápida', [
      { label: 'Editar', icon: 'edit', value: 'edit' },
      { label: 'Copiar o texto', icon: 'copy', value: 'copy' },
      { label: 'Enviar (WhatsApp, e-mail…)', icon: 'share', value: 'share' },
      { label: 'Virar flashcard (1ª linha = pergunta)', icon: 'cards', value: 'card' },
      { label: 'Apagar', icon: 'trash', value: 'del', danger: true },
    ]);
    if (a === 'edit') editDialog(n);
    else if (a === 'copy') { try { await navigator.clipboard.writeText(n.text); toast('Copiado'); } catch { toast('Não foi possível copiar'); } }
    else if (a === 'share') { const r = await shareText(n.text, 'Nota'); if (r === 'copied') toast('Texto copiado'); }
    else if (a === 'card') {
      const [front, ...rest] = n.text.split('\n');
      if (!rest.join('\n').trim()) { toast('Escreva a resposta nas linhas de baixo da nota'); return; }
      const r = await A.saveFlashcards([{ front: front.trim(), back: rest.join('\n').trim() }], { deckName: 'Notas rápidas', folderId: '' });
      toast(`Flashcard criado em “${r.deck.name}” ✓`);
    } else if (a === 'del') remove(n.id);
  });
}
export const newQuick = () => editDialog();

// Cartão do painel Hoje com as notas fixadas
export const quickToday = {
  html() {
    const pins = Q.filter(n => n.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
    if (!pins.length) return '';
    return `<div class="panel t-quick"><div class="p-head"><h3>${ic('pin')}Notas fixadas</h3><button class="icon-btn small" data-goto="quick" aria-label="Ver notas">${ic('right')}</button></div>
      ${pins.map(n => `<div class="qn-mini" data-qc="${qc(n.color)}">${esc(n.text.split('\n').slice(0, 3).map(l => l.replace(CHECK, (m0, x, t) => (x !== ' ' ? '☑ ' : '☐ ') + t)).join(' · ')).slice(0, 140)}</div>`).join('')}</div>`;
  },
  bind() { /* [data-goto] ligado pelo painel */ },
};
