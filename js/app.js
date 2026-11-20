// App principal: biblioteca (pastas e anotações), tarefas, ajustes, compartilhamento e backup.
import { db, settings, saveSettings } from './store.js';
import { uid, PAPER_COLORS, PAPER_TYPES, PAGE_W, PAGE_H, layoutText } from './ink.js';
import { initEditor, openEditor, closeEditor, editorIsOpen, syncToggles, insertImagePages, insertText, getEditorContext } from './editor.js';
import { initAIPanel, toggleAIPanel, resetAIPanel, openAIDialog } from './aipanel.js';
import { streamChat, aiConfigured, usingBuiltinKey, hasBuiltinKey } from './ai.js';
import { initData, DATA_VIEWS, renderData, importBackupFile } from './data.js';
import { filesToPages } from './importer.js';
import { initHub, renderHub as renderHubView, leaveHub, hubNewAction as hubNew, HUB_VIEWS as HUB_ONLY, HUB_NEW_LABEL as HUB_LABELS, hubCounts, reloadHub, saveFlashcards, addDays, dayStr, startFocus } from './hub.js';
import { initPlus, reloadPlus, PLUS_VIEWS, PLUS_NEW_LABEL, renderPlus, plusNewAction, plusToday, plusCounts, newReview, toggleReview, renderBoard, renderMatrix, noteForClass } from './plus.js';
import { initPerf, reloadPerf, PERF_VIEWS, PERF_NEW_LABEL, renderPerf, perfNewAction, perfCounts, extraToday, levelBadge, examsOn, openPalette, openBookOrNew, newGrade, kindleRetry } from './perf.js';
import { initGoals, reloadGoals, GOAL_VIEWS, renderGoals, goalsToday, goalsCount, newGoal } from './goals.js';
import { initQuiz, reloadQuiz, QUIZ_VIEWS, renderQuiz, leaveQuiz } from './quiz.js';
import { initNav, SECTIONS, sectionOf, sidebarHTML, navItem, updateBottomBar, renderMap, quickAdd, addTip, tour, initSidebar, toggleMenu } from './nav.js';
import { initQuick, reloadQuick, QUICK_VIEWS, renderQuick, newQuick, quickToday, addQuick } from './quicknotes.js';
import { initTutor, reloadTutor, TUTOR_VIEWS, renderTutor, leaveTutor } from './tutor.js';
import { initRecorder, reloadRecorder, toggleRecording, openRecordings, startRecording, recCounts, isRecording } from './recorder.js';
import { initSuggest, suggestToday } from './suggest.js';
import * as EVM from './events.js';

// Registro único de todas as telas da central: título, ícone, como desenhar e o botão "novo"
const VIEW_REG = {};
const reg = (views, render, labels = {}, action = () => {}, isHub = false) => {
  for (const [k, v] of Object.entries(views)) VIEW_REG[k] = { ...v, render: el => render(k, el), newLabel: labels[k], newAction: () => action(k), isHub };
};
reg(HUB_ONLY, (k, el) => renderHubView(k, el), HUB_LABELS, k => hubNew(k), true);
reg(PLUS_VIEWS, (k, el) => renderPlus(k, el), PLUS_NEW_LABEL, k => plusNewAction(k));
reg(PERF_VIEWS, (k, el) => renderPerf(k, el), PERF_NEW_LABEL, k => perfNewAction(k));
reg(GOAL_VIEWS, (k, el) => renderGoals(el), { goals: 'Nova meta' }, () => newGoal());
reg(QUIZ_VIEWS, (k, el) => renderQuiz(el), {}, () => {});
reg({ map: { title: 'Tudo', icon: 'grid' } }, (k, el) => renderMap(el));
reg(DATA_VIEWS, (k, el) => renderData(el));
reg(QUICK_VIEWS, (k, el) => renderQuick(el), { quick: 'Nova nota' }, () => newQuick());
reg(TUTOR_VIEWS, (k, el) => renderTutor(el), { tutor: '' });
const HUB_VIEWS = VIEW_REG;
const renderHub = (kind, el) => {
  if (!VIEW_REG[kind].isHub) leaveHub();
  if (kind !== 'quiz') leaveQuiz();
  if (kind !== 'tutor') leaveTutor();
  VIEW_REG[kind].render(el);
};
const hubNewAction = kind => VIEW_REG[kind].newAction();
// cartões extras do painel Hoje (aulas, revisões, metas, diário, provas, leitura, atalhos)
const todayCards = {
  html: () => EVM.eventsToday.html() + quickToday.html() + plusToday.html() + goalsToday.html() + extraToday.html(),
  bind: el => { quickToday.bind(el); plusToday.bind(el); goalsToday.bind(el); extraToday.bind(el); },
};
import { pagesToPDF, pageToPNG, shareFile, shareText, download } from './export.js';
import { LANGS } from './recognize.js';
import { ic, esc, h, toast, modal, promptText, confirmBox, menu } from './ui.js';

const $ = id => document.getElementById(id);
const FOLDER_COLORS = ['#0a6cff', '#e5352b', '#1f9d4a', '#ff8a00', '#8e44d6', '#00a6b4', '#ff4fa3', '#8b5a2b', '#6b6b70'];

