// Editor de anotações: caneta, lápis, marca-texto, borracha, laço, texto, imagem,
// zoom/arrastar, formas perfeitas e correção de escrita/contas.
import {
  PAGE_W, PAGE_H, PAPER_COLORS, PAPER_TYPES, uid, renderPage, drawStroke, makeStroke, strokeHit,
  eraseFromStroke, pointInPoly, unionBBox, itemBBox, transformItem, textBBox, textFont, bboxHit,
  setImageLoadHandler, renderPageToCanvas, layoutText, nextFreeLine, HAND_FONTS, loadHandFonts, LINE0, LINE_STEP,
} from './ink.js';
import { FLOW_SIZES, FLOW_INDENTS, readParas, appendText, chainOf, relayout, paperGeom, snapLine, layoutFlow } from './flow.js';
import { snapShape } from './shapes.js';
import { openImageSearch } from './imagesearch.js';
import { groupLines, recognizeStrokes, checkMath, fmtNum } from './recognize.js';
import { settings, saveSettings } from './store.js';
import { ic, esc, h, toast, modal, confirmBox } from './ui.js';

const $ = id => document.getElementById(id);
const KINDS = ['strokes', 'texts', 'images'];

const TOOLS = [
  ['pen', 'Caneta'], ['pencil', 'Lápis'], ['marker', 'Marca-texto'], ['eraser', 'Borracha'],
  ['lasso', 'Laço (selecionar)'], ['text', 'Texto'], ['image', 'Imagem'], ['hand', 'Mover a folha'],
];
const PALETTE = ['#1d1d1f', '#6b6b70', '#0a6cff', '#e5352b', '#1f9d4a', '#ff8a00', '#8e44d6', '#8b5a2b', '#ff4fa3', '#00a6b4'];
const MARKER_PALETTE = ['#ffd60a', '#7ee35f', '#ff7ac6', '#5ac8fa', '#ffb340', '#c59bff'];
const SIZE_RANGE = { pen: [1, 24], pencil: [1, 24], marker: [8, 60], eraser: [6, 90], text: [14, 120] };
const TOOLCFG_KEY = 'caderno-ferramentas';
const DEFAULT_CFG = {
  pen: { color: '#1d1d1f', size: 3 },
  pencil: { color: '#6b6b70', size: 3 },
  marker: { color: '#ffd60a', size: 26 },
  eraser: { size: 24 },
  text: { color: '#1d1d1f', size: 32 },
};
let toolCfg = (() => {
  try { return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(TOOLCFG_KEY) || '{}') }; }
  catch { return { ...DEFAULT_CFG }; }
})();
const saveToolCfg = () => { try { localStorage.setItem(TOOLCFG_KEY, JSON.stringify(toolCfg)); } catch { /* */ } };

let tool = 'pen';
let E = null;           // estado da anotação aberta
let cb = {};            // callbacks do app
let stage, base, live, overlay, ctxB, ctxL;
let dpr = 1, W = 0, H = 0, deskColor = '#d9dce1';
let act = null;         // ação atual de desenho/seleção
const touches = new Map();
let gesture = null;
let panPid = null, panLast = null;

const page = () => E.content.pages[E.pageIndex];
const V = () => E.view;

// =================== Inicialização ===================
export function initEditor(callbacks) {
  cb = callbacks;
  stage = $('stage'); base = $('cv-base'); live = $('cv-live'); overlay = $('overlay');
  ctxB = base.getContext('2d'); ctxL = live.getContext('2d');
  buildToolbar();
  setImageLoadHandler(() => requestRedraw());
  // fontes manuscritas: quando terminarem de carregar, redesenha a folha
  loadHandFonts().then(() => { if (E) redraw(); });

  $('ed-back').onclick = () => cb.onClose();
  $('ed-undo').onclick = undo;
  $('ed-redo').onclick = redo;
  $('ed-share').onclick = async () => { await flushSave(); cb.onShare(E.meta, E.content, E.pageIndex); };
  $('ed-task').onclick = () => cb.onAddTask(E.meta);
  $('ed-paper').onclick = paperDialog;
  $('ed-settings').onclick = () => cb.onSettings();
  $('ed-title').addEventListener('change', e => {
    E.meta.title = e.target.value.trim() || 'Sem título';
    e.target.value = E.meta.title;
    markDirty();
  });
  $('pg-prev').onclick = () => gotoPage(E.pageIndex - 1);
  $('pg-next').onclick = () => gotoPage(E.pageIndex + 1);
  $('pg-add').onclick = addPage;
  $('pg-del').onclick = deletePage;
  $('pg-zoom').onclick = () => { fitWidth(); redraw(); };
  $('pg-label').onclick = openPageOverview;
  $('ed-ai').onclick = () => cb.onAI();
  $('ed-imgsearch').onclick = () => openImageSearch({ onPick: insertPicture });
  $('ed-rec').onclick = () => cb.onRecord(E.meta);
  $('ed-recs').onclick = () => cb.onRecordings(E.meta);
  $('ed-import').onclick = () => cb.onImport();
  $('img-input').addEventListener('change', onImageFile);

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', e => { if (act && act.pid === e.pointerId) onUp(e); });
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(() => { if (E) resize(); }).observe(stage);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  window.addEventListener('pagehide', () => flushSave());
}

export function editorIsOpen() { return !!E; }

export function openEditor(meta, content) {
  E = {
    meta, content, pageIndex: 0, view: { s: 1, ox: 0, oy: 0 },
    undo: [], redo: [], sel: null, dirty: false, pending: [], saveTimer: 0, autoTimer: 0, lassoThen: null,
  };
  for (const p of content.pages) { p.strokes ||= []; p.texts ||= []; p.images ||= []; }
  $('ed-title').value = meta.title;
  $('editor').hidden = false;
  deskColor = getComputedStyle(document.documentElement).getPropertyValue('--desk').trim() || '#d9dce1';
  setSaveState('Salvo');
  updateUndoBtns();
  selectTool(tool === 'image' ? 'pen' : tool);
  resize();
  fitWidth();
  redraw();
  updatePageBar();
}

export async function closeEditor() {
  if (!E) return;
  commitTextEdit();
  await flushSave();
  clearTimeout(E.autoTimer);
  E = null; act = null; gesture = null; touches.clear();
  overlay.innerHTML = '';
  $('editor').hidden = true;
}

