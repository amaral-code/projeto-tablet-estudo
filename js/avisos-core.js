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
    if (p.tasks) {
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
      const n = (data.cards || []).filter(c => c.due && c.due <= d).length;
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
    return out.sort((a, b) => a.at - b.at);
  }
  // Avisos que já deviam ter tocado e ainda valem (não passou do "até quando")
  const due = (list, fired, now) => list.filter(r => r.at <= now && now <= r.until && !(fired && fired[r.id]));
  // Esquece avisos antigos (mais de 10 dias)
  const prune = (fired, now) => { const out = {}; for (const [k, t] of Object.entries(fired || {})) if (now - t < 10 * 24 * HOUR) out[k] = t; return out; };

  g.AvisosCore = { DEFAULTS, compute, due, prune, day, addDays, at };
})(typeof self !== 'undefined' ? self : globalThis);
