// Botão "Imagem": você escreve o que quer ("Bhaskara", "Pedro Álvares Cabral", "fórmula de Bhaskara",
// "célula animal"…), o app busca na internet (Wikipédia e Wikimedia Commons, imagens livres), mostra
// várias opções e a que você tocar vai para a folha — com o nome em cima — e fica salva no app.
import { ic, esc, h, toast, modal, confirmBox } from './ui.js';
import { db } from './store.js';
import { attachDictation } from './voice.js';

const WIKI = lang => `https://${lang}.wikipedia.org/w/api.php`;
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const THUMB = 800; // largura das imagens baixadas
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const wait = (ms, signal) => new Promise((ok, err) => { const t = setTimeout(ok, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('abort'); e.name = 'AbortError'; err(e); }, { once: true }); });
async function api(url, params, signal) {
  const u = `${url}?${qs({ format: 'json', origin: '*', ...params })}`;
  let r = await fetch(u, { signal });
  // limite de pedidos: espera um pouco e tenta de novo sozinho
  for (let i = 0; r.status === 429 && i < 2; i++) { await wait(1500 * (i + 1), signal); r = await fetch(u, { signal }); }
  if (r.status === 429) throw new Error('muitas');
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

// Verbetes da Wikipédia (ótimo para pessoas, lugares e assuntos): imagem principal + nome + descrição
async function searchWiki(q, lang, signal) {
  const j = await api(WIKI(lang), { action: 'query', generator: 'search', gsrsearch: q, gsrlimit: 10, prop: 'pageimages|description', piprop: 'thumbnail|name', pithumbsize: THUMB }, signal);
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
  return pages.filter(p => p.thumbnail && p.thumbnail.source).map(p => ({
    id: `w-${lang}-${p.pageid}`, kind: 'wiki', title: p.title, desc: p.description || '', thumb: p.thumbnail.source, file: p.pageimage, page: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
  }));
}
// Arquivos do Wikimedia Commons (fotos, desenhos, fórmulas, mapas…)
async function searchCommons(q, signal) {
  const j = await api(COMMONS, { action: 'query', generator: 'search', gsrnamespace: 6, gsrsearch: q, gsrlimit: 30, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: THUMB }, signal);
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
  return pages.filter(p => p.imageinfo && /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(p.imageinfo[0].mime) && p.imageinfo[0].thumburl).map(p => {
    const ii = p.imageinfo[0], m = ii.extmetadata || {};
    const name = strip(m.ObjectName && m.ObjectName.value) || p.title.replace(/^File:|^Arquivo:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    return { id: `c-${p.pageid}`, kind: 'commons', title: name, desc: strip(m.ImageDescription && m.ImageDescription.value).slice(0, 120), thumb: ii.thumburl, credit: creditOf(m), page: ii.descriptionurl };
  });
}
const creditOf = m => {
  const who = strip(m.Artist && m.Artist.value).slice(0, 60), lic = strip(m.LicenseShortName && m.LicenseShortName.value);
  return ['Wikimedia Commons', who, lic].filter(Boolean).join(' · ');
};
// Crédito da imagem principal de um verbete (autor e licença ficam no Commons)
async function wikiCredit(file) {
  try {
    const j = await api(COMMONS, { action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'extmetadata' });
    const p = Object.values(j.query.pages)[0];
    return creditOf((p.imageinfo && p.imageinfo[0].extmetadata) || {});
  } catch { return 'Wikimedia Commons'; }
}

export async function searchImages(q, signal) {
  const [pt, commons] = await Promise.allSettled([searchWiki(q, 'pt', signal), searchCommons(q, signal)]);
  let wiki = pt.status === 'fulfilled' ? pt.value : [];
  if (wiki.length < 2) { try { wiki = wiki.concat(await searchWiki(q, 'en', signal)); } catch { /* */ } }
  const all = [...wiki, ...(commons.status === 'fulfilled' ? commons.value : [])];
  if (!all.length && [pt, commons].every(r => r.status === 'rejected')) {
    const e = [pt, commons].map(r => r.reason).find(Boolean);
    throw e;
  }
  const seen = new Set();
  return all.filter(r => !seen.has(r.thumb) && seen.add(r.thumb));
}

// Baixa a imagem escolhida e guarda no banco (fica salva mesmo sem internet)
async function download(r) {
  // as miniaturas também existem em upload.wikimedia.org (que libera o download); usa esse se o primeiro falhar
  const urls = [r.thumb, r.thumb.replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/')].filter((u, i, a) => a.indexOf(u) === i);
  let blob = null;
  for (const u of urls) {
    try { const res = await fetch(u, { mode: 'cors' }); if (res.ok) { blob = await res.blob(); break; } } catch { /* tenta o próximo */ }
  }
  if (!blob) throw new Error('download');
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const k = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const g = c.getContext('2d');
    const png = /png|gif|svg/.test(blob.type) || /\.png|\.svg/i.test(r.thumb);
    if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(im, 0, 0, c.width, c.height);
    return { src: png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

const OPT_KEY = 'caderno-imagem-opcoes';
const getOpts = () => { try { return { name: true, credit: true, ...JSON.parse(localStorage.getItem(OPT_KEY) || '{}') }; } catch { return { name: true, credit: true }; } };

// Abre a busca. onPick({src, w, h, title, credit, withName, withCredit}) coloca a imagem na folha.
let lastQuery = '';
export async function openImageSearch({ onPick, query = '' } = {}) {
  let tab = 'web', results = [], busy = null, saved = await db.all('images');
  const opts = getOpts();
  const body = h(`<div class="is-wrap">
    <form class="row is-form" autocomplete="off">
      <input class="input grow" id="is-q" type="search" placeholder="O que você quer? Ex.: Bhaskara, Pedro Álvares Cabral, célula animal…" value="${esc(query || lastQuery)}">
      <button class="icon-btn" type="button" id="is-mic" aria-label="Falar">${ic('mic')}</button>
      <button class="btn primary" type="submit">${ic('search')}<span>Buscar</span></button>
    </form>
    <div class="row wrap is-tabs">
      <button class="chip on" data-tab="web">${ic('search')}<span>Internet</span></button>
      <button class="chip" data-tab="saved">${ic('image')}<span>Minhas imagens (<b id="is-n">${saved.length}</b>)</span></button>
      <span class="grow"></span>
      <label class="check small"><input type="checkbox" id="is-name" ${opts.name ? 'checked' : ''}> Nome em cima</label>
      <label class="check small"><input type="checkbox" id="is-credit" ${opts.credit ? 'checked' : ''}> Crédito embaixo</label>
    </div>
    <div class="is-status muted small" id="is-status">Escreva o nome (de uma pessoa, lugar, fórmula, objeto…) e toque em Buscar. As imagens vêm da Wikipédia e do Wikimedia Commons, que são livres para estudar.</div>
    <div class="is-grid" id="is-grid"></div>
  </div>`);
  const $ = s => body.querySelector(s);
  const status = t => { $('#is-status').innerHTML = t; };
  const saveOpts = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify({ name: $('#is-name').checked, credit: $('#is-credit').checked })); } catch { /* */ } };
  $('#is-name').onchange = saveOpts; $('#is-credit').onchange = saveOpts;
  attachDictation($('#is-mic'), $('#is-q'));
  let closeFn;
  const draw = () => {
    body.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#is-n').textContent = saved.length;
    const list = tab === 'web' ? results : saved.sort((a, b) => b.createdAt - a.createdAt);
    $('#is-grid').innerHTML = list.map((r, i) => `<div class="is-item" data-i="${i}" role="button" tabindex="0">
        <div class="is-img"><img src="${esc(tab === 'web' ? r.thumb : r.src)}" alt="${esc(r.title)}" loading="lazy" referrerpolicy="no-referrer"></div>
        <b>${esc(r.title)}</b>${r.desc ? `<small>${esc(r.desc)}</small>` : ''}
        ${tab === 'saved' ? `<button class="icon-btn small is-del" data-del="${r.id}" aria-label="Apagar imagem salva">${ic('trash')}</button>` : ''}
      </div>`).join('');
    if (tab === 'saved') status(saved.length ? 'Suas imagens salvas: toque para colocar na folha.' : 'Nenhuma imagem salva ainda. As que você escolher na busca ficam aqui.');
  };
  const run = async () => {
    const q = $('#is-q').value.trim();
    if (!q) { $('#is-q').focus(); return; }
    lastQuery = q; tab = 'web';
    if (!navigator.onLine) { status('Sem internet: a busca precisa de conexão. As imagens salvas funcionam offline.'); return; }
    if (busy) busy.abort();
    busy = new AbortController();
    status(`Buscando “${esc(q)}”…`); results = []; draw();
    try {
      results = await searchImages(q, busy.signal);
      status(results.length ? `${results.length} imagens para “${esc(q)}”. Toque na que você quer: ela vai para a folha e fica salva.` : `Nada encontrado para “${esc(q)}”. Tente outro nome ou em inglês.`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      status(e.message === 'muitas' ? 'Muitas buscas seguidas: espere alguns segundos e tente de novo.' : 'Não consegui buscar agora. Confira a internet e tente de novo.');
    } finally { busy = null; }
    draw();
  };
  $('.is-form').onsubmit = e => { e.preventDefault(); run(); };
  // miniatura que não carregou: some da lista (em vez de aparecer quebrada)
  $('#is-grid').addEventListener('error', e => {
    const im = e.target;
    if (im.tagName !== 'IMG') return;
    // primeiro tenta a mesma miniatura pelo upload.wikimedia.org; se falhar de novo, esconde
    if (im.src.includes('://thumb.wikimedia.org/')) { im.src = im.src.replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/'); return; }
    im.closest('.is-item')?.classList.add('broken');
  }, true);
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  $('#is-grid').onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!(await confirmBox('Apagar imagem', 'Apagar esta imagem das salvas? (as folhas que já usam continuam com ela)', 'Apagar'))) return;
      await db.del('images', del.dataset.del); saved = saved.filter(x => x.id !== del.dataset.del); draw(); return;
    }
    const it = e.target.closest('[data-i]'); if (!it) return;
    const r = (tab === 'web' ? results : saved)[+it.dataset.i];
    const withName = $('#is-name').checked, withCredit = $('#is-credit').checked;
    if (tab === 'saved') { closeFn && closeFn(); onPick({ ...r, withName, withCredit }); return; }
    it.classList.add('loading'); status(`Baixando “${esc(r.title)}”…`);
    try {
      const img = await download(r);
      const credit = r.credit || (r.file ? await wikiCredit(r.file) : 'Wikimedia Commons');
      const item = { id: uid(), title: r.title, desc: r.desc, src: img.src, w: img.w, h: img.h, credit, source: r.page, query: lastQuery, createdAt: Date.now() };
      await db.put('images', item);
      saved.push(item);
      closeFn && closeFn();
      onPick({ ...item, withName, withCredit });
      toast('Imagem colocada na folha e salva em “Minhas imagens” ✓', 3500);
    } catch {
      it.classList.remove('loading');
      status('Não consegui baixar essa imagem. Tente outra.');
    }
  };
  draw();
  await modal({ title: '🖼️ Imagem', body, wide: true, actions: [{ label: 'Fechar', value: null }], onOpen: (_el, c) => { closeFn = c; if ($('#is-q').value) setTimeout(() => { if (tab === 'web' && !results.length) run(); }, 50); } });
  if (busy) busy.abort();
}
