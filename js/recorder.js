// Gravador de aula: grava o áudio ligado a uma anotação, salva no banco aos poucos e
// o Gemini resume ou transcreve a gravação.
import { ic, esc, h, toast, modal, confirmBox, promptText, richText } from './ui.js';
import { aiConfigured, streamChat, cleanText } from './ai.js';
import { speak } from './voice.js';

let A;
let recs = [];
let rec = null;    // gravação em andamento
let pill = null;
const MAX_AI_BYTES = 14 * 1024 * 1024; // limite para mandar à IA de uma vez (~1 h de aula)
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : (n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB');

export async function initRecorder(api) {
  A = api;
  recs = await A.db.all('recordings');
  // gravações que ficaram pela metade (app fechado durante a gravação) já estão salvas: só tira a marca
  for (const r of recs.filter(r => r.partial)) { r.partial = false; r.title = r.title + ' (interrompida)'; await A.db.put('recordings', r); }
  pill = h(`<button id="rec-pill" hidden aria-label="Parar gravação"></button>`);
  pill.onclick = () => stopRecording();
  // o app saiu da tela durante a gravação: salva na hora o que já foi gravado
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !rec || rec.mr.state !== 'recording') return;
    rec.saveNow = true;
    try { rec.mr.requestData(); } catch { /* */ }
  });
  document.body.appendChild(pill);
  setInterval(tick, 500);
}
export async function reloadRecorder() { recs = await A.db.all('recordings'); }
export const recordingsOf = noteId => recs.filter(r => r.noteId === noteId && !(rec && r.id === rec.id)).sort((a, b) => b.createdAt - a.createdAt);
export const recCounts = () => { const m = {}; for (const r of recs) if (r.noteId) m[r.noteId] = (m[r.noteId] || 0) + 1; return m; };
export const isRecording = () => !!rec;
export const recordingInfo = () => (rec ? { id: rec.id, noteId: rec.noteId, startAt: rec.startAt } : null);
export const hasRecording = id => recs.some(r => r.id === id) || !!(rec && rec.id === id);
export const recordingNote = () => (rec ? rec.noteId : null);

function tick() {
  if (!pill) return;
  pill.hidden = !rec;
  if (rec) pill.innerHTML = `<span class="rec-dot"></span><span>${fmt((Date.now() - rec.startAt) / 1000)}</span><span class="rec-stop">${ic('stop')} Parar</span>`;
  const b = document.getElementById('ed-rec');
  if (b) { b.classList.toggle('recording', !!rec); b.title = rec ? 'Parar gravação' : 'Gravar a aula'; }
}

let wake = null;
export async function startRecording({ noteId, title }) {
  if (rec) { toast('Já existe uma gravação em andamento'); return false; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Este navegador não consegue gravar áudio'); return false; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { toast('Permita o uso do microfone para gravar a aula', 4000); return false; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
  const r = { id: A.uid(), noteId, title: title || 'Gravação', createdAt: Date.now(), mime: (mr.mimeType || mime || 'audio/webm').split(';')[0], chunks: [], startAt: Date.now(), mr, stream, lastSave: 0 };
  rec = r;
  mr.ondataavailable = async e => {
    if (!e.data || !e.data.size) return;
    r.chunks.push(e.data);
    // salva o que já foi gravado a cada ~15 s (se o app fechar, a aula não se perde)
    if ((Date.now() - r.lastSave > 15000 || r.saveNow) && rec === r) { r.saveNow = false; r.lastSave = Date.now(); await persist(r, true).catch(() => {}); }
  };
  // o microfone foi cortado (ligação, outro app usando): para e salva o que já foi gravado
  stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (rec === r) { toast('O microfone foi interrompido: gravação salva até aqui', 4000); stopRecording(); } }));
  const stopped = new Promise(res => { mr.onstop = res; });
  r.stopped = stopped;
  mr.start(5000);
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* */ }
  toast('🎙️ Gravando a aula. Toque no botão vermelho para parar.', 3500);
  tick();
  return true;
}
async function persist(r, partial) {
  const blob = new Blob(r.chunks, { type: r.mime });
  const item = { id: r.id, noteId: r.noteId, title: r.title, createdAt: r.createdAt, duration: Math.round((Date.now() - r.startAt) / 1000), mime: r.mime, size: blob.size, blob, partial };
  await A.db.put('recordings', item);
  const i = recs.findIndex(x => x.id === item.id);
  if (i >= 0) recs[i] = item; else recs.push(item);
  return item;
}
export async function stopRecording() {
  if (!rec) return null;
  const r = rec;
  rec = null;
  try { r.mr.stop(); } catch { /* */ }
  await r.stopped;
  r.stream.getTracks().forEach(t => t.stop());
  try { wake && wake.release(); } catch { /* */ } wake = null;
  tick();
  if (!r.chunks.length) { toast('Nada foi gravado'); return null; }
  const item = await persist(r, false);
  toast(`Gravação salva ✓ (${fmt(item.duration)}, ${mb(item.size)})`, 3500);
  A.onChange(true);
  return item;
}
export async function toggleRecording(meta) {
  if (rec) return stopRecording();
  return startRecording({ noteId: meta.id, title: `Aula — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` });
}

