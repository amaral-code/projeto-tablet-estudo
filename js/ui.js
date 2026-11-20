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

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) { el = h('<div id="toast" role="status"></div>'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Modal ----------
// modal({title, body: string|Element, actions:[{label, value, primary, danger}], onOpen(el)})
export function modal({ title, body = '', actions = [{ label: 'OK', value: true, primary: true }], onOpen, wide }) {
  return new Promise(resolve => {
    const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="modal-body"></div><div class="modal-actions"></div></div></div>`);
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const acts = back.querySelector('.modal-actions');
    let done = false;
    const close = v => {
      if (done) return; done = true;
      back.classList.remove('show');
      setTimeout(() => back.remove(), 180);
      resolve(v);
    };
    for (const a of actions) {
      const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`);
      b.onclick = () => {
        if (a.validate && !a.validate(back)) return;
        close(typeof a.value === 'function' ? a.value(back) : a.value);
      };
      acts.appendChild(b);
    }
    back.addEventListener('pointerdown', e => { if (e.target === back) close(undefined); });
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(undefined);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = actions.findIndex(a => a.primary);
        if (p >= 0) acts.children[p].click();
      }
    });
    document.body.appendChild(back);
    back._close = close;
    requestAnimationFrame(() => back.classList.add('show'));
    onOpen && onOpen(back, close);
    const first = back.querySelector('input:not([type=checkbox]):not([type=color]),textarea');
    if (first) setTimeout(() => { first.focus(); first.select?.(); }, 60);
  });
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
