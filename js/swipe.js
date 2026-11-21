// Arrastar uma tarefa com o dedo: → para a direita conclui, ← para a esquerda adia para amanhã.
// Funciona na lista de Tarefas, no Hoje e na Agenda. Rolar a tela para cima e para baixo continua normal.
let A;
const ROWS = '#task-list > .task[data-id], .mini-task';
const idOf = row => row.dataset.id || row.querySelector('[data-check]')?.dataset.check || '';

export function initSwipe(api) {
  A = api;
  let s = null; // gesto em andamento
  let blockClickUntil = 0;
  const reset = (row, animate = true) => {
    row.style.transition = animate ? 'transform .18s ease' : '';
    row.style.transform = '';
    row.classList.remove('sw-on', 'sw-right', 'sw-left', 'sw-ready');
    setTimeout(() => { row.style.transition = ''; }, 200);
  };
  document.addEventListener('pointerdown', e => {
    s = null;
    if (e.pointerType !== 'touch' || !e.isPrimary || document.body.classList.contains('editing') || document.querySelector('.modal-back')) return;
    if (e.clientX < 28) return; // a borda esquerda abre o menu
    const row = e.target.closest(ROWS);
    if (!row || !row.closest('#main') || row.classList.contains('done')) return;
    if (e.target.closest('input, select, textarea, a')) return;
    const id = idOf(row); if (!id) return;
    s = { row, id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, w: row.getBoundingClientRect().width };
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!s || e.pointerId !== s.pid) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { s = null; return; } // é rolagem
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      s.on = true; s.row.classList.add('sw-on');
      try { s.row.setPointerCapture(s.pid); } catch { /* */ }
    }
    s.dx = dx;
    const lim = s.w * 0.6, x = Math.max(-lim, Math.min(lim, dx));
    s.row.style.transform = `translateX(${x}px)`;
    s.row.style.setProperty('--swx', `${-x}px`);
    s.row.classList.toggle('sw-right', dx > 0); s.row.classList.toggle('sw-left', dx < 0);
    s.row.classList.toggle('sw-ready', Math.abs(dx) > threshold(s));
  }, { passive: true });
  const end = async e => {
    if (!s || e.pointerId !== s.pid) return;
    const g = s; s = null;
    if (!g.on) return;
    blockClickUntil = Date.now() + 450; // o toque que termina o gesto não abre a tarefa
    if (e.type === 'pointercancel' || Math.abs(g.dx) <= threshold(g)) { reset(g.row); return; }
    const right = g.dx > 0;
    g.row.style.transition = 'transform .16s ease, opacity .16s ease';
    g.row.style.transform = `translateX(${right ? g.w : -g.w}px)`; g.row.style.opacity = '0';
    try { navigator.vibrate && navigator.vibrate(12); } catch { /* */ }
    await new Promise(r => setTimeout(r, 160));
    try { right ? await A.swipeDone(g.id) : await A.postponeTask(g.id); } finally { if (g.row.isConnected) { g.row.style.opacity = ''; reset(g.row, false); } }
  };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', end, { passive: true });
  document.addEventListener('click', e => { if (Date.now() < blockClickUntil && e.target.closest(ROWS)) { e.stopPropagation(); e.preventDefault(); } }, true);
}
const threshold = g => Math.min(110, g.w * 0.28);
