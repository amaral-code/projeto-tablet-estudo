// Cadeado: uma senha (PIN de 4 a 6 números) para o Diário e para as anotações que você trancar.
// É uma proteção de privacidade (para quem pegar o tablet), não criptografia: os dados continuam no tablet.
// Depois de destrancar, fica aberto até o app sair da tela.
import { ic, esc, h, toast, modal } from './ui.js';

const KEY = 'caderno-cadeado'; // { salt, hash, journal: true }
let unlocked = false;
const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const set = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* */ } };
export const hasPin = () => !!(get() && get().hash);
export const journalLocked = () => hasPin() && get().journal !== false;
export const isUnlocked = () => unlocked || !hasPin();
export function lockNow() { unlocked = false; }
document.addEventListener('visibilitychange', () => { if (document.hidden) unlocked = false; });

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (crypto.subtle) { const d = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  let x = 0; for (const b of data) x = (x * 31 + b) | 0; return String(x);
}
const pinOk = p => /^\d{4,6}$/.test(p);

// Pede a senha. Devolve true se destrancou.
export async function requireUnlock(what = 'isto') {
  if (isUnlocked()) return true;
  const cfg = get();
  const body = h(`<div class="lock-box"><div class="lock-ic">${ic('lock')}</div><p>Digite a senha para abrir ${esc(what)}.</p>
    <input class="input pin-in" id="lk-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••">
    <p class="late small" id="lk-err" hidden>Senha errada. Tente de novo.</p>
    <button type="button" class="link small" id="lk-forgot">Esqueci a senha</button></div>`);
  let ok = false;
  await modal({
    title: '🔒 Trancado', body,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Abrir', primary: true,
      validate: el => {
        const v = el.querySelector('#lk-pin').value;
        // a verificação é assíncrona: confere e fecha pelo próprio botão
        hashPin(v, cfg.salt).then(hh => {
          if (hh === cfg.hash) { ok = true; unlocked = true; el._close && el._close(true); }
          else { el.querySelector('#lk-err').hidden = false; el.querySelector('#lk-pin').value = ''; el.querySelector('#lk-pin').focus(); }
        });
        return false;
      },
      value: true,
    }],
    onOpen: el => {
      el.querySelector('#lk-forgot').onclick = async () => {
        el._close && el._close(null);
        const r = await modal({ title: 'Esqueci a senha', body: `<p>Para tirar o cadeado, digite <b>APAGAR SENHA</b>. Seu diário e suas anotações continuam salvos; só a senha é removida.</p><input class="input" id="lk-conf" autocomplete="off">`,
          actions: [{ label: 'Cancelar', value: null }, { label: 'Tirar o cadeado', danger: true, value: e2 => e2.querySelector('#lk-conf').value.trim().toUpperCase() }] });
        if (r === 'APAGAR SENHA') { set(null); unlocked = true; ok = true; toast('Cadeado removido. Crie uma senha nova em Ajustes → Cadeado.', 4500); }
      };
    },
  });
  return ok || isUnlocked();
}

// Criar/trocar/tirar a senha (Ajustes → Cadeado)
export async function lockSettings() {
  const cfg = get();
  const body = h(`<div class="lock-set">
    <p class="muted small">A senha protege o <b>Diário</b> e as anotações que você trancar (no ⋮ da anotação → <b>Trancar com senha</b>). Ela fica só neste tablet. Depois de abrir, fica aberto até você sair do app.</p>
    ${cfg ? `<p class="status good">${ic('lock')} Cadeado ligado</p>` : ''}
    <label class="lbl">${cfg ? 'Nova senha' : 'Crie uma senha'} (4 a 6 números)</label><input class="input pin-in" id="ls-a" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
    <label class="lbl">Repita a senha</label><input class="input pin-in" id="ls-b" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
    <label class="check"><input type="checkbox" id="ls-journal" ${!cfg || cfg.journal !== false ? 'checked' : ''}> Trancar o Diário</label>
  </div>`);
  const actions = [{ label: 'Cancelar', value: null }];
  if (cfg) actions.unshift({ label: 'Tirar o cadeado', value: 'off', danger: true });
  actions.push({
    label: 'Salvar', primary: true,
    validate: el => {
      const a = el.querySelector('#ls-a').value, b = el.querySelector('#ls-b').value;
      if (!a && cfg) return true; // só mudou a opção do diário
      if (!pinOk(a)) { toast('A senha precisa ter de 4 a 6 números'); return false; }
      if (a !== b) { toast('As duas senhas não são iguais'); return false; }
      return true;
    },
    value: el => ({ pin: el.querySelector('#ls-a').value, journal: el.querySelector('#ls-journal').checked }),
  });
  const r = await modal({ title: '🔒 Cadeado', body, actions });
  if (r === 'off') {
    if (!(await requireUnlock('as configurações do cadeado'))) return;
    set(null); toast('Cadeado desligado'); return;
  }
  if (!r) return;
  if (cfg && !(await requireUnlock('as configurações do cadeado'))) return;
  if (r.pin) {
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    set({ salt, hash: await hashPin(r.pin, salt), journal: r.journal });
    unlocked = true;
    toast('Senha salva ✓ O cadeado está ligado', 3000);
  } else { set({ ...cfg, journal: r.journal }); toast('Cadeado atualizado ✓'); }
}

// Tela trancada (no lugar do conteúdo), com botão para abrir
export function lockedScreen(el, what, onOpen) {
  el.innerHTML = `<div class="panel locked-screen"><div class="lock-ic">${ic('lock')}</div><h3>${esc(what)} está trancado</h3><p class="muted">Só abre com a sua senha.</p>
    <button class="btn primary" id="lk-open">${ic('lock')}<span>Abrir com a senha</span></button></div>`;
  el.querySelector('#lk-open').onclick = async () => { if (await requireUnlock(what.toLowerCase())) onOpen(); };
}
