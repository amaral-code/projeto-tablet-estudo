// Central de produtividade: Hoje, Foco (Pomodoro), Agenda, Flashcards e Hábitos.
import { ic, esc, h, toast, modal, confirmBox, menu } from './ui.js';
import { ACTIONS, aiConfigured, buildContent, streamChat, parseFlashcards } from './ai.js';
import { SOUNDS, playSound, stopSound, setVolume } from './sound.js';
import { speak, stopSpeak, canSpeak } from './voice.js';

let A; // funções e dados do app
const H = { sessions: [], habits: [], decks: [], cards: [] };
export const HUB_VIEWS = {
  today: { title: 'Hoje', icon: 'home' },
  calendar: { title: 'Agenda', icon: 'calendar' },
  focus: { title: 'Foco', icon: 'timer' },
  cards: { title: 'Flashcards', icon: 'cards' },
  habits: { title: 'Hábitos', icon: 'flame' },
};

// ---------- datas ----------
export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const longDate = s => cap(parseDay(s).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;

export async function initHub(api) {
  A = api;
  [H.sessions, H.habits, H.decks, H.cards] = await Promise.all(['sessions', 'habits', 'decks', 'cards'].map(s => A.db.all(s)));
  if (!localStorage.getItem('caderno-hub-seeded')) await seedHub();
  initTimer();
}

async function seedHub() {
  localStorage.setItem('caderno-hub-seeded', '1');
  if (H.habits.length || H.decks.length) return;
  const now = Date.now();
  for (const [name, color] of [['Estudar 30 minutos', '#0a6cff'], ['Ler 20 páginas', '#1f9d4a'], ['Revisar flashcards', '#8e44d6']]) {
    const hb = { id: A.uid(), name, color, days: {}, createdAt: now + H.habits.length };
    H.habits.push(hb); await A.db.put('habits', hb);
  }
  const deck = { id: A.uid(), name: 'Exemplo — conhecimentos gerais', folderId: '', createdAt: now };
  H.decks.push(deck); await A.db.put('decks', deck);
  await addCards(deck.id, [
    { front: 'Quanto é 7 × 8?', back: '56' },
    { front: 'Plural de "cidadão"', back: 'cidadãos' },
    { front: 'Qual organela produz energia na célula?', back: 'A mitocôndria' },
    { front: 'Capital do Brasil', back: 'Brasília' },
  ]);
}

// ======================= FOCO / POMODORO =======================
const FKEY = 'caderno-foco';
const T = (() => {
  const def = { mode: 'focus', running: false, endAt: 0, remaining: 25 * 60, startedAt: 0, cycle: 0, folderId: '', taskId: '',
    cfg: { focus: 25, short: 5, long: 15, every: 4, autoBreak: true, goal: 60, sound: 'none', vol: 0.4 } };
  try { const v = JSON.parse(localStorage.getItem(FKEY)); return v ? { ...def, ...v, cfg: { ...def.cfg, ...v.cfg } } : def; } catch { return def; }
})();
const saveT = () => { try { localStorage.setItem(FKEY, JSON.stringify(T)); } catch { /* */ } };
// backup restaurado: aplica as configurações do foco que vieram nele
document.addEventListener('caderno-foco-cfg', e => { Object.assign(T.cfg, e.detail || {}); saveT(); });
const dur = m => (m === 'free' ? 3600 : T.cfg[m === 'focus' ? 'focus' : m === 'short' ? 'short' : 'long'] * 60);
const left = () => (T.running ? Math.max(0, Math.round((T.endAt - Date.now()) / 1000)) : T.remaining);
// cronômetro livre: tempo já estudado
const elapsed = () => Math.round((T.freeAcc || 0) + (T.running ? (Date.now() - T.freeStart) / 1000 : 0));
const isFree = () => T.mode === 'free';
const shown = () => (isFree() ? elapsed() : left());
const MODE_LABEL = { focus: 'Foco', short: 'Pausa curta', long: 'Pausa longa', free: 'Cronômetro' };
let wakeLock = null, pill;

function initTimer() {
  pill = h(`<button id="focus-pill" hidden aria-label="Abrir o foco"></button>`);
  pill.onclick = () => A.goTo({ kind: 'focus' });
  document.body.appendChild(pill);
  const zx = h(`<button id="zen-exit">${ic('close')}<span>Sair</span></button>`);
  zx.onclick = toggleZen;
  document.body.appendChild(zx);
  setInterval(() => { if (T.running && !isFree() && left() <= 0) completePhase(); tickUI(); }, 500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && T.running) requestWake(); });
  if (T.running && !isFree() && left() <= 0) completePhase(true);
  else if (T.running) requestWake();
  tickUI();
}
async function requestWake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* */ } }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch { /* */ } wakeLock = null; }

function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.28);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.3);
    });
    setTimeout(() => ac.close(), 1500);
  } catch { /* */ }
  navigator.vibrate?.([250, 120, 250]);
}
function notify(msg) {
  toast(msg, 4000);
  beep();
  // No Android, notificações só funcionam pelo service worker
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const opts = { body: msg, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'caderno-foco', renotify: true };
      if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification('Caderno de Estudos', opts)).catch(() => {});
      else new Notification('Caderno de Estudos', opts);
    }
  } catch { /* sem notificação */ }
}

// som de fundo só durante o foco (as pausas ficam em silêncio)
function syncSound() {
  if (T.running && (T.mode === 'focus' || isFree()) && T.cfg.sound !== 'none') playSound(T.cfg.sound, T.cfg.vol);
  else stopSound();
}
function startT() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  if (!T.startedAt) T.startedAt = Date.now();
  T.running = true;
  if (isFree()) T.freeStart = Date.now(); else T.endAt = Date.now() + T.remaining * 1000;
  saveT(); requestWake(); syncSound(); tickUI(); rerenderIf('focus');
}
function pauseT() { if (isFree()) T.freeAcc = elapsed(); else T.remaining = left(); T.running = false; saveT(); releaseWake(); syncSound(); tickUI(); rerenderIf('focus'); }
function resetT(mode = T.mode) { T.mode = mode; T.running = false; T.remaining = dur(mode); T.startedAt = 0; T.freeAcc = 0; saveT(); releaseWake(); syncSound(); tickUI(); rerenderIf('focus'); }

