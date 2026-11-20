// Assistente de estudos com IA — Gemini (Google), versão rápida (Flash-Lite).
// As páginas vão como imagens (o Gemini lê a escrita à mão) e as gravações de aula, como áudio.
import { renderPage, loadPageImages, PAGE_W, PAGE_H } from './ink.js';
import { settings } from './store.js';
import { CHAVE_GEMINI } from './chave.js';

// Medido de verdade em 20/11/2026 com a chave do estudante:
//  - gemini-flash-lite-latest + raciocínio "low": 0,6–0,7 s para responder (o mais rápido);
//  - gemini-3.1-flash-lite (reserva): 0,9 s;
//  - "thinkingBudget: 0" é recusado por esses modelos (nunca enviar);
//  - o nome "-latest" sempre aponta para o Flash-Lite mais novo, então não fica desatualizado.
export const GEMINI_MODEL = 'gemini-flash-lite-latest';
export const GEMINI_FALLBACK = 'gemini-3.1-flash-lite';
export const MAX_PAGES = 20;
export const maxPages = () => MAX_PAGES;
const GEMINI_URL = m => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;

const SYSTEM = `Você é um professor particular e assistente de estudos dentro do app "Caderno de Estudos", usado por um estudante brasileiro num tablet.
As anotações do estudante chegam como imagens de páginas de caderno, quase sempre escritas à mão (às vezes com textos digitados, fotos de livros ou PDFs importados). Leia com atenção a escrita, as contas, os desenhos e os destaques do marca-texto.

Regras:
- Responda em português do Brasil, a não ser que o estudante peça outro idioma ou a matéria seja de língua estrangeira.
- Use linguagem clara e adequada ao nível do conteúdo das anotações.
- Sua resposta será escrita numa folha do caderno, então use texto simples: títulos curtos em linhas próprias começando com "# ", listas com "- " ou "1. ", e parágrafos curtos. Não use tabelas, negrito, itálico nem blocos de código. Para contas, escreva em uma linha (ex.: 3/4 + 1/4 = 1).
- Se alguma parte estiver ilegível, diga qual parte e não invente o que está escrito.
- Se encontrar um erro de conteúdo nas anotações (fato, conta ou regra errada), aponte com gentileza e mostre a forma correta.
- Não comece com frases como "Claro!" ou "Aqui está"; vá direto ao conteúdo.`;

export const ACTIONS = {
  summary: {
    label: 'Resumir', icon: 'book',
    prompt: 'Faça um resumo de estudo destas anotações. Comece com um título, depois as ideias principais em tópicos, os conceitos e fórmulas importantes (com uma explicação curta de cada) e termine com "# Para lembrar" com 3 a 5 frases que resumem o essencial.',
  },
  improve: {
    label: 'Melhorar a escrita', icon: 'edit',
    prompt: 'Reescreva o texto destas anotações corrigindo ortografia, acentuação, gramática, pontuação e clareza, mantendo o sentido e o jeito de escrever do estudante. Depois, numa seção "# Correções", liste os principais erros no formato "errado → certo" com uma explicação curta da regra de cada um. Se o texto já estiver correto, diga isso e sugira só melhorias de estilo.',
  },
  expand: {
    label: 'Escrever mais', icon: 'plus',
    prompt: 'Continue e aprofunde o conteúdo destas anotações: acrescente explicações, exemplos, detalhes importantes e curiosidades sobre o mesmo assunto que ainda não estão escritas, no mesmo nível do estudante. Organize com títulos. Não repita o que já está nas anotações.',
  },
  explain: {
    label: 'Explicar passo a passo', icon: 'magic',
    prompt: 'Explique o conteúdo destas anotações passo a passo, como um bom professor faria, com exemplos simples. Se houver exercícios ou contas, resolva cada um passo a passo, mostre onde o estudante errou (se errou) e qual é a resposta certa.',
  },
  quiz: {
    label: 'Perguntas de revisão', icon: 'tasks',
    prompt: 'Crie 10 perguntas de revisão sobre o conteúdo destas anotações, misturando múltipla escolha (a, b, c, d), verdadeiro ou falso e perguntas abertas curtas, da mais fácil para a mais difícil. Coloque o gabarito com uma explicação curta de cada resposta no final, numa seção "# Gabarito".',
  },
  flashcards: {
    label: 'Flashcards', icon: 'copy',
    prompt: 'Crie de 10 a 15 flashcards para memorizar o conteúdo destas anotações. Use exatamente este formato, um por bloco, separados por uma linha em branco:\nP: pergunta curta\nR: resposta curta',
  },
  plan: {
    label: 'Plano de estudo', icon: 'calendar',
    prompt: 'Com base nestas anotações, monte um plano de estudo para a próxima semana: o que revisar em cada dia (em sessões de 25 a 40 minutos), quais exercícios fazer e como verificar se aprendeu. Termine com uma lista "# Tarefas" com 3 a 7 tarefas curtas, uma por linha começando com "- ".',
  },
};

