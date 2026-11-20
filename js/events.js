// Eventos importantes da agenda (provas, trabalhos, aniversários, consultas…): ficam salvos no banco,
// têm prioridade e avisam 1 dia antes (e no próprio dia) com notificação do tablet.
import { ic, esc, h, toast, modal } from './ui.js';
import { dayStr, addDays } from './hub.js';

let A;
let EV = [];
export const PRIO = { 1: { label: 'Baixa', cls: 'p1' }, 2: { label: 'Média', cls: 'p2' }, 3: { label: 'Alta', cls: 'p3' } };
const KINDS = [['prova', '📝', 'Prova'], ['trabalho', '📚', 'Trabalho'], ['aula', '🏫', 'Aula/Reunião'], ['consulta', '🩺', 'Consulta'], ['aniversario', '🎂', 'Aniversário'], ['outro', '📌', 'Outro']];
const kindIcon = k => (KINDS.find(x => x[0] === k) || KINDS[KINDS.length - 1])[1];
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDay = s => parseDay(s).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const sortEv = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : b.prio - a.prio);

export async function initEvents(api) {
  A = api;
  EV = await A.db.all('events');
  // avisos: ao abrir, a cada 15 min e quando o app volta para a tela
  setTimeout(() => checkReminders().catch(() => {}), 2500);
  setInterval(() => checkReminders().catch(() => {}), 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders().catch(() => {}); });
  registerBackground();
}
export async function reloadEvents() { EV = await A.db.all('events'); }
export const eventsData = () => EV;
export const eventsOn = day => EV.filter(e => e.date === day).sort(sortEv);
export const upcoming = (days = 60) => { const t = dayStr(), end = addDays(t, days); return EV.filter(e => e.date >= t && e.date <= end).sort(sortEv); };
export const whenText = d => { const n = Math.round((parseDay(d) - parseDay(dayStr())) / 86400000); return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : n < 0 ? `há ${-n} dia${n < -1 ? 's' : ''}` : `em ${n} dias`; };

async function save(ev) {
  ev.updatedAt = Date.now();
  await A.db.put('events', ev);
  const i = EV.findIndex(x => x.id === ev.id);
  if (i >= 0) EV[i] = ev; else EV.push(ev);
}

// Criar ou editar um evento
export async function eventDialog(ev, { date } = {}) {
  const isNew = !ev;
  ev = ev ? { ...ev } : { id: A.uid(), title: '', date: date || dayStr(), time: '', prio: 2, kind: 'outro', notes: '', remind: true, createdAt: Date.now() };
  const body = h(`<div class="ev-form">
    <label class="lbl">O que é</label>
    <input class="input" id="ev-title" value="${esc(ev.title)}" placeholder="Ex.: Prova de Matemática, Entrega do trabalho, Aniversário da mãe">
    <div class="ev-kinds" id="ev-kind">${KINDS.map(([k, e, l]) => `<button type="button" class="chip small ${ev.kind === k ? 'on' : ''}" data-k="${k}">${e} ${l}</button>`).join('')}</div>
    <div class="row"><div class="grow"><label class="lbl">Dia</label><input class="input" type="date" id="ev-date" value="${esc(ev.date)}"></div>
      <div class="grow"><label class="lbl">Hora (opcional)</label><input class="input" type="time" id="ev-time" value="${esc(ev.time || '')}"></div></div>
    <label class="lbl">Prioridade</label>
    <div class="seg ev-prio" id="ev-prio">${[1, 2, 3].map(p => `<button type="button" data-p="${p}" class="${PRIO[p].cls} ${+ev.prio === p ? 'active' : ''}">${PRIO[p].label}</button>`).join('')}</div>
    <label class="lbl">Observações</label>
    <textarea class="input" id="ev-notes" rows="2" placeholder="Local, o que levar, matéria da prova…">${esc(ev.notes || '')}</textarea>
    <label class="check"><input type="checkbox" id="ev-remind" ${ev.remind !== false ? 'checked' : ''}> 🔔 Avisar 1 dia antes (e no dia)</label>
  </div>`);
  let kind = ev.kind || 'outro', prio = +ev.prio || 2;
  body.querySelector('#ev-kind').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; body.querySelectorAll('#ev-kind .chip').forEach(x => x.classList.toggle('on', x === b)); };
  body.querySelector('#ev-prio').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; prio = +b.dataset.p; body.querySelectorAll('#ev-prio button').forEach(x => x.classList.toggle('active', x === b)); };
  const res = await modal({
    title: isNew ? 'Novo evento' : 'Editar evento', body,
    actions: [
      ...(isNew ? [] : [{ label: 'Apagar', value: 'del', danger: true }]),
      { label: 'Cancelar', value: null },
      {
        label: 'Salvar', primary: true,
        validate: el => { if (!el.querySelector('#ev-title').value.trim()) { toast('Escreva o nome do evento'); return false; } if (!el.querySelector('#ev-date').value) { toast('Escolha o dia'); return false; } return true; },
        value: el => ({ title: el.querySelector('#ev-title').value.trim(), date: el.querySelector('#ev-date').value, time: el.querySelector('#ev-time').value, notes: el.querySelector('#ev-notes').value.trim(), remind: el.querySelector('#ev-remind').checked }),
      },
    ],
  });
  if (res === 'del') { await deleteEvent(ev.id); return null; }
  if (!res) return null;
  const dateChanged = res.date !== ev.date;
  Object.assign(ev, res, { kind, prio });
  if (dateChanged || isNew) ev.notified = {};
  // quem cria um evento para hoje ou amanhã já sabe dele: não precisa de aviso agora
  const today = dayStr();
  if (ev.date === addDays(today, 1)) ev.notified = { ...ev.notified, before: ev.date };
  if (ev.date === today) ev.notified = { before: ev.date, day: ev.date };
  await save(ev);
  toast(isNew ? `Evento salvo 📅 ${ev.remind ? '— aviso 1 dia antes' : ''}` : 'Evento salvo');
  if (ev.remind) askPermission();
  A.onChange();
  return ev;
}

