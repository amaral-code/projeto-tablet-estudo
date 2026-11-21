// Teste REAL da IA (Gemini rapidão): usa o próprio código do app e a API de verdade do Google.
// Como rodar:  GEMINI_API_KEY=sua_chave node tests/teste-gemini-real.cjs
// A chave NÃO é gravada em nenhum arquivo: fica só na memória e vai no pedido.
// Opcional: com o espeak-ng instalado, uma "aula falada" é gravada pelo microfone simulado
// e o Gemini resume, transcreve e tira as tarefas do áudio (como no tablet).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Defina GEMINI_API_KEY'); process.exit(2); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-real-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

// pedido direto (curl): a chave vai pela entrada padrão, nunca em arquivo nem na lista de processos
// pedido direto (como o app faz): tenta de novo quando o Google responde "sobrecarregado" (5xx), igual ao app
function gemini(model, body) {
  let r;
  for (let a = 0; a < 3; a++) {
    r = geminiOnce(model, body);
    if (!(r.err && r.err.code >= 500)) break;
    execFileSync('sleep', [String(a + 1)]);
  }
  return r;
}
function geminiOnce(model, body) {
  const f = path.join(TMP, 'body.json');
  fs.writeFileSync(f, JSON.stringify(body));
  const t0 = Date.now();
  try {
    const raw = execFileSync('curl', ['-sS', '-N', '-m', '150', `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, '-H', '@-', '--data-binary', `@${f}`],
      { encoding: 'utf8', maxBuffer: 20e6, input: `x-goog-api-key: ${KEY}\nContent-Type: application/json\n` });
    return { ...readSSE(raw), secs: (Date.now() - t0) / 1000 };
  } finally { fs.rmSync(f, { force: true }); }
}
function readSSE(raw) {
  let text = '', finish = null, err = null, version = null;
  for (const line of raw.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('data:')) continue;
    let j; try { j = JSON.parse(l.slice(5).trim()); } catch { continue; }
    if (j.error) err = j.error;
    version = j.modelVersion || version;
    const c = j.candidates && j.candidates[0];
    for (const p of (c && c.content && c.content.parts) || []) if (p.text && !p.thought) text += p.text;
    if (c && c.finishReason) finish = c.finishReason;
  }
  if (!text && !err && /^[{[]/.test(raw.trim())) { try { const j = JSON.parse(raw); err = (Array.isArray(j) ? j[0] : j).error || err; } catch { /* */ } }
  return { text, finish, err, version };
}
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
// "aula falada" para o microfone simulado (precisa do espeak-ng e do ffmpeg)
function lessonAudio() {
  const fala = 'Bom dia, turma. Hoje vamos estudar a fotossíntese. As plantas usam a luz do sol, a água e o gás carbônico para produzir glicose, e liberam oxigênio. ' +
    'Isso acontece nos cloroplastos, por causa da clorofila. Tarefa para casa: fazer os exercícios da página quarenta e dois. A prova será na próxima sexta-feira.';
  try {
    const raw = path.join(TMP, 'fala.wav'), wav = path.join(TMP, 'aula.wav');
    execFileSync('espeak-ng', ['-v', 'pt-br', '-s', '140', '-w', raw, fala], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const secs = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
    return { wav, secs };
  } catch { return null; }
}

(async () => {
  const results = [];
  const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;

  // 1) monta os pedidos com o código do app
  let browser = await chromium.launch();
  let page = await browser.newPage();
  await page.goto(base); await page.waitForTimeout(1200);
  const built = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const T = (y, text, size = 34) => ({ id: 't' + y, x: 110, y, text, size, color: '#1d1d1f' });
    const pg = { id: 'p1', strokes: [], images: [], texts: [T(80, 'Frações — aula de 20/11', 40), T(160, 'Fração é uma parte de um inteiro.'), T(240, 'Exercício: 3/4 + 1/4 = 2'), T(320, 'Numerador fica embaixo.')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Frações', folder: 'Matemática', prompt: ai.ACTIONS.explain.prompt });
    const ping = [{ role: 'user', content: 'Responda apenas: Tudo certo!' }];
    return {
      model: ai.GEMINI_MODEL, fallback: ai.GEMINI_FALLBACK, last: ai.GEMINI_LAST, lastBody: ai.geminiBody(ping, ai.GEMINI_LAST),
      body: ai.geminiBody([{ role: 'user', content }]),
      textBody: ai.geminiBody(ping), fallbackBody: ai.geminiBody(ping, ai.GEMINI_FALLBACK),
      chatBody: ai.geminiBody([{ role: 'user', content: 'Meu nome é Ana. Responda só: ok' }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, { role: 'user', content: 'Qual é o meu nome? Responda só o nome.' }]),
    };
  });
  await browser.close();
  console.log(`\nTeste real do Gemini rapidão — principal: ${built.model} · reservas: ${built.fallback}, ${built.last}\n`);

  // 2) direto na API
  const t1 = gemini(built.model, built.textBody);
  ok('modelo principal: chave aceita e resposta em streaming', !t1.err && /tudo certo/i.test(t1.text), t1.err ? `${t1.err.code} ${t1.err.message}` : `${JSON.stringify(t1.text.trim())} em ${t1.secs.toFixed(1)}s (${t1.version})`);
  if (t1.err) return finish(results);
  const tf = gemini(built.fallback, built.fallbackBody);
  ok('modelo reserva também responde', !tf.err && /tudo certo/i.test(tf.text), tf.err ? `${tf.err.code} ${tf.err.message}` : `${tf.secs.toFixed(1)}s (${tf.version})`);
  const tl = gemini(built.last, built.lastBody);
  ok('terceiro modelo (último recurso) também responde', !tl.err && /tudo certo/i.test(tl.text), tl.err ? `${tl.err.code} ${tl.err.message}` : `${tl.secs.toFixed(1)}s (${tl.version})`);
  const t3 = gemini(built.model, built.chatBody);
  ok('conversa com histórico (lembra o nome)', !t3.err && /ana/i.test(t3.text), t3.err ? t3.err.message : JSON.stringify(t3.text.trim()));
  const t2 = gemini(built.model, built.body);
  ok('pedido com a imagem da página aceito', !t2.err && t2.text.length > 50, t2.err ? `${t2.err.code} ${t2.err.message}` : `${t2.text.length} caracteres em ${t2.secs.toFixed(1)}s`);
  ok('a IA leu a página (fala de frações)', /fra[cç]/i.test(t2.text));
  ok('a IA achou o erro da conta (3/4 + 1/4 = 1)', /(=|é|resulta em|igual a|dá)\s*\**\s*1\b|4\/4|um inteiro/i.test(t2.text));
  ok('a IA corrigiu "numerador fica embaixo"', /numerador[^.\n]*(em )?cima|denominador[^.\n]*(em )?baixo/i.test(t2.text));
  ok('resposta completa (não foi cortada)', t2.finish === 'STOP', String(t2.finish));

  // 3) o app no navegador chama o Gemini (CORS, streaming, JSON do simulado)
  console.log('\nO app no navegador (como no tablet):');
  const audio = lessonAudio();
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (audio) args.push(`--use-file-for-fake-audio-capture=${audio.wav}`);
  browser = await chromium.launch({ args, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'], locale: 'pt-BR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); } catch { /* */ } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForTimeout(1500);
  // a chave fica só na memória desta página de teste
  await page.evaluate(async key => { (await import('./js/store.js')).settings.geminiKey = key; }, KEY);

  // o app tem a "corrida": se o principal demorar, o reserva entra junto (por isso a resposta não passa de ~7 s)
  const pings = [];
  for (let i = 0; i < 3; i++) {
    pings.push(await page.evaluate(async () => {
      const ai = await import('./js/ai.js');
      const t0 = performance.now(); let txt = '';
      try { const res = await ai.streamChat([{ role: 'user', content: 'Responda apenas: Tudo certo!' }], t => { txt += t; }).done; return { ok: /tudo certo/i.test(txt), secs: (performance.now() - t0) / 1000, model: res.model }; }
      catch (e) { return { ok: false, err: e.message, secs: (performance.now() - t0) / 1000 }; }
    }));
  }
  ok('rapidão no app: 3 respostas, cada uma em menos de 8 s', pings.every(p => p.ok && p.secs < 8), pings.map(p => p.ok ? `${p.secs.toFixed(1)}s (${p.model === built.model ? 'principal' : 'reserva'})` : p.err).join(' · '));

  // os dois primeiros modelos "sem cota" (429 simulado): o app tem que cair no terceiro de verdade
  const semCota = u => /models\/(gemini-flash-lite-latest|gemini-3\.1-flash-lite):/.test(u.href);
  await page.route(semCota, r => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) }));
  const last = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const t0 = performance.now(); let txt = '';
    try { const res = await ai.streamChat([{ role: 'user', content: 'Responda apenas: Tudo certo!' }], t => { txt += t; }).done; return { ok: /tudo certo/i.test(txt), model: res.model, secs: (performance.now() - t0) / 1000 }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  await page.unroute(semCota);
  ok('sem cota nos dois primeiros: o app responde pelo terceiro modelo', last.ok && last.model === built.last, last.ok ? `${last.secs.toFixed(1)}s (${last.model})` : last.err);

  const r = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const T = (y, text) => ({ id: 't' + y, x: 110, y, text, size: 34, color: '#1d1d1f' });
    const pg = { id: 'p', strokes: [], images: [], texts: [T(120, 'Verbo to be'), T(200, 'I is happy'), T(280, 'She are my friend')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Inglês', prompt: ai.ACTIONS.improve.prompt });
    const t0 = performance.now(); let chunks = 0, first = 0;
    try {
      const s = ai.streamChat([{ role: 'user', content }], () => { if (!chunks++) first = performance.now() - t0; });
      const res = await s.done;
      return { ok: true, text: res.text, chunks, first: (first / 1000).toFixed(1), secs: ((performance.now() - t0) / 1000).toFixed(1) };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  ok('melhorar a escrita: resposta em streaming', r.ok && r.chunks >= 1, r.ok ? `1º pedaço em ${r.first}s, total ${r.secs}s` : r.err);
  if (r.ok) ok('corrigiu "I is" → "I am" e "She are" → "She is"', /I am/.test(r.text) && /She is/i.test(r.text));

  const qz = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const quiz = await import('./js/quiz.js');
    const T = (y, text) => ({ id: 't' + y, x: 110, y, text, size: 30, color: '#1d1d1f' });
    const pg = { id: 'p', strokes: [], images: [], texts: [T(100, 'Fotossíntese'), T(160, 'Plantas produzem glicose usando luz,'), T(200, 'água e gás carbônico. Libera oxigênio.'), T(260, 'Acontece nos cloroplastos (clorofila).')] };
    const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Ciências', prompt: quiz.quizPrompt(5, 'medio') });
    const t0 = performance.now();
    try {
      const res = await ai.streamChat([{ role: 'user', content }], () => {}, { json: true }).done;
      const qs = quiz.parseQuiz(res.text);
      return { ok: true, n: qs.length, first: qs[0], secs: ((performance.now() - t0) / 1000).toFixed(1) };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  ok('simulado: perguntas válidas em JSON', qz.ok && qz.n >= 4, qz.ok ? `${qz.n} perguntas em ${qz.secs}s` : qz.err);
  if (qz.ok && qz.first) ok('simulado: pergunta sobre o conteúdo da página', /fotoss|glicose|clorof|oxig|luz|cloroplast/i.test(qz.first.q + qz.first.opts.join(' ')), qz.first.q);

  // recursos novos que usam a IA
  console.log('\nRecursos novos (ENEM, mapa mental, plano, tradutor, caderno de erros):');
  const nv = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const quiz = await import('./js/quiz.js');
    const tpl = await import('./js/templates.js');
    const plan = await import('./js/plan.js');
    const tools = await import('./js/tools.js');
    const errs = await import('./js/errors.js');
    const out = {};
    const time = async (k, fn) => { const t0 = performance.now(); try { out[k] = await fn(); out[k + '_s'] = ((performance.now() - t0) / 1000).toFixed(1); } catch (e) { out[k + '_err'] = e.message; } };
    await time('enem', async () => { const r = await ai.streamChat([{ role: 'user', content: quiz.enemPrompt(5, 'natureza', 'ecologia') }], () => {}, { json: true, maxTokens: 16000 }).done; const qs = quiz.parseQuiz(r.text); return { n: qs.length, five: qs.every(q => q.opts.length === 5), base: qs.filter(q => q.base).length, ex: qs.filter(q => q.ex).length, q0: qs[0] && qs[0].q }; });
    const T = (y, text) => ({ id: 't' + y, x: 110, y, text, size: 30, color: '#1d1d1f' });
    const pg = { id: 'p', strokes: [], images: [], texts: [T(100, 'Frações'), T(160, 'Numerador em cima, denominador embaixo.'), T(220, 'Para somar, o denominador precisa ser igual.'), T(280, '1/2 = 2/4 (frações equivalentes)')] };
    await time('mind', async () => { const content = await ai.buildContent({ pages: [pg], bg: { type: 'lines', color: 'white' }, title: 'Frações', prompt: tpl.MINDMAP_PROMPT }); const r = await ai.streamChat([{ role: 'user', content }], () => {}, { json: true }).done; const t = tpl.parseMindMap(r.text); return t ? { centro: t.centro, ramos: t.ramos.length } : null; });
    await time('topics', async () => { const txt = await ai.askGemini(plan.topicsPrompt('prova bimestral', ['Matemática', 'História']), { json: true }); const o = plan.parseTopics(txt); return { mat: (o['Matemática'] || []).length, hist: (o['História'] || []).length }; });
    await time('tr', async () => { let t = ''; await ai.streamChat([{ role: 'user', content: tools.translatePrompt('I have been studying for two hours.', 'en') }], x => { t += x; }).done; return t; });
    await time('err', async () => { let t = ''; await ai.streamChat([{ role: 'user', content: errs.errorPrompt({ q: 'Quanto é 3/4 + 1/4?', opts: ['1', '4/8', '3/16', '2'], c: 0, answer: '1', mine: '4/8' }) }], x => { t += x; }).done; return t; });
    return out;
  });
  const ar = await page.evaluate(async () => {
    const ai = await import('./js/ai.js');
    const archie = await import('./js/archie.js');
    const d = new Date(Date.now() + 86400000); const amanha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t0 = performance.now();
    try {
      const msgs = [{ role: 'user', content: `RESUMO DO APP (dados atuais do estudante):\n${archie.snapshot()}` }, { role: 'assistant', content: [{ type: 'text', text: '{"resposta":"Entendido.","humor":"feliz","acoes":[]}' }] },
        { role: 'user', content: 'Archie, cria uma tarefa para amanhã: revisar frações. É prioridade alta.' }];
      const r = await ai.streamChat(msgs, () => {}, { system: archie.systemPrompt(), json: true }).done;
      const p = archie.parseArchie(r.text);
      const t = p.acoes.find(a => a.tipo === 'criar_tarefa');
      return { secs: ((performance.now() - t0) / 1000).toFixed(1), resposta: p.resposta, tarefa: t, amanha };
    } catch (e) { return { err: e.message }; }
  });
  ok('Archie entende o pedido e devolve a ação de criar tarefa (com a data de amanhã)', ar.tarefa && /fra[cç]/i.test(ar.tarefa.titulo) && ar.tarefa.prazo === ar.amanha && +ar.tarefa.prioridade === 3, ar.err || `${ar.secs}s: "${String(ar.resposta).slice(0, 80)}" · ${JSON.stringify(ar.tarefa)}`);
  ok('simulado ENEM: 5 questões com 5 alternativas, texto-base e gabarito comentado', nv.enem && nv.enem.n >= 4 && nv.enem.five && nv.enem.base >= 4 && nv.enem.ex >= 4, nv.enem ? `${nv.enem.n} questões em ${nv.enem_s}s · "${String(nv.enem.q0).slice(0, 70)}"` : nv.enem_err);
  ok('mapa mental: JSON com tema e ramos', nv.mind && nv.mind.ramos >= 3, nv.mind ? `"${nv.mind.centro}" com ${nv.mind.ramos} ramos em ${nv.mind_s}s` : nv.mind_err || 'não entendi o JSON');
  ok('plano de estudos: a IA sugere assuntos por matéria', nv.topics && nv.topics.mat >= 3 && nv.topics.hist >= 3, nv.topics ? `Matemática ${nv.topics.mat}, História ${nv.topics.hist} em ${nv.topics_s}s` : nv.topics_err);
  ok('tradutor: inglês → português com palavras importantes', nv.tr && /estud/i.test(nv.tr) && /hora/i.test(nv.tr), nv.tr ? `${nv.tr_s}s: ${JSON.stringify(nv.tr.split('\n')[0].slice(0, 80))}` : nv.tr_err);
  ok('caderno de erros: a IA explica o erro (3/4 + 1/4 = 1)', nv.err && /\b1\b|um inteiro|4\/4/.test(nv.err), nv.err ? `${nv.err_s}s` : nv.err_err);

  // 4) Tutor IA de verdade: foto de um exercício
  console.log('\nTutor IA com foto do exercício:');
  const shot = await ctx.newPage();
  await shot.setContent('<div style="font:44px Georgia;padding:40px;background:#fff;width:720px">Exercício 3<br>Resolva a equação:<br><b>2x + 3 = 11</b></div>');
  const photo = path.join(TMP, 'exercicio.png');
  await shot.locator('div').screenshot({ path: photo }); await shot.close();
  await page.click('#nav-main [data-k=tutor]'); await page.waitForTimeout(400);
  await page.setInputFiles('#tt-file', photo); await page.waitForSelector('#tt-attach img');
  let t0 = Date.now();
  await page.click('#tt-send');
  await page.waitForSelector('.tt-msg.bot:not(.streaming) .tt-acts, .tt-msg.error', { timeout: 90000 });
  const tutor = await page.textContent('.tt-msg.bot, .tt-msg.error');
  ok('tutor leu a foto e resolveu: x = 4', /x\s*=\s*4/.test(tutor), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  ok('tutor explicou passo a passo (subtrair 3, dividir por 2)', /8/.test(tutor) && /2/.test(tutor));
  // (se o aluno pedir "só a resposta", o tutor prefere guiar o caminho, de propósito; aqui pedimos para resolver)
  await page.fill('#tt-q', 'E se fosse 2x + 3 = 15? Resolva também.'); await page.press('#tt-q', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.tt-msg.bot:not(.streaming) .tt-acts').length === 2 || document.querySelector('.tt-msg.error'), null, { timeout: 60000 });
  const tutor2 = await page.textContent('.tt-msg.bot >> nth=1').catch(() => '');
  ok('tutor continua a conversa (2x = 12, x = 6)', /x\s*=\s*6\b/.test(tutor2) && /12/.test(tutor2), JSON.stringify(tutor2.replace(/\s+/g, ' ').trim().slice(0, 90)));

  // 5) Gravador de aula + resumo/transcrição/tarefas do áudio
  if (!audio) console.log('\n(gravação de aula pulada: instale espeak-ng e ffmpeg para testar o áudio)');
  else {
    console.log(`\nGravador de aula (aula falada de ${audio.secs.toFixed(0)} s no microfone simulado):`);
    await page.click('#nav-main [data-k=today]'); await page.waitForTimeout(300); // no Tutor o + fica escondido
    await page.click('#fab'); await page.click('.quick[data-q=record]');
    await page.waitForSelector('#rec-pill:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(Math.ceil(audio.secs * 1000) + 1500);
    await page.click('#rec-pill');
    await page.waitForFunction(() => /Gravação salva/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 10000 });
    await page.click('#ed-recs'); await page.waitForSelector('.rc-item audio');
    const runAI = async (kind, before) => {
      const t = Date.now();
      await page.click(`.rc-item [data-ai=${kind}]`);
      await page.waitForSelector('#rc-acts .btn, #rc-out.error', { timeout: 150000 });
      const out = await page.textContent('#rc-out');
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      if (before) await before();
      await page.evaluate(() => { const all = document.querySelectorAll('.modal-back'); all[all.length - 1]._close(true); });
      await page.waitForTimeout(300);
      return { out, secs };
    };
    const sum = await runAI('summary');
    ok('resumo da aula gravada', /fotoss/i.test(sum.out) && /glicose|oxig|clorof/i.test(sum.out), `${sum.secs}s`);
    ok('o resumo avisou da prova e da tarefa', /sexta|prova/i.test(sum.out) && /42|quarenta e dois|exerc/i.test(sum.out));
    const tr = await runAI('transcript');
    ok('transcrição do áudio', /fotoss[ií]ntese/i.test(tr.out) && /plantas/i.test(tr.out), `${tr.secs}s: ${JSON.stringify(tr.out.trim().slice(0, 90))}…`);
    let created = [];
    const tk = await runAI('tasks', async () => {
      await page.click('#rc-acts .btn:has-text("Criar estas tarefas")'); await page.waitForTimeout(600);
      created = await page.evaluate(async () => (await (await import('./js/store.js')).db.all('tasks')).filter(t => t.notes === 'Da gravação da aula').map(t => t.title));
    });
    ok('tarefas e datas tiradas da aula', /42|quarenta e dois/i.test(tk.out) && /sexta|prova/i.test(tk.out), JSON.stringify(tk.out.trim().slice(0, 120)));
    ok('"Criar estas tarefas" cria só os itens da lista', created.length >= 1 && created.length <= 6 && created.every(t => !t.startsWith('#')) && created.some(t => /42|quarenta e dois/.test(t)), created.join(' | '));
    if (sum.out) console.log('\n--- resumo da aula (início) ---\n' + sum.out.slice(0, 600) + '\n---');
  }
  ok('nenhum erro de JavaScript na página', !errors.length, errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  finish(results);
})().catch(e => { console.error(e); process.exit(2); });

function finish(r) {
  fs.rmSync(TMP, { recursive: true, force: true });
  const n = r.filter(Boolean).length;
  console.log(`\n${n} de ${r.length} verificações passaram.\n`);
  process.exit(n === r.length ? 0 : 1);
}
