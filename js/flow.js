// Escrita organizada: o que você escreve em qualquer lugar da folha vira texto (em fonte manuscrita)
// emendado no fim da linha. Cada ponto final fecha o parágrafo: o próximo texto começa na linha de baixo,
// com o recuo de parágrafo escolhido no menu. Se a folha encher, o texto continua na página seguinte.
//
// Os textos organizados são textos normais da página com { flow: true, para, ord }: assim dá para
// editar, apagar ou mover pelo laço, e a organização é refeita a partir do que sobrou.
import { uid, textWidth, baselineOffset, LINE0, LINE_STEP, PAGE_W, PAGE_H, MARGIN_L, MARGIN_R, BOTTOM } from './ink.js';

export const FLOW_SIZES = { 24: 'Pequena', 30: 'Média', 36: 'Grande', 44: 'Muito grande', 60: 'Enorme' };
// letras muito grandes (Muito grande e Enorme) ocupam duas pautas, para não atravessar a linha de cima
export const lineStepFor = size => (size >= 40 ? LINE_STEP * 2 : LINE_STEP);
export const FLOW_INDENTS = { 0: 'Sem recuo', 40: 'Pequeno', 80: 'Médio', 130: 'Grande' };
const END = /\.["'”’)]*$/; // ponto final (também ". " seguido de aspas/parênteses)

const isFlow = t => t && t.flow;

// Onde ficam as pautas em cada tipo de folha (no Cornell, o texto vai para a coluna "Anotações")
export function paperGeom(bg) {
  if (bg && bg.type === 'cornell') return { left: 300, first: 220, bottom: PAGE_H - 280 - 10 };
  return { left: MARGIN_L, first: LINE0, bottom: BOTTOM };
}
// Encaixa uma altura na próxima pauta da folha
export const snapLine = (y, g) => Math.max(g.first, g.first + Math.ceil((y - g.first) / LINE_STEP) * LINE_STEP);
const sortItems = (a, b) => a.para - b.para || a.ord - b.ord;

// Separa em frases: cada frase que termina com ponto fecha um parágrafo
export function sentences(text) {
  return String(text).replace(/\s+/g, ' ').trim().split(/(?<=\.["'”’)]*)\s+/).filter(Boolean);
}
export const closes = text => END.test(String(text).trim());

// Lê os parágrafos já organizados de um grupo de páginas (o texto pode continuar de uma página na outra)
export function readParas(pages) {
  const byPara = new Map();
  for (const pg of pages) for (const t of pg.texts.filter(isFlow).sort(sortItems)) {
    if (!String(t.text).trim()) continue;
    if (!byPara.has(t.para)) byPara.set(t.para, []);
    const runs = byPara.get(t.para);
    const last = runs[runs.length - 1];
    if (last && last.color === t.color && last.font === t.font) last.text += ' ' + t.text.trim();
    else runs.push({ text: t.text.trim(), color: t.color, font: t.font });
  }
  return [...byPara.keys()].sort((a, b) => a - b).map(k => ({ runs: byPara.get(k) }));
}

// Acrescenta um texto reconhecido: emenda no parágrafo aberto ou abre um novo depois de um ponto final
export function appendText(paras, text, color, font) {
  for (const s of sentences(text)) {
    let p = paras[paras.length - 1];
    const lastRun = p && p.runs[p.runs.length - 1];
    if (!p || !lastRun || closes(lastRun.text)) { p = { runs: [] }; paras.push(p); }
    const r = p.runs[p.runs.length - 1];
    if (r && r.color === color && r.font === font) r.text += ' ' + s; else p.runs.push({ text: s, color, font });
  }
  return paras;
}

// Diagrama os parágrafos a partir da pauta startY. Devolve os textos da página e o que não coube.
// cont = o primeiro parágrafo continua da página anterior (sem recuo).
// Cada trecho pode ter a sua fonte (ex.: "igual à minha letra"); sem fonte, usa a do menu.
export function layoutFlow(paras, { font, size, indent, startY = LINE0, firstPara = 0, cont = false, geom = paperGeom() }) {
  const maxX = PAGE_W - MARGIN_R, LEFT = geom.left, BOTTOM = geom.bottom, STEP = lineStepFor(size);
  const items = [];
  let lineY = startY, ord = 0;
  const flush = (line, para) => {
    // palavras seguidas da mesma cor e fonte viram um texto só; a letra "senta" na pauta (encostada na linha)
    let cur = null;
    for (const w of line) {
      if (cur && cur.color === w.color && cur.font === w.font) cur.text += ' ' + w.w;
      else { cur = { id: uid(), x: w.x, y: lineY - baselineOffset(w.font, size) - 1, text: w.w, size, color: w.color, font: w.font, flow: true, para, ord: ord++ }; items.push(cur); }
    }
  };
  const toRuns = ws => { const out = []; for (const w of ws) { const r = out[out.length - 1]; if (r && r.color === w.color && r.font === w.font) r.text += ' ' + w.w; else out.push({ text: w.w, color: w.color, font: w.font }); } return out; };
  for (let p = 0; p < paras.length; p++) {
    const words = paras[p].runs.flatMap(r => r.text.split(/\s+/).filter(Boolean).map(w => ({ w, color: r.color, font: (r.font || font) || undefined })));
    if (!words.length) continue;
    if (lineY > BOTTOM) return { items, overflow: paras.slice(p), overflowFirstPara: firstPara + p, cont: false };
    let x = LEFT + (p === 0 && cont ? 0 : indent);
    let line = [];
    for (let i = 0; i < words.length; i++) {
      const ww = textWidth(words[i].w, size, words[i].font);
      if (line.length && x + ww > maxX) {
        flush(line, firstPara + p);
        line = []; lineY += STEP; x = LEFT;
        // a folha encheu no meio do parágrafo: o resto continua na próxima página
        if (lineY > BOTTOM) return { items, overflow: [{ runs: toRuns(words.slice(i)) }, ...paras.slice(p + 1)], overflowFirstPara: firstPara + p, cont: true };
      }
      line.push({ ...words[i], x });
      x += ww + textWidth(' ', size, words[i].font);
    }
    flush(line, firstPara + p);
    lineY += STEP;
  }
  return { items, overflow: null };
}

// Páginas ligadas pelo texto organizado (a anterior "encheu" e continuou nesta)
export function chainOf(pages, idx) {
  let s = idx;
  while (s > 0 && pages[s - 1].flowFull && pages[s].texts.some(isFlow)) s--;
  let e = idx;
  while (pages[e].flowFull && pages[e + 1]) e++;
  return { s, e };
}

// Refaz a diagramação do grupo de páginas a partir de s, criando páginas novas se precisar.
// Devolve o índice da última página usada.
export function relayout(pages, s, paras, opts, { newPage, startYFor }) {
  let k = s, rest = paras, first = 0, cont = false, last = s;
  const oldEnd = chainOf(pages, s).e;
  while (rest && rest.length) {
    if (!pages[k]) pages.splice(k, 0, newPage());
    const pg = pages[k];
    pg.texts = pg.texts.filter(t => !isFlow(t));
    if (pg.flowY == null) pg.flowY = startYFor(pg, k === s);
    const r = layoutFlow(rest, { ...opts, startY: pg.flowY, firstPara: first, cont });
    pg.texts.push(...r.items);
    last = k;
    if (r.overflow) {
      pg.flowFull = true;
      rest = r.overflow; first = r.overflowFirstPara; cont = r.cont;
      k++;
      // a página seguinte recebe a continuação no alto, se ainda não tinha texto organizado
      if (pages[k] && pages[k].flowY == null && !pages[k].texts.some(isFlow)) pages[k].flowY = startYFor(pages[k], false);
    } else { pg.flowFull = false; rest = null; }
  }
  // o texto encolheu: limpa as páginas do grupo que sobraram
  for (let j = last + 1; j <= oldEnd && pages[j]; j++) { pages[j].texts = pages[j].texts.filter(t => !isFlow(t)); pages[j].flowFull = false; }
  return last;
}
