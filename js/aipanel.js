// Interface do Assistente IA: painel lateral no editor e janela para pastas/anotações.
import { ACTIONS, aiConfigured, buildContent, streamChat, cleanText, extractTasks, parseFlashcards, maxPages } from './ai.js';
import { getEditorContext, insertText } from './editor.js';
import { shareText } from './export.js';
import { ic, esc, h, toast, modal } from './ui.js';
import { speak, stopSpeak } from './voice.js';

let cb = {};
let panel, conv = null, busy = null;
let scope = 'page';

export function initAIPanel(callbacks) {
  cb = callbacks;
  panel = h(`<aside id="ai-panel" hidden aria-label="Assistente IA">
    <header class="ai-head"><span class="ai-badge">${ic('magic')}</span><b>Assistente IA</b>
      <button class="icon-btn small" id="ai-new" title="Nova conversa" aria-label="Nova conversa">${ic('plus')}</button>
      <button class="icon-btn small" id="ai-close" aria-label="Fechar">${ic('close')}</button></header>
    <div class="ai-body">
      <div id="ai-setup" hidden></div>
      <div id="ai-main">
        <div class="ai-scope seg small" id="ai-scope">
          <button data-s="sel">Seleção</button><button data-s="page" class="active">Esta página</button><button data-s="all">Todas</button>
        </div>
        <div class="ai-actions" id="ai-actions">${Object.entries(ACTIONS).map(([k, a]) =>
          `<button class="ai-act" data-a="${k}">${ic(a.icon)}<span>${esc(a.label)}</span></button>`).join('')}</div>
        <div class="ai-log" id="ai-log"></div>
      </div>
    </div>
    <form class="ai-ask" id="ai-ask" autocomplete="off">
      <textarea id="ai-q" rows="1" placeholder="Pergunte sobre sua anotação…"></textarea>
      <button class="btn primary" type="submit" id="ai-send" aria-label="Enviar">${ic('right')}</button>
    </form>
  </aside>`);
  document.getElementById('editor').appendChild(panel);
  panel.querySelector('#ai-close').onclick = closeAIPanel;
  panel.querySelector('#ai-new').onclick = () => { stop(); conv = null; renderLog(); };
  panel.querySelector('#ai-scope').onclick = e => {
    const b = e.target.closest('[data-s]'); if (!b || b.disabled) return;
    setScope(b.dataset.s);
  };
  panel.querySelector('#ai-actions').onclick = e => {
    const b = e.target.closest('[data-a]'); if (b) runAction(b.dataset.a);
  };
  const q = panel.querySelector('#ai-q');
  q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(140, q.scrollHeight) + 'px'; });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('#ai-ask').requestSubmit(); } });
  panel.querySelector('#ai-ask').onsubmit = e => {
    e.preventDefault();
    if (busy) { stop(); return; }
    const text = q.value.trim();
    if (!text) return;
    q.value = ''; q.style.height = 'auto';
    ask(text);
  };
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  window.addEventListener('resize', () => { if (!panel.hidden) placePanel(); });
}

function placePanel() { panel.style.top = document.getElementById('stage').offsetTop + 'px'; }
export function openAIPanel() {
  panel.hidden = false;
  placePanel();
  document.body.classList.add('ai-open');
  const ctx = getEditorContext();
  panel.querySelector('[data-s=sel]').disabled = !(ctx && ctx.selBBox);
  setScope(ctx && ctx.selBBox ? 'sel' : scope === 'sel' ? 'page' : scope);
  renderSetup();
  renderLog();
}
export function closeAIPanel() {
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove('ai-open');
}
export function toggleAIPanel() { panel.hidden ? openAIPanel() : closeAIPanel(); }
export function resetAIPanel() { stop(); stopSpeak(); conv = null; if (panel) { renderLog(); closeAIPanel(); } }

function setScope(s) {
  scope = s;
  panel.querySelectorAll('#ai-scope button').forEach(b => b.classList.toggle('active', b.dataset.s === s));
}

