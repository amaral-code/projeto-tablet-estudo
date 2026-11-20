// Metas: objetivos com progresso automático (calculado com o que você faz no app).
import { ic, esc, h, toast, modal, confirmBox, menu } from './ui.js';
import { dayStr, addDays, hubData, reviewsByDay } from './hub.js';
import { perfData, subjectAverage } from './perf.js';

let A;
let G = [];
export const GOAL_VIEWS = { goals: { title: 'Metas', icon: 'target' } };
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDay(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; };

// Cada tipo sabe calcular quanto você já fez entre o início e o prazo da meta
const TYPES = {
  focus: { label: 'Horas de foco', unit: 'h', icon: 'timer', calc: (g, inR) => hubData().sessions.filter(s => inR(s.date)).reduce((a, s) => a + s.minutes, 0) / 60 },
  pages: { label: 'Páginas lidas', unit: 'páginas', icon: 'bookOpen', calc: (g, inR) => perfData().reads.filter(r => inR(r.date)).reduce((a, r) => a + r.pages, 0) },
  books: { label: 'Livros terminados', unit: 'livros', icon: 'bookOpen', calc: (g, inR) => perfData().books.filter(b => b.finishedAt && inR(b.finishedAt)).length },
  cards: { label: 'Flashcards revisados', unit: 'cartas', icon: 'cards', calc: (g, inR) => Object.entries(reviewsByDay()).filter(([d]) => inR(d)).reduce((a, [, n]) => a + n, 0) },
  tasks: { label: 'Tarefas concluídas', unit: 'tarefas', icon: 'tasks', calc: (g, inR) => A.state.tasks.filter(t => t.done && t.doneAt && inR(dayStr(new Date(t.doneAt)))).length },
  habit: { label: 'Dias cumprindo um hábito', unit: 'dias', icon: 'flame', calc: (g, inR) => { const hb = hubData().habits.find(x => x.id === g.habitId); return hb ? Object.keys(hb.days).filter(d => hb.days[d] && inR(d)).length : 0; } },
  grade: { label: 'Média numa matéria', unit: 'de média', icon: 'award', calc: g => subjectAverage(g.folderId || '') ?? 0 },
  manual: { label: 'Contador (eu marco)', unit: '', icon: 'plus', calc: g => g.count || 0 },
};
const PRESETS = [
  ['focus', 'Estudar 20 horas este mês', 20, 30],
  ['books', 'Ler 2 livros', 2, 60],
  ['grade', 'Média 7 em Matemática', 7, 0],
  ['cards', 'Revisar 300 flashcards', 300, 30],
  ['habit', 'Manter um hábito por 21 dias', 21, 30],
  ['manual', 'Fazer 10 simulados', 10, 30],
];

export async function initGoals(api) { A = api; G = await A.db.all('goals'); }
export async function reloadGoals() { G = await A.db.all('goals'); }

export function progress(g) {
  const end = g.deadline || '9999-12-31';
  const inR = d => d >= g.start && d <= end;
  const value = TYPES[g.type] ? TYPES[g.type].calc(g, inR) : 0;
  const pct = g.target > 0 ? Math.min(100, (value / g.target) * 100) : 0;
  const today = dayStr();
  const daysLeft = g.deadline ? daysBetween(today, g.deadline) : null;
  const remaining = Math.max(0, g.target - value);
  const perDay = daysLeft && daysLeft > 0 && g.type !== 'grade' ? remaining / daysLeft : null;
  return { value, pct, daysLeft, remaining, perDay, done: value >= g.target, late: daysLeft != null && daysLeft < 0 && value < g.target };
}