// Chave embutida (js/chave.js); a chave colada em Ajustes tem prioridade
const BUILTIN_KEY = (CHAVE_GEMINI || '').trim();
export const hasBuiltinKey = () => !!BUILTIN_KEY;
export const usingBuiltinKey = () => !!BUILTIN_KEY && !(settings.geminiKey || '').trim();
export const geminiKey = () => (settings.geminiKey || '').trim() || BUILTIN_KEY;
export function aiConfigured() { return !!geminiKey(); }

async function renderToImage(page, bg, region) {
  await loadPageImages(page);
  const r = region || { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
  const k = Math.min(3, 1100 / Math.max(r.w, r.h * 0.75));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
  renderPage(ctx, page, bg);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] } };
}

// Monta o conteúdo da primeira mensagem: imagens das páginas + pedido
export async function buildContent({ pages, bg, region, title, folder, prompt }) {
  const list = pages.slice(0, MAX_PAGES);
  const blocks = [];
  for (let i = 0; i < list.length; i++) {
    if (list.length > 1) blocks.push({ type: 'text', text: `Página ${i + 1}${list[i]._title ? ` — anotação "${list[i]._title}"` : ''}:` });
    blocks.push(await renderToImage(list[i], list[i]._bg || bg, region));
  }
  const ctx = [`Título: ${title || 'sem título'}`];
  if (folder) ctx.push(`Matéria/pasta: ${folder}`);
  if (region) ctx.push('As imagens mostram só o trecho que o estudante selecionou.');
  if (pages.length > MAX_PAGES) ctx.push(`(Só as primeiras ${MAX_PAGES} de ${pages.length} páginas foram enviadas.)`);
  blocks.push({ type: 'text', text: `${ctx.join('\n')}\n\n${prompt}` });
  return blocks;
}

export class AIError extends Error {}

// Converte a resposta (texto simples com "# " e "- ") em linhas para o caderno
export function cleanText(t) {
  return String(t)
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?)\*(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Extrai a lista de tarefas de um "Plano de estudo"
export function extractTasks(text) {
  const m = cleanText(text).split(/\n#+\s*Tarefas\s*\n/i)[1];
  if (!m) return [];
  return m.split('\n').map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(l => l && !l.startsWith('#')).slice(0, 10);
}

// Lê pares "P: ... / R: ..." (também "Pergunta:"/"Resposta:" e "Q:"/"A:") de uma resposta de flashcards
export function parseFlashcards(text) {
  const out = [];
  let cur = null;
  for (const raw of cleanText(text).split('\n')) {
    const line = raw.trim();
    const q = line.match(/^(?:\d+[.)]\s*)?(?:P|Pergunta|Q|Frente)\s*[:\-–]\s*(.+)$/i);
    const a = line.match(/^(?:R|Resposta|A|Verso)\s*[:\-–]\s*(.+)$/i);
    if (q) { if (cur && cur.back) out.push(cur); cur = { front: q[1].trim(), back: '' }; }
    else if (a && cur) cur.back = cur.back ? cur.back + '\n' + a[1].trim() : a[1].trim();
    else if (line && cur && cur.back) cur.back += '\n' + line;
  }
  if (cur && cur.back) out.push(cur);
  return out.filter(c => c.front && c.back);
}

// ======================= Gemini =======================
// Conversa no formato do app ({role, content: texto | blocos text/image/audio}) → formato do Gemini.
// opts: { system: instruções próprias, json: resposta em JSON, maxTokens }
export function geminiBody(messages, model = GEMINI_MODEL, opts = {}) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: typeof m.content === 'string'
      ? [{ text: m.content }]
      : m.content.filter(b => ['text', 'image', 'audio'].includes(b.type)).map(b => (b.type === 'text'
        ? { text: b.text }
        : { inline_data: { mime_type: b.source.media_type, data: b.source.data } })),
  })).filter(c => c.parts.length);
  const generationConfig = { maxOutputTokens: opts.maxTokens || 8192, temperature: 0.4 };
  // versão rápida: raciocínio baixo no modelo principal (no reserva, o padrão já é rápido)
  if (model === GEMINI_MODEL) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  if (opts.json) generationConfig.responseMimeType = 'application/json';
  return { systemInstruction: { parts: [{ text: opts.system || SYSTEM }] }, contents, generationConfig };
}

