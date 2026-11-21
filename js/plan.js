// Plano de estudos automático: você diz a prova, a data, as matérias e quanto tempo tem por dia;
// o app distribui os assuntos nos dias até a prova (intercalando as matérias), deixa os últimos dias
// para revisão geral e simulado, e cria tudo como tarefas. Se atrasar, "Reorganizar" refaz a agenda.
import { ic, esc, h, toast, modal, confirmBox } from './ui.js';
import { dayStr, addDays } from './hub.js';
import { aiConfigured, askGemini } from './ai.js';

let A;
let P = [];
export const PLAN_VIEWS = { plans: { title: 'Plano de estudos', icon: 'route' } };
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = s => parseDay(s).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

export async function initPlans(api) { A = api; P = await A.db.all('plans'); }
export async function reloadPlans() { P = await A.db.all('plans'); }
export const plansData = () => P;
const tasksOf = id => A.state.tasks.filter(t => t.planId === id);

// ---------- o "cérebro" (sem IA: funciona offline e sempre do mesmo jeito) ----------
// Dias de estudo disponíveis de start até a véspera da prova, só nos dias da semana escolhidos
export function studyDays(start, exam, weekdays) {
  const out = [];
  for (let d = start; d < exam; d = addDays(d, 1)) if (weekdays.includes(parseDay(d).getDay())) out.push(d);
  return out;
}
// Monta a lista de sessões: assuntos intercalados entre as matérias e depois exercícios/revisão
export function buildSessions(subjects) {
  const queues = subjects.map(s => ({ s, list: (s.topics.length ? s.topics : [`Conteúdo de ${s.name}`]).slice() }));
  const out = [];
  while (queues.some(q => q.list.length)) for (const q of queues) if (q.list.length) out.push({ folderId: q.s.folderId, subject: q.s.name, topic: q.list.shift(), kind: 'study' });
  return out;
}
// Distribui as sessões nos dias (n por dia). Sobrou espaço: exercícios e revisão espaçada; faltou: junta assuntos.
export function schedulePlan({ start, exam, weekdays, perDay, subjects }) {
  const days = studyDays(start, exam, weekdays);
  if (!days.length) return { items: [], days: 0 };
  const reserve = days.length >= 6 ? 2 : days.length >= 3 ? 1 : 0; // últimos dias: revisão geral e simulado
  const studyD = days.slice(0, days.length - reserve);
  const slots = studyD.length * perDay;
  let sessions = buildSessions(subjects);
  if (sessions.length > slots && slots > 0) {
    // mais assuntos que espaço: junta 2 ou mais por sessão, da mesma matéria
    const k = Math.ceil(sessions.length / slots), merged = [];
    for (const s of subjects) {
      const mine = sessions.filter(x => x.folderId === s.folderId && x.subject === s.name);
      for (let i = 0; i < mine.length; i += k) merged.push({ ...mine[i], topic: mine.slice(i, i + k).map(x => x.topic).join(' + ') });
    }
    sessions = buildSessions(subjects.map(s => ({ ...s, topics: merged.filter(x => x.subject === s.name).map(x => x.topic) })));
  } else {
    // sobra espaço: revisões dos assuntos já estudados e exercícios, intercalando as matérias
    const studied = sessions.slice();
    let i = 0;
    while (sessions.length < slots && studied.length) {
      const base = studied[i % studied.length];
      sessions.push({ ...base, topic: `${i < studied.length ? 'Revisar e fazer exercícios' : 'Exercícios'}: ${base.topic}`, kind: 'review' });
      i++;
    }
  }
  const items = [];
  sessions.forEach((s, i) => items.push({ ...s, due: studyD[Math.min(studyD.length - 1, Math.floor(i / perDay))] || days[0] }));
  const finals = days.slice(days.length - reserve);
  if (finals[0]) items.push({ folderId: '', subject: '', topic: 'Revisão geral (resumos, flashcards e caderno de erros)', kind: 'final', due: finals[0] });
  if (finals[1]) items.push({ folderId: '', subject: '', topic: 'Simulado completo e revisão dos erros', kind: 'final', due: finals[1] });
  return { items, days: days.length };
}
export const taskTitle = (plan, it) => (it.kind === 'final' ? `${it.topic} — ${plan.name}` : `${it.kind === 'review' ? '' : 'Estudar: '}${it.topic} (${it.subject})`);

