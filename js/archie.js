// Archie, o mentor de produtividade (a corujinha de capa). Ele vê tudo o que está no app (tarefas, agenda,
// planos, erros, notas, flashcards, foco, anotações…) e pode AGIR por você: criar tarefas, eventos, planos,
// flashcards, notas, abrir telas, buscar anotações e começar o foco. Muda de expressão conforme o que você
// está fazendo e evolui junto com o seu nível (Iniciante → Estudante → Analista → Mentor → Lendário).
import { ic, esc, h, toast, modal, richText, keepDraft } from './ui.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';
import { dayStr, addDays, hubData, dueCount, focusToday, focusCfg, startFocusFor, focusRunning, studyStreak } from './hub.js';
import { suggestions } from './suggest.js';
import { levelInfo, perfData } from './perf.js';
import { errorsData } from './errors.js';
import { plansData, createPlan } from './plan.js';
import { subjectStats } from './subjects.js';
import { addQuick } from './quicknotes.js';
import { inkSearchText } from './inkindex.js';
import { isUnlocked } from './lock.js';
import { attachDictation } from './voice.js';

let A;
const IMG = k => `icons/archie/${k}.webp`;
export const SKINS = [
  { k: 'iniciante', name: 'Iniciante', min: 1 }, { k: 'estudante', name: 'Estudante', min: 3 }, { k: 'analista', name: 'Analista', min: 6 },
  { k: 'mentor', name: 'Mentor', min: 10 }, { k: 'lendario', name: 'Lendário', min: 15 },
];
export const skinFor = lvl => [...SKINS].reverse().find(s => lvl >= s.min) || SKINS[0];
const CHAT_KEY = 'caderno-archie-chat', SKIN_KEY = 'caderno-archie-skin', SAY_KEY = 'caderno-archie-dica';
let chat = [];
let flash = null; // expressão passageira { k, until }
let btn, bubble, panel = null, busy = null;

const loadChat = () => { try { chat = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch { chat = []; } };
// (as ações já feitas ficam só como registro: o botão de "ir" só vale na conversa atual)
const saveChat = () => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-40).map(m => ({ ...m, done: (m.done || []).map(d => ({ ok: d.ok, err: d.err })), sugs: undefined, sugRuns: undefined, pending: false })))); } catch { /* */ } };

// ---------- humor (expressão) conforme o momento ----------
export function moodNow(now = new Date()) {
  if (flash && Date.now() < flash.until) return flash.k;
  const hr = now.getHours();
  if (focusRunning()) return 'focado';
  if (hr >= 23 || hr < 5) return 'cansado';
  const today = dayStr(now);
  const late = A.state.tasks.filter(t => !t.done && t.due && t.due < today).length;
  if (late >= 3) return 'surpreso';
  if (errorsData().filter(e => !e.resolvedAt).length >= 5) return 'pensando';
  if (studyStreak() >= 3) return 'confiante';
  return hr < 12 ? 'neutro' : 'feliz';
}
export function react(k, ms = 5000) { flash = { k, until: Date.now() + ms }; refresh(); setTimeout(refresh, ms + 50); }

