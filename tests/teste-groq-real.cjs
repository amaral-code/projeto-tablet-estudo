// Teste REAL da IA pela Groq: monta o pedido com o próprio código do app
// (página do caderno renderizada como imagem) e envia para api.groq.com.
// Como rodar:  GROQ_API_KEY=gsk_... node tests/teste-groq-real.cjs
// (num ambiente que injeta a chave sozinho, rode sem a variável.)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const KEY = process.env.GROQ_API_KEY || 'proxy-injected';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function groq(pathname, body) {
  const args = ['-sS', '-N', '-m', '90', `https://api.groq.com/openai/v1/${pathname}`, '-H', `Authorization: Bearer ${KEY}`];
  if (body) {
    const f = path.join(require('os').tmpdir(), `groq-body-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${f}`);
  }
  return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 20e6 });
}
function readSSE(raw) {
  let text = '', finish = null, err = null;
  for (const line of raw.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('data:')) { if (l.startsWith('{')) { try { err = JSON.parse(l).error; } catch { /* */ } } continue; }
    const d = l.slice(5).trim(); if (!d || d === '[DONE]') continue;
    const j = JSON.parse(d);
    if (j.error) err = j.error;
    const c = j.choices && j.choices[0];
    if (c && c.delta && c.delta.content) text += c.delta.content;
    if (c && c.finish_reason) finish = c.finish_reason;
  }
  return { text, finish, err };
}

(async () => {
  const results = [];
  const ok = (name, cond, extra = '') => { results.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };
  console.log('\nTeste real da Groq\n');

  // 1) chave e modelos
  let models = [];
  try {
    const r = JSON.parse(groq('models'));
    if (r.error) { ok('chave aceita pela Groq', false, r.error.message); return finish(results); }
    models = r.data.map(m => m.id);
    ok('chave aceita pela Groq', true, `${models.length} modelos disponíveis`);
  } catch (e) { ok('conexão com api.groq.com', false, e.message.split('\n')[0]); return finish(results); }

  // 2) monta o pedido com o código do app
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
    st.settings.aiProvider = 'groq';
    const T = (y, text, size = 34) => ({ id: 't' + y, x: 110, y, text, size, color: '#1d1d1f' });
    const pg = { id: 'p1', strokes: [], images: [], texts: [T(80, 'Frações — aula de 20/11', 40), T(160, 'Fração é uma parte de um inteiro.'), T(240, 'Exercício: 3/4 + 1/4 = 2'), T(320, 'Numerador fica embaixo.')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Frações', folder: 'Matemática', prompt: ai.ACTIONS.explain.prompt });
    const model = ai.groqModel();
    return { model, body: ai.groqBody(model, [{ role: 'user', content }]), textBody: ai.groqBody(model, [{ role: 'user', content: 'Responda apenas: Tudo certo!' }]) };
  });
  await browser.close(); srv.close();

  ok(`modelo padrão do app existe na conta (${built.model})`, models.includes(built.model), models.includes(built.model) ? '' : 'disponíveis: ' + models.filter(m => /qwen|muse|gpt-oss/.test(m)).join(', '));

  // 3) pedido só de texto (Testar)
  const t1 = readSSE(groq('chat/completions', built.textBody));
  ok('pedido de texto com streaming', !t1.err && /tudo certo/i.test(t1.text), t1.err ? t1.err.message : JSON.stringify(t1.text.slice(0, 60)));

  // 4) pedido com a imagem da página (como o botão IA faz)
  const t0 = Date.now();
  const t2 = readSSE(groq('chat/completions', built.body));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok('pedido com imagem da página aceito', !t2.err && t2.text.length > 50, t2.err ? t2.err.message : `${t2.text.length} caracteres em ${secs}s`);
  ok('a IA leu a página (cita frações)', /fra[cç]/i.test(t2.text));
  ok('a IA achou o erro da conta (3/4 + 1/4 = 1)', /\b1\b|um inteiro|= ?1/i.test(t2.text));
  ok('a IA corrigiu "numerador fica embaixo"', /numerador[^.]*(cima|em cima)|denominador[^.]*(baixo)/i.test(t2.text));
  ok('sem raciocínio interno na resposta', !/<think>/i.test(t2.text));
  if (t2.text) console.log('\n--- resposta da IA (início) ---\n' + t2.text.slice(0, 700) + '\n---');
  finish(results);
})().catch(e => { console.error(e); process.exit(2); });

function finish(r) {
  const n = r.filter(Boolean).length;
  console.log(`\n${n} de ${r.length} verificações passaram.\n`);
  process.exit(n === r.length ? 0 : 1);
}
