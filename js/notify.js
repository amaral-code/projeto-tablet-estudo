// Central de Avisos: lembretes no tablet de eventos, tarefas, provas, aulas, flashcards, hábitos
// e "hora de estudar". O app confere os avisos a cada 30 s enquanto está aberto ou em segundo plano;
// com o app fechado, o service worker confere quando o Android deixa (periodic background sync).
// Para eventos importantes, o botão "Google Agenda" garante o alarme do celular.
import './avisos-core.js';
import { ic, esc, h, toast } from './ui.js';
import { download } from './export.js';

const C = self.AvisosCore;
let A;
export const NOTIFY_VIEWS = { avisos: { title: 'Avisos e lembretes', icon: 'bell' } };
const PREF_KEY = 'caderno-avisos';
export const avisoPrefs = () => { try { return { ...C.DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...C.DEFAULTS }; } };
const savePrefs = async p => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* */ } await kvUpdate({ prefs: p }); };
const perm = () => (!('Notification' in window) ? 'unsupported' : Notification.permission);

async function kvGet() { return (await A.db.get('kv', 'avisos')) || { id: 'avisos', fired: {}, prefs: avisoPrefs() }; }
async function kvUpdate(patch) { const cur = await kvGet(); Object.assign(cur, patch); await A.db.put('kv', cur); return cur; }

let bg = 'nao';
export async function initNotify(api) {
  A = api;
  await kvUpdate({ prefs: avisoPrefs() });
  setTimeout(() => tick().catch(() => {}), 2500);
  setInterval(() => tick().catch(() => {}), 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick().catch(() => {}); });
  registerBackground();
}

// Os dados que o motor usa (os mesmos que o service worker lê do banco)
function gather() {
  const ext = A.notifyData ? A.notifyData() : {};
  return { events: A.ev ? A.ev.eventsData() : [], tasks: A.state.tasks, folders: A.state.folders, ...ext };
}
export const upcomingAvisos = (now = Date.now()) => C.compute(gather(), avisoPrefs(), now);

async function show(r) {
  if (perm() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const opts = { body: r.body, tag: r.id, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: r.url }, vibrate: [200, 100, 200] };
    if (reg) await reg.showNotification(r.title, opts); else new Notification(r.title, opts);
    return true;
  } catch { return false; }
}
// Confere e mostra os avisos que chegaram na hora. Devolve quantos mostrou.
let ticking = false;
export async function tick(now = Date.now()) {
  if (ticking || !A) return 0;
  ticking = true;
  try {
    const kv = await kvGet();
    const due = C.due(upcomingAvisos(now), kv.fired, now);
    if (!due.length) return 0;
    for (const r of due) { await show(r); kv.fired[r.id] = now; }
    kv.fired = C.prune(kv.fired, now);
    await A.db.put('kv', kv);
    if (!document.hidden) toast(due.map(r => r.title).join('\n'), 7000);
    return due.length;
  } finally { ticking = false; }
}
// Um evento recém-criado não precisa avisar do que já passou (ex.: criou hoje um evento de hoje)
export async function skipPastFor(id, now = Date.now()) {
  const kv = await kvGet();
  for (const r of C.due(upcomingAvisos(now), kv.fired, now)) if (r.id.includes(id)) kv.fired[r.id] = now;
  await A.db.put('kv', kv);
}

export async function askPermission() {
  if (perm() !== 'default') return perm();
  try { const p = await Notification.requestPermission(); if (p === 'granted') registerBackground(); return p; } catch { return perm(); }
}
async function registerBackground() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg) || perm() !== 'granted') { bg = 'nao'; return; }
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') { bg = 'sem-permissao'; return; }
    await reg.periodicSync.register('lembretes', { minInterval: 60 * 60 * 1000 });
    bg = 'sim';
  } catch { bg = 'nao'; }
}
export async function testNotification() {
  const p = await askPermission();
  if (p !== 'granted') { toast(p === 'denied' ? 'Os avisos estão bloqueados: libere em Configurações do Android → Apps → Chrome (ou Caderno) → Notificações.' : 'Este navegador não mostra avisos', 6000); return false; }
  const ok = await show({ id: 'teste', title: '🔔 Avisos ligados', body: 'É assim que os lembretes vão aparecer.', url: './?v=avisos' });
  toast(ok ? 'Aviso de teste enviado ✓' : 'Não consegui mostrar o aviso', 3500);
  return ok;
}