// ---------- botão flutuante e balão de dica ----------
export function initArchie(api) {
  A = api;
  loadChat();
  btn = h(`<button id="archie-btn" class="archie-btn" aria-label="Falar com o Archie" title="Archie, seu mentor"><img alt="" src="${IMG('neutro')}"><span class="archie-dot" hidden></span></button>`);
  bubble = h('<div id="archie-say" class="archie-say" role="status" hidden></div>');
  btn.onclick = () => openArchie();
  document.body.append(btn, bubble);
  document.addEventListener('caderno-tarefa-feita', e => { react('concluiu', 4500); say(pick(['Mandou bem! ✓', 'Mais uma! 💪', 'Isso aí! Tarefa concluída 🎉', 'Boa! Uma a menos ✓']) + (e.detail && e.detail.title ? ` “${e.detail.title.slice(0, 40)}”` : ''), 4000); });
  setInterval(refresh, 30000);
  setTimeout(() => { refresh(); checkEvolution(); tipOnce(); }, 2500);
}
const pick = a => a[Math.floor(Math.random() * a.length)];
export function refresh() {
  if (!btn) return;
  const k = moodNow();
  const img = btn.querySelector('img');
  if (!img.src.endsWith(`/${k}.webp`)) img.src = IMG(k);
  btn.dataset.mood = k;
  btn.hidden = document.body.classList.contains('editing') || document.body.classList.contains('zen');
  if (btn.hidden) bubble.hidden = true;
}
// fala uma frase curta no balão (some sozinho)
export function say(text, ms = 7000, run) {
  if (!bubble || btn.hidden) return;
  bubble.innerHTML = `<span>${esc(text)}</span>${run ? `<button class="archie-say-go">${ic('right')}</button>` : ''}<button class="archie-say-x" aria-label="Fechar">${ic('close')}</button>`;
  bubble.hidden = false;
  bubble.querySelector('.archie-say-x').onclick = e => { e.stopPropagation(); bubble.hidden = true; };
  bubble.onclick = () => { bubble.hidden = true; if (run) run(); else openArchie(); };
  clearTimeout(bubble._t); bubble._t = setTimeout(() => { bubble.hidden = true; }, ms);
}
// uma dica por vez, no máximo a cada 3 horas
function tipOnce() {
  let last = 0; try { last = +localStorage.getItem(SAY_KEY) || 0; } catch { /* */ }
  if (Date.now() - last < 3 * 3600000) return;
  const s = suggestions()[0];
  if (!s || s.score < 30) return;
  try { localStorage.setItem(SAY_KEY, String(Date.now())); } catch { /* */ }
  say(`${saudacao()}! Que tal: ${s.title}?`, 9000, s.run);
}
const saudacao = () => { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; };

// ---------- evolução ----------
export function checkEvolution() {
  const L = levelInfo(), sk = skinFor(L.lvl);
  let prev = null; try { prev = localStorage.getItem(SKIN_KEY); } catch { /* */ }
  try { localStorage.setItem(SKIN_KEY, sk.k); } catch { /* */ }
  if (prev && prev !== sk.k && SKINS.findIndex(s => s.k === sk.k) > SKINS.findIndex(s => s.k === prev)) {
    react('evolucao', 8000);
    modal({ title: '✨ O Archie evoluiu!', body: `<div class="archie-evo"><img src="${IMG('evolucao')}" alt=""><img src="${IMG(sk.k)}" alt=""></div><p class="center">Você chegou ao <b>nível ${L.lvl}</b> e o Archie virou <b>${sk.name}</b>! Continue assim. 🦉</p>`, actions: [{ label: 'Valeu, Archie!', value: true, primary: true }] });
    return true;
  }
  return false;
}

