// Voz: ler em voz alta (voz do próprio tablet) e ditado (fala → texto, pelo Chrome).
import { ic, toast } from './ui.js';

export const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
export const canDictate = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

let speakingBtn = null;
function pickVoice(lang) {
  const vs = speechSynthesis.getVoices();
  return vs.find(v => v.lang === lang) || vs.find(v => v.lang && v.lang.startsWith(lang.slice(0, 2))) || null;
}
// limpa marcações e divide em frases (o Chrome corta falas muito longas)
function chunks(text) {
  const clean = String(text).replace(/^\s*#+\s*/gm, '').replace(/[*_`>]/g, '').replace(/\[( |x)\]/gi, '').trim();
  const parts = clean.match(/[^.!?\n]+[.!?]*|\n+/g) || [clean];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (/^\n+$/.test(p)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    if ((cur + p).length > 220) { if (cur.trim()) out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function stopSpeak() {
  if (canSpeak()) speechSynthesis.cancel();
  if (speakingBtn) { speakingBtn.classList.remove('on'); speakingBtn.innerHTML = speakingBtn.dataset.html || ic('speaker'); speakingBtn = null; }
}
// Lê o texto. Se for chamado de um botão, o botão vira "Parar" enquanto fala.
export function speak(text, { lang = 'pt-BR', button } = {}) {
  if (!canSpeak()) { toast('Este navegador não consegue ler em voz alta'); return; }
  if (button && speakingBtn === button) { stopSpeak(); return; }
  stopSpeak();
  const list = chunks(text);
  if (!list.length) return;
  const voice = pickVoice(lang);
  if (button) { speakingBtn = button; button.dataset.html = button.innerHTML; button.classList.add('on'); button.innerHTML = `${ic('stop')}<span>Parar</span>`; }
  list.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang; if (voice) u.voice = voice; u.rate = 1;
    if (i === list.length - 1) u.onend = () => { if (speakingBtn === button) stopSpeak(); };
    u.onerror = () => { if (speakingBtn === button) stopSpeak(); };
    speechSynthesis.speak(u);
  });
}

// Ditado: escreve no campo de texto enquanto você fala
export function dictate({ lang = 'pt-BR', onText, onEnd, onError }) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { onError && onError('sem-suporte'); return null; }
  const r = new R();
  r.lang = lang; r.interimResults = true; r.continuous = true;
  let final = '';
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += (final && !final.endsWith(' ') ? ' ' : '') + t.trim();
      else interim += t;
    }
    onText && onText(final, interim);
  };
  r.onerror = e => onError && onError(e.error);
  r.onend = () => onEnd && onEnd(final);
  try { r.start(); } catch { onError && onError('erro'); return null; }
  return { stop: () => { try { r.stop(); } catch { /* */ } } };
}

// Liga um botão 🎤 a um campo de texto: toca para falar, toca de novo para parar
export function attachDictation(button, field) {
  if (!canDictate()) { button.hidden = true; return; }
  let session = null, base = '';
  button.title = 'Ditar (falar em vez de digitar)';
  button.onclick = () => {
    if (session) { session.stop(); return; }
    base = field.value ? field.value.replace(/\s*$/, ' ') : '';
    button.classList.add('on');
    session = dictate({
      onText: (fin, interim) => { field.value = base + fin + (interim ? ' ' + interim : ''); field.dispatchEvent(new Event('input')); },
      onEnd: fin => { session = null; button.classList.remove('on'); field.value = base + fin; field.dispatchEvent(new Event('input')); },
      onError: err => {
        session = null; button.classList.remove('on');
        toast(err === 'not-allowed' ? 'Permita o uso do microfone para ditar' : err === 'network' ? 'O ditado precisa de internet' : 'Não consegui ouvir. Tente de novo.', 3500);
      },
    });
    if (session) toast('Pode falar… toque no 🎤 de novo para parar', 2500);
  };
}
