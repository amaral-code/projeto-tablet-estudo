// Modelos de página e mapa mental: geram traços e textos comuns (dá para apagar, mover e escrever por cima).
import { uid, makeStroke, textWidth, PAGE_W, PAGE_H } from './ink.js';

const INK = '#1d1d1f', SOFT = '#9aa3b2', ACC = '#2563eb';
const BRANCH = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
const now = () => Date.now();
const P = (x, y) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.5];
export const line = (x1, y1, x2, y2, color = INK, size = 2.5) => makeStroke({ id: uid(), tool: 'pen', color, size, shape: true, at: now() }, [P(x1, y1), P(x2, y2)]);
export function rect(x, y, w, h, color = INK, size = 2.5, r = 14) {
  const pts = [], k = 6;
  const arc = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (Math.PI / 2) * (i / k); pts.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } };
  arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
  pts.push(pts[0]);
  return makeStroke({ id: uid(), tool: 'pen', color, size, shape: true, at: now() }, pts);
}
export function ellipse(cx, cy, rx, ry, color = INK, size = 3) {
  const pts = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(P(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)); }
  return makeStroke({ id: uid(), tool: 'pen', color, size, shape: true, at: now() }, pts);
}
export const text = (x, y, t, size = 24, color = INK, extra = {}) => ({ id: uid(), x: Math.round(x), y: Math.round(y), text: t, size, color, at: now(), ...extra });
// quebra um rótulo em linhas de até n letras
export function wrap(t, n = 20) {
  const out = []; let cur = '';
  for (const w of String(t).split(/\s+/)) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out.slice(0, 3).join('\n');
}
const blockW = (t, size, font) => Math.max(...String(t).split('\n').map(l => textWidth(l, size, font)));

// ---------- Modelos ----------
export const TEMPLATES = {
  resumo: { name: 'Resumo', emoji: '📝', desc: 'Título, ideias principais, conceitos e "Para lembrar"' },
  exercicios: { name: 'Lista de exercícios', emoji: '✏️', desc: 'Questões numeradas com espaço para resolver' },
  semana: { name: 'Cronograma da semana', emoji: '🗓️', desc: 'Um quadro para cada dia da semana' },
  linha: { name: 'Linha do tempo', emoji: '⏳', desc: 'Para história: datas e acontecimentos em ordem' },
  mapa: { name: 'Mapa mental', emoji: '🧠', desc: 'Tema no centro e 6 ramos para preencher' },
  grafico: { name: 'Plano cartesiano', emoji: '📈', desc: 'Eixos x e y com números, para gráficos e funções' },
};
export function buildTemplate(kind) {
  const strokes = [], texts = [];
  const L = 90, R = PAGE_W - 60;
  if (kind === 'resumo') {
    texts.push(text(L, 50, 'Título:', 30, ACC, { bold: true })); strokes.push(line(L + 110, 88, R, 88, SOFT));
    texts.push(text(L, 140, 'Ideias principais', 24, ACC, { bold: true })); for (let y = 220; y <= 540; y += 64) strokes.push(line(L, y, R, y, SOFT, 1.5));
    texts.push(text(L, 580, 'Conceitos e fórmulas', 24, ACC, { bold: true })); for (let y = 660; y <= 920; y += 64) strokes.push(line(L, y, R, y, SOFT, 1.5));
    strokes.push(rect(L - 10, 980, R - L + 20, 360, '#f59e0b', 3)); texts.push(text(L + 10, 995, '⭐ Para lembrar', 24, '#b45309', { bold: true }));
  } else if (kind === 'exercicios') {
    texts.push(text(L, 50, 'Lista de exercícios', 30, ACC, { bold: true })); texts.push(text(R - 260, 60, 'Data: ___/___', 22, SOFT));
    for (let i = 0; i < 6; i++) { const y = 130 + i * 210; texts.push(text(L, y, `${i + 1})`, 26, ACC, { bold: true })); strokes.push(line(L, y + 200, R, y + 200, SOFT, 1.2)); }
  } else if (kind === 'semana') {
    texts.push(text(L, 40, 'Minha semana', 30, ACC, { bold: true }));
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'], top = 110, hh = (PAGE_H - top - 50) / 7;
    days.forEach((d, i) => { const y = top + i * hh; strokes.push(rect(L - 30, y, R - L + 30, hh - 14, BRANCH[i], 2.5, 12)); texts.push(text(L - 14, y + 10, d, 22, BRANCH[i], { bold: true })); });
  } else if (kind === 'linha') {
    texts.push(text(L, 40, 'Linha do tempo', 30, ACC, { bold: true }));
    const x = PAGE_W / 2; strokes.push(line(x, 120, x, PAGE_H - 60, INK, 4));
    for (let i = 0; i < 8; i++) { const y = 170 + i * 150; strokes.push(line(x - 16, y, x + 16, y, INK, 4)); texts.push(text(i % 2 ? x + 30 : x - 230, y - 16, '____ : ', 22, SOFT)); }
  } else if (kind === 'mapa') {
    return mindMapPage({ centro: 'Tema', ramos: Array.from({ length: 6 }, () => ({ titulo: '…', itens: [] })) });
  } else if (kind === 'grafico') {
    const cx = PAGE_W / 2, cy = PAGE_H / 2, u = 40, nx = 11, ny = 15;
    for (let i = -nx; i <= nx; i++) strokes.push(line(cx + i * u, cy - ny * u, cx + i * u, cy + ny * u, '#dbe4f3', 1));
    for (let j = -ny; j <= ny; j++) strokes.push(line(cx - nx * u, cy + j * u, cx + nx * u, cy + j * u, '#dbe4f3', 1));
    strokes.push(line(cx - nx * u, cy, cx + nx * u, cy, INK, 3)); strokes.push(line(cx, cy - ny * u, cx, cy + ny * u, INK, 3));
    for (let i = -10; i <= 10; i += 2) if (i) texts.push(text(cx + i * u - 8, cy + 8, String(i), 14, '#64748b'));
    for (let j = -14; j <= 14; j += 2) if (j) texts.push(text(cx + 8, cy - j * u - 9, String(j), 14, '#64748b'));
    texts.push(text(cx + nx * u - 20, cy - 34, 'x', 24, INK, { bold: true })); texts.push(text(cx + 12, cy - ny * u, 'y', 24, INK, { bold: true }));
  }
  return { strokes, texts };
}

