// Ferramentas de estudo: tabela periódica interativa, gráfico de funções e tradutor.
import { ic, esc, h, toast } from './ui.js';
import { ELEMENTS, CATS, electronConfig, shells, findElement } from './elements.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';
import { richText } from './ui.js';
import { uid, PAGE_W, PAGE_H } from './ink.js';

let A;
let tab = 'tabela', sel = null;
let fns = ['x^2 - 4', '', ''];
let view = { x0: -10, x1: 10, y0: -8, y1: 8 };
let tr = { from: 'en', text: '', out: '' };
export const TOOL_VIEWS = { tools: { title: 'Ferramentas', icon: 'wrench' } };
export function initTools(api) { A = api; }

// ---------- leitor de expressões (sem eval): + − × ÷ ^, parênteses, funções, x, π, e, multiplicação implícita ----------
const FUNCS = { sen: Math.sin, sin: Math.sin, cos: Math.cos, tg: Math.tan, tan: Math.tan, raiz: Math.sqrt, sqrt: Math.sqrt, log: Math.log10, ln: Math.log, abs: Math.abs, exp: Math.exp, mod: Math.abs };
export function compile(src) {
  const s = String(src).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'raiz').replace(/π/g, 'pi')
    .replace(/^(y|f\(x\))=/, '');
  if (!s) throw new Error('vazio');
  let i = 0;
  const peek = () => s[i];
  const num = () => { const m = s.slice(i).match(/^\d+(\.\d+)?|^\.\d+/); if (!m) return null; i += m[0].length; const v = parseFloat(m[0]); return () => v; };
  const word = () => { const m = s.slice(i).match(/^[a-z]+/); if (!m) return null; i += m[0].length; return m[0]; };
  function primary() {
    const n = num(); if (n) return n;
    if (peek() === '(') { i++; const e = expr(); if (peek() !== ')') throw new Error('falta )'); i++; return e; }
    const w = word();
    if (w) {
      if (w === 'x') return x => x;
      if (w === 'pi') return () => Math.PI;
      if (w === 'e') return () => Math.E;
      // o argumento é só o que vem logo depois (ex.: sen(x)); o ^ vale para o resultado: sen(x)^2 = (sen x)²
      if (FUNCS[w]) { const arg = primary(); const f = FUNCS[w]; return x => f(arg(x)); }
      // "2x" já é tratado; "xx" ou palavras desconhecidas: erro claro
      throw new Error(`não conheço “${w}”`);
    }
    throw new Error('expressão incompleta');
  }
  function power() {
    let b = primary();
    if (peek() === '^') { i++; const ex = unary(); const bb = b; b = x => Math.pow(bb(x), ex(x)); }
    return b;
  }
  function unary() { if (peek() === '-') { i++; const u = unary(); return x => -u(x); } if (peek() === '+') { i++; return unary(); } return power(); }
  function term() {
    let a = unary();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') { i++; const b = unary(), aa = a; a = c === '*' ? x => aa(x) * b(x) : x => aa(x) / b(x); }
      else if (c && /[a-z0-9(.]/.test(c)) { const b = power(), aa = a; a = x => aa(x) * b(x); } // multiplicação implícita: 2x, 3(x+1), x(x-1)
      else return a;
    }
  }
  function expr() {
    let a = term();
    while (peek() === '+' || peek() === '-') { const c = s[i++]; const b = term(), aa = a; a = c === '+' ? x => aa(x) + b(x) : x => aa(x) - b(x); }
    return a;
  }
  const f = expr();
  if (i < s.length) throw new Error(`não entendi “${s.slice(i)}”`);
  return f;
}
// raízes (onde cruza o eixo x) no intervalo, para mostrar abaixo do gráfico
export function roots(f, a, b, n = 2000) {
  const out = [];
  let px = a, py = f(a);
  for (let k = 1; k <= n; k++) {
    const x = a + ((b - a) * k) / n, y = f(x);
    if (!isFinite(y) || !isFinite(py)) { px = x; py = y; continue; }
    if (py === 0) out.push(px);
    else if (py * y < 0 && Math.abs(py - y) < 50) {
      let lo = px, hi = x;
      for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2, fm = f(m); if (f(lo) * fm <= 0) hi = m; else lo = m; }
      out.push((lo + hi) / 2);
    }
    px = x; py = y;
  }
  return out.filter((r, i) => !i || Math.abs(r - out[i - 1]) > 1e-6).slice(0, 8);
}
const COLORS = ['#2563eb', '#dc2626', '#16a34a'];
export function drawGraph(canvas, list, v) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 420;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = x => ((x - v.x0) / (v.x1 - v.x0)) * W, sy = y => H - ((y - v.y0) / (v.y1 - v.y0)) * H;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const step = (v.x1 - v.x0) > 30 ? 5 : (v.x1 - v.x0) > 12 ? 2 : 1;
  g.strokeStyle = '#e5eaf3'; g.lineWidth = 1;
  for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) { g.beginPath(); g.moveTo(sx(x), 0); g.lineTo(sx(x), H); g.stroke(); }
  for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) { g.beginPath(); g.moveTo(0, sy(y)); g.lineTo(W, sy(y)); g.stroke(); }
  g.strokeStyle = '#334155'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, sy(0)); g.lineTo(W, sy(0)); g.moveTo(sx(0), 0); g.lineTo(sx(0), H); g.stroke();
  g.fillStyle = '#64748b'; g.font = '11px system-ui, sans-serif';
  for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) if (x) g.fillText(String(x), sx(x) + 2, sy(0) + 12);
  for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) if (y) g.fillText(String(y), sx(0) + 4, sy(y) - 2);
  list.forEach((f, k) => {
    if (!f) return;
    g.strokeStyle = COLORS[k]; g.lineWidth = 2.6; g.beginPath();
    let pen = false, lastY = null;
    for (let px = 0; px <= W; px += 1) {
      const x = v.x0 + (px / W) * (v.x1 - v.x0), y = f(x);
      if (!isFinite(y) || (lastY != null && Math.abs(y - lastY) > (v.y1 - v.y0) * 2)) { pen = false; lastY = null; continue; }
      const Y = sy(y);
      if (pen) g.lineTo(px, Y); else { g.moveTo(px, Y); pen = true; }
      lastY = y;
    }
    g.stroke();
  });
}