async function recordSession(minutes) {
  if (minutes < 1) return;
  const s = { id: A.uid(), date: dayStr(), start: T.startedAt || Date.now() - minutes * 60000, minutes, folderId: T.folderId, taskId: T.taskId };
  H.sessions.push(s);
  await A.db.put('sessions', s);
}
async function completePhase(silent) {
  const was = T.mode;
  let next;
  if (was === 'focus') {
    await recordSession(T.cfg.focus);
    T.cycle++;
    next = T.cycle % T.cfg.every === 0 ? 'long' : 'short';
    if (!silent) notify(`Foco de ${T.cfg.focus} min concluído! 🎉 Hora da ${MODE_LABEL[next].toLowerCase()}.`);
  } else {
    next = 'focus';
    if (!silent) notify('Pausa terminada. Bora focar! 💪');
  }
  T.mode = next; T.remaining = dur(next); T.running = false; T.startedAt = 0;
  saveT();
  if (T.cfg.autoBreak && next !== 'focus' && !silent) startT();
  else { releaseWake(); syncSound(); }
  tickUI(); rerenderIf('focus'); rerenderIf('today');
  A.onChange();
}
async function stopAndSave() {
  if (isFree()) {
    const min = Math.floor(elapsed() / 60);
    await recordSession(min);
    toast(min >= 1 ? `${fmtMin(min)} de estudo registrados ✓` : 'Menos de 1 minuto: nada foi registrado');
    resetT('free'); A.onChange();
    return;
  }
  if (T.mode === 'focus') {
    const elapsed = Math.floor((dur('focus') - left()) / 60);
    await recordSession(elapsed);
    if (elapsed >= 1) toast(`${fmtMin(elapsed)} de foco registrados ✓`);
  }
  resetT('focus');
  A.onChange();
}

function mmss(sec) {
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return `${hh ? hh + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function tickUI() {
  const sec = shown();
  const active = T.running || (isFree() ? sec > 0 : sec < dur(T.mode));
  if (pill) {
    pill.hidden = !active || currentKind === 'focus' && !document.body.classList.contains('editing');
    pill.className = `mode-${T.mode} ${T.running ? 'running' : 'paused'}`;
    pill.innerHTML = `${ic(T.running ? 'timer' : 'pause')}<span>${mmss(sec)}</span>`;
    pill.classList.toggle('free', isFree());
  }
  const clock = document.getElementById('fc-time');
  if (clock) {
    clock.textContent = mmss(sec);
    const ring = document.getElementById('fc-ring');
    const frac = isFree() ? (sec % 3600) / 3600 : 1 - sec / dur(T.mode);
    if (ring) ring.style.strokeDashoffset = String(2 * Math.PI * 120 * (1 - frac));
  }
  document.title = T.running ? `${mmss(sec)} · ${MODE_LABEL[T.mode]} — Caderno` : 'Caderno de Estudos';
}

function focusStats() {
  const today = dayStr();
  const byDay = d => H.sessions.filter(s => s.date === d).reduce((a, s) => a + s.minutes, 0);
  const week = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); week.push({ d, m: byDay(d) }); }
  const weekStart = addDays(today, -6);
  const subj = new Map();
  for (const s of H.sessions) if (s.date >= weekStart) subj.set(s.folderId || '', (subj.get(s.folderId || '') || 0) + s.minutes);
  return { today: byDay(today), week, weekTotal: week.reduce((a, x) => a + x.m, 0), subj, total: H.sessions.reduce((a, s) => a + s.minutes, 0) };
}

function weekChart(week) {
  const max = Math.max(30, ...week.map(x => x.m));
  const today = dayStr();
  return `<div class="bars" role="img" aria-label="Minutos de foco nos últimos 7 dias">${week.map(x => `
    <div class="bar-col" tabindex="0">
      <div class="bar-tip">${esc(longDate(x.d))}: ${fmtMin(x.m)}</div>
      <div class="bar-val">${x.d === today && x.m ? fmtMin(x.m) : ''}</div>
      <div class="bar-track"><div class="bar ${x.d === today ? 'today' : ''}" style="height:${x.m ? Math.max(4, (x.m / max) * 100) : 0}%"></div></div>
      <div class="bar-lbl">${WD[parseDay(x.d).getDay()]}</div>
    </div>`).join('')}</div>
    <table class="sr-only"><caption>Minutos de foco por dia</caption>${week.map(x => `<tr><td>${x.d}</td><td>${x.m}</td></tr>`).join('')}</table>`;
}

function renderFocus(el) {
  const st = focusStats();
  const sec = shown();
  const R = 120, C = 2 * Math.PI * R;
  const free = isFree();
  const off = free ? C * (1 - (sec % 3600) / 3600) : C * (sec / dur(T.mode));
  const tasks = A.state.tasks.filter(t => !t.done);
  el.innerHTML = `<div class="focus-wrap">
    <div class="panel focus-main mode-${T.mode}">
      <div class="seg" id="fc-mode">${Object.entries(MODE_LABEL).map(([k, v]) => `<button data-m="${k}" class="${T.mode === k ? 'active' : ''}">${v}</button>`).join('')}</div>
      <div class="ring-box">
        <svg viewBox="0 0 280 280" class="ring"><circle cx="140" cy="140" r="${R}" class="ring-bg"/>
          <circle id="fc-ring" cx="140" cy="140" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${off}"/></svg>
        <div class="ring-text"><div id="fc-time">${mmss(sec)}</div><div class="muted">${free ? 'Cronômetro · no seu ritmo' : `${MODE_LABEL[T.mode]} · ciclo ${(T.cycle % T.cfg.every) + 1} de ${T.cfg.every}`}</div></div>
      </div>
      <div class="row center wrap">
        <button class="btn primary big" id="fc-start">${ic(T.running ? 'pause' : 'timer')}<span>${T.running ? 'Pausar' : (free ? sec > 0 : sec < dur(T.mode)) ? 'Continuar' : 'Começar'}</span></button>
        <button class="btn" id="fc-reset" title="${free ? 'Zerar' : 'Reiniciar'}">${ic('undo')}<span>${free ? 'Zerar' : 'Reiniciar'}</span></button>
        ${free ? '' : `<button class="btn" id="fc-skip" title="Pular para a próxima fase">${ic('right')}<span>Pular</span></button>`}
        ${(T.mode === 'focus' && (T.running || sec < dur('focus'))) || (free && sec > 0) ? `<button class="btn" id="fc-stop">${ic('check')}<span>Encerrar e salvar</span></button>` : ''}
      </div>
      <div class="row wrap focus-ctx">
        <div class="grow"><label class="lbl">Matéria</label><select class="select full" id="fc-folder">${A.folderOptions(T.folderId, 'Geral')}</select></div>
        <div class="grow"><label class="lbl">Tarefa</label><select class="select full" id="fc-task"><option value="">Nenhuma</option>${tasks.map(t => `<option value="${t.id}" ${t.id === T.taskId ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></div>
      </div>
      <details class="focus-cfg"><summary>Ajustar tempos</summary>
        <div class="row wrap">
          ${[['focus', 'Foco'], ['short', 'Pausa curta'], ['long', 'Pausa longa'], ['every', 'Pausa longa a cada'], ['goal', 'Meta diária (min)']].map(([k, l]) =>
            `<label class="num"><span>${l}</span><input class="input" type="number" min="1" max="${k === 'goal' ? 600 : 180}" data-k="${k}" value="${T.cfg[k]}"></label>`).join('')}
        </div>
        <label class="check"><input type="checkbox" id="fc-auto" ${T.cfg.autoBreak ? 'checked' : ''}> Começar a pausa automaticamente</label>
      </details>
      <div class="row wrap sound-row">
        <span class="sound-ic">${ic('volume')}</span>
        <select class="select" id="fc-sound" aria-label="Som de foco">${Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${T.cfg.sound === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input type="range" id="fc-vol" min="0.05" max="1" step="0.05" value="${T.cfg.vol}" aria-label="Volume">
        <button class="btn" id="fc-zen">${ic('maximize')}<span>Tela cheia</span></button>
      </div>
    </div>
    <div class="panel">
      <h3>Seu foco</h3>
      <div class="stats">
        <div><b>${fmtMin(st.today)}</b><span>hoje</span></div>
        <div><b>${fmtMin(st.weekTotal)}</b><span>últimos 7 dias</span></div>
        <div><b>${studyStreak()}</b><span>${studyStreak() === 1 ? 'dia seguido' : 'dias seguidos'}</span></div>
      </div>
      <div class="goal"><div class="goal-bar"><i style="width:${Math.min(100, (st.today / T.cfg.goal) * 100)}%"></i></div>
        <span class="muted small">Meta de hoje: ${fmtMin(st.today)} de ${fmtMin(T.cfg.goal)}</span></div>
      <h4>Minutos de foco por dia</h4>
      ${weekChart(st.week)}
      <h4>Por matéria (7 dias)</h4>
      <div class="subj">${[...st.subj.entries()].sort((a, b) => b[1] - a[1]).map(([f, m]) => `
        <div class="subj-row"><span class="dot" style="background:${f ? A.folderColor(f) : '#9aa0a6'}"></span><span class="grow">${esc(f ? A.folderName(f) : 'Geral')}</span><b>${fmtMin(m)}</b></div>`).join('') || '<p class="muted small">Nenhuma sessão ainda. Comece um foco!</p>'}</div>
    </div>
  </div>`;
  el.querySelector('#fc-start').onclick = () => (T.running ? pauseT() : startT());
  el.querySelector('#fc-reset').onclick = () => resetT();
  el.querySelector('#fc-skip')?.addEventListener('click', () => completePhase(true).then(() => toast(`Agora: ${MODE_LABEL[T.mode]}`)));
  const stop = el.querySelector('#fc-stop');
  if (stop) stop.onclick = stopAndSave;
  el.querySelector('#fc-mode').onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === T.mode) return;
    if (T.running || (isFree() && elapsed() > 59)) { toast('Encerre ou pause o tempo atual antes de trocar'); return; }
    resetT(b.dataset.m);
  };
  el.querySelector('#fc-folder').onchange = e => { T.folderId = e.target.value; saveT(); };
  el.querySelector('#fc-task').onchange = e => {
    T.taskId = e.target.value;
    const t = A.state.tasks.find(x => x.id === T.taskId);
    if (t && t.folderId) { T.folderId = t.folderId; el.querySelector('#fc-folder').value = t.folderId; }
    saveT();
  };
  el.querySelectorAll('.focus-cfg input[data-k]').forEach(i => i.onchange = () => {
    const v = Math.max(1, Math.min(+i.max, Math.round(+i.value) || 1));
    T.cfg[i.dataset.k] = v; i.value = v;
    if (!T.running && T.startedAt === 0) T.remaining = dur(T.mode);
    saveT(); tickUI();
  });
  el.querySelector('#fc-auto').onchange = e => { T.cfg.autoBreak = e.target.checked; saveT(); };
  el.querySelector('#fc-sound').onchange = e => {
    T.cfg.sound = e.target.value; saveT();
    if (T.cfg.sound === 'none') stopSound();
    else if (T.running && T.mode === 'focus') playSound(T.cfg.sound, T.cfg.vol);
    else { playSound(T.cfg.sound, T.cfg.vol); setTimeout(() => { if (!T.running) stopSound(); }, 2500); toast('Prévia do som — ele toca durante o foco'); }
  };
  el.querySelector('#fc-vol').oninput = e => { T.cfg.vol = +e.target.value; setVolume(T.cfg.vol); saveT(); };
  el.querySelector('#fc-zen').onclick = toggleZen;
}

