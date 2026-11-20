// Navegação: o "mapa" único do app. Menu lateral agrupado, barra inferior (tablet em pé),
// tela "Tudo", botão + de criação rápida, dicas de cada tela e tour de boas-vindas.
import { ic, esc, h, modal } from './ui.js';

let A;
export const SECTIONS = [
  {
    id: 'plan', title: 'Planejar', emoji: '🗓️', hint: 'Organize o que fazer e quando',
    items: [
      { k: 'today', icon: 'home', label: 'Hoje', desc: 'Seu dia em uma tela: o que fazer agora, prioridades, aulas, tarefas, foco e hábitos' },
      { k: 'tasks', icon: 'tasks', label: 'Tarefas', desc: 'Lista, quadro (Kanban) e matriz de prioridades, com subtarefas e repetição' },
      { k: 'quick', icon: 'sticky', label: 'Notas rápidas', short: 'Notas', desc: 'Ideias, lembretes e listas de marcar, no estilo post-it; viram tarefa com um toque' },
      { k: 'calendar', icon: 'calendar', label: 'Agenda', desc: 'Eventos importantes com prioridade e aviso 1 dia antes, tarefas, provas e foco de cada dia' },
      { k: 'avisos', icon: 'bell', label: 'Avisos', desc: 'Lembretes no tablet: eventos, tarefas, provas, aulas, flashcards, hábitos e hora de estudar' },
      { k: 'schedule', icon: 'clock', label: 'Horário de aulas', short: 'Horário', desc: 'Grade da semana, aula de agora e “Anotar nesta aula”' },
      { k: 'goals', icon: 'target', label: 'Metas', desc: 'Objetivos (horas de foco, livros, notas…) com progresso automático' },
    ],
  },
  {
    id: 'study', title: 'Estudar', emoji: '📚', hint: 'Aprenda, pratique e memorize',
    items: [
      { k: 'notes', icon: 'book', label: 'Caderno', desc: 'Anotações à mão: caneta, correção, contas, PDF, IA e gravação da aula' },
      { k: 'focus', icon: 'timer', label: 'Foco', desc: 'Pomodoro, cronômetro livre, sons de concentração e tela cheia' },
      { k: 'cards', icon: 'cards', label: 'Flashcards', short: 'Cartões', desc: 'Memorize com repetição espaçada; a IA cria as cartas' },
      { k: 'quiz', icon: 'quiz', label: 'Simulado', desc: 'A IA cria uma prova das suas anotações e corrige na hora' },
      { k: 'formulas', icon: 'sigma', label: 'Fórmulas', desc: 'Matemática e física: busque pelo nome (ex.: “área do círculo”) e o app calcula na hora' },
      { k: 'tutor', icon: 'chat', label: 'Tutor IA', short: 'Tutor', desc: 'Converse com a IA, mande foto do exercício e receba a explicação passo a passo' },
      { k: 'reading', icon: 'bookOpen', label: 'Leitura', desc: 'Livros, atalho do Kindle, meta de páginas e citações' },
    ],
  },
  {
    id: 'track', title: 'Acompanhar', emoji: '📈', hint: 'Veja sua evolução',
    items: [
      { k: 'habits', icon: 'flame', label: 'Hábitos', desc: 'Marque o que fez em cada dia e mantenha a sequência 🔥' },
      { k: 'journal', icon: 'journal', label: 'Diário', desc: 'Como foi o dia, o que aprendeu e o que foi difícil' },
      { k: 'grades', icon: 'award', label: 'Notas e provas', short: 'Provas', desc: 'Médias, quanto precisa tirar e contagem para as provas' },
      { k: 'report', icon: 'chart', label: 'Relatório', desc: 'Sua semana em números, conquistas e análise da IA' },
    ],
  },
];
export const ALL_ITEMS = SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s })));
export const sectionOf = kind => (ALL_ITEMS.find(i => i.k === kind) || {}).section;

