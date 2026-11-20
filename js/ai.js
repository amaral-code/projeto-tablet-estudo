// Assistente de estudos com IA (Claude, da Anthropic).
// As páginas são enviadas como imagens: o Claude lê a escrita à mão diretamente.
import Anthropic from './vendor/anthropic-sdk.mjs';
import { renderPage, loadPageImages, PAGE_W, PAGE_H } from './ink.js';
import { settings } from './store.js';

export const AI_MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5 — melhor qualidade',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 — ótimo e mais barato',
  'claude-haiku-5-5': 'Claude Haiku 5.5 — o mais rápido e barato',
};
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MAX_PAGES = 20;

// ----- Groq (alternativa gratuita) -----
export const PROVIDERS = { gemini: 'Gemini (Google)', anthropic: 'Claude', groq: 'Groq' };
// Testado de verdade em 20/11/2026: o Flash-Lite mais recente respondeu em ~1 s (texto) e ~3 s
// (página com imagem); o 2.5 Flash não está mais disponível para contas novas; o Pro não tem cota grátis.
// Os nomes "-latest" sempre apontam para a versão mais nova, então não ficam desatualizados.
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-lite-latest';
const GEMINI_FALLBACK = 'gemini-flash-lite-latest';
export const GEMINI_MODELS = [
  ['gemini-flash-lite-latest', 'Gemini Flash-Lite (mais recente) — rápido, lê imagens (recomendado)'],
  ['gemini-flash-latest', 'Gemini Flash (mais recente) — mais caprichado, pode demorar'],
  ['gemini-pro-latest', 'Gemini Pro (mais recente) — exige plano pago'],
];
const GEMINI_DEAD = /^gemini-(1\.|2\.0|2\.5-flash$|2\.5-flash-lite$)/; // desligados para contas novas
const GEMINI_URL = m => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;
export const geminiModel = () => {
  const m = (settings.geminiModel || '').trim();
  return !m || GEMINI_DEAD.test(m) ? GEMINI_DEFAULT_MODEL : m;
};
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
    await sleepAbort(1200 * (a + 1), signal);
  }
}
// Conferido na documentação da Groq (docs/vision e docs/deprecations) em 20/11/2026:
// os modelos Llama 4 foram desligados; o modelo de visão atual é o Qwen 3.8 27B (até 3 imagens).
export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_MODELS = [
  ['qwen/qwen3.8-27b', 'Qwen 3.8 27B — lê imagens, até 3 páginas (recomendado)'],
  ['meta-models/muse-spark-open', 'Muse Spark Open — lê imagens, até 5 páginas (prévia limitada)'],
  ['openai/gpt-oss-120b', 'GPT-OSS 120B — só texto (relatório e diário; não lê a folha)'],
];
const GROQ_DEAD = /llama-4-(scout|maverick)|^qwen\/qwen3-32b$|llama-3\.[13]-/; // descontinuados
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const provider = () => (['groq', 'gemini'].includes(settings.aiProvider) ? settings.aiProvider : 'anthropic');
export const groqModel = () => {
  const m = (settings.groqModel || '').trim();
  return !m || GROQ_DEAD.test(m) ? GROQ_DEFAULT_MODEL : m;
};
// Limite de imagens por pedido de cada modelo de visão da Groq
const groqMaxImages = m => (/muse-spark/.test(m) ? 5 : 3);
export const maxPages = () => (provider() === 'groq' ? groqMaxImages(groqModel()) : MAX_PAGES);

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

export function aiConfigured() {
  const k = { groq: settings.groqKey, gemini: settings.geminiKey, anthropic: settings.aiKey }[provider()];
  return !!(k && k.trim());
}