const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });

const PROMPTS = {
  summary: { label: 'Resumo da aula', prompt: 'Esta é a gravação de uma aula. Faça um resumo de estudo em português do Brasil: comece com um título, depois os principais assuntos em tópicos, os conceitos e exemplos que o professor deu, o que ele avisou que cai na prova ou pediu de tarefa, e termine com "# Para lembrar" com 3 a 5 frases.' },
  transcript: { label: 'Transcrição', prompt: 'Transcreva a fala desta gravação em português do Brasil, em parágrafos, com pontuação correta. Não invente o que não der para ouvir: marque com [inaudível]. Se houver mais de uma pessoa falando, indique a troca com "—".' },
  tasks: { label: 'Tarefas e datas', prompt: 'Ouça esta gravação de aula e liste só o que for tarefa, trabalho, prova, data ou material que o professor pediu, cada um numa linha começando com "- ". Se não houver nada, diga que não encontrou tarefas.' },
};

// Resumo/transcrição pelo Gemini
async function aiOnRecording(r, kind) {
  if (!aiConfigured()) { toast('Ligue a IA em Ajustes → Inteligência artificial', 4000); return; }
  if (!r.blob) { toast('Esta gravação não tem áudio salvo'); return; }
  if (r.size > MAX_AI_BYTES) { toast('Gravação longa demais para a IA de uma vez (máx. ~1 hora).', 4500); return; }
  const P = PROMPTS[kind];
  const body = h(`<div><div class="ai-out" id="rc-out">Ouvindo a gravação… isso leva alguns segundos.</div><div class="row wrap" id="rc-acts" style="margin-top:10px"></div></div>`);
  let stream = null, text = '';
  const closeP = modal({ title: `${P.label} — ${r.title}`, body, wide: true, actions: [{ label: 'Fechar', value: true }] });
  const out = body.querySelector('#rc-out');
  try {
    const data = await blobToB64(r.blob);
    stream = streamChat([{ role: 'user', content: [{ type: 'audio', source: { media_type: r.mime || 'audio/webm', data } }, { type: 'text', text: P.prompt }] }],
      t => { text += t; out.innerHTML = richText(cleanText(text)); out.scrollTop = out.scrollHeight; }, { maxTokens: kind === 'transcript' ? 16384 : 8192 });
    const res = await stream.done;
    text = res.text;
    out.innerHTML = richText(cleanText(text) + (res.truncated ? '\n\n(A resposta foi cortada por ser muito longa.)' : ''));
    r[kind] = text;
    await A.db.put('recordings', r);
    const acts = body.querySelector('#rc-acts');
    const add = (icon, label, fn) => { const b = h(`<button class="btn">${ic(icon)}<span>${label}</span></button>`); b.onclick = fn; acts.appendChild(b); return b; };
    add('book', 'Escrever na anotação', async () => { await A.writeToNote(r.noteId, cleanText(text), `${P.label} — ${r.title}`); body.closest('.modal-back')?._close?.(true); });
    if (kind === 'tasks') add('tasks', 'Criar estas tarefas', async () => {
      // só os itens da lista ("- ...", "• ...", "1. ..."): títulos e frases soltas não viram tarefa
      const LI = /^\s*(?:[-•*]|\d+[.)])\s+/;
      const items = cleanText(text).split('\n').filter(l => LI.test(l)).map(l => l.replace(LI, '').trim()).filter(l => l && !/não encontrei/i.test(l)).slice(0, 15);
      if (!items.length) { toast('Nenhuma tarefa encontrada nesta gravação'); return; }
      for (const t of items) await A.addTask({ title: t.slice(0, 160), notes: 'Da gravação da aula' });
      toast(`${items.length} tarefa(s) criada(s) ✓`); A.onChange(true);
    });
    const sb = add('speaker', 'Ouvir', () => speak(cleanText(text), { button: sb }));
    add('copy', 'Copiar', async () => { try { await navigator.clipboard.writeText(cleanText(text)); toast('Copiado'); } catch { toast('Não foi possível copiar'); } });
  } catch (e) {
    if (!e.aborted) { out.textContent = e.message; out.classList.add('error'); }
  }
  await closeP;
  if (stream) stream.abort();
}

