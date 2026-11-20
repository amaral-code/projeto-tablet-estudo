// Exportação em PNG/PDF e compartilhamento (WhatsApp, e-mail, Drive, etc.)
import { renderPageToCanvas, loadPageImages, loadHandFonts } from './ink.js';

const canvasToBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));

export function safeName(s) {
  return (String(s || 'atividade').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'atividade').slice(0, 60);
}

export async function pageToPNG(page, bg, title) {
  await loadHandFonts();
  await loadPageImages(page);
  const c = renderPageToCanvas(page, bg, 1600);
  const blob = await canvasToBlob(c, 'image/png');
  return new File([blob], `${safeName(title)}.png`, { type: 'image/png' });
}

// Gerador de PDF minimalista: cada página vira uma imagem JPEG em A4.
export async function pagesToPDF(pages, bg, title) {
  await loadHandFonts();
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const offsets = [];
  const push = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); offset += u.length; };
  const W = 595.28, H = 841.89;
  const n = pages.length;
  // objetos: 1 catálogo, 2 páginas, depois para cada página: page, content, image
  const pageObj = i => 3 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (num, body) => { offsets[num] = offset; push(`${num} 0 obj\n`); body(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`));
  for (let i = 0; i < n; i++) {
    await loadPageImages(pages[i]);
    const c = renderPageToCanvas(pages[i], pages[i]._bg || bg, 1400);
    const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer());
    const p = pageObj(i);
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(p + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(p + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      push(jpg);
      push('\nendstream');
    });
  }
  const total = 3 + n * 3;
  const xref = offset;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new File(parts, `${safeName(title)}.pdf`, { type: 'application/pdf' });
}

export function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Retorna 'shared' | 'downloaded' | 'cancelled' | 'needs-gesture'
export async function shareFile(file, title, text) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      if (e.name === 'NotAllowedError') return 'needs-gesture';
    }
  }
  download(file);
  return 'downloaded';
}

export async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}