// ---------- tela ----------
export function renderTools(el) {
  el.innerHTML = `<div class="tools-wrap">
    <div class="seg tools-tabs" id="tl-tabs">${[['tabela', 'atom', 'Tabela periódica'], ['grafico', 'graph', 'Gráfico de funções'], ['tradutor', 'languages', 'Tradutor']].map(([k, i, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${ic(i)}<span>${l}</span></button>`).join('')}</div>
    <div id="tl-body"></div></div>`;
  el.querySelector('#tl-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; renderTools(el); } };
  const body = el.querySelector('#tl-body');
  if (tab === 'tabela') renderTable(body); else if (tab === 'grafico') renderGraph(body); else renderTranslator(body);
}

function renderTable(body) {
  body.innerHTML = `<div class="panel pt-panel">
    <div class="row wrap"><input class="input pt-q" id="pt-q" placeholder="Buscar: nome, símbolo ou número (ex.: ferro, Na, 8)"><span class="muted small grow">Toque num elemento para ver os detalhes.</span></div>
    <div class="pt-scroll"><div class="pt-grid">${ELEMENTS.map(e => `<button class="pt-el ${sel && sel.z === e.z ? 'on' : ''}" data-z="${e.z}" style="grid-row:${e.row > 7 ? e.row + 0 : e.row};grid-column:${e.col};--c:${CATS[e.cat][1]}" title="${esc(e.name)}"><small>${e.z}</small><b>${e.sym}</b><span>${esc(e.name)}</span></button>`).join('')}
      <div class="pt-gap" style="grid-row:8;grid-column:1 / span 18"></div>
      <div class="pt-mark" style="grid-row:6;grid-column:3">57–71</div><div class="pt-mark" style="grid-row:7;grid-column:3">89–103</div></div></div>
    <div class="pt-legend">${Object.values(CATS).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>
    <div class="pt-info" id="pt-info">${sel ? infoHTML(sel) : '<p class="muted">Escolha um elemento.</p>'}</div></div>`;
  body.querySelector('.pt-grid').onclick = e => { const b = e.target.closest('[data-z]'); if (!b) return; sel = ELEMENTS[+b.dataset.z - 1]; renderTable(body); body.querySelector('#pt-info').scrollIntoView({ block: 'nearest' }); };
  body.querySelector('#pt-q').oninput = e => {
    const f = findElement(e.target.value);
    body.querySelectorAll('.pt-el').forEach(b => b.classList.toggle('on', !!f && +b.dataset.z === f.z));
    if (f) { sel = f; body.querySelector('#pt-info').innerHTML = infoHTML(f); }
  };
}
function infoHTML(e) {
  const nNeut = Math.round(e.mass) - e.z;
  return `<div class="pt-card" style="--c:${CATS[e.cat][1]}"><div class="pt-big"><small>${e.z}</small><b>${e.sym}</b><span>${e.massText}</span></div>
    <div class="grow"><h3>${esc(e.name)}</h3><p class="small">${CATS[e.cat][0]} · ${e.row > 7 ? (e.row === 9 ? 'série dos lantanídeos' : 'série dos actinídeos') : `família/grupo ${e.group}`} · ${e.period}º período</p>
      <p class="small">Prótons: <b>${e.z}</b> · Elétrons: <b>${e.z}</b> · Nêutrons (isótopo mais comum): <b>~${nNeut}</b></p>
      <p class="small">Massa atômica: <b>${e.massText} u</b>${e.synthetic ? ' (radioativo, sintético ou instável)' : ''}</p>
      <p class="small">Camadas (K, L, M…): <b>${shells(e.z).join(' · ')}</b></p>
      <p class="small">Distribuição eletrônica (diagrama de Linus Pauling): <b>${electronConfig(e.z)}</b></p></div></div>`;
}

function renderGraph(body) {
  body.innerHTML = `<div class="panel gr-panel">
    <div class="gr-fns">${fns.map((f, k) => `<label class="gr-fn"><i style="background:${COLORS[k]}"></i><span>y =</span><input class="input" data-k="${k}" value="${esc(f)}" placeholder="${['ex.: x^2 - 4', 'ex.: 2x + 1', 'ex.: sen(x)'][k]}" autocomplete="off" spellcheck="false"></label>`).join('')}</div>
    <p class="muted small">Use x, + − * / ^ e parênteses. Funções: raiz( ), sen( ), cos( ), tg( ), log( ), ln( ), abs( ). Ex.: <code>x^2 - 5x + 6</code>, <code>2(x+1)</code>, <code>raiz(x)</code>.</p>
    <div class="gr-canvas-box"><canvas id="gr-cv"></canvas></div>
    <div class="row wrap"><button class="btn small-btn" data-z="in">${ic('plus')}<span>Aproximar</span></button><button class="btn small-btn" data-z="out"><span>− Afastar</span></button><button class="btn small-btn" data-z="reset"><span>Centralizar</span></button>
      <span class="grow"></span><button class="btn primary small-btn" id="gr-note">${ic('page')}<span>Colar numa anotação</span></button></div>
    <div id="gr-info" class="small"></div></div>`;
  const cv = body.querySelector('#gr-cv');
  const redraw = () => {
    const list = [], info = [];
    fns.forEach((src, k) => {
      if (!src.trim()) { list.push(null); return; }
      try {
        const f = compile(src); list.push(f);
        const r = roots(f, view.x0, view.x1);
        info.push(`<span style="color:${COLORS[k]}">●</span> y = ${esc(src)}: ${r.length ? `corta o eixo x em ${r.map(x => (Math.round(x * 1000) / 1000).toLocaleString('pt-BR')).join(' e ')}` : 'não corta o eixo x nesta região'}; em x = 0, y = ${fmtN(f(0))}`);
      } catch (e) { list.push(null); info.push(`<span class="late">y = ${esc(src)}: ${esc(e.message)}</span>`); }
    });
    drawGraph(cv, list, view);
    body.querySelector('#gr-info').innerHTML = info.join('<br>');
  };
  body.querySelectorAll('.gr-fn input').forEach(inp => inp.oninput = () => { fns[+inp.dataset.k] = inp.value; redraw(); });
  body.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
    const z = b.dataset.z, cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2, k = z === 'in' ? 0.5 : 2;
    if (z === 'reset') view = { x0: -10, x1: 10, y0: -8, y1: 8 };
    else view = { x0: cx - ((view.x1 - view.x0) / 2) * k, x1: cx + ((view.x1 - view.x0) / 2) * k, y0: cy - ((view.y1 - view.y0) / 2) * k, y1: cy + ((view.y1 - view.y0) / 2) * k };
    redraw();
  });
  body.querySelector('#gr-note').onclick = async () => {
    const used = fns.filter(f => f.trim());
    if (!used.length) { toast('Escreva uma função primeiro'); return; }
    const src = cv.toDataURL('image/png');
    const title = `Gráfico: ${used.map(f => `y = ${f}`).join(' · ')}`.slice(0, 80);
    const w = PAGE_W - 120, hh = (w * cv.height) / cv.width;
    const meta = await A.createNoteWith(title, { id: uid(), strokes: [], images: [{ id: uid(), src, x: 60, y: 140, w, h: hh }],
      texts: [{ id: uid(), x: 60, y: 60, text: title, size: 30, color: '#1d1d1f', bold: true }, ...used.map((f, k) => ({ id: uid(), x: 60, y: 160 + hh + k * 40, text: `y = ${f}`, size: 26, color: COLORS[fns.indexOf(f)] }))] });
    if (meta) toast('Gráfico colado numa anotação nova ✓');
  };
  requestAnimationFrame(redraw);
}
const fmtN = v => (isFinite(v) ? (Math.round(v * 1000) / 1000).toLocaleString('pt-BR') : 'não existe');

const LANGS = { en: 'Inglês → Português', pt: 'Português → Inglês', es: 'Espanhol → Português' };
export function translatePrompt(text, from) {
  const dir = from === 'pt' ? 'do português para o inglês' : from === 'es' ? 'do espanhol para o português do Brasil' : 'do inglês para o português do Brasil';
  return `Traduza ${dir} o texto abaixo. Primeiro escreva só a tradução. Depois, numa seção "# Palavras importantes", liste até 6 palavras ou expressões do texto original com o significado e, se for verbo, o tempo verbal. Seja direto.\n\nTexto:\n${text}`;
}
function renderTranslator(body) {
  body.innerHTML = `<div class="panel tr-panel">
    <div class="seg" id="tr-dir">${Object.entries(LANGS).map(([k, v]) => `<button data-d="${k}" class="${tr.from === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <textarea class="input" id="tr-in" rows="4" placeholder="Escreva ou cole o texto (ex.: I have been studying for two hours)">${esc(tr.text)}</textarea>
    <div class="row"><button class="btn primary" id="tr-go">${ic('languages')}<span>Traduzir</span></button><span class="muted small grow">Usa a IA (precisa de internet). No caderno, selecione um texto com o laço e toque em “Traduzir”.</span></div>
    <div class="ai-out" id="tr-out" ${tr.out ? '' : 'hidden'}>${tr.out ? richText(cleanText(tr.out)) : ''}</div></div>`;
  body.querySelector('#tr-dir').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; tr.from = b.dataset.d; body.querySelectorAll('#tr-dir button').forEach(x => x.classList.toggle('active', x === b)); };
  body.querySelector('#tr-in').oninput = e => { tr.text = e.target.value; };
  body.querySelector('#tr-go').onclick = async ev => {
    const text = body.querySelector('#tr-in').value.trim();
    if (!text) { toast('Escreva o texto para traduzir'); return; }
    const out = body.querySelector('#tr-out');
    await translateInto(text, tr.from, out, ev.currentTarget);
    tr.out = out.dataset.raw || '';
  };
}
export async function translateInto(text, from, out, btn) {
  if (!aiConfigured()) { toast('Ligue a IA em Ajustes → Inteligência artificial'); return; }
  // só vale a tradução mais nova: a anterior é cancelada e o que ainda chegar dela é ignorado
  if (out._busy) { try { out._busy.abort(); } catch { /* */ } }
  const my = (out._req = (out._req || 0) + 1);
  out.hidden = false; out.innerHTML = '<div class="ai-typing"><i></i><i></i><i></i></div>';
  if (btn) btn.disabled = true;
  let txt = '';
  try {
    out._busy = streamChat([{ role: 'user', content: translatePrompt(text, from) }], t => { if (out._req !== my) return; txt += t; out.innerHTML = richText(cleanText(txt)); });
    await out._busy.done;
    if (out._req === my) out.dataset.raw = txt;
  } catch (e) { if (out._req === my && !e.aborted) out.innerHTML = `<span class="late">${esc(e.message)}</span>`; }
  finally { if (out._req === my) { out._busy = null; if (btn) btn.disabled = false; } }
}
// janela de tradução (usada pelo "Traduzir" da seleção no caderno)
export function translateDialog(text) {
  const from = /[ãõçáéíóúâêô]/i.test(text) && !/\b(the|and|is|are|you)\b/i.test(text) ? 'pt' : 'en';
  const body = h(`<div><p class="tr-src">${esc(text)}</p><div class="seg" id="trd-dir">${Object.entries(LANGS).map(([k, v]) => `<button data-d="${k}" class="${from === k ? 'active' : ''}">${v}</button>`).join('')}</div><div class="ai-out" id="trd-out"></div></div>`);
  import('./ui.js').then(({ modal }) => modal({ title: '🌎 Tradução', body, wide: true, actions: [{ label: 'Fechar', value: null }], onOpen: el => {
    // fechou a janela: para a tradução que ainda estiver chegando
    new MutationObserver((_, ob) => { if (!el.isConnected) { const o = body.querySelector('#trd-out'); if (o && o._busy) { try { o._busy.abort(); } catch { /* */ } } ob.disconnect(); } }).observe(document.body, { childList: true });
    const out = el.querySelector('#trd-out');
    translateInto(text, from, out);
    el.querySelector('#trd-dir').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; el.querySelectorAll('#trd-dir button').forEach(x => x.classList.toggle('active', x === b)); translateInto(text, b.dataset.d, out); };
  } }));
}
void PAGE_H;