// =================== Barra de ferramentas ===================
function buildToolbar() {
  const tb = $('tools');
  tb.innerHTML = TOOLS.map(([t, label]) =>
    `<button class="tool" data-tool="${t}" title="${label}" aria-label="${label}">${ic(t)}</button>`).join('');
  tb.onclick = e => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const t = b.dataset.tool;
    if (t === 'image') { $('img-input').click(); return; }
    if (t === tool && ['pen', 'pencil', 'marker', 'eraser', 'text'].includes(t)) { $('tool-opts').classList.toggle('pulse'); }
    selectTool(t);
  };
  $('ed-convert').innerHTML = `${ic('magic')}<span>Corrigir escrita</span>`;
  $('ed-check').innerHTML = `${ic('calc')}<span>Verificar conta</span>`;
  $('ed-shapes').innerHTML = `${ic('shapes')}<span>Formas</span>`;
  $('ed-convert').onclick = () => runOnSelection('convert');
  $('ed-check').onclick = () => runOnSelection('check');
  $('ed-shapes').onclick = () => {
    settings.shapes = !settings.shapes; saveSettings(); syncToggles();
    toast(settings.shapes ? 'Formas perfeitas: segure a caneta parada no fim do traço' : 'Formas perfeitas desligadas');
  };
  $('ed-auto').onchange = e => {
    settings.autoMode = e.target.value; saveSettings();
    toast({
      off: 'Sua escrita fica como você escreveu (à mão)',
      text: 'Ao parar de escrever, a letra vira texto na linha onde você escreveu',
      math: 'Contas com "=" são conferidas ao parar de escrever (✓ ou ✗)',
      flow: 'Escreva em qualquer lugar: o texto vai para as linhas, em ordem. Ponto final = novo parágrafo.',
    }[settings.autoMode], 4000);
    syncToggles();
  };
  // fonte, tamanho e parágrafo da escrita convertida
  $('ed-font').innerHTML = '<option value="auto">✨ Igual à minha</option>'
    + Object.entries(HAND_FONTS).map(([k, f]) => `<option value="${k}" style="font-family:${f.family}" title="${f.name}">${f.desc[0].toUpperCase() + f.desc.slice(1)}</option>`).join('') + '<option value="normal">Digitada</option>';
  $('ed-fsize').innerHTML = Object.entries(FLOW_SIZES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('ed-para').innerHTML = Object.entries(FLOW_INDENTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('ed-font').onchange = e => { settings.handFont = e.target.value; settings.fontChosen = true; saveSettings(); restyleFlow(true); };
  $('ed-fsize').onchange = e => { settings.flowSize = +e.target.value; saveSettings(); restyleFlow(); };
  $('ed-para').onchange = e => { settings.flowIndent = +e.target.value; saveSettings(); restyleFlow(); };
  syncToggles();
}

export function syncToggles() {
  $('ed-shapes').classList.toggle('on', settings.shapes);
  $('ed-auto').value = settings.autoMode;
  const conv = settings.autoMode === 'flow' || settings.autoMode === 'text'; // (o "Corrigir escrita" usa a mesma letra e tamanho)
  $('ed-flowopts').hidden = !conv;
  $('ed-para-box').hidden = settings.autoMode !== 'flow';
  $('ed-font').value = settings.handFont === 'auto' || HAND_FONTS[settings.handFont] ? settings.handFont : 'normal';
  $('ed-fsize').value = String(settings.flowSize);
  $('ed-para').value = String(settings.flowIndent);
}
// "Igual à minha letra": na cursiva as letras de uma palavra saem quase num traço só; na letra de forma,
// cada letra tem um ou mais traços. Contamos os traços principais (pingos e acentos não contam) por letra.
export function writingStyle(strokes, text) {
  const letters = (String(text).match(/\p{L}/gu) || []).length;
  if (letters < 3 || !strokes.length) return null;
  const big = Math.max(...strokes.map(s => Math.max(s.bbox.w, s.bbox.h)));
  const main = strokes.filter(s => Math.max(s.bbox.w, s.bbox.h) >= big * 0.35).length;
  return main / letters <= 0.6 ? 'cursive' : 'print';
}
export const STYLE_FONT = { cursive: 'dancing', print: 'patrick' };
let lastStyle = 'print';
// Fonte do texto convertido: a escolhida no menu ou, no automático, a que combina com a sua letra
function convFont(strokes, text) {
  if (settings.handFont === 'auto') {
    const st = strokes ? writingStyle(strokes, text) : null;
    if (st) lastStyle = st;
    return STYLE_FONT[st || lastStyle];
  }
  return HAND_FONTS[settings.handFont] ? settings.handFont : undefined;
}
const flowOpts = () => ({ font: settings.handFont === 'auto' ? STYLE_FONT[lastStyle] : convFont(), size: +settings.flowSize || 30, indent: +settings.flowIndent || 0, geom: paperGeom(E && E.content.bg) });

// ----- escrita organizada -----
// Onde o texto organizado começa numa página: na primeira pauta livre abaixo do que já existe
function flowStartY(pg) {
  const others = { ...pg, texts: pg.texts.filter(t => !t.flow) };
  const g = paperGeom(E.content.bg);
  const empty = !others.strokes.length && !others.texts.length && !others.images.some(i => !i.locked);
  return empty ? g.first : snapLine(nextFreeLine(others), g);
}
function flowRelayout(startIdx, paras) {
  const pages = E.content.pages;
  const { s } = chainOf(pages, startIdx);
  const last = relayout(pages, s, paras, flowOpts(), {
    newPage: () => ({ id: uid(), strokes: [], texts: [], images: [] }),
    startYFor: pg => flowStartY(pg),
  });
  return last;
}
// Acrescenta textos reconhecidos ao texto organizado da página atual
function flowAppend(pieces) {
  const pages = E.content.pages;
  const { s, e } = chainOf(pages, E.pageIndex);
  const paras = readParas(pages.slice(s, e + 1));
  for (const p of pieces) appendText(paras, p.text, p.color, p.font);
  const n0 = pages.length;
  const last = flowRelayout(E.pageIndex, paras);
  if (last !== E.pageIndex) {
    gotoPage(last);
    toast(pages.length > n0 ? `A folha encheu: o texto continuou na página ${last + 1} (nova)` : `O texto continuou na página ${last + 1}`, 3500);
  }
}
// Mudou a fonte, o tamanho ou o parágrafo: reorganiza o texto desta página
function restyleFlow(fontChanged = false) {
  if (!E) { syncToggles(); return; }
  const pages = E.content.pages;
  if (pages[E.pageIndex].texts.some(t => t.flow)) {
    pushUndo();
    const { s, e } = chainOf(pages, E.pageIndex);
    const paras = readParas(pages.slice(s, e + 1));
    // escolheu uma fonte: todo o texto organizado passa para ela (no automático, cada trecho mantém a sua)
    if (fontChanged && settings.handFont !== 'auto') for (const p of paras) for (const r of p.runs) r.font = convFont();
    flowRelayout(E.pageIndex, paras);
    markDirty(); redraw();
  }
  loadHandFonts().then(() => E && redraw());
}

function selectTool(t) {
  if (t !== 'lasso') { clearSel(); E && (E.lassoThen = null); }
  commitTextEdit();
  tool = t;
  for (const b of $('tools').children) b.classList.toggle('active', b.dataset.tool === t);
  stage.dataset.tool = t;
  renderToolOpts();
}

function renderToolOpts() {
  const box = $('tool-opts');
  const cfg = toolCfg[tool];
  if (tool === 'lasso') { box.innerHTML = '<span class="hint">Circule a escrita para mover, corrigir ou verificar</span>'; return; }
  if (tool === 'hand') { box.innerHTML = '<span class="hint">Arraste para mover • pinça para zoom</span>'; return; }
  if (!cfg) { box.innerHTML = ''; return; }
  let html = '';
  if (tool === 'eraser') {
    html += `<div class="seg small" id="er-mode">
      <button data-m="partial" class="${settings.eraserMode === 'partial' ? 'active' : ''}">Parcial</button>
      <button data-m="stroke" class="${settings.eraserMode === 'stroke' ? 'active' : ''}">Traço inteiro</button></div>
      <button class="chip" id="er-clear">${ic('trash')}<span>Limpar página</span></button>`;
  } else {
    const pal = tool === 'marker' ? MARKER_PALETTE : PALETTE;
    html += '<div class="swatches">' + pal.map(c =>
      `<button class="sw ${c.toLowerCase() === cfg.color.toLowerCase() ? 'active' : ''}" data-c="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('') +
      `<label class="sw custom ${pal.includes(cfg.color) ? '' : 'active'}" style="--c:${cfg.color}" title="Outra cor"><input type="color" value="${cfg.color}"></label></div>`;
  }
  const [mn, mx] = SIZE_RANGE[tool];
  html += `<div class="size"><span class="size-dot" style="--d:${Math.min(28, Math.max(3, cfg.size * (tool === 'text' ? 0.35 : tool === 'marker' || tool === 'eraser' ? 0.45 : 1.2)))}px;--c:${cfg.color || '#888'}"></span>
    <input type="range" min="${mn}" max="${mx}" value="${cfg.size}" aria-label="Tamanho"><span class="size-val">${cfg.size}</span></div>`;
  box.innerHTML = html;
  box.querySelectorAll('.sw[data-c]').forEach(b => b.onclick = () => setColor(b.dataset.c));
  const ci = box.querySelector('input[type=color]');
  if (ci) ci.oninput = e => setColor(e.target.value, true);
  const rng = box.querySelector('input[type=range]');
  rng.oninput = e => {
    cfg.size = +e.target.value; saveToolCfg();
    box.querySelector('.size-val').textContent = cfg.size;
    box.querySelector('.size-dot').style.setProperty('--d',
      `${Math.min(28, Math.max(3, cfg.size * (tool === 'text' ? 0.35 : tool === 'marker' || tool === 'eraser' ? 0.45 : 1.2)))}px`);
  };
  box.querySelectorAll('#er-mode button').forEach(b => b.onclick = () => {
    settings.eraserMode = b.dataset.m; saveSettings(); renderToolOpts();
  });
  const clr = box.querySelector('#er-clear');
  if (clr) clr.onclick = async () => {
    if (!(await confirmBox('Limpar página', 'Apagar tudo desta página? (Você pode desfazer depois)', 'Limpar'))) return;
    pushUndo();
    const p = page(); p.strokes = []; p.texts = []; p.images = [];
    markDirty(); redraw();
  };
}

function setColor(c, keepOpen) {
  toolCfg[tool].color = c; saveToolCfg();
  if (!keepOpen) renderToolOpts();
  else {
    const lab = $('tool-opts').querySelector('.sw.custom');
    lab && lab.style.setProperty('--c', c);
    $('tool-opts').querySelectorAll('.sw').forEach(b => b.classList.toggle('active', b === lab));
  }
}

// =================== Visualização ===================
function resize() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const changedW = Math.abs(r.width - W) > 40;
  W = r.width; H = r.height;
  for (const c of [base, live]) { c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr)); }
  // girou o tablet (ou mudou o tamanho da tela): se você não tinha dado zoom, a folha volta a caber na largura
  if (E && changedW && E.autoFit) { const oy = V().oy; fitWidth(); V().oy = oy; }
  if (E) { clampView(); redraw(); }
}
function fitWidth() {
  const v = V();
  v.s = Math.min(3, Math.max(0.2, (W - 32) / PAGE_W));
  if (PAGE_H * v.s < H - 32) v.s = Math.min(v.s, (H - 32) / PAGE_H);
  v.ox = (W - PAGE_W * v.s) / 2;
  v.oy = 16;
  if (E) E.autoFit = true;
  updateZoomLabel();
}
function clampView() {
  const v = V();
  const pw = PAGE_W * v.s, ph = PAGE_H * v.s;
  const m = 80;
  if (pw <= W) v.ox = Math.min(Math.max(v.ox, 0), W - pw);
  else v.ox = Math.min(m, Math.max(W - pw - m, v.ox));
  if (ph <= H) v.oy = Math.min(Math.max(v.oy, 0), H - ph);
  else v.oy = Math.min(m, Math.max(H - ph - m, v.oy));
}
function updateZoomLabel() { $('pg-zoom').textContent = Math.round(V().s * 100) + '%'; }
function toPage(cx, cy) {
  const r = stage.getBoundingClientRect(), v = V();
  return { x: (cx - r.left - v.ox) / v.s, y: (cy - r.top - v.oy) / v.s };
}
function toScreen(x, y) { const v = V(); return { x: x * v.s + v.ox, y: y * v.s + v.oy }; }

let rafB = 0, rafL = 0;
function requestRedraw() { if (!rafB) rafB = requestAnimationFrame(() => { rafB = 0; redraw(); }); }
function requestLive() { if (!rafL) rafL = requestAnimationFrame(() => { rafL = 0; drawLive(); }); }

function redraw() {
  if (!E) return;
  const c = ctxB, v = V();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = deskColor;
  c.fillRect(0, 0, base.width, base.height);
  if (gesture && gesture.snap) {
    const g = gesture, k = v.s / g.v0.s;
    c.setTransform(k, 0, 0, k, dpr * (v.ox - g.v0.ox * k), dpr * (v.oy - g.v0.oy * k));
    c.drawImage(g.snap, 0, 0);
  } else {
    c.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
    c.save();
    c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = 14 * dpr; c.shadowOffsetY = 2 * dpr;
    c.fillStyle = '#fff'; c.fillRect(0, 0, PAGE_W, PAGE_H);
    c.restore();
    c.save();
    c.beginPath(); c.rect(0, 0, PAGE_W, PAGE_H); c.clip();
    renderPage(c, page(), E.content.bg, E.editingTextId ? new Set([E.editingTextId]) : null);
    c.restore();
  }
  updateOverlay();
  updateZoomLabel();
}

function drawLive() {
  const c = ctxL, v = V();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, live.width, live.height);
  if (!E || !act) return;
  c.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
  if (act.type === 'draw') {
    drawStroke(c, act.stroke);
  } else if (act.type === 'lasso' && act.pts.length > 1) {
    c.save();
    c.lineWidth = 1.6 / v.s;
    c.setLineDash([7 / v.s, 6 / v.s]);
    c.strokeStyle = '#0a6cff';
    c.fillStyle = 'rgba(10,108,255,.06)';
    c.beginPath();
    act.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath(); c.fill(); c.stroke();
    c.restore();
  } else if (act.type === 'erase' && act.cursor) {
    c.save();
    c.lineWidth = 1.5 / v.s;
    c.strokeStyle = 'rgba(0,0,0,.5)';
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath(); c.arc(act.cursor.x, act.cursor.y, toolCfg.eraser.size / 2, 0, 7); c.fill(); c.stroke();
    c.restore();
  }
}

// =================== Entrada (caneta, dedo, mouse) ===================
function pressureOf(e) {
  if (e.pointerType === 'pen') return e.pressure > 0 ? Math.min(1, Math.max(0.08, e.pressure)) : 0.5;
  return 0.5;
}

function onDown(e) {
  if (!E) return;
  if (E.editingTextId) { commitTextEdit(); return; }
  try { stage.setPointerCapture(e.pointerId); } catch { /* */ }
  clearTimeout(E.autoTimer);

  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      if (act && act.ptype === 'touch') cancelAction();
      startGesture();
      return;
    }
    if (!settings.fingerDraw || tool === 'hand') { startPan(e); return; }
  } else {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      if (e.button === 1) startPan(e);
      return;
    }
    if (e.pointerType === 'pen' && !settings.penSeen) {
      settings.penSeen = true;
      settings.fingerDraw = false;
      saveSettings();
      toast('Caneta detectada ✍ — agora o dedo só move e dá zoom (mude em Ajustes)', 4200);
    }
  }
  if (act) return;
  if (tool === 'hand') { startPan(e); return; }

  const pt = toPage(e.clientX, e.clientY);
  const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
  const t = penEraser ? 'eraser' : tool;

  if (t === 'pen' || t === 'pencil' || t === 'marker') startDraw(e, pt, t);
  else if (t === 'eraser') startErase(e, pt);
  else if (t === 'lasso') startLasso(e, pt);
  else if (t === 'text') act = { type: 'text', pid: e.pointerId, ptype: e.pointerType, start: pt, sx: e.clientX, sy: e.clientY };
}

function onMove(e) {
  if (!E) return;
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture) { moveGesture(); return; }
  if (panPid === e.pointerId) {
    const v = V();
    v.ox += e.clientX - panLast.x; v.oy += e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY };
    clampView(); requestRedraw();
    return;
  }
  if (!act || act.pid !== e.pointerId) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const list = evs.length ? evs : [e];
  if (act.type === 'draw') { for (const ev of list) addPoint(ev); requestLive(); }
  else if (act.type === 'erase') { for (const ev of list) eraseMove(toPage(ev.clientX, ev.clientY)); requestLive(); }
  else if (act.type === 'lasso') { const p = toPage(e.clientX, e.clientY); act.pts.push(p); requestLive(); }
  else if (act.type === 'move') moveSel(toPage(e.clientX, e.clientY));
  else if (act.type === 'scale') scaleSel(toPage(e.clientX, e.clientY));
}

function onUp(e) {
  if (!E) return;
  if (e.pointerType === 'touch') {
    const had = touches.delete(e.pointerId);
    if (gesture) {
      if (touches.size < 2) endGesture();
      return;
    }
    if (!had && !act && panPid !== e.pointerId) return;
  }
  if (panPid === e.pointerId) { panPid = null; return; }
  if (!act || act.pid !== e.pointerId) return;
  const a = act;
  if (a.type === 'draw') endDraw();
  else if (a.type === 'erase') { act = null; requestLive(); }
  else if (a.type === 'lasso') endLasso();
  else if (a.type === 'move' || a.type === 'scale') { act = null; updateOverlay(); }
  else if (a.type === 'text') {
    act = null;
    if (Math.hypot(e.clientX - a.sx, e.clientY - a.sy) < 12) textTap(a.start);
  }
}

function cancelAction() {
  if (act && act.type === 'draw') clearTimeout(act.hold);
  act = null;
  requestLive();
}

function onWheel(e) {
  if (!E) return;
  e.preventDefault();
  const v = V();
  if (e.ctrlKey || e.metaKey) {
    const r = stage.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.01);
    const ns = Math.min(6, Math.max(0.2, v.s * k));
    v.ox = mx - ((mx - v.ox) * ns) / v.s;
    v.oy = my - ((my - v.oy) * ns) / v.s;
    v.s = ns; E.autoFit = false;
  } else { v.ox -= e.deltaX; v.oy -= e.deltaY; }
  clampView(); requestRedraw();
}

function onKey(e) {
  if (!E || $('editor').hidden) return;
  if (document.querySelector('.modal-back')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && E.sel) { e.preventDefault(); deleteSel(); }
  else if (e.key === 'Escape') clearSel();
  else if (!mod) {
    const map = { p: 'pen', l: 'pencil', m: 'marker', e: 'eraser', s: 'lasso', t: 'text', h: 'hand' };
    if (map[e.key]) selectTool(map[e.key]);
  }
}

// ----- pan / pinça -----
function startPan(e) { panPid = e.pointerId; panLast = { x: e.clientX, y: e.clientY }; }

function startGesture() {
  panPid = null;
  const pts = [...touches.values()].slice(0, 2);
  const snap = document.createElement('canvas');
  snap.width = base.width; snap.height = base.height;
  // copia sem o fundo de mesa para não "arrastar" a borda
  snap.getContext('2d').drawImage(base, 0, 0);
  gesture = {
    d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
    m0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    v0: { ...V() }, snap, t0: performance.now(), moved: false, maxTouches: touches.size,
  };
}
function moveGesture() {
  const g = gesture;
  g.maxTouches = Math.max(g.maxTouches, touches.size);
  const pts = [...touches.values()].slice(0, 2);
  if (pts.length < 2) return;
  const r = stage.getBoundingClientRect();
  const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  if (Math.abs(d - g.d0) > 12 || Math.hypot(m.x - g.m0.x, m.y - g.m0.y) > 12) g.moved = true;
  if (!g.moved) return;
  const v = V();
  const s = Math.min(6, Math.max(0.2, (g.v0.s * d) / g.d0));
  const px = (g.m0.x - r.left - g.v0.ox) / g.v0.s, py = (g.m0.y - r.top - g.v0.oy) / g.v0.s;
  v.s = s; E.autoFit = false;
  v.ox = m.x - r.left - px * s;
  v.oy = m.y - r.top - py * s;
  clampView();
  requestRedraw();
}
function endGesture() {
  const g = gesture;
  gesture = null;
  const quick = performance.now() - g.t0 < 320 && !g.moved;
  if (quick && g.maxTouches === 2) { undo(); toast('Desfeito (toque com 2 dedos)', 1200); }
  else if (quick && g.maxTouches >= 3) { redo(); toast('Refeito (toque com 3 dedos)', 1200); }
  redraw();
}

// ----- desenho -----
function startDraw(e, pt, t) {
  const cfg = toolCfg[t];
  act = {
    type: 'draw', pid: e.pointerId, ptype: e.pointerType,
    stroke: { id: uid(), tool: t, color: cfg.color, size: cfg.size, points: [[r1(pt.x), r1(pt.y), pressureOf(e)]] },
    anchor: pt, hold: 0, snapped: false,
  };
  armHold();
  requestLive();
}
const r1 = v => Math.round(v * 10) / 10;
function armHold() {
  clearTimeout(act.hold);
  if (!settings.shapes) return;
  const a = act;
  a.hold = setTimeout(() => {
    if (act !== a || a.snapped) return;
    const res = snapShape(a.stroke.points);
    if (res) {
      a.stroke.points = res.points.map(p => [r1(p[0]), r1(p[1]), 0.5]);
      a.stroke.shape = true;
      a.snapped = true;
      toast(`Forma corrigida: ${res.kind}`, 1100);
      requestLive();
    }
  }, 550);
}
function addPoint(ev) {
  if (act.snapped) return;
  const pt = toPage(ev.clientX, ev.clientY);
  const pts = act.stroke.points;
  const last = pts[pts.length - 1];
  const v = V();
  if (Math.hypot(pt.x - last[0], pt.y - last[1]) < 0.7 / v.s) return;
  pts.push([r1(pt.x), r1(pt.y), pressureOf(ev)]);
  if (Math.hypot(pt.x - act.anchor.x, pt.y - act.anchor.y) > 4 / v.s) { act.anchor = pt; armHold(); }
}
function endDraw() {
  const a = act;
  clearTimeout(a.hold);
  act = null;
  const { bbox, ...b } = a.stroke;
  const s = makeStroke(b, a.stroke.points);
  pushUndo();
  page().strokes.push(s);
  markDirty();
  redraw();
  requestLive();
  if (s.tool !== 'marker' && !s.shape) scheduleAuto(s.id);
}

// ----- borracha -----
function startErase(e, pt) {
  act = { type: 'erase', pid: e.pointerId, ptype: e.pointerType, cursor: pt, last: pt, pushed: false };
  eraseAt(pt);
  requestLive();
}
function eraseMove(pt) {
  const a = act, r = toolCfg.eraser.size / 2;
  const d = Math.hypot(pt.x - a.last.x, pt.y - a.last.y);
  const n = Math.max(1, Math.ceil(d / (r * 0.6)));
  for (let i = 1; i <= n; i++)
    eraseAt({ x: a.last.x + ((pt.x - a.last.x) * i) / n, y: a.last.y + ((pt.y - a.last.y) * i) / n });
  a.last = pt; a.cursor = pt;
}
function eraseAt(pt) {
  const pg = page(), r = toolCfg.eraser.size / 2;
  let changed = false;
  const out = [];
  for (const s of pg.strokes) {
    if (settings.eraserMode === 'stroke') {
      if (strokeHit(s, pt.x, pt.y, r)) { changed = true; continue; }
      out.push(s);
    } else {
      const res = eraseFromStroke(s, pt.x, pt.y, r);
      if (res === null) out.push(s);
      else { changed = true; out.push(...res); }
    }
  }
  const texts = pg.texts.filter(t => !bboxHit(textBBox(t), pt.x, pt.y, r * 0.3));
  if (texts.length !== pg.texts.length) changed = true;
  if (changed) {
    if (!act.pushed) { pushUndo(); act.pushed = true; }
    pg.strokes = out; pg.texts = texts;
    markDirty();
    requestRedraw();
  }
}

// ----- laço / seleção -----
function startLasso(e, pt) {
  const v = V();
  if (E.sel) {
    const b = E.sel.bbox;
    const hx = b.x + b.w, hy = b.y + b.h;
    if (Math.hypot(pt.x - hx, pt.y - hy) < 26 / v.s) {
      act = { type: 'scale', pid: e.pointerId, ptype: e.pointerType, start: pt, orig: selOriginals(), b0: { ...b }, pushed: false };
      return;
    }
    if (bboxHit(b, pt.x, pt.y, 8 / v.s)) {
      act = { type: 'move', pid: e.pointerId, ptype: e.pointerType, start: pt, orig: selOriginals(), b0: { ...b }, pushed: false };
      return;
    }
    clearSel();
  }
  act = { type: 'lasso', pid: e.pointerId, ptype: e.pointerType, pts: [pt] };
}
function endLasso() {
  const pts = act.pts.map(p => [p.x, p.y]);
  act = null;
  requestLive();
  const pg = page(), v = V();
  const sel = { strokes: new Set(), texts: new Set(), images: new Set() };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (x1 - x0 < 10 / v.s && y1 - y0 < 10 / v.s) {
    // toque: seleciona o item sob o dedo/caneta
    const x = pts[0][0], y = pts[0][1];
    const t = [...pg.texts].reverse().find(t => bboxHit(textBBox(t), x, y, 4 / v.s));
    const im = !t && [...pg.images].reverse().find(i => !i.locked && bboxHit(itemBBox('images', i), x, y));
    const s = !t && !im && [...pg.strokes].reverse().find(s => strokeHit(s, x, y, 10 / v.s));
    if (t) sel.texts.add(t.id); else if (im) sel.images.add(im.id); else if (s) sel.strokes.add(s.id);
  } else {
    for (const s of pg.strokes) {
      const step = Math.max(1, Math.floor(s.points.length / 30));
      let inside = 0, total = 0;
      for (let i = 0; i < s.points.length; i += step) { total++; if (pointInPoly(s.points[i][0], s.points[i][1], pts)) inside++; }
      if (total && inside / total >= 0.5) sel.strokes.add(s.id);
    }
    for (const t of pg.texts) { const b = textBBox(t); if (pointInPoly(b.x + b.w / 2, b.y + b.h / 2, pts)) sel.texts.add(t.id); }
    for (const i of pg.images) if (!i.locked && pointInPoly(i.x + i.w / 2, i.y + i.h / 2, pts)) sel.images.add(i.id);
  }
  if (!sel.strokes.size && !sel.texts.size && !sel.images.size) { clearSel(); return; }
  E.sel = sel;
  computeSelBBox();
  updateOverlay();
  if (E.lassoThen) {
    const what = E.lassoThen; E.lassoThen = null;
    runOnSelection(what);
  }
}
function selItems(kind) { const ids = E.sel[kind]; return page()[kind].filter(it => ids.has(it.id)); }
function selOriginals() {
  const m = {};
  for (const k of KINDS) m[k] = new Map(selItems(k).map(it => [it.id, it]));
  return m;
}
function computeSelBBox() {
  if (!E.sel) return;
  const boxes = [];
  for (const k of KINDS) for (const it of selItems(k)) boxes.push(itemBBox(k, it));
  E.sel.bbox = unionBBox(boxes) || { x: 0, y: 0, w: 0, h: 0 };
}
function clearSel() {
  if (!E || !E.sel) return;
  E.sel = null;
  updateOverlay();
}
function applyTransform(a, k, ox, oy, dx, dy) {
  if (!a.pushed) { pushUndo(); a.pushed = true; }
  const pg = page();
  for (const kind of KINDS) {
    const orig = a.orig[kind];
    if (!orig.size) continue;
    pg[kind] = pg[kind].map(it => orig.has(it.id) ? transformItem(kind, orig.get(it.id), k, ox, oy, dx, dy) : it);
  }
  computeSelBBox();
  markDirty();
  requestRedraw();
}
function moveSel(pt) { applyTransform(act, 1, 0, 0, pt.x - act.start.x, pt.y - act.start.y); }
function scaleSel(pt) {
  const b = act.b0;
  const d0 = Math.hypot(act.start.x - b.x, act.start.y - b.y) || 1;
  const k = Math.max(0.1, Math.min(10, Math.hypot(pt.x - b.x, pt.y - b.y) / d0));
  applyTransform(act, k, b.x, b.y, 0, 0);
}
function deleteSel() {
  if (!E.sel) return;
  pushUndo();
  const pg = page();
  for (const k of KINDS) pg[k] = pg[k].filter(it => !E.sel[k].has(it.id));
  clearSel(); markDirty(); redraw();
}
function duplicateSel() {
  if (!E.sel) return;
  pushUndo();
  const pg = page();
  const sel = { strokes: new Set(), texts: new Set(), images: new Set() };
  for (const k of KINDS) for (const it of selItems(k)) {
    const c = transformItem(k, it, 1, 0, 0, 30, 30);
    c.id = uid();
    pg[k].push(c); sel[k].add(c.id);
  }
  E.sel = sel; computeSelBBox(); markDirty(); redraw();
}
function recolorSel() {
  if (!E.sel) return;
  const color = (toolCfg[['pen', 'pencil', 'marker', 'text'].includes(tool) ? tool : 'pen'] || toolCfg.pen).color;
  modal({
    title: 'Mudar cor da seleção',
    body: h(`<div class="swatches big">${[...PALETTE, ...MARKER_PALETTE].map(c =>
      `<button class="sw" data-c="${c}" style="--c:${c}"></button>`).join('')}
      <label class="sw custom" style="--c:${color}"><input type="color" value="${color}"></label></div>`),
    actions: [{ label: 'Fechar', value: null }],
    onOpen: (el, close) => {
      const apply = c => {
        pushUndo();
        const pg = page();
        pg.strokes = pg.strokes.map(s => E.sel.strokes.has(s.id) ? { ...s, color: c } : s);
        pg.texts = pg.texts.map(t => E.sel.texts.has(t.id) ? { ...t, color: c } : t);
        markDirty(); redraw();
      };
      el.querySelectorAll('.sw[data-c]').forEach(b => b.onclick = () => { apply(b.dataset.c); close(); });
      el.querySelector('input[type=color]').onchange = e => { apply(e.target.value); close(); };
    },
  });
}

function updateOverlay() {
  if (!E) return;
  let box = overlay.querySelector('.selbox');
  let bar = overlay.querySelector('.selbar');
  if (!E.sel || !E.sel.bbox) { box && box.remove(); bar && bar.remove(); return; }
  if (!box) {
    box = h('<div class="selbox"><span class="handle"></span></div>');
    overlay.appendChild(box);
  }
  if (!bar) {
    bar = h(`<div class="selbar">
      <button data-a="convert">${ic('magic')}<span>Corrigir escrita</span></button>
      <button data-a="check">${ic('calc')}<span>Verificar conta</span></button>
      <button data-a="color" title="Cor">${ic('drop')}</button>
      <button data-a="dup" title="Duplicar">${ic('copy')}</button>
      <button data-a="del" title="Apagar" class="danger">${ic('trash')}</button></div>`);
    bar.onclick = e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'convert') runOnSelection('convert');
      else if (a === 'check') runOnSelection('check');
      else if (a === 'color') recolorSel();
      else if (a === 'dup') duplicateSel();
      else if (a === 'del') deleteSel();
    };
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    overlay.appendChild(bar);
  }
  const b = E.sel.bbox;
  const p0 = toScreen(b.x, b.y), p1 = toScreen(b.x + b.w, b.y + b.h);
  const pad = 6;
  Object.assign(box.style, {
    left: p0.x - pad + 'px', top: p0.y - pad + 'px',
    width: p1.x - p0.x + pad * 2 + 'px', height: p1.y - p0.y + pad * 2 + 'px',
  });
  const hasInk = E.sel.strokes.size > 0;
  bar.querySelector('[data-a=convert]').hidden = !hasInk;
  bar.querySelector('[data-a=check]').hidden = !hasInk;
  const bw = bar.offsetWidth || 300, bh = bar.offsetHeight || 44;
  let top = p0.y - pad - bh - 10;
  if (top < 6) top = Math.min(H - bh - 6, p1.y + pad + 10);
  let left = Math.max(6, Math.min(W - bw - 6, (p0.x + p1.x) / 2 - bw / 2));
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}

// ----- texto -----
function textTap(pt) {
  const pg = page();
  const t = [...pg.texts].reverse().find(t => bboxHit(textBBox(t), pt.x, pt.y, 6));
  if (t) editText(t);
  else {
    const cfg = toolCfg.text;
    editText({ id: uid(), x: pt.x, y: pt.y - cfg.size * 0.6, text: '', color: cfg.color, size: cfg.size }, true);
  }
}
function editText(t, isNew) {
  commitTextEdit();
  E.editingTextId = t.id;
  E.editingNew = !!isNew;
  E.editingOrig = t;
  const v = V();
  const p = toScreen(t.x, t.y);
  const ta = h('<textarea class="text-edit" rows="1" placeholder="Digite aqui…"></textarea>');
  ta.value = t.text;
  Object.assign(ta.style, {
    left: p.x + 'px', top: p.y + 'px', font: textFont({ ...t, size: t.size * v.s }), color: t.color,
    lineHeight: '1.25', maxWidth: (W - p.x - 8) + 'px',
  });
  const fit = () => {
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    ta.style.width = 'auto'; ta.style.width = Math.max(60, ta.scrollWidth + 4) + 'px';
  };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') { ta.value = E.editingOrig.text; commitTextEdit(); } });
  ta.addEventListener('blur', () => setTimeout(commitTextEdit, 0));
  ta.addEventListener('pointerdown', e => e.stopPropagation());
  overlay.appendChild(ta);
  requestRedraw();
  setTimeout(() => { ta.focus(); fit(); }, 30);
}
function commitTextEdit() {
  if (!E || !E.editingTextId) return;
  const ta = overlay.querySelector('.text-edit');
  const text = ta ? ta.value.replace(/\s+$/, '') : '';
  const id = E.editingTextId, orig = E.editingOrig, isNew = E.editingNew;
  E.editingTextId = null;
  ta && ta.remove();
  const pg = page();
  if (isNew) {
    if (text) { pushUndo(); pg.texts.push({ ...orig, text }); markDirty(); }
  } else if (text !== orig.text) {
    pushUndo();
    pg.texts = text ? pg.texts.map(t => (t.id === id ? { ...t, text } : t)) : pg.texts.filter(t => t.id !== id);
    markDirty();
  }
  requestRedraw();
}

// ----- imagem -----
async function onImageFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f || !E) return;
  try {
    const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const max = 1800;
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.86);
    const v = V();
    const w = Math.min(700, PAGE_W - 80);
    const hh = (w * c.height) / c.width;
    const cx = (W / 2 - v.ox) / v.s, cy = (H / 2 - v.oy) / v.s;
    const item = {
      id: uid(), src: data, w, h: hh,
      x: Math.max(20, Math.min(PAGE_W - w - 20, cx - w / 2)),
      y: Math.max(20, Math.min(PAGE_H - hh - 20, cy - hh / 2)),
    };
    pushUndo();
    page().images.push(item);
    markDirty();
    selectTool('lasso');
    E.sel = { strokes: new Set(), texts: new Set(), images: new Set([item.id]) };
    computeSelBBox();
    redraw();
    toast('Imagem inserida — arraste para mover, use o canto para redimensionar');
  } catch {
    toast('Não foi possível abrir a imagem');
  }
}

// Coloca na folha uma imagem da busca: com o nome em cima e o crédito embaixo, tudo selecionado
// (dá para arrastar, aumentar pelo canto ou apagar de uma vez)
export function insertPicture({ src, w: nw, h: nh, title, credit, withName = true, withCredit = true }) {
  if (!E) return;
  const v = V();
  // largura de até 320; retratos em pé ficam com no máximo 380 de altura
  let w = Math.min(320, PAGE_W - 80), hh = (w * nh) / nw;
  if (hh > 380) { w = (w * 380) / hh; hh = 380; }
  const nameSize = Math.max(24, +settings.flowSize || 30);
  const font = HAND_FONTS[settings.handFont] ? settings.handFont : settings.handFont === 'auto' ? 'patrick' : undefined;
  const top = withName ? nameSize * 1.4 : 0, bottom = withCredit && credit ? 26 : 0;
  const cx = (W / 2 - v.ox) / v.s, cy = (H / 2 - v.oy) / v.s;
  const x = Math.max(20, Math.min(PAGE_W - w - 20, cx - w / 2));
  const y = Math.max(20 + top, Math.min(PAGE_H - hh - 20 - bottom, cy - hh / 2));
  const img = { id: uid(), src, w, h: hh, x, y };
  const added = { strokes: new Set(), texts: new Set(), images: new Set([img.id]) };
  pushUndo();
  const pg = page();
  pg.images.push(img);
  if (withName && title) {
    const t = { id: uid(), x, y: y - top, text: title, size: nameSize, color: '#1d1d1f', font, bold: !font };
    pg.texts.push(t); added.texts.add(t.id);
  }
  if (withCredit && credit) {
    const t = { id: uid(), x, y: y + hh + 6, text: credit.slice(0, 70), size: 13, color: '#8a8f98', credit: true };
    pg.texts.push(t); added.texts.add(t.id);
  }
  markDirty();
  selectTool('lasso');
  E.sel = added;
  computeSelBBox();
  redraw();
}

// =================== Correção de escrita e contas ===================
function runOnSelection(what) {
  if (!E) return;
  if (!E.sel || !E.sel.strokes.size) {
    selectTool('lasso');
    E.lassoThen = what;
    toast(what === 'check' ? 'Circule a conta com o laço para verificar' : 'Circule a escrita com o laço para corrigir', 3200);
    return;
  }
  if (what === 'convert') convertSelection();
  else checkSelection();
}

function recogError(e) {
  if (e && e.message === 'offline') toast('Sem internet: o reconhecimento de escrita precisa de conexão', 3500);
  else toast('Não foi possível reconhecer agora. Tente novamente.', 3000);
}

function mainColor(strokes) {
  const m = new Map();
  for (const s of strokes) m.set(s.color, (m.get(s.color) || 0) + s.points.length);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '#1d1d1f';
}

// A escrita vira texto do tamanho escolhido no menu, sentado na pauta mais próxima de onde você escreveu
// (mesmo que a letra à mão tenha saído grande). Se não couber na linha, continua nas pautas de baixo.
function lineToText(pg, line, text) {
  const ids = new Set(line.strokes.map(s => s.id));
  pg.strokes = pg.strokes.filter(s => !ids.has(s.id));
  const g = paperGeom(E.content.bg);
  const base = line.y + line.h * 0.8; // onde fica a "linha de base" da letra à mão
  const ruleY = Math.max(g.first, g.first + Math.round((base - g.first) / LINE_STEP) * LINE_STEP);
  const x = Math.max(20, Math.min(line.x, PAGE_W - 200));
  const { items } = layoutFlow([{ runs: [{ text, color: mainColor(line.strokes), font: convFont(line.strokes, text) }] }], {
    size: +settings.flowSize || 30, indent: Math.max(0, x - g.left), startY: ruleY,
    geom: { ...g, left: Math.min(g.left, x), bottom: PAGE_H - 30 },
  });
  // vira texto comum (não entra na escrita organizada)
  pg.texts.push(...items.map(({ flow, para, ord, ...t }) => t));
}

async function convertSelection() {
  const pg = page();
  const strokes = selItems('strokes').filter(s => s.tool !== 'marker');
  if (!strokes.length) { toast('Selecione escrita feita com caneta ou lápis'); return; }
  const lines = groupLines(strokes);
  toast('Reconhecendo sua escrita…', 6000);
  let results;
  try {
    results = await Promise.all(lines.map(l => recognizeStrokes(l.strokes, settings.lang)));
  } catch (e) { recogError(e); return; }
  if (!E || page() !== pg) return;
  document.getElementById('toast')?.classList.remove('show');
  const body = h('<div class="rec-list"></div>');
  lines.forEach((l, i) => {
    const c = results[i] || [];
    const row = h(`<div class="rec-line">
      <input class="input" value="${esc(c[0] || '')}" data-i="${i}" placeholder="(não reconhecido)">
      <div class="chips">${c.slice(1, 7).map(x => `<button class="chip small" type="button">${esc(x)}</button>`).join('')}</div></div>`);
    row.querySelectorAll('.chip').forEach(b => b.onclick = () => { row.querySelector('input').value = b.textContent; });
    body.appendChild(row);
  });
  body.appendChild(h('<p class="muted small">Toque numa sugestão para trocar ou edite o texto. A escrita será substituída por letras digitadas.</p>'));
  const values = await modal({
    title: lines.length > 1 ? `Corrigir escrita (${lines.length} linhas)` : 'Corrigir escrita',
    body, wide: true,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Substituir', primary: true, value: el => [...el.querySelectorAll('.rec-line input')].map(i => i.value.trim()) },
    ],
  });
  if (!values || !E || page() !== pg) return;
  pushUndo();
  lines.forEach((l, i) => { if (values[i]) lineToText(pg, l, values[i]); });
  clearSel(); markDirty(); redraw();
  toast('Escrita corrigida ✓');
}

function removeMarksNear(pg, line) {
  const top = line.y - line.h * 0.3, bot = line.y + line.h * 1.3;
  pg.texts = pg.texts.filter(t => {
    if (!t.mark) return true;
    const b = textBBox(t);
    const cy = b.y + b.h / 2;
    return !(cy >= top && cy <= bot && b.x >= line.x);
  });
}
function addMark(pg, line, res, showMissing) {
  const size = Math.round(Math.max(18, Math.min(90, line.h * 0.7)));
  let text, color;
  if (res.hasAnswer) {
    if (res.ok) { text = '✓'; color = '#1f9d4a'; }
    else { text = `✗ certo: ${fmtNum(res.value)}`; color = '#e5352b'; }
  } else if (showMissing) { text = `= ${fmtNum(res.value)}`; color = '#0a6cff'; }
  else return null;
  removeMarksNear(pg, line);
  pg.texts.push({
    id: uid(), x: line.x + line.w + size * 0.6, y: line.y + line.h / 2 - (size * 1.25) / 2,
    text, color, size, bold: true, mark: true,
  });
  return text;
}

async function checkSelection() {
  const pg = page();
  const strokes = selItems('strokes').filter(s => s.tool !== 'marker');
  if (!strokes.length) { toast('Selecione a conta escrita com caneta ou lápis'); return; }
  const lines = groupLines(strokes);
  toast('Verificando…', 6000);
  let results;
  try {
    results = await Promise.all(lines.map(l => recognizeStrokes(l.strokes, settings.lang)));
  } catch (e) { recogError(e); return; }
  if (!E || page() !== pg) return;
  pushUndo();
  let right = 0, wrong = 0, calc = 0;
  const found = [];
  lines.forEach((l, i) => {
    const res = checkMath(results[i] || []);
    if (!res) return;
    const m = addMark(pg, l, res, true);
    if (!m) return;
    found.push(res.text);
    if (res.hasAnswer) res.ok ? right++ : wrong++; else calc++;
  });
  if (!found.length) {
    E.undo.pop(); updateUndoBtns();
    toast('Não reconheci nenhuma conta. Ex.: 12 + 7 = 19', 3500);
    return;
  }
  clearSel(); markDirty(); redraw();
  const parts = [];
  if (right) parts.push(`${right} certa${right > 1 ? 's' : ''} ✓`);
  if (wrong) parts.push(`${wrong} errada${wrong > 1 ? 's' : ''} ✗`);
  if (calc) parts.push(`${calc} resultado${calc > 1 ? 's' : ''} calculado${calc > 1 ? 's' : ''}`);
  toast(`${found.join('  •  ')}\n${parts.join(' · ')}`, 4500);
}

// ----- modo automático -----
function scheduleAuto(id) {
  if (settings.autoMode === 'off') return;
  E.pending.push(id);
  clearTimeout(E.autoTimer);
  E.autoTimer = setTimeout(runAuto, 1400);
}
async function runAuto() {
  if (!E || !E.pending.length || act) return;
  const ids = new Set(E.pending);
  E.pending = [];
  const pg = page();
  const strokes = pg.strokes.filter(s => ids.has(s.id));
  if (!strokes.length) return;
  const mode = settings.autoMode;
  let lines = groupLines(strokes);
  if (mode === 'flow') return runFlow(pg, lines.filter(l => l.strokes.some(s => s.tool !== 'marker')));
  if (mode === 'math') lines = lines.map(l => expandLine(pg, l));
  for (const l of lines) {
    let cands;
    try { cands = await recognizeStrokes(l.strokes, settings.lang); }
    catch (e) { recogError(e); return; }
    if (!E || page() !== pg) return;
    // traços podem ter sido apagados/movidos enquanto aguardava
    const alive = new Set(pg.strokes.map(s => s.id));
    if (!l.strokes.every(s => alive.has(s.id))) continue;
    if (mode === 'text') {
      if (!cands[0]) continue;
      pushUndo();
      lineToText(pg, l, cands[0]);
    } else {
      const res = checkMath(cands);
      if (!res || !res.hasAnswer) continue;
      pushUndo();
      addMark(pg, l, res, false);
    }
    markDirty(); redraw();
  }
}
// Escrita organizada: reconhece as linhas (em ordem de leitura) e manda o texto para as pautas
async function runFlow(pg, lines) {
  lines.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  let cands;
  try { cands = await Promise.all(lines.map(l => recognizeStrokes(l.strokes, settings.lang))); }
  catch (e) { recogError(e); return; }
  if (!E || page() !== pg) return;
  const alive = new Set(pg.strokes.map(s => s.id));
  const pieces = [], remove = new Set();
  lines.forEach((l, i) => {
    const text = (cands[i] && cands[i][0] || '').trim();
    if (!text || !l.strokes.every(s => alive.has(s.id))) return;
    pieces.push({ text, color: mainColor(l.strokes), font: convFont(l.strokes, text) });
    l.strokes.forEach(s => remove.add(s.id));
  });
  if (!pieces.length) return;
  pushUndo();
  pg.strokes = pg.strokes.filter(s => !remove.has(s.id));
  flowAppend(pieces);
  markDirty(); redraw();
}

// Junta à linha os traços vizinhos na mesma altura (ex.: "2+3=" escrito antes do "5")
function expandLine(pg, line) {
  const set = new Set(line.strokes.map(s => s.id));
  let x0 = line.x, x1 = line.x + line.w;
  const top = line.y - line.h * 0.3, bot = line.y + line.h * 1.3, gap = line.h * 1.6;
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of pg.strokes) {
      if (set.has(s.id) || s.tool === 'marker') continue;
      const b = s.bbox, cy = b.y + b.h / 2;
      if (cy < top || cy > bot || b.h > line.h * 2.5) continue;
      if (b.x + b.w < x0 - gap || b.x > x1 + gap) continue;
      set.add(s.id); x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w); changed = true;
    }
  }
  const strokes = pg.strokes.filter(s => set.has(s.id));
  return groupLines(strokes).sort((a, b) => b.strokes.length - a.strokes.length)[0] || line;
}

// =================== Páginas ===================
function gotoPage(i) {
  if (!E || i < 0 || i >= E.content.pages.length) return;
  commitTextEdit();
  clearSel();
  E.pageIndex = i;
  E.pending = [];
  updatePageBar();
  redraw();
}
function addPage() {
  pushUndo();
  E.content.pages.splice(E.pageIndex + 1, 0, { id: uid(), strokes: [], texts: [], images: [] });
  markDirty();
  gotoPage(E.pageIndex + 1);
  const v = V(); v.oy = 16; clampView(); redraw();
  toast(`Página ${E.pageIndex + 1} criada`);
}
async function deletePage() {
  if (E.content.pages.length <= 1) {
    if (!(await confirmBox('Limpar página', 'Esta é a única página. Deseja limpar todo o conteúdo dela?', 'Limpar'))) return;
    pushUndo();
    const p = page(); p.strokes = []; p.texts = []; p.images = [];
    markDirty(); redraw(); return;
  }
  if (!(await confirmBox('Excluir página', `Excluir a página ${E.pageIndex + 1}? (Você pode desfazer)`, 'Excluir'))) return;
  pushUndo();
  E.content.pages.splice(E.pageIndex, 1);
  E.pageIndex = Math.min(E.pageIndex, E.content.pages.length - 1);
  markDirty();
  gotoPage(E.pageIndex);
}
function updatePageBar() {
  const n = E.content.pages.length;
  $('pg-label').textContent = `${E.pageIndex + 1} / ${n}`;
  $('pg-prev').disabled = E.pageIndex === 0;
  $('pg-next').disabled = E.pageIndex >= n - 1;
}

async function paperDialog() {
  const bg = E.content.bg;
  const body = h(`<div>
    <label class="lbl">Tipo de folha</label>
    <div class="paper-opts" data-g="type">${Object.entries(PAPER_TYPES).map(([k, v]) =>
      `<button class="paper-opt ${bg.type === k ? 'active' : ''}" data-v="${k}"><span class="pp pp-${k}"></span>${v}</button>`).join('')}</div>
    <label class="lbl">Cor do papel</label>
    <div class="paper-opts" data-g="color">${Object.entries(PAPER_COLORS).map(([k, v]) =>
      `<button class="paper-opt ${bg.color === k ? 'active' : ''}" data-v="${k}"><span class="pc" style="background:${v.fill}"></span>${v.label}</button>`).join('')}</div>
  </div>`);
  const choice = { ...bg };
  body.querySelectorAll('.paper-opts').forEach(g => g.onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    choice[g.dataset.g] = b.dataset.v;
    g.querySelectorAll('.paper-opt').forEach(x => x.classList.toggle('active', x === b));
  });
  const ok = await modal({ title: 'Papel', body, actions: [{ label: 'Cancelar', value: false }, { label: 'Aplicar', value: true, primary: true }] });
  if (!ok || !E) return;
  const had = E.content.bg && E.content.bg.type;
  E.content.bg = choice;
  // trocou o tipo de folha: o texto organizado se ajusta às pautas novas
  if (had !== choice.type) { for (const pg of E.content.pages) if (pg.texts.some(t => t.flow)) delete pg.flowY; restyleFlow(); }
  markDirty(); redraw();
}

// =================== Desfazer / salvar ===================
function snapshot() {
  return {
    pageIndex: E.pageIndex,
    pages: E.content.pages.map(p => ({ ...p, strokes: p.strokes.slice(), texts: p.texts.slice(), images: p.images.slice() })),
  };
}
function pushUndo() {
  E.undo.push(snapshot());
  if (E.undo.length > 100) E.undo.shift();
  E.redo.length = 0;
  updateUndoBtns();
}
function restore(sn) {
  E.content.pages = sn.pages;
  E.pageIndex = Math.min(sn.pageIndex, sn.pages.length - 1);
  E.sel = null;
  updateOverlay(); updatePageBar(); markDirty(); redraw(); updateUndoBtns();
}
function undo() {
  if (!E || !E.undo.length) return;
  commitTextEdit();
  E.redo.push(snapshot());
  restore(E.undo.pop());
}
function redo() {
  if (!E || !E.redo.length) return;
  E.undo.push(snapshot());
  restore(E.redo.pop());
}
function updateUndoBtns() {
  $('ed-undo').disabled = !E.undo.length;
  $('ed-redo').disabled = !E.redo.length;
}
function setSaveState(t) { $('ed-save').textContent = t; }
function markDirty() {
  E.dirty = true;
  setSaveState('Salvando…');
  clearTimeout(E.saveTimer);
  E.saveTimer = setTimeout(() => flushSave(), 900);
}
export async function flushSave() {
  if (!E || !E.dirty) return;
  const st = E;
  clearTimeout(st.saveTimer);
  st.dirty = false;
  st.meta.updatedAt = Date.now();
  st.meta.pageCount = st.content.pages.length;
  // texto digitado das páginas (inclusive o escrito pela IA) para a busca encontrar pelo conteúdo
  st.meta.searchText = st.content.pages.flatMap(p => p.texts.filter(t => !t.mark).map(t => t.text)).join(' ').replace(/\s+/g, ' ').slice(0, 5000);
  try {
    st.meta.thumb = renderPageToCanvas(st.content.pages[0], st.content.bg, 280).toDataURL('image/jpeg', 0.72);
  } catch { /* imagem ainda carregando */ }
  try {
    await cb.onSave(st.meta, st.content);
    if (E === st && !st.dirty) setSaveState('Salvo');
  } catch (e) {
    st.dirty = true;
    toast('Erro ao salvar: ' + (e && e.message ? e.message : 'armazenamento cheio?'), 4000);
  }
}

// =================== Integração: IA, importação e visão geral ===================
export function getEditorContext() {
  if (!E) return null;
  return {
    meta: E.meta, content: E.content, pageIndex: E.pageIndex,
    selBBox: E.sel && E.sel.bbox && E.sel.bbox.w > 0 ? { ...E.sel.bbox } : null,
  };
}

const emptyPage = () => ({ id: uid(), strokes: [], texts: [], images: [] });
const isEmptyPage = p => !p.strokes.length && !p.texts.length && !p.images.length;

// Escreve um texto longo nas pautas: 'here' = abaixo do conteúdo desta página; 'new' = em página nova
export function insertText(text, where = 'new') {
  if (!E) return 0;
  commitTextEdit();
  const dark = E.content.bg && E.content.bg.color === 'dark';
  const color = dark ? '#f1f3f5' : '#1d1d1f', accent = dark ? '#7fb2ff' : '#0a6cff';
  pushUndo();
  let idx = E.pageIndex;
  let startY;
  if (where === 'here') startY = nextFreeLine(page());
  else {
    if (!isEmptyPage(page())) { E.content.pages.splice(idx + 1, 0, emptyPage()); idx++; }
    startY = undefined;
  }
  let groups = layoutText(text, { startY, color, accent });
  if (where === 'here' && startY > 1300) { // página cheia: começa na próxima
    E.content.pages.splice(idx + 1, 0, emptyPage()); idx++;
    groups = layoutText(text, { color, accent });
  }
  const first = idx;
  groups.forEach((g, i) => {
    if (i > 0) { E.content.pages.splice(idx + 1, 0, emptyPage()); idx++; }
    E.content.pages[idx].texts.push(...g);
  });
  markDirty();
  gotoPage(first);
  return groups.length;
}

// Coloca imagens (ex.: páginas de um PDF) como fundo de páginas novas, travadas para não sair do lugar
export function insertImagePages(images) {
  if (!E || !images.length) return;
  pushUndo();
  let idx = E.pageIndex;
  let first = -1;
  images.forEach((img, n) => {
    let pg;
    if (n === 0 && isEmptyPage(page())) pg = page();
    else { pg = emptyPage(); E.content.pages.splice(++idx, 0, pg); }
    if (first < 0) first = E.content.pages.indexOf(pg);
    const k = Math.min(PAGE_W / img.w, PAGE_H / img.h);
    const w = img.w * k, hh = img.h * k;
    pg.images.push({ id: uid(), src: img.src, x: (PAGE_W - w) / 2, y: (PAGE_H - hh) / 2, w, h: hh, locked: true });
  });
  markDirty();
  gotoPage(first);
}

// Visão geral: miniaturas para pular, reordenar, duplicar e excluir páginas
export function openPageOverview() {
  if (!E) return;
  commitTextEdit();
  const body = h('<div class="pages-grid"></div>');
  const draw = () => {
    body.innerHTML = '';
    E.content.pages.forEach((p, i) => {
      const cell = h(`<div class="pg-cell ${i === E.pageIndex ? 'active' : ''}">
        <button class="pg-thumb" data-go="${i}" aria-label="Ir para a página ${i + 1}"></button>
        <div class="pg-tools"><span>${i + 1}</span>
          <button class="icon-btn small" data-left="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Mover para trás">${ic('left')}</button>
          <button class="icon-btn small" data-right="${i}" ${i === E.content.pages.length - 1 ? 'disabled' : ''} aria-label="Mover para frente">${ic('right')}</button>
          <button class="icon-btn small" data-dup="${i}" aria-label="Duplicar">${ic('copy')}</button>
          <button class="icon-btn small" data-del="${i}" aria-label="Excluir">${ic('trash')}</button></div></div>`);
      const c = renderPageToCanvas(p, E.content.bg, 150);
      cell.querySelector('.pg-thumb').appendChild(c);
      body.appendChild(cell);
    });
    const add = h(`<button class="pg-cell pg-add">${ic('plus')}<span>Nova página</span></button>`);
    add.onclick = () => { pushUndo(); E.content.pages.push(emptyPage()); markDirty(); draw(); updatePageBar(); };
    body.appendChild(add);
  };
  draw();
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const d = b.dataset, pages = E.content.pages;
    if (d.go !== undefined) { gotoPage(+d.go); body.closest('.modal-back')?._close?.(); return; }
    pushUndo();
    if (d.left !== undefined) { const i = +d.left; [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; if (E.pageIndex === i) E.pageIndex--; else if (E.pageIndex === i - 1) E.pageIndex++; }
    else if (d.right !== undefined) { const i = +d.right; [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; if (E.pageIndex === i) E.pageIndex++; else if (E.pageIndex === i + 1) E.pageIndex--; }
    else if (d.dup !== undefined) {
      const i = +d.dup, p = pages[i];
      pages.splice(i + 1, 0, { id: uid(), strokes: p.strokes.map(s => ({ ...s, id: uid() })), texts: p.texts.map(t => ({ ...t, id: uid() })), images: p.images.map(m => ({ ...m, id: uid() })) });
    } else if (d.del !== undefined) {
      if (pages.length === 1) { E.undo.pop(); toast('A anotação precisa ter pelo menos uma página'); return; }
      pages.splice(+d.del, 1);
      E.pageIndex = Math.min(E.pageIndex, pages.length - 1);
    } else { E.undo.pop(); return; }
    clearSel(); markDirty(); updatePageBar(); redraw(); draw();
  };
  modal({ title: `Páginas (${E.content.pages.length})`, body, wide: true, actions: [{ label: 'Fechar', value: true, primary: true }] });
}
