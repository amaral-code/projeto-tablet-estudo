// Adição rápida: um campo só (no Hoje e no botão +) para escrever do seu jeito.
// O app mostra o que entendeu (tarefa ou evento, dia, hora, matéria, prioridade) antes de salvar.
import { parseQuick, describeQuick } from './quickparse.js';
import { ic, esc, toast } from './ui.js';
import * as EVM from './events.js';

let A;
export function initQuickAdd(api) { A = api; }

const KIND_LABEL = { prova: '📝 Prova', trabalho: '📚 Trabalho', aula: '🏫 Aula/Reunião', consulta: '🩺 Consulta', aniversario: '🎂 Aniversário', outro: '📌 Evento' };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const parse = text => parseQuick(text, { folders: (A && A.state.folders) || [] });

// o que está sendo digitado sobrevive se a tela se redesenhar no meio
const drafts = {};
export function quickBarHTML(extra = '') {
  return `<form class="qa-bar ${extra}" data-key="${esc(extra)}" autocomplete="off" novalidate>
    <div class="qa-row"><span class="qa-ic">${ic('magic')}</span>
      <input class="qa-in" ${extra === 'qa-sheet' ? 'data-nofocus' : ''} enterkeyhint="done" autocapitalize="sentences" placeholder="Adicionar rápido: “prova de física sexta 8h”, “lista de mat amanhã !”" aria-label="Adicionar rápido (tarefa ou evento)">
      <button class="btn primary qa-go" type="submit">${ic('plus')}<span>Adicionar</span></button></div>
    <div class="qa-prev" aria-live="polite"></div></form>`;
}

export function bindQuickBar(root, { onDone } = {}) {
  const form = root.querySelector('.qa-bar');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  const inp = form.querySelector('.qa-in'), prev = form.querySelector('.qa-prev');
  let forced = null; // tipo trocado à mão (tarefa ⇄ evento)
  let busy = false;
  const cur = () => {
    const q = parse(inp.value);
    if (forced) { q.kind = forced; if (forced === 'event' && !q.evKind) q.evKind = 'outro'; }
    return q;
  };
  const show = () => {
    const v = inp.value.trim();
    form.classList.toggle('has', !!v);
    if (!v) { prev.innerHTML = ''; forced = null; return; }
    const q = cur();
    const parts = describeQuick(q, { folderName: id => A.folderName(id) });
    prev.innerHTML = `<button type="button" class="qa-kind ${q.kind}" title="Trocar entre tarefa e evento">${q.kind === 'event' ? KIND_LABEL[q.evKind] || KIND_LABEL.outro : '✅ Tarefa'}<span class="qa-swap">⇄</span></button>
      <b class="qa-title">${esc(q.title)}</b>${parts.map(p => `<span class="qa-part">${esc(p)}</span>`).join('')}
      ${q.kind === 'event' && !q.date ? '<span class="qa-part warn">você escolhe o dia ao salvar</span>' : ''}`;
    prev.querySelector('.qa-kind').onclick = () => { forced = q.kind === 'event' ? 'task' : 'event'; show(); drafts[key] && (drafts[key].forced = forced); };
  };
  const key = form.dataset.key || '';
  const d = drafts[key];
  if (d && d.text) { inp.value = d.text; forced = d.forced; if (d.focus && Date.now() - d.at < 4000) { inp.focus(); try { inp.setSelectionRange(d.text.length, d.text.length); } catch { /* */ } } }
  const keep = () => { drafts[key] = { text: inp.value, forced, focus: document.activeElement === inp, at: Date.now() }; };
  inp.addEventListener('input', () => { show(); keep(); });
  inp.addEventListener('focus', keep);
  form.onsubmit = async e => {
    e.preventDefault();
    if (busy) return;
    if (!inp.value.trim()) { inp.focus(); return; }
    busy = true;
    const q = cur(), kept = drafts[key];
    delete drafts[key]; // (a tela se redesenha no meio do salvamento: o texto já salvo não pode voltar)
    try {
      const ok = await saveQuick(q);
      if (ok) { inp.value = ''; forced = null; show(); onDone && onDone(); }
      else if (kept) drafts[key] = kept;
    } catch (err) { if (kept) drafts[key] = kept; throw err; } finally { busy = false; }
  };
  show();
}

// Salva o que foi entendido (com "Desfazer")
export async function saveQuick(q) {
  const parts = describeQuick(q, { folderName: id => A.folderName(id) }).filter(p => !/prioridade/.test(p));
  const when = parts.length ? ` — ${parts.join(' · ')}` : '';
  if (q.kind === 'event') {
    const data = { title: q.title, kind: q.evKind || 'outro', time: q.time || '', prio: q.prio || 2, folderId: q.folderId || '' };
    if (!q.date) return !!(await EVM.eventDialog(null, { date: todayStr(), ...data }));
    const ev = await EVM.addEvent({ ...data, date: q.date });
    toast(`📅 Evento salvo: ${q.title}${when}`, 5000, { label: 'Desfazer', run: () => EVM.deleteEvent(ev.id) });
    return true;
  }
  const t = await A.addTask({ title: q.title, due: q.date || '', prio: q.prio || 2, folderId: q.folderId || '' });
  A.onChange();
  toast(`✅ Tarefa: ${q.title}${when}`, 5000, {
    label: 'Desfazer',
    run: async () => { await A.db.del('tasks', t.id); A.state.tasks = A.state.tasks.filter(x => x.id !== t.id); A.onChange(); toast('Tarefa desfeita'); },
  });
  return true;
}
