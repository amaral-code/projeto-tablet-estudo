// Teste REAL da IA pelo Gemini (Google): monta o pedido com o próprio código do app
// (página do caderno renderizada como imagem) e envia para a API do Gemini.
// Como rodar:  GEMINI_API_KEY=sua_chave node tests/teste-gemini-real.cjs [modelo]
// A chave NÃO fica salva em nenhum arquivo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Defina GEMINI_API_KEY'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function gemini(model, body) {
  const f = path.join(require('os').tmpdir(), `gemini-body-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  // a chave vai num arquivo de cabeçalho temporário para não aparecer na lista de processos
  const hf = path.join(require('os').tmpdir(), `gemini-h-${process.pid}.txt`);
  fs.writeFileSync(hf, `x-goog-api-key: ${KEY}\nContent-Type: application/json\n`, { mode: 0o600 });
  try {
    return execFileSync('curl', ['-sS', '-N', '-m', '150', `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, '-H', `@${hf}`, '--data-binary', `@${f}`], { encoding: 'utf8', maxBuffer: 20e6 });
  } finally { fs.rmSync(hf, { force: true }); fs.rmSync(f, { force: true }); }
}
function readSSE(raw) {
  let text = '', finish = null, err = null, version = null;
  for (const line of raw.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('data:')) { if (l.startsWith('{') || l.startsWith('[')) { try { const j = JSON.parse(raw); err = (Array.isArray(j) ? j[0] : j).error; } catch { /* */ } } continue; }
    const j = JSON.parse(l.slice(5).trim());
    if (j.error) err = j.error;
    version = j.modelVersion || version;
    const c = j.candidates && j.candidates[0];
    for (const p of (c && c.content && c.content.parts) || []) if (p.text && !p.thought) text += p.text;
    if (c && c.finishReason) finish = c.finishReason;
  }
  if (!text && !err && raw.trim().startsWith('{')) { try { err = JSON.parse(raw).error; } catch { /* */ } }
  return { text, finish, err, version };
}

