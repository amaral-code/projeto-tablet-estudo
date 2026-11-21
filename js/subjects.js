// Desempenho por matéria: junta simulados, notas, flashcards, foco e o caderno de erros de cada pasta
// para mostrar onde você está forte e onde precisa reforçar.
import { ic, esc } from './ui.js';
import { hubData, dayStr, addDays } from './hub.js';
import { perfData } from './perf.js';
import { quizData } from './quiz.js';
import { errorsData } from './errors.js';

let A;
export function initSubjects(api) { A = api; }
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function subjectStats() {
  const since60 = addDays(dayStr(), -60), since14 = addDays(dayStr(), -14);
  const { cards, decks, sessions } = hubData();
  const grades = perfData().grades || [];
  const quizzes = quizData();
  const errs = errorsData();
  return A.state.folders.map(f => {
    const qz = quizzes.filter(q => q.folderId === f.id && q.date >= since60);
    const qRight = qz.reduce((n, q) => n + q.right, 0), qTotal = qz.reduce((n, q) => n + q.total, 0);
    const gr = grades.filter(g => g.folderId === f.id && g.score != null && g.max);
    const gPct = gr.length ? Math.round(gr.reduce((n, g) => n + (g.score / g.max) * 100, 0) / gr.length) : null;
    const deckIds = new Set(decks.filter(d => d.folderId === f.id).map(d => d.id));
    const cs = cards.filter(c => deckIds.has(c.deckId) && (c.reps || c.lapses));
    const reps = cs.reduce((n, c) => n + (c.reps || 0), 0), laps = cs.reduce((n, c) => n + (c.lapses || 0), 0);
    const cPct = cs.length ? pct(reps, reps + laps) : null;
    const focus = sessions.filter(s => s.folderId === f.id && s.date >= since14).reduce((n, s) => n + s.minutes, 0);
    const openErr = errs.filter(e => e.folderId === f.id && !e.resolvedAt).length;
    const parts = [[pct(qRight, qTotal), 2], [gPct, 2], [cPct, 1]].filter(([v]) => v != null);
    let score = parts.length ? Math.round(parts.reduce((n, [v, w]) => n + v * w, 0) / parts.reduce((n, [, w]) => n + w, 0)) : null;
    if (score != null) score = Math.max(0, score - Math.min(15, openErr * 2));
    const level = score == null ? 'none' : score >= 75 ? 'good' : score >= 55 ? 'mid' : 'bad';
    return { folderId: f.id, name: f.name, color: f.color, quiz: pct(qRight, qTotal), quizN: qz.length, grade: gPct, cards: cPct, focus, openErr, score, level };
  });
}

// Matéria que mais precisa de reforço (para o "O que fazer agora")
export function weakSubject() {
  const list = subjectStats().filter(s => s.score != null && s.score < 70).sort((a, b) => a.score - b.score);
  const w = list[0];
  if (!w) return null;
  const why = [w.quiz != null ? `simulados ${w.quiz}%` : '', w.grade != null ? `notas ${w.grade}%` : '', w.cards != null ? `flashcards ${w.cards}%` : '', w.openErr ? `${w.openErr} erro(s) para revisar` : ''].filter(Boolean).join(' · ');
  return { folderId: w.folderId, name: w.name, score: w.score, why: `Sua matéria mais fraca agora (${why})` };
}

const cell = v => (v == null ? '<span class="muted">—</span>' : `<b class="${v >= 75 ? 'good-t' : v >= 55 ? 'mid-t' : 'bad-t'}">${v}%</b>`);
const LEVEL = { good: '💪 Forte', mid: '🙂 Atenção', bad: '⚠️ Reforçar', none: '— Sem dados' };
export function subjectsHTML() {
  const list = subjectStats().sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  if (!list.length) return '';
  return `<div class="panel subj-panel"><h3>${ic('chart')}Desempenho por matéria</h3>
    <p class="muted small">Junta simulados e notas dos últimos 60 dias, flashcards, foco das últimas 2 semanas e o caderno de erros.</p>
    <div class="subj-table" role="table">
      <div class="subj-row head" role="row"><span>Matéria</span><span>Simulados</span><span>Notas</span><span>Flashcards</span><span>Foco 14 dias</span><span>Erros</span><span>Situação</span></div>
      ${list.map(s => `<div class="subj-row ${s.level}" role="row" data-subj="${s.folderId}"><span class="subj-name"><i class="dot" style="background:${esc(s.color || '#888')}"></i>${esc(s.name)}</span>
        <span>${cell(s.quiz)}</span><span>${cell(s.grade)}</span><span>${cell(s.cards)}</span><span>${s.focus ? `${s.focus} min` : '<span class="muted">0</span>'}</span>
        <span>${s.openErr ? `<b class="bad-t">${s.openErr}</b>` : '0'}</span><span class="subj-lv">${LEVEL[s.level]}</span></div>`).join('')}
    </div></div>`;
}
