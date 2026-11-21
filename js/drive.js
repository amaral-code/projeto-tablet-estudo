// Backup no Google Drive (na SUA conta). O app guarda um arquivo "Caderno de Estudos — backup.json" no seu Drive
// e o atualiza: com 1 toque por dia, e sozinho quando você sai do app (enquanto a autorização do Google vale, ~1 h).
// Precisa de um "ID do cliente" do Google (criado uma vez, de graça, no console do Google Cloud — o app explica).
// Sem ele, o botão "Exportar backup" já manda o arquivo para o Drive pelo compartilhar do Android.
import { ic, esc, h, toast, modal } from './ui.js';

const KEY = 'caderno-drive'; // { clientId, fileId, last, auto }
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const NAME = 'Caderno de Estudos — backup.json';
let A, collectFn, restoreFn, lastWriteFn;
let token = null, tokenExp = 0, busy = false;

const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const put = v => { try { localStorage.setItem(KEY, JSON.stringify({ ...get(), ...v })); } catch { /* */ } };
export const driveConfigured = () => !!get().clientId;
export const driveInfo = () => get();
const hasToken = () => token && Date.now() < tokenExp - 60000;

export function initDrive(api, { collect, restore, lastWrite }) {
  A = api; collectFn = collect; restoreFn = restore; lastWriteFn = lastWrite;
  // já deixa o código do Google carregado, para a janela de autorização abrir na hora do toque
  if (get().clientId && navigator.onLine) setTimeout(() => loadGIS().catch(() => {}), 4000);
  // saiu do app com mudanças e a autorização ainda vale: atualiza o backup no Drive sozinho
  document.addEventListener('visibilitychange', () => {
    const c = get();
    if (document.hidden && c.clientId && c.auto !== false && hasToken() && lastWriteFn() > (c.last || 0) + 5000) backupNow({ silent: true }).catch(() => {});
  });
}

function loadGIS() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Não consegui falar com o Google. Confira a internet.'));
    document.head.appendChild(s);
  });
}
// Pede a autorização do Google (abre a janelinha do Google na primeira vez; depois é automático)
async function getToken() {
  if (hasToken()) return token;
  const { clientId } = get();
  if (!clientId) throw new Error('Configure o Google Drive primeiro');
  await loadGIS();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: r => {
        if (r && r.access_token) { token = r.access_token; tokenExp = Date.now() + (+r.expires_in || 3600) * 1000; res(token); }
        else rej(new Error(r && r.error === 'access_denied' ? 'Você não permitiu o acesso ao Drive' : 'O Google não autorizou. Confira o ID do cliente.'));
      },
      error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'A janela do Google foi fechada' : 'Não consegui abrir a janela do Google (verifique se o navegador bloqueou)')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
async function api(url, opts = {}) {
  const t = await getToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  if (r.status === 401) { token = null; throw new Error('A autorização do Google venceu. Toque de novo.'); }
  return r;
}

// Envia o backup (upload "resumível": funciona com arquivos grandes, como gravações de aula)
export async function backupNow({ silent = false } = {}) {
  if (busy) return false;
  busy = true;
  try {
    // autoriza primeiro, ainda "dentro" do toque (o navegador só abre a janela do Google logo após um toque)
    await getToken();
    if (!silent) toast('Enviando o backup para o seu Google Drive…', 30000);
    const data = await collectFn({ withAudio: true });
    const body = JSON.stringify(data);
    const meta = { name: NAME, mimeType: 'application/json' };
    let { fileId } = get();
    const start = async id => api(id ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=resumable` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' }, body: JSON.stringify(id ? {} : meta),
    });
    let r = await start(fileId);
    if (fileId && r.status === 404) { fileId = null; r = await start(null); } // o arquivo foi apagado no Drive: cria outro
    if (!r.ok) throw new Error(`O Drive recusou o envio (código ${r.status})`);
    const loc = r.headers.get('Location');
    if (!loc) throw new Error('O Drive não devolveu o endereço de envio');
    const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (!up.ok) throw new Error(`O envio para o Drive falhou (código ${up.status})`);
    const j = await up.json().catch(() => ({}));
    put({ fileId: j.id || fileId, last: Date.now() });
    try { localStorage.setItem('caderno-ultimo-backup', String(Date.now())); } catch { /* */ }
    if (!silent) toast(`Backup salvo no seu Google Drive ✓ (${(body.length / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB)`, 4000);
    A.onChange(true);
    return true;
  } catch (e) {
    if (!silent) toast(e.message, 5000);
    return false;
  } finally { busy = false; }
}

// Traz o backup do Drive (no tablet novo, por exemplo)
export async function restoreFromDrive() {
  try {
    toast('Procurando o backup no seu Drive…', 20000);
    let { fileId } = get();
    if (!fileId) {
      const q = encodeURIComponent(`name='${NAME}' and trashed=false`);
      const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=5`);
      const j = await r.json();
      fileId = j.files && j.files[0] && j.files[0].id;
      if (!fileId) { toast('Não achei backup deste app no seu Drive', 4500); return false; }
      put({ fileId });
    }
    const r = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!r.ok) throw new Error(`Não consegui baixar do Drive (código ${r.status})`);
    const data = await r.json();
    document.getElementById('toast')?.classList.remove('show');
    return restoreFn(data);
  } catch (e) { toast(e.message, 5000); return false; }
}

