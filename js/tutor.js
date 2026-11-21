// Tutor IA: conversa com o Gemini, com foto do exercício (câmera) e voz. As conversas ficam salvas.
import { ic, esc, h, toast, confirmBox, keepDraft } from './ui.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';
import { speak, attachDictation, stopSpeak } from './voice.js';

let A;
let chats = [];
let cur = null;      // conversa aberta
let pending = null;  // foto anexada ainda não enviada (dataURL)
let busy = null;
export const TUTOR_VIEWS = { tutor: { title: 'Tutor IA', icon: 'chat' } };

const SYSTEM = `Você é um tutor particular paciente e animado, dentro do app "Caderno de Estudos", conversando com um estudante brasileiro num tablet.
- Responda em português do Brasil (a não ser que o estudante peça outro idioma).
- Explique passo a passo, com exemplos simples, no nível do estudante. Prefira respostas curtas e claras; aprofunde se ele pedir.
- Se receber a foto de um exercício, leia com atenção, resolva passo a passo e explique o porquê de cada passo. Se a foto estiver ilegível, diga o que não deu para ler.
- Se o estudante pedir só a resposta de uma lição, ajude-o a entender o caminho em vez de só dar o resultado.
- Use texto simples: títulos curtos começando com "# ", listas com "- " ou "1. ". Não use tabelas nem negrito. Contas numa linha (ex.: 2x + 3 = 11 → 2x = 8 → x = 4).`;

const STARTERS = [
  ['📸', 'Resolva este exercício passo a passo', 'Resolva este exercício passo a passo e explique cada passo.', true],
  ['💡', 'Explique de um jeito simples', 'Explique de um jeito bem simples, com um exemplo do dia a dia: '],
  ['❓', 'Me faça perguntas', 'Me faça 5 perguntas, uma de cada vez, para eu treinar sobre: '],
  ['✍️', 'Corrija meu texto', 'Corrija meu texto e explique os erros: '],
  ['🌎', 'Traduza e explique', 'Traduza para o inglês e explique as palavras mais importantes: '],
  ['🗺️', 'Monte um resumo', 'Monte um resumo de estudo, com tópicos e o que mais cai em prova, sobre: '],
];

export async function initTutor(api) { A = api; chats = await A.db.all('chats'); }
export async function reloadTutor() { chats = await A.db.all('chats'); if (cur && !chats.some(c => c.id === cur.id)) cur = null; }
export const chatsData = () => chats;

async function saveChat(c) {
  c.updatedAt = Date.now();
  await A.db.put('chats', c);
  const i = chats.findIndex(x => x.id === c.id);
  if (i >= 0) chats[i] = c; else chats.push(c);
}

// foto → JPEG menor (a IA lê bem e o banco não enche)
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      im.onerror = rej; im.src = r.result;
    };
    r.onerror = rej; r.readAsDataURL(file);
  });
}