// ---------- o que o Archie sabe (resumo do app, sem conteúdo trancado) ----------
export function snapshot() {
  const today = dayStr(), S = A.state;
  const fname = id => A.folderName(id) || '';
  const L = levelInfo(), sk = skinFor(L.lvl);
  const pend = S.tasks.filter(t => !t.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1).slice(0, 40)
    .map(t => `- ${t.title}${t.due ? ` (prazo ${t.due}${t.due < today ? ', ATRASADA' : ''})` : ''}${t.prio === 3 ? ' [alta]' : ''}${t.folderId ? ` {${fname(t.folderId)}}` : ''}`);
  const evs = (A.ev ? A.ev.upcoming(45) : []).slice(0, 20).map(e => `- ${e.date}${e.time ? ' ' + e.time : ''}: ${e.title} (${e.kind || 'evento'})`);
  const exams = (perfData().grades || []).filter(g => g.score == null && g.date >= today).map(g => `- ${g.date}: ${g.title} {${fname(g.folderId)}}`);
  const plans = plansData().map(p => { const ts = S.tasks.filter(t => t.planId === p.id); return `- ${p.name}: prova ${p.exam}, ${ts.filter(t => t.done).length}/${ts.length} sessões feitas, ${ts.filter(t => !t.done && t.due < today).length} atrasadas`; });
  const subj = subjectStats().map(s => `- ${s.name}: ${s.score == null ? 'sem dados' : s.score + '%'}${s.openErr ? `, ${s.openErr} erros para revisar` : ''}, foco 14 dias ${s.focus} min`);
  const notes = [...S.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40).map(n => `- ${n.title}${n.folderId ? ` {${fname(n.folderId)}}` : ''}${n.locked ? ' (trancada)' : ''}`);
  const habits = hubData().habits.map(hb => `- ${hb.name}: ${hb.days[today] ? 'feito hoje' : 'falta hoje'}`);
  const goal = (focusCfg() && focusCfg().goal) || 60;
  return `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} (${today}), ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
Nível do estudante: ${L.lvl} (${L.xp} XP). Archie está na forma ${sk.name}. Sequência de estudo: ${studyStreak()} dia(s).
Foco hoje: ${focusToday()} de ${goal} min${focusRunning() ? ' (foco rodando agora)' : ''}. Flashcards para revisar hoje: ${dueCount()}. Erros pendentes no caderno de erros: ${errorsData().filter(e => !e.resolvedAt).length}.
Matérias (pastas): ${S.folders.map(f => f.name).join(', ') || 'nenhuma'}
Tarefas pendentes:\n${pend.join('\n') || '- nenhuma'}
Agenda (próximos 45 dias):\n${evs.join('\n') || '- nada'}
Provas cadastradas:\n${exams.join('\n') || '- nenhuma'}
Planos de estudo:\n${plans.join('\n') || '- nenhum'}
Desempenho por matéria:\n${subj.join('\n') || '- sem dados'}
Hábitos:\n${habits.join('\n') || '- nenhum'}
Anotações recentes:\n${notes.join('\n') || '- nenhuma'}`;
}

