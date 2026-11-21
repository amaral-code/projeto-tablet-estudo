// Adição rápida: entende frases do jeito que a gente fala e separa o que é tarefa, evento, dia, hora, matéria e prioridade.
//   "prova de física sexta 8h"        → evento (prova) · próxima sexta · 08:00 · Física
//   "lista de mat amanhã !"           → tarefa · amanhã · prioridade alta · Matemática
//   "entregar resumo dia 10"          → tarefa · dia 10
//   "dentista 15/12 às 14h30"         → evento (consulta) · 15/12 · 14:30
// Não usa internet nem IA: é só texto, então funciona sempre e na hora.

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAt = (base, n) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
const WEEK = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const PRE = '(?:(?:para|pra|ate|na|no|em|de|do|da|nessa|nesta|essa|esta|neste|nesse|proxima|proximo)\\s+)*';
// começo da frase → tipo de evento
const EVENT_START = [
  [/^(prova|provao|teste|avaliacao|simulado|recuperacao|vestibular|enem|olimpiada)\b/, 'prova'],
  [/^(trabalho|entrega|seminario|apresentacao|feira)\b/, 'trabalho'],
  [/^(aniversario|niver)\b/, 'aniversario'],
  [/^(consulta|dentista|medico|medica|exame|ortodontista|oculista)\b/, 'consulta'],
  [/^(reuniao|aula|palestra|excursao|passeio|treino|jogo|curso)\b/, 'aula'],
];
// apelidos comuns de matérias
const ABBR = { mat: 'matematica', port: 'portugues', hist: 'historia', geo: 'geografia', bio: 'biologia', fis: 'fisica', quim: 'quimica', ing: 'ingles', esp: 'espanhol', filo: 'filosofia', soc: 'sociologia', red: 'redacao', lit: 'literatura', ef: 'educacao fisica', cien: 'ciencias' };