function rich(text) {
  return esc(cleanText(text)).split('\n').map(l => { const m = l.match(/^\s*#{1,6}\s+(.*)$/); return m ? `<span class="ai-h">${m[1]}</span>` : l; }).join('\n');
}

function messageHTML(m, i) {
  if (m.role === 'user') return `<div class="tt-msg user">${m.image ? `<img src="${m.image}" alt="Foto enviada">` : ''}${m.text ? `<div>${esc(m.text)}</div>` : ''}</div>`;
  if (m.role === 'error') return `<div class="tt-msg error">${esc(m.text)}</div>`;
  return `<div class="tt-msg bot ${m.streaming ? 'streaming' : ''}" data-i="${i}"><div class="tt-text">${rich(m.text || '')}</div>
    ${m.streaming ? '<div class="ai-typing"><i></i><i></i><i></i></div>' : `<div class="tt-acts">
      <button class="chip small" data-a="say">${ic('speaker')}<span>Ouvir</span></button>
      <button class="chip small" data-a="copy">${ic('copy')}<span>Copiar</span></button>
      <button class="chip small" data-a="note">${ic('book')}<span>Salvar como anotação</span></button>
      <button class="chip small" data-a="quick">${ic('sticky')}<span>Nota rápida</span></button></div>`}</div>`;
}

export function renderTutor(el) {
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  el.innerHTML = `<div class="tutor-wrap">
    <aside class="panel tt-list">
      <button class="btn primary full" id="tt-new">${ic('plus')}<span>Nova conversa</span></button>
      <div class="tt-items">${sorted.map(c => `<div class="tt-item ${cur && cur.id === c.id ? 'active' : ''}" data-open="${c.id}" role="button" tabindex="0">
        <span class="grow"><b>${esc(c.title)}</b><small>${new Date(c.updatedAt).toLocaleDateString('pt-BR')} · ${c.messages.length} mensagens</small></span>
        <button class="icon-btn small" data-del="${c.id}" aria-label="Apagar conversa">${ic('trash')}</button></div>`).join('') || '<p class="muted small">Suas conversas aparecem aqui.</p>'}</div>
    </aside>
    <section class="panel tt-chat">
      <div class="tt-msgs" id="tt-msgs">${cur && cur.messages.length ? cur.messages.map(messageHTML).join('') : `<div class="tt-empty">
        <div class="tt-hello">${ic('chat')}</div><h3>Oi! Sou seu tutor.</h3>
        <p class="muted">Pergunte qualquer coisa ou mande a <b>foto de um exercício</b> que eu explico passo a passo.</p>
        <div class="tt-starters">${STARTERS.map(([e, l], i) => `<button class="chip" data-st="${i}">${e} ${esc(l)}</button>`).join('')}</div></div>`}</div>
      <div class="tt-attach" id="tt-attach" ${pending ? '' : 'hidden'}>${pending ? `<img src="${pending}" alt=""><span>Foto pronta para enviar</span><button class="icon-btn small" id="tt-unattach" aria-label="Tirar foto">${ic('close')}</button>` : ''}</div>
      <form class="tt-compose" id="tt-form" autocomplete="off">
        <button class="icon-btn" type="button" id="tt-photo" title="Foto do exercício" aria-label="Foto do exercício">${ic('camera')}</button>
        <button class="icon-btn" type="button" id="tt-mic" aria-label="Ditar">${ic('mic')}</button>
        <textarea id="tt-q" rows="1" placeholder="${aiConfigured() ? 'Escreva sua dúvida…' : 'Ligue a IA em Ajustes para conversar'}"></textarea>
        <button class="btn primary" type="submit" id="tt-send" aria-label="Enviar">${ic(busy ? 'stop' : 'send')}</button>
      </form>
      <input type="file" id="tt-file" accept="image/*" capture="environment" hidden>
    </section></div>`;
  const msgs = el.querySelector('#tt-msgs');
  msgs.scrollTop = msgs.scrollHeight;
  const q = el.querySelector('#tt-q');
  q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight) + 'px'; });
  const clearDraft = keepDraft(q, 'tutor');
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('#tt-form').requestSubmit(); } });
  attachDictation(el.querySelector('#tt-mic'), q);
  el.querySelector('#tt-new').onclick = () => { stopSpeak(); cur = null; pending = null; renderTutor(el); el.querySelector('#tt-q').focus(); };
  el.querySelector('#tt-photo').onclick = () => el.querySelector('#tt-file').click();
  el.querySelector('#tt-file').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { pending = await shrinkImage(f); } catch { toast('Não consegui abrir a foto'); return; }
    const keep = q.value; renderTutor(el); const q2 = el.querySelector('#tt-q');
    q2.value = keep || 'Resolva este exercício passo a passo e explique cada passo.'; q2.focus();
  };
  el.querySelector('#tt-unattach')?.addEventListener('click', () => { pending = null; renderTutor(el); });
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const [, , text, photo] = STARTERS[+b.dataset.st];
    q.value = text; q.focus(); q.setSelectionRange(text.length, text.length);
    if (photo && !pending) el.querySelector('#tt-file').click();
  });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = e => { if (e.target.closest('[data-del]')) return; stopSpeak(); cur = chats.find(c => c.id === b.dataset.open); pending = null; renderTutor(el); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!(await confirmBox('Apagar conversa', 'Apagar esta conversa?', 'Apagar'))) return;
    await A.db.del('chats', b.dataset.del);
    chats = chats.filter(c => c.id !== b.dataset.del);
    if (cur && cur.id === b.dataset.del) cur = null;
    renderTutor(el);
  });
  msgs.querySelectorAll('.tt-msg.bot [data-a]').forEach(b => b.onclick = async () => {
    const m = cur.messages[+b.closest('.tt-msg').dataset.i];
    const text = cleanText(m.text);
    if (b.dataset.a === 'say') speak(text, { button: b });
    else if (b.dataset.a === 'copy') { try { await navigator.clipboard.writeText(text); toast('Copiado'); } catch { toast('Não foi possível copiar'); } }
    else if (b.dataset.a === 'note') { await A.createNoteFromText(`Tutor — ${cur.title}`, '', text); }
    else if (b.dataset.a === 'quick') { await A.addQuick(text.slice(0, 4000)); toast('Salvo em Notas rápidas ✓'); }
  });
  el.querySelector('#tt-form').onsubmit = e => {
    e.preventDefault();
    if (busy) { busy.abort(); return; }
    if (q.value.trim() || pending) clearDraft();
    send(el, q.value.trim());
  };
}

