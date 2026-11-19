// Reconhecimento de escrita à mão (letras e números) e correção de contas.
// Usa o serviço de reconhecimento de escrita do Google Input Tools (precisa de internet).

const ENDPOINT = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';

export const LANGS = {
  pt_BR: 'Português (Brasil)',
  pt_PT: 'Português (Portugal)',
  en: 'Inglês',
  es: 'Espanhol',
  fr: 'Francês',
  it: 'Italiano',
  de: 'Alemão',
};

// Agrupa traços em linhas de escrita
export function groupLines(strokes) {
  const items = strokes
    .filter(s => s.tool !== 'marker' && s.points.length)
    .map((s, order) => ({ s, order, b: s.bbox, cy: s.bbox.y + s.bbox.h / 2 }));
  // traços maiores primeiro definem as linhas
  const sorted = [...items].sort((a, b) => b.b.h - a.b.h);
  const lines = [];
  for (const it of sorted) {
    let best = null, bestScore = Infinity;
    for (const L of lines) {
      const top = L.y0 - L.h * 0.35, bot = L.y1 + L.h * 0.35;
      if (it.cy >= top && it.cy <= bot) {
        const sc = Math.abs(it.cy - (L.y0 + L.y1) / 2);
        if (sc < bestScore) { bestScore = sc; best = L; }
      }
    }
    if (best) {
      best.items.push(it);
      // traços pequenos (pontos, acentos) não esticam a linha
      if (it.b.h > best.h * 0.4) {
        best.y0 = Math.min(best.y0, it.b.y); best.y1 = Math.max(best.y1, it.b.y + it.b.h);
        best.h = best.y1 - best.y0;
      }
    } else {
      lines.push({ items: [it], y0: it.b.y, y1: it.b.y + it.b.h, h: Math.max(it.b.h, 10) });
    }
  }
  return lines
    .map(L => {
      L.items.sort((a, b) => a.order - b.order);
      const strokes = L.items.map(i => i.s);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of strokes) for (const p of s.points) {
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
      }
      return { strokes, x: x0, y: y0, w: x1 - x0, h: Math.max(y1 - y0, 12) };
    })
    .sort((a, b) => a.y - b.y);
}

export async function recognizeStrokes(strokes, lang = 'pt_BR') {
  if (!navigator.onLine) throw new Error('offline');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.points) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  let t = 0;
  const ink = strokes.map(s => {
    const xs = [], ys = [], ts = [];
    for (const p of s.points) {
      xs.push(Math.round(p[0] - x0)); ys.push(Math.round(p[1] - y0)); ts.push(t); t += 12;
    }
    t += 150;
    return [xs, ys, ts];
  });
  const body = {
    options: 'enable_pre_space',
    requests: [{
      writing_guide: { writing_area_width: Math.round(x1 - x0 + 40), writing_area_height: Math.round(y1 - y0 + 40) },
      ink, language: lang,
    }],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j[0] !== 'SUCCESS') throw new Error('falha');
    const cands = (j[1] && j[1][0] && j[1][0][1]) || [];
    return cands.map(c => c.trim()).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Matemática ----------------
// Normaliza texto reconhecido em expressão: 3x4 → 3*4, 10:2 → 10/2, 2,5 → 2.5
export function normalizeMath(txt) {
  let s = String(txt).trim();
  s = s.replace(/[−–—]/g, '-').replace(/[×✕✖·•∙]/g, '*').replace(/[÷]/g, '/')
       .replace(/\s+/g, '');
  // letras parecidas com números
  s = s.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/[sS]/g, '5').replace(/[zZ]/g, '2')
       .replace(/[bG]/g, '6').replace(/[gq]/g, '9').replace(/[B]/g, '8').replace(/[T]/g, '7');
  s = s.replace(/(\d|\))[xX](?=[\d(])/g, '$1*').replace(/(\d|\)):(?=[\d(])/g, '$1/');
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/√/g, 'r');
  return s;
}

function parseExpr(src) {
  let i = 0;
  const peek = () => src[i];
  const eat = c => (src[i] === c ? (i++, true) : false);
  function num() {
    const st = i;
    while (/[0-9.]/.test(src[i] || '')) i++;
    if (st === i) throw new Error('num');
    const v = parseFloat(src.slice(st, i));
    if (isNaN(v)) throw new Error('num');
    return v;
  }
  function atom() {
    if (eat('-')) return -atom();
    if (eat('+')) return atom();
    if (eat('r')) return Math.sqrt(atom());
    let v;
    if (eat('(')) { v = add(); if (!eat(')')) throw new Error(')'); }
    else v = num();
    if (eat('%')) v = v / 100;
    return v;
  }
  function pow() { let v = atom(); if (eat('^')) v = Math.pow(v, pow()); return v; }
  function mul() {
    let v = pow();
    for (;;) {
      if (eat('*')) v *= pow();
      else if (eat('/')) v /= pow();
      else if (peek() === '(') v *= pow();
      else return v;
    }
  }
  function add() {
    let v = mul();
    for (;;) {
      if (eat('+')) v += mul();
      else if (eat('-')) v -= mul();
      else return v;
    }
  }
  const v = add();
  if (i !== src.length) throw new Error('resto');
  return v;
}

export function fmtNum(v) {
  if (!isFinite(v)) return '∞';
  const r = Math.round(v * 1e6) / 1e6;
  return String(r).replace('.', ',');
}

// Avalia candidatos; devolve {expr, ok, value, answer, hasAnswer} ou null
export function checkMath(candidates) {
  for (const c of candidates) {
    const s = normalizeMath(c);
    if (!/\d/.test(s) || !/[-+*/^r=%]/.test(s)) continue;
    const parts = s.split('=');
    try {
      if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) {
        const v = parseExpr(parts[0]);
        return { text: c, ok: null, value: v, hasAnswer: false };
      }
      const vals = parts.map(parseExpr);
      const ok = vals.every(v => Math.abs(v - vals[0]) <= 1e-6 * Math.max(1, Math.abs(vals[0])));
      return { text: c, ok, value: vals[0], answer: vals[vals.length - 1], hasAnswer: true };
    } catch { /* tenta o próximo candidato */ }
  }
  return null;
}