const state = {
  folders: [], notes: [], tasks: [],
  view: { kind: 'today' }, // today | calendar | focus | cards | habits | tasks | notes (filter: all | fav | none | <folderId>)
  search: '', taskFilter: 'pending',
};

// =================== Inicialização ===================
let appReady = false;
// Aparência: tema e tamanho do texto
function applyLook() {
  const r = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') r.dataset.theme = settings.theme; else delete r.dataset.theme;
  r.style.setProperty('--ui-zoom', String(settings.uiScale || 1));
  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1e2126' : '#1f6feb');
}
async function init() {
  applyLook();
  fillIcons();
  initEditor({
    onClose: () => history.state && history.state.editor ? history.back() : closeNote(),
    onSave: saveNote,
    onShare: (meta, content, pageIndex) => shareNoteDialog(meta, content, pageIndex),
    onAddTask: meta => taskDialog({ noteId: meta.id, folderId: meta.folderId || '' }),
    onSettings: settingsDialog,
    onAI: toggleAIPanel,
    onImport: () => pickImport('editor'),
    onRecord: meta => toggleRecording(meta),
    onRecordings: meta => openRecordings(meta),
  });
  initAIPanel({
    onSettings: settingsDialog,
    folderName: id => folderName(id),
    onCreateTasks: createTasksFromAI,
    onSaveCards: (cards, meta) => saveFlashcards(cards, {
      deckName: meta ? (folderName(meta.folderId) ? `${folderName(meta.folderId)} — ${meta.title}` : meta.title) : 'Flashcards da IA',
      folderId: meta?.folderId || '',
    }),
  });
  bindLibrary();
  await loadAll();
  if (!localStorage.getItem('caderno-seeded') && !state.notes.length && !state.folders.length) await seed();
  const api = {
    db, uid, state, loadContent, openNote, taskDialog, toggleTask, folderName, folderColor, folderOptions, saveFlashcards,
    newNote: () => newNoteDialog(),
    addTask,
    goTo: v => { if (editorIsOpen()) history.back(); setView(v); },
    // só redesenha depois que todos os módulos terminaram de carregar
    onChange: light => { if (!appReady || editorIsOpen()) return; light ? renderSidebar() : render(); },
    views: () => HUB_VIEWS,
    importPdf: () => pickImport('library'),
    settings: settingsDialog,
    extraToday: todayCards, todayTop: suggestToday, levelBadge, examsOn, createNote, createNoteFromText,
    addQuick: (text, extra) => addQuick(text, extra),
    writeToNote,
    noteForClass,
    startRecording: (meta, title) => startRecording({ noteId: meta.id, title: title || `Aula — ${meta.title}` }),
    journalMissing: () => plusCounts().journal === 1,
    ev: EVM,
    // navegação
    go: k => { if (editorIsOpen()) history.back(); setView(k === 'notes' ? { kind: 'notes', filter: 'all' } : { kind: k }); },
    counts: navCounts,
    quick: quickAction,
    contextNew: () => {
      const k = state.view.kind;
      const label = HUB_VIEWS[k] ? HUB_VIEWS[k].newLabel : k === 'tasks' ? 'Nova tarefa' : 'Nova anotação';
      if (!label || k === 'focus' || k === 'today') return null;
      return { label, where: viewTitle(), run: () => $('btn-new').click() };
    },
    reloadAll,
    currentView: () => state.view.kind,
    afterTour: () => { if (!aiReadyAny()) toast('Dica: ligue a IA em Ajustes → Inteligência artificial', 4000); },
  };
  initNav(api);
  initSidebar();
  await initHub(api);
  await initPerf(api);
  await initPlus(api);
  await initGoals(api);
  await initQuiz(api);
  await initQuick(api);
  await initTutor(api);
  await initRecorder(api);
  await EVM.initEvents(api);
  initSuggest(api);
  EXTRA_RELOADS.push(reloadQuick, reloadTutor, reloadRecorder, EVM.reloadEvents);
  initData(api);
  appReady = true;
  routeFromURL();
  render();
  setTimeout(() => tour(false), 600);
  $('btn-palette').onclick = openPalette;
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
  window.addEventListener('popstate', () => { if (editorIsOpen()) closeNote(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('pointerdown', () => navigator.storage?.persist?.().catch(() => {}), { once: true });
}

function fillIcons() {
  $('btn-new-folder').innerHTML = ic('plus');
  $('btn-settings').innerHTML = `${ic('settings')}<span class="lbl-full">Ajustes e IA</span><span class="lbl-short">Ajustes</span>`;
  $('btn-map').innerHTML = `${ic('grid')}<span class="lbl-full">Tudo e ajuda</span><span class="lbl-short">Tudo</span>`;
  $('btn-data').innerHTML = `${ic('database')}<span class="lbl-full">Dados e backup</span><span class="lbl-short">Dados</span>`;
  $('btn-menu').innerHTML = ic('menu');
  $('btn-palette').innerHTML = ic('search');
  $('btn-new').innerHTML = `${ic('plus')}<span>Nova anotação</span>`;
  $('btn-import').innerHTML = `${ic('upload')}<span>Importar PDF</span>`;
  $('ed-ai').innerHTML = `${ic('magic')}<span>IA</span>`;
  $('ed-import').innerHTML = ic('upload');
  $('ed-rec').innerHTML = ic('mic');
  $('ed-recs').innerHTML = ic('play');
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
// Relê o banco inteiro (depois de restaurar backup, reparar ou apagar tudo)
async function reloadAll() {
  await loadAll();
  await Promise.all([reloadHub(), reloadPerf(), reloadPlus(), reloadGoals(), reloadQuiz(), ...EXTRA_RELOADS.map(f => f())]);
  if (appReady && !editorIsOpen()) render();
}
const EXTRA_RELOADS = [];

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
      T(840, '✦  IA: toque em "IA" para resumir, melhorar sua escrita e mais.'),
      T(920, 'Teste aqui embaixo! ↓', 30, '#1f9d4a', true),
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
  $('btn-new').onclick = () => (HUB_VIEWS[state.view.kind] ? hubNewAction(state.view.kind) : state.view.kind === 'tasks' ? taskDialog({}) : newNoteDialog());
  $('btn-new-folder').onclick = newFolder;
  $('btn-settings').onclick = settingsDialog;
  $('btn-map').onclick = () => setView({ kind: 'map' });
  $('btn-menu').onclick = toggleMenu;
  $('btn-data').onclick = () => setView({ kind: 'data' });
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
  $('task-mode').onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    localStorage.setItem('caderno-modo-tarefas', b.dataset.m);
    renderTasks();
  };
  $('btn-import').onclick = () => pickImport('library');
  $('import-input').addEventListener('change', onImportFiles);
}

// =================== Importar PDF / fotos ===================
let importMode = 'library';
function pickImport(mode) { importMode = mode; $('import-input').click(); }

function imagePage(img) {
  const k = Math.min(PAGE_W / img.w, PAGE_H / img.h);
  const w = img.w * k, hh = img.h * k;
  return { id: uid(), strokes: [], texts: [], images: [{ id: uid(), src: img.src, x: (PAGE_W - w) / 2, y: (PAGE_H - hh) / 2, w, h: hh, locked: true }] };
}

async function onImportFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  let res;
  try {
    toast('Importando…', 60000);
    res = await filesToPages(files, msg => toast(`Importando ${msg}…`, 60000));
  } catch (err) {
    toast('Não foi possível importar: ' + (err.message || err), 4500);
    return;
  }
  if (!res.pages.length) { toast('Nenhuma página encontrada nos arquivos'); return; }
  const extra = res.skipped ? ` (${res.skipped} páginas ignoradas: limite de 60 por PDF)` : '';
  if (importMode === 'editor' && editorIsOpen()) {
    insertImagePages(res.pages);
    toast(`${res.pages.length} página(s) importada(s)${extra}`, 3500);
    return;
  }
  const v = state.view;
  const folderId = v.kind === 'notes' && !['all', 'fav', 'none'].includes(v.filter) ? v.filter : '';
  const now = Date.now();
  const meta = {
    id: uid(), title: files[0].name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Importado',
    folderId, fav: false, createdAt: now, updatedAt: now, pageCount: res.pages.length, thumb: '',
  };
  await db.put('pages', { id: meta.id, bg: { type: 'blank', color: 'white' }, pages: res.pages.map(imagePage) });
  await db.put('notes', meta);
  state.notes.push(meta);
  render();
  toast(`${res.pages.length} página(s) importada(s) — escreva por cima!${extra}`, 3500);
  openNote(meta.id);
}

// =================== IA fora do editor ===================
async function createNoteFromText(title, folderId, text, { open = true } = {}) {
  const groups = layoutText(text);
  const now = Date.now();
  const meta = { id: uid(), title, folderId: folderId || '', fav: false, createdAt: now, updatedAt: now, pageCount: groups.length, thumb: '', searchText: String(text).slice(0, 5000) };
  await db.put('pages', { id: meta.id, bg: { type: 'lines', color: 'white' }, pages: groups.map(g => ({ id: uid(), strokes: [], texts: g, images: [] })) });
  await db.put('notes', meta);
  state.notes.push(meta);
  if (!editorIsOpen()) render();
  toast('Anotação criada ✓');
  if (open) openNote(meta.id);
  return meta;
}

// Escreve um texto (ex.: resumo da gravação) no fim de uma anotação: no editor, se ela estiver aberta; senão, direto no banco
async function writeToNote(noteId, text, title) {
  const ctx = getEditorContext();
  if (ctx && ctx.meta.id === noteId) {
    const n = insertText(`# ${title}\n${text}`, 'new');
    toast(`Escrito na anotação ✓ (${n} página${n > 1 ? 's' : ''})`);
    return;
  }
  const meta = noteById(noteId);
  if (!meta) { await createNoteFromText(title, '', text, { open: false }); return; }
  const c = await loadContent(noteId);
  const dark = c.bg && c.bg.color === 'dark';
  const groups = layoutText(`# ${title}\n${text}`, { color: dark ? '#f1f3f5' : '#1d1d1f', accent: dark ? '#7fb2ff' : '#0a6cff' });
  c.pages.push(...groups.map(g => ({ id: uid(), strokes: [], texts: g, images: [] })));
  meta.pageCount = c.pages.length;
  meta.updatedAt = Date.now();
  meta.searchText = ((meta.searchText || '') + ' ' + text).slice(0, 5000);
  await db.put('pages', c);
  await db.put('notes', meta);
  if (!editorIsOpen()) render();
  toast(`Escrito em “${meta.title}” ✓ (${groups.length} página${groups.length > 1 ? 's' : ''} no fim)`, 3500);
}

async function aiForNote(n) {
  const c = await loadContent(n.id);
  openAIDialog({
    title: n.title, subtitle: `${c.pages.length} página(s)`, pages: c.pages, bg: c.bg,
    folder: folderName(n.folderId), onSettings: settingsDialog,
    onSave: text => createNoteFromText(`IA – ${n.title}`, n.folderId, text),
  });
}

async function aiForFolder(f) {
  const notes = state.notes.filter(n => n.folderId === f.id).sort((a, b) => a.createdAt - b.createdAt);
  if (!notes.length) { toast('Pasta vazia'); return; }
  const pages = [];
  for (const n of notes) {
    const c = await loadContent(n.id);
    pages.push(...c.pages.map(p => ({ ...p, _bg: c.bg, _title: n.title })));
  }
  openAIDialog({
    title: f.name, subtitle: `${notes.length} anotação(ões), ${pages.length} página(s)`, pages, bg: null,
    folder: f.name, onSettings: settingsDialog,
    onSave: text => createNoteFromText(`IA – ${f.name}`, f.id, text),
  });
}

async function createTasksFromAI(titles, meta) {
  const now = Date.now();
  let n = 0;
  for (const title of titles) {
    const t = { id: uid(), title, done: false, due: '', prio: 2, folderId: meta?.folderId || '', noteId: meta?.id || '', notes: 'Criada pelo plano de estudo da IA', createdAt: now + n };
    await db.put('tasks', t); state.tasks.push(t); n++;
  }
  return n;
}

// números que aparecem ao lado de cada item do menu
function navCounts() {
  const hc = hubCounts(), pc = perfCounts(), xc = plusCounts();
  return {
    tasks: state.tasks.filter(t => !t.done).length, cards: hc.cards, habits: hc.habits, grades: pc.exams,
    notes: state.notes.length, goals: goalsCount(), running: hc.running, today: xc.review,
  };
}
const aiReadyAny = () => aiConfigured();

// Botão + : cria qualquer coisa
async function quickAction(k) {
  const go = kind => { if (state.view.kind !== kind) setView({ kind }); };
  if (k === 'note') newNoteDialog();
  else if (k === 'task') taskDialog({});
  else if (k === 'focus') { startFocus(); go('focus'); }
  else if (k === 'card') { go('cards'); setTimeout(() => toast('Escolha um baralho em “Ver cartas” e adicione a carta', 3500), 300); }
  else if (k === 'quiz') go('quiz');
  else if (k === 'reading') openBookOrNew();
  else if (k === 'grade') newGrade();
  else if (k === 'journal') { go('journal'); setTimeout(() => document.getElementById('jr-learned')?.focus(), 300); }
  else if (k === 'goal') newGoal();
  else if (k === 'class') { go('schedule'); hubNewAction('schedule'); }
  else if (k === 'pdf') pickImport('library');
  else if (k === 'search') openPalette();
  else if (k === 'quicknote') newQuick();
  else if (k === 'event') EVM.eventDialog(null, { date: dayStr() });
  else if (k === 'tutor') go('tutor');
  else if (k === 'record') {
    if (isRecording()) { toast('Já existe uma gravação em andamento: toque no botão vermelho para parar'); return; }
    const d = new Date();
    const meta = await createNote({ title: `Aula — ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` });
    await startRecording({ noteId: meta.id, title: meta.title });
  }
}

function setView(v) {
  if (!HUB_VIEWS[v.kind]) { leaveHub(); leaveQuiz(); }
  state.view = v;
  document.body.classList.remove('side-open');
  render();
}

function folderName(id) { return state.folders.find(f => f.id === id)?.name || ''; }
function folderColor(id) { return state.folders.find(f => f.id === id)?.color || '#9aa0a6'; }

function render() { renderSidebar(); renderMain(); }

function renderSidebar() {
  const v = state.view;
  const count = f => state.notes.filter(f).length;
  const item = (key, icon, label, n, active, short) => navItem(key, icon, label, n, active, short);
  const xc = plusCounts();
  $('nav-main').innerHTML = sidebarHTML(v.kind === 'notes' ? (v.filter === 'all' ? 'notes' : '') : v.kind, navCounts(),
    item('fav', 'star', 'Favoritas', count(n => n.fav), v.kind === 'notes' && v.filter === 'fav') +
    item('none', 'inbox', 'Sem pasta', count(n => !n.folderId), v.kind === 'notes' && v.filter === 'none', 'S/ pasta') +
    (xc.review ? item('review', 'repeat', `Revisar hoje (${xc.review})`, 0, false, `Revisar ${xc.review}`) : ''));
  $('nav-main').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    if (b.dataset.k === 'review') setView({ kind: 'today' });
    else if (b.dataset.k === 'tasks' || HUB_VIEWS[b.dataset.k]) setView({ kind: b.dataset.k });
    else setView({ kind: 'notes', filter: b.dataset.k });
  };
  $('nav-folders').innerHTML = state.folders.map(f => `
    <div class="nav-item folder ${v.kind === 'notes' && v.filter === f.id ? 'active' : ''}" data-id="${f.id}" role="button" tabindex="0" title="${esc(f.name)}">
      <span class="dot" style="background:${f.color}"></span><span class="lbl-full">${esc(f.name)}</span><span class="lbl-short">${esc(f.name)}</span>
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
  if (HUB_VIEWS[v.kind]) return HUB_VIEWS[v.kind].title;
  if (v.filter === 'all') return 'Caderno';
  if (v.filter === 'fav') return 'Favoritas';
  if (v.filter === 'none') return 'Sem pasta';
  return folderName(v.filter) || 'Pasta';
}

function renderMain() {
  const kind = state.view.kind;
  const isTasks = kind === 'tasks', isHub = !!HUB_VIEWS[kind];
  $('view-title').textContent = viewTitle();
  // nome da área (Planejar / Estudar / Acompanhar) acima do título, para saber onde está
  const sec = sectionOf(kind === 'notes' ? 'notes' : kind);
  $('view-section').textContent = sec ? `${sec.emoji} ${sec.title}` : kind === 'notes' ? '📚 Estudar · Caderno' : '';
  updateBottomBar(kind);
  $('view-notes').hidden = isTasks || isHub;
  $('view-tasks').hidden = !isTasks;
  $('view-hub').hidden = !isHub;
  // o Tutor ocupa a altura toda (a conversa rola por dentro, a caixa de texto fica sempre à vista)
  $('view-hub').classList.toggle('fill', kind === 'tutor');
  document.body.classList.toggle('in-tutor', kind === 'tutor');
  $('sort').hidden = isTasks || isHub;
  document.querySelector('.search').hidden = isHub;
  $('btn-import').hidden = isHub || isTasks;
  const label = isHub ? VIEW_REG[kind].newLabel : isTasks ? 'Nova tarefa' : 'Nova anotação';
  $('btn-new').hidden = !label || kind === 'focus';
  if (label) $('btn-new').querySelector('span').textContent = label;
  const el = isHub ? $('view-hub') : isTasks ? $('view-tasks') : $('view-notes');
  el.querySelector(':scope > .view-tip')?.remove();
  if (isHub) renderHub(kind, el);
  else if (isTasks) renderTasks(); else renderNotes();
  addTip(el, kind === 'notes' && state.view.filter !== 'all' ? '' : kind);
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
  if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || folderName(n.folderId).toLowerCase().includes(q) || (n.searchText || '').toLowerCase().includes(q));
  const s = settings.sort;
  list.sort((a, b) => s === 'title' ? a.title.localeCompare(b.title, 'pt-BR') : s === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  return list;
}

function renderNotes() {
  const list = visibleNotes();
  const recs = recCounts();
  const grid = $('notes-grid');
  grid.innerHTML = `<button class="card new-card" id="card-new">${ic('plus')}<span>Nova anotação</span></button>` +
    list.map(n => `
    <div class="card" data-id="${n.id}" role="button" tabindex="0">
      <div class="thumb">${n.thumb ? `<img src="${n.thumb}" alt="" loading="lazy">` : `<div class="thumb-empty">${ic('page')}</div>`}</div>
      <div class="card-info">
        <div class="card-title">${esc(n.title)}</div>
        <div class="card-meta">${n.folderId ? `<span class="dot" style="background:${folderColor(n.folderId)}"></span>${esc(folderName(n.folderId))} · ` : ''}${fmtDate(n.updatedAt)} · ${n.pageCount || 1} pág.${recs[n.id] ? ` · <span class="rec-badge" title="${recs[n.id]} gravação(ões)">${ic('mic')}${recs[n.id]}</span>` : ''}</div>
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
    { label: 'Assistente IA: resumir a pasta…', icon: 'magic', value: 'ai' },
    { label: 'Compartilhar todas (PDF)', icon: 'share', value: 'share' },
    { label: 'Excluir pasta', icon: 'trash', value: 'del', danger: true },
  ]);
  if (a === 'new') newNoteDialog(f.id);
  else if (a === 'edit') folderDialog(f);
  else if (a === 'share') shareFolder(f);
  else if (a === 'ai') aiForFolder(f);
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
    <label class="check"><input type="checkbox" id="n-review" ${localStorage.getItem('caderno-revisao-auto') === '0' ? '' : 'checked'}> Programar revisões (1, 3, 7, 14 e 30 dias)</label>
  </div>`);
  body.querySelector('#n-review').onchange = e => localStorage.setItem('caderno-revisao-auto', e.target.checked ? '1' : '0');
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
      value: el => ({ title: el.querySelector('#n-title').value.trim(), folderId: el.querySelector('#n-folder').value, review: el.querySelector('#n-review').checked }),
    }],
  });
  if (!res) return;
  localStorage.setItem('caderno-ultimo-papel', JSON.stringify(choice));
  const now = Date.now();
  const meta = {
    id: uid(), title: res.title || `Anotação ${new Date().toLocaleDateString('pt-BR')}`,
    folderId: res.folderId, fav: false, createdAt: now, updatedAt: now, pageCount: 1, thumb: '',
    review: res.review ? newReview() : null,
  };
  const content = { id: meta.id, bg: choice, pages: [{ id: uid(), strokes: [], texts: [], images: [] }] };
  await db.put('pages', content);
  await db.put('notes', meta);
  state.notes.push(meta);
  render();
  openNote(meta.id);
}

// Cria uma anotação vazia e abre no editor (usado pelo Horário de aulas)
async function createNote({ title, folderId = '', bg = { type: 'lines', color: 'white' } }) {
  const now = Date.now();
  const meta = { id: uid(), title, folderId, fav: false, createdAt: now, updatedAt: now, pageCount: 1, thumb: '', review: newReview() };
  await db.put('pages', { id: meta.id, bg, pages: [{ id: uid(), strokes: [], texts: [], images: [] }] });
  await db.put('notes', meta);
  state.notes.push(meta);
  render();
  openNote(meta.id);
  return meta;
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
  resetAIPanel();
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
    { label: 'Assistente IA: resumir, perguntas…', icon: 'magic', value: 'ai' },
    { label: 'Compartilhar', icon: 'share', value: 'share' },
    { label: 'Renomear', icon: 'edit', value: 'rename' },
    { label: 'Mover para pasta', icon: 'folder', value: 'move' },
    { label: n.fav ? 'Remover dos favoritos' : 'Favoritar', icon: 'star', value: 'fav' },
    { label: 'Criar tarefa', icon: 'tasks', value: 'task' },
    { label: recCounts()[n.id] ? `Gravações da aula (${recCounts()[n.id]})` : 'Gravações da aula', icon: 'mic', value: 'recs' },
    { label: n.review && !n.review.done ? 'Desligar revisões programadas' : 'Programar revisões (1, 3, 7, 14, 30 dias)', icon: 'repeat', value: 'review' },
    { label: 'Duplicar', icon: 'copy', value: 'dup' },
    { label: 'Excluir', icon: 'trash', value: 'del', danger: true },
  ]);
  if (a === 'open') openNote(id);
  else if (a === 'share') shareNoteDialog(n, null, 0);
  else if (a === 'ai') aiForNote(n);
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
  else if (a === 'recs') openRecordings(n);
  else if (a === 'review') toggleReview(n);
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
    // as gravações da aula continuam salvas, mas soltas (aparecem em Dados e backup → Conferir)
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
  const mode = localStorage.getItem('caderno-modo-tarefas') || 'list';
  [...$('task-mode').children].forEach(b => b.classList.toggle('active', b.dataset.m === mode));
  $('task-filter').hidden = mode !== 'list';
  if (mode !== 'list') {
    $('tasks-empty').hidden = true;
    $('task-list').onclick = null;
    const q = state.search;
    const all = q ? state.tasks.filter(x => x.title.toLowerCase().includes(q)) : state.tasks;
    (mode === 'board' ? renderBoard : renderMatrix)($('task-list'), all);
    return;
  }
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
          ${x.subtasks && x.subtasks.length ? `<span class="tag">${ic('check')}${x.subtasks.filter(s => s.done).length}/${x.subtasks.length}</span>` : ''}
          ${x.status === 'doing' && !x.done ? '<span class="tag doing">Fazendo</span>' : ''}
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
    if (c) { toggleTask(c.dataset.check); return; }
    const o = e.target.closest('[data-open]');
    if (o) { openNote(o.dataset.open); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      const gone = state.tasks.find(t => t.id === d.dataset.del);
      if (!gone) return;
      await db.del('tasks', gone.id);
      state.tasks = state.tasks.filter(t => t.id !== gone.id);
      render();
      toast('Tarefa excluída', 5000, { label: 'Desfazer', run: async () => { await db.put('tasks', gone); state.tasks.push(gone); render(); toast('Tarefa de volta ✓'); } });
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) taskDialog(state.tasks.find(t => t.id === ed.dataset.edit));
  };
}

// Conclui/reabre uma tarefa; tarefas repetidas geram a próxima ocorrência
async function toggleTask(id) {
  const x = state.tasks.find(t => t.id === id);
  if (!x) return;
  x.done = !x.done; x.doneAt = x.done ? Date.now() : 0;
  await db.put('tasks', x);
  if (x.done && x.repeat && !x.spawned) {
    const base = x.due && x.due > dayStr() ? x.due : (x.due || dayStr());
    let due = base;
    if (x.repeat === 'daily') due = addDays(base, 1);
    else if (x.repeat === 'weekly') due = addDays(base, 7);
    else if (x.repeat === 'monthly') { const [y, m, d] = base.split('-').map(Number); const nd = new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())); due = dayStr(nd); }
    while (x.repeat === 'daily' && due < dayStr()) due = addDays(due, 1);
    const next = { ...x, id: uid(), done: false, doneAt: 0, due, createdAt: Date.now(), spawned: false };
    x.spawned = true;
    await db.put('tasks', x); await db.put('tasks', next);
    state.tasks.push(next);
    toast(`Concluída ✓ — próxima: ${fmtDue(due)}`);
  } else if (x.done) toast('Tarefa concluída ✓');
  if (!editorIsOpen()) render();
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
    <label class="lbl">Repetir</label>
    <select class="select full" id="t-repeat">${[['', 'Não repetir'], ['daily', 'Todo dia'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês']].map(([k, l]) => `<option value="${k}" ${(t.repeat || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="lbl">Subtarefas</label>
    <div class="subtasks" id="t-subs"></div>
    <div class="row"><input class="input grow" id="t-subnew" placeholder="Adicionar subtarefa (ex.: exercícios 1 a 10)"><button class="btn" type="button" id="t-subadd">${ic('plus')}</button></div>
    <label class="lbl">Observações</label>
    <textarea class="input" id="t-notes" rows="3" placeholder="Detalhes, páginas do livro…">${esc(t.notes)}</textarea>
    ${isNew ? '' : `<label class="check"><input type="checkbox" id="t-done" ${t.done ? 'checked' : ''}> Concluída</label>`}
  </div>`);
  let subs = (t.subtasks || []).map(x => ({ ...x }));
  const drawSubs = () => {
    body.querySelector('#t-subs').innerHTML = subs.map((x, i) => `<div class="sub-row">
      <label class="check"><input type="checkbox" data-si="${i}" ${x.done ? 'checked' : ''}><span class="${x.done ? 'muted' : ''}">${esc(x.title)}</span></label>
      <button type="button" class="icon-btn small" data-sr="${i}" aria-label="Remover">${ic('trash')}</button></div>`).join('');
  };
  drawSubs();
  const addSub = () => {
    const inp = body.querySelector('#t-subnew'), v = inp.value.trim();
    if (!v) return;
    subs.push({ id: uid(), title: v, done: false }); inp.value = ''; drawSubs(); inp.focus();
  };
  body.querySelector('#t-subadd').onclick = addSub;
  body.querySelector('#t-subnew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSub(); } });
  body.querySelector('#t-subs').addEventListener('change', e => { const i = e.target.dataset.si; if (i != null) { subs[+i].done = e.target.checked; drawSubs(); } });
  body.querySelector('#t-subs').addEventListener('click', e => { const b = e.target.closest('[data-sr]'); if (b) { subs.splice(+b.dataset.sr, 1); drawSubs(); } });
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
        repeat: el.querySelector('#t-repeat').value,
        subtasks: subs,
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
    <label class="lbl">Aparência</label>
    <div class="row wrap">
      <div class="seg" id="s-theme">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<button type="button" data-t="${k}" class="${(settings.theme || 'auto') === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" id="s-scale">${[[1, 'Texto normal'], [1.1, 'Grande'], [1.2, 'Maior']].map(([k, l]) => `<button type="button" data-z="${k}" class="${(settings.uiScale || 1) === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    </div>
    <hr>
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
    <label class="lbl">Inteligência artificial — Gemini (versão rápida)</label>
    <p class="status ${aiConfigured() ? 'good' : 'bad'}" id="s-aiwhich">${aiConfigured() ? ic('check') : '! '}${usingBuiltinKey() ? 'A IA já vem ligada: o app usa a chave embutida' : aiConfigured() ? 'Usando a sua chave colada abaixo' : 'Cole a chave do Gemini abaixo para ligar a IA'}</p>
    <details class="help small" ${hasBuiltinKey() ? '' : 'open'}><summary>${hasBuiltinKey() ? 'Usar outra chave (opcional)' : 'Como pegar a chave (grátis)'}</summary>
      <ol>
        <li>Entre em <b>aistudio.google.com/apikey</b> com a sua conta Google.</li>
        <li>Toque em <b>Create API key</b> (Criar chave de API) e copie a chave.</li>
        <li>Cole a chave abaixo e toque em <b>Testar</b>. Para voltar à chave embutida, toque em <b>Remover chave</b>.</li>
      </ol></details>
    <input class="input" id="s-geminikey" type="password" autocomplete="off" spellcheck="false" placeholder="Opcional: cole aqui outra chave do Gemini" value="${esc(settings.geminiKey || '')}">
    <div class="row wrap" style="margin-top:8px">
      <button class="btn primary" id="s-aitest" type="button">${ic('check')}<span>Testar</span></button>
      ${settings.geminiKey ? `<button class="btn" id="s-aiclear" type="button">${ic('trash')}<span>Remover chave</span></button>` : ''}
    </div>
    <p class="muted small" id="s-aistatus"></p>
    <p class="muted small">Usa o <b>Gemini Flash-Lite</b>, o modelo mais rápido do Google (responde em menos de 1 segundo nos testes), com um reserva também rápido se ele estiver ocupado. Se você colar a sua própria chave, ela fica salva só neste tablet. No plano gratuito há limite de pedidos por minuto e por dia, e o Google pode usar o que for enviado para melhorar os produtos dele.</p>
    <hr>
    <label class="lbl">Dados e backup</label>
    <p class="muted small">Tudo fica salvo automaticamente no banco de dados do tablet, com cópias automáticas diárias.${est ? ` Espaço usado: ${(est.usage / 1048576).toFixed(1)} MB.` : ''}${persisted ? ' Armazenamento protegido ✓' : ''}</p>
    <div class="row wrap">
      <button class="btn" id="s-data" type="button">${ic('database')}<span>Abrir Dados e backup</span></button>
    </div>
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
        <li><b>IA:</b> toque em “IA” no editor. Escolha Seleção, Esta página ou Todas e peça um resumo, melhorar a escrita, escrever mais, explicação, perguntas, flashcards ou plano de estudo. O resultado pode ser escrito na folha.</li>
        <li><b>Importar PDF:</b> traga listas de exercícios e apostilas para escrever por cima.</li>
        <li><b>Páginas:</b> toque no número da página para ver todas, reordenar, duplicar ou excluir.</li>
        <li>A correção de escrita e a IA usam a internet; todo o resto funciona offline.</li>
      </ul>
    </details>
  </div>`);
  body.querySelector('#s-data').onclick = () => { body.closest('.modal-back')?._close?.(); setView({ kind: 'data' }); };
  body.querySelector('#s-theme').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    settings.theme = b.dataset.t; saveSettings(); applyLook();
    body.querySelectorAll('#s-theme button').forEach(x => x.classList.toggle('active', x === b));
  };
  body.querySelector('#s-scale').onclick = e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    settings.uiScale = +b.dataset.z; saveSettings(); applyLook();
    body.querySelectorAll('#s-scale button').forEach(x => x.classList.toggle('active', x === b));
  };
  const readAI = () => { settings.geminiKey = body.querySelector('#s-geminikey').value.trim(); };
  body.querySelector('#s-aiclear')?.addEventListener('click', () => {
    body.querySelector('#s-geminikey').value = ''; readAI(); saveSettings();
    body.querySelector('#s-aistatus').textContent = 'Chave removida: o app volta a usar a chave embutida.';
    body.querySelector('#s-aiwhich').lastChild.textContent = hasBuiltinKey() ? 'A IA já vem ligada: o app usa a chave embutida' : 'Cole a chave do Gemini abaixo para ligar a IA';
  });
  body.querySelector('#s-aitest').onclick = async () => {
    const st = body.querySelector('#s-aistatus');
    readAI();
    saveSettings();
    st.textContent = 'Testando…';
    const t0 = performance.now();
    try {
      let txt = '';
      const r = streamChat([{ role: 'user', content: 'Responda apenas: Tudo certo!' }], t => { txt += t; });
      await r.done;
      st.textContent = `✓ Gemini funcionando em ${((performance.now() - t0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s: ` + txt.trim().slice(0, 60);
    } catch (e) { st.textContent = '✗ ' + e.message; }
  };
  await modal({ title: 'Ajustes', body, wide: true, actions: [{ label: 'Fechar', value: true, primary: true }] });
  settings.fingerDraw = body.querySelector('#s-finger').checked;
  settings.shapes = body.querySelector('#s-shapes').checked;
  settings.lang = body.querySelector('#s-lang').value;
  settings.autoMode = body.querySelector('#s-auto').value;
  readAI();
  saveSettings();
  syncToggles();
}

$('backup-input').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  document.querySelectorAll('.modal-back').forEach(m => m._close && m._close());
  await importBackupFile(f);
});

async function addTask({ title, due = '', prio = 2, folderId = '', noteId = '', notes = '' }) {
  const t = { id: uid(), title, done: false, due, prio, folderId, noteId, notes, createdAt: Date.now() };
  await db.put('tasks', t);
  state.tasks.push(t);
  return t;
}

// Atalhos do ícone do app (pressionar e segurar): ?v=focus, ?a=nova-anotacao…
function routeFromURL() {
  const q = new URLSearchParams(location.search);
  const v = q.get('v'), a = q.get('a');
  if (v && (HUB_VIEWS[v] || v === 'tasks')) state.view = { kind: v };
  if (v === 'focus' && q.get('start') === '1') startFocus();
  if (a === 'nova-anotacao') setTimeout(() => newNoteDialog(), 300);
  if (a === 'nova-tarefa') setTimeout(() => taskDialog({}), 300);
  if (a === 'busca') setTimeout(openPalette, 300);
  const kt = q.get('kt');
  if (kt) { state.view = { kind: 'reading' }; setTimeout(() => kindleRetry(+kt), 400); }
  if (v || a || kt) history.replaceState(null, '', location.pathname);
}

// Nenhum erro passa em silêncio: mostra um aviso e mantém o app funcionando
let lastErr = 0;
function reportError(err) {
  const msg = String(err && (err.message || err.reason || err) || 'erro desconhecido');
  if (/ResizeObserver loop|AbortError|Cancelado/i.test(msg)) return;
  console.error(err);
  if (Date.now() - lastErr < 3000) return;
  lastErr = Date.now();
  toast('Ops, algo deu errado: ' + msg.slice(0, 120) + '. Seus dados estão salvos.', 5000);
}
window.addEventListener('error', e => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason));
document.addEventListener('caderno-db-blocked', () => toast('Feche as outras abas do Caderno para concluir a atualização.', 6000));

init().catch(err => {
  reportError(err);
  document.body.insertAdjacentHTML('beforeend', '<div class="fatal"><h2>Não foi possível abrir o Caderno</h2><p>Recarregue a página. Se continuar, verifique se o navegador não está em modo anônimo e se há espaço livre no tablet.</p><button class="btn primary" onclick="location.reload()">Recarregar</button></div>');
});
