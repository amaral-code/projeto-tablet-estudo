// App principal: biblioteca (pastas e anotações), tarefas, ajustes, compartilhamento e backup.
import { db, settings, saveSettings } from './store.js';
import { uid, PAPER_COLORS, PAPER_TYPES } from './ink.js';
import { initEditor, openEditor, closeEditor, editorIsOpen, syncToggles } from './editor.js';
import { pagesToPDF, pageToPNG, shareFile, shareText, download } from './export.js';
import { LANGS } from './recognize.js';
import { ic, esc, h, toast, modal, promptText, confirmBox, menu } from './ui.js';

const $ = id => document.getElementById(id);
const FOLDER_COLORS = ['#0a6cff', '#e5352b', '#1f9d4a', '#ff8a00', '#8e44d6', '#00a6b4', '#ff4fa3', '#8b5a2b', '#6b6b70'];

const state = {
  folders: [], notes: [], tasks: [],
  view: { kind: 'notes', filter: 'all' }, // filter: all | fav | none | <folderId>
  search: '', taskFilter: 'pending',
};

// =================== Inicialização ===================
async function init() {
  fillIcons();
  initEditor({
    onClose: () => history.state && history.state.editor ? history.back() : closeNote(),
    onSave: saveNote,
    onShare: (meta, content, pageIndex) => shareNoteDialog(meta, content, pageIndex),
    onAddTask: meta => taskDialog({ noteId: meta.id, folderId: meta.folderId || '' }),
    onSettings: settingsDialog,
  });
  bindLibrary();
  await loadAll();
  if (!localStorage.getItem('caderno-seeded') && !state.notes.length && !state.folders.length) await seed();
  render();
  window.addEventListener('popstate', () => { if (editorIsOpen()) closeNote(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('pointerdown', () => navigator.storage?.persist?.().catch(() => {}), { once: true });
}

function fillIcons() {
  $('btn-new-folder').innerHTML = ic('plus');
  $('btn-settings').innerHTML = `${ic('settings')}<span>Ajustes e backup</span>`;
  $('btn-menu').innerHTML = ic('menu');
  $('btn-new').innerHTML = `${ic('plus')}<span>Nova anotação</span>`;
  document.querySelector('.search-ic').innerHTML = ic('search');
  $('btn-share-tasks').innerHTML = `${ic('share')}<span>Compartilhar lista</span>`;
  $('ed-back').innerHTML = ic('back');
  $('ed-undo').innerHTML = ic('undo');
  $('ed-redo').innerHTML = ic('redo');
  $('ed-task').innerHTML = ic('tasks');
  $('ed-paper').innerHTML = ic('page');
  $('ed-settings').innerHTML = ic('settings');
  $('ed-share').innerHTML = `${ic('share')}<span>Compartilhar</span>`;
  $('pg-prev').innerHTML = ic('left');
  $('pg-next').innerHTML = ic('right');
  $('pg-add').innerHTML = ic('plus');
  $('pg-del').innerHTML = ic('trash');
}

async function loadAll() {
  [state.folders, state.notes, state.tasks] = await Promise.all([db.all('folders'), db.all('notes'), db.all('tasks')]);
  state.folders.sort((a, b) => a.createdAt - b.createdAt);
}

async function seed() {
  localStorage.setItem('caderno-seeded', '1');
  const now = Date.now();
  const mk = (name, color, i) => ({ id: uid(), name, color, createdAt: now + i });
  const folders = [mk('Matemática', '#0a6cff', 0), mk('Português', '#e5352b', 1), mk('Ciências', '#1f9d4a', 2)];
  for (const f of folders) await db.put('folders', f);
  const T = (y, text, size = 28, color = '#1d1d1f', bold = false) => ({ id: uid(), x: 110, y, text, size, color, bold });
  const page = {
    id: uid(), strokes: [], images: [],
    texts: [
      T(60, 'Bem-vindo ao seu Caderno de Estudos!', 40, '#0a6cff', true),
      T(160, '✍  Escreva com a caneta: Caneta, Lápis ou Marca-texto,'),
      T(200, '     escolha cor e tamanho na barra de cima.'),
      T(280, '✨ Corrigir escrita: circule com o Laço e toque em'),
      T(320, '     "Corrigir escrita" — vira letra digitada certinha.'),
      T(400, '🧮 Verificar conta: escreva 7 + 5 = 12, circule e toque'),
      T(440, '     em "Verificar conta" → aparece ✓ ou ✗ com a resposta.'),
      T(520, '⚡ Auto: corrige ou confere contas sozinho quando você para.'),
      T(600, '🔷 Formas: desenhe um círculo e segure a caneta parada.'),
      T(680, '👆 Dois dedos: zoom e mover. Toque com 2 dedos = desfazer.'),
      T(760, '📁 Organize em pastas, crie tarefas e toque em Compartilhar'),
      T(800, '     para enviar PDF ou imagem pelo WhatsApp, e-mail…'),
      T(880, 'Teste aqui embaixo! ↓', 30, '#1f9d4a', true),
    ],
  };
  const id = uid();
  const meta = { id, title: 'Como usar (comece aqui)', folderId: '', fav: true, createdAt: now, updatedAt: now, pageCount: 1, thumb: '' };
  await db.put('pages', { id, bg: { type: 'lines', color: 'white' }, pages: [page] });
  await db.put('notes', meta);
  await db.put('tasks', { id: uid(), title: 'Experimentar a correção de escrita', done: false, due: todayStr(), prio: 2, folderId: '', noteId: id, createdAt: now });
  await loadAll();
}

// =================== Biblioteca ===================
function bindLibrary() {
  $('btn-new').onclick = () => (state.view.kind === 'tasks' ? taskDialog({}) : newNoteDialog());
  $('btn-new-folder').onclick = newFolder;
  $('btn-settings').onclick = settingsDialog;
  $('btn-menu').onclick = () => document.body.classList.toggle('side-open');
  $('scrim').onclick = () => document.body.classList.remove('side-open');
  $('search').oninput = e => { state.search = e.target.value.trim().toLowerCase(); renderMain(); };
  $('sort').value = settings.sort;
  $('sort').onchange = e => { settings.sort = e.target.value; saveSettings(); renderMain(); };
  $('task-form').onsubmit = async e => {
    e.preventDefault();
    const title = $('task-title').value.trim();
    if (!title) return;
    const t = {
      id: uid(), title, done: false, due: $('task-due').value, prio: +$('task-prio').value,
      folderId: $('task-folder').value, noteId: '', notes: '', createdAt: Date.now(),
    };
    await db.put('tasks', t);
    state.tasks.push(t);
    $('task-title').value = ''; $('task-due').value = '';
    render();
    toast('Tarefa adicionada');
  };
  $('task-filter').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    state.taskFilter = b.dataset.f;
    [...$('task-filter').children].forEach(x => x.classList.toggle('active', x === b));
    renderTasks();
  };
  $('btn-share-tasks').onclick = shareTasks;
}

function setView(v) {
  state.view = v;
  document.body.classList.remove('side-open');
  render();
}

function folderName(id) { return state.folders.find(f => f.id === id)?.name || ''; }
function folderColor(id) { return state.folders.find(f => f.id === id)?.color || '#9aa0a6'; }

function render() { renderSidebar(); renderMain(); }

function renderSidebar() {
  const v = state.view;
  const pending = state.tasks.filter(t => !t.done).length;
  const count = f => state.notes.filter(f).length;
  const item = (key, icon, label, n, active) =>
    `<button class="nav-item ${active ? 'active' : ''}" data-k="${key}">${ic(icon)}<span>${esc(label)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  $('nav-main').innerHTML =
    item('all', 'book', 'Todas as anotações', state.notes.length, v.kind === 'notes' && v.filter === 'all') +
    item('fav', 'star', 'Favoritas', count(n => n.fav), v.kind === 'notes' && v.filter === 'fav') +
    item('none', 'inbox', 'Sem pasta', count(n => !n.folderId), v.kind === 'notes' && v.filter === 'none') +
    item('tasks', 'tasks', 'Tarefas', pending, v.kind === 'tasks');
  $('nav-main').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    if (b.dataset.k === 'tasks') setView({ kind: 'tasks' });
    else setView({ kind: 'notes', filter: b.dataset.k });
  };
  $('nav-folders').innerHTML = state.folders.map(f => `
    <div class="nav-item folder ${v.kind === 'notes' && v.filter === f.id ? 'active' : ''}" data-id="${f.id}" role="button" tabindex="0">
      <span class="dot" style="background:${f.color}"></span><span>${esc(f.name)}</span>
      <em>${count(n => n.folderId === f.id) || ''}</em>
      <button class="icon-btn small more" data-more="${f.id}" aria-label="Opções da pasta">${ic('more')}</button>
    </div>`).join('') || '<p class="muted small pad">Crie pastas para separar por matéria.</p>';
  $('nav-folders').onclick = e => {
    const m = e.target.closest('[data-more]');
    if (m) { e.stopPropagation(); folderMenu(m.dataset.more); return; }
    const it = e.target.closest('[data-id]');
    if (it) setView({ kind: 'notes', filter: it.dataset.id });
  };
}

function viewTitle() {
  const v = state.view;
  if (v.kind === 'tasks') return 'Tarefas';
  if (v.filter === 'all') return 'Todas as anotações';
  if (v.filter === 'fav') return 'Favoritas';
  if (v.filter === 'none') return 'Sem pasta';
  return folderName(v.filter) || 'Pasta';
}

function renderMain() {
  const isTasks = state.view.kind === 'tasks';
  $('view-title').textContent = viewTitle();
  $('view-notes').hidden = isTasks;
  $('view-tasks').hidden = !isTasks;
  $('sort').hidden = isTasks;
  $('btn-new').querySelector('span').textContent = isTasks ? 'Nova tarefa' : 'Nova anotação';
  if (isTasks) renderTasks(); else renderNotes();
}

function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Hoje, ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ontem, ${hm}`;
  return d.toLocaleDateString('pt-BR');
}

function visibleNotes() {
  const f = state.view.filter, q = state.search;
  let list = state.notes.filter(n =>
    f === 'all' ? true : f === 'fav' ? n.fav : f === 'none' ? !n.folderId : n.folderId === f);
  if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || folderName(n.folderId).toLowerCase().includes(q));
  const s = settings.sort;
  list.sort((a, b) => s === 'title' ? a.title.localeCompare(b.title, 'pt-BR') : s === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  return list;
}

function renderNotes() {
  const list = visibleNotes();
  const grid = $('notes-grid');
  grid.innerHTML = `<button class="card new-card" id="card-new">${ic('plus')}<span>Nova anotação</span></button>` +
    list.map(n => `
    <div class="card" data-id="${n.id}" role="button" tabindex="0">
      <div class="thumb">${n.thumb ? `<img src="${n.thumb}" alt="" loading="lazy">` : `<div class="thumb-empty">${ic('page')}</div>`}</div>
      <div class="card-info">
        <div class="card-title">${esc(n.title)}</div>
        <div class="card-meta">${n.folderId ? `<span class="dot" style="background:${folderColor(n.folderId)}"></span>${esc(folderName(n.folderId))} · ` : ''}${fmtDate(n.updatedAt)} · ${n.pageCount || 1} pág.</div>
      </div>
      <button class="icon-btn small fav ${n.fav ? 'on' : ''}" data-fav="${n.id}" aria-label="Favoritar">${ic('star')}</button>
      <button class="icon-btn small more" data-more="${n.id}" aria-label="Opções">${ic('more')}</button>
    </div>`).join('');
  $('notes-empty').hidden = list.length > 0;
  $('notes-empty').innerHTML = state.search
    ? `${ic('search')}<p>Nada encontrado para “${esc(state.search)}”.</p>`
    : `${ic('book')}<p>Nenhuma anotação aqui ainda.</p><p class="muted">Toque em <b>Nova anotação</b> para começar.</p>`;
  $('card-new').onclick = () => newNoteDialog();
  grid.onclick = async e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.stopPropagation(); const n = noteById(fav.dataset.fav); n.fav = !n.fav; await db.put('notes', n); render(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); noteMenu(more.dataset.more); return; }
    const card = e.target.closest('.card[data-id]');
    if (card) openNote(card.dataset.id);
  };
}