(async () => {
  const results = [];
  const ok = (name, cond, extra = '') => { results.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/`); await page.waitForTimeout(1200);
  const built = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const st = await import('./js/store.js');
    st.settings.aiProvider = 'gemini';
    const T = (y, text, size = 34) => ({ id: 't' + y, x: 110, y, text, size, color: '#1d1d1f' });
    const pg = { id: 'p1', strokes: [], images: [], texts: [T(80, 'Frações — aula de 20/11', 40), T(160, 'Fração é uma parte de um inteiro.'), T(240, 'Exercício: 3/4 + 1/4 = 2'), T(320, 'Numerador fica embaixo.')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Frações', folder: 'Matemática', prompt: ai.ACTIONS.explain.prompt });
    return {
      model: ai.geminiModel(),
      body: ai.geminiBody([{ role: 'user', content }]),
      textBody: ai.geminiBody([{ role: 'user', content: 'Responda apenas: Tudo certo!' }]),
      chatBody: ai.geminiBody([{ role: 'user', content: 'Meu nome é Ana. Responda só: ok' }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, { role: 'user', content: 'Qual é o meu nome? Responda só o nome.' }]),
    };
  });
  await browser.close(); srv.close();
  const model = process.argv[2] || built.model;
  console.log(`\nTeste real do Gemini — modelo ${model}\n`);

  let t0 = Date.now();
  const t1 = readSSE(gemini(model, built.textBody));
  ok('chave aceita e resposta de texto em streaming', !t1.err && /tudo certo/i.test(t1.text), t1.err ? `${t1.err.code} ${t1.err.message}` : `${JSON.stringify(t1.text.trim())} em ${((Date.now() - t0) / 1000).toFixed(1)}s (${t1.version})`);
  if (t1.err) return finish(results);

  t0 = Date.now();
  const t3 = readSSE(gemini(model, built.chatBody));
  ok('conversa com histórico (lembra o nome)', !t3.err && /ana/i.test(t3.text), t3.err ? t3.err.message : JSON.stringify(t3.text.trim()));

  t0 = Date.now();
  const t2 = readSSE(gemini(model, built.body));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok('pedido com a imagem da página aceito', !t2.err && t2.text.length > 50, t2.err ? `${t2.err.code} ${t2.err.message}` : `${t2.text.length} caracteres em ${secs}s`);
  ok('a IA leu a página (fala de frações)', /fra[cç]/i.test(t2.text));
  ok('a IA achou o erro da conta (3/4 + 1/4 = 1)', /(=|é|resulta em|igual a)\s*\**\s*1\b|4\/4|um inteiro/i.test(t2.text));
  ok('a IA corrigiu "numerador fica embaixo"', /numerador[^.\n]*(em )?cima|denominador[^.\n]*(em )?baixo/i.test(t2.text));
  ok('resposta completa (não foi cortada)', t2.finish === 'STOP', String(t2.finish));
  if (t2.text) console.log('\n--- resposta da IA (início) ---\n' + t2.text.slice(0, 900) + '\n---');

  // 5) De ponta a ponta: o próprio app, dentro do navegador, chama o Gemini (confere CORS e streaming)
  console.log('\nNo navegador (como no tablet):');
  const srv2 = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv2.listen(0, '127.0.0.1', r));
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const b2 = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {});
  const p2 = await b2.newPage();
  await p2.goto(`http://127.0.0.1:${srv2.address().port}/`); await p2.waitForTimeout(1200);
  for (const m of [process.argv[2] || '', 'gemini-flash-latest']) {
    const r = await p2.evaluate(async ({ key, m }) => {
      const ai = await import('./js/ai.js');
      const st = await import('./js/store.js');
      Object.assign(st.settings, { aiProvider: 'gemini', geminiKey: key, geminiModel: m }); // só na memória, não é salvo
      const T = (y, text) => ({ id: 't' + y, x: 110, y, text, size: 34, color: '#1d1d1f' });
      const pg = { id: 'p', strokes: [], images: [], texts: [T(120, 'Verbo to be'), T(200, 'I is happy'), T(280, 'She are my friend')] };
      const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Inglês', prompt: ai.ACTIONS.improve.prompt });
      const t0 = performance.now(); let chunks = 0;
      try {
        const s = ai.streamChat([{ role: 'user', content }], () => { chunks++; });
        const res = await s.done;
        return { ok: true, text: res.text, chunks, secs: ((performance.now() - t0) / 1000).toFixed(1) };
      } catch (e) { return { ok: false, err: e.message, secs: ((performance.now() - t0) / 1000).toFixed(1) }; }
    }, { key: KEY, m });
    const label = m || 'padrão do app';
    ok(`app no navegador com ${label}: resposta em streaming`, r.ok && r.chunks >= 1, r.ok ? `${r.chunks} pedaços, ${r.secs}s` : `${r.err} (${r.secs}s)`);
    if (r.ok) ok(`app no navegador com ${label}: corrigiu "I is" → "I am" e "She are" → "She is"`, /I am/.test(r.text) && /She is/i.test(r.text));
  }
  // Simulado: a IA precisa devolver as perguntas no formato certo (JSON)
  const qz = await p2.evaluate(async key => {
    const ai = await import('./js/ai.js');
    const st = await import('./js/store.js');
    const quiz = await import('./js/quiz.js');
    Object.assign(st.settings, { aiProvider: 'gemini', geminiKey: key, geminiModel: '' });
    const T = (y, text) => ({ id: 't' + y, x: 110, y, text, size: 30, color: '#1d1d1f' });
    const pg = { id: 'p', strokes: [], images: [], texts: [T(100, 'Fotossíntese'), T(160, 'Plantas produzem glicose usando luz,'), T(200, 'água e gás carbônico. Libera oxigênio.'), T(260, 'Acontece nos cloroplastos (clorofila).')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Ciências', prompt: quiz.quizPrompt(5, 'medio') });
    const t0 = performance.now();
    try {
      const r = await ai.streamChat([{ role: 'user', content }], () => {}).done;
      const qs = quiz.parseQuiz(r.text);
      return { ok: true, n: qs.length, first: qs[0], secs: ((performance.now() - t0) / 1000).toFixed(1) };
    } catch (e) { return { ok: false, err: e.message }; }
  }, KEY);
  ok('simulado: a IA devolveu perguntas válidas', qz.ok && qz.n >= 4, qz.ok ? `${qz.n} perguntas em ${qz.secs}s` : qz.err);
  if (qz.ok && qz.first) {
    ok('simulado: pergunta sobre o conteúdo da página', /fotoss|glicose|clorof|oxig|luz|cloroplast/i.test(qz.first.q + qz.first.opts.join(' ')));
    console.log(`     exemplo: ${qz.first.q}\n       ${qz.first.opts.map((o, i) => (i === qz.first.c ? '✓ ' : '  ') + o).join('\n       ')}`);
  }
  await b2.close(); srv2.close();
  finish(results);
})().catch(e => { console.error(e); process.exit(2); });

function finish(r) {
  const n = r.filter(Boolean).length;
  console.log(`\n${n} de ${r.length} verificações passaram.\n`);
  process.exit(n === r.length ? 0 : 1);
}
