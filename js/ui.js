// Ícones, diálogos e avisos
const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.3 16.8a2 2 0 0 1 2.8-2.8L8 16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cloudok: '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudoff: '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  magic: '<path d="m21.6 2.4-1-1a1.2 1.2 0 0 0-1.7 0L2.4 18.1a1.2 1.2 0 0 0 0 1.7l1 1a1.2 1.2 0 0 0 1.7 0L21.6 4.1a1.2 1.2 0 0 0 0-1.7Z"/><path d="m14 7 3 3"/><path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  shapes: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/><path d="M17 3l4 7h-8z"/>',
  page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sticky: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/><path d="M7 12h7M7 16h5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  graph: '<path d="M3 3v18h18"/><path d="m7 15 4-6 4 4 5-8"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  network: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="m6 6.5 3.5 3.5M18 6.5 14.5 10M6 17.5l3.5-3.5M18 17.5 14.5 14"/>',
  atom: '<circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  drive: '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="m8 17 4-4 4 4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  pin: '<path d="M12 17v5"/><path d="M5 17h14l-2-4V6a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v7z"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.1V17h6v-.2c0-.9.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sigma: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  quiz: '<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  journal: '<path d="M4 4a2 2 0 0 1 2-2h12v20H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  bookOpen: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  cards: '<rect x="2" y="6" width="15" height="14" rx="2"/><path d="M7 3h13a2 2 0 0 1 2 2v11"/><path d="M6 13h7"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.6 1.4 2.8 2.5 2.8z"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
};
export function ic(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texto da IA para a tela: tudo escapado, e os títulos ("# ...") viram destaque em vez de aparecer o "#"
export function richText(text) {
  return esc(text).split('\n').map(l => {
    const m = l.match(/^\s*#{1,6}\s+(.*)$/);
    return m ? `<span class="ai-h">${m[1]}</span>` : l;
  }).join('\n');
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- Toast ----------
let toastTimer;
// toast(msg, ms, action): action = { label, run } mostra um botão (ex.: "Desfazer")
export function toast(msg, ms = 2600, action) {
  let el = document.getElementById('toast');
  if (!el) { el = h('<div id="toast" role="status"></div>'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('with-action', !!action);
  if (action) {
    const b = h(`<button class="toast-btn" type="button">${esc(action.label)}</button>`);
    b.onclick = () => { el.classList.remove('show'); clearTimeout(toastTimer); action.run(); };
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? Math.max(ms, 5000) : ms);
}

// ---------- Modal ----------
// modal({title, body: string|Element, actions:[{label, value, primary, danger}], onOpen(el)})
// Rascunhos: o que você digita numa janela fica guardado até salvar. Se o app fechar ou a janela sumir,
// ao abrir a mesma janela de novo o texto volta.
const DRAFT = 'caderno-rascunho:';
const hashStr = t => { let x = 0; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
const draftFields = root => [...root.querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select')]
  .filter(f => !['file', 'button', 'submit', 'hidden', 'password', 'range', 'color', 'search'].includes(f.type) && !f.closest('[data-nodraft]'));
const fieldVal = f => (f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value);
const setVal = (f, v) => { if (f.type === 'checkbox' || f.type === 'radio') f.checked = !!v; else f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

export function modal({ title, body = '', actions = [{ label: 'OK', value: true, primary: true }], onOpen, wide, sheet }) {
  return new Promise(resolve => {
    const back = h(`<div class="modal-back ${sheet ? 'sheet-back' : ''}"><div class="modal ${wide ? 'wide' : ''} ${sheet ? 'sheet' : ''}" role="dialog" aria-modal="true">
      ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="modal-body"></div><div class="modal-actions"></div></div></div>`);
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const acts = back.querySelector('.modal-actions');
    // janela de "preencher e salvar" (tem um botão principal que não é só "Fechar")
    const saveIdx = actions.findIndex(a => a.primary && a.label !== 'Fechar');
    let done = false, initial = null, draftKey = null, draftT = 0;
    const current = () => draftFields(back).map(fieldVal);
    const isDirty = () => initial && JSON.stringify(current()) !== JSON.stringify(initial);
    const close = v => {
      if (done) return; done = true;
      clearTimeout(draftT);
      back.classList.remove('show');
      setTimeout(() => back.remove(), 180);
      resolve(v);
    };
    actions.forEach((a, i) => {
      const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`);
      b.onclick = () => {
        if (a.validate && !a.validate(back)) return;
        if (draftKey) lsSet(draftKey, null); // salvou ou escolheu cancelar: o rascunho não é mais preciso
        close(typeof a.value === 'function' ? a.value(back) : a.value);
      };
      acts.appendChild(b);
    });
    // tocar fora (ou Esc) com algo escrito não apaga: pergunta se quer salvar
    const softClose = () => {
      if (saveIdx < 0 || !isDirty()) { if (draftKey) lsSet(draftKey, null); close(undefined); return; }
      if (back.querySelector('.modal-keep')) { back.querySelector('.modal').classList.remove('shake'); void back.offsetWidth; back.querySelector('.modal').classList.add('shake'); return; }
      const bar = h(`<div class="modal-keep" role="alert"><span class="grow">✏️ Você escreveu algo aqui. Quer guardar?</span>
        <button class="btn small-btn" data-k="discard">Descartar</button><button class="btn primary small-btn" data-k="save">Salvar</button></div>`);
      bar.querySelector('[data-k=discard]').onclick = () => { if (draftKey) lsSet(draftKey, null); close(undefined); };
      bar.querySelector('[data-k=save]').onclick = () => { bar.remove(); acts.children[saveIdx].click(); };
      acts.before(bar);
    };
    back.addEventListener('pointerdown', e => { if (e.target === back) softClose(); });
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') softClose();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = actions.findIndex(a => a.primary);
        if (p >= 0) acts.children[p].click();
      }
    });
    document.body.appendChild(back);
    back._close = close;
    requestAnimationFrame(() => back.classList.add('show'));
    onOpen && onOpen(back, close);
    if (saveIdx >= 0 && draftFields(back).length) {
      initial = current();
      draftKey = DRAFT + hashStr((title || '') + '|' + JSON.stringify(initial));
      let saved = null;
      try { saved = JSON.parse(lsGet(draftKey) || 'null'); } catch { /* */ }
      const fs = draftFields(back);
      if (Array.isArray(saved) && saved.length === fs.length && JSON.stringify(saved) !== JSON.stringify(initial)) {
        fs.forEach((f, i) => setVal(f, saved[i]));
        const note = h(`<div class="modal-draft">✏️ Recuperei o que você estava escrevendo. <button class="link" type="button">Descartar</button></div>`);
        note.querySelector('button').onclick = () => { draftFields(back).forEach((f, i) => setVal(f, initial[i])); lsSet(draftKey, null); note.remove(); };
        bodyEl.prepend(note);
      }
      const keep = () => { clearTimeout(draftT); draftT = setTimeout(() => { if (!done) lsSet(draftKey, isDirty() ? JSON.stringify(current()) : null); }, 250); };
      back.addEventListener('input', keep);
      back.addEventListener('change', keep);
    }
    const first = back.querySelector('input:not([type=checkbox]):not([type=color]),textarea');
    if (first) setTimeout(() => { first.focus(); first.select?.(); }, 60);
  });
}

// Rascunho de um campo fora de janela (nota rápida, pergunta ao tutor…). Devolve a função que apaga o rascunho.
export function keepDraft(el, name) {
  const k = DRAFT + name;
  if (!el.value) { const v = lsGet(k); if (v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
  let t = 0;
  el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => lsSet(k, el.value.trim() ? el.value : null), 250); });
  return () => { clearTimeout(t); lsSet(k, null); };
}

export async function promptText(title, value = '', placeholder = '') {
  const v = await modal({
    title,
    body: `<input class="input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
    actions: [
      { label: 'Cancelar', value: undefined },
      { label: 'OK', primary: true, value: el => el.querySelector('input').value.trim() },
    ],
  });
  return v;
}

export function confirmBox(title, msg, okLabel = 'Confirmar', danger = true) {
  return modal({
    title, body: `<p>${esc(msg)}</p>`,
    actions: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}

// Menu de opções simples (lista de botões)
export function menu(title, items) {
  return new Promise(resolve => {
    const body = h('<div class="menu-list"></div>');
    let closer;
    for (const it of items) {
      if (!it) continue;
      const b = h(`<button class="menu-item ${it.danger ? 'danger' : ''}">${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span></button>`);
      b.onclick = () => closer && closer(it.value);
      body.appendChild(b);
    }
    modal({
      title, body, actions: [{ label: 'Fechar', value: undefined }],
      onOpen: (_el, close) => { closer = close; },
    }).then(resolve);
  });
}
