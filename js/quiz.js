// Simulado: a IA lê suas anotações, cria uma prova de múltipla escolha e corrige na hora.
import { ic, esc, h, toast, confirmBox } from './ui.js';
import { dayStr } from './hub.js';
import { aiConfigured, buildContent, streamChat, maxPages } from './ai.js';
import { saveGrade } from './perf.js';
import { addErrors } from './errors.js';
import { isUnlocked } from './lock.js';

let A;
let history = [];
let run = null; // simulado em andamento
let busy = null;
let mode = 'notes'; // 'notes' (das anotações) ou 'enem'
export const QUIZ_VIEWS = { quiz: { title: 'Simulado', icon: 'quiz' } };
const LEVELS = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDay(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export async function initQuiz(api) { A = api; history = await A.db.all('quizzes'); }
export async function reloadQuiz() { history = await A.db.all('quizzes'); }
export const quizCount = () => history.length;
export const quizData = () => history;

// Lê a resposta da IA e devolve só as perguntas válidas
export function parseQuiz(text) {
  let t = String(text).replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  let arr;
  try { arr = JSON.parse(t.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map(q => {
    const opts = (q.alternativas || q.opcoes || q.options || []).map(o => String(o).replace(/^\s*[a-eA-E][).:-]\s*/, '').trim());
    let c = q.correta ?? q.resposta ?? q.answer;
    if (typeof c === 'string' && /^[a-e]$/i.test(c.trim())) c = c.trim().toLowerCase().charCodeAt(0) - 97;
    const base = String(q.texto || q.texto_base || q.contexto || '').trim();
    return { q: String(q.pergunta || q.enunciado || q.question || '').trim(), opts, c: +c, ex: String(q.explicacao || q.explanation || '').trim(), ...(base ? { base } : {}) };
  }).filter(q => q.q && q.opts.length >= 2 && q.opts.length <= 6 && Number.isInteger(q.c) && q.c >= 0 && q.c < q.opts.length);
}

export function quizPrompt(n, level) {
  return `Crie um simulado com ${n} perguntas de múltipla escolha sobre o conteúdo destas anotações, nível ${LEVELS[level].toLowerCase()}.
Cada pergunta deve ter 4 alternativas, só uma correta, e uma explicação curta de por que ela é a certa.
Varie as perguntas (conceitos, exemplos, contas, interpretação) e não repita perguntas.
Responda APENAS com JSON válido, sem nenhum texto antes ou depois e sem blocos de código, exatamente neste formato:
[{"pergunta":"...","alternativas":["...","...","...","..."],"correta":0,"explicacao":"..."}]
"correta" é o número da alternativa certa (0, 1, 2 ou 3). Escreva em português do Brasil.`;
}

// ---------- Simulado estilo ENEM: 5 alternativas, texto-base, tempo de prova e gabarito comentado no fim ----------
export const ENEM_AREAS = { linguagens: 'Linguagens e Códigos', humanas: 'Ciências Humanas', natureza: 'Ciências da Natureza', matematica: 'Matemática' };
export const ENEM_MIN_PER_Q = 3;
export function enemPrompt(n, area, topic) {
  return `Crie ${n} questões inéditas no estilo do ENEM de ${ENEM_AREAS[area] || area}${topic ? `, sobre: ${topic}` : ''}.
Cada questão tem: um texto-base curto (situação do cotidiano, trecho de texto, dados ou tabela descritos em texto), um comando claro e 5 alternativas (A a E), só uma correta, com distratores plausíveis, e uma explicação curta da correta (gabarito comentado).
Nível do ENEM, conteúdo do ensino médio, em português do Brasil. Não repita questões.
Responda APENAS com JSON válido, sem texto antes ou depois e sem blocos de código, neste formato:
[{"texto":"...","pergunta":"...","alternativas":["...","...","...","...","..."],"correta":0,"explicacao":"..."}]
"correta" é o número da alternativa certa (0 a 4).`;
}
async function startEnem(el, area, topic, n, timed) {
  if (!aiConfigured()) { toast('Ligue a IA em Ajustes → Inteligência artificial (o Gemini é grátis)', 4000); return; }
  const box = el.querySelector('#qz-status');
  box.hidden = false;
  box.innerHTML = `<div class="ai-typing"><i></i><i></i><i></i></div><span>A IA está montando ${n} questões no estilo ENEM…</span>`;
  el.querySelector('#qz-enem-go').disabled = true;
  try {
    busy = streamChat([{ role: 'user', content: enemPrompt(n, area, topic) }], () => {}, { json: true, maxTokens: 16000 });
    const r = await busy.done;
    const qs = parseQuiz(r.text).filter(q => q.opts.length === 5).slice(0, n);
    if (qs.length < Math.min(2, n)) throw new Error('A IA não montou as questões direito. Tente de novo.');
    run = { id: A.uid(), title: `ENEM — ${ENEM_AREAS[area]}${topic ? `: ${topic}` : ''}`, folderId: '', level: 'enem', date: dayStr(), qs, i: 0, answers: [], createdAt: Date.now(), exam: true,
      deadline: timed ? Date.now() + qs.length * ENEM_MIN_PER_Q * 60000 : 0 };
    renderQuiz(el);
  } catch (e) {
    if (!e.aborted) box.innerHTML = `<span class="late">${esc(e.message)}</span>`;
    const go = el.querySelector('#qz-enem-go'); if (go) go.disabled = false;
  } finally { busy = null; }
}
// relógio da prova: atualiza na tela e entrega sozinho quando o tempo acaba
setInterval(() => {
  if (!run || !run.exam || run.finished || !run.deadline) return;
  const left = run.deadline - Date.now();
  const t = document.getElementById('qz-timer');
  if (t) { const m = Math.max(0, Math.ceil(left / 1000)); t.textContent = `⏱ ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; t.classList.toggle('late', left < 5 * 60000); }
  if (left <= 0) { toast('⏰ O tempo acabou: a prova foi entregue', 4000); finish().then(() => { const el = document.querySelector('.quiz-run'); if (el && A.currentView() === 'quiz') A.onChange(); }); }
}, 500);

async function finish() {
  if (!run || run.finished) return;
  run.right = run.qs.filter((q2, k) => run.answers[k] === q2.c).length;
  run.total = run.qs.length;
  if (run.deadline) run.usedMin = Math.round((Date.now() - run.createdAt) / 60000);
  const rec = { id: run.id, title: run.title, folderId: run.folderId, level: run.level, date: run.date, right: run.right, total: run.total, createdAt: run.createdAt, qs: run.qs, answers: run.answers, exam: !!run.exam };
  run.finished = true;
  await A.db.put('quizzes', rec); history.push(rec);
  // o que errou vai para o caderno de erros
  await addErrors(run.qs.map((q2, k) => ({ q: q2, a: run.answers[k] })).filter(x => x.a !== x.q.c).map(({ q: q2, a }) => ({
    src: run.exam ? 'enem' : 'quiz', folderId: run.folderId, subject: run.title, q: q2.base ? `${q2.base}\n\n${q2.q}` : q2.q, opts: q2.opts, c: q2.c, answer: q2.opts[q2.c], mine: a == null ? '(sem resposta)' : q2.opts[a], ex: q2.ex,
  })));
}

function renderExam(el) {
  const q = run.qs[run.i], ans = run.answers[run.i];
  const L = 'ABCDE';
  const answered = run.answers.filter(a => a != null).length;
  el.innerHTML = `<div class="review quiz-run exam">
    <div class="row"><button class="btn" id="qz-quit">${ic('close')}<span>Sair</span></button><span class="grow muted small">${esc(run.title)}</span>
      ${run.deadline ? '<b class="qz-timer" id="qz-timer">⏱</b>' : ''}<span class="muted">${run.i + 1} / ${run.qs.length}</span></div>
    <div class="qz-dots">${run.qs.map((_, k) => `<button class="qz-dot ${k === run.i ? 'cur' : ''} ${run.answers[k] != null ? 'ok' : ''}" data-go="${k}">${k + 1}</button>`).join('')}</div>
    <div class="panel qz-q">${q.base ? `<p class="qz-base">${esc(q.base)}</p>` : ''}<h2>${esc(q.q)}</h2></div>
    <div class="qz-opts">${q.opts.map((o, k) => `<button class="qz-opt ${ans === k ? 'picked' : ''}" data-o="${k}"><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div>
    <div class="row qz-nav"><button class="btn" id="qz-prev" ${run.i ? '' : 'disabled'}>${ic('left')}<span>Anterior</span></button><span class="grow"></span>
      ${run.i < run.qs.length - 1 ? `<button class="btn primary" id="qz-nxt"><span>Próxima</span>${ic('right')}</button>` : ''}
      <button class="btn ${run.i === run.qs.length - 1 ? 'primary' : ''}" id="qz-end">${ic('check')}<span>Entregar (${answered}/${run.qs.length})</span></button></div>
  </div>`;
  el.querySelector('#qz-quit').onclick = async () => { if (await confirmBox('Sair do simulado', 'As respostas deste simulado não serão salvas.', 'Sair')) { run = null; A.onChange(); } };
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { run.answers[run.i] = +b.dataset.o; renderExam(el); });
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { run.i = +b.dataset.go; renderExam(el); });
  el.querySelector('#qz-prev').onclick = () => { run.i--; renderExam(el); };
  el.querySelector('#qz-nxt')?.addEventListener('click', () => { run.i++; renderExam(el); });
  el.querySelector('#qz-end').onclick = async () => {
    const blank = run.qs.length - run.answers.filter(a => a != null).length;
    if (blank && !(await confirmBox('Entregar a prova', `Faltam ${blank} questão(ões) sem resposta. Entregar mesmo assim?`, 'Entregar', false))) return;
    await finish(); renderResult(el);
  };
}

async function start(el, src, n, level) {
  if (!aiConfigured()) { toast('Ligue a IA em Ajustes → Inteligência artificial (o Gemini é grátis)', 4000); return; }
  let pages = [], bg = null, title = '', folderId = '';
  if (src.startsWith('n:')) {
    const note = A.state.notes.find(x => x.id === src.slice(2));
    const c = await A.loadContent(note.id);
    pages = c.pages; bg = c.bg; title = note.title; folderId = note.folderId || '';
  } else {
    const f = src.slice(2);
    folderId = f; title = A.folderName(f) || 'Pasta';
    for (const note of A.state.notes.filter(x => x.folderId === f).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const c = await A.loadContent(note.id);
      pages.push(...c.pages.map(p => ({ ...p, _bg: c.bg, _title: note.title })));
      if (pages.length >= maxPages()) break;
    }
    if (!pages.length) { toast('Essa pasta não tem anotações'); return; }
  }
  const box = el.querySelector('#qz-status');
  box.hidden = false;
  box.innerHTML = `<div class="ai-typing"><i></i><i></i><i></i></div><span>A IA está lendo suas anotações e montando o simulado…</span>`;
  el.querySelector('#qz-go').disabled = true;
  try {
    const content = await buildContent({ pages, bg, title, folder: A.folderName(folderId), prompt: quizPrompt(n, level) });
    busy = streamChat([{ role: 'user', content }], () => {}, { json: true }); // resposta em JSON garantida pelo Gemini
    const r = await busy.done;
    const qs = parseQuiz(r.text).slice(0, n);
    if (qs.length < 2) throw new Error('A IA não montou as perguntas direito. Tente de novo.');
    run = { id: A.uid(), title, folderId, level, date: dayStr(), qs, i: 0, answers: [], createdAt: Date.now() };
    renderQuiz(el);
  } catch (e) {
    if (!e.aborted) { box.innerHTML = `<span class="late">${esc(e.message)}</span>`; }
    const go = el.querySelector('#qz-go'); if (go) go.disabled = false;
  } finally { busy = null; }
}

function renderSetup(el) {
  const notes = [...A.state.notes].filter(n => !n.locked || isUnlocked()).sort((a, b) => b.updatedAt - a.updatedAt);
  const folders = A.state.folders.filter(f => A.state.notes.some(n => n.folderId === f.id));
  el.innerHTML = `<div class="quiz-wrap"><div class="panel quiz-setup">
      <h3>${ic('quiz')}Novo simulado</h3>
      <div class="seg full-seg" id="qz-mode"><button type="button" data-m="notes" class="${mode === 'notes' ? 'active' : ''}">📒 Das minhas anotações</button><button type="button" data-m="enem" class="${mode === 'enem' ? 'active' : ''}">🎯 Estilo ENEM</button></div>
      <div class="qz-enem" ${mode === 'enem' ? '' : 'hidden'}>
        <label class="lbl">Área</label><select class="select full" id="qz-area">${Object.entries(ENEM_AREAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <label class="lbl">Assunto (opcional)</label><input class="input" id="qz-topic" placeholder="Ex.: funções do 1º grau, Revolução Industrial, ecologia…">
        <div class="row"><div class="grow"><label class="lbl">Questões</label><div class="seg full-seg" id="qz-en">${[5, 10, 20].map(n => `<button type="button" data-n="${n}" class="${n === 5 ? 'active' : ''}">${n}</button>`).join('')}</div></div>
          <label class="check grow"><input type="checkbox" id="qz-timed" checked> ⏱ Com tempo de prova (${ENEM_MIN_PER_Q} min por questão)</label></div>
        <button class="btn primary big full" id="qz-enem-go">${ic('magic')}<span>Gerar simulado ENEM</span></button>
      </div>
      <div class="qz-notes" ${mode === 'enem' ? 'hidden' : ''}>
      <label class="lbl">Sobre o quê?</label>
      <select class="select full" id="qz-src">
        ${folders.length ? `<optgroup label="Pasta inteira">${folders.map(f => `<option value="f:${f.id}">📁 ${esc(f.name)}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Uma anotação">${notes.map(n => `<option value="n:${n.id}">${esc(n.title)}</option>`).join('')}</optgroup>
      </select>
      <div class="row"><div class="grow"><label class="lbl">Perguntas</label><div class="seg full-seg" id="qz-n">${[5, 10, 15].map(n => `<button type="button" data-n="${n}" class="${n === 5 ? 'active' : ''}">${n}</button>`).join('')}</div></div>
        <div class="grow"><label class="lbl">Nível</label><div class="seg full-seg" id="qz-lv">${Object.entries(LEVELS).map(([k, v]) => `<button type="button" data-l="${k}" class="${k === 'medio' ? 'active' : ''}">${v}</button>`).join('')}</div></div></div>
      <button class="btn primary big full" id="qz-go" ${notes.length ? '' : 'disabled'}>${ic('magic')}<span>Gerar simulado com IA</span></button>
      ${notes.length ? '' : '<p class="muted small">Crie uma anotação primeiro: o simulado é feito a partir dela. Ou use o modo ENEM.</p>'}
      </div>
      <div class="qz-status" id="qz-status" hidden></div>
    </div>
    <div class="panel"><h3>${ic('chart')}Seus simulados</h3>
      <div class="qz-hist">${[...history].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(q => {
        const pct = Math.round((q.right / q.total) * 100);
        return `<div class="qz-row"><span class="grow"><b>${esc(q.title)}</b><span class="muted small"> · ${fmtDate(q.date)} · ${q.exam ? 'ENEM' : LEVELS[q.level] || ''}</span></span>
          <span class="status ${pct >= 60 ? 'good' : 'bad'}">${pct >= 60 ? ic('check') : '!'} ${q.right}/${q.total}</span>
          <button class="icon-btn small" data-qdel="${q.id}" aria-label="Excluir">${ic('trash')}</button></div>`;
      }).join('') || '<p class="muted small">Seus resultados aparecem aqui.</p>'}</div></div></div>`;
  const pick = (sel, attr) => el.querySelector(sel).onclick = e => {
    const b = e.target.closest(`[${attr}]`); if (!b) return;
    el.querySelectorAll(`${sel} button`).forEach(x => x.classList.toggle('active', x === b));
  };
  pick('#qz-n', 'data-n'); pick('#qz-lv', 'data-l'); pick('#qz-en', 'data-n');
  el.querySelector('#qz-mode').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; renderSetup(el); };
  el.querySelector('#qz-enem-go').onclick = () => {
    startEnem(el, el.querySelector('#qz-area').value, el.querySelector('#qz-topic').value.trim(), +el.querySelector('#qz-en .active').dataset.n, el.querySelector('#qz-timed').checked);
  };
  el.querySelector('#qz-go').onclick = () => start(el, el.querySelector('#qz-src').value,
    +el.querySelector('#qz-n .active').dataset.n, el.querySelector('#qz-lv .active').dataset.l);
  el.querySelectorAll('[data-qdel]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Excluir resultado', 'Excluir este simulado do histórico?', 'Excluir'))) return;
    await A.db.del('quizzes', b.dataset.qdel); history = history.filter(x => x.id !== b.dataset.qdel); renderSetup(el);
  });
}

function renderQuestion(el) {
  const q = run.qs[run.i], ans = run.answers[run.i];
  const L = 'ABCDEF';
  el.innerHTML = `<div class="review quiz-run">
    <div class="row"><button class="btn" id="qz-quit">${ic('close')}<span>Sair</span></button><div class="grow progress"><i style="width:${(run.i / run.qs.length) * 100}%"></i></div><span class="muted">${run.i + 1} / ${run.qs.length}</span></div>
    <div class="panel qz-q"><div class="muted small">${esc(run.title)} · ${LEVELS[run.level]}</div><h2>${esc(q.q)}</h2></div>
    <div class="qz-opts">${q.opts.map((o, k) => `<button class="qz-opt ${ans != null ? (k === q.c ? 'right' : k === ans ? 'wrong' : 'dim') : ''}" data-o="${k}" ${ans != null ? 'disabled' : ''}><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div>
    ${ans != null ? `<div class="panel qz-ex ${ans === q.c ? 'ok' : 'no'}"><b>${ans === q.c ? '✓ Certo!' : `✗ A certa é a ${L[q.c]}`}</b>${q.ex ? `<p>${esc(q.ex)}</p>` : ''}</div>
      <button class="btn primary big full" id="qz-next">${run.i === run.qs.length - 1 ? 'Ver resultado' : 'Próxima pergunta'}</button>` : ''}
  </div>`;
  el.querySelector('#qz-quit').onclick = async () => { if (await confirmBox('Sair do simulado', 'As respostas deste simulado não serão salvas.', 'Sair')) { run = null; A.onChange(); } };
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { run.answers[run.i] = +b.dataset.o; renderQuestion(el); });
  el.querySelector('#qz-next')?.addEventListener('click', async () => {
    if (run.i < run.qs.length - 1) { run.i++; renderQuestion(el); return; }
    await finish();
    renderResult(el);
  });
}

function renderResult(el) {
  const pct = Math.round((run.right / run.total) * 100);
  const wrong = run.qs.map((q, k) => ({ q, a: run.answers[k] })).filter(x => x.a !== x.q.c);
  const nota = Math.round((run.right / run.total) * 100) / 10;
  el.innerHTML = `<div class="review quiz-run"><div class="panel review-done">
      <div class="qz-score ${pct >= 60 ? 'ok' : 'no'}">${pct}%</div>
      <h2>${run.right} de ${run.total} certas</h2>${run.usedMin != null ? `<p class="muted small">Tempo: ${run.usedMin} min</p>` : ''}
      ${wrong.length ? `<p class="small">📒 Os ${wrong.length} erros foram para o <button class="link" id="qz-errs">Caderno de erros</button>.</p>` : ''}
      <p class="muted">${pct >= 90 ? 'Excelente! Você domina esse conteúdo. 🏆' : pct >= 60 ? 'Bom trabalho! Revise os erros abaixo. 💪' : 'Vale revisar o conteúdo e tentar de novo. Você consegue! 📚'}</p>
      <div class="row wrap center">
        <button class="btn" id="qz-grade">${ic('award')}<span>Lançar ${nota.toLocaleString('pt-BR')} em Notas</span></button>
        ${wrong.length ? `<button class="btn" id="qz-cards">${ic('cards')}<span>Flashcards dos ${wrong.length} erros</span></button>` : ''}
        <button class="btn primary" id="qz-new">${ic('quiz')}<span>Novo simulado</span></button></div></div>
    ${wrong.length ? `<h3 class="sec">Gabarito comentado dos erros</h3>${wrong.map(({ q, a }) => `<div class="panel qz-wrong">${q.base ? `<p class="qz-base small">${esc(q.base)}</p>` : ''}<b>${esc(q.q)}</b>
      <p class="late small">Sua resposta: ${esc(q.opts[a] ?? '—')}</p><p class="small"><b>Certa:</b> ${esc(q.opts[q.c])}</p>${q.ex ? `<p class="muted small">${esc(q.ex)}</p>` : ''}</div>`).join('')}` : ''}
  </div>`;
  el.querySelector('#qz-new').onclick = () => { run = null; A.onChange(); };
  el.querySelector('#qz-errs')?.addEventListener('click', () => { run = null; A.go('errors'); });
  // (o botão é guardado antes de esperar: depois da espera o evento não sabe mais qual foi tocado)
  el.querySelector('#qz-grade').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    await saveGrade({ folderId: run.folderId, title: `Simulado — ${run.title}`, score: nota, max: 10, weight: 1 });
    toast('Nota lançada em Notas e provas ✓');
  };
  el.querySelector('#qz-cards')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    const r = await A.saveFlashcards(wrong.map(({ q }) => ({ front: q.q, back: q.opts[q.c] + (q.ex ? `\n\n${q.ex}` : '') })), { deckName: `Erros — ${run.title}`, folderId: run.folderId });
    toast(`${r.n} flashcards criados em “${r.deck.name}” ✓`);
  });
}

export function renderQuiz(el) {
  if (run && run.finished) return renderResult(el);
  if (run && run.exam) return renderExam(el);
  if (run) return renderQuestion(el);
  renderSetup(el);
}
export function leaveQuiz() { if (busy) { busy.abort(); busy = null; } if (run && run.finished) run = null; }