const TELAS = 'today (Hoje), tasks (Tarefas), quick (Notas rápidas), calendar (Agenda), avisos (Avisos), schedule (Horário), plans (Plano de estudos), goals (Metas), notes (Caderno), focus (Foco), cards (Flashcards), quiz (Simulado e ENEM), errors (Caderno de erros), formulas (Fórmulas), tools (Ferramentas: tabela periódica, gráfico, tradutor), tutor (Tutor IA), reading (Leitura), habits (Hábitos), journal (Diário), grades (Notas e provas), report (Relatório e desempenho), data (Dados e backup)';
export function systemPrompt() {
  return `Você é o Archie, uma corujinha mentora de produtividade e estudos que mora dentro do app "Caderno de Estudos" de um estudante brasileiro.
Seu jeito: animado, gentil, direto e motivador, fala português do Brasil simples, frases curtas, pode usar 1 ou 2 emojis. Nunca invente dados: use só o RESUMO DO APP.
Você conhece o app inteiro: caderno à mão (caneta, post-it, grifo, ditado, organizar nas linhas, mapa mental, modelos, IA), adição rápida no Hoje e no botão + (entende frases como “prova de física sexta 8h” ou “lista de mat amanhã !”), tarefas (arrastar com o dedo → conclui, ← adia para amanhã), agenda com avisos, plano de estudos, metas, foco (pomodoro), flashcards, simulado (também estilo ENEM com tempo), caderno de erros, fórmulas, ferramentas (tabela periódica, gráfico de funções, tradutor), tutor IA, leitura e Kindle, hábitos, diário, notas e provas, relatório com desempenho por matéria, backup no Google Drive e cadeado.
Você pode AGIR no app devolvendo ações. Ações disponíveis (use só quando o estudante pedir ou concordar claramente):
- {"tipo":"criar_tarefa","titulo":"...","prazo":"AAAA-MM-DD ou vazio","prioridade":1|2|3,"materia":"nome da pasta ou vazio"}
- {"tipo":"concluir_tarefa","titulo":"parte do título"}
- {"tipo":"criar_evento","titulo":"...","data":"AAAA-MM-DD","hora":"HH:MM ou vazio","categoria":"prova|trabalho|aula|consulta|aniversario|outro","prioridade":1|2|3}
- {"tipo":"criar_nota_rapida","texto":"..."}
- {"tipo":"criar_anotacao","titulo":"...","texto":"conteúdo em tópicos","materia":"..."}
- {"tipo":"criar_flashcards","baralho":"...","materia":"...","cartas":[{"frente":"...","verso":"..."}]}
- {"tipo":"criar_plano","nome":"...","data":"AAAA-MM-DD","sessoes_por_dia":2,"materias":[{"nome":"...","assuntos":["..."]}]}
- {"tipo":"iniciar_foco","materia":"nome ou vazio"}
- {"tipo":"abrir_tela","tela":"uma destas chaves: ${TELAS}"}
- {"tipo":"buscar_anotacoes","termo":"..."}
- {"tipo":"abrir_anotacao","titulo":"..."}
Prioridade: 1 = baixa, 2 = média, 3 = alta (se o estudante disser "importante", "urgente" ou "alta", use 3).
Datas relativas ("amanhã", "sexta") devem virar AAAA-MM-DD a partir da data de hoje do resumo.
Responda SEMPRE e APENAS com JSON válido: {"resposta":"o que você diz ao estudante (até 6 linhas, pode usar - para listas)","humor":"feliz|animado|confiante|pensando|surpreso|focado|planejando|estudando","acoes":[...]}
Se não precisar agir, use "acoes":[].`;
}
export function parseArchie(text) {
  const t = String(text).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return { resposta: String(o.resposta || o.reply || '').trim(), humor: String(o.humor || ''), acoes: Array.isArray(o.acoes) ? o.acoes.filter(x => x && x.tipo).slice(0, 12) : [] };
  } catch { return { resposta: cleanText(text).trim(), humor: '', acoes: [] }; }
}