async function send(el, text) {
  if (!text && !pending) return;
  if (!aiConfigured()) { toast('Ligue a IA: cole a chave do Gemini em Ajustes → Inteligência artificial', 4000); return; }
  if (!cur) cur = { id: A.uid(), title: (text || 'Foto de exercício').slice(0, 48), createdAt: Date.now(), messages: [] };
  const userMsg = { role: 'user', text, image: pending || null, at: Date.now() };
  cur.messages.push(userMsg);
  pending = null;
  const bot = { role: 'assistant', text: '', streaming: true, at: Date.now() };
  cur.messages.push(bot);
  renderTutor(el);
  // histórico para a IA: últimas mensagens; fotos só das 3 mais recentes (pedido menor e mais rápido)
  const hist = cur.messages.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.streaming)).slice(-20);
  const withImg = new Set(hist.filter(m => m.image).slice(-3));
  const messages = hist.map(m => (m.role === 'assistant' ? { role: 'assistant', content: m.text } : {
    role: 'user',
    content: [
      ...(m.image && withImg.has(m) ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image.split(',')[1] } }] : []),
      { type: 'text', text: m.text || 'Veja a foto.' },
    ],
  }));
  let raf = 0;
  const paint = () => {
    raf = 0;
    const node = document.querySelector('.tt-msg.bot.streaming .tt-text');
    if (node) { node.innerHTML = rich(bot.text); const box = document.getElementById('tt-msgs'); if (box) box.scrollTop = box.scrollHeight; }
  };
  try {
    busy = streamChat(messages, t => { bot.text += t; if (!raf) raf = requestAnimationFrame(paint); }, { system: SYSTEM });
    const btn = document.getElementById('tt-send'); if (btn) btn.innerHTML = ic('stop');
    const r = await busy.done;
    bot.text = r.text;
    bot.streaming = false;
  } catch (e) {
    cur.messages.pop();
    if (e.aborted) { if (bot.text) cur.messages.push({ ...bot, streaming: false, text: bot.text + '\n\n(interrompido)' }); }
    else cur.messages.push({ role: 'error', text: e.message });
  } finally { busy = null; }
  // as mensagens de erro não são salvas no banco
  await saveChat({ ...cur, messages: cur.messages.filter(m => m.role !== 'error') });
  if (A.currentView() === 'tutor') renderTutor(document.getElementById('view-hub'));
}
export function leaveTutor() { stopSpeak(); }
export function openChat(id) { cur = chats.find(c => c.id === id) || null; pending = null; A.go('tutor'); }