const noteById = id => state.notes.find(n => n.id === id);

function folderOptions(sel, emptyLabel = 'Sem pasta') {
  return `<option value="">${emptyLabel}</option>` +
    state.folders.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}

// =================== Pastas ===================
async function folderDialog(f) {
  const isNew = !f;
  f = f ? { ...f } : { id: uid(), name: '', color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length], createdAt: Date.now() };
  const body = h(`<div>
    <label class="lbl">Nome da pasta</label>
    <input class="input" id="f-name" value="${esc(f.name)}" placeholder="Ex.: Matemática, História, Inglês…">
    <label class="lbl">Cor</label>
    <div class="swatches big" id="f-colors">${FOLDER_COLORS.map(c => `<button class="sw ${c === f.color ? 'active' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}</div>
  </div>`);
  body.querySelector('#f-colors').onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    f.color = b.dataset.c;
    body.querySelectorAll('.sw').forEach(x => x.classList.toggle('active', x === b));
  };
  const ok = await modal({
    title: isNew ? 'Nova pasta' : 'Editar pasta', body,
    actions: [{ label: 'Cancelar', value: false }, {
      label: isNew ? 'Criar' : 'Salvar', primary: true, value: true,
      validate: el => { const ok = !!el.querySelector('#f-name').value.trim(); if (!ok) toast('Digite um nome'); return ok; },
    }],
    onOpen: el => el.querySelector('#f-name').addEventListener('input', e => { f.name = e.target.value; }),
  });
  if (!ok) return null;
  f.name = f.name.trim();
  await db.put('folders', f);
  const i = state.folders.findIndex(x => x.id === f.id);
  if (i >= 0) state.folders[i] = f; else state.folders.push(f);
  render();
  return f;
}
async function newFolder() {
  const f = await folderDialog(null);
  if (f) { setView({ kind: 'notes', filter: f.id }); toast(`Pasta “${f.name}” criada`); }
}
async function folderMenu(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  const a = await menu(f.name, [
    { label: 'Nova anotação nesta pasta', icon: 'plus', value: 'new' },
    { label: 'Renomear / mudar cor', icon: 'edit', value: 'edit' },
    { label: 'Compartilhar todas (PDF)', icon: 'share', value: 'share' },
    { label: 'Excluir pasta', icon: 'trash', value: 'del', danger: true },
  ]);
  if (a === 'new') newNoteDialog(f.id);
  else if (a === 'edit') folderDialog(f);
  else if (a === 'share') shareFolder(f);
  else if (a === 'del') {
    const notes = state.notes.filter(n => n.folderId === id);
    const choice = await modal({
      title: `Excluir “${f.name}”`,
      body: `<p>${notes.length ? `Esta pasta tem ${notes.length} anotação(ões). O que fazer com elas?` : 'A pasta está vazia.'}</p>`,
      actions: [
        { label: 'Cancelar', value: null },
        ...(notes.length ? [{ label: 'Excluir tudo', value: 'all', danger: true }] : []),
        { label: notes.length ? 'Mover para “Sem pasta”' : 'Excluir', value: 'keep', primary: true },
      ],
    });
    if (!choice) return;
    for (const n of notes) {
      if (choice === 'all') { await db.del('notes', n.id); await db.del('pages', n.id); }
      else { n.folderId = ''; await db.put('notes', n); }
    }
    if (choice === 'all') state.notes = state.notes.filter(n => n.folderId !== id);
    for (const t of state.tasks) if (t.folderId === id) { t.folderId = ''; await db.put('tasks', t); }
    await db.del('folders', id);
    state.folders = state.folders.filter(x => x.id !== id);
    setView({ kind: 'notes', filter: 'all' });
    toast('Pasta excluída');
  }
}

// =================== Anotações ===================
async function newNoteDialog(folderId) {
  const v = state.view;
  const defFolder = folderId ?? (v.kind === 'notes' && !['all', 'fav', 'none'].includes(v.filter) ? v.filter : '');
  const last = (() => { try { return JSON.parse(localStorage.getItem('caderno-ultimo-papel')) || {}; } catch { return {}; } })();
  const choice = { type: last.type || 'lines', color: last.color || 'white' };
  const body = h(`<div>
    <label class="lbl">Título</label>
    <input class="input" id="n-title" placeholder="Ex.: Lista de exercícios – frações">
    <label class="lbl">Pasta</label>
    <div class="row"><select class="select grow" id="n-folder">${folderOptions(defFolder)}</select>
      <button class="btn" id="n-newfolder" type="button">${ic('plus')}<span>Nova pasta</span></button></div>
    <label class="lbl">Tipo de folha</label>
    <div class="paper-opts" data-g="type">${Object.entries(PAPER_TYPES).map(([k, l]) =>
      `<button type="button" class="paper-opt ${choice.type === k ? 'active' : ''}" data-v="${k}"><span class="pp pp-${k}"></span>${l}</button>`).join('')}</div>
    <label class="lbl">Cor do papel</label>
    <div class="paper-opts" data-g="color">${Object.entries(PAPER_COLORS).map(([k, c]) =>
      `<button type="button" class="paper-opt ${choice.color === k ? 'active' : ''}" data-v="${k}"><span class="pc" style="background:${c.fill}"></span>${c.label}</button>`).join('')}</div>
  </div>`);
  body.querySelectorAll('.paper-opts').forEach(g => g.onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    choice[g.dataset.g] = b.dataset.v;
    g.querySelectorAll('.paper-opt').forEach(x => x.classList.toggle('active', x === b));
  });
  body.querySelector('#n-newfolder').onclick = async () => {
    const f = await folderDialog(null);
    if (f) { const s = body.querySelector('#n-folder'); s.innerHTML = folderOptions(f.id); }
  };
  const res = await modal({
    title: 'Nova anotação', body,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Criar', primary: true,
      value: el => ({ title: el.querySelector('#n-title').value.trim(), folderId: el.querySelector('#n-folder').value }),
    }],
  });
  if (!res) return;
  localStorage.setItem('caderno-ultimo-papel', JSON.stringify(choice));
  const now = Date.now();
  const meta = {
    id: uid(), title: res.title || `Anotação ${new Date().toLocaleDateString('pt-BR')}`,
    folderId: res.folderId, fav: false, createdAt: now, updatedAt: now, pageCount: 1, thumb: '',
  };
  const content = { id: meta.id, bg: choice, pages: [{ id: uid(), strokes: [], texts: [], images: [] }] };
  await db.put('pages', content);
  await db.put('notes', meta);
  state.notes.push(meta);
  render();
  openNote(meta.id);
}

async function loadContent(id) {
  return (await db.get('pages', id)) ||
    { id, bg: { type: 'lines', color: 'white' }, pages: [{ id: uid(), strokes: [], texts: [], images: [] }] };
}

async function openNote(id) {
  const meta = noteById(id);
  if (!meta) return;
  const content = await loadContent(id);
  history.pushState({ editor: id }, '');
  document.body.classList.add('editing');
  openEditor(meta, content);
}

async function closeNote() {
  await closeEditor();
  document.body.classList.remove('editing');
  render();
}

async function saveNote(meta, content) {
  await db.put('pages', content);
  await db.put('notes', meta);
}

async function noteMenu(id) {
  const n = noteById(id);
  if (!n) return;
  const a = await menu(n.title, [
    { label: 'Abrir', icon: 'page', value: 'open' },
    { label: 'Compartilhar', icon: 'share', value: 'share' },
    { label: 'Renomear', icon: 'edit', value: 'rename' },
    { label: 'Mover para pasta', icon: 'folder', value: 'move' },
    { label: n.fav ? 'Remover dos favoritos' : 'Favoritar', icon: 'star', value: 'fav' },
    { label: 'Criar tarefa', icon: 'tasks', value: 'task' },
    { label: 'Duplicar', icon: 'copy', value: 'dup' },
    { label: 'Excluir', icon: 'trash', value: 'del', danger: true },
  ]);
  if (a === 'open') openNote(id);
  else if (a === 'share') shareNoteDialog(n, null, 0);
  else if (a === 'rename') {
    const t = await promptText('Renomear', n.title);
    if (t) { n.title = t; await db.put('notes', n); render(); }
  } else if (a === 'move') {
    const f = await modal({
      title: 'Mover para pasta',
      body: `<select class="select full" id="mv">${folderOptions(n.folderId)}</select>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Mover', primary: true, value: el => ({ v: el.querySelector('#mv').value }) }],
    });
    if (f) { n.folderId = f.v; await db.put('notes', n); render(); toast(`Movida para ${folderName(f.v) || 'Sem pasta'}`); }
  } else if (a === 'fav') { n.fav = !n.fav; await db.put('notes', n); render(); }
  else if (a === 'task') taskDialog({ noteId: n.id, folderId: n.folderId });
  else if (a === 'dup') {
    const c = await loadContent(id);
    const nid = uid(), now = Date.now();
    const meta = { ...n, id: nid, title: n.title + ' (cópia)', createdAt: now, updatedAt: now, fav: false };
    await db.put('pages', { ...c, id: nid });
    await db.put('notes', meta);
    state.notes.push(meta); render(); toast('Anotação duplicada');
  } else if (a === 'del') {
    if (!(await confirmBox('Excluir anotação', `Excluir “${n.title}” definitivamente?`, 'Excluir'))) return;
    await db.del('notes', id); await db.del('pages', id);
    state.notes = state.notes.filter(x => x.id !== id);
    for (const t of state.tasks) if (t.noteId === id) { t.noteId = ''; await db.put('tasks', t); }
    render(); toast('Anotação excluída');
  }
}