// Lembrete diário (com 1 toque, porque o Google pede um toque para autorizar)
export function driveDue() { const c = get(); return !!c.clientId && c.auto !== false && Date.now() - (c.last || 0) > 22 * 3600000; }

export async function driveSetup() {
  const c = get();
  const body = h(`<div class="drive-setup">
    <p>Com o Google Drive ligado, o backup vai para a <b>sua</b> conta: você abre o app em outro tablet ou celular e traz tudo de volta.</p>
    <details ${c.clientId ? '' : 'open'}><summary><b>Como ligar (uma vez só, ~5 minutos)</b></summary><ol class="small">
      <li>No Chrome, abra <b>console.cloud.google.com</b> e entre com a sua conta Google.</li>
      <li>No topo, toque em <b>Selecionar projeto → Novo projeto</b>, dê o nome <b>Caderno</b> e crie.</li>
      <li>No menu: <b>APIs e serviços → Biblioteca</b>, procure <b>Google Drive API</b> e toque em <b>Ativar</b>.</li>
      <li>Em <b>APIs e serviços → Tela de consentimento OAuth</b> (ou "Google Auth Platform"): tipo <b>Externo</b>, nome <b>Caderno</b> e o seu e-mail. Em <b>Público-alvo / Usuários de teste</b>, adicione o seu e-mail.</li>
      <li>Em <b>Credenciais → Criar credenciais → ID do cliente OAuth</b>: tipo <b>Aplicativo da Web</b>. Em <b>Origens JavaScript autorizadas</b>, adicione:<br><code class="drive-origin">${esc(location.origin)}</code></li>
      <li>Toque em <b>Criar</b>, copie o <b>ID do cliente</b> (termina com <code>.apps.googleusercontent.com</code>) e cole abaixo.</li>
    </ol></details>
    <label class="lbl">ID do cliente do Google</label>
    <input class="input" id="dr-id" value="${esc(c.clientId || '')}" placeholder="123456-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false">
    <label class="check"><input type="checkbox" id="dr-auto" ${c.auto !== false ? 'checked' : ''}> Lembrar todo dia e atualizar sozinho quando eu sair do app</label>
    <p class="muted small">O app só enxerga o arquivo de backup que ele mesmo criou no seu Drive (permissão "drive.file").</p>
  </div>`);
  const r = await modal({
    title: '☁️ Backup no Google Drive', body, wide: true,
    actions: [...(c.clientId ? [{ label: 'Desligar', value: 'off', danger: true }] : []), { label: 'Cancelar', value: null }, {
      label: 'Salvar e fazer backup', primary: true,
      validate: el => { const v = el.querySelector('#dr-id').value.trim(); if (!/\.apps\.googleusercontent\.com$/.test(v)) { toast('Cole o ID do cliente completo (termina com .apps.googleusercontent.com)', 4000); return false; } return true; },
      value: el => ({ clientId: el.querySelector('#dr-id').value.trim(), auto: el.querySelector('#dr-auto').checked }),
    }],
  });
  if (r === 'off') { try { localStorage.removeItem(KEY); } catch { /* */ } token = null; toast('Google Drive desligado'); A.onChange(true); return; }
  if (!r) return;
  if (r.clientId !== c.clientId) { token = null; put({ fileId: null }); }
  put(r);
  await backupNow();
}

export function driveHTML() {
  const c = get();
  const when = c.last ? new Date(c.last).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca';
  return `<div class="panel drive-panel"><h3>${ic('drive')}Google Drive</h3>
    ${c.clientId ? `<p class="status good">${ic('check')} Ligado · último backup no Drive: <b>${when}</b></p>
      <div class="row wrap"><button class="btn primary" id="dr-now">${ic('drive')}<span>Fazer backup no Drive agora</span></button>
        <button class="btn" id="dr-restore">${ic('download')}<span>Trazer do Drive</span></button><button class="btn" id="dr-setup">${ic('settings')}<span>Ajustar</span></button></div>`
      : `<p class="muted small">Guarde o backup na sua conta do Google, com 1 toque por dia e atualização sozinha quando você sai do app. Leva uns 5 minutos para ligar, uma vez só.</p>
      <button class="btn primary" id="dr-setup">${ic('drive')}<span>Ligar o Google Drive</span></button>`}</div>`;
}
export function bindDrive(el, rerender) {
  el.querySelector('#dr-setup')?.addEventListener('click', async () => { await driveSetup(); rerender(); });
  el.querySelector('#dr-now')?.addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; await backupNow(); rerender(); });
  el.querySelector('#dr-restore')?.addEventListener('click', async () => { await restoreFromDrive(); rerender(); });
}