function geminiError(status, msg, reason) {
  const m = String(msg || '');
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(m + reason) || status === 401) return new AIError('Chave do Gemini inválida. Confira a chave em Ajustes → Inteligência artificial.');
  if (status === 403) return new AIError('A chave do Gemini não tem permissão para usar a API. Gere uma chave em aistudio.google.com/apikey.');
  if (status === 429) return new AIError('Limite do Gemini atingido (o plano gratuito tem limite por minuto e por dia). Espere um pouco e tente de novo.');
  if (status === 413 || /too large|exceeds|payload size/i.test(m)) return new AIError('Pedido grande demais para o Gemini. Use “Esta página”, selecione um trecho ou uma gravação mais curta.');
  if (status >= 500) return new AIError('O Gemini está com muita procura agora. Tente de novo em alguns segundos.');
  return new AIError('Erro do Gemini: ' + (m || 'código ' + status).slice(0, 200));
}

// espera interrompível (para novas tentativas)
const sleepAbort = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('abort'); e.name = 'AbortError'; rej(e); }, { once: true });
});
// faz o pedido tentando de novo quando o serviço está sobrecarregado (500/502/503/504)
async function fetchRetry(url, opts, signal, tries = 3) {
  for (let a = 0; ; a++) {
    const res = await fetch(url, opts);
    if (![500, 502, 503, 504].includes(res.status) || a >= tries - 1) return res;
    await sleepAbort(1000 * (a + 1), signal);
  }
}