// Apagar com "Desfazer"
export async function deleteEvent(id) {
  const ev = EV.find(x => x.id === id);
  if (!ev) return;
  await A.db.del('events', id);
  EV = EV.filter(x => x.id !== id);
  A.onChange();
  toast(`Evento apagado: ${ev.title}`, 5000, { label: 'Desfazer', run: async () => { await save(ev); A.onChange(); toast('Evento de volta ✓'); } });
}

// ---------- avisos ----------
export const notifState = () => (!('Notification' in window) ? 'unsupported' : Notification.permission);
export async function askPermission() {
  if (notifState() !== 'default') return notifState();
  try { const p = await Notification.requestPermission(); if (p === 'granted') registerBackground(); return p; } catch { return notifState(); }
}
async function show(title, body, tag) {
  if (notifState() === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.ready;
      const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag, data: { url: './?v=calendar' }, vibrate: [200, 100, 200] };
      if (reg) { await reg.showNotification(title, opts); return true; }
      new Notification(title, opts); return true;
    } catch { /* cai no aviso dentro do app */ }
  }
  return false;
}
const line = e => `${kindIcon(e.kind)} ${e.title}${e.time ? ` às ${e.time}` : ''}${+e.prio === 3 ? ' · prioridade ALTA' : ''}`;
export async function checkReminders() {
  const today = dayStr(), tomorrow = addDays(today, 1);
  const msgs = [];
  for (const e of EV) {
    if (e.remind === false) continue;
    const n = e.notified || {};
    let kind = null;
    if (e.date === tomorrow && n.before !== e.date) kind = 'before';
    else if (e.date === today && n.day !== e.date) kind = 'day';
    if (!kind) continue;
    const title = kind === 'before' ? 'Amanhã' : 'Hoje';
    const sent = await show(`📅 ${title}: ${e.title}`, line(e) + (e.notes ? `\n${e.notes}` : ''), `ev-${e.id}-${kind}`);
    msgs.push({ title, e, sent });
    e.notified = { ...n, [kind]: e.date, ...(kind === 'day' ? { before: e.date } : {}) };
    await save(e);
  }
  // dentro do app também aparece o aviso
  if (msgs.length) toast(msgs.map(m => `📅 ${m.title}: ${m.e.title}${m.e.time ? ` às ${m.e.time}` : ''}`).join('\n'), 7000);
  return msgs.length;
}
// Com o app instalado, o Chrome pode acordar o app de vez em quando para conferir os avisos mesmo fechado
async function registerBackground() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg) || notifState() !== 'granted') return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await reg.periodicSync.register('lembretes', { minInterval: 4 * 60 * 60 * 1000 });
  } catch { /* nem todo navegador deixa */ }
}
export async function testNotification() {
  const p = await askPermission();
  if (p !== 'granted') { toast(p === 'denied' ? 'Os avisos estão bloqueados. Libere em Configurações do Android → Apps → Chrome (ou Caderno) → Notificações.' : 'Este navegador não mostra avisos', 6000); return false; }
  const ok = await show('📅 Avisos ligados', 'Você vai receber um aviso 1 dia antes dos seus eventos.', 'ev-teste');
  toast(ok ? 'Avisos ligados ✓' : 'Não consegui mostrar o aviso', 3500);
  return ok;
}