async function goalDialog(g, preset) {
  const isNew = !g;
  g = g ? { ...g } : { id: A.uid(), title: '', type: 'focus', target: '', start: dayStr(), deadline: addDays(dayStr(), 30), count: 0, createdAt: Date.now() };
  if (preset) Object.assign(g, { type: preset[0], title: preset[1], target: preset[2], deadline: preset[3] ? addDays(dayStr(), preset[3]) : '' });
  const habits = hubData().habits;
  const body = h(`<div>
    <label class="lbl">Tipo de meta</label>
    <select class="select full" id="gl-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${g.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
    <label class="lbl">Nome da meta</label><input class="input" id="gl-title" value="${esc(g.title)}" placeholder="Ex.: Estudar 20 horas este mês">
    <div class="row"><div class="grow"><label class="lbl" id="gl-tlabel">Quanto</label><input class="input" id="gl-target" inputmode="decimal" value="${esc(g.target)}"></div>
      <div class="grow"><label class="lbl">Prazo (opcional)</label><input class="input" type="date" id="gl-deadline" value="${esc(g.deadline || '')}"></div></div>
    <div id="gl-habit-box"><label class="lbl">Qual hábito</label><select class="select full" id="gl-habit">${habits.map(hb => `<option value="${hb.id}" ${hb.id === g.habitId ? 'selected' : ''}>${esc(hb.name)}</option>`).join('') || '<option value="">Crie um hábito primeiro</option>'}</select></div>
    <div id="gl-folder-box"><label class="lbl">Matéria</label><select class="select full" id="gl-folder">${A.folderOptions(g.folderId, 'Geral')}</select></div>
    <label class="check" id="gl-past-box"><input type="checkbox" id="gl-past" ${g.start < dayStr() ? 'checked' : ''}> Contar também o que já fiz antes de hoje</label>
    <p class="muted small" id="gl-help"></p></div>`);
  const sync = () => {
    const t = body.querySelector('#gl-type').value;
    body.querySelector('#gl-habit-box').hidden = t !== 'habit';
    body.querySelector('#gl-folder-box').hidden = t !== 'grade';
    body.querySelector('#gl-past-box').hidden = ['grade', 'manual'].includes(t);
    body.querySelector('#gl-tlabel').textContent = t === 'grade' ? 'Média que quero (0 a 10)' : `Quanto (${TYPES[t].unit || 'vezes'})`;
    body.querySelector('#gl-help').textContent = t === 'manual' ? 'Você mesmo marca +1 cada vez que fizer.' : t === 'grade' ? 'Usa a média lançada em Notas e provas.' : 'O progresso é calculado sozinho com o que você registra no app.';
  };
  body.querySelector('#gl-type').onchange = sync;
  sync();
  const res = await modal({
    title: isNew ? 'Nova meta' : 'Editar meta', body,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', primary: true,
      validate: el => {
        const t = el.querySelector('#gl-type').value, v = num(el.querySelector('#gl-target').value);
        if (!el.querySelector('#gl-title').value.trim()) { toast('Dê um nome à meta'); return false; }
        if (!(v > 0)) { toast('Informe quanto quer alcançar'); return false; }
        if (t === 'grade' && v > 10) { toast('A média vai de 0 a 10'); return false; }
        if (t === 'habit' && !el.querySelector('#gl-habit').value) { toast('Crie um hábito em Hábitos primeiro'); return false; }
        return true;
      },
      value: el => ({
        type: el.querySelector('#gl-type').value, title: el.querySelector('#gl-title').value.trim(), target: num(el.querySelector('#gl-target').value),
        deadline: el.querySelector('#gl-deadline').value, habitId: el.querySelector('#gl-habit').value, folderId: el.querySelector('#gl-folder').value,
        past: el.querySelector('#gl-past').checked,
      }),
    }],
  });
  if (!res) return;
  const { past, ...data } = res;
  Object.assign(g, data);
  // "contar o que já fiz" começa do zero da história; senão, conta a partir de hoje (ou da data original)
  if (past) g.start = '2000-01-01';
  else if (isNew || g.start === '2000-01-01') g.start = dayStr();
  await A.db.put('goals', g);
  const i = G.findIndex(x => x.id === g.id);
  if (i >= 0) G[i] = g; else G.push(g);
  toast(isNew ? 'Meta criada 🎯' : 'Meta salva');
  A.onChange();
}

// Ritmo necessário, em linguagem simples ("44 min por dia", "1 livro a cada 25 dias")
function paceText(type, perDay, unit) {
  if (type === 'focus') { const m = Math.ceil(perDay * 60); return `precisa de ${m >= 60 ? fmt1(perDay) + ' h' : m + ' min'} por dia`; }
  if (perDay >= 1) return `precisa de ${Math.ceil(perDay)} ${unit} por dia`;
  const every = Math.max(1, Math.floor(1 / perDay));
  const one = { livros: 'livro', páginas: 'página', cartas: 'carta', tarefas: 'tarefa', dias: 'dia' }[unit] || unit || 'vez';
  return `1 ${one} a cada ${every} dia${every > 1 ? 's' : ''}`;
}