// ---------- Google Agenda e arquivo .ics ----------
const pad = n => String(n).padStart(2, '0');
const stamp = (d, t) => `${d.replace(/-/g, '')}T${t.replace(':', '')}00`;
export function gcalURL(e) {
  let dates;
  if (e.time) { const [hh, mm] = e.time.split(':').map(Number); const end = `${pad((hh + 1) % 24)}:${pad(mm)}`; dates = `${stamp(e.date, e.time)}/${stamp(hh + 1 >= 24 ? C.addDays(e.date, 1) : e.date, end)}`; }
  else dates = `${e.date.replace(/-/g, '')}/${C.addDays(e.date, 1).replace(/-/g, '')}`;
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dates}&details=${encodeURIComponent((e.notes ? e.notes + '\n' : '') + 'Criado no Caderno de Estudos')}${tz ? `&ctz=${encodeURIComponent(tz)}` : ''}`;
}
export function icsFile(events) {
  const esc2 = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const now = new Date(); const dt = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Caderno de Estudos//PT-BR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@caderno-estudos`, `DTSTAMP:${dt}`);
    if (e.time) { const [hh, mm] = e.time.split(':').map(Number); lines.push(`DTSTART:${stamp(e.date, e.time)}`, `DTEND:${stamp(hh + 1 >= 24 ? C.addDays(e.date, 1) : e.date, `${pad((hh + 1) % 24)}:${pad(mm)}`)}`); }
    else lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${C.addDays(e.date, 1).replace(/-/g, '')}`);
    lines.push(`SUMMARY:${esc2(e.title)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc2(e.notes)}`);
    if (e.remind !== false) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(e.title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(e.title)}`, `TRIGGER:${e.time ? '-PT1H' : 'PT7H'}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new File([lines.join('\r\n')], 'eventos-caderno.ics', { type: 'text/calendar' });
}

// ---------- tela ----------
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const whenLabel = t => {
  const d = new Date(t), today = C.day(new Date()), dd = C.day(d);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return dd === today ? `hoje ${hm}` : dd === C.addDays(today, 1) ? `amanhã ${hm}` : `${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`;
};
const timeIn = (k, v) => `<input class="input av-time" type="time" data-p="${k}" value="${esc(v)}">`;
const sel = (k, v, opts) => `<select class="select" data-p="${k}">${opts.map(([val, l]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const sw = (k, on, title, desc, extra = '') => `<div class="av-row ${on ? '' : 'off'}"><label class="switch"><input type="checkbox" data-p="${k}" ${on ? 'checked' : ''}><span><b>${title}</b><small>${desc}</small></span></label>${on ? `<div class="av-opts">${extra}</div>` : ''}</div>`;

export async function renderAvisos(el) {
  const p = avisoPrefs(), st = perm();
  const kv = await kvGet();
  const now = Date.now();
  const next = upcomingAvisos(now).filter(r => r.at > now || (r.until >= now && !kv.fired[r.id])).slice(0, 25);
  el.innerHTML = `<div class="av-wrap">
    <div class="panel av-status ${st === 'granted' ? 'ok' : 'warn'}">
      <div class="av-big">${ic('bell')}</div>
      <div class="grow">${st === 'granted' ? `<h3>Avisos do tablet ligados ✓</h3><p class="muted small">${bg === 'sim' ? 'Com o app fechado, o Android acorda o Caderno de tempos em tempos para avisar (pode atrasar um pouco).' : 'Os avisos chegam na hora com o app aberto ou em segundo plano. Para avisar com ele fechado, instale o app na tela inicial.'}</p>`
        : st === 'denied' ? '<h3>Avisos bloqueados no Android</h3><p class="muted small">Libere em Configurações do Android → Apps → Chrome (ou Caderno) → Notificações. Enquanto isso, os avisos aparecem só dentro do app.</p>'
        : st === 'unsupported' ? '<h3>Este navegador não mostra avisos</h3><p class="muted small">Os lembretes aparecem dentro do app.</p>'
        : '<h3>Ligue os avisos</h3><p class="muted small">Toque no botão e permita as notificações para receber os lembretes no tablet.</p>'}</div>
      <button class="btn ${st === 'granted' ? '' : 'primary'}" id="av-test">${ic('bell')}<span>${st === 'granted' ? 'Testar aviso' : 'Ligar avisos'}</span></button>
    </div>
    <div class="panel av-tip"><p>💡 <b>Para não perder nada importante:</b> em cada evento da Agenda há o botão <span class="av-inline">${ic('calendar')}</span> <b>Google Agenda</b>. O alarme do Google Agenda toca mesmo com o Caderno fechado. Ou mande todos os eventos de uma vez:</p>
      <button class="btn small-btn" id="av-ics">${ic('download')}<span>Baixar eventos (.ics)</span></button></div>
    <div class="av-grid">
      <div class="panel"><h3>${ic('settings')}O que avisar</h3>
        ${sw('events', p.events, '📅 Eventos da agenda', 'Na véspera e no dia', `<label>Véspera às ${timeIn('eveTime', p.eveTime)}</label><label>No dia (sem hora) às ${timeIn('dayTime', p.dayTime)}</label><label>Com hora: ${sel('beforeMin', p.beforeMin, [[0, 'na hora'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 h antes'], [120, '2 h antes']])}</label>`)}
        ${sw('tasks', p.tasks, '✅ Tarefas com prazo', 'Resumo das tarefas do dia', `<label>Às ${timeIn('tasksTime', p.tasksTime)}</label>`)}
        ${sw('exams', p.exams, '📝 Provas', '3 dias antes e na véspera (no horário da véspera)')}
        ${sw('classes', p.classes, '🏫 Aulas do horário', 'Antes de cada aula', `<label>${sel('classMin', p.classMin, [[0, 'na hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes']])}</label>`)}
        ${sw('cards', p.cards, '🃏 Flashcards para revisar', 'Só quando há cartas vencidas', `<label>Às ${timeIn('cardsTime', p.cardsTime)}</label>`)}
        ${sw('habits', p.habits, '🔥 Hábitos', 'Se faltar algum hábito no dia', `<label>Às ${timeIn('habitsTime', p.habitsTime)}</label>`)}
        ${sw('study', p.study, '📚 Hora de estudar', 'Um lembrete por dia nos dias escolhidos', `<label>Às ${timeIn('studyTime', p.studyTime)}</label><div class="av-days">${DAYS.map((d, i) => `<button type="button" class="chip small ${(p.studyDays || []).map(Number).includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('')}</div>`)}
      </div>
      <div class="panel"><h3>${ic('clock')}Próximos avisos</h3>
        <div class="av-next">${next.map(r => `<div class="av-item ${r.at <= now ? 'now' : ''}"><span class="av-when">${r.at <= now ? 'agora' : whenLabel(r.at)}</span><span class="grow"><b>${esc(r.title)}</b>${r.body ? `<small>${esc(r.body.split('\n')[0])}</small>` : ''}</span></div>`).join('') || '<p class="muted small">Nenhum aviso nos próximos dias. Crie eventos na Agenda, tarefas com prazo ou ligue a “Hora de estudar”.</p>'}</div>
      </div>
    </div></div>`;
  const rerender = () => renderAvisos(el);
  el.querySelector('#av-test').onclick = async () => { await testNotification(); rerender(); };
  el.querySelector('#av-ics').onclick = () => {
    const evs = (A.ev ? A.ev.eventsData() : []).filter(e => e.date >= C.day(new Date()));
    if (!evs.length) { toast('Nenhum evento futuro para exportar'); return; }
    download(icsFile(evs)); toast(`${evs.length} evento(s) exportado(s): abra o arquivo para pôr no Google Agenda`, 4500);
  };
  el.querySelectorAll('[data-p]').forEach(inp => inp.onchange = async () => {
    const q = avisoPrefs(), k = inp.dataset.p;
    q[k] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? +inp.value : inp.value;
    await savePrefs(q);
    if (inp.type === 'checkbox' && inp.checked && perm() === 'default') await askPermission();
    rerender();
  });
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = async () => {
    const q = avisoPrefs(), d = +b.dataset.day, set = new Set((q.studyDays || []).map(Number));
    set.has(d) ? set.delete(d) : set.add(d);
    q.studyDays = [...set].sort(); await savePrefs(q); rerender();
  });
}
