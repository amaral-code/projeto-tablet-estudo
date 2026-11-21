// Mais produtividade: Horário de aulas, Diário de estudos, Revisão espaçada de anotações,
// e as visões Quadro (Kanban) e Matriz de prioridades das tarefas.
import { ic, esc, h, toast, modal, confirmBox, menu, richText } from './ui.js';
import { journalLocked, isUnlocked, lockedScreen } from './lock.js';
import { dayStr, addDays } from './hub.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';

let A;
const X = { classes: [], journal: [] };
export const PLUS_VIEWS = {
  schedule: { title: 'Horário de aulas', icon: 'clock' },
  journal: { title: 'Diário', icon: 'journal' },
};
export const PLUS_NEW_LABEL = { schedule: 'Nova aula', journal: 'Escrever hoje' };
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDay(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const toMin = t => { const [hh, mm] = String(t || '0:0').split(':').map(Number); return hh * 60 + (mm || 0); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export async function initPlus(api) {
  A = api;
  [X.classes, X.journal] = await Promise.all(['classes', 'journal'].map(s => A.db.all(s)));
}
export async function reloadPlus() { [X.classes, X.journal] = await Promise.all(['classes', 'journal'].map(s => A.db.all(s))); }

// ======================= HORÁRIO DE AULAS =======================
const subjName = c => (c.folderId ? A.folderName(c.folderId) : '') || c.name || 'Aula';
const subjColor = c => (c.folderId ? A.folderColor(c.folderId) : c.color || '#6b7280');

export function classNow(date = new Date()) {
  const wd = date.getDay(), m = date.getHours() * 60 + date.getMinutes();
  const today = X.classes.filter(c => c.day === wd).sort((a, b) => toMin(a.start) - toMin(b.start));
  return { now: today.find(c => toMin(c.start) <= m && m < toMin(c.end)) || null, next: today.find(c => toMin(c.start) > m) || null, today };
}

async function classDialog(c, preset = {}) {
  const isNew = !c;
  c = c ? { ...c } : { id: A.uid(), folderId: '', name: '', day: preset.day ?? new Date().getDay(), start: preset.start || '07:30', end: preset.end || '08:20', room: '', teacher: '' };
  const res = await modal({
    title: isNew ? 'Nova aula' : 'Editar aula',
    body: `<label class="lbl">Matéria</label><select class="select full" id="cl-folder">${A.folderOptions(c.folderId, 'Outra (digite abaixo)')}</select>
      <input class="input" id="cl-name" value="${esc(c.name)}" placeholder="Nome, se não for uma pasta (ex.: Educação Física)" style="margin-top:6px">
      <label class="lbl">Dia</label><select class="select full" id="cl-day">${DAYS.map((d, i) => `<option value="${i}" ${+c.day === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <div class="row"><div class="grow"><label class="lbl">Início</label><input class="input" type="time" id="cl-start" value="${esc(c.start)}"></div>
      <div class="grow"><label class="lbl">Fim</label><input class="input" type="time" id="cl-end" value="${esc(c.end)}"></div></div>
      <div class="row"><div class="grow"><label class="lbl">Sala</label><input class="input" id="cl-room" value="${esc(c.room || '')}"></div>
      <div class="grow"><label class="lbl">Professor(a)</label><input class="input" id="cl-teacher" value="${esc(c.teacher || '')}"></div></div>
      ${isNew ? '<label class="check"><input type="checkbox" id="cl-rep"> Repetir no mesmo horário de segunda a sexta</label>' : ''}`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', primary: true,
      validate: el => {
        if (!el.querySelector('#cl-folder').value && !el.querySelector('#cl-name').value.trim()) { toast('Escolha a matéria ou digite o nome'); return false; }
        if (toMin(el.querySelector('#cl-end').value) <= toMin(el.querySelector('#cl-start').value)) { toast('O fim precisa ser depois do início'); return false; }
        return true;
      },
      value: el => ({
        folderId: el.querySelector('#cl-folder').value, name: el.querySelector('#cl-name').value.trim(), day: +el.querySelector('#cl-day').value,
        start: el.querySelector('#cl-start').value, end: el.querySelector('#cl-end').value, room: el.querySelector('#cl-room').value.trim(),
        teacher: el.querySelector('#cl-teacher').value.trim(), rep: !!el.querySelector('#cl-rep')?.checked,
      }),
    }],
  });
  if (!res) return;
  const { rep, ...data } = res;
  const days = rep ? [1, 2, 3, 4, 5] : [data.day];
  for (const [i, d] of days.entries()) {
    const item = { ...c, ...data, day: d, id: i === 0 ? c.id : A.uid() };
    await A.db.put('classes', item);
    const k = X.classes.findIndex(x => x.id === item.id);
    if (k >= 0) X.classes[k] = item; else X.classes.push(item);
  }
  A.onChange();
}

// Cria (ou abre) a anotação da aula de hoje na pasta da matéria
export async function noteForClass(c) {
  const title = `${subjName(c)} — ${fmtDate(dayStr())}`;
  const existing = A.state.notes.find(n => n.title === title);
  if (existing) { await A.openNote(existing.id); return existing; }
  return A.createNote({ title, folderId: c.folderId || '', bg: { type: 'lines', color: 'white' } });
}

function renderSchedule(el) {
  // fim de semana aparece se houver aula nele ou se hoje for sábado/domingo (para cadastrar aula de sábado)
  const showWeekend = X.classes.some(c => c.day === 0 || c.day === 6) || [0, 6].includes(new Date().getDay());
  const days = showWeekend ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5];
  const wd = new Date().getDay(), m = nowMin();
  const { now, next } = classNow();
  el.innerHTML = `<div class="panel now-class">
      ${now ? `<div><span class="muted small">AGORA</span><h3><span class="dot" style="background:${subjColor(now)}"></span>${esc(subjName(now))}</h3><span class="muted small">até ${now.end}${now.room ? ` · sala ${esc(now.room)}` : ''}</span></div>
        <button class="btn primary" data-note="${now.id}">${ic('edit')}<span>Anotar nesta aula</span></button>`
      : `<div><span class="muted small">AGORA</span><h3>Sem aula neste horário</h3></div>`}
      ${next ? `<div class="next"><span class="muted small">PRÓXIMA</span><b>${esc(subjName(next))}</b><span class="muted small">às ${next.start}</span></div>` : ''}
    </div>
    <div class="week-grid" style="--cols:${days.length}">${days.map(d => {
      const list = X.classes.filter(c => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
      return `<div class="day-col ${d === wd ? 'today' : ''}"><div class="day-h">${DAYS[d]}</div>
        ${list.map(c => `<button class="class-block ${d === wd && toMin(c.start) <= m && m < toMin(c.end) ? 'now' : ''}" data-c="${c.id}" style="--c:${subjColor(c)}">
          <b>${esc(subjName(c))}</b><span>${c.start}–${c.end}</span>${c.room ? `<span>${esc(c.room)}</span>` : ''}</button>`).join('')}
        <button class="class-add" data-day="${d}" aria-label="Adicionar aula na ${DAYS[d]}">${ic('plus')}</button></div>`;
    }).join('')}</div>
    ${X.classes.length ? '' : '<p class="muted">Cadastre suas aulas para ver “Agora / Próxima” no painel Hoje e criar a anotação de cada aula com um toque.</p>'}`;
  el.querySelectorAll('[data-note]').forEach(b => b.onclick = () => noteForClass(X.classes.find(c => c.id === b.dataset.note)));
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    const prev = X.classes.filter(c => c.day === +b.dataset.day).sort((a, b2) => toMin(b2.end) - toMin(a.end))[0];
    const st = prev ? prev.end : '07:30';
    const en = `${String(Math.floor((toMin(st) + 50) / 60) % 24).padStart(2, '0')}:${String((toMin(st) + 50) % 60).padStart(2, '0')}`;
    classDialog(null, { day: +b.dataset.day, start: st, end: en });
  });
  el.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    const c = X.classes.find(x => x.id === b.dataset.c);
    const a = await menu(`${subjName(c)} · ${DAYS[c.day]} ${c.start}`, [
      { label: 'Anotar nesta aula', icon: 'edit', value: 'note' },
      { label: 'Anotar e gravar o áudio da aula', icon: 'mic', value: 'rec' },
      { label: 'Tarefa para esta matéria', icon: 'tasks', value: 'task' },
      { label: 'Editar', icon: 'settings', value: 'edit' },
      { label: 'Excluir', icon: 'trash', value: 'del', danger: true },
    ]);
    if (a === 'note') noteForClass(c);
    else if (a === 'rec') { const meta = await noteForClass(c); if (meta) A.startRecording(meta); }
    else if (a === 'task') A.taskDialog({ folderId: c.folderId || '' });
    else if (a === 'edit') classDialog(c);
    else if (a === 'del' && await confirmBox('Excluir aula', `Excluir ${subjName(c)} de ${DAYS[c.day]} às ${c.start}?`, 'Excluir')) {
      await A.db.del('classes', c.id); X.classes = X.classes.filter(x => x.id !== c.id); A.onChange();
    }
  });
}

// ======================= DIÁRIO DE ESTUDOS =======================
const MOODS = ['😫', '😕', '😐', '🙂', '🤩'];
function journalStreak() {
  const set = new Set(X.journal.map(j => j.id));
  let d = dayStr(); if (!set.has(d)) d = addDays(d, -1);
  let n = 0; while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
let journalAI = null;
function renderJournal(el) {
  if (journalLocked() && !isUnlocked()) { lockedScreen(el, 'O Diário', () => renderJournal(el)); return; }
  const today = dayStr();
  const e = X.journal.find(j => j.id === today) || { id: today, mood: 0, learned: '', hard: '', tomorrow: '' };
  const past = X.journal.filter(j => j.id !== today).sort((a, b) => (a.id < b.id ? 1 : -1));
  el.innerHTML = `<div class="journal-wrap"><form class="panel journal-form" id="jr-form">
      <div class="row"><h3 class="grow">${ic('journal')}Hoje, ${fmtDate(today)}</h3><span class="muted small">🔥 ${journalStreak()} dia(s) seguidos</span></div>
      <label class="lbl">Como foi seu dia de estudos?</label>
      <div class="moods" id="jr-moods">${MOODS.map((m, i) => `<button type="button" class="mood ${e.mood === i + 1 ? 'on' : ''}" data-m="${i + 1}" aria-label="Humor ${i + 1}">${m}</button>`).join('')}</div>
      <label class="lbl">O que eu aprendi hoje</label><textarea class="input" id="jr-learned" rows="3" placeholder="Ex.: aprendi a somar frações com denominadores diferentes…">${esc(e.learned)}</textarea>
      <label class="lbl">O que foi difícil (para revisar)</label><textarea class="input" id="jr-hard" rows="2">${esc(e.hard)}</textarea>
      <label class="lbl">Meu plano para amanhã</label><textarea class="input" id="jr-tomorrow" rows="2">${esc(e.tomorrow)}</textarea>
      <div class="row wrap"><button class="btn primary" type="submit">${ic('check')}<span>Salvar</span></button><span class="muted small jr-auto" id="jr-auto">${e.updatedAt ? '✓ Salva sozinho enquanto você escreve' : 'Salva sozinho enquanto você escreve'}</span>
        ${e.hard ? `<button class="btn" type="button" id="jr-task">${ic('tasks')}<span>Virar tarefa de revisão</span></button>` : ''}</div>
    </form>
    <div class="panel"><div class="row"><h3 class="grow">Últimos dias</h3><button class="btn ai-btn" id="jr-ai">${ic('magic')}<span>Resumo do mês com IA</span></button></div>
      <div class="ai-out" id="jr-out" ${journalAI ? '' : 'hidden'}>${journalAI ? richText(cleanText(journalAI)) : ''}</div>
      <div class="journal-list">${past.slice(0, 30).map(j => `<div class="jr-item"><div class="row"><b>${fmtDate(j.id)}</b><span>${MOODS[(j.mood || 3) - 1]}</span></div>
        ${j.learned ? `<p>📚 ${esc(j.learned)}</p>` : ''}${j.hard ? `<p>⚠️ ${esc(j.hard)}</p>` : ''}${j.tomorrow ? `<p>➡️ ${esc(j.tomorrow)}</p>` : ''}</div>`).join('') || '<p class="muted small">Seus registros aparecem aqui.</p>'}</div>
    </div></div>`;
  let mood = e.mood;
  // guarda os campos agora: se você trocar de tela antes do salvamento automático, ele ainda lê o que foi escrito
  const fLearned = el.querySelector('#jr-learned'), fHard = el.querySelector('#jr-hard'), fTomorrow = el.querySelector('#jr-tomorrow'), stEl = el.querySelector('#jr-auto');
  const collect = () => ({ id: today, mood, learned: fLearned.value.trim(), hard: fHard.value.trim(), tomorrow: fTomorrow.value.trim(), updatedAt: Date.now() });
  const persist = async item => {
    await A.db.put('journal', item);
    const i = X.journal.findIndex(j => j.id === today);
    if (i >= 0) X.journal[i] = item; else X.journal.push(item);
  };
  // salva sozinho enquanto você escreve (sem redesenhar a tela, para não atrapalhar a digitação)
  let autoT = 0;
  const autoSave = () => {
    const st = stEl; if (st) st.textContent = 'Salvando…';
    clearTimeout(autoT);
    autoT = setTimeout(async () => {
      const item = collect();
      if (!item.mood && !item.learned && !item.hard && !item.tomorrow) { if (st) st.textContent = 'Salva sozinho enquanto você escreve'; return; }
      try { await persist(item); if (st && st.isConnected) st.textContent = '✓ Salvo automaticamente'; }
      catch { if (st && st.isConnected) st.textContent = '⚠️ Não salvou — toque em Salvar'; }
    }, 700);
  };
  el.querySelector('#jr-form').addEventListener('input', autoSave);
  const flushJournal = () => { if (autoT && fLearned.isConnected) { clearTimeout(autoT); const item = collect(); if (item.mood || item.learned || item.hard || item.tomorrow) persist(item); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushJournal(); }, { once: true });
  el.querySelector('#jr-moods').onclick = ev => {
    const b = ev.target.closest('[data-m]'); if (!b) return;
    mood = +b.dataset.m; el.querySelectorAll('.mood').forEach(x => x.classList.toggle('on', x === b));
    autoSave();
  };
  el.querySelector('#jr-form').onsubmit = async ev => {
    ev.preventDefault();
    clearTimeout(autoT);
    const item = collect();
    if (!item.mood && !item.learned && !item.hard && !item.tomorrow) { toast('Escreva algo ou escolha como foi seu dia'); return; }
    await persist(item);
    toast('Diário salvo ✓');
    A.onChange();
  };
  el.querySelector('#jr-task')?.addEventListener('click', async () => {
    await A.addTask({ title: `Revisar: ${e.hard.slice(0, 80)}`, due: addDays(today, 1), prio: 2 });
    toast('Tarefa de revisão criada para amanhã ✓'); A.onChange(true);
  });
  el.querySelector('#jr-ai').onclick = async () => {
    if (!aiConfigured()) { toast('Configure a IA em Ajustes → Inteligência artificial'); return; }
    const since = addDays(today, -30);
    const items = X.journal.filter(j => j.id >= since).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!items.length) { toast('Escreva no diário primeiro'); return; }
    const out = el.querySelector('#jr-out'); out.hidden = false; out.textContent = 'Lendo seu diário…';
    const txt = items.map(j => `${j.id} humor ${j.mood || '-'}/5. Aprendi: ${j.learned || '-'}. Difícil: ${j.hard || '-'}. Amanhã: ${j.tomorrow || '-'}`).join('\n');
    journalAI = '';
    try {
      const r = streamChat([{ role: 'user', content: `Meu diário de estudos dos últimos 30 dias:\n${txt}\n\nFaça um resumo curto do que aprendi, liste as dificuldades que se repetem (para eu revisar), comente como meu humor se relaciona com os estudos e dê 3 conselhos práticos.` }],
        t => { journalAI += t; out.innerHTML = richText(cleanText(journalAI)); });
      journalAI = (await r.done).text; out.innerHTML = richText(cleanText(journalAI));
    } catch (err) { journalAI = null; out.textContent = err.message; }
  };
}

// ======================= REVISÃO ESPAÇADA DE ANOTAÇÕES =======================
export const REVIEW_STEPS = [1, 3, 7, 14, 30];
export function newReview() { return { step: 0, due: addDays(dayStr(), REVIEW_STEPS[0]) }; }
export const notesToReview = () => A.state.notes.filter(n => n.review && n.review.due && n.review.due <= dayStr()).sort((a, b) => (a.review.due < b.review.due ? -1 : 1));
export async function markReviewed(n) {
  const step = (n.review?.step ?? -1) + 1;
  if (step >= REVIEW_STEPS.length) { n.review = { step, due: null, done: true }; toast(`“${n.title}” concluiu todas as revisões 🎓`); }
  else { n.review = { step, due: addDays(dayStr(), REVIEW_STEPS[step]) }; toast(`Revisado ✓ — próxima revisão em ${REVIEW_STEPS[step]} dia(s)`); }
  await A.db.put('notes', n);
  A.onChange();
}
export async function toggleReview(n) {
  n.review = n.review && !n.review.done ? null : newReview();
  await A.db.put('notes', n);
  toast(n.review ? 'Revisões programadas: 1, 3, 7, 14 e 30 dias' : 'Revisões desligadas para esta anotação');
  A.onChange();
}

// ======================= Hoje: cartões =======================
export const plusToday = {
  html() {
    const { now, next, today } = classNow();
    const rv = notesToReview();
    const jr = X.journal.find(j => j.id === dayStr());
    return `${today.length ? `<div class="panel t-class"><div class="p-head"><h3>${ic('clock')}Aulas de hoje</h3><button class="icon-btn small" data-goto="schedule" aria-label="Ver horário">${ic('right')}</button></div>
        ${now ? `<div class="class-now"><span class="dot" style="background:${subjColor(now)}"></span><b>Agora: ${esc(subjName(now))}</b><span class="muted small"> até ${now.end}</span></div>
          <button class="btn primary" data-clnote="${now.id}">${ic('edit')}<span>Anotar nesta aula</span></button>` : ''}
        ${next ? `<p class="small">Próxima: <b>${esc(subjName(next))}</b> às ${next.start}</p>` : now ? '' : '<p class="muted small">Sem mais aulas hoje.</p>'}</div>` : ''}
      ${rv.length ? `<div class="panel t-review"><div class="p-head"><h3>${ic('repeat')}Revisar hoje</h3></div>
        ${rv.slice(0, 5).map(n => `<div class="rv-row"><span class="grow">${esc(n.title)} <span class="muted small">· ${n.review.step + 1}ª revisão</span></span>
          <button class="chip small" data-rvopen="${n.id}">Abrir</button><button class="chip small on" data-rvdone="${n.id}">${ic('check')}<span>Revisado</span></button></div>`).join('')}</div>` : ''}
      <div class="panel t-journal"><div class="p-head"><h3>${ic('journal')}Diário</h3></div>
        ${jr ? `<p class="small">${MOODS[(jr.mood || 3) - 1]} ${esc((jr.learned || 'Registrado hoje ✓').slice(0, 90))}</p>` : '<p class="muted small">Como foi seu dia de estudos? Leva 1 minuto.</p>'}
        <button class="btn" data-goto="journal">${jr ? 'Ver diário' : 'Escrever agora'}</button></div>`;
  },
  bind(el) {
    el.querySelectorAll('[data-clnote]').forEach(b => b.onclick = () => noteForClass(X.classes.find(c => c.id === b.dataset.clnote)));
    el.querySelectorAll('[data-rvopen]').forEach(b => b.onclick = () => A.openNote(b.dataset.rvopen));
    el.querySelectorAll('[data-rvdone]').forEach(b => b.onclick = () => markReviewed(A.state.notes.find(n => n.id === b.dataset.rvdone)));
  },
};
export function plusCounts() { return { review: notesToReview().length, journal: X.journal.some(j => j.id === dayStr()) ? 0 : 1 }; }

// ======================= TAREFAS: QUADRO E MATRIZ =======================
const subProg = t => (t.subtasks && t.subtasks.length ? `<span class="sub-prog">${ic('check')}${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>` : '');
function taskCard(t, extra = '') {
  const late = !t.done && t.due && t.due < dayStr();
  return `<div class="k-card p${t.prio} ${t.done ? 'done' : ''}" data-edit="${t.id}">
    <div class="k-title">${esc(t.title)}</div>
    <div class="k-meta">${t.due ? `<span class="${late ? 'late' : ''}">${ic('calendar')}${fmtDate(t.due)}</span>` : ''}${subProg(t)}
      ${t.folderId ? `<span class="dot" style="background:${A.folderColor(t.folderId)}"></span>` : ''}${t.repeat ? '<span>↻</span>' : ''}</div>${extra}</div>`;
}
export function renderBoard(el, tasks) {
  const since = addDays(dayStr(), -7);
  const cols = [
    ['todo', 'A fazer', tasks.filter(t => !t.done && t.status !== 'doing')],
    ['doing', 'Fazendo', tasks.filter(t => !t.done && t.status === 'doing')],
    ['done', 'Feito (7 dias)', tasks.filter(t => t.done && t.doneAt && dayStr(new Date(t.doneAt)) >= since)],
  ];
  el.innerHTML = `<div class="kanban">${cols.map(([k, label, list], ci) => `<div class="k-col"><div class="k-head">${label} <em>${list.length}</em></div>
    ${list.map(t => taskCard(t, `<div class="k-move">${ci > 0 ? `<button class="icon-btn small" data-mv="${t.id}" data-to="${cols[ci - 1][0]}" aria-label="Voltar">${ic('left')}</button>` : '<span></span>'}
      ${ci < 2 ? `<button class="icon-btn small" data-mv="${t.id}" data-to="${cols[ci + 1][0]}" aria-label="Avançar">${ic('right')}</button>` : ''}</div>`)).join('') || '<p class="muted small pad">Vazio</p>'}
    ${k === 'todo' ? `<button class="k-add" data-kadd="1">${ic('plus')}<span>Tarefa</span></button>` : ''}</div>`).join('')}</div>`;
  el.querySelectorAll('[data-mv]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const t = A.state.tasks.find(x => x.id === b.dataset.mv), to = b.dataset.to;
    if (to === 'done') { t.status = ''; await A.db.put('tasks', t); return A.toggleTask(t.id); }
    if (t.done) { await A.toggleTask(t.id); }
    t.status = to === 'doing' ? 'doing' : '';
    await A.db.put('tasks', t);
    A.onChange();
  });
  bindEdit(el);
  el.querySelector('[data-kadd]')?.addEventListener('click', () => A.taskDialog({}));
}
export function quadrantOf(t) {
  const urgent = !!t.due && t.due <= addDays(dayStr(), 2);
  const important = +t.prio === 3;
  return urgent && important ? 0 : important ? 1 : urgent ? 2 : 3;
}
export function renderMatrix(el, tasks) {
  const Q = [['Fazer agora', 'Urgente e importante', 'q0'], ['Agendar', 'Importante, sem pressa', 'q1'], ['Fazer rápido', 'Urgente, menos importante', 'q2'], ['Depois', 'Nem urgente nem importante', 'q3']];
  const pend = tasks.filter(t => !t.done);
  el.innerHTML = `<p class="muted small">Urgente = prazo até depois de amanhã. Importante = prioridade Alta. Toque numa tarefa para mudar prazo ou prioridade.</p>
    <div class="matrix">${Q.map(([t, sub, cls], i) => `<div class="mq ${cls}"><div class="k-head">${t} <em>${pend.filter(x => quadrantOf(x) === i).length}</em><small>${sub}</small></div>
      ${pend.filter(x => quadrantOf(x) === i).map(x => taskCard(x)).join('') || '<p class="muted small pad">Nada aqui</p>'}</div>`).join('')}</div>`;
  bindEdit(el);
}
function bindEdit(el) {
  el.querySelectorAll('[data-edit]').forEach(c => c.onclick = e => {
    if (e.target.closest('button')) return;
    A.taskDialog(A.state.tasks.find(t => t.id === c.dataset.edit));
  });
}

// ======================= roteamento =======================
export function renderPlus(kind, el) { ({ schedule: renderSchedule, journal: renderJournal })[kind](el); }
export function plusNewAction(kind) {
  if (kind === 'schedule') return classDialog();
  if (kind === 'journal') document.getElementById('jr-learned')?.focus();
}
export const classesData = () => X.classes;