// Dica curta de cada tela (aparece no topo até tocar em "Entendi")
const TIPS = {
  today: 'Este é o seu resumo do dia. Toque em ⭐ numa tarefa para colocá-la nas 3 prioridades de hoje.',
  tasks: 'Troque entre Lista, Quadro e Matriz no topo. Toque numa tarefa para editar, criar subtarefas ou repetir.',
  calendar: 'Toque num dia e em “Evento neste dia” para salvar provas, entregas e aniversários. O app avisa 1 dia antes. O 🗑 apaga.',
  schedule: 'Toque no + de um dia para cadastrar a aula. Na hora da aula, use “Anotar nesta aula”.',
  goals: 'Escolha o tipo de meta: o progresso é calculado sozinho com o que você faz no app.',
  notes: 'Toque numa anotação para escrever. No ⋮ de cada uma há IA, revisões, compartilhar e mais.',
  focus: 'Escolha Pomodoro ou Cronômetro, a matéria e um som. O relógio continua no canto enquanto você estuda.',
  cards: '“Revisar tudo” mostra só as cartas do dia. Seja sincero: Errei, Difícil, Bom ou Fácil.',
  quiz: 'Escolha uma anotação ou pasta: a IA cria as perguntas e você responde aqui mesmo.',
  reading: 'Abra o Kindle pelo botão e depois registre até onde leu.',
  habits: 'Toque nos quadradinhos para marcar os dias. A 🔥 mostra a sequência.',
  journal: 'Leva 1 minuto por dia. O que foi difícil pode virar tarefa de revisão.',
  grades: 'Lance as notas com peso. Deixe a nota em branco para cadastrar uma prova que ainda vai acontecer.',
  report: 'Compare com a semana anterior e peça à IA conselhos para a próxima.',
  map: 'Todas as partes do app num só lugar. Toque em qualquer cartão para abrir.',
  avisos: 'Escolha o que avisar e a que horas. Em “Próximos avisos” você vê tudo o que vai tocar. Para eventos importantes, use também o Google Agenda.',
  formulas: 'Busque pelo nome (“fórmula da força”, “área do círculo”). Abra a fórmula, preencha os números e deixe em branco o que quer descobrir: o app calcula.',
  quick: 'Anote ideias em segundos. Comece uma linha com [ ] para virar lista de marcar. 📌 fixa a nota no Hoje.',
  tutor: 'Pergunte qualquer dúvida ou mande a foto de um exercício: o tutor explica passo a passo. 🔊 lê a resposta em voz alta.',
  data: 'Tudo fica salvo no banco de dados do tablet. Faça um backup de vez em quando e guarde no Drive.',
};
const TIPS_KEY = 'caderno-dicas-vistas';
const seenTips = () => { try { return JSON.parse(localStorage.getItem(TIPS_KEY) || '{}'); } catch { return {}; } };

export function initNav(api) {
  A = api;
  // barra inferior (tablet em pé) e botão + flutuante
  const bar = h(`<nav id="bottom-bar" aria-label="Navegação principal">
    ${[['today', 'home', 'Hoje'], ['notes', 'book', 'Caderno'], ['tasks', 'tasks', 'Tarefas'], ['focus', 'timer', 'Foco'], ['more', 'grid', 'Mais']]
      .map(([k, i, l]) => `<button data-bk="${k}">${ic(i)}<span>${l}</span></button>`).join('')}</nav>`);
  bar.onclick = e => {
    const b = e.target.closest('[data-bk]'); if (!b) return;
    if (b.dataset.bk === 'more') openMore(); else A.go(b.dataset.bk);
  };
  document.body.appendChild(bar);
  const fab = h(`<button id="fab" aria-label="Criar">${ic('plus')}</button>`);
  fab.onclick = quickAdd;
  document.body.appendChild(fab);
}