// =================== Compartilhar ===================
async function deliver(file, title) {
  const r = await shareFile(file, title, title);
  if (r === 'needs-gesture') {
    // a geração demorou; pede um novo toque para abrir o menu de compartilhar
    await modal({
      title: 'Arquivo pronto',
      body: `<p>${esc(file.name)}</p>`,
      actions: [
        { label: 'Baixar', value: 'dl' },
        { label: 'Compartilhar', primary: true, value: 'share' },
      ],
      onOpen: (el, close) => {
        const btns = el.querySelectorAll('.modal-actions .btn');
        btns[1].onclick = async () => { close('x'); const r2 = await shareFile(file, title, title); if (r2 === 'downloaded') toast('Arquivo salvo em Downloads'); };
        btns[0].onclick = () => { close('x'); download(file); toast('Arquivo salvo em Downloads'); };
      },
    });
  } else if (r === 'downloaded') toast('Arquivo salvo em Downloads');
}

async function shareNoteDialog(meta, content, pageIndex = 0) {
  content = content || await loadContent(meta.id);
  const n = content.pages.length;
  const a = await menu('Compartilhar atividade', [
    { label: `PDF — ${n > 1 ? `todas as ${n} páginas` : '1 página'}`, icon: 'page', value: 'pdf' },
    n > 1 ? { label: `PDF — só a página ${pageIndex + 1}`, icon: 'page', value: 'pdf1' } : null,
    { label: `Imagem (PNG) — página ${pageIndex + 1}`, icon: 'image', value: 'png' },
    { label: 'Salvar PDF no tablet', icon: 'download', value: 'save' },
  ]);
  if (!a) return;
  toast('Preparando arquivo…', 8000);
  try {
    let file;
    if (a === 'png') file = await pageToPNG(content.pages[pageIndex], content.bg, meta.title + `_pag${pageIndex + 1}`);
    else if (a === 'pdf1') file = await pagesToPDF([content.pages[pageIndex]], content.bg, meta.title + `_pag${pageIndex + 1}`);
    else file = await pagesToPDF(content.pages, content.bg, meta.title);
    document.getElementById('toast')?.classList.remove('show');
    if (a === 'save') { download(file); toast('PDF salvo em Downloads'); return; }
    await deliver(file, meta.title);
  } catch (e) {
    toast('Erro ao gerar arquivo: ' + (e.message || e), 4000);
  }
}

