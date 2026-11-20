// Renderização de páginas, traços, textos e imagens + utilidades geométricas.
export const PAGE_W = 1000;
export const PAGE_H = 1414; // proporção A4
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

export const PAPER_COLORS = {
  white: { fill: '#ffffff', line: 'rgba(70,110,170,.22)', label: 'Branco' },
  cream: { fill: '#fbf5e6', line: 'rgba(140,110,60,.22)', label: 'Creme' },
  green: { fill: '#eef6ef', line: 'rgba(60,120,80,.22)', label: 'Verde claro' },
  dark:  { fill: '#22252b', line: 'rgba(255,255,255,.13)', label: 'Escuro' },
};
export const PAPER_TYPES = {
  lines: 'Pautado', grid: 'Quadriculado', smallgrid: 'Matemática', dots: 'Pontilhado', cornell: 'Cornell', blank: 'Liso',
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Papel ----------
export function drawPaper(ctx, bg) {
  const pc = PAPER_COLORS[bg?.color] || PAPER_COLORS.white;
  ctx.fillStyle = pc.fill;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.save();
  ctx.strokeStyle = pc.line;
  ctx.fillStyle = pc.line;
  ctx.lineWidth = 1.3;
  const step = 40;
  const type = bg?.type || 'lines';
  if (type === 'lines') {
    ctx.beginPath();
    for (let y = 120; y < PAGE_H - 30; y += step) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,80,80,.35)';
    ctx.beginPath(); ctx.moveTo(90, 0); ctx.lineTo(90, PAGE_H); ctx.stroke();
  } else if (type === 'grid') {
    ctx.beginPath();
    for (let y = step; y < PAGE_H; y += step) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    for (let x = step; x < PAGE_W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); }
    ctx.stroke();
  } else if (type === 'smallgrid') {
    for (let y = 20, i = 1; y < PAGE_H; y += 20, i++) {
      ctx.globalAlpha = i % 5 ? 0.45 : 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke();
    }
    for (let x = 20, i = 1; x < PAGE_W; x += 20, i++) {
      ctx.globalAlpha = i % 5 ? 0.45 : 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (type === 'cornell') {
    const top = 140, cue = 280, sum = PAGE_H - 280;
    ctx.beginPath();
    for (let y = top + 40; y < sum - 10; y += step) { ctx.moveTo(cue, y); ctx.lineTo(PAGE_W, y); }
    for (let y = sum + 80; y < PAGE_H - 20; y += step) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, top); ctx.lineTo(PAGE_W, top);
    ctx.moveTo(cue, top); ctx.lineTo(cue, sum);
    ctx.moveTo(0, sum); ctx.lineTo(PAGE_W, sum);
    ctx.stroke();
    ctx.font = `600 18px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText('Título / data', 20, 20);
    ctx.fillText('Palavras-chave', 20, top + 14);
    ctx.fillText('Anotações', cue + 20, top + 14);
    ctx.fillText('Resumo', 20, sum + 14);
  } else if (type === 'dots') {
    for (let y = step; y < PAGE_H; y += step)
      for (let x = step; x < PAGE_W; x += step) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

// ---------- Traços ----------
const patternCache = new Map();
function hexToRgb(hex) {
  let h = (hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function pencilPattern(ctx, color) {
  let p = patternCache.get(color);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  const [r, gg, b] = hexToRgb(color);
  // ruído determinístico para o grafite
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd();
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b;
    img.data[i + 3] = v < 0.18 ? 0 : Math.floor(120 + v * 135);
  }
  g.putImageData(img, 0, 0);
  p = ctx.createPattern(c, 'repeat');
  patternCache.set(color, p);
  return p;
}

export function penWidth(size, p) { return size * (0.35 + 0.95 * p); }

function smoothPath(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (n === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

export function drawStroke(ctx, s) {
  const pts = s.points, n = pts.length;
  if (!n) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool === 'marker') {
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    smoothPath(ctx, pts);
    ctx.stroke();
  } else if (s.tool === 'pencil') {
    let avg = 0; for (const p of pts) avg += p[2]; avg /= n;
    ctx.strokeStyle = pencilPattern(ctx, s.color);
    ctx.lineWidth = s.size * (0.6 + 0.5 * avg);
    smoothPath(ctx, pts);
    ctx.stroke();
  } else {
    ctx.strokeStyle = ctx.fillStyle = s.color;
    if (s.shape || n < 3) {
      ctx.lineWidth = s.shape ? s.size * 0.85 : penWidth(s.size, pts[0][2]);
      smoothPath(ctx, pts);
      ctx.stroke();
    } else {
      let sx = pts[0][0], sy = pts[0][1];
      for (let i = 1; i < n; i++) {
        const a = pts[i - 1], b = pts[i];
        const ex = (a[0] + b[0]) / 2, ey = (a[1] + b[1]) / 2;
        ctx.lineWidth = penWidth(s.size, (a[2] + b[2]) / 2);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(a[0], a[1], ex, ey);
        if (i === n - 1) ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        sx = ex; sy = ey;
      }
    }
  }
  ctx.restore();
}

export function strokeBBox(points, size = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const pad = size / 2;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

export function makeStroke(base, points) {
  const s = { ...base, points };
  s.bbox = strokeBBox(points, s.tool === 'pen' ? s.size * 1.3 : s.size);
  return s;
}

// ---------- Texto ----------
let measureCtx;
export function textFont(t) { return `${t.bold ? '700 ' : ''}${t.size}px ${FONT}`; }
export function textBBox(t) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = textFont(t);
  const lines = String(t.text).split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  return { x: t.x, y: t.y, w: Math.max(w, t.size * 0.5), h: lines.length * t.size * 1.25 };
}
export function drawText(ctx, t) {
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.font = textFont(t);
  ctx.textBaseline = 'top';
  String(t.text).split('\n').forEach((l, i) => ctx.fillText(l, t.x, t.y + i * t.size * 1.25));
  ctx.restore();
}

// ---------- Imagens ----------
const imgCache = new Map();
let onImgLoad = null;
export function setImageLoadHandler(fn) { onImgLoad = fn; }
function getImg(src) {
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => onImgLoad && onImgLoad();
    im.src = src;
    imgCache.set(src, im);
  }
  return im;
}
export function drawImageItem(ctx, it) {
  const im = getImg(it.src);
  if (im.complete && im.naturalWidth) ctx.drawImage(im, it.x, it.y, it.w, it.h);
  else { ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(it.x, it.y, it.w, it.h); }
}
export function loadPageImages(page) {
  return Promise.all((page.images || []).map(it => new Promise(res => {
    const im = getImg(it.src);
    if (im.complete) return res();
    im.addEventListener('load', res, { once: true });
    im.addEventListener('error', res, { once: true });
  })));
}

// ---------- Página ----------
export function renderPage(ctx, page, bg, skipIds) {
  drawPaper(ctx, bg);
  for (const it of page.images) if (!skipIds?.has(it.id)) drawImageItem(ctx, it);
  for (const s of page.strokes) if (s.tool === 'marker' && !skipIds?.has(s.id)) drawStroke(ctx, s);
  for (const s of page.strokes) if (s.tool !== 'marker' && !skipIds?.has(s.id)) drawStroke(ctx, s);
  for (const t of page.texts) if (!skipIds?.has(t.id)) drawText(ctx, t);
}

export function renderPageToCanvas(page, bg, width) {
  const c = document.createElement('canvas');
  const k = width / PAGE_W;
  c.width = Math.round(width);
  c.height = Math.round(PAGE_H * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  renderPage(ctx, page, bg);
  return c;
}

// ---------- Geometria ----------
export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
export function bboxHit(b, x, y, r = 0) {
  return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r;
}
export function strokeHit(s, x, y, r) {
  if (!bboxHit(s.bbox, x, y, r)) return false;
  const pts = s.points;
  const rr = r + (s.tool === 'marker' ? s.size / 2 : s.size / 2);
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= rr;
  for (let i = 1; i < pts.length; i++)
    if (distToSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rr) return true;
  return false;
}
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.ceil(d / step);
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
// Borracha parcial: devolve os pedaços que sobram de um traço (ou null se não foi tocado)
export function eraseFromStroke(s, x, y, r) {
  if (!strokeHit(s, x, y, r)) return null;
  const rr = r + s.size / 2;
  const pts = densify(s.points, Math.max(1.5, r / 3));
  const pieces = [];
  let cur = [];
  for (const p of pts) {
    if (Math.hypot(p[0] - x, p[1] - y) > rr) cur.push(p);
    else { if (cur.length > 1) pieces.push(cur); cur = []; }
  }
  if (cur.length > 1) pieces.push(cur);
  const { bbox, ...base } = s;
  return pieces.map(pp => makeStroke({ ...base, id: uid() }, pp));
}
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function unionBBox(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function itemBBox(kind, it) {
  if (kind === 'strokes') return it.bbox;
  if (kind === 'texts') return textBBox(it);
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}
export function transformItem(kind, it, k, ox, oy, dx, dy) {
  // escala k em torno de (ox,oy) e translada (dx,dy)
  const tx = v => ox + (v - ox) * k + dx;
  const ty = v => oy + (v - oy) * k + dy;
  if (kind === 'strokes') {
    const { bbox, ...base } = it;
    return makeStroke({ ...base, size: it.size * k }, it.points.map(p => [tx(p[0]), ty(p[1]), p[2]]));
  }
  if (kind === 'texts') return { ...it, x: tx(it.x), y: ty(it.y), size: Math.max(6, it.size * k) };
  return { ...it, x: tx(it.x), y: ty(it.y), w: it.w * k, h: it.h * k };
}

// ---------- Diagramação de textos longos (respostas da IA) ----------
export const LINE0 = 120, LINE_STEP = 40;
const MARGIN_L = 110, MARGIN_R = 50, BOTTOM = PAGE_H - 50;

function wrapLine(text, size, bold, maxW) {
  const words = text.split(/(\s+)/);
  const out = [];
  let cur = '';
  for (const w of words) {
    const test = cur + w;
    if (cur.trim() && textBBox({ text: test, size, bold, x: 0, y: 0 }).w > maxW) {
      out.push(cur.trimEnd());
      cur = w.trimStart();
      // palavra maior que a linha: quebra à força
      while (textBBox({ text: cur, size, bold, x: 0, y: 0 }).w > maxW && cur.length > 1) {
        let n = cur.length - 1;
        while (n > 1 && textBBox({ text: cur.slice(0, n), size, bold, x: 0, y: 0 }).w > maxW) n--;
        out.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    } else cur = test;
  }
  if (cur.trim() || !out.length) out.push(cur.trimEnd());
  return out;
}

// Linha pautada livre abaixo do conteúdo existente na página
export function nextFreeLine(page) {
  let bottom = 0;
  for (const s of page.strokes) bottom = Math.max(bottom, s.bbox.y + s.bbox.h);
  for (const t of page.texts) { const b = textBBox(t); bottom = Math.max(bottom, b.y + b.h); }
  for (const i of page.images) if (!i.locked) bottom = Math.max(bottom, i.y + i.h);
  if (!bottom) return LINE0;
  let y = LINE0;
  while (y < bottom + 30) y += LINE_STEP;
  return y;
}

// Divide o texto em linhas posicionadas nas pautas. Retorna [[textos da 1ª página], [2ª], ...]
export function layoutText(text, { startY = LINE0, color = '#1d1d1f', accent = '#0a6cff' } = {}) {
  const pages = [[]];
  let y = startY;
  const maxW = PAGE_W - MARGIN_L - MARGIN_R;
  const put = (txt, x, size, bold, col) => {
    if (y > BOTTOM) { pages.push([]); y = LINE0; }
    pages[pages.length - 1].push({ id: uid(), x, y: y - size * 0.95, text: txt, size, bold, color: col });
    y += LINE_STEP;
  };
  let prevBlank = true;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { if (!prevBlank) y += LINE_STEP / 2; prevBlank = true; continue; }
    prevBlank = false;
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) {
      if (y !== LINE0 && y !== startY) y = Math.ceil((y - LINE0) / LINE_STEP) * LINE_STEP + LINE0;
      for (const l of wrapLine(h[1], 28, true, maxW)) put(l, MARGIN_L, 28, true, accent);
      continue;
    }
    if (y !== LINE0) y = Math.ceil((y - LINE0) / LINE_STEP) * LINE_STEP + LINE0;
    const b = line.match(/^(\s*)([-•*]|\d+[.)]|[a-e]\))\s+(.*)$/);
    if (b) {
      const indent = Math.min(2, Math.floor(b[1].length / 2)) * 30;
      const bullet = /^[-•*]$/.test(b[2]) ? '•' : b[2];
      const lead = bullet + ' ';
      const leadW = textBBox({ text: lead, size: 24, x: 0, y: 0 }).w;
      wrapLine(b[3], 24, false, maxW - indent - leadW).forEach((l, i) =>
        put(i ? l : lead + l, MARGIN_L + indent + (i ? leadW : 0), 24, false, color));
      continue;
    }
    for (const l of wrapLine(line.trim(), 24, false, maxW)) put(l, MARGIN_L, 24, false, color);
  }
  return pages.filter((p, i) => p.length || i === 0);
}