let client = null, clientKey = '';
function getClient() {
  const key = settings.aiKey.trim();
  if (!client || clientKey !== key) {
    // A chave fica só neste tablet e é enviada apenas para a API da Anthropic.
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

const canvasToB64 = c => c.toDataURL('image/jpeg', 0.82).split(',')[1];

async function renderToImage(page, bg, region) {
  await loadPageImages(page);
  const r = region || { x: 0, y: 0, w: PAGE_W, h: PAGE_H };
  const groq = provider() === 'groq';
  const k = Math.min(3, (groq ? 900 : 1100) / Math.max(r.w, r.h * 0.75));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
  renderPage(ctx, page, bg);
  const data = groq ? c.toDataURL('image/jpeg', 0.72).split(',')[1] : canvasToB64(c);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}

// Monta o conteúdo da primeira mensagem: imagens das páginas + pedido
export async function buildContent({ pages, bg, region, title, folder, prompt }) {
  const MAX = maxPages();
  const list = pages.slice(0, MAX);
  const blocks = [];
  for (let i = 0; i < list.length; i++) {
    if (list.length > 1) blocks.push({ type: 'text', text: `Página ${i + 1}${list[i]._title ? ` — anotação "${list[i]._title}"` : ''}:` });
    blocks.push(await renderToImage(list[i], list[i]._bg || bg, region));
  }
  const ctx = [`Título: ${title || 'sem título'}`];
  if (folder) ctx.push(`Matéria/pasta: ${folder}`);
  if (region) ctx.push('As imagens mostram só o trecho que o estudante selecionou.');
  if (pages.length > MAX) ctx.push(`(Só as primeiras ${MAX} de ${pages.length} páginas foram enviadas.)`);
  blocks.push({ type: 'text', text: `${ctx.join('\n')}\n\n${prompt}` });
  return blocks;
}

export class AIError extends Error {}

function friendlyError(e) {
  if (e instanceof AIError) return e;
  if (e instanceof Anthropic.APIUserAbortError) { const a = new AIError('Cancelado'); a.aborted = true; return a; }
  if (e instanceof Anthropic.AuthenticationError) return new AIError('Chave da API inválida. Confira a chave em Ajustes → Inteligência artificial.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AIError('Sua chave não tem permissão para usar este modelo.');
  if (e instanceof Anthropic.RateLimitError) return new AIError('Muitos pedidos ou créditos esgotados. Espere um pouco ou confira seus créditos no console da Anthropic.');
  if (e instanceof Anthropic.BadRequestError) {
    const m = String(e.message || '');
    if (/credit|balance/i.test(m)) return new AIError('Sem créditos na conta da Anthropic. Adicione créditos em platform.claude.com.');
    return new AIError('Pedido recusado pela API: ' + m.slice(0, 200));
  }
  if (e instanceof Anthropic.APIConnectionError) return new AIError('Sem conexão com a IA. Verifique a internet.');
  if (e instanceof Anthropic.InternalServerError) return new AIError('A IA está instável agora. Tente de novo em instantes.');
  if (e instanceof Anthropic.APIError) return new AIError('Erro da IA: ' + String(e.message || e).slice(0, 200));
  return new AIError(String(e && e.message ? e.message : e));
}

// Envia a conversa e transmite o texto aos poucos.
// messages: [{role:'user'|'assistant', content}]
export function streamChat(messages, onText) {
  if (!aiConfigured()) throw new AIError('Configure sua chave da API em Ajustes → Inteligência artificial.');
  if (!navigator.onLine) throw new AIError('Sem internet: o assistente de IA precisa de conexão.');
  if (provider() === 'groq') return streamGroq(messages, onText);
  if (provider() === 'gemini') return streamGemini(messages, onText);
  const model = AI_MODELS[settings.aiModel] ? settings.aiModel : DEFAULT_MODEL;
  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages,
  };
  // Se o filtro de segurança recusar um pedido legítimo, o servidor tenta outro modelo automaticamente.
  if (model !== 'claude-haiku-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let stream;
  try { stream = getClient().beta.messages.stream(params); }
  catch (e) { throw friendlyError(e); }
  stream.on('text', t => onText(t));
  stream.on('error', () => { /* tratado em finalMessage */ });
  const done = stream.finalMessage().then(msg => {
    if (msg.stop_reason === 'refusal') throw new AIError('A IA não pôde responder a este pedido. Tente reformular.');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { text, truncated: msg.stop_reason === 'max_tokens', message: msg };
  }).catch(e => { throw friendlyError(e); });
  return { done, abort: () => stream.abort() };
}

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

// ======================= Groq =======================
// Converte a conversa (formato do Claude) para o formato da Groq (compatível com OpenAI).
// As instruções vão no início da primeira mensagem, porque alguns modelos de visão não aceitam
// mensagem de sistema junto com imagens.
export function toGroqMessages(messages) {
  const out = [];
  messages.forEach((m, i) => {
    const sys = i === 0 ? `${SYSTEM}\n\n` : '';
    if (typeof m.content === 'string') { out.push({ role: m.role, content: sys + m.content }); return; }
    if (m.role === 'assistant') { out.push({ role: 'assistant', content: m.content.filter(b => b.type === 'text').map(b => b.text).join('') }); return; }
    const parts = m.content.map(b => (b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
      : { type: 'text', text: b.text }));
    if (sys) parts.unshift({ type: 'text', text: sys.trim() });
    out.push({ role: 'user', content: parts });
  });
  return out;
}

function groqError(status, msg) {
  const m = String(msg || '');
  if (status === 401) return new AIError('Chave da Groq inválida. Confira a chave em Ajustes → Inteligência artificial.');
  if (status === 429) return new AIError('Limite da Groq atingido (o plano gratuito tem limite por minuto e por dia). Espere um pouco e tente de novo.');
  if (status === 413 || /too large|payload/i.test(m)) return new AIError('Pedido grande demais para a Groq. Use “Esta página” ou selecione um trecho com o laço.');
  if (status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(m)) return new AIError('Modelo não encontrado na Groq. Confira o nome do modelo em Ajustes → Inteligência artificial.');
  if (/decommission|deprecat/i.test(m)) return new AIError('Este modelo foi desligado pela Groq. Em Ajustes, use ' + GROQ_DEFAULT_MODEL + '.');
  if (/image|vision|content must be a string/i.test(m)) return new AIError('Este modelo da Groq não lê imagens. Escolha um modelo com visão, como ' + GROQ_DEFAULT_MODEL + '.');
  if (status >= 500) return new AIError('A Groq está instável agora. Tente de novo em instantes.');
  return new AIError('Erro da Groq: ' + (m || 'código ' + status).slice(0, 200));
}

export function groqBody(model, messages) {
  const body = { model, messages: toGroqMessages(messages), stream: true, max_completion_tokens: 8192, temperature: 0.4 };
  // modelos que "pensam" antes de responder: esconde o raciocínio e usa esforço médio
  if (/qwen3\.\d|gpt-oss|muse-spark|minimax/i.test(model)) { body.reasoning_format = 'hidden'; body.reasoning_effort = 'medium'; }
  return body;
}

function streamGroq(messages, onText) {
  const ctrl = new AbortController();
  const model = groqModel();
  const done = (async () => {
    let res;
    try {
      res = await fetchRetry(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.groqKey.trim()}` },
        body: JSON.stringify(groqBody(model, messages)),
        signal: ctrl.signal,
      }, ctrl.signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new AIError('Sem conexão com a Groq. Verifique a internet.');
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = j.error && j.error.message; } catch { /* sem corpo */ }
      throw groqError(res.status, msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', finish = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw groqError(0, j.error.message);
        const ch = j.choices && j.choices[0];
        const t = ch && ch.delta && ch.delta.content;
        if (t) { text += t; onText(t); }
        if (ch && ch.finish_reason) finish = ch.finish_reason;
      }
    }
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim(); // por segurança, caso venha o raciocínio
    if (!text) throw new AIError('A Groq não devolveu resposta. Tente de novo.');
    return { text, truncated: finish === 'length', message: { content: [{ type: 'text', text }] } };
  })().catch(e => {
    if (e.name === 'AbortError') { const a = new AIError('Cancelado'); a.aborted = true; throw a; }
    throw e instanceof AIError ? e : new AIError(String(e && e.message || e));
  });
  return { done, abort: () => ctrl.abort() };
}

// ======================= Gemini (Google) =======================
// Converte a conversa (formato do Claude) para o formato do Gemini (contents/parts).
export function geminiBody(messages, model = geminiModel()) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: typeof m.content === 'string'
      ? [{ text: m.content }]
      : m.content.filter(b => b.type === 'text' || b.type === 'image').map(b => (b.type === 'image'
        ? { inline_data: { mime_type: b.source.media_type, data: b.source.data } }
        : { text: b.text })),
  })).filter(c => c.parts.length);
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: {
      maxOutputTokens: 8192, temperature: 0.4,
      // Flash 3.x "pensa" muito por padrão (no teste real ficou >100 s sem responder); raciocínio baixo responde
      ...(/^gemini-(flash-latest|[3-9][\d.]*-flash)$/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  };
}

function geminiError(status, msg, reason) {
  const m = String(msg || '');
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(m + reason) || status === 401) return new AIError('Chave do Gemini inválida. Confira a chave em Ajustes → Inteligência artificial.');
  if (status === 403) return new AIError('A chave do Gemini não tem permissão para usar a API. Gere uma chave em aistudio.google.com/apikey.');
  if (status === 429) return new AIError('Limite do Gemini atingido (o plano gratuito tem limite por minuto e por dia). Espere um pouco e tente de novo.');
  if (status === 404) return new AIError('Modelo do Gemini não encontrado. Confira o nome do modelo em Ajustes → Inteligência artificial.');
  if (status === 413 || /too large|exceeds/i.test(m)) return new AIError('Pedido grande demais para o Gemini. Use “Esta página” ou selecione um trecho.');
  if (status >= 500) return new AIError('O Gemini está com muita procura agora. Tente de novo em alguns segundos.');
  return new AIError('Erro do Gemini: ' + (m || 'código ' + status).slice(0, 200));
}

const GEMINI_FIRST_BYTE_MS = 45000; // sem nenhuma resposta nesse tempo, tenta o modelo reserva

function streamGemini(messages, onText) {
  const ctrl = new AbortController();
  const key = settings.geminiKey.trim();

  // Uma tentativa num modelo: devolve o texto ou lança erro. 'retryable' = vale tentar o reserva.
  async function attempt(model) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctrl.signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, GEMINI_FIRST_BYTE_MS);
    const fail = (err, retryable) => { err.retryable = retryable; return err; };
    try {
      let res;
      try {
        res = await fetchRetry(GEMINI_URL(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(geminiBody(messages, model)),
          signal: ac.signal,
        }, ac.signal);
      } catch (e) {
        if (timedOut) throw fail(new AIError('O Gemini demorou demais para responder. Tente de novo.'), true);
        if (e.name === 'AbortError') throw e;
        throw new AIError('Sem conexão com o Gemini. Verifique a internet.');
      }
      if (!res.ok) {
        let msg = '', reason = '';
        try { const j = await res.json(); const er = Array.isArray(j) ? j[0].error : j.error; msg = er && er.message; reason = JSON.stringify(er && er.details || ''); } catch { /* sem corpo */ }
        throw fail(geminiError(res.status, msg, reason), [404, 500, 502, 503, 504].includes(res.status));
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
            if (part.text && !part.thought) { text += part.text; onText(part.text); }
          }
          if (c.finishReason) finish = c.finishReason;
        }
      }
      if (!text) {
        if (blocked || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw new AIError('O Gemini não respondeu a este pedido por segurança. Tente reformular.');
        throw fail(new AIError('O Gemini não devolveu resposta. Tente de novo.'), true);
      }
      return { text, truncated: finish === 'MAX_TOKENS', message: { content: [{ type: 'text', text }] } };
    } finally {
      clearTimeout(timer);
      ctrl.signal.removeEventListener('abort', onAbort);
    }
  }

  const done = (async () => {
    const model = geminiModel();
    try { return await attempt(model); }
    catch (e) {
      // modelo sobrecarregado, lento demais, desligado ou inexistente: usa o modelo reserva
      if (e.retryable && model !== GEMINI_FALLBACK && !ctrl.signal.aborted) return attempt(GEMINI_FALLBACK);
      throw e;
    }
  })().catch(e => {
    if (e.name === 'AbortError') { const a = new AIError('Cancelado'); a.aborted = true; throw a; }
    throw e instanceof AIError ? e : new AIError(String(e && e.message || e));
  });
  return { done, abort: () => ctrl.abort() };
}