async function shareFolder(f) {
  const notes = state.notes.filter(n => n.folderId === f.id).sort((a, b) => a.createdAt - b.createdAt);
  if (!notes.length) { toast('Pasta vazia'); return; }
  toast('Preparando PDF da pasta…', 10000);
  let bg = null;
  const pages = [];
  // cada anotação mantém seu próprio papel
  for (const n of notes) { const c = await loadContent(n.id); bg ||= c.bg; pages.push(...c.pages.map(p => ({ ...p, _bg: c.bg }))); }
  const file = await pagesToPDF(pages, bg, f.name);
  document.getElementById('toast')?.classList.remove('show');
  await deliver(file, f.name);
}

// =================== Tarefas ===================
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDue(due) {
  if (!due) return '';
  const t = todayStr();
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (due === t) return 'Hoje';
  if (due === todayStr(tm)) return 'Amanhã';
  const [y, m, d] = due.split('-');
  return `${d}/${m}/${y}`;
}
function visibleTasks() {
  const f = state.taskFilter, t = todayStr(), q = state.search;
  let list = state.tasks.filter(x =>
    f === 'pending' ? !x.done : f === 'done' ? x.done : f === 'today' ? !x.done && x.due && x.due <= t :
    f === 'late' ? !x.done && x.due && x.due < t : true);
  if (q) list = list.filter(x => x.title.toLowerCase().includes(q) || (x.notes || '').toLowerCase().includes(q));
  list.sort((a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || (b.prio - a.prio) || (a.createdAt - b.createdAt));
  return list;
}
function renderTasks() {
  $('task-folder').innerHTML = folderOptions(
    state.view.kind === 'notes' ? '' : $('task-folder').value, 'Sem pasta');
  const list = visibleTasks(), t = todayStr();
  $('task-list').innerHTML = list.map(x => {
    const late = !x.done && x.due && x.due < t;
    const note = x.noteId && noteById(x.noteId);
    return `<div class="task prio-${x.prio} ${x.done ? 'done' : ''}" data-id="${x.id}">
      <button class="task-check" data-check="${x.id}" aria-label="Concluir">${ic('check')}</button>
      <div class="task-body" data-edit="${x.id}">
        <div class="task-title">${esc(x.title)}</div>
        <div class="task-meta">
          ${x.due ? `<span class="due ${late ? 'late' : ''}">${ic('calendar')}${fmtDue(x.due)}${late ? ' · atrasada' : ''}</span>` : ''}
          <span class="prio-tag">${['', 'Baixa', 'Média', 'Alta'][x.prio] || ''}</span>
          ${x.folderId ? `<span class="tag"><span class="dot" style="background:${folderColor(x.folderId)}"></span>${esc(folderName(x.folderId))}</span>` : ''}
          ${note ? `<button class="tag link" data-open="${note.id}">${ic('page')}${esc(note.title)}</button>` : ''}
          ${x.notes ? `<span class="muted">${esc(x.notes.slice(0, 80))}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn small" data-del="${x.id}" aria-label="Excluir">${ic('trash')}</button>
    </div>`;
  }).join('');
  $('tasks-empty').hidden = list.length > 0;
  $('tasks-empty').innerHTML = `${ic('tasks')}<p>${state.taskFilter === 'done' ? 'Nenhuma tarefa concluída.' : 'Nenhuma tarefa aqui. 🎉'}</p>`;
  $('task-list').onclick = async e => {
    const c = e.target.closest('[data-check]');
    if (c) {
      const x = state.tasks.find(t => t.id === c.dataset.check);
      x.done = !x.done; x.doneAt = x.done ? Date.now() : 0;
      await db.put('tasks', x);
      if (x.done) toast('Tarefa concluída ✓');
      render(); return;
    }
    const o = e.target.closest('[data-open]');
    if (o) { openNote(o.dataset.open); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!(await confirmBox('Excluir tarefa', 'Excluir esta tarefa?', 'Excluir'))) return;
      await db.del('tasks', d.dataset.del);
      state.tasks = state.tasks.filter(t => t.id !== d.dataset.del);
      render(); return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) taskDialog(state.tasks.find(t => t.id === ed.dataset.edit));
  };
}

async function taskDialog(t) {
  const isNew = !t.id;
  t = { title: '', due: '', prio: 2, folderId: '', noteId: '', notes: '', done: false, ...t };
  const noteOpts = '<option value="">Nenhuma</option>' + [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt)
    .map(n => `<option value="${n.id}" ${n.id === t.noteId ? 'selected' : ''}>${esc(n.title)}</option>`).join('');
  const body = h(`<div>
    <label class="lbl">Tarefa</label>
    <input class="input" id="t-title" value="${esc(t.title)}" placeholder="O que precisa fazer?">
    <div class="row">
      <div class="grow"><label class="lbl">Prazo</label><input class="input" type="date" id="t-due" value="${esc(t.due)}"></div>
      <div class="grow"><label class="lbl">Prioridade</label><select class="select full" id="t-prio">
        ${[1, 2, 3].map(p => `<option value="${p}" ${+t.prio === p ? 'selected' : ''}>${['', 'Baixa', 'Média', 'Alta'][p]}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="grow"><label class="lbl">Pasta</label><select class="select full" id="t-folder">${folderOptions(t.folderId)}</select></div>
      <div class="grow"><label class="lbl">Anotação ligada</label><select class="select full" id="t-note">${noteOpts}</select></div>
    </div>
    <label class="lbl">Observações</label>
    <textarea class="input" id="t-notes" rows="3" placeholder="Detalhes, páginas do livro…">${esc(t.notes)}</textarea>
    ${isNew ? '' : `<label class="check"><input type="checkbox" id="t-done" ${t.done ? 'checked' : ''}> Concluída</label>`}
  </div>`);
  const res = await modal({
    title: isNew ? 'Nova tarefa' : 'Editar tarefa', body,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', primary: true,
      validate: el => { const ok = !!el.querySelector('#t-title').value.trim(); if (!ok) toast('Digite a tarefa'); return ok; },
      value: el => ({
        title: el.querySelector('#t-title').value.trim(), due: el.querySelector('#t-due').value,
        prio: +el.querySelector('#t-prio').value, folderId: el.querySelector('#t-folder').value,
        noteId: el.querySelector('#t-note').value, notes: el.querySelector('#t-notes').value.trim(),
        done: el.querySelector('#t-done') ? el.querySelector('#t-done').checked : false,
      }),
    }],
  });
  if (!res) return;
  const task = { ...t, ...res, id: t.id || uid(), createdAt: t.createdAt || Date.now() };
  await db.put('tasks', task);
  const i = state.tasks.findIndex(x => x.id === task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  if (!editorIsOpen()) render();
  toast(isNew ? 'Tarefa criada' : 'Tarefa salva');
}

async function shareTasks() {
  const list = visibleTasks();
  if (!list.length) { toast('Nenhuma tarefa para compartilhar'); return; }
  const lines = list.map(x => `${x.done ? '✅' : '⬜'} ${x.title}${x.due ? ` — ${fmtDue(x.due)}` : ''}${x.folderId ? ` [${folderName(x.folderId)}]` : ''}`);
  const text = `📋 Minhas tarefas (${new Date().toLocaleDateString('pt-BR')})\n\n${lines.join('\n')}`;
  const r = await shareText(text, 'Tarefas');
  if (r === 'copied') toast('Lista copiada — cole onde quiser');
}

// =================== Ajustes e backup ===================
async function settingsDialog() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const body = h(`<div class="settings">
    <label class="switch"><input type="checkbox" id="s-finger" ${settings.fingerDraw ? 'checked' : ''}>
      <span><b>Desenhar com o dedo</b><small>Desligue ao usar a Redmi Smart Pen: o dedo passa a só mover e dar zoom (evita marcas da mão).</small></span></label>
    <label class="switch"><input type="checkbox" id="s-shapes" ${settings.shapes ? 'checked' : ''}>
      <span><b>Formas perfeitas</b><small>Segure a caneta parada no fim do traço para virar linha, círculo, retângulo…</small></span></label>
    <label class="lbl">Idioma da correção de escrita</label>
    <select class="select full" id="s-lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${settings.lang === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label class="lbl">Correção automática</label>
    <select class="select full" id="s-auto">
      <option value="off" ${settings.autoMode === 'off' ? 'selected' : ''}>Desligada</option>
      <option value="text" ${settings.autoMode === 'text' ? 'selected' : ''}>Transformar escrita em texto digitado</option>
      <option value="math" ${settings.autoMode === 'math' ? 'selected' : ''}>Conferir contas (✓ / ✗) ao terminar de escrever</option>
    </select>
    <hr>
    <label class="lbl">Backup</label>
    <p class="muted small">Tudo fica salvo no próprio tablet, sem precisar de conta. Faça backup de vez em quando (ex.: enviar para o Google Drive).</p>
    <div class="row wrap">
      <button class="btn" id="s-export" type="button">${ic('download')}<span>Exportar backup</span></button>
      <button class="btn" id="s-import" type="button">${ic('upload')}<span>Restaurar backup</span></button>
    </div>
    <p class="muted small">${est ? `Espaço usado: ${(est.usage / 1048576).toFixed(1)} MB` : ''}${persisted ? ' · armazenamento protegido ✓' : ''}</p>
    <hr>
    <details><summary><b>Como usar</b></summary>
      <ul class="help">
        <li><b>Caneta / Lápis / Marca-texto:</b> toque de novo na ferramenta para ver cores e tamanhos. Cada uma lembra sua cor.</li>
        <li><b>Borracha:</b> “Parcial” apaga só onde passa; “Traço inteiro” apaga o risco todo. O botão da caneta também apaga.</li>
        <li><b>Laço:</b> circule algo para mover, aumentar (bolinha no canto), mudar cor, duplicar, apagar, <b>Corrigir escrita</b> ou <b>Verificar conta</b>.</li>
        <li><b>Corrigir escrita:</b> transforma letras e números escritos à mão em texto digitado, com sugestões para escolher.</li>
        <li><b>Verificar conta:</b> escreva “12 + 8 = 20” e o app marca ✓ ou ✗ mostrando o resultado certo. Aceita + − × ÷ : x / ^ √ % e vírgula decimal.</li>
        <li><b>Gestos:</b> pinça com 2 dedos = zoom; arrastar com 2 dedos = mover; toque com 2 dedos = desfazer; 3 dedos = refazer.</li>
        <li><b>Compartilhar:</b> envia PDF ou imagem pelo WhatsApp, Gmail, Drive, Classroom…</li>
        <li>A correção usa a internet; todo o resto funciona offline.</li>
      </ul>
    </details>
  </div>`);
  body.querySelector('#s-export').onclick = exportBackup;
  body.querySelector('#s-import').onclick = () => $('backup-input').click();
  await modal({ title: 'Ajustes', body, wide: true, actions: [{ label: 'Fechar', value: true, primary: true }] });
  settings.fingerDraw = body.querySelector('#s-finger').checked;
  settings.shapes = body.querySelector('#s-shapes').checked;
  settings.lang = body.querySelector('#s-lang').value;
  settings.autoMode = body.querySelector('#s-auto').value;
  saveSettings();
  syncToggles();
}

async function exportBackup() {
  toast('Gerando backup…');
  const data = { app: 'caderno-estudos', version: 1, exportedAt: new Date().toISOString() };
  for (const s of db.STORES) data[s] = await db.all(s);
  const file = new File([JSON.stringify(data)], `backup_caderno_${todayStr()}.json`, { type: 'application/json' });
  const r = await shareFile(file, 'Backup do Caderno de Estudos', '');
  if (r === 'downloaded' || r === 'needs-gesture') { if (r === 'needs-gesture') download(file); toast('Backup salvo em Downloads'); }
}

$('backup-input').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'caderno-estudos') throw new Error('Arquivo não é um backup do Caderno');
    const n = (data.notes || []).length, t = (data.tasks || []).length;
    if (!(await confirmBox('Restaurar backup', `Restaurar ${n} anotação(ões), ${(data.folders || []).length} pasta(s) e ${t} tarefa(s)? Itens iguais serão substituídos; o resto é mantido.`, 'Restaurar', false))) return;
    for (const s of db.STORES) for (const it of data[s] || []) await db.put(s, it);
    await loadAll();
    document.querySelector('.modal-back')?._close?.(true);
    render();
    toast('Backup restaurado ✓');
  } catch (err) {
    toast('Erro ao restaurar: ' + err.message, 4000);
  }
});

init();
