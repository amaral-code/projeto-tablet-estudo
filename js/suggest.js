// "O que fazer agora": olha tudo o que existe no app e sugere os próximos passos, já com o botão de ação.
import { ic, esc } from './ui.js';
import { dayStr, addDays, hubData, dueCount, focusCfg, focusToday, startFocusFor, reviewNow, markHabitDone, calendarOn } from './hub.js';
import { perfData } from './perf.js';
import { classNow, notesToReview } from './plus.js';
import { goalsList, progress } from './goals.js';

let A;
let actions = [];
export function initSuggest(api) { A = api; }

const daysUntil = d => Math.round((new Date(d + 'T00:00') - new Date(dayStr() + 'T00:00')) / 86400000);

export function suggestions(now = new Date()) {
  const today = dayStr(now);
  const hour = now.getHours();
  const out = [];
  const add = (score, icon, title, why, label, run, tone = '') => out.push({ score, icon, title, why, label, run, tone });
  const fname = id => A.folderName(id) || 'Geral';

  // aula acontecendo agora
  const { now: cls } = classNow(now);
  if (cls) {
    const name = cls.folderId ? fname(cls.folderId) : cls.name;
    add(100, 'clock', `Anotar a aula de ${name}`, `Acontecendo agora, até ${cls.end}`, 'Anotar', () => A.noteForClass(cls), 'blue');
  }
  // eventos importantes de hoje e de amanhã
  if (A.ev) {
    const tomorrow = addDays(today, 1);
    for (const e of A.ev.upcoming(1)) {
      const isToday = e.date === today, hi = +e.prio === 3;
      add((isToday ? 92 : 74) + (hi ? 6 : 0), 'calendar', `${isToday ? 'Hoje' : 'Amanhã'}: ${e.title}`, `${e.time ? `Às ${e.time} · ` : ''}Prioridade ${['', 'baixa', 'média', 'alta'][e.prio] || 'média'}${e.notes ? ` · ${e.notes}` : ''}`, 'Ver', () => calendarOn(e.date), hi ? 'red' : 'orange');
      if (e.date > tomorrow) break;
    }
  }
  // provas chegando
  for (const g of perfData().grades.filter(x => x.score == null && x.date >= today)) {
    const d = daysUntil(g.date);
    if (d > 7) continue;
    add(95 - d * 6, 'award', `Estudar para ${g.title} (${fname(g.folderId)})`, d === 0 ? 'A prova é hoje!' : d === 1 ? 'A prova é amanhã' : `Faltam ${d} dias`, 'Focar 25 min', () => { startFocusFor({ folderId: g.folderId || '' }); A.go('focus'); }, d <= 2 ? 'red' : 'orange');
  }
  // tarefas: atrasadas, prioridades do dia, com prazo hoje
  const pend = A.state.tasks.filter(t => !t.done);
  for (const t of pend.filter(t => t.due && t.due < today).slice(0, 2)) add(85, 'tasks', `Terminar “${t.title}”`, `Atrasada desde ${t.due.split('-').reverse().slice(0, 2).join('/')}`, 'Focar nela', () => { startFocusFor({ folderId: t.folderId || '', taskId: t.id }); A.go('focus'); }, 'red');
  for (const t of pend.filter(t => t.top === today && !(t.due && t.due < today)).slice(0, 2)) add(78, 'star', `Fazer “${t.title}”`, '⭐ Prioridade de hoje', 'Focar nela', () => { startFocusFor({ folderId: t.folderId || '', taskId: t.id }); A.go('focus'); });
  for (const t of pend.filter(t => t.due === today && t.top !== today).slice(0, 2)) add(62, 'tasks', `Fazer “${t.title}”`, 'O prazo é hoje', 'Focar nela', () => { startFocusFor({ folderId: t.folderId || '', taskId: t.id }); A.go('focus'); });
  // flashcards vencidos
  const due = dueCount();
  if (due) add(60 + Math.min(due, 20), 'cards', `Revisar ${due} flashcard${due > 1 ? 's' : ''}`, `Uns ${Math.max(1, Math.round(due * 0.25))} min · o que você revisa no dia certo não esquece`, 'Revisar', () => reviewNow());
  // anotações para revisar (revisão espaçada)
  const rv = notesToReview();
  if (rv.length) add(56, 'repeat', `Revisar “${rv[0].title}”`, rv.length > 1 ? `E mais ${rv.length - 1} anotação(ões) para revisar hoje` : `${(rv[0].review.step || 0) + 1}ª revisão: reler fixa na memória`, 'Abrir', () => A.openNote(rv[0].id));
  // meta de foco do dia
  const goal = focusCfg().goal, done = focusToday();
  if (done < goal) add(hour >= 14 ? 48 : 38, 'timer', `Faltam ${goal - done} min de foco hoje`, `Meta diária: ${goal} min`, 'Começar foco', () => { startFocusFor({}); A.go('focus'); });
  // hábitos ainda não marcados (mais importantes no fim do dia)
  const habits = hubData().habits.filter(hb => !hb.days[today]);
  if (habits.length) add(hour >= 17 ? 46 : 22, 'flame', `Hábito: ${habits[0].name}`, habits.length > 1 ? `E mais ${habits.length - 1} para hoje` : 'Mantenha a sequência 🔥', 'Já fiz', async () => { await markHabitDone(habits[0].id); A.onChange(); });
  // metas atrasadas no ritmo
  for (const g of goalsList()) {
    const p = progress(g);
    if (p.done || !g.deadline || p.daysLeft == null || p.daysLeft < 0 || p.daysLeft > 30) continue;
    const elapsed = Math.max(1, (new Date(today) - new Date(g.start < '2001' ? g.createdAt : g.start)) / 86400000);
    if (p.pct < 100 * (1 - p.daysLeft / (elapsed + p.daysLeft)) - 15) { add(42, 'target', `Meta atrasada: ${g.title}`, `${Math.round(p.pct)}% feito e faltam ${p.daysLeft} dias`, 'Ver meta', () => A.go('goals')); break; }
  }
  // diário no fim do dia
  if (hour >= 18 && A.journalMissing && A.journalMissing()) add(32, 'journal', 'Escrever no diário', 'Leva 1 minuto: o que aprendeu e o que foi difícil', 'Escrever', () => A.go('journal'));
  // proteção dos dados: lembrar de fazer backup (nunca fez, ou o último tem mais de 30 dias)
  const lastBk = +localStorage.getItem('caderno-ultimo-backup') || 0;
  const hasData = A.state.notes.length + A.state.tasks.length >= 8;
  if (hasData && Date.now() - lastBk > 30 * 86400000) add(lastBk ? 34 : 26, 'database', lastBk ? 'Fazer um backup novo' : 'Fazer o primeiro backup', lastBk ? `O último foi há ${Math.floor((Date.now() - lastBk) / 86400000)} dias · guarde no Google Drive` : 'Guarde uma cópia no Google Drive: se o tablet der problema, nada se perde', 'Fazer backup', () => A.go('data'));
  out.sort((a, b) => b.score - a.score);
  // backup diário no Google Drive (1 toque)
  if (A.driveDue && A.driveDue()) add(36, 'drive', 'Backup no Google Drive', 'Um toque guarda tudo na sua conta do Google', 'Fazer backup', () => A.driveBackup(), 'green');
  // caderno de erros e matéria mais fraca
  const nErr = A.errorsCount ? A.errorsCount() : 0;
  if (nErr) add(nErr >= 5 ? 58 : 44, 'alert', `Revisar ${nErr} erro${nErr > 1 ? 's' : ''}`, 'Do caderno de erros: acerte 2 vezes para resolver', 'Revisar', () => A.go('errors'), 'red');
  const weak = A.weakSubject ? A.weakSubject() : null;
  if (weak) add(40, 'chart', `Reforçar ${weak.name}`, weak.why, 'Focar', () => { startFocusFor({ folderId: weak.folderId }); A.go('focus'); });
  if (!out.length) add(1, 'quiz', 'Tudo em dia! 🎉', 'Que tal um simulado rápido para testar o que você sabe?', 'Fazer simulado', () => A.go('quiz'), 'green');
  return out.slice(0, 4);
}

export const suggestToday = {
  html() {
    actions = suggestions();
    return `<section class="suggest" aria-label="O que fazer agora"><h3>${ic('bulb')}O que fazer agora</h3>
      <div class="sg-grid">${actions.map((s, i) => `<div class="sg ${s.tone}"><span class="sg-ic">${ic(s.icon)}</span>
        <div class="sg-txt"><b>${esc(s.title)}</b><small>${esc(s.why)}</small></div>
        <button class="btn small-btn" data-sg="${i}">${esc(s.label)}</button></div>`).join('')}</div></section>`;
  },
  bind(el) { el.querySelectorAll('[data-sg]').forEach(b => b.onclick = () => actions[+b.dataset.sg].run()); },
};