// ---------- executa as ações pedidas ----------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const folderByName = name => { const n = norm(name); return n ? (A.state.folders.find(f => norm(f.name) === n) || A.state.folders.find(f => norm(f.name).includes(n) || n.includes(norm(f.name)))) : null; };
const okDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : '');
export async function runAction(x) {
  const t = x.tipo;
  if (t === 'criar_tarefa') {
    if (!x.titulo) return null;
    const f = folderByName(x.materia);
    const task = await A.addTask({ title: String(x.titulo).slice(0, 140), due: okDate(x.prazo), prio: [1, 2, 3].includes(+x.prioridade) ? +x.prioridade : 2, folderId: f ? f.id : '' });
    return { ok: `Tarefa criada: ${task.title}${task.due ? ` (${task.due.split('-').reverse().slice(0, 2).join('/')})` : ''}`, go: () => A.go('tasks') };
  }
  if (t === 'concluir_tarefa') {
    const q = norm(x.titulo);
    if (!q) return { err: 'Qual tarefa? Diga o nome dela' };
    const task = A.state.tasks.find(k => !k.done && norm(k.title) === q) || A.state.tasks.find(k => !k.done && norm(k.title).includes(q));
    if (!task) return { err: `Não achei a tarefa “${x.titulo}”` };
    await A.toggleTask(task.id);
    return { ok: `Concluída: ${task.title}` };
  }
  if (t === 'criar_evento') {
    const date = okDate(x.data); if (!x.titulo || !date) return { err: 'Faltou o nome ou a data do evento' };
    const ev = { id: A.uid(), title: String(x.titulo).slice(0, 120), date, time: /^\d{2}:\d{2}$/.test(x.hora || '') ? x.hora : '', prio: [1, 2, 3].includes(+x.prioridade) ? +x.prioridade : 2, kind: ['prova', 'trabalho', 'aula', 'consulta', 'aniversario', 'outro'].includes(x.categoria) ? x.categoria : 'outro', notes: '', remind: true, createdAt: Date.now(), updatedAt: Date.now() };
    await A.db.put('events', ev); await A.ev.reloadEvents();
    return { ok: `Evento na agenda: ${ev.title} (${date.split('-').reverse().slice(0, 2).join('/')}${ev.time ? ' ' + ev.time : ''}) 🔔`, go: () => A.go('calendar') };
  }
  if (t === 'criar_nota_rapida') { if (!x.texto) return null; await addQuick(String(x.texto).slice(0, 4000)); return { ok: 'Nota rápida salva', go: () => A.go('quick') }; }
  if (t === 'criar_anotacao') {
    if (!x.titulo) return null;
    const f = folderByName(x.materia);
    const m = await A.createNoteFromText(String(x.titulo).slice(0, 100), f ? f.id : '', String(x.texto || ''), { open: false });
    return { ok: `Anotação criada: ${m.title}`, go: () => A.openNote(m.id) };
  }
  if (t === 'criar_flashcards') {
    const cards = (x.cartas || []).map(c => ({ front: String(c.frente || c.front || '').trim(), back: String(c.verso || c.back || '').trim() })).filter(c => c.front && c.back).slice(0, 40);
    if (!cards.length) return { err: 'Faltaram as cartas' };
    const f = folderByName(x.materia);
    const r = await A.saveFlashcards(cards, { deckName: String(x.baralho || 'Archie').slice(0, 80), folderId: f ? f.id : '' });
    return { ok: `${r.n} flashcards em “${r.deck.name}”`, go: () => A.go('cards') };
  }
  if (t === 'criar_plano') {
    const date = okDate(x.data); if (!x.nome || !date || date <= dayStr()) return { err: 'Para o plano preciso do nome da prova e de uma data futura' };
    const subjects = (x.materias || []).map(m => { const f = folderByName(m.nome); return { folderId: f ? f.id : '', name: f ? f.name : String(m.nome || '').trim(), topics: (m.assuntos || []).map(String).filter(Boolean).slice(0, 20) }; }).filter(s => s.name);
    if (!subjects.length) return { err: 'Faltaram as matérias do plano' };
    const p = await createPlan({ name: String(x.nome).slice(0, 80), exam: date, perDay: Math.min(4, Math.max(1, +x.sessoes_por_dia || 2)), subjects });
    return p ? { ok: `Plano criado: ${p.name} (prova ${date.split('-').reverse().slice(0, 2).join('/')})`, go: () => A.go('plans') } : { err: 'Não consegui montar o plano com essas datas' };
  }
  if (t === 'iniciar_foco') { const f = folderByName(x.materia); startFocusFor({ folderId: f ? f.id : '' }); A.go('focus'); return { ok: `Foco iniciado${f ? ` em ${f.name}` : ''} ⏱️` }; }
  if (t === 'abrir_tela') {
    const k = String(x.tela || '').trim();
    if (!A.views()[k] && !['tasks', 'notes'].includes(k)) return { err: `Não conheço a tela “${k}”` };
    return { ok: `Abrindo ${k === 'notes' ? 'o Caderno' : (A.views()[k] || { title: 'Tarefas' }).title}`, go: () => A.go(k), auto: true };
  }
  if (t === 'buscar_anotacoes') {
    const q = norm(x.termo); if (!q) return null;
    const found = A.state.notes.filter(n => !(n.locked && !isUnlocked()) && (norm(n.title).includes(q) || norm(inkSearchText(n)).includes(q))).slice(0, 6);
    return found.length ? { ok: `Achei ${found.length} anotação(ões) com “${x.termo}”`, notes: found } : { err: `Nenhuma anotação com “${x.termo}”` };
  }
  if (t === 'abrir_anotacao') {
    const q = norm(x.titulo);
    if (!q) return { err: 'Qual anotação? Diga o nome dela' };
    const n = A.state.notes.find(k => norm(k.title) === q) || A.state.notes.find(k => norm(k.title).includes(q));
    if (!n) return { err: `Não achei a anotação “${x.titulo}”` };
    return { ok: `Abrindo “${n.title}”`, go: () => A.openNote(n.id), auto: true };
  }
  return null;
}