async function createTasks(plan, items) {
  for (const it of items) await A.addTask({ title: taskTitle(plan, it), due: it.due, prio: it.kind === 'final' ? 3 : 2, folderId: it.folderId, notes: `Plano de estudos: ${plan.name}`, planId: plan.id });
}

// Reorganizar: o que ficou para trás (e o que ainda falta) é redistribuído a partir de hoje, na mesma ordem
export async function reorganize(plan) {
  const today = dayStr();
  const pend = tasksOf(plan.id).filter(t => !t.done).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdAt - b.createdAt));
  const late = pend.filter(t => t.due < today).length;
  if (!pend.length) return { moved: 0, late: 0 };
  const finals = pend.filter(t => t.prio === 3 && /Revisão geral|Simulado completo/.test(t.title));
  const normal = pend.filter(t => !finals.includes(t));
  const days = studyDays(today, plan.exam, plan.weekdays);
  if (!days.length) {
    for (const t of pend) { t.due = addDays(plan.exam, -1) < today ? today : addDays(plan.exam, -1); await A.db.put('tasks', t); }
    return { moved: pend.length, late, tight: true };
  }
  const reserve = Math.min(finals.length, days.length > 3 ? finals.length : 0);
  const studyD = days.slice(0, days.length - reserve);
  const per = Math.max(plan.perDay, Math.ceil(normal.length / Math.max(1, studyD.length)));
  normal.forEach((t, i) => { t.due = studyD[Math.min(studyD.length - 1, Math.floor(i / per))] || today; });
  finals.forEach((t, i) => { t.due = days[days.length - reserve + i] || days[days.length - 1]; });
  for (const t of pend) await A.db.put('tasks', t);
  return { moved: pend.length, late, tight: per > plan.perDay };
}

// ---------- tela ----------
export function renderPlans(el) {
  const today = dayStr();
  const list = [...P].sort((a, b) => (a.exam < b.exam ? -1 : 1));
  el.innerHTML = `<div class="plan-wrap">
    ${list.length ? '' : `<div class="panel plan-empty"><h3>${ic('route')}Seu plano até a prova, montado sozinho</h3>
      <p class="muted">Diga qual é a prova, a data, as matérias e os assuntos. O app divide tudo nos dias até lá, intercala as matérias, guarda os últimos dias para revisão e simulado e cria as tarefas. Atrasou? Um toque reorganiza.</p>
      <button class="btn primary big" id="pl-new">${ic('plus')}<span>Criar plano de estudos</span></button></div>`}
    ${list.map(p => {
      const ts = tasksOf(p.id), done = ts.filter(t => t.done).length, late = ts.filter(t => !t.done && t.due < today).length;
      const left = daysBetween(today, p.exam);
      const next = ts.filter(t => !t.done && t.due >= today).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 4);
      return `<div class="panel plan-card" data-plan="${p.id}">
        <div class="row"><h3 class="grow">${ic('route')}${esc(p.name)}</h3><span class="status ${left < 0 ? '' : left <= 7 ? 'bad' : 'good'}">${left < 0 ? 'prova já passou' : left === 0 ? 'é hoje!' : `faltam ${left} dia${left > 1 ? 's' : ''}`}</span></div>
        <p class="muted small">Prova em ${fmt(p.exam)} · ${p.subjects.map(s => esc(s.name)).join(', ')} · ${p.perDay} sessão(ões) de estudo por dia · ${p.weekdays.map(d => WD[d]).join(', ')}</p>
        <div class="goal-bar"><i style="width:${ts.length ? (done / ts.length) * 100 : 0}%"></i></div>
        <p class="small"><b>${done}</b> de ${ts.length} sessões feitas${late ? ` · <b class="late">${late} atrasada${late > 1 ? 's' : ''}</b>` : ''}</p>
        ${next.length ? `<div class="plan-next">${next.map(t => `<div class="plan-item"><span class="muted small">${t.due === today ? 'hoje' : fmt(t.due)}</span><span class="grow">${esc(t.title)}</span></div>`).join('')}</div>` : ''}
        <div class="row wrap"><button class="btn ${late ? 'primary' : ''}" data-reorg="${p.id}">${ic('repeat')}<span>Reorganizar${late ? ` (${late} atrasada${late > 1 ? 's' : ''})` : ''}</span></button>
          <button class="btn" data-tasks="${p.id}">${ic('tasks')}<span>Ver tarefas</span></button><span class="grow"></span>
          <button class="icon-btn small" data-pdel="${p.id}" aria-label="Apagar plano">${ic('trash')}</button></div></div>`;
    }).join('')}
  </div>`;
  el.querySelector('#pl-new')?.addEventListener('click', () => planDialog());
  el.querySelectorAll('[data-reorg]').forEach(b => b.onclick = async () => {
    const r = await reorganize(P.find(x => x.id === b.dataset.reorg));
    toast(r.moved ? `Plano reorganizado ✓ ${r.late ? `${r.late} atrasada(s) foram para os próximos dias` : ''}${r.tight ? ' — ficou apertado: algumas sessões a mais por dia' : ''}` : 'Nada para reorganizar', 4000);
    A.onChange();
  });
  el.querySelectorAll('[data-tasks]').forEach(b => b.onclick = () => A.go('tasks'));
  el.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    const p = P.find(x => x.id === b.dataset.pdel);
    if (!(await confirmBox('Apagar plano', `Apagar o plano “${p.name}” e as sessões que ainda não foram feitas? (as já feitas continuam)`, 'Apagar'))) return;
    for (const t of tasksOf(p.id).filter(t => !t.done)) { await A.db.del('tasks', t.id); A.state.tasks.splice(A.state.tasks.indexOf(t), 1); }
    await A.db.del('plans', p.id); P = P.filter(x => x.id !== p.id);
    toast('Plano apagado'); A.onChange();
  });
}