function renderSetup() {
  const ok = aiConfigured();
  const box = panel.querySelector('#ai-setup');
  box.hidden = ok;
  panel.querySelector('#ai-main').hidden = !ok;
  panel.querySelector('#ai-ask').hidden = !ok;
  if (ok) return;
  box.innerHTML = `<div class="ai-setup-card">
    <p><b>A IA resume suas anotações, corrige e melhora sua escrita, explica a matéria, cria perguntas e escreve mais conteúdo.</b></p>
    <p class="muted small">Usa o <b>Gemini</b>, do Google, na versão rápida e gratuita. Crie uma chave em <b>aistudio.google.com/apikey</b> e cole em Ajustes → Inteligência artificial.</p>
    <button class="btn primary" id="ai-config">${ic('settings')}<span>Configurar a IA</span></button></div>`;
  box.querySelector('#ai-config').onclick = async () => { await cb.onSettings(); renderSetup(); };
}

// ---------- conversa ----------
function pagesForScope() {
  const ctx = getEditorContext();
  if (!ctx) return null;
  const { content, pageIndex, meta, selBBox } = ctx;
  let pages, region = null;
  if (scope === 'all') pages = content.pages;
  else pages = [content.pages[pageIndex]];
  if (scope === 'sel' && selBBox) {
    const pad = 20;
    region = { x: selBBox.x - pad, y: selBBox.y - pad, w: selBBox.w + pad * 2, h: selBBox.h + pad * 2 };
  }
  return { pages, region, bg: content.bg, title: meta.title, folder: cb.folderName ? cb.folderName(meta.folderId) : '' };
}

async function runAction(key) {
  if (busy) return;
  const a = ACTIONS[key];
  const src = pagesForScope();
  if (!src) return;
  if (src.pages.length > maxPages()) toast(`Só as primeiras ${maxPages()} páginas serão enviadas`);
  conv = { messages: [], turns: [], action: key };
  conv.turns.push({ role: 'user', text: `${a.label} — ${scopeLabel(src)}` });
  renderLog();
  let content;
  try { content = await buildContent({ ...src, prompt: a.prompt }); }
  catch (e) { conv.turns.push({ role: 'error', text: 'Não consegui preparar as páginas: ' + e.message }); renderLog(); return; }
  send({ role: 'user', content });
}

function scopeLabel(src) {
  if (scope === 'sel') return 'trecho selecionado';
  return src.pages.length > 1 ? `${src.pages.length} páginas` : 'esta página';
}

async function ask(text) {
  if (!conv || !conv.messages.length) {
    const src = pagesForScope();
    if (!src) return;
    conv = { messages: [], turns: [{ role: 'user', text }], action: 'chat' };
    renderLog();
    let content;
    try {
      content = await buildContent({ ...src, prompt: `Pergunta do estudante sobre estas anotações: ${text}` });
    } catch (e) { conv.turns.push({ role: 'error', text: e.message }); renderLog(); return; }
    send({ role: 'user', content });
  } else {
    conv.turns.push({ role: 'user', text });
    conv.action = 'chat';
    renderLog();
    send({ role: 'user', content: text });
  }
}

function send(userMsg) {
  const c = conv;
  c.messages.push(userMsg);
  const turn = { role: 'assistant', text: '', streaming: true };
  c.turns.push(turn);
  renderLog();
  let s;
  try { s = streamChat(c.messages, t => { turn.text += t; scheduleTurnUpdate(); }); }
  catch (e) { c.messages.pop(); turn.streaming = false; turn.role = 'error'; turn.text = e.message; renderLog(); return; }
  busy = s;
  setBusy(true);
  s.done.then(res => {
    turn.text = res.text;
    turn.streaming = false;
    turn.truncated = res.truncated;
    c.messages.push({ role: 'assistant', content: res.message.content });
  }).catch(e => {
    c.messages.pop();
    turn.streaming = false;
    if (e.aborted) { turn.text += turn.text ? '\n\n(interrompido)' : '(interrompido)'; turn.partial = true; }
    else { turn.role = 'error'; turn.text = e.message; }
  }).finally(() => {
    if (busy === s) busy = null;
    setBusy(false);
    if (conv === c) renderLog();
  });
}

function stop() { if (busy) { busy.abort(); busy = null; setBusy(false); } }