// ---------- respostas sem IA (sem internet ou sem chave) ----------
export function localAnswer(text) {
  const q = norm(text);
  const sg = suggestions();
  if (/agora|fazer hoje|o que (eu )?fac|por onde/.test(q) || !q) {
    return { resposta: sg.length ? `${saudacao()}! Eu começaria por estas, nesta ordem (toque para fazer):` : 'Tudo em dia! 🎉 Que tal um simulado rápido?', humor: 'planejando', sugestoes: sg };
  }
  if (/semana|resumo|como estou|desempenho/.test(q)) {
    const today = dayStr(), wk = addDays(today, -6);
    const foco = hubData().sessions.filter(s => s.date >= wk).reduce((n, s) => n + s.minutes, 0);
    const feitas = A.state.tasks.filter(t => t.done && t.doneAt && t.doneAt >= Date.now() - 7 * 86400000).length;
    const weak = subjectStats().filter(s => s.score != null).sort((a, b) => a.score - b.score)[0];
    return { resposta: `Seus últimos 7 dias:\n- ⏱️ ${foco} min de foco\n- ✅ ${feitas} tarefas concluídas\n- 🃏 ${dueCount()} flashcards para hoje\n- 📒 ${errorsData().filter(e => !e.resolvedAt).length} erros para revisar${weak ? `\n- 📊 Matéria para reforçar: ${weak.name} (${weak.score}%)` : ''}`, humor: 'confiante' };
  }
  if (/erro/.test(q)) return { resposta: 'Bora transformar erro em acerto! Abri o caderno de erros para você. 💪', humor: 'animado', acoes: [{ tipo: 'abrir_tela', tela: 'errors' }] };
  if (/plano|cronograma/.test(q)) return { resposta: 'Vamos montar seu plano! Abri o Plano de estudos: toque em "Novo plano".', humor: 'planejando', acoes: [{ tipo: 'abrir_tela', tela: 'plans' }] };
  if (/foco|concentr|estudar agora/.test(q)) return { resposta: 'Foco ligado! Guarde o celular e bora. ⏱️', humor: 'focado', acoes: [{ tipo: 'iniciar_foco' }] };
  if (/motiva|desanim|cansad|preguic/.test(q)) return { resposta: pick(['Um passo de cada vez: 25 minutos agora valem mais que 3 horas "depois". 💜', 'Você já chegou até aqui. Faz só a primeira tarefa, que o resto vem. 🦉', 'Cansado é normal. Que tal 10 minutos de foco e uma pausa? Eu fico de olho no tempo.']), humor: 'feliz' };
  return { resposta: aiConfigured() ? 'Hmm, não consegui falar com a IA agora (sem internet?). Mas posso: dizer o que fazer agora, resumir sua semana, abrir o caderno de erros ou montar um plano.' : 'Para conversar sobre qualquer coisa, ligue a IA em Ajustes → Inteligência artificial. Sem ela eu já sei: o que fazer agora, resumo da semana, erros, plano e foco.', humor: 'pensando' };
}

