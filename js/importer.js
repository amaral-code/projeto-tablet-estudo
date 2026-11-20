// Importa PDFs (listas de exercícios, apostilas, provas) e fotos como páginas para anotar por cima.
let pdfjsP = null;
function loadPdfJs() {
  if (!pdfjsP) {
    pdfjsP = import('./vendor/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsP;
}

export const MAX_IMPORT_PAGES = 60;

export async function pdfToImages(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const total = doc.numPages;
  const n = Math.min(total, MAX_IMPORT_PAGES);
  const out = [];
  for (let i = 1; i <= n; i++) {
    onProgress && onProgress(i, n);
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 1500 / Math.max(vp1.width, vp1.height * 0.75);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
    out.push({ src: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
    page.cleanup();
  }
  await task.destroy();
  return { images: out, total };
}

export async function imageFileToPage(file) {
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height };
}

// Lê vários arquivos (PDF e/ou imagens) e devolve as páginas
export async function filesToPages(files, onProgress) {
  const pages = [];
  let skipped = 0;
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const r = await pdfToImages(f, (i, n) => onProgress && onProgress(`${f.name}: página ${i} de ${n}`));
      pages.push(...r.images);
      if (r.total > r.images.length) skipped += r.total - r.images.length;
    } else if (f.type.startsWith('image/')) {
      onProgress && onProgress(f.name);
      pages.push(await imageFileToPage(f));
    }
  }
  return { pages, skipped };
}