export function updateBottomBar(kind) {
  const bar = document.getElementById('bottom-bar');
  if (!bar) return;
  const main = ['today', 'notes', 'tasks', 'focus'];
  bar.querySelectorAll('[data-bk]').forEach(b => b.classList.toggle('active', b.dataset.bk === kind || (b.dataset.bk === 'more' && !main.includes(kind))));
}

// Menu lateral agrupado
// Um item do menu: nome completo e nome curto (usado quando o menu está recolhido)
export function navItem(k, icon, label, n, active, short) {
  return `<button class="nav-item ${active ? 'active' : ''}" data-k="${k}" title="${esc(label)}">${ic(icon)}<span class="lbl-full">${esc(label)}</span><span class="lbl-short">${esc(short || label)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
}
export function sidebarHTML(kind, counts, extraCaderno) {
  return SECTIONS.map(s => `<div class="nav-sec"><div class="nav-sec-h">${s.title}</div>
    ${s.items.map(i => navItem(i.k === 'notes' ? 'all' : i.k, i.icon, i.k === 'focus' && counts.running ? 'Foco (rodando)' : i.label, counts[i.k] || 0, kind === i.k, i.short)).join('')}</div>`).join('')
    + `<div class="nav-sec"><div class="nav-sec-h">Caderno</div>${extraCaderno}</div>`;
}

// ---------- menu lateral retrátil ----------
const COLLAPSE_KEY = 'caderno-menu-recolhido';
const isPortrait = () => matchMedia('(max-width: 900px)').matches;
export function setCollapsed(on) {
  document.body.classList.toggle('side-collapsed', on);
  try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* */ }
  const b = document.getElementById('btn-collapse');
  if (b) { b.innerHTML = ic(on ? 'right' : 'left'); b.setAttribute('aria-label', on ? 'Abrir o menu' : 'Recolher o menu'); b.title = on ? 'Abrir o menu' : 'Recolher o menu'; }
}
// ☰ no topo: com o tablet deitado recolhe/abre o menu; em pé abre a gaveta
export function toggleMenu() {
  if (isPortrait()) document.body.classList.toggle('side-open');
  else setCollapsed(!document.body.classList.contains('side-collapsed'));
}
export function initSidebar() {
  setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  document.getElementById('btn-collapse').onclick = () => setCollapsed(!document.body.classList.contains('side-collapsed'));
  // tablet em pé: arrastar da borda esquerda abre a gaveta; arrastar para a esquerda fecha
  let sx = null, sy = 0, fromEdge = false;
  document.addEventListener('pointerdown', e => {
    if (!isPortrait() || e.pointerType === 'mouse' || document.body.classList.contains('editing') || document.querySelector('.modal-back')) { sx = null; return; }
    sx = e.clientX; sy = e.clientY;
    fromEdge = e.clientX < 24 && !document.body.classList.contains('side-open');
  }, { passive: true });
  document.addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = Math.abs(e.clientY - sy);
    if (dy < 60) {
      if (fromEdge && dx > 60) document.body.classList.add('side-open');
      else if (document.body.classList.contains('side-open') && dx < -60) document.body.classList.remove('side-open');
    }
    sx = null;
  }, { passive: true });
}

// Tela "Tudo": cada recurso com uma frase dizendo para que serve
function mapHTML(counts) {
  return SECTIONS.map(s => `<section class="map-sec">
    <h3><span>${s.emoji}</span>${s.title} <small>${s.hint}</small></h3>
    <div class="map-grid">${s.items.map(i => `<button class="map-card" data-go="${i.k}">
      <span class="map-ic">${ic(i.icon)}</span><span class="map-txt"><b>${esc(i.label)}${counts[i.k] ? ` <em>${counts[i.k]}</em>` : ''}</b><small>${esc(i.desc)}</small></span></button>`).join('')}</div>
  </section>`).join('');
}
export function renderMap(el) {
  el.innerHTML = `<div class="map-head panel"><div class="grow"><h3>Tudo em um lugar</h3>
      <p class="muted small">O app tem 3 áreas: <b>Planejar</b> o que fazer, <b>Estudar</b> e <b>Acompanhar</b> sua evolução. O botão <b>+</b> no canto cria qualquer coisa de qualquer tela.</p></div>
      <div class="row wrap"><button class="btn" id="map-tour">${ic('magic')}<span>Ver o tour</span></button><button class="btn" id="map-data">${ic('database')}<span>Dados e backup</span></button><button class="btn" id="map-settings">${ic('settings')}<span>Ajustes e IA</span></button></div></div>
    ${mapHTML(A.counts())}`;
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => A.go(b.dataset.go));
  el.querySelector('#map-tour').onclick = () => tour(true);
  el.querySelector('#map-settings').onclick = () => A.settings();
  el.querySelector('#map-data').onclick = () => A.go('data');
}

// "Mais": a mesma lista, numa folha que sobe de baixo
export function openMore() {
  const body = h(`<div class="more-sheet">${mapHTML(A.counts())}
    <div class="row wrap"><button class="btn" data-x="folders">${ic('folder')}<span>Pastas</span></button>
    <button class="btn" data-x="data">${ic('database')}<span>Dados e backup</span></button>
    <button class="btn" data-x="settings">${ic('settings')}<span>Ajustes e IA</span></button>
    <button class="btn" data-x="tour">${ic('magic')}<span>Tour</span></button></div></div>`);
  let closeFn;
  body.onclick = e => {
    const g = e.target.closest('[data-go]'), x = e.target.closest('[data-x]');
    if (!g && !x) return;
    closeFn && closeFn();
    if (g) A.go(g.dataset.go);
    else if (x.dataset.x === 'settings') A.settings();
    else if (x.dataset.x === 'data') A.go('data');
    else if (x.dataset.x === 'tour') tour(true);
    else document.body.classList.add('side-open');
  };
  modal({ title: 'Todas as partes do app', body, wide: true, sheet: true, actions: [{ label: 'Fechar', value: null }], onOpen: (_el, c) => { closeFn = c; } });
}

// Botão +: cria qualquer coisa
export function quickAdd() {
  const acts = [
    ['note', 'book', 'Anotação', 'Escrever à mão'],
    ['quicknote', 'sticky', 'Nota rápida', 'Ideia ou lista'],
    ['task', 'tasks', 'Tarefa', 'Com prazo e prioridade'],
    ['event', 'calendar', 'Evento', 'Prova, entrega, aniversário'],
    ['record', 'mic', 'Gravar aula', 'Áudio + anotação'],
    ['tutor', 'chat', 'Perguntar ao tutor', 'Tirar dúvida com a IA'],
    ['focus', 'timer', 'Começar foco', 'Pomodoro de 25 min'],
    ['card', 'cards', 'Flashcard', 'Pergunta e resposta'],
    ['quiz', 'quiz', 'Simulado', 'Prova feita pela IA'],
    ['reading', 'bookOpen', 'Leitura', 'Registrar páginas'],
    ['grade', 'award', 'Nota ou prova', 'Lançar ou agendar'],
    ['journal', 'journal', 'Diário', 'Como foi o dia'],
    ['goal', 'target', 'Meta', 'Novo objetivo'],
    ['class', 'clock', 'Aula', 'No horário da semana'],
    ['pdf', 'upload', 'Importar PDF', 'Para escrever por cima'],
    ['search', 'search', 'Buscar', 'Achar qualquer coisa'],
  ];
  const ctx = A.contextNew && A.contextNew(); // ação principal da tela atual
  const body = h(`<div>${ctx ? `<button class="quick-ctx" data-ctx="1"><span class="map-ic">${ic('plus')}</span><span><b>${esc(ctx.label)}</b><small>Nesta tela: ${esc(ctx.where)}</small></span></button>` : ''}
    <div class="quick-grid">${acts.map(([k, i, l, d]) => `<button class="quick" data-q="${k}"><span class="map-ic">${ic(i)}</span><b>${l}</b><small>${d}</small></button>`).join('')}</div></div>`);
  let closeFn;
  body.onclick = e => {
    const c = e.target.closest('[data-ctx]');
    if (c) { closeFn && closeFn(); ctx.run(); return; }
    const b = e.target.closest('[data-q]'); if (!b) return;
    closeFn && closeFn();
    A.quick(b.dataset.q);
  };
  modal({ title: 'Criar', body, wide: true, sheet: true, actions: [{ label: 'Fechar', value: null }], onOpen: (_el, c) => { closeFn = c; } });
}

// Dica do topo da tela
export function addTip(el, kind) {
  const tip = TIPS[kind];
  if (!tip || seenTips()[kind]) return;
  const t = h(`<div class="view-tip">${ic('magic')}<span class="grow">${esc(tip)}</span><button class="chip small" type="button">Entendi</button></div>`);
  t.querySelector('button').onclick = () => {
    const s = seenTips(); s[kind] = 1;
    try { localStorage.setItem(TIPS_KEY, JSON.stringify(s)); } catch { /* */ }
    t.remove();
  };
  el.prepend(t);
}

// Tour de boas-vindas (primeira vez e pela tela Tudo)
const TOUR = [
  ['👋', 'Bem-vindo ao seu Caderno de Estudos', 'Tudo para estudar num app só: caderno à mão, tarefas, foco, flashcards, leitura, notas e IA. Funciona sem internet, e tudo fica salvo no tablet.'],
  ['🗂️', '3 áreas, fácil de achar', '<b>Planejar</b>: Hoje, Tarefas, Agenda, Horário e Metas.<br><b>Estudar</b>: Caderno, Foco, Flashcards, Simulado e Leitura.<br><b>Acompanhar</b>: Hábitos, Diário, Notas e Relatório.'],
  ['➕', 'O botão + cria qualquer coisa', 'Fica no canto de qualquer tela: anotação, tarefa, foco, flashcard, simulado, nota… Com o tablet em pé, a barra de baixo leva às partes principais, e “Mais” mostra todas.'],
  ['✍️', 'No caderno', 'Escreva com a caneta. Circule com o laço para <b>corrigir a escrita</b> ou <b>verificar contas</b>. O botão roxo <b>IA</b> resume, explica, cria perguntas e flashcards.'],
  ['✨', 'Ligue a IA (grátis)', 'Em <b>Ajustes → Inteligência artificial</b>, escolha <b>Gemini</b>, cole a chave criada em aistudio.google.com/apikey e toque em <b>Testar</b>.'],
];
const TOUR_KEY = 'caderno-tour-visto';
export function tour(force) {
  if (!force && localStorage.getItem(TOUR_KEY)) return;
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* */ }
  let i = 0;
  const body = h('<div class="tour"></div>');
  const draw = () => {
    const [e, t, d] = TOUR[i];
    body.innerHTML = `<div class="tour-emoji">${e}</div><h3>${t}</h3><p>${d}</p>
      <div class="tour-dots">${TOUR.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('')}</div>`;
    const acts = body.closest('.modal')?.querySelectorAll('.modal-actions .btn');
    if (acts) { acts[0].textContent = i ? 'Voltar' : 'Pular'; acts[1].textContent = i === TOUR.length - 1 ? 'Começar' : 'Próximo'; }
  };
  modal({
    body, actions: [{ label: 'Pular', value: 'back' }, { label: 'Próximo', value: 'next', primary: true }],
    onOpen: (el, close) => {
      const [back, next] = el.querySelectorAll('.modal-actions .btn');
      back.onclick = () => { if (i === 0) close(); else { i--; draw(); } };
      next.onclick = () => { if (i === TOUR.length - 1) { close(); A.afterTour && A.afterTour(); } else { i++; draw(); } };
      draw();
    },
  });
}