// ---------- pedaços de tela ----------
export function eventRow(e, { showDate = false } = {}) {
  return `<div class="ev-row ${PRIO[e.prio]?.cls || 'p2'}" data-ev="${e.id}">
    <span class="ev-ic">${kindIcon(e.kind)}</span>
    <span class="grow ev-txt"><b>${esc(e.title)}</b><small><span class="ev-badge ${PRIO[e.prio]?.cls || 'p2'}">${PRIO[e.prio]?.label || 'Média'}</span> ${[showDate ? `${esc(fmtDay(e.date))} · ${whenText(e.date)}` : '', e.time ? esc(e.time) : '', e.notes ? esc(e.notes) : '', e.remind !== false ? '🔔' : ''].filter(Boolean).join(' · ')}</small></span>
    <button class="icon-btn small" data-evedit="${e.id}" aria-label="Editar evento">${ic('edit')}</button>
    <button class="icon-btn small ev-del" data-evdel="${e.id}" aria-label="Apagar evento">${ic('trash')}</button>
  </div>`;
}
export function bindEventRows(el) {
  el.querySelectorAll('[data-evedit]').forEach(b => b.onclick = e => { e.stopPropagation(); eventDialog(EV.find(x => x.id === b.dataset.evedit)); });
  el.querySelectorAll('[data-evdel]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteEvent(b.dataset.evdel); });
}
export function notifHTML() {
  const st = notifState();
  if (st === 'granted') return `<p class="muted small ev-notif">🔔 Avisos ligados: você recebe um aviso 1 dia antes de cada evento. <button class="link" id="ev-testn">Testar</button></p>`;
  if (st === 'unsupported') return '<p class="muted small ev-notif">Este navegador não mostra avisos; eles aparecem dentro do app.</p>';
  return `<div class="ev-notif off"><span class="grow small">${st === 'denied' ? '🔕 Os avisos estão bloqueados no Android.' : '🔔 Ligue os avisos para lembrar 1 dia antes.'}</span><button class="btn small-btn" id="ev-testn">Ligar avisos</button></div>`;
}
export function bindNotif(el, rerender) { const b = el.querySelector('#ev-testn'); if (b) b.onclick = async () => { await testNotification(); rerender && rerender(); }; }

// Cartão do painel Hoje: próximos eventos
export const eventsToday = {
  html() {
    const list = upcoming(14).slice(0, 4);
    if (!list.length) return '';
    return `<div class="panel t-events"><div class="p-head"><h3>${ic('calendar')}Próximos eventos</h3><button class="icon-btn small" data-goto="calendar" aria-label="Ver agenda">${ic('right')}</button></div>
      ${list.map(e => `<div class="ev-mini ${PRIO[e.prio]?.cls || 'p2'}"><span>${kindIcon(e.kind)}</span><span class="grow">${esc(e.title)}</span><b class="${e.date <= addDays(dayStr(), 1) ? 'late' : 'muted'} small">${whenText(e.date)}${e.time ? ` ${esc(e.time)}` : ''}</b></div>`).join('')}</div>`;
  },
  bind() { /* [data-goto] ligado pelo painel */ },
};