// Modo tela cheia: esconde menus e deixa só o relógio
function toggleZen() {
  const on = !document.body.classList.contains('zen');
  document.body.classList.toggle('zen', on);
  try {
    if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch { /* sem tela cheia */ }
  if (on) toast('Modo foco total. Toque em “Sair” no canto para voltar.', 3000);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('zen'); });
export function exitZen() { if (document.body.classList.contains('zen')) toggleZen(); }

// ======================= SEQUÊNCIA DE ESTUDOS =======================
function activeDays() {
  const set = new Set(H.sessions.map(s => s.date));
  for (const hb of H.habits) for (const d of Object.keys(hb.days)) if (hb.days[d]) set.add(d);
  for (const n of A.state.notes) if (n.updatedAt) set.add(dayStr(new Date(n.updatedAt)));
  for (const t of A.state.tasks) if (t.doneAt) set.add(dayStr(new Date(t.doneAt)));
  for (const c of H.cards) if (c.lastReview) set.add(c.lastReview);
  return set;
}
export function studyStreak() {
  const set = activeDays();
  let d = dayStr();
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// ======================= HÁBITOS =======================
function habitStreak(hb) {
  let d = dayStr();
  if (!hb.days[d]) d = addDays(d, -1);
  let n = 0;
  while (hb.days[d]) { n++; d = addDays(d, -1); }
  return n;
}
async function toggleHabit(id, day = dayStr()) {
  const hb = H.habits.find(x => x.id === id);
  if (!hb) return;
  hb.days = { ...hb.days };
  if (hb.days[day]) delete hb.days[day]; else hb.days[day] = true;
  await A.db.put('habits', hb);
  if (hb.days[day] && day === dayStr()) toast(`${hb.name} ✓ — sequência de ${habitStreak(hb)} dia(s) 🔥`);
}
async function habitDialog(hb) {
  const isNew = !hb;
  const colors = ['#0a6cff', '#1f9d4a', '#e5352b', '#ff8a00', '#8e44d6', '#00a6b4', '#ff4fa3', '#8b5a2b'];
  hb = hb ? { ...hb } : { id: A.uid(), name: '', color: colors[H.habits.length % colors.length], days: {}, createdAt: Date.now() };
  const body = h(`<div><label class="lbl">Hábito</label><input class="input" id="hb-name" value="${esc(hb.name)}" placeholder="Ex.: Estudar inglês 15 min, Beber água, Dormir cedo">
    <label class="lbl">Cor</label><div class="swatches big" id="hb-colors">${colors.map(c => `<button class="sw ${c === hb.color ? 'active' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}</div></div>`);
  body.querySelector('#hb-colors').onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    hb.color = b.dataset.c; body.querySelectorAll('.sw').forEach(x => x.classList.toggle('active', x === b));
  };
  const name = await modal({
    title: isNew ? 'Novo hábito' : 'Editar hábito', body,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: el => el.querySelector('#hb-name').value.trim(),
      validate: el => !!el.querySelector('#hb-name').value.trim() || (toast('Digite o hábito'), false) }],
  });
  if (!name) return;
  hb.name = name;
  await A.db.put('habits', hb);
  const i = H.habits.findIndex(x => x.id === hb.id);
  if (i >= 0) H.habits[i] = hb; else H.habits.push(hb);
  A.onChange();
}
function renderHabits(el) {
  const today = dayStr();
  const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  el.innerHTML = `<div class="panel">
    <p class="muted">Marque o que você fez em cada dia. A sequência 🔥 mostra quantos dias seguidos você manteve o hábito.</p>
    <div class="habit-table">
      <div class="habit-row head"><span class="grow"></span>${days.map(d => `<span class="hd ${d === today ? 'today' : ''}">${WD[parseDay(d).getDay()]}<small>${parseDay(d).getDate()}</small></span>`).join('')}<span class="hs">🔥</span><span class="hm"></span></div>
      ${H.habits.map(hb => `<div class="habit-row">
        <span class="grow hname"><span class="dot" style="background:${hb.color}"></span>${esc(hb.name)}</span>
        ${days.map(d => `<button class="hcheck ${hb.days[d] ? 'on' : ''}" style="--c:${hb.color}" data-h="${hb.id}" data-d="${d}" aria-label="${esc(hb.name)} em ${d}">${hb.days[d] ? ic('check') : ''}</button>`).join('')}
        <span class="hs"><b>${habitStreak(hb)}</b></span>
        <button class="icon-btn small hm" data-more="${hb.id}" aria-label="Opções">${ic('more')}</button></div>`).join('')}
    </div>
    ${H.habits.length ? '' : '<p class="muted">Nenhum hábito ainda.</p>'}
    <button class="btn" id="hb-add">${ic('plus')}<span>Novo hábito</span></button>
  </div>`;
  el.querySelector('#hb-add').onclick = () => habitDialog();
  el.querySelector('.habit-table').onclick = async e => {
    const c = e.target.closest('[data-h]');
    if (c) { await toggleHabit(c.dataset.h, c.dataset.d); renderHabits(el); A.onChange(true); return; }
    const m = e.target.closest('[data-more]');
    if (m) {
      const hb = H.habits.find(x => x.id === m.dataset.more);
      const a = await menu(hb.name, [{ label: 'Editar', icon: 'edit', value: 'edit' }, { label: 'Excluir', icon: 'trash', value: 'del', danger: true }]);
      if (a === 'edit') habitDialog(hb);
      else if (a === 'del' && await confirmBox('Excluir hábito', `Excluir “${hb.name}” e todo o histórico?`, 'Excluir')) {
        await A.db.del('habits', hb.id); H.habits = H.habits.filter(x => x.id !== hb.id); A.onChange();
      }
    }
  };
}