export async function planDialog() {
  const folders = A.state.folders;
  const body = h(`<div class="plan-form">
    <label class="lbl">Prova ou objetivo</label><input class="input" id="pl-name" placeholder="Ex.: Prova bimestral, ENEM, Vestibular">
    <div class="row"><div class="grow"><label class="lbl">Data da prova</label><input class="input" type="date" id="pl-exam" value="${addDays(dayStr(), 14)}"></div>
      <div class="grow"><label class="lbl">Sessões de estudo por dia (~50 min)</label><select class="select full" id="pl-per">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <label class="lbl">Dias da semana</label><div class="row wrap" id="pl-wd">${WD.map((d, i) => `<button type="button" class="chip small ${i >= 1 && i <= 6 ? 'on' : ''}" data-d="${i}">${d}</button>`).join('')}</div>
    <label class="lbl">Matérias</label><div class="row wrap" id="pl-subs">${folders.map(f => `<button type="button" class="chip small" data-f="${f.id}">${esc(f.name)}</button>`).join('')}
      <input class="input pl-extra" id="pl-extra" placeholder="Outra matéria (Enter)"></div>
    <div id="pl-topics"></div>
    ${aiConfigured() ? `<button type="button" class="btn small-btn" id="pl-ai">${ic('magic')}<span>Sugerir assuntos com IA</span></button>` : ''}
    <label class="check"><input type="checkbox" id="pl-cal" checked> 📅 Pôr a prova na agenda (com aviso na véspera)</label>
  </div>`);
  const chosen = []; // { folderId, name }
  const topics = {};
  const keyOf = s => s.folderId || 'x:' + s.name;
  const drawTopics = () => {
    body.querySelector('#pl-topics').innerHTML = chosen.map(s => `<label class="lbl">Assuntos de ${esc(s.name)} <span class="muted small">(um por linha; pode deixar em branco)</span></label>
      <textarea class="input" rows="3" data-topics="${esc(keyOf(s))}" placeholder="Ex.: Frações&#10;Porcentagem&#10;Equação do 1º grau">${esc(topics[keyOf(s)] || '')}</textarea>`).join('');
    body.querySelectorAll('[data-topics]').forEach(t => t.oninput = () => { topics[t.dataset.topics] = t.value; });
  };
  body.querySelector('#pl-wd').onclick = e => { const b = e.target.closest('[data-d]'); if (b) b.classList.toggle('on'); };
  body.querySelector('#pl-subs').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    b.classList.toggle('on');
    const f = folders.find(x => x.id === b.dataset.f);
    const i = chosen.findIndex(s => s.folderId === f.id);
    if (i >= 0) chosen.splice(i, 1); else chosen.push({ folderId: f.id, name: f.name });
    drawTopics();
  };
  body.querySelector('#pl-extra').onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    const v = e.target.value.trim(); if (!v || chosen.some(s => s.name === v)) return;
    chosen.push({ folderId: '', name: v }); e.target.value = '';
    const chip = h(`<button type="button" class="chip small on" data-x="${esc(v)}">${esc(v)} ✕</button>`);
    chip.onclick = () => { chosen.splice(chosen.findIndex(s => s.name === v && !s.folderId), 1); chip.remove(); drawTopics(); };
    e.target.before(chip); drawTopics();
  };
  body.querySelector('#pl-ai')?.addEventListener('click', async ev => {
    if (!chosen.length) { toast('Escolha as matérias primeiro'); return; }
    const btn = ev.currentTarget; btn.disabled = true; btn.querySelector('span').textContent = 'Pensando…';
    const name = body.querySelector('#pl-name').value.trim() || 'prova';
    try {
      const txt = await askGemini(topicsPrompt(name, chosen.map(s => s.name)), { json: true });
      const got = parseTopics(txt);
      for (const s of chosen) { const t = got[s.name] || got[Object.keys(got).find(k => k.toLowerCase() === s.name.toLowerCase())]; if (t && t.length && !(topics[keyOf(s)] || '').trim()) topics[keyOf(s)] = t.join('\n'); }
      drawTopics();
    } catch (e) { toast(e.message, 4000); }
    btn.disabled = false; btn.querySelector('span').textContent = 'Sugerir assuntos com IA';
  });
  const res = await modal({
    title: 'Novo plano de estudos', body, wide: true,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Criar plano', primary: true,
      validate: el => {
        if (!el.querySelector('#pl-name').value.trim()) { toast('Dê um nome para a prova'); return false; }
        const ex = el.querySelector('#pl-exam').value;
        if (!ex || ex <= dayStr()) { toast('A data da prova precisa ser depois de hoje'); return false; }
        if (!chosen.length) { toast('Escolha pelo menos uma matéria'); return false; }
        if (!el.querySelectorAll('#pl-wd .on').length) { toast('Escolha os dias da semana'); return false; }
        return true;
      },
      value: el => ({ name: el.querySelector('#pl-name').value.trim(), exam: el.querySelector('#pl-exam').value, perDay: +el.querySelector('#pl-per').value,
        weekdays: [...el.querySelectorAll('#pl-wd .on')].map(b => +b.dataset.d), cal: el.querySelector('#pl-cal').checked }),
    }],
  });
  if (!res) return null;
  return createPlan({ ...res, subjects: chosen.map(s => ({ ...s, topics: String(topics[keyOf(s)] || '').split('\n').map(x => x.trim()).filter(Boolean) })) });
}

