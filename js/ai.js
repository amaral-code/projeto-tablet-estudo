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

export function aiConfigured() { return !!(settings.aiKey && settings.aiKey.trim()); }

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
  const k = Math.min(3, 1100 / Math.max(r.w, r.h * 0.75));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
  renderPage(ctx, page, bg);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: canvasToB64(c) } };
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