// ======================= FLASHCARDS (repetição espaçada) =======================
async function addCards(deckId, list) {
  const today = dayStr(), now = Date.now();
  let n = 0;
  for (const c of list) {
    if (!c.front || !c.back) continue;
    const card = { id: A.uid(), deckId, front: c.front.trim(), back: c.back.trim(), due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now + n };
    H.cards.push(card); await A.db.put('cards', card); n++;
  }
  return n;
}
// Salva flashcards criados pela IA num baralho com o nome da matéria/anotação
export async function saveFlashcards(list, { deckName, folderId }) {
  let deck = H.decks.find(d => d.name === deckName);
  if (!deck) { deck = { id: A.uid(), name: deckName, folderId: folderId || '', createdAt: Date.now() }; H.decks.push(deck); await A.db.put('decks', deck); }
  const n = await addCards(deck.id, list);
  A.onChange();
  return { n, deck };
}
function dueCards(deckId) {
  const today = dayStr();
  return H.cards.filter(c => (!deckId || c.deckId === deckId) && c.due <= today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdAt - b.createdAt));
}
// SM-2 simplificado. grade: 0 errei, 1 difícil, 2 bom, 3 fácil
function schedule(c, grade) {
  const n = { ...c };
  if (grade === 0) { n.reps = 0; n.interval = 0; n.lapses = (c.lapses || 0) + 1; n.ease = Math.max(1.3, c.ease - 0.2); }
  else {
    if (c.reps === 0) n.interval = grade === 3 ? 4 : grade === 1 ? 1 : 1;
    else if (c.reps === 1) n.interval = grade === 1 ? 3 : grade === 3 ? 8 : 6;
    else n.interval = Math.max(c.interval + 1, Math.round(c.interval * (grade === 1 ? 1.2 : c.ease * (grade === 3 ? 1.3 : 1))));
    n.ease = Math.max(1.3, c.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
    n.reps = c.reps + 1;
  }
  n.due = addDays(dayStr(), n.interval);
  n.lastReview = dayStr();
  return n;
}
const ivLabel = c => (c.interval === 0 ? 'hoje' : c.interval === 1 ? '1 dia' : c.interval < 30 ? `${c.interval} dias` : `${Math.round(c.interval / 30)} mês(es)`);

let cardsView = { mode: 'list', deckId: null };
let review = null;

function renderCards(el) {
  if (review) return renderReview(el);
  if (cardsView.mode === 'deck') return renderDeck(el);
  const due = dueCards();
  el.innerHTML = `<div class="panel cards-hero">
      <div><b class="big-num">${due.length}</b><span>carta(s) para revisar hoje</span></div>
      <button class="btn primary big" id="cd-study" ${due.length ? '' : 'disabled'}>${ic('cards')}<span>Revisar tudo</span></button>
    </div>
    <p class="muted small">A repetição espaçada mostra cada carta no momento certo: o que você erra volta logo, e o que você sabe aparece cada vez mais espaçado.</p>
    <div class="deck-grid">${H.decks.map(d => {
      const all = H.cards.filter(c => c.deckId === d.id), dd = dueCards(d.id).length;
      return `<div class="panel deck" data-id="${d.id}">
        <div class="deck-top"><span class="dot" style="background:${d.folderId ? A.folderColor(d.folderId) : '#9aa0a6'}"></span><b class="grow">${esc(d.name)}</b>
          <button class="icon-btn small" data-more="${d.id}" aria-label="Opções">${ic('more')}</button></div>
        <div class="muted small">${all.length} carta(s) · <b class="${dd ? 'due' : ''}">${dd} para hoje</b>${d.folderId ? ` · ${esc(A.folderName(d.folderId))}` : ''}</div>
        <div class="row"><button class="btn primary" data-study="${d.id}" ${dd ? '' : 'disabled'}>Estudar</button><button class="btn" data-open="${d.id}">Ver cartas</button></div>
      </div>`;
    }).join('')}
    <button class="panel deck new-deck" id="cd-new">${ic('plus')}<span>Novo baralho</span></button></div>`;
  el.querySelector('#cd-study').onclick = () => startReview(null, el);
  el.querySelector('#cd-new').onclick = () => deckDialog();
  el.querySelector('.deck-grid').onclick = async e => {
    const s = e.target.closest('[data-study]'); if (s) return startReview(s.dataset.study, el);
    const o = e.target.closest('[data-open]'); if (o) { cardsView = { mode: 'deck', deckId: o.dataset.open }; return renderCards(el); }
    const m = e.target.closest('[data-more]'); if (m) return deckMenu(m.dataset.more);
  };
}
async function deckDialog(d) {
  const isNew = !d;
  d = d ? { ...d } : { id: A.uid(), name: '', folderId: '', createdAt: Date.now() };
  const res = await modal({
    title: isNew ? 'Novo baralho' : 'Editar baralho',
    body: `<label class="lbl">Nome</label><input class="input" id="dk-name" value="${esc(d.name)}" placeholder="Ex.: Inglês — verbos irregulares">
      <label class="lbl">Matéria</label><select class="select full" id="dk-folder">${A.folderOptions(d.folderId, 'Sem pasta')}</select>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true,
      validate: el => !!el.querySelector('#dk-name').value.trim() || (toast('Digite um nome'), false),
      value: el => ({ name: el.querySelector('#dk-name').value.trim(), folderId: el.querySelector('#dk-folder').value }) }],
  });
  if (!res) return null;
  Object.assign(d, res);
  await A.db.put('decks', d);
  const i = H.decks.findIndex(x => x.id === d.id);
  if (i >= 0) H.decks[i] = d; else H.decks.push(d);
  A.onChange();
  return d;
}
async function deckMenu(id) {
  const d = H.decks.find(x => x.id === id);
  const a = await menu(d.name, [
    { label: 'Ver e editar cartas', icon: 'cards', value: 'open' },
    { label: 'Criar cartas com IA a partir de uma anotação', icon: 'magic', value: 'ai' },
    { label: 'Renomear / matéria', icon: 'edit', value: 'edit' },
    { label: 'Excluir baralho', icon: 'trash', value: 'del', danger: true },
  ]);
  if (a === 'open') { cardsView = { mode: 'deck', deckId: id }; A.onChange(); }
  else if (a === 'ai') aiCardsFromNote(d);
  else if (a === 'edit') deckDialog(d);
  else if (a === 'del' && await confirmBox('Excluir baralho', `Excluir “${d.name}” e todas as cartas?`, 'Excluir')) {
    for (const c of H.cards.filter(c => c.deckId === id)) await A.db.del('cards', c.id);
    H.cards = H.cards.filter(c => c.deckId !== id);
    await A.db.del('decks', id); H.decks = H.decks.filter(x => x.id !== id);
    cardsView = { mode: 'list' }; A.onChange();
  }
}
async function aiCardsFromNote(deck) {
  if (!aiConfigured()) { toast('Configure a IA em Ajustes → Inteligência artificial'); return; }
  const notes = [...A.state.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const id = await modal({
    title: 'Criar flashcards com IA',
    body: `<label class="lbl">De qual anotação?</label><select class="select full" id="ai-note">${notes.map(n => `<option value="${n.id}">${esc(n.title)}</option>`).join('')}</select>
      <p class="muted small">A IA lê as páginas e cria de 10 a 15 cartas neste baralho.</p>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Criar', primary: true, value: el => el.querySelector('#ai-note').value }],
  });
  if (!id) return;
  const n = notes.find(x => x.id === id);
  const c = await A.loadContent(id);
  toast('A IA está criando as cartas…', 60000);
  try {
    const content = await buildContent({ pages: c.pages, bg: c.bg, title: n.title, folder: A.folderName(n.folderId), prompt: ACTIONS.flashcards.prompt });
    const r = await streamChat([{ role: 'user', content }], () => {}).done;
    const list = parseFlashcards(r.text);
    if (!list.length) { toast('A IA não devolveu cartas. Tente de novo.'); return; }
    const k = await addCards(deck.id, list);
    toast(`${k} cartas criadas em “${deck.name}” ✓`);
    A.onChange();
  } catch (e) { toast(e.message, 4500); }
}
function renderDeck(el) {
  const d = H.decks.find(x => x.id === cardsView.deckId);
  if (!d) { cardsView = { mode: 'list' }; return renderCards(el); }
  const cards = H.cards.filter(c => c.deckId === d.id);
  el.innerHTML = `<div class="row wrap deck-head">
      <button class="btn" id="dk-back">${ic('back')}<span>Baralhos</span></button><h2 class="grow">${esc(d.name)}</h2>
      <button class="btn" id="dk-ai">${ic('magic')}<span>Criar com IA</span></button>
      <button class="btn primary" id="dk-study" ${dueCards(d.id).length ? '' : 'disabled'}>Estudar (${dueCards(d.id).length})</button></div>
    <form class="panel card-form" id="dk-form">
      <textarea class="input" id="dk-front" rows="2" placeholder="Frente (pergunta)" required></textarea>
      <textarea class="input" id="dk-backtxt" rows="2" placeholder="Verso (resposta)" required></textarea>
      <button class="btn primary" type="submit">${ic('plus')}<span>Adicionar carta</span></button>
    </form>
    <div class="card-list">${cards.map(c => `<div class="panel card-item">
      <div class="grow"><b>${esc(c.front)}</b><div class="muted">${esc(c.back)}</div>
      <div class="small muted">Próxima revisão: ${c.due <= dayStr() ? 'hoje' : esc(parseDay(c.due).toLocaleDateString('pt-BR'))}${c.lapses ? ` · errou ${c.lapses}×` : ''}</div></div>
      <button class="icon-btn small" data-edit="${c.id}" aria-label="Editar">${ic('edit')}</button>
      <button class="icon-btn small" data-del="${c.id}" aria-label="Excluir">${ic('trash')}</button></div>`).join('') || '<p class="muted">Nenhuma carta ainda.</p>'}</div>`;
  el.querySelector('#dk-back').onclick = () => { cardsView = { mode: 'list' }; renderCards(el); };
  el.querySelector('#dk-study').onclick = () => startReview(d.id, el);
  el.querySelector('#dk-ai').onclick = () => aiCardsFromNote(d);
  el.querySelector('#dk-form').onsubmit = async e => {
    e.preventDefault();
    const f = el.querySelector('#dk-front').value.trim(), b = el.querySelector('#dk-backtxt').value.trim();
    if (!f || !b) return;
    await addCards(d.id, [{ front: f, back: b }]);
    renderDeck(el);
    el.querySelector('#dk-front').focus();
  };
  el.querySelector('.card-list').onclick = async e => {
    const dl = e.target.closest('[data-del]');
    if (dl) { await A.db.del('cards', dl.dataset.del); H.cards = H.cards.filter(c => c.id !== dl.dataset.del); renderDeck(el); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const c = H.cards.find(x => x.id === ed.dataset.edit);
      const r = await modal({
        title: 'Editar carta',
        body: `<label class="lbl">Frente</label><textarea class="input" id="ce-f" rows="3">${esc(c.front)}</textarea><label class="lbl">Verso</label><textarea class="input" id="ce-b" rows="3">${esc(c.back)}</textarea>`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: el2 => ({ front: el2.querySelector('#ce-f').value.trim(), back: el2.querySelector('#ce-b').value.trim() }) }],
      });
      if (r && r.front && r.back) { Object.assign(c, r); await A.db.put('cards', c); renderDeck(el); }
    }
  };
}
function startReview(deckId, el) {
  const q = dueCards(deckId);
  if (!q.length) { toast('Nada para revisar agora 🎉'); return; }
  review = { deckId, queue: q.map(c => c.id), done: 0, total: q.length, shown: false, right: 0 };
  renderCards(el);
}
function renderReview(el) {
  const r = review;
  if (!r.queue.length) {
    el.innerHTML = `<div class="panel review-done">${ic('check')}<h2>Revisão concluída!</h2>
      <p>${r.total} carta(s) revisada(s) · ${r.right} de primeira</p><button class="btn primary" id="rv-end">Voltar</button></div>`;
    el.querySelector('#rv-end').onclick = () => { review = null; A.onChange(); };
    return;
  }
  const c = H.cards.find(x => x.id === r.queue[0]);
  if (!c) { r.queue.shift(); return renderReview(el); }
  const deck = H.decks.find(d => d.id === c.deckId);
  const prev = [0, 1, 2, 3].map(g => schedule(c, g));
  el.innerHTML = `<div class="review">
    <div class="row"><button class="btn" id="rv-quit">${ic('close')}<span>Sair</span></button><div class="grow progress"><i style="width:${(r.done / r.total) * 100}%"></i></div><span class="muted">${r.done} / ${r.total}</span></div>
    <div class="flash ${r.shown ? 'shown' : ''}" id="rv-card" role="button" tabindex="0">
      <div class="row flash-head"><span class="muted small grow">${esc(deck ? deck.name : '')}</span>${canSpeak() ? `<button class="chip small" id="rv-say" type="button" aria-label="Ouvir a carta">${ic('speaker')}<span>Ouvir</span></button>` : ''}</div>
      <div class="flash-front">${esc(c.front)}</div>
      ${r.shown ? `<hr><div class="flash-back">${esc(c.back)}</div>` : '<div class="muted tap">Toque para ver a resposta</div>'}
    </div>
    ${r.shown ? `<div class="grades">
      <button class="grade g0" data-g="0"><b>Errei</b><span>de novo</span></button>
      <button class="grade g1" data-g="1"><b>Difícil</b><span>${ivLabel(prev[1])}</span></button>
      <button class="grade g2" data-g="2"><b>Bom</b><span>${ivLabel(prev[2])}</span></button>
      <button class="grade g3" data-g="3"><b>Fácil</b><span>${ivLabel(prev[3])}</span></button></div>`
      : '<button class="btn primary big full" id="rv-show">Mostrar resposta</button>'}
  </div>`;
  el.querySelector('#rv-quit').onclick = () => { stopSpeak(); review = null; A.onChange(); };
  el.querySelector('#rv-say')?.addEventListener('click', e => { e.stopPropagation(); speak(r.shown ? `${c.front}. ${c.back}` : c.front, { button: e.currentTarget }); });
  const show = () => { if (!r.shown) { stopSpeak(); r.shown = true; renderReview(el); } };
  el.querySelector('#rv-card').onclick = show;
  el.querySelector('#rv-show')?.addEventListener('click', show);
  el.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => {
    stopSpeak();
    const g = +b.dataset.g;
    const n = schedule(c, g);
    Object.assign(c, n);
    await A.db.put('cards', c);
    logReview();
    r.queue.shift();
    r.shown = false;
    if (g === 0) {
      r.queue.push(c.id); c.missed = true;
      // errou essa carta de novo (2ª vez ou mais): vai para o caderno de erros
      if ((c.lapses || 0) >= 2 && A.addError) { const dk = H.decks.find(d => d.id === c.deckId); A.addError({ src: 'card', ref: c.id, folderId: dk ? dk.folderId : '', subject: dk ? dk.name : '', q: c.front, answer: c.back }); }
    }
    else { r.done++; if (!c.missed) r.right++; delete c.missed; }
    renderReview(el);
  });
}