// ---------- Mapa mental (da IA ou vazio) ----------
export function parseMindMap(raw) {
  const t = String(raw).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    const centro = String(o.centro || o.tema || o.center || '').trim();
    const ramos = (o.ramos || o.branches || []).map(r => ({ titulo: String(r.titulo || r.title || r.nome || '').trim(), itens: (r.itens || r.items || r.filhos || []).map(x => String(x).trim()).filter(Boolean).slice(0, 4) })).filter(r => r.titulo).slice(0, 8);
    return centro && ramos.length >= 2 ? { centro, ramos } : null;
  } catch { return null; }
}
export function mindMapPage(tree, font = 'patrick') {
  const strokes = [], texts = [];
  const cx = PAGE_W / 2, cy = PAGE_H / 2;
  const ct = wrap(tree.centro, 16), cs = 30;
  const cw = blockW(ct, cs, font), chh = ct.split('\n').length * cs * 1.25;
  strokes.push(ellipse(cx, cy, cw / 2 + 40, chh / 2 + 30, ACC, 4));
  texts.push(text(cx - cw / 2, cy - chh / 2, ct, cs, INK, { font, bold: false }));
  const n = tree.ramos.length;
  tree.ramos.forEach((r, i) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2, color = BRANCH[i % BRANCH.length];
    const R1 = 300;
    const bx = cx + Math.cos(ang) * R1 * 1.05, by = cy + Math.sin(ang) * R1 * 1.25;
    const bt = wrap(r.titulo, 18), bs = 24, bw = blockW(bt, bs, font), bh = bt.split('\n').length * bs * 1.25;
    const x0 = Math.max(20, Math.min(PAGE_W - bw - 40, bx - bw / 2)), y0 = Math.max(20, Math.min(PAGE_H - bh - 40, by - bh / 2));
    strokes.push(line(cx + Math.cos(ang) * (cw / 2 + 40), cy + Math.sin(ang) * (chh / 2 + 30), x0 + bw / 2, y0 + bh / 2, color, 3));
    strokes.push(rect(x0 - 14, y0 - 10, bw + 28, bh + 20, color, 3, 12));
    texts.push(text(x0, y0, bt, bs, color, { font, bold: false }));
    // itens do ramo, mais para fora
    r.itens.forEach((it, k) => {
      const spread = (k - (r.itens.length - 1) / 2) * 0.32;
      const a2 = ang + spread, R2 = 520;
      const t2 = wrap(it, 20), s2 = 18, w2 = blockW(t2, s2, font), h2 = t2.split('\n').length * s2 * 1.25;
      const ix = Math.max(16, Math.min(PAGE_W - w2 - 16, cx + Math.cos(a2) * R2 * 0.92 - w2 / 2)), iy = Math.max(16, Math.min(PAGE_H - h2 - 16, cy + Math.sin(a2) * R2 * 1.22 - h2 / 2));
      strokes.push(line(x0 + bw / 2, y0 + bh / 2 + (iy > y0 ? bh / 2 + 10 : -bh / 2 - 10), ix + w2 / 2, iy + (iy > y0 ? -6 : h2 + 6), color, 1.8));
      texts.push(text(ix, iy, t2, s2, INK, { font }));
    });
  });
  return { strokes, texts };
}
export const MINDMAP_PROMPT = `Faça um mapa mental do conteúdo destas anotações para eu estudar.
Responda APENAS com JSON válido, sem texto antes ou depois e sem blocos de código, neste formato:
{"centro":"tema principal (até 4 palavras)","ramos":[{"titulo":"ideia (até 4 palavras)","itens":["detalhe curto","detalhe curto"]}]}
Use de 4 a 7 ramos e de 1 a 3 itens por ramo, com no máximo 6 palavras cada. Escreva em português do Brasil.`;
