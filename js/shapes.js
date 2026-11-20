// Correção de formas: segure a caneta parada ao final do traço para transformar
// rabiscos em linha reta, círculo/elipse, triângulo, retângulo ou polígono.

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function lerpPoly(vertices, closed) {
  const out = [];
  const vs = closed ? [...vertices, vertices[0]] : vertices;
  for (let i = 1; i < vs.length; i++) {
    const a = vs[i - 1], b = vs[i];
    const n = Math.max(2, Math.ceil(d(a, b) / 12));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const t = j / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.5]);
    }
  }
  return out;
}

export function snapShape(points) {
  if (points.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
  points.forEach((p, i) => {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    if (i) len += d(p, points[i - 1]);
  });
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 25) return null;
  const start = points[0], end = points[points.length - 1];
  const closed = d(start, end) < Math.max(0.2 * len, 0.25 * diag) && len > diag * 1.6;

  if (!closed) {
    const simp = rdp(points, diag * 0.07);
    if (simp.length === 2) {
      let a = start, b = end;
      // ajusta ao horizontal/vertical quando quase alinhado
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const deg = Math.abs((ang * 180) / Math.PI) % 90;
      if (deg < 6 || deg > 84) {
        if (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])) b = [b[0], a[1]];
        else b = [a[0], b[1]];
      }
      return { kind: 'linha', points: lerpPoly([a, b], false) };
    }
    if (simp.length === 3) return { kind: 'ângulo', points: lerpPoly(simp, false) };
    return null;
  }

  // Elipse?
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = w / 2, ry = h / 2;
  if (rx > 5 && ry > 5) {
    let sum = 0, sum2 = 0;
    for (const p of points) {
      const r = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1;
      sum += r; sum2 += r * r;
    }
    const mean = sum / points.length;
    const sd = Math.sqrt(sum2 / points.length - mean * mean);
    if (sd < 0.09 && Math.abs(mean) < 0.12) {
      let RX = rx, RY = ry;
      if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) RX = RY = (rx + ry) / 2;
      const out = [];
      for (let i = 0; i <= 72; i++) {
        const t = (i / 72) * Math.PI * 2;
        out.push([cx + RX * Math.cos(t), cy + RY * Math.sin(t), 0.5]);
      }
      return { kind: RX === RY ? 'círculo' : 'elipse', points: out };
    }
  }

  // Polígono
  let simp = rdp([...points, start], diag * 0.09);
  simp = simp.slice(0, -1);
  // remove vértice final duplicado próximo ao inicial
  if (simp.length > 2 && d(simp[simp.length - 1], simp[0]) < diag * 0.12) simp.pop();
  if (simp.length === 3) return { kind: 'triângulo', points: lerpPoly(simp, true) };
  if (simp.length === 4) {
    // quase retângulo alinhado?
    const axis = simp.every((p, i) => {
      const q = simp[(i + 1) % 4];
      const deg = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 90;
      return deg < 15 || deg > 75;
    });
    if (axis) return { kind: 'retângulo', points: lerpPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true) };
    return { kind: 'quadrilátero', points: lerpPoly(simp, true) };
  }
  if (simp.length >= 5 && simp.length <= 8) return { kind: 'polígono', points: lerpPoly(simp, true) };
  return null;
}