// ======================= AGENDA =======================
let cal = null;
function renderCalendar(el) {
  const today = dayStr();
  if (!cal) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth(), sel: today }; }
  const first = new Date(cal.y, cal.m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const tasksBy = new Map();
  for (const t of A.state.tasks) if (t.due) { if (!tasksBy.has(t.due)) tasksBy.set(t.due, []); tasksBy.get(t.due).push(t); }
  const focusBy = new Map();
  for (const s of H.sessions) focusBy.set(s.date, (focusBy.get(s.date) || 0) + s.minutes);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = dayStr(d);
    const ts = (tasksBy.get(ds) || []).sort((a, b) => a.done - b.done || b.prio - a.prio);
    const fm = focusBy.get(ds);
    const evs = A.ev ? A.ev.eventsOn(ds) : [];
    cells.push(`<button class="cal-cell ${d.getMonth() !== cal.m ? 'out' : ''} ${ds === today ? 'today' : ''} ${ds === cal.sel ? 'sel' : ''} ${evs.some(e => +e.prio === 3) ? 'has-high' : ''}" data-d="${ds}">
      <span class="cal-n">${d.getDate()}</span>
      ${evs.map(e => `<span class="cal-t ev p${e.prio}">${esc(e.title)}</span>`).join('')}
      ${(A.examsOn ? A.examsOn(ds) : []).map(g => `<span class="cal-t exam">📝 ${esc(g.title)}</span>`).join('')}
      ${ts.slice(0, 3).map(t => `<span class="cal-t p${t.prio} ${t.done ? 'done' : ''} ${!t.done && ds < today ? 'late' : ''}">${esc(t.title)}</span>`).join('')}
      ${ts.length > 3 ? `<span class="cal-more">+${ts.length - 3}</span>` : ''}
      ${fm ? `<span class="cal-f">${ic('timer')}${fmtMin(fm)}</span>` : ''}</button>`);
  }
  const sel = cal.sel;
  const dayTasks = (tasksBy.get(sel) || []);
  const daySessions = H.sessions.filter(s => s.date === sel);
  const dayHabits = H.habits.filter(hb => hb.days[sel]);
  el.innerHTML = `<div class="cal-wrap">
    <div class="panel">
      <div class="row cal-head"><button class="icon-btn" id="cal-prev" aria-label="Mês anterior">${ic('left')}</button>
        <h2 class="grow">${cap(MONTHS[cal.m])} de ${cal.y}</h2>
        <button class="btn" id="cal-today">Hoje</button>
        <button class="icon-btn" id="cal-next" aria-label="Próximo mês">${ic('right')}</button></div>
      <div class="cal-grid">${WD.map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells.join('')}</div>
    </div>
    <div class="cal-side">
    <div class="panel cal-day">
      <h3>${esc(longDate(sel))}</h3>
      ${A.ev ? `<h4>Eventos e provas</h4><div class="ev-list">${A.ev.eventsOn(sel).map(e => A.ev.eventRow(e)).join('')}${(A.examsOn ? A.examsOn(sel) : []).map(g => `<div class="exam-mini soon"><b>📝</b><span class="grow">${esc(g.title)} <span class="muted small">· ${esc(A.folderName(g.folderId) || 'Geral')}${g.score != null ? ` · nota ${g.score}` : ''}</span></span></div>`).join('')}${A.ev.eventsOn(sel).length || (A.examsOn ? A.examsOn(sel) : []).length ? '' : '<p class="muted small">Nenhum evento neste dia.</p>'}</div>
      <button class="btn primary" id="cal-addev">${ic('plus')}<span>Evento neste dia</span></button><h4>Tarefas</h4>` : (A.examsOn ? A.examsOn(sel) : []).map(g => `<div class="exam-mini soon"><b>📝</b><span class="grow">${esc(g.title)}</span></div>`).join('')}
      <div class="mini-tasks">${dayTasks.map(t => miniTask(t)).join('') || '<p class="muted small">Nenhuma tarefa neste dia.</p>'}</div>
      <button class="btn" id="cal-add">${ic('plus')}<span>Tarefa neste dia</span></button>
      ${daySessions.length ? `<h4>Foco</h4>${daySessions.map(s => `<div class="subj-row"><span class="dot" style="background:${s.folderId ? A.folderColor(s.folderId) : '#9aa0a6'}"></span><span class="grow">${esc(s.folderId ? A.folderName(s.folderId) : 'Geral')}</span><b>${fmtMin(s.minutes)}</b></div>`).join('')}` : ''}
      ${dayHabits.length ? `<h4>Hábitos feitos</h4><p>${dayHabits.map(hb => `<span class="tag"><span class="dot" style="background:${hb.color}"></span>${esc(hb.name)}</span>`).join(' ')}</p>` : ''}
    </div>
    ${A.ev ? `<div class="panel cal-next"><h3>${ic('calendar')}Próximos eventos</h3>${A.ev.notifHTML()}
      <div class="ev-list">${A.ev.upcoming(60).map(e => A.ev.eventRow(e, { showDate: true })).join('') || '<p class="muted small">Nenhum evento nos próximos 60 dias. Toque em <b>Novo evento</b> para salvar provas, trabalhos, aniversários…</p>'}</div></div>` : ''}
    </div></div>`;
  const go = dm => { cal.m += dm; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } renderCalendar(el); };
  el.querySelector('#cal-prev').onclick = () => go(-1);
  el.querySelector('#cal-next').onclick = () => go(1);
  el.querySelector('#cal-today').onclick = () => { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth(), sel: today }; renderCalendar(el); };
  el.querySelector('.cal-grid').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { cal.sel = b.dataset.d; renderCalendar(el); } };
  el.querySelector('#cal-add').onclick = () => A.taskDialog({ due: sel });
  if (A.ev) {
    el.querySelector('#cal-addev').onclick = () => A.ev.eventDialog(null, { date: sel });
    A.ev.bindEventRows(el);
    A.ev.bindNotif(el, () => renderCalendar(el));
    el.querySelectorAll('.cal-next [data-ev]').forEach(r => r.onclick = () => { const e = A.ev.eventsData().find(x => x.id === r.dataset.ev); if (e) { const d = new Date(e.date + 'T00:00'); cal = { y: d.getFullYear(), m: d.getMonth(), sel: e.date }; renderCalendar(el); } });
  }
  bindMiniTasks(el);
}
function miniTask(t, showDue) {
  const late = !t.done && t.due && t.due < dayStr();
  const dueTxt = showDue && t.due ? ` <span class="muted small">· ${WD[parseDay(t.due).getDay()]} ${parseDay(t.due).getDate()}</span>` : '';
  return `<div class="mini-task ${t.done ? 'done' : ''}"><button class="task-check" data-check="${t.id}" aria-label="Concluir">${ic('check')}</button>
    <span class="grow" data-edit="${t.id}">${esc(t.title)}${t.repeat ? ` <span class="muted small">↻</span>` : ''}${late ? ` <span class="late small">· atrasada</span>` : ''}${dueTxt}</span>
    ${t.folderId ? `<span class="dot" style="background:${A.folderColor(t.folderId)}"></span>` : ''}
    ${t.done ? '' : `<button class="star-btn ${t.top === dayStr() ? 'on' : ''}" data-top="${t.id}" aria-label="${t.top === dayStr() ? 'Tirar das prioridades de hoje' : 'Prioridade de hoje'}">${ic('star')}</button>`}</div>`;
}
function bindMiniTasks(el) {
  el.querySelectorAll('[data-check]').forEach(b => b.onclick = () => A.toggleTask(b.dataset.check));
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => A.taskDialog(A.state.tasks.find(t => t.id === b.dataset.edit)));
  el.querySelectorAll('[data-top]').forEach(b => b.onclick = () => setTop(b.dataset.top));
}
// As 3 tarefas mais importantes do dia
async function setTop(id) {
  const t = A.state.tasks.find(x => x.id === id);
  if (!t) return;
  const today = dayStr();
  if (t.top === today) t.top = '';
  else {
    if (A.state.tasks.filter(x => !x.done && x.top === today).length >= 3) { toast('Escolha no máximo 3 prioridades por dia. Tire uma antes.'); return; }
    t.top = today;
    toast('⭐ Prioridade de hoje');
  }
  await A.db.put('tasks', t);
  A.onChange();
}