export async function createPlan({ name, exam, perDay = 2, weekdays = [1, 2, 3, 4, 5, 6], subjects, cal = true, start }) {
  const plan = { id: A.uid(), name, exam, perDay, weekdays, subjects, createdAt: Date.now() };
  const { items } = schedulePlan({ start: start || dayStr(), exam, weekdays, perDay, subjects });
  if (!items.length) { toast('Não há dias de estudo até a prova com os dias escolhidos', 4000); return null; }
  await A.db.put('plans', plan); P.push(plan);
  await createTasks(plan, items);
  if (cal) {
    const ev = { id: A.uid(), title: name, date: exam, time: '', prio: 3, kind: 'prova', notes: `Plano de estudos: ${subjects.map(s => s.name).join(', ')}`, remind: true, createdAt: Date.now(), updatedAt: Date.now() };
    await A.db.put('events', ev); await A.ev.reloadEvents();
  }
  toast(`Plano criado ✓ ${items.length} sessões até ${fmt(exam)}`, 4000);
  A.onChange();
  return plan;
}

export function topicsPrompt(name, subjects) {
  return `Sou estudante do ensino médio no Brasil e vou fazer: ${name}. Para cada matéria, liste de 4 a 8 assuntos principais para estudar, do mais básico ao mais avançado, com nomes curtos.
Matérias: ${subjects.join(', ')}.
Responda APENAS com JSON válido no formato {"Matéria": ["assunto 1", "assunto 2"]}, usando exatamente os nomes das matérias acima.`;
}
export function parseTopics(text) {
  const t = String(text).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { const o = JSON.parse(t.slice(a, b + 1)); const out = {}; for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) out[k] = v.map(x => String(x).trim()).filter(Boolean).slice(0, 12); return out; } catch { return {}; }
}