function setBusy(on) {
  const b = panel.querySelector('#ai-send');
  b.innerHTML = on ? ic('close') : ic('right');
  b.setAttribute('aria-label', on ? 'Parar' : 'Enviar');
  b.classList.toggle('danger', on);
  panel.querySelectorAll('.ai-act').forEach(x => (x.disabled = on));
}

// Mostra títulos ("# ") em destaque; todo o texto é escapado antes
function rich(text) {
  return esc(text).split('\n').map(l => {
    const m = l.match(/^\s*#{1,6}\s+(.*)$/);
    return m ? `<span class="ai-h">${m[1]}</span>` : l;
  }).join('\n');
}

let rafT = 0;
function scheduleTurnUpdate() {
  if (rafT) return;
  rafT = requestAnimationFrame(() => {
    rafT = 0;
    const el = panel.querySelector('.ai-turn.streaming .ai-text');
    if (el && conv) {
      el.innerHTML = rich(cleanText(conv.turns[conv.turns.length - 1].text));
      const log = panel.querySelector('.ai-body');
      log.scrollTop = log.scrollHeight;
    }
  });
}

function renderLog() {
  const log = panel.querySelector('#ai-log');
  panel.querySelector('#ai-actions').classList.toggle('compact', !!(conv && conv.turns.length));
  if (!conv || !conv.turns.length) {
    log.innerHTML = `<p class="muted small ai-hint">Escolha o que fazer com ${scope === 'sel' ? 'o trecho selecionado' : scope === 'all' ? 'todas as páginas' : 'esta página'} ou faça uma pergunta. A IA lê sua letra direto da folha.</p>`;
    return;
  }
  log.innerHTML = '';
  conv.turns.forEach((t, i) => {
    const last = i === conv.turns.length - 1;
    const el = h(`<div class="ai-turn ${t.role} ${t.streaming ? 'streaming' : ''}"><div class="ai-text"></div></div>`);
    if (t.role === 'assistant') el.querySelector('.ai-text').innerHTML = rich(cleanText(t.text)) || (t.streaming ? '' : '(sem resposta)');
    else el.querySelector('.ai-text').textContent = t.text;
    if (t.streaming) el.appendChild(h('<div class="ai-typing"><i></i><i></i><i></i></div>'));
    if (t.role === 'assistant' && !t.streaming && t.text) {
      if (t.truncated) el.appendChild(h('<p class="muted small">A resposta foi cortada por ser muito longa.</p>'));
      const bar = h(`<div class="ai-result">
        <button class="chip small" data-r="new">${ic('page')}<span>Nova página</span></button>
        <button class="chip small" data-r="here">${ic('plus')}<span>Nesta página</span></button>
        <button class="chip small" data-r="say">${ic('speaker')}<span>Ouvir</span></button>
        <button class="chip small" data-r="copy">${ic('copy')}<span>Copiar</span></button>
        <button class="chip small" data-r="share">${ic('share')}<span>Enviar</span></button></div>`);
      const tasks = last && conv.action === 'plan' ? extractTasks(t.text) : [];
      const fcs = last && conv.action === 'flashcards' ? parseFlashcards(t.text) : [];
      if (fcs.length) bar.prepend(h(`<button class="chip small on" data-r="cards">${ic('cards')}<span>Salvar ${fcs.length} flashcards</span></button>`));
      if (tasks.length) {
        const tb = h(`<button class="chip small on" data-r="tasks">${ic('tasks')}<span>Criar ${tasks.length} tarefas</span></button>`);
        bar.prepend(tb);
      }
      bar.onclick = async e => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        const txt = cleanText(t.text);
        if (b.dataset.r === 'new' || b.dataset.r === 'here') {
          const n = insertText(txt, b.dataset.r);
          toast(n > 1 ? `Texto escrito em ${n} páginas ✓` : 'Texto escrito na folha ✓');
        } else if (b.dataset.r === 'say') {
          speak(txt, { button: b });
        } else if (b.dataset.r === 'copy') {
          try { await navigator.clipboard.writeText(txt); toast('Copiado'); } catch { toast('Não foi possível copiar'); }
        } else if (b.dataset.r === 'share') {
          const r = await shareText(txt, 'Caderno de Estudos');
          if (r === 'copied') toast('Texto copiado — cole onde quiser');
        } else if (b.dataset.r === 'cards') {
          const r = await cb.onSaveCards(fcs, getEditorContext()?.meta);
          toast(`${r.n} flashcards salvos em “${r.deck.name}” ✓ — revise na aba Flashcards`, 4000);
          b.remove();
        } else if (b.dataset.r === 'tasks') {
          const n = await cb.onCreateTasks(tasks, getEditorContext()?.meta);
          if (n) { toast(`${n} tarefas criadas ✓`); b.remove(); }
        }
      };
      el.appendChild(bar);
    }
    log.appendChild(el);
  });
  const body = panel.querySelector('.ai-body');
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

// ---------- Janela de IA para pastas e anotações (fora do editor) ----------
// pages: páginas (podem ter _bg e _title), onSave(text) salva como anotação nova
export async function openAIDialog({ title, subtitle, pages, bg, folder, onSave, onSettings }) {
  if (!aiConfigured()) {
    const go = await modal({
      title: 'Assistente IA',
      body: '<p>Para usar a IA, cole a chave do Gemini (grátis em aistudio.google.com/apikey) em <b>Ajustes → Inteligência artificial</b>.</p>',
      actions: [{ label: 'Cancelar', value: false }, { label: 'Abrir Ajustes', value: true, primary: true }],
    });
    if (go) await onSettings();
    if (!aiConfigured()) return;
  }
  const body = h(`<div class="ai-dialog">
    <p class="muted small">${esc(subtitle)}${pages.length > maxPages() ? ` — só as primeiras ${maxPages()} páginas serão enviadas` : ''}</p>
    <div class="ai-actions">${Object.entries(ACTIONS).map(([k, a]) =>
      `<button class="ai-act" data-a="${k}">${ic(a.icon)}<span>${esc(a.label)}</span></button>`).join('')}</div>
    <div class="ai-out" hidden></div>
  </div>`);
  let stream = null, result = '', closeFn;
  const out = body.querySelector('.ai-out');
  const btns = () => body.closest('.modal')?.querySelectorAll('.modal-actions .btn') || [];
  body.querySelector('.ai-actions').onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b || stream) return;
    const a = ACTIONS[b.dataset.a];
    body.querySelectorAll('.ai-act').forEach(x => x.classList.toggle('active', x === b));
    out.hidden = false; out.classList.remove('error'); out.textContent = 'Lendo as páginas…';
    result = '';
    btns().forEach(x => { if (x.dataset.k !== 'close') x.disabled = true; });
    try {
      const content = await buildContent({ pages, bg, title, folder, prompt: a.prompt });
      stream = streamChat([{ role: 'user', content }], t => { result += t; out.innerHTML = rich(cleanText(result)); out.scrollTop = out.scrollHeight; });
      const res = await stream.done;
      result = res.text;
      out.innerHTML = rich(cleanText(result));
      btns().forEach(x => (x.disabled = false));
    } catch (err) {
      if (!err.aborted) { out.textContent = err.message; out.classList.add('error'); }
    } finally { stream = null; }
  };
  await modal({
    title: `IA — ${title}`, body, wide: true,
    actions: [
      { label: 'Fechar', value: 'close' },
      { label: 'Copiar', value: 'copy' },
      { label: 'Salvar como anotação', value: 'save', primary: true },
    ],
    onOpen: (el, close) => {
      closeFn = close;
      const bs = el.querySelectorAll('.modal-actions .btn');
      bs[0].dataset.k = 'close';
      bs[1].disabled = bs[2].disabled = true;
      bs[0].onclick = () => { stream && stream.abort(); close('close'); };
      bs[1].onclick = async () => { try { await navigator.clipboard.writeText(cleanText(result)); toast('Copiado'); } catch { toast('Não foi possível copiar'); } };
      bs[2].onclick = async () => { if (!result) return; close('save'); await onSave(cleanText(result)); };
    },
  });
  if (stream) stream.abort();
  return closeFn;
}