// ---------- painel de conversa ----------
const QUICK = [['O que faço agora?', 'route'], ['Como estou na semana?', 'chart'], ['Monte meu plano de estudos', 'calendar'], ['Revisar meus erros', 'alert'], ['Me motiva! 💜', 'flame']];
export function openArchie(prefill = '') {
  if (panel) { panel.querySelector('#ar-q').focus(); return; }
  const L = levelInfo(), sk = skinFor(L.lvl), nextSk = SKINS[SKINS.indexOf(sk) + 1];
  panel = h(`<div class="archie-panel" role="dialog" aria-label="Archie">
    <div class="ar-head"><img class="ar-skin" src="${IMG(sk.k)}" alt=""><div class="grow"><b>Archie</b> <span class="ar-tag">${sk.name}</span>
      <div class="muted small">Nível ${L.lvl} · ${nextSk ? `evolui para ${nextSk.name} no nível ${nextSk.min}` : 'forma máxima! ✨'}</div>
      <div class="goal-bar"><i style="width:${(L.into / L.need) * 100}%"></i></div></div>
      <button class="icon-btn small" id="ar-clear" title="Nova conversa" aria-label="Nova conversa">${ic('plus')}</button>
      <button class="icon-btn small" id="ar-close" aria-label="Fechar">${ic('close')}</button></div>
    <div class="ar-log" id="ar-log"></div>
    <div class="ar-quick">${QUICK.map(([t, i]) => `<button class="chip small" data-q="${esc(t)}">${ic(i)}<span>${esc(t)}</span></button>`).join('')}</div>
    <form class="ar-form" id="ar-form"><button type="button" class="icon-btn" id="ar-mic" aria-label="Falar">${ic('mic')}</button>
      <textarea id="ar-q" rows="1" placeholder="Peça qualquer coisa: “crie uma tarefa…”, “o que tenho essa semana?”"></textarea>
      <button class="icon-btn primary-ic" id="ar-send" aria-label="Enviar">${ic('send')}</button></form></div>`);
  document.body.appendChild(panel);
  document.body.classList.add('archie-open');
  if (bubble) bubble.hidden = true;
  const q = panel.querySelector('#ar-q');
  const clearDraft = keepDraft(q, 'archie');
  attachDictation(panel.querySelector('#ar-mic'), q);
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('#ar-form').requestSubmit(); } });
  panel.querySelector('#ar-form').onsubmit = e => { e.preventDefault(); const t = q.value.trim(); if (!t || busy) return; q.value = ''; clearDraft(); ask(t); };
  panel.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { if (!busy) ask(b.dataset.q); });
  panel.querySelector('#ar-close').onclick = closeArchie;
  panel.querySelector('#ar-clear').onclick = () => { chat = []; saveChat(); drawLog(); };
  if (prefill) q.value = prefill;
  drawLog();
  if (!chat.length) greet();
  setTimeout(() => q.focus(), 80);
}
export function closeArchie() { if (busy) { busy.abort(); busy = null; } if (panel) panel.remove(); panel = null; document.body.classList.remove('archie-open'); refresh(); }
function greet() {
  const sg = suggestions()[0];
  chat.push({ role: 'archie', text: `${saudacao()}! Eu sou o Archie 🦉, seu mentor. Vejo suas tarefas, agenda, planos, erros e anotações, e posso fazer coisas por você: criar tarefas, eventos, planos, flashcards, abrir telas e muito mais.${sg && sg.score >= 30 ? `\nAgora eu começaria por: ${sg.title}.` : ''}`, mood: 'feliz' });
  saveChat(); drawLog();
}
function drawLog() {
  if (!panel) return;
  const log = panel.querySelector('#ar-log');
  log.innerHTML = chat.map((m, i) => m.role === 'user'
    ? `<div class="ar-msg me">${esc(m.text)}</div>`
    : `<div class="ar-msg bot" data-i="${i}"><img src="${IMG(m.mood || 'neutro')}" alt=""><div class="grow"><div class="ar-text">${m.pending ? '<div class="ai-typing"><i></i><i></i><i></i></div>' : richText(m.text)}</div>
      ${(m.done || []).map((d, k) => `<button class="ar-done ${d.err ? 'err' : ''}" data-d="${i}:${k}">${d.err ? '⚠️ ' + esc(d.err) : '✓ ' + esc(d.ok)}${d.goFn ? ` ${ic('right')}` : ''}</button>`).join('')}
      ${(m.notes || []).map(n => `<button class="ar-done" data-n="${n.id}">${ic('page')} ${esc(n.title)}</button>`).join('')}
      ${(m.sugs || []).map((s, k) => `<button class="ar-done sug" data-s="${i}:${k}">${ic('right')} ${esc(s)}</button>`).join('')}</div></div>`).join('');
  log.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.d.split(':').map(Number); const d = (chat[i].done || [])[k]; if (d && d.goFn) { closeArchie(); d.goFn(); } });
  log.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { closeArchie(); A.openNote(b.dataset.n); });
  log.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.s.split(':').map(Number); const s = chat[i].sugRuns && chat[i].sugRuns[k]; if (s) { closeArchie(); s(); } });
  log.scrollTop = log.scrollHeight;
}

