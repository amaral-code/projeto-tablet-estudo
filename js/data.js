// Dados e backup: o banco de dados do app à vista — contagens, espaço, proteção do armazenamento,
// cópias automáticas diárias, exportar/importar, verificar e reparar, apagar tudo.
import { initDrive, driveHTML, bindDrive } from './drive.js';
import { db, fixRecord, STORE_LABELS, exportPrefs, importPrefs, settings, saveSettings } from './store.js';
import { ic, esc, h, toast, modal, confirmBox } from './ui.js';
import { shareFile, download } from './export.js';

let A;
export const DATA_VIEWS = { data: { title: 'Dados e backup', icon: 'database' } };
const KEEP = 3; // cópias automáticas guardadas
const SNAP_KEY = 'caderno-copias'; // lista leve das cópias (o conteúdo fica no banco)
const dayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// tamanho legível: KB, MB ou GB
const mb = n => {
  const f = (v, u) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ' + u;
  return n < 1048576 ? f(Math.max(1, Math.round(n / 1024)), 'KB') : n < 1073741824 ? f(n / 1048576, 'MB') : f(n / 1073741824, 'GB');
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function initData(api) {
  A = api;
  initDrive(api, { collect, restore: importBackupData, lastWrite: () => db.lastWrite() });
  // cópia automática do dia, alguns segundos depois de abrir (sem atrapalhar o início)
  setTimeout(() => { autoSnapshot().catch(() => {}); }, 6000);
  document.addEventListener('caderno-salvo', () => { const el = document.getElementById('dt-saved'); if (el) el.textContent = 'agora mesmo'; });
}

// ---------- serialização (gravações de áudio viram texto) ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
function dataURLToBlob(u) {
  const [head, b64] = String(u).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function collect({ withAudio = true } = {}) {
  const data = { app: 'caderno-estudos', version: 2, exportedAt: new Date().toISOString(), prefs: exportPrefs() };
  for (const s of db.STORES) {
    let items = await db.all(s);
    if (s === 'recordings') {
      items = withAudio ? await Promise.all(items.map(async r => { const { blob, ...rest } = r; return { ...rest, audio: blob ? await blobToDataURL(blob) : null }; })) : [];
    }
    data[s] = items;
  }
  return data;
}
const countsOf = data => Object.fromEntries(db.STORES.map(s => [s, (data[s] || []).length]));

// Grava os dados no banco. replace: apaga antes (restauração de cópia); senão junta com o que existe.
async function restoreData(data, { replace = false } = {}) {
  if (!data || data.app !== 'caderno-estudos') throw new Error('Arquivo não é um backup do Caderno de Estudos');
  for (const s of db.STORES) {
    let items = Array.isArray(data[s]) ? data[s].filter(it => it && it.id) : null;
    if (s === 'recordings') {
      if (!items || !items.length) continue; // cópias automáticas não levam áudio: mantém as gravações
      items = items.map(({ audio, ...r }) => ({ ...r, blob: audio ? dataURLToBlob(audio) : null }));
    }
    if (replace) await db.clear(s);
    if (items && items.length) await db.bulkPut(s, items);
  }
  importPrefs(data.prefs);
}

// ---------- backup para fora (arquivo) ----------
export async function exportBackup() {
  toast('Gerando backup…', 20000);
  const data = await collect({ withAudio: true });
  const file = new File([JSON.stringify(data)], `backup_caderno_${dayStr()}.json`, { type: 'application/json' });
  const r = await shareFile(file, 'Backup do Caderno de Estudos', '');
  if (r === 'needs-gesture') download(file);
  if (r === 'downloaded' || r === 'needs-gesture') toast(`Backup salvo em Downloads (${mb(file.size)})`);
  else document.getElementById('toast')?.classList.remove('show');
  localStorage.setItem('caderno-ultimo-backup', String(Date.now()));
}

export async function importBackupFile(f) {
  let data;
  try { data = JSON.parse(await f.text()); } catch { toast('Esse arquivo não é um backup válido', 4000); return false; }
  return importBackupData(data);
}
export async function importBackupData(data) {
  if (!data || data.app !== 'caderno-estudos') { toast('Esse arquivo não é um backup do Caderno de Estudos', 4000); return false; }
  const c = countsOf(data);
  const mode = await modal({
    title: 'Restaurar backup',
    body: `<p>O backup tem <b>${c.notes}</b> anotação(ões), <b>${c.tasks}</b> tarefa(s), <b>${c.cards}</b> flashcard(s), <b>${c.quicknotes}</b> nota(s) rápida(s) e <b>${c.recordings}</b> gravação(ões).</p>
      <p class="muted small"><b>Juntar</b> mantém o que já está no tablet e acrescenta o backup (itens iguais são atualizados). <b>Substituir tudo</b> deixa o tablet igual ao backup.</p>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Substituir tudo', value: 'replace', danger: true }, { label: 'Juntar', value: 'merge', primary: true }],
  });
  if (!mode) return false;
  toast('Restaurando…', 30000);
  try {
    if (mode === 'replace') await makeSnapshot('antes de restaurar');
    await restoreData(data, { replace: mode === 'replace' });
    await A.reloadAll();
    toast('Backup restaurado ✓');
    return true;
  } catch (err) { toast('Erro ao restaurar: ' + err.message, 4500); return false; }
}

// ---------- cópias automáticas dentro do banco ----------
const listSnaps = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch { return []; } };
const saveSnaps = l => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(l)); } catch { /* */ } };
export async function makeSnapshot(reason = 'automática') {
  const data = await collect({ withAudio: false });
  const json = JSON.stringify(data);
  const meta = { id: 'snap-' + uid(), date: dayStr(), createdAt: Date.now(), size: json.length, counts: countsOf(data), reason };
  await db.put('snapshots', { id: meta.id, json });
  const list = [meta, ...listSnaps()];
  for (const old of list.slice(KEEP)) await db.del('snapshots', old.id).catch(() => {});
  saveSnaps(list.slice(0, KEEP));
  return meta;
}
async function autoSnapshot() {
  if (!settings.autoBackup) return;
  if (listSnaps().some(s => s.date === dayStr())) return;
  const nNotes = await db.count('notes'), nTasks = await db.count('tasks');
  if (!nNotes && !nTasks) return;
  await makeSnapshot('automática');
}
async function restoreSnapshot(meta) {
  const rec = await db.get('snapshots', meta.id);
  if (!rec) { toast('Essa cópia não existe mais'); saveSnaps(listSnaps().filter(s => s.id !== meta.id)); return; }
  await makeSnapshot('antes de restaurar');
  await restoreData(JSON.parse(rec.json), { replace: true });
  await A.reloadAll();
  toast('Cópia restaurada ✓ (as gravações de áudio foram mantidas)', 4000);
}

// ---------- verificar e reparar ----------
let lastCheck = null; // resultado da última verificação (a tela é redesenhada depois de reparar)
const checkHTML = r => (r.fixes.length ? `<p><b>${r.total} itens conferidos. Corrigido:</b></p><ul>${r.fixes.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
  : `<p class="status good">${ic('check')}${r.total} itens conferidos: está tudo certo</p>`);
export async function checkAndRepair() {
  const fixes = [];
  const all = {};
  // lê como está gravado: registros vazios saem e os incompletos são completados de verdade (gravando no banco)
  for (const s of db.STORES) {
    const raw = await db.allRaw(s);
    all[s] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object' || !r.id) { fixes.push(`${STORE_LABELS[s]}: registro vazio ignorado`); continue; }
      const before = JSON.stringify(r);
      fixRecord(s, r);
      if (JSON.stringify(r) !== before) { await db.put(s, r); fixes.push(`${STORE_LABELS[s]}: campos que faltavam foram completados`); }
      all[s].push(r);
    }
  }
  const fids = new Set(all.folders.map(f => f.id));
  const nids = new Set(all.notes.map(n => n.id));
  const pids = new Set(all.pages.map(p => p.id));
  const put = async (s, it, msg) => { await db.put(s, it); fixes.push(msg); };
  const emptyPage = () => ({ id: uid(), strokes: [], texts: [], images: [] });
  for (const n of all.notes) if (!pids.has(n.id)) await put('pages', { id: n.id, bg: { type: 'lines', color: 'white' }, pages: [emptyPage()] }, `Anotação “${n.title}” estava sem páginas: página em branco criada`);
  for (const p of all.pages) {
    if (!nids.has(p.id)) await put('notes', { id: p.id, title: 'Anotação recuperada', folderId: '', fav: false, createdAt: Date.now(), updatedAt: Date.now(), pageCount: (p.pages || []).length || 1, thumb: '' }, 'Páginas sem anotação foram recuperadas como “Anotação recuperada”');
    let ch = false;
    if (!Array.isArray(p.pages) || !p.pages.length) { p.pages = [emptyPage()]; ch = true; }
    for (const pg of p.pages) for (const k of ['strokes', 'texts', 'images']) if (!Array.isArray(pg[k])) { pg[k] = []; ch = true; }
    if (!p.bg) { p.bg = { type: 'lines', color: 'white' }; ch = true; }
    if (ch) await put('pages', p, 'Páginas com dados incompletos foram corrigidas');
  }
  for (const s of ['notes', 'tasks', 'decks', 'grades', 'classes', 'sessions', 'goals', 'quizzes']) {
    for (const it of all[s]) if (it.folderId && !fids.has(it.folderId)) { it.folderId = ''; await put(s, it, `${STORE_LABELS[s]}: referência a uma pasta apagada foi removida`); }
  }
  for (const t of all.tasks) if (t.noteId && !nids.has(t.noteId)) { t.noteId = ''; await put('tasks', t, 'Tarefa ligada a uma anotação apagada foi desligada'); }
  const dids = new Set(all.decks.map(d => d.id));
  const orphanCards = all.cards.filter(c => !dids.has(c.deckId));
  if (orphanCards.length) {
    const deck = { id: uid(), name: 'Recuperados', folderId: '', createdAt: Date.now() };
    await db.put('decks', deck);
    for (const c of orphanCards) { c.deckId = deck.id; await db.put('cards', c); }
    fixes.push(`${orphanCards.length} flashcard(s) sem baralho foram para “Recuperados”`);
  }
  const bids = new Set(all.books.map(b => b.id));
  for (const r of all.reads) if (!bids.has(r.bookId)) { await db.del('reads', r.id); fixes.push('Registro de leitura de um livro apagado foi removido'); }
  const hids = new Set((all.habits || []).map(x => x.id));
  for (const g of all.goals) if (g.type === 'habit' && !hids.has(g.habitId)) { g.type = 'manual'; await put('goals', g, `Meta “${g.title}” usava um hábito apagado e virou contador`); }
  for (const r of all.recordings) if (r.noteId && !nids.has(r.noteId)) { r.noteId = ''; await put('recordings', r, 'Gravação de uma anotação apagada foi mantida sem anotação'); }
  const total = db.STORES.reduce((a, s) => a + all[s].length, 0);
  lastCheck = { total, fixes: [...new Set(fixes)], at: Date.now() };
  if (fixes.length) await A.reloadAll();
  return lastCheck;
}

// ---------- apagar tudo ----------
async function wipeAll() {
  const ok = await modal({
    title: 'Apagar todos os dados',
    body: `<p>Isso apaga <b>tudo</b> deste tablet: anotações, tarefas, flashcards, gravações… Não dá para desfazer.</p>
      <p>Para confirmar, digite <b>APAGAR</b>:</p><input class="input" id="wipe-txt" autocomplete="off">`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Apagar tudo', danger: true, value: true, validate: el => el.querySelector('#wipe-txt').value.trim().toUpperCase() === 'APAGAR' || (toast('Digite APAGAR para confirmar'), false) }],
  });
  if (!ok) return;
  await makeSnapshot('antes de apagar tudo').catch(() => {});
  for (const s of db.STORES) await db.clear(s);
  for (const k of Object.keys(localStorage)) if (k.startsWith('caderno-') && !['caderno-config', SNAP_KEY, 'caderno-tour-visto'].includes(k)) localStorage.removeItem(k);
  localStorage.setItem('caderno-seeded', '1'); localStorage.setItem('caderno-hub-seeded', '1');
  await A.reloadAll();
  toast('Todos os dados foram apagados. Ainda há uma cópia em “Cópias automáticas”, caso precise voltar.', 5000);
}

// ---------- tela ----------
function ago(ts) {
  if (!ts) return 'ainda não';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('pt-BR');
}
export async function renderData(el) {
  el.innerHTML = '<div class="panel"><p class="muted">Lendo o banco de dados…</p></div>';
  const counts = {};
  for (const s of db.STORES) counts[s] = await db.count(s);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const snaps = listSnaps();
  const lastBk = +localStorage.getItem('caderno-ultimo-backup') || 0;
  const used = est ? est.usage : 0, quota = est ? est.quota : 0;
  el.innerHTML = `<div class="data-wrap">
    <div class="panel data-status">
      <div class="data-ok">${ic('check')}</div>
      <div class="grow"><h3>Tudo é salvo automaticamente no tablet</h3>
        <p class="muted small">Cada traço, tarefa ou mudança vai direto para o banco de dados do app (IndexedDB), mesmo sem internet. Último salvamento: <b id="dt-saved">${ago(db.lastWrite())}</b>.</p></div>
    </div>
    <div class="data-grid">
      <div class="panel"><h3>${ic('shield')}Proteção</h3>
        ${persisted ? `<p class="status good">${ic('check')}Armazenamento protegido</p><p class="muted small">O Android não apaga estes dados para liberar espaço.</p>`
          : `<p class="status bad">! Ainda não protegido</p><p class="muted small">Peça proteção para o Android não apagar os dados quando o tablet ficar sem espaço. Instalar o app na tela inicial ajuda.</p><button class="btn primary" id="dt-persist">${ic('shield')}<span>Proteger meus dados</span></button>`}
        <h4>Espaço usado</h4>
        <div class="goal-bar"><i style="width:${quota ? Math.max(1, Math.min(100, (used / quota) * 100)) : 0}%"></i></div>
        <p class="muted small">${est ? `${mb(used)} usados de ${mb(quota)} disponíveis para o app` : 'Não foi possível medir'}</p>
      </div>
      <div class="panel"><h3>${ic('database')}O que está salvo</h3>
        <div class="db-counts">${db.STORES.filter(s => s !== 'pages').map(s => `<div><b>${counts[s]}</b><span>${esc(STORE_LABELS[s])}</span></div>`).join('')}</div>
      </div>
    </div>
    <div class="panel"><div class="row wrap"><h3 class="grow">${ic('repeat')}Cópias automáticas</h3>
        <label class="check"><input type="checkbox" id="dt-auto" ${settings.autoBackup ? 'checked' : ''}> Uma por dia</label>
        <button class="btn" id="dt-snap">${ic('plus')}<span>Fazer cópia agora</span></button></div>
      <p class="muted small">Guardadas dentro do próprio app (as ${KEEP} mais recentes). Servem para voltar no tempo se algo der errado. Não incluem as gravações de áudio, que continuam salvas.</p>
      <div class="snap-list">${snaps.map(s => `<div class="snap-row"><span class="grow"><b>${new Date(s.createdAt).toLocaleDateString('pt-BR')} ${new Date(s.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
          <span class="muted small"> · ${esc(s.reason)} · ${pl(s.counts.notes, 'anotação', 'anotações')}, ${pl(s.counts.tasks, 'tarefa', 'tarefas')}, ${pl(s.counts.cards, 'flashcard', 'flashcards')} · ${mb(s.size)}</span></span>
          <button class="chip small" data-snap="${s.id}">${ic('undo')}<span>Restaurar</span></button></div>`).join('') || '<p class="muted small">Nenhuma cópia ainda. A primeira é feita sozinha hoje.</p>'}</div>
    </div>
    ${driveHTML()}
    <div class="panel"><h3>${ic('download')}Backup em arquivo</h3>
      <p class="muted small">Para guardar fora do tablet (Google Drive, e-mail…) ou levar para outro tablet. Inclui tudo, até as gravações. A chave da IA não vai junto, por segurança. Último backup: <b>${ago(lastBk)}</b>.</p>
      <div class="row wrap"><button class="btn primary" id="dt-export">${ic('download')}<span>Exportar backup</span></button>
        <button class="btn" id="dt-import">${ic('upload')}<span>Restaurar de um arquivo</span></button></div>
    </div>
    <div class="panel diag"><h3>${ic('alert')}Diagnóstico</h3>
      ${(errs => errs.length ? `<p class="small">O app registrou <b>${errs.length}</b> problema(s) (o mais recente ${ago(errs[0].at)}). Copie o relatório e me mande para eu corrigir.</p>
        <div class="diag-list">${errs.slice(0, 5).map(e => `<div class="diag-item"><b>${esc(e.where || '—')}</b> ${esc(e.msg)}${e.n > 1 ? ` <span class="muted">(${e.n}×)</span>` : ''}</div>`).join('')}</div>
        <div class="row wrap"><button class="btn" id="dg-copy">${ic('copy')}<span>Copiar relatório</span></button><button class="btn" id="dg-clear">${ic('trash')}<span>Limpar</span></button></div>`
        : `<p class="status good">${ic('check')} Nenhum problema registrado</p>`)(A.errorLog ? A.errorLog() : [])}
      <p class="muted small">Versão ${esc(A.version || '')} · ${navigator.onLine ? 'com internet' : 'sem internet'} · ${esc(navigator.userAgent.match(/Android [\d.]+/)?.[0] || '')}</p></div>
    <div class="panel"><h3>${ic('settings')}Manutenção</h3>
      <p class="muted small">Confere se as informações estão ligadas corretamente (por exemplo, tarefas de anotações apagadas) e corrige sozinho.</p>
      <div class="row wrap"><button class="btn" id="dt-check">${ic('check')}<span>Verificar e reparar</span></button>
        <button class="btn danger-outline" id="dt-wipe">${ic('trash')}<span>Apagar todos os dados</span></button></div>
      <div id="dt-check-out" class="muted small">${lastCheck && Date.now() - lastCheck.at < 120000 ? checkHTML(lastCheck) : ''}</div>
    </div>
  </div>`;
  el.querySelector('#dt-persist')?.addEventListener('click', async () => {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    toast(ok ? 'Dados protegidos ✓' : 'O Android ainda não liberou. Instale o app na tela inicial e tente de novo.', 4500);
    renderData(el);
  });
  el.querySelector('#dt-auto').onchange = e => { settings.autoBackup = e.target.checked; saveSettings(); };
  el.querySelector('#dt-snap').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await makeSnapshot('feita por você'); toast('Cópia feita ✓'); } catch (err) { toast('Não foi possível copiar: ' + err.message, 4000); }
    renderData(el);
  };
  el.querySelectorAll('[data-snap]').forEach(b => b.onclick = async () => {
    const meta = snaps.find(s => s.id === b.dataset.snap);
    if (!(await confirmBox('Restaurar cópia', `Voltar os dados para ${new Date(meta.createdAt).toLocaleString('pt-BR')}? O estado atual vira uma nova cópia, então dá para desfazer.`, 'Restaurar', false))) return;
    await restoreSnapshot(meta);
    if (A.currentView() === 'data') renderData(el);
  });
  el.querySelector('#dt-export').onclick = exportBackup;
  el.querySelector('#dt-import').onclick = () => document.getElementById('backup-input').click();
  el.querySelector('#dt-check').onclick = async e => {
    const btn = e.currentTarget; btn.disabled = true;
    el.querySelector('#dt-check-out').textContent = 'Verificando…';
    const r = await checkAndRepair();
    // depois de reparar a tela é redesenhada: escreve no elemento que estiver na tela agora
    const out = document.getElementById('dt-check-out');
    if (out) out.innerHTML = checkHTML(r);
    btn.disabled = false;
  };
  el.querySelector('#dt-wipe').onclick = wipeAll;
  bindDrive(el, () => { if (A.currentView() === 'data') renderData(el); });
  el.querySelector('#dg-copy')?.addEventListener('click', async () => {
    const txt = `Caderno de Estudos ${A.version}\n${navigator.userAgent}\n\n` + A.errorLog().map(e => `${new Date(e.at).toLocaleString('pt-BR')} [${e.where}] ${e.msg}${e.n > 1 ? ` (${e.n}x)` : ''}\n   ${e.stack}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Relatório copiado ✓ Cole na conversa comigo'); } catch { toast('Não consegui copiar'); }
  });
  el.querySelector('#dg-clear')?.addEventListener('click', () => { A.clearErrorLog(); toast('Registro de problemas limpo'); renderData(el); });
}