// ======================= HOJE =======================
function renderToday(el) {
  const today = dayStr();
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
  const st = focusStats();
  const pend = A.state.tasks.filter(t => !t.done);
  const tops = pend.filter(t => t.top === today);
  const notTop = pend.filter(t => t.top !== today);
  const todayTasks = notTop.filter(t => t.due && t.due <= today).sort((a, b) => (a.due < b.due ? -1 : 1) || b.prio - a.prio);
  const noDate = notTop.filter(t => !t.due).sort((a, b) => b.prio - a.prio).slice(0, 3);
  const upcoming = notTop.filter(t => t.due && t.due > today && t.due <= addDays(today, 7)).sort((a, b) => (a.due < b.due ? -1 : 1));
  const doneTops = A.state.tasks.filter(t => t.done && t.top === today).length;
  const due = dueCards().length;
  const recent = [...A.state.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const streak = studyStreak();
  el.innerHTML = `<div class="today-head">
      <div><h2>${hello}! 👋</h2><p class="muted">${esc(longDate(today))}</p></div>
      ${A.levelBadge ? A.levelBadge() : ''}
      <div class="streak ${streak ? 'on' : ''}">🔥 <b>${streak}</b> <span>${streak === 1 ? 'dia seguido' : 'dias seguidos'} estudando</span></div>
    </div>
    ${A.todayTop ? A.todayTop.html() : ''}
    <div class="today-grid">
      <div class="panel t-tasks"><div class="p-head"><h3>${ic('tasks')}Tarefas de hoje</h3><button class="icon-btn small" id="td-add" aria-label="Nova tarefa">${ic('plus')}</button></div>
        <div class="top3 ${tops.length ? '' : 'empty'}"><h4>⭐ Prioridades de hoje <span class="muted">${tops.length + doneTops ? `${doneTops} de ${tops.length + doneTops} feitas` : ''}</span></h4>
          ${tops.length ? `<div class="mini-tasks">${tops.map(t => miniTask(t)).join('')}</div>` : '<p class="muted small">Toque na ⭐ de até 3 tarefas para focar no que mais importa hoje.</p>'}</div>
        <div class="mini-tasks">${todayTasks.map(t => miniTask(t)).join('') || (tops.length ? '' : '<p class="muted small">Nada com prazo para hoje. 🎉</p>')}</div>
        ${noDate.length ? `<h4>Sem prazo</h4><div class="mini-tasks">${noDate.map(t => miniTask(t)).join('')}</div>` : ''}
        ${upcoming.length ? `<h4>Próximos 7 dias</h4><div class="mini-tasks">${upcoming.slice(0, 5).map(t => miniTask(t, true)).join('')}</div>` : ''}
      </div>
      <div class="panel t-focus"><div class="p-head"><h3>${ic('timer')}Foco</h3></div>
        <div class="big-num">${fmtMin(st.today)}</div><div class="goal"><div class="goal-bar"><i style="width:${Math.min(100, (st.today / T.cfg.goal) * 100)}%"></i></div>
        <span class="muted small">Meta: ${fmtMin(T.cfg.goal)} por dia</span></div>
        <button class="btn primary" id="td-focus">${ic('timer')}<span>${T.running ? 'Ver o foco' : `Começar ${T.cfg.focus} min`}</span></button></div>
      <div class="panel t-cards"><div class="p-head"><h3>${ic('cards')}Flashcards</h3></div>
        <div class="big-num">${due}</div><p class="muted small">carta(s) para revisar hoje</p>
        <button class="btn ${due ? 'primary' : ''}" id="td-cards">${due ? 'Revisar agora' : 'Ver baralhos'}</button></div>
      <div class="panel t-habits"><div class="p-head"><h3>${ic('flame')}Hábitos de hoje</h3><button class="icon-btn small" id="td-habits" aria-label="Ver hábitos">${ic('right')}</button></div>
        <div class="habit-chips">${H.habits.map(hb => `<button class="hchip ${hb.days[today] ? 'on' : ''}" style="--c:${hb.color}" data-h="${hb.id}">${hb.days[today] ? ic('check') : '<span class="ring0"></span>'}<span>${esc(hb.name)}</span>${habitStreak(hb) ? `<em>🔥${habitStreak(hb)}</em>` : ''}</button>`).join('') || '<p class="muted small">Crie hábitos na aba Hábitos.</p>'}</div></div>
      ${A.extraToday ? A.extraToday.html() : ''}
      <div class="panel t-recent"><div class="p-head"><h3>${ic('book')}Continuar estudando</h3></div>
        <div class="recent">${recent.map(n => `<button class="recent-note" data-open="${n.id}">${n.thumb ? `<img src="${n.thumb}" alt="">` : `<span class="thumb-empty">${ic('page')}</span>`}<span>${esc(n.title)}</span></button>`).join('') || '<p class="muted small">Nenhuma anotação ainda.</p>'}</div></div>
    </div>`;
  el.querySelector('#td-add').onclick = () => A.taskDialog({ due: today });
  el.querySelector('#td-focus').onclick = () => { if (!T.running) startT(); A.goTo({ kind: 'focus' }); };
  el.querySelector('#td-cards').onclick = () => { A.goTo({ kind: 'cards' }); if (due) startReview(null, document.getElementById('view-hub')); };
  el.querySelector('#td-habits').onclick = () => A.goTo({ kind: 'habits' });
  el.querySelectorAll('.hchip').forEach(b => b.onclick = async () => { await toggleHabit(b.dataset.h); renderToday(el); A.onChange(true); });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => A.openNote(b.dataset.open));
  bindMiniTasks(el);
  if (A.extraToday) A.extraToday.bind(el);
  if (A.todayTop) A.todayTop.bind(el);
}