async function ask(text) {
  chat.push({ role: 'user', text });
  const m = { role: 'archie', text: '', pending: true, mood: 'pensando' };
  chat.push(m); drawLog(); react('pensando', 20000);
  let r;
  const local = /^(o que faço agora\?|como estou na semana\?|revisar meus erros|me motiva! 💜)$/i.test(text);
  if (!local && aiConfigured() && navigator.onLine) {
    try {
      const history = chat.slice(-12, -1).filter(x => !x.pending && x.text).map(x => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.role === 'user' ? x.text : [{ type: 'text', text: x.text }] }));
      const msgs = [{ role: 'user', content: `RESUMO DO APP (dados atuais do estudante):\n${snapshot()}` }, { role: 'assistant', content: [{ type: 'text', text: '{"resposta":"Entendido, estou vendo tudo.","humor":"feliz","acoes":[]}' }] }, ...history];
      if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: text });
      // o Gemini pede que as falas alternem (estudante, Archie, estudante…): junta falas seguidas do mesmo lado
      for (let k = msgs.length - 1; k > 0; k--) if (msgs[k].role === msgs[k - 1].role) {
        const tx = v => (typeof v === 'string' ? v : v.map(b => b.text || '').join('\n'));
        const merged = `${tx(msgs[k - 1].content)}\n${tx(msgs[k].content)}`;
        msgs[k - 1].content = msgs[k].role === 'user' ? merged : [{ type: 'text', text: merged }];
        msgs.splice(k, 1);
      }
      busy = streamChat(msgs, () => {}, { system: systemPrompt(), json: true });
      const res = await busy.done;
      r = parseArchie(res.text);
    } catch (e) {
      if (e.aborted) { chat.pop(); chat.pop(); drawLog(); return; }
      r = { ...localAnswer(text), resposta: `${localAnswer(text).resposta}\n\n(${e.message})` };
    } finally { busy = null; }
  } else r = localAnswer(text);
  m.pending = false;
  m.text = r.resposta || 'Pronto!';
  m.mood = ['feliz', 'animado', 'confiante', 'pensando', 'surpreso', 'focado', 'planejando', 'estudando', 'cansado', 'neutro', 'concluiu'].includes(r.humor) ? r.humor : 'feliz';
  if (r.sugestoes) { m.sugs = r.sugestoes.map(s => `${s.title} — ${s.why}`); m.sugRuns = r.sugestoes.map(s => s.run); }
  m.done = [];
  let autoGo = null;
  for (const x of r.acoes || []) {
    try {
      const d = await runAction(x);
      if (!d) continue;
      if (d.notes) m.notes = d.notes.map(n => ({ id: n.id, title: n.title }));
      m.done.push({ ok: d.ok, err: d.err, go: !!d.go, goFn: d.go });
      if (d.auto && d.go) autoGo = d.go;
    } catch (e) { m.done.push({ err: `Não consegui: ${e.message}` }); }
  }
  if (m.done.some(d => d.ok)) { m.mood = 'concluiu'; react('concluiu', 4000); } else react(m.mood, 6000);
  saveChat(); drawLog();
  if (m.done.some(d => d.ok)) A.onChange();
  // abrir tela / anotação: vai direto
  if (autoGo) setTimeout(() => { closeArchie(); autoGo(); }, 900);
}