// Envia a conversa e transmite o texto aos poucos. Devolve { done: Promise<{text, truncated, message}>, abort }.
// Versão rapidão: o modelo principal começa; se ele não começar a escrever em poucos segundos (o Google às vezes
// demora), o reserva entra junto e vale o que escrever primeiro — o outro é cancelado. Se o principal falhar
// (sobrecarregado, indisponível, lento demais ou sem cota), o reserva assume na hora.
export function streamChat(messages, onText, opts = {}) {
  if (!aiConfigured()) throw new AIError('Ligue a IA: cole a chave do Gemini em Ajustes → Inteligência artificial.');
  if (!navigator.onLine) throw new AIError('Sem internet: a IA precisa de conexão.');
  const ctrl = new AbortController();
  const key = geminiKey();
  const blocks = messages.flatMap(m => (Array.isArray(m.content) ? m.content : []));
  const hasAudio = blocks.some(b => b.type === 'audio');
  const nImages = blocks.filter(b => b.type === 'image').length;
  // sem nenhuma resposta nesse tempo, a tentativa desiste (áudio longo demora mais para começar)
  const firstByteMs = hasAudio ? 120000 : 25000;
  // depois desse tempo sem texto, o reserva começa em paralelo (pedidos com muitas páginas demoram um pouco mais)
  const audioMB = blocks.filter(b => b.type === 'audio').reduce((n, b) => n + (b.source.data || '').length * 0.75, 0) / 1048576;
  const hedgeMs = opts.hedgeMs ?? (hasAudio ? Math.min(45000, 15000 + 1500 * audioMB) : Math.min(16000, 6000 + 500 * nImages));

  // Uma tentativa num modelo: devolve o texto ou lança erro. 'retryable' = vale tentar o reserva.
  async function attempt(model, ac, emit) {
    const onAbort = () => ac.abort();
    ctrl.signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, firstByteMs);
    const fail = (err, retryable) => { err.retryable = retryable; return err; };
    try {
      let res;
      try {
        res = await fetchRetry(GEMINI_URL(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(geminiBody(messages, model, opts)),
          signal: ac.signal,
        }, ac.signal);
      } catch (e) {
        if (timedOut) throw fail(new AIError('O Gemini demorou demais para responder. Tente de novo.'), true);
        if (e.name === 'AbortError') throw e;
        throw fail(new AIError('Sem conexão com o Gemini. Verifique a internet.'), false);
      }
      if (!res.ok) {
        let msg = '', reason = '';
        try { const j = await res.json(); const er = Array.isArray(j) ? j[0].error : j.error; msg = er && er.message; reason = JSON.stringify(er && er.details || ''); } catch { /* sem corpo */ }
        // 429: a cota do plano gratuito é separada por modelo, então o reserva ainda pode responder
        throw fail(geminiError(res.status, msg, reason), [404, 429, 500, 502, 503, 504].includes(res.status));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '', finish = null, blocked = null;
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); }
        catch (e) {
          if (timedOut && !text) throw fail(new AIError('O Gemini demorou demais para responder. Tente de novo.'), true);
          throw e;
        }
        clearTimeout(timer); // já começou a responder
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let j;
          try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (j.error) throw fail(geminiError(j.error.code, j.error.message, j.error.status), !text && j.error.code >= 500);
          if (j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
          const c = j.candidates && j.candidates[0];
          if (!c) continue;
          for (const part of (c.content && c.content.parts) || []) {
            if (part.text && !part.thought) { text += part.text; emit(part.text); }
          }
          if (c.finishReason) finish = c.finishReason;
        }
      }
      if (!text) {
        if (blocked || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw fail(new AIError('O Gemini não respondeu a este pedido por segurança. Tente reformular.'), false);
        throw fail(new AIError('O Gemini não devolveu resposta. Tente de novo.'), true);
      }
      return { text, truncated: finish === 'MAX_TOKENS', message: { content: [{ type: 'text', text }] }, model };
    } finally {
      clearTimeout(timer);
      ctrl.signal.removeEventListener('abort', onAbort);
    }
  }

  const done = new Promise((resolve, reject) => {
    const runs = new Map(); // modelo -> AbortController da tentativa
    const errs = {};
    let winner = null, settled = false, hedge = null;
    const end = (fn, v) => { if (settled) return; settled = true; clearTimeout(hedge); fn(v); };
    const start = model => {
      if (runs.has(model) || settled || ctrl.signal.aborted) return;
      const ac = new AbortController();
      runs.set(model, ac);
      attempt(model, ac, t => {
        // o primeiro modelo que escrever vence; o outro é cancelado
        if (!winner) { winner = model; clearTimeout(hedge); for (const [m, a] of runs) if (m !== model) a.abort(); }
        if (winner === model) onText(t);
      }).then(res => {
        if (!winner) winner = model;
        if (winner === model) end(resolve, res);
      }, e => {
        runs.delete(model);
        if (winner === model) { end(reject, e); return; }
        if (winner || settled) return; // perdeu a corrida: já foi cancelado
        errs[model] = e;
        if (model === GEMINI_MODEL && e.retryable && !ctrl.signal.aborted) start(GEMINI_FALLBACK);
        if (!runs.size) {
          // os dois falharam: mostra o erro que explica melhor (o do principal, se não era caso de reserva)
          const p = errs[GEMINI_MODEL], f = errs[GEMINI_FALLBACK];
          end(reject, p && (!p.retryable || !f || f.name === 'AbortError') ? p : (f || p));
        }
      });
    };
    start(GEMINI_MODEL);
    hedge = setTimeout(() => { if (!winner) start(GEMINI_FALLBACK); }, hedgeMs);
  }).catch(e => {
    if (e.name === 'AbortError' || ctrl.signal.aborted) { const a = new AIError('Cancelado'); a.aborted = true; throw a; }
    throw e instanceof AIError ? e : new AIError(String(e && e.message || e));
  });
  return { done, abort: () => ctrl.abort() };
}

// Pedido simples (sem streaming na tela): devolve só o texto
export async function askGemini(content, opts = {}) {
  const r = await streamChat([{ role: 'user', content }], () => {}, opts).done;
  return r.text;
}