export function parseQuick(text, { folders = [], now = new Date() } = {}) {
  const src = String(text || '').trim();
  // texto sem acento e minúsculo, lembrando de onde veio cada letra (para tirar do título)
  let n = ''; const map = [];
  for (let i = 0; i < src.length; i++) for (const ch of norm(src[i])) { n += ch; map.push(i); }
  const used = new Array(n.length).fill(false);
  const take = (a, b) => { for (let i = a; i < b; i++) used[i] = true; };
  const free = (a, b) => { for (let i = a; i < b; i++) if (used[i]) return false; return true; };
  const each = (re, fn) => {
    re.lastIndex = 0; let m;
    while ((m = re.exec(n))) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (!free(m.index, m.index + m[0].length)) continue;
      if (fn(m) !== false) take(m.index, m.index + m[0].length);
    }
  };
  const out = { kind: 'task', evKind: '', title: '', date: '', time: '', prio: 0, folderId: '', raw: src };
  const today = dayAt(now, 0);

  // ----- hora (antes da data, para "15/12 às 14h" não confundir) -----
  const setTime = (h, m = 0) => { if (h > 23 || m > 59 || out.time) return false; out.time = `${pad(h)}:${pad(m)}`; };
  each(/\b(?:as\s+|a\s+)?(\d{1,2})(?:h|:\d{2})?\s+da\s+(manha|tarde|noite)\b/g, m => { let h = +m[1]; const mm = +((m[0].match(/:(\d{2})/) || [])[1] || 0); if (m[2] !== 'manha' && h < 12) h += 12; return setTime(h, mm); });
  each(/\b(?:as\s+|a\s+|ate\s+as\s+)?(\d{1,2})(?::|h)(\d{2})\b/g, m => setTime(+m[1], +m[2]));
  // "às 8 horas", "8h": sem o "às", só vale das 6h em diante ("estudar 2h" é quanto tempo, não a hora)
  each(/\b(as\s+|a\s+|ate\s+as\s+)?(\d{1,2})\s?(h|hs|hrs?|horas?)\b/g, m => (m[1] || (+m[2] >= 6 && /^h/.test(m[3]) && m[3].length <= 3) ? setTime(+m[2]) : false));
  // "às 14": só com o acento ("fazer as 3 listas" não é horário) ou no fim da frase
  each(/\bas\s+(\d{1,2})\b(?!\s*\/)/g, m => (/[àÀ]/.test(src[map[m.index]]) || !n.slice(m.index + m[0].length).trim() ? setTime(+m[1]) : false));
  each(/\b(?:ao\s+|as\s+|a\s+)?meio[\s-]dia\b/g, () => setTime(12));

  // ----- dia -----
  const setDate = d => { if (out.date || !d || isNaN(d)) return false; out.date = ymd(d); };
  each(new RegExp(`\\b${PRE}depois\\s+de\\s+amanha\\b`, 'g'), () => setDate(dayAt(today, 2)));
  each(new RegExp(`\\b${PRE}(?:hoje|hj)\\b`, 'g'), () => setDate(today));
  each(new RegExp(`\\b${PRE}amanha\\b`, 'g'), () => setDate(dayAt(today, 1)));
  each(new RegExp(`\\b${PRE}(?:daqui\\s+a|daqui|em)\\s+(\\d{1,2})\\s+dias?\\b`, 'g'), m => setDate(dayAt(today, +m[1])));
  each(new RegExp(`\\b${PRE}(?:semana\\s+que\\s+vem|proxima\\s+semana)\\b`, 'g'), () => setDate(dayAt(today, 7)));
  each(new RegExp(`\\b${PRE}fim\\s+de\\s+semana\\b`, 'g'), () => { const k = (6 - today.getDay() + 7) % 7; return setDate(dayAt(today, today.getDay() === 0 ? 0 : k)); });
  each(new RegExp(`\\b${PRE}(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[\\s-]feira)?(?:\\s+que\\s+vem)?\\b`, 'g'), m => {
    const w = WEEK.indexOf(m[1]); let k = (w - today.getDay() + 7) % 7; if (k === 0) k = 7; return setDate(dayAt(today, k));
  });
  each(new RegExp(`\\b${PRE}(?:dia\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b`, 'g'), m => {
    const d = +m[1], mo = +m[2]; if (!d || d > 31 || !mo || mo > 12) return false;
    let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000;
    let dt = new Date(y, mo - 1, d); if (dt.getMonth() !== mo - 1) return false;
    if (!m[3] && dt < today) dt = new Date(y + 1, mo - 1, d);
    return setDate(dt);
  });
  each(new RegExp(`\\b${PRE}dia\\s+(\\d{1,2})\\b(?!\\s*(?:\\/|h\\b|:))`, 'g'), m => {
    const d = +m[1]; if (!d || d > 31) return false;
    for (let k = 0; k < 14; k++) { const dt = new Date(today.getFullYear(), today.getMonth() + k, d); if (dt.getDate() === d && dt >= today) return setDate(dt); }
    return false;
  });

  // ----- prioridade -----
  if (/!/.test(n)) { out.prio = 3; for (let i = 0; i < n.length; i++) if (n[i] === '!') used[i] = true; }
  each(/\b(?:prioridade\s+alta|urgente|importante|muito\s+importante)\b/g, () => { out.prio = 3; });
  each(/\b(?:prioridade\s+baixa|sem\s+pressa|quando\s+der)\b/g, () => { if (!out.prio) out.prio = 1; });

  // ----- título (o que sobrou) -----
  const gone = new Array(src.length).fill(false), seen = new Array(src.length).fill(false);
  for (let j = 0; j < map.length; j++) { const i = map[j]; gone[i] = seen[i] ? gone[i] && used[j] : used[j]; seen[i] = true; }
  let title = '';
  for (let i = 0; i < src.length; i++) if (!gone[i]) title += src[i];
  const LEAD = /^(?:tenho|vou\s+ter|vai\s+ter|tem|lembrar\s+de|lembrete:?)\s+/i;
  const TAIL = /[\s,;.:-]+(?:para|pra|na|no|de|do|da|em|as|às|a|até|ate|dia|e|que|o)?\s*$/i;
  title = title.replace(/\s+/g, ' ').trim().replace(LEAD, '');
  for (let k = 0; k < 4; k++) title = title.replace(TAIL, '').trim();
  title = title.replace(/^[,;.:-]+\s*/, '');
  if (!title) title = 'Lembrete';
  out.title = title.charAt(0).toUpperCase() + title.slice(1);

  // ----- matéria -----
  const nt = norm(out.title);
  let best = null;
  for (const f of folders) {
    const fn = norm(f.name).trim(); if (!fn) continue;
    const words = [fn, ...Object.entries(ABBR).filter(([, full]) => fn.startsWith(full)).map(([a]) => a)];
    for (const w of words) {
      const m = new RegExp(`(?:^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`).exec(nt);
      if (m && (!best || m.index < best.at || (m.index === best.at && w.length > best.len))) best = { id: f.id, at: m.index, len: w.length };
    }
  }
  if (best) out.folderId = best.id;

  // ----- tarefa ou evento -----
  const start = nt.replace(/^(?:minha|meu|a|o|uma|um)\s+/, '');
  const ev = EVENT_START.find(([re]) => re.test(start));
  if (ev) { out.kind = 'event'; out.evKind = ev[1]; }
  else if (out.time) { out.kind = 'event'; out.evKind = 'outro'; }
  return out;
}

// Resumo curto do que foi entendido (para mostrar antes de salvar)
export function describeQuick(q, { folderName = () => '', now = new Date() } = {}) {
  const parts = [];
  if (q.date) {
    const t = ymd(dayAt(now, 0)), tm = ymd(dayAt(now, 1));
    const [y, m, d] = q.date.split('-').map(Number), dt = new Date(y, m - 1, d);
    parts.push(q.date === t ? 'hoje' : q.date === tm ? 'amanhã' : dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', ''));
  }
  if (q.time) parts.push(q.time);
  if (q.folderId && folderName(q.folderId)) parts.push(folderName(q.folderId));
  if (q.prio === 3) parts.push('prioridade alta'); else if (q.prio === 1) parts.push('prioridade baixa');
  return parts;
}