// Lista de gravações de uma anotação
export async function openRecordings(meta) {
  const urls = [];
  const body = h('<div class="rc-list"></div>');
  const draw = () => {
    urls.forEach(u => URL.revokeObjectURL(u)); urls.length = 0;
    const list = recordingsOf(meta.id);
    body.innerHTML = `${rec && rec.noteId === meta.id ? `<div class="rc-live"><span class="rec-dot"></span>Gravando agora… toque no botão vermelho para parar</div>` : ''}
      ${list.map(r => {
        const u = r.blob ? URL.createObjectURL(r.blob) : ''; if (u) urls.push(u);
        return `<div class="rc-item" data-id="${r.id}">
          <div class="row"><b class="grow">${esc(r.title)}</b><span class="muted small">${fmt(r.duration || 0)} · ${mb(r.size || 0)}</span></div>
          ${u ? `<audio controls preload="metadata" src="${u}"></audio>` : '<p class="muted small">Sem áudio</p>'}
          <div class="row wrap">
            <button class="chip small on" data-ai="summary">${ic('magic')}<span>Resumo com IA</span></button>
            <button class="chip small" data-ai="transcript">${ic('journal')}<span>Transcrever</span></button>
            <button class="chip small" data-ai="tasks">${ic('tasks')}<span>Tarefas e datas</span></button>
            <button class="chip small" data-ren="1">${ic('edit')}<span>Renomear</span></button>
            <button class="chip small" data-del="1">${ic('trash')}<span>Apagar</span></button>
          </div></div>`;
      }).join('') || '<p class="muted">Nenhuma gravação nesta anotação ainda. Toque no 🎙️ do topo para gravar a aula enquanto escreve.</p>'}`;
  };
  draw();
  body.onclick = async e => {
    const item = e.target.closest('.rc-item'); if (!item) return;
    const r = recs.find(x => x.id === item.dataset.id);
    const ai = e.target.closest('[data-ai]');
    if (ai) return aiOnRecording(r, ai.dataset.ai);
    if (e.target.closest('[data-ren]')) {
      const t = await promptText('Renomear gravação', r.title);
      if (t) { r.title = t; await A.db.put('recordings', r); draw(); }
    } else if (e.target.closest('[data-del]')) {
      if (!(await confirmBox('Apagar gravação', `Apagar “${r.title}”? Não dá para desfazer.`, 'Apagar'))) return;
      await A.db.del('recordings', r.id); recs = recs.filter(x => x.id !== r.id); draw(); A.onChange(true);
    }
  };
  await modal({ title: `🎙️ Gravações — ${meta.title}`, body, wide: true, actions: [{ label: 'Fechar', value: true, primary: true }] });
  urls.forEach(u => URL.revokeObjectURL(u));
}

// Ouvir a aula a partir do momento em que um traço foi escrito (gravação ligada à escrita)
let player = null;
export async function playAt(recId, t) {
  const r = recs.find(x => x.id === recId) || await A.db.get('recordings', recId);
  if (!r || !r.blob) { toast(rec && rec.id === recId ? 'A gravação ainda está acontecendo: pare para ouvir' : 'Essa gravação não existe mais'); return null; }
  if (player) player.close();
  const url = URL.createObjectURL(r.blob);
  const bar = h(`<div class="rec-player" role="region" aria-label="Ouvindo a aula"><span class="rp-t">🎧 ${esc(r.title)}</span>
    <audio controls preload="auto" src="${url}"></audio><button class="icon-btn small" aria-label="Fechar">${ic('close')}</button></div>`);
  const au = bar.querySelector('audio');
  const close = () => { try { au.pause(); } catch { /* */ } bar.remove(); URL.revokeObjectURL(url); if (player && player.bar === bar) player = null; };
  bar.querySelector('button').onclick = close;
  document.body.appendChild(bar);
  const start = Math.max(0, t - 3); // começa 3 s antes, para pegar o começo da frase
  const go = () => { try { au.currentTime = start; } catch { /* */ } au.play().catch(() => {}); };
  if (au.readyState >= 1) go(); else au.addEventListener('loadedmetadata', go, { once: true });
  player = { bar, au, close, start };
  return player;
}
