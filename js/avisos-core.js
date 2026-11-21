// Motor de avisos: calcula QUAIS lembretes existem e QUANDO, a partir dos dados do app.
// É usado pelo app (aberto ou em segundo plano) e pelo service worker (com o app fechado),
// por isso é um script simples, sem import/export: ele se registra em self.AvisosCore.
(function (g) {
  const pad = n => String(n).padStart(2, '0');
  const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return day(new Date(y, m - 1, d + n)); };
  const at = (s, hhmm) => { const [y, m, d] = s.split('-').map(Number); const [h, mi] = String(hhmm || '00:00').split(':').map(Number); return new Date(y, m - 1, d, h || 0, mi || 0).getTime(); };
  const MIN = 60000, HOUR = 60 * MIN;

  const DEFAULTS = {
    events: true, eveTime: '19:00', dayTime: '07:00', beforeMin: 60,
    tasks: true, tasksTime: '07:30',
    exams: true,
    classes: true, classMin: 10,
    cards: true, cardsTime: '18:00',
    study: false, studyTime: '15:00', studyDays: [1, 2, 3, 4, 5],
    habits: true, habitsTime: '20:30',
    // automações novas
    briefing: true, briefingTime: '07:00', // resumo da manhã (junta tarefas, eventos, plano, flashcards e provas)
    streak: true, streakTime: '20:00', // não perder a sequência de estudo
    weekly: true, weeklyTime: '18:00', // resumo da semana (domingo)
    errorsRem: true, errorsTime: '17:00', // caderno de erros acumulando
    planLate: true, planTime: '19:30', // sessões do plano atrasadas
    quiet: true, quietFrom: '22:30', quietTo: '06:30', // horário de silêncio
  };
  const ICON = { prova: '📝', trabalho: '📚', aula: '🏫', consulta: '🩺', aniversario: '🎂', outro: '📌' };
  const PRIO = { 1: 'baixa', 2: 'média', 3: 'ALTA' };

  // data = { events, tasks, grades, classes, cards, habits, folders }; devolve os avisos de [agora − 1 dia, agora + 8 dias]
  function compute(data, prefs, now) {
    const p = Object.assign({}, DEFAULTS, prefs || {});
    const today = day(new Date(now));
    const from = now - 24 * HOUR, to = now + 8 * 24 * HOUR;
    const out = [];
    const add = (id, t, title, body, url, until) => { if (t >= from && t <= to) out.push({ id, at: t, title, body: body || '', url: url || './', until: until || t + 12 * HOUR }); };
    const folder = id => ((data.folders || []).find(f => f.id === id) || {}).name || '';

    if (p.events) for (const e of data.events || []) {
      if (e.remind === false || !e.date) continue;
      const line = `${ICON[e.kind] || '📌'} ${e.title}${e.time ? ` às ${e.time}` : ''}${+e.prio === 3 ? ' · prioridade ALTA' : ''}`;
      const evAt = at(e.date, e.time || '23:59');
      add(`ev-v-${e.id}-${e.date}`, at(addDays(e.date, -1), p.eveTime), `📅 Amanhã: ${e.title}`, line + (e.notes ? `\n${e.notes}` : ''), './?v=calendar', evAt);
      if (e.time) add(`ev-h-${e.id}-${e.date}-${e.time}`, at(e.date, e.time) - (+p.beforeMin || 0) * MIN, `⏰ ${+p.beforeMin ? `Daqui a ${+p.beforeMin >= 60 ? `${+p.beforeMin / 60} h` : `${p.beforeMin} min`}` : 'Agora'}: ${e.title}`, line, './?v=calendar', evAt);
      else add(`ev-d-${e.id}-${e.date}`, at(e.date, p.dayTime), `📅 Hoje: ${e.title}`, line, './?v=calendar', evAt);
    }
    if (p.tasks && !p.briefing) {
      const byDay = {};
      for (const t of data.tasks || []) if (!t.done && t.due) (byDay[t.due] = byDay[t.due] || []).push(t);
      for (const d of Object.keys(byDay)) {
        const list = byDay[d].sort((a, b) => (b.prio || 0) - (a.prio || 0));
        const late = d === today ? (data.tasks || []).filter(t => !t.done && t.due && t.due < today).length : 0;
        add(`tk-${d}`, at(d, p.tasksTime), `✅ ${list.length} tarefa${list.length > 1 ? 's' : ''} para hoje`,
          list.slice(0, 4).map(t => `• ${t.title}`).join('\n') + (list.length > 4 ? `\n… e mais ${list.length - 4}` : '') + (late ? `\n⚠️ ${late} atrasada${late > 1 ? 's' : ''}` : ''), './?v=tasks', at(d, p.tasksTime) + 3 * HOUR);
      }
    }
    if (p.exams) for (const gr of data.grades || []) {
      if (gr.score != null || !gr.date) continue;
      const name = `${gr.title}${folder(gr.folderId) ? ` (${folder(gr.folderId)})` : ''}`;
      add(`ex3-${gr.id}-${gr.date}`, at(addDays(gr.date, -3), p.eveTime), `📝 Prova em 3 dias: ${name}`, 'Bom momento para revisar e fazer um simulado.', './?v=grades', at(gr.date, '23:59'));
      add(`ex1-${gr.id}-${gr.date}`, at(addDays(gr.date, -1), p.eveTime), `📝 Prova amanhã: ${name}`, 'Revise os flashcards e durma cedo. Boa prova!', './?v=grades', at(gr.date, '23:59'));
    }
    if (p.classes) for (let k = 0; k <= 7; k++) {
      const d = addDays(today, k), wd = new Date(at(d, '12:00')).getDay();
      for (const c of data.classes || []) {
        if (+c.day !== wd || !c.start) continue;
        const name = folder(c.folderId) || c.name || 'Aula';
        add(`cl-${c.id}-${d}`, at(d, c.start) - (+p.classMin || 0) * MIN, `🏫 Aula de ${name} ${+p.classMin ? `em ${p.classMin} min` : 'agora'}`, `${c.start}–${c.end || ''}${c.room ? ` · sala ${c.room}` : ''}`, './?v=schedule', at(d, c.start) + 30 * MIN);
      }
    }
    if (p.cards) for (const d of [today, addDays(today, 1)]) {
      const n = (data.cards || []).filter(c => !c.due || c.due <= d).length; // sem data = para revisar (igual ao app)
      if (n) add(`cd-${d}`, at(d, p.cardsTime), `🃏 ${n} flashcard${n > 1 ? 's' : ''} para revisar`, 'Leva poucos minutos e ajuda a não esquecer.', './?v=cards', at(d, p.cardsTime) + 3 * HOUR);
    }
    if (p.study) for (let k = 0; k <= 7; k++) {
      const d = addDays(today, k), wd = new Date(at(d, '12:00')).getDay();
      if ((p.studyDays || []).map(Number).includes(wd)) add(`st-${d}`, at(d, p.studyTime), '📚 Hora de estudar!', 'Abra o Caderno e comece um foco de 25 minutos.', './?v=focus', at(d, p.studyTime) + 2 * HOUR);
    }
    if (p.habits) {
      const pend = (data.habits || []).filter(h => !(h.days || {})[today]);
      if (pend.length) add(`hb-${today}`, at(today, p.habitsTime), `🔥 Falta${pend.length > 1 ? 'm' : ''} ${pend.length} hábito${pend.length > 1 ? 's' : ''} hoje`, pend.slice(0, 4).map(h => `• ${h.name}`).join('\n'), './?v=habits', at(today, p.habitsTime) + 3 * HOUR);
    }
    // ---------- automações ----------
    const tasks = data.tasks || [];
    const pend = tasks.filter(t => !t.done);
    const focusBy = {};
    for (const se of data.sessions || []) if (se && se.date) focusBy[se.date] = (focusBy[se.date] || 0) + (+se.minutes || 0);
    // resumo da manhã (hoje e amanhã)
    if (p.briefing) for (const d of [today, addDays(today, 1)]) {
      const isToday = d === today;
      const evs = (data.events || []).filter(e => e.date === d);
      const tks = pend.filter(t => t.due === d), late = isToday ? pend.filter(t => t.due && t.due < d).length : 0;
      const plan = tks.filter(t => t.planId).length;
      const cards = (data.cards || []).filter(c => !c.due || c.due <= d).length;
      const exams = (data.grades || []).filter(g => g.score == null && g.date && g.date >= d && g.date <= addDays(d, 3));
      const lines = [];
      if (evs.length) lines.push(`📅 ${evs.length === 1 ? evs[0].title + (evs[0].time ? ` às ${evs[0].time}` : '') : `${evs.length} eventos`}`);
      if (tks.length || late) lines.push(`✅ ${tks.length} tarefa${tks.length === 1 ? '' : 's'}${late ? ` · ⚠️ ${late} atrasada${late > 1 ? 's' : ''}` : ''}${plan ? ` (${plan} do plano de estudos)` : ''}`);
      if (cards) lines.push(`🃏 ${cards} flashcard${cards > 1 ? 's' : ''} para revisar`);
      for (const g of exams.slice(0, 2)) lines.push(`📝 ${g.title}${folder(g.folderId) ? ` (${folder(g.folderId)})` : ''} ${g.date === d ? 'é hoje!' : `em ${Math.round((at(g.date, '12:00') - at(d, '12:00')) / 86400000)} dia(s)`}`);
      if (lines.length) add(`bf-${d}`, at(d, p.briefingTime), `☀️ Bom dia! Seu dia de estudos`, lines.join('\n'), './?v=today', at(d, p.briefingTime) + 5 * HOUR);
    }
    // sequência de estudo: estudou ontem (e antes) mas ainda não hoje
    if (p.streak && !focusBy[today]) {
      let n = 0, d = addDays(today, -1);
      while (focusBy[d] > 0 && n < 400) { n++; d = addDays(d, -1); }
      if (n >= 2) add(`sq-${today}`, at(today, p.streakTime), `🔥 Não perca sua sequência de ${n} dias!`, 'Uns 25 minutos de foco hoje mantêm a sequência viva.', './?v=focus&start=1', at(today, '23:59'));
    }
    // resumo da semana (domingo)
    if (p.weekly && new Date(at(today, '12:00')).getDay() === 0) {
      let mins = 0; for (let k = 0; k < 7; k++) mins += focusBy[addDays(today, -k)] || 0;
      const since = at(addDays(today, -6), '00:00');
      const done = tasks.filter(t => t.done && t.doneAt && t.doneAt >= since).length;
      const nextEx = (data.grades || []).filter(g => g.score == null && g.date && g.date > today && g.date <= addDays(today, 7)).length;
      add(`wk-${today}`, at(today, p.weeklyTime), '📊 Sua semana de estudos', `⏱️ ${Math.floor(mins / 60)} h ${mins % 60} min de foco · ✅ ${done} tarefa(s) concluída(s)${nextEx ? `\n📝 ${nextEx} prova(s) nos próximos 7 dias` : ''}\nToque para ver o relatório.`, './?v=report', at(today, p.weeklyTime) + 6 * HOUR);
    }
    // caderno de erros acumulando (dia sim, dia não)
    if (p.errorsRem) {
      const nErr = (data.errors || []).filter(e => e && !e.resolvedAt).length;
      const dayN = Math.floor(at(today, '12:00') / 86400000);
      if (nErr >= 5 && dayN % 2 === 0) add(`er-${today}`, at(today, p.errorsTime), `📒 ${nErr} erros esperando revisão`, 'Revise alguns agora: acertando 2 vezes, o erro sai da lista.', './?v=errors', at(today, p.errorsTime) + 4 * HOUR);
    }
    // plano de estudos atrasado
    if (p.planLate) {
      const late = pend.filter(t => t.planId && t.due && t.due < today);
      if (late.length) { const pl = (data.plans || []).find(x => x.id === late[0].planId); add(`pl-${today}`, at(today, p.planTime), `🗺️ Seu plano está com ${late.length} sessão(ões) atrasada(s)`, `${pl ? pl.name + ': ' : ''}toque em Reorganizar e o app refaz a agenda até a prova.`, './?v=plans', at(today, p.planTime) + 4 * HOUR); }
    }
    // horário de silêncio: o que cairia dentro dele vai para o fim do silêncio (se ainda fizer sentido)
    const res = [];
    for (const r of out) {
      const q = p.quiet ? quietShift(r.at, p.quietFrom, p.quietTo) : r.at;
      if (q === r.at) res.push(r);
      else if (q <= r.until) res.push({ ...r, at: q, quiet: true });
    }
    return res.sort((a, b) => a.at - b.at);
  }
  // Se t cai no horário de silêncio, devolve o fim do silêncio; senão o próprio t
  function quietShift(t, from, to) {
    const mm = s => { const [h, m] = String(s || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const f = mm(from), e = mm(to);
    if (f === e) return t;
    const d = new Date(t), m = d.getHours() * 60 + d.getMinutes();
    const inside = f < e ? m >= f && m < e : m >= f || m < e;
    if (!inside) return t;
    const end = new Date(d); end.setHours(Math.floor(e / 60), e % 60, 0, 0);
    if (end.getTime() <= t) end.setDate(end.getDate() + 1);
    return end.getTime();
  }
  // Avisos adiados ("Adiar 15 min"): voltam como um aviso novo na hora marcada
  function withSnoozes(list, snoozed, now) {
    const out = list.slice();
    for (const [id, z] of Object.entries(snoozed || {})) if (z && z.at) out.push({ id, at: z.at, until: z.at + 6 * HOUR, title: z.title, body: z.body || '', url: z.url || './', snoozed: true });
    return out.sort((a, b) => a.at - b.at);
  }
  const cleanSnoozes = (snoozed, fired, now) => { const o = {}; for (const [k, z] of Object.entries(snoozed || {})) if (!(fired && fired[k]) && z.at + 6 * HOUR > now) o[k] = z; return o; };
  // Histórico do que já foi avisado (últimos 40)
  const logHistory = (hist, items, now) => [...items.map(r => ({ id: r.id, title: r.title, body: r.body, url: r.url, at: now })), ...(hist || [])].slice(0, 40);
  // Botões das notificações
  const ACTIONS = [{ action: 'snooze', title: '⏰ Adiar 15 min' }, { action: 'open', title: 'Abrir' }];
  const NOTIF_ICON = 'icons/archie-aviso.png';
  // Avisos que já deviam ter tocado e ainda valem (não passou do "até quando")
  const due = (list, fired, now) => list.filter(r => r.at <= now && now <= r.until && !(fired && fired[r.id]));
  // Esquece avisos antigos (mais de 10 dias)
  const prune = (fired, now) => { const out = {}; for (const [k, t] of Object.entries(fired || {})) if (now - t < 10 * 24 * HOUR) out[k] = t; return out; };

  g.AvisosCore = { DEFAULTS, compute, due, prune, day, addDays, at, quietShift, withSnoozes, cleanSnoozes, logHistory, ACTIONS, ICON: NOTIF_ICON };
})(typeof self !== 'undefined' ? self : globalThis);