// ======================= roteamento =======================
let currentKind = null;
export function renderHub(kind, el) {
  currentKind = kind;
  if (kind !== 'cards') { review = null; }
  ({ today: renderToday, calendar: renderCalendar, focus: renderFocus, cards: renderCards, habits: renderHabits })[kind](el);
  tickUI();
}
export function leaveHub() { if (review) stopSpeak(); currentKind = null; review = null; document.body.classList.remove('zen'); tickUI(); }
function rerenderIf(kind) { if (currentKind === kind) { const el = document.getElementById('view-hub'); el && renderHub(kind, el); } }

export function hubNewAction(kind) {
  if (kind === 'cards') return deckDialog();
  if (kind === 'habits') return habitDialog();
  if (kind === 'calendar') return A.ev ? A.ev.eventDialog(null, { date: cal ? cal.sel : dayStr() }) : A.taskDialog({ due: cal ? cal.sel : dayStr() });
  if (kind === 'focus') return (T.running ? pauseT() : startT());
  return A.newNote();
}
export const HUB_NEW_LABEL = { today: 'Nova anotação', calendar: 'Novo evento', focus: 'Iniciar/pausar', cards: 'Novo baralho', habits: 'Novo hábito' };
export function hubCounts() { return { cards: dueCards().length, habits: H.habits.filter(hb => !hb.days[dayStr()]).length, running: T.running }; }
// ----- dados para outros módulos (relatório, leitura) -----
const RKEY = 'caderno-revisoes';
function logReview() {
  try { const m = JSON.parse(localStorage.getItem(RKEY) || '{}'); const d = dayStr(); m[d] = (m[d] || 0) + 1; localStorage.setItem(RKEY, JSON.stringify(m)); } catch { /* */ }
}
export function reviewsByDay() { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } }
export function hubData() { return H; }
export function focusCfg() { return T.cfg; }
export function startFocus() { if (!T.running) startT(); }
// Começa um foco já com a matéria e a tarefa escolhidas (usado pelo "O que fazer agora")
// Abre a Agenda já no dia escolhido
export function calendarOn(date) { const d = new Date(date + 'T00:00'); cal = { y: d.getFullYear(), m: d.getMonth(), sel: date }; A.goTo({ kind: 'calendar' }); }
export function startFocusFor({ folderId = '', taskId = '' } = {}) {
  if (T.running) { toast('Já existe um foco rodando'); return; }
  if (T.mode !== 'focus') resetT('focus');
  T.folderId = folderId; T.taskId = taskId; saveT();
  startT();
}
// Abre a revisão de todas as cartas vencidas
export function reviewNow() {
  A.goTo({ kind: 'cards' });
  const el = document.getElementById('view-hub');
  if (dueCards().length) startReview(null, el); else toast('Nenhuma carta para revisar agora 🎉');
}
export const dueCount = () => dueCards().length;
export const focusToday = () => H.sessions.filter(s => s.date === dayStr()).reduce((a, s) => a + s.minutes, 0);
export async function markHabitDone(id) { await toggleHabit(id); }
// Marca hoje o hábito cujo nome combina (ex.: leitura → "Ler 20 páginas")
export async function markHabitToday(regex) {
  const hb = H.habits.find(x => regex.test(x.name));
  if (!hb || hb.days[dayStr()]) return null;
  await toggleHabit(hb.id);
  return hb;
}

export async function reloadHub() {
  [H.sessions, H.habits, H.decks, H.cards] = await Promise.all(['sessions', 'habits', 'decks', 'cards'].map(s => A.db.all(s)));
}