function goalCard(g) {
  const t = TYPES[g.type] || TYPES.manual;
  const p = progress(g);
  const val = g.type === 'focus' || g.type === 'grade' ? fmt1(p.value) : Math.floor(p.value);
  return `<div class="panel goal-card ${p.done ? 'done' : ''} ${p.late ? 'late' : ''}">
    <div class="deck-top"><span class="map-ic small">${ic(t.icon)}</span><b class="grow">${esc(g.title)}</b>
      <button class="icon-btn small" data-gmore="${g.id}" aria-label="Opções">${ic('more')}</button></div>
    <div class="goal-num"><b>${val}</b><span>de ${fmt1(g.target)} ${esc(t.unit)}</span>${p.done ? '<span class="status good">' + ic('check') + 'Concluída</span>' : ''}</div>
    <div class="goal-bar"><i style="width:${p.pct}%"></i></div>
    <div class="muted small">${Math.round(p.pct)}%${g.deadline ? (p.daysLeft >= 0 ? ` · faltam ${p.daysLeft} dia(s) (até ${fmtDate(g.deadline)})` : ` · prazo terminou em ${fmtDate(g.deadline)}`) : ''}${!p.done && p.perDay ? ` · ${paceText(g.type, p.perDay, t.unit)}` : ''}</div>
    ${g.type === 'manual' ? `<div class="row"><button class="btn" data-dec="${g.id}" aria-label="Menos um">−1</button><button class="btn primary" data-inc="${g.id}">+1</button></div>` : ''}
  </div>`;
}

export function renderGoals(el) {
  const active = G.filter(g => !progress(g).done).sort((a, b) => (a.deadline || '9') < (b.deadline || '9') ? -1 : 1);
  const done = G.filter(g => progress(g).done);
  el.innerHTML = `${G.length ? '' : `<div class="panel"><h3>${ic('target')}Comece com uma meta</h3><p class="muted small">Toque numa sugestão ou crie a sua.</p>
      <div class="presets">${PRESETS.map((p, i) => `<button class="chip" data-preset="${i}">${esc(p[1])}</button>`).join('')}</div></div>`}
    ${active.length ? `<h3 class="sec">Em andamento</h3><div class="goal-grid">${active.map(goalCard).join('')}</div>` : ''}
    <div class="goal-grid" style="margin-top:14px"><button class="panel goal-card new-deck" id="gl-new">${ic('plus')}<span>Nova meta</span></button></div>
    ${done.length ? `<h3 class="sec">Concluídas 🎉</h3><div class="goal-grid">${done.map(goalCard).join('')}</div>` : ''}`;
  el.querySelector('#gl-new').onclick = () => goalDialog();
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => goalDialog(null, PRESETS[+b.dataset.preset]));
  el.querySelectorAll('[data-inc],[data-dec]').forEach(b => b.onclick = async () => {
    const g = G.find(x => x.id === (b.dataset.inc || b.dataset.dec));
    const before = progress(g).done;
    g.count = Math.max(0, (g.count || 0) + (b.dataset.inc ? 1 : -1));
    await A.db.put('goals', g);
    if (!before && progress(g).done) toast(`Meta concluída: ${g.title} 🎉`);
    A.onChange();
  });
  el.querySelectorAll('[data-gmore]').forEach(b => b.onclick = async () => {
    const g = G.find(x => x.id === b.dataset.gmore);
    const a = await menu(g.title, [{ label: 'Editar', icon: 'edit', value: 'edit' }, { label: 'Excluir', icon: 'trash', value: 'del', danger: true }]);
    if (a === 'edit') goalDialog(g);
    else if (a === 'del' && await confirmBox('Excluir meta', `Excluir “${g.title}”?`, 'Excluir')) {
      await A.db.del('goals', g.id); G = G.filter(x => x.id !== g.id); A.onChange();
    }
  });
}

// Cartão do painel Hoje: as metas em andamento mais próximas do prazo
export const goalsToday = {
  html() {
    const list = G.filter(g => !progress(g).done).sort((a, b) => (a.deadline || '9') < (b.deadline || '9') ? -1 : 1).slice(0, 3);
    if (!list.length) return '';
    return `<div class="panel t-goals"><div class="p-head"><h3>${ic('target')}Metas</h3><button class="icon-btn small" data-goto="goals" aria-label="Ver metas">${ic('right')}</button></div>
      ${list.map(g => { const p = progress(g); return `<div class="read-mini"><span class="grow">${esc(g.title)}</span><span class="muted small">${Math.round(p.pct)}%</span></div><div class="goal-bar thin"><i style="width:${p.pct}%"></i></div>`; }).join('')}</div>`;
  },
  bind() { /* os links [data-goto] já são ligados pelo painel */ },
};
export const goalsCount = () => G.filter(g => !progress(g).done).length;
export const newGoal = () => goalDialog();
