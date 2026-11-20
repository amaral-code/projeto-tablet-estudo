// Teste completo do Caderno de Estudos: usa o app de verdade num navegador (Chromium),
// passando por todas as funções e conferindo os dados salvos.
// Como rodar:  npm i -D playwright && npx playwright install chromium && node tests/teste-completo.cjs
// Os serviços externos (reconhecimento de escrita do Google e a IA Gemini) são simulados; o microfone é falso.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SAIDA || path.join(require('os').tmpdir(), 'caderno-teste');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

const results = [];
let page, ctx, browser, base, errors = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: String(e && e.message || e).split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${String(e && e.message || e).split('\n')[0]}`);
    try { await page.screenshot({ path: path.join(OUT, `falha-${results.length}.png`) }); } catch { /* */ }
    try { await page.keyboard.press('Escape'); await closeModals(); } catch { /* */ }
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const wait = ms => page.waitForTimeout(ms);
async function closeModals() {
  for (let i = 0; i < 4; i++) {
    const n = await page.locator('.modal-back').count();
    if (!n) return;
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close ? m._close() : m.remove()));
    await wait(250);
  }
}
async function idb(store) {
  return page.evaluate(store => new Promise((res, rej) => {
    const r = indexedDB.open('caderno-estudos');
    r.onsuccess = () => { const d = r.result; const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); d.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  }), store);
}
async function toastHas(text, timeout = 5000) {
  await page.waitForFunction(t => { const el = document.getElementById('toast'); return el && el.classList.contains('show') && el.textContent.includes(t); }, text, { timeout });
}
async function nav(k) {
  if (await page.locator('#editor:not([hidden])').count()) { await page.click('#ed-back'); await wait(900); }
  if (!(await page.locator(`#nav-main [data-k=${k}]`).isVisible())) { await page.click('#btn-menu'); await wait(300); }
  await page.click(`#nav-main [data-k=${k}]`);
  await wait(300);
}
async function stageBox() { return page.locator('#stage').boundingBox(); }
async function draw(pts, opts = {}) {
  const b = await stageBox();
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
  await page.mouse.down();
  for (const q of pts.slice(1)) await page.mouse.move(b.x + q[0], b.y + q[1], { steps: 4 });
  if (opts.hold) await wait(opts.hold);
  await page.mouse.up();
  await wait(80);
}
async function noteByTitle(t) { return (await idb('notes')).find(n => n.title === t); }
async function contentOf(title) { const n = await noteByTitle(title); return (await idb('pages')).find(p => p.id === n.id); }
async function saved() { await page.waitForFunction(() => document.getElementById('ed-save').textContent === 'Salvo', null, { timeout: 6000 }); }

// ---------- servidor local ----------
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); resp.end(); return; }
      resp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ---------- serviços simulados ----------
const recogQueue = []; // respostas do reconhecimento de escrita para os próximos pedidos (escrita organizada)
async function mocks(c) {
  await c.route('https://inputtools.google.com/**', async r => {
    const n = JSON.parse(r.request().postData()).requests[0].ink.length;
    const ans = recogQueue.length ? [recogQueue.shift()] : n >= 5 ? ['2+3=6', '2+3=b'] : ['casa', 'Casa', 'cara'];
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(['SUCCESS', [['x', ans, [], {}]]]) });
  });
}

// Gemini simulado: responde de acordo com o pedido (resumo, flashcards, plano, simulado em JSON, tutor, áudio…)
// gemMode: 'ok' | '503once' (1ª tentativa falha) | '503primary' (modelo principal sempre sobrecarregado) | '404primary' | '429'
//          | 'slowprimary' (o principal só começa a responder depois de 8 s)
let gemReqs = [], gemMode = 'ok';
const QUIZ_JSON = JSON.stringify([
  { pergunta: 'Quanto é 1/2 + 1/2?', alternativas: ['1/4', '1', '2', '1/2'], correta: 1, explicacao: 'Meio mais meio dá um inteiro.' },
  { pergunta: 'O que o denominador indica?', alternativas: ['Partes pegas', 'Partes do inteiro', 'O resultado', 'Nada'], correta: 1, explicacao: 'Em quantas partes o inteiro foi dividido.' },
  { pergunta: '3/4 é maior que 1/2?', alternativas: ['Sim', 'Não', 'São iguais', 'Depende'], correta: 0, explicacao: '3/4 = 0,75 e 1/2 = 0,5.' },
]);
function geminiReply(body) {
  const sys = body.systemInstruction ? body.systemInstruction.parts.map(p => p.text).join(' ') : '';
  const parts = body.contents[body.contents.length - 1].parts || [];
  const txt = parts.filter(p => p.text).map(p => p.text).join(' ');
  const has = re => parts.some(p => p.inline_data && re.test(p.inline_data.mime_type));
  if (/Responda apenas/.test(txt)) return 'Tudo certo!';
  if (has(/^audio\//)) {
    if (/Transcreva/.test(txt)) return 'Hoje vamos estudar frações. [inaudível] A prova é na sexta.';
    if (/só o que for tarefa/.test(txt)) return '# Tarefas da aula\n\n- Estudar frações para a prova de sexta\n- Fazer os exercícios 1 a 10 da página 42';
    return '# Aula de frações\n- Frações representam partes de um inteiro.\n\n# Para lembrar\n- A prova é na sexta.';
  }
  if (/tutor particular/.test(sys)) return has(/^image\//) ? '# Resolução\n1. 2x + 3 = 11\n2. 2x = 8\n3. x = 4' : '# Explicação\n- O denominador mostra em quantas partes o inteiro foi dividido.';
  if (/simulado com/i.test(txt)) return QUIZ_JSON;
  if (/plano de estudo|Analise minha semana/i.test(txt)) return '# Análise\n- Você estudou bem.\n\n# Tarefas\n- Revisar frações\n- Fazer simulado de matemática\n';
  if (/flashcards/i.test(txt)) return 'P: Quanto é 3/4 + 1/4?\nR: 1\n\nP: O que é o denominador?\nR: O número de baixo da fração.\n\nP: 1/2 equivale a quantos quartos?\nR: 2/4';
  return '# Resumo pelo Gemini\n- Frações são partes de um inteiro.\n- Numerador em cima, denominador embaixo.';
}
async function geminiMock(c) {
  await c.route('https://generativelanguage.googleapis.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const h = await r.request().allHeaders();
    const url = r.request().url();
    const body = JSON.parse(r.request().postData());
    gemReqs.push({ url, h, body });
    const err = (status, code, message, extra = {}) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: status, message, status: code, ...extra } }) });
    if (h['x-goog-api-key'] === 'chave-invalida') return err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', { details: [{ reason: 'API_KEY_INVALID' }] });
    const primary = url.includes('/models/gemini-flash-lite-latest:');
    if (gemMode === '503once') { gemMode = 'ok'; return err(503, 'UNAVAILABLE', 'This model is currently experiencing high demand.'); }
    if (gemMode === '503primary' && primary) return err(503, 'UNAVAILABLE', 'This model is currently experiencing high demand.');
    if (gemMode === '404primary' && primary) return err(404, 'NOT_FOUND', 'This model is no longer available to new users.');
    if (gemMode === '429') return err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota');
    if (gemMode === 'slowprimary' && primary) await new Promise(res => setTimeout(res, 8000));
    const reply = geminiReply(body);
    let sse = `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'pensando…', thought: true }] } }] })}\r\n\r\n`;
    for (const ch of reply.match(/[\s\S]{1,10}/g)) sse += `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: ch }] } }], modelVersion: 'gemini-x' })}\r\n\r\n`;
    sse += `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }] })}\r\n\r\n`;
    try { await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse }); } catch { /* pedido já cancelado pelo app */ }
  });
}

function watch(p) {
  p.on('pageerror', e => errors.push('ERRO DE PÁGINA: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
}

(async () => {
  const srv = await serve();
  base = `http://127.0.0.1:${srv.address().port}/`;
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, acceptDownloads: true, locale: 'pt-BR', permissions: ['clipboard-read', 'clipboard-write', 'microphone', 'notifications'] });
  await mocks(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); } catch { /* */ } });
  await geminiMock(ctx);
  page = await ctx.newPage();
  watch(page);
  console.log(`\nCaderno de Estudos — teste completo (${base})\n`);

  // ================= INÍCIO =================
  console.log('Início e dados de exemplo');
  await step('abre na tela Hoje sem erros', async () => {
    await page.goto(base); await wait(1200);
    assert(await page.locator('#view-title').textContent() === 'Hoje', 'título não é Hoje');
    assert(await page.locator('.today-head h2').count() === 1, 'painel Hoje não renderizou');
  });
  await step('cria dados de exemplo (pastas, nota, hábitos, baralho)', async () => {
    assert((await idb('folders')).length === 3, 'esperava 3 pastas');
    assert((await idb('notes')).length === 1, 'esperava 1 anotação');
    assert((await idb('habits')).length === 3, 'esperava 3 hábitos');
    assert((await idb('cards')).length === 4, 'esperava 4 cartas');
  });

  // ================= PASTAS E ANOTAÇÕES =================
  console.log('Pastas e anotações');
  await step('cria, edita e exclui pasta', async () => {
    await nav('all');
    await page.click('#btn-new-folder'); await page.fill('#f-name', 'História'); await page.click('.modal .btn.primary'); await wait(400);
    assert((await idb('folders')).some(f => f.name === 'História'), 'pasta não criada');
    await page.click('#nav-folders .folder:has-text("História") .more'); await page.click('.menu-item:has-text("Renomear")');
    await page.fill('#f-name', 'História Geral'); await page.click('.modal .btn.primary'); await wait(400);
    assert((await idb('folders')).some(f => f.name === 'História Geral'), 'pasta não renomeada');
    await page.click('#nav-folders .folder:has-text("História Geral") .more'); await page.click('.menu-item:has-text("Excluir pasta")');
    await page.click('.modal .btn.primary'); await wait(400);
    assert(!(await idb('folders')).some(f => f.name.startsWith('História')), 'pasta não excluída');
  });
  await step('cria anotação (papel Cornell) na pasta Matemática', async () => {
    await nav('all');
    await page.click('#btn-new'); await page.fill('#n-title', 'Frações');
    await page.selectOption('#n-folder', { label: 'Matemática' });
    await page.click('.paper-opt[data-v=cornell]'); await page.click('.modal .btn.primary'); await wait(900);
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'editor não abriu');
    const c = await contentOf('Frações'); assert(c.bg.type === 'cornell', 'papel errado');
  });

  // ================= EDITOR =================
  console.log('Editor');
  await step('caneta, lápis e marca-texto salvam traços', async () => {
    await page.click('[data-tool=pen]'); await draw([[150, 250], [250, 270], [350, 250]]);
    await page.click('[data-tool=pencil]'); await draw([[150, 330], [350, 330]]);
    await page.click('[data-tool=marker]'); await draw([[150, 400], [400, 400]]);
    await saved();
    const s = (await contentOf('Frações')).pages[0].strokes;
    assert(s.length === 3 && ['pen', 'pencil', 'marker'].every(t => s.some(x => x.tool === t)), `traços: ${s.map(x => x.tool)}`);
  });
  await step('desfazer e refazer', async () => {
    await page.click('#ed-undo'); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.length === 2, 'desfazer falhou');
    await page.click('#ed-redo'); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.length === 3, 'refazer falhou');
  });
  await step('borracha parcial divide o traço; borracha de traço inteiro remove', async () => {
    await page.click('[data-tool=eraser]');
    await page.click('#er-mode [data-m=partial]');
    await draw([[275, 380], [275, 420]]); await saved();
    const s1 = (await contentOf('Frações')).pages[0].strokes;
    assert(s1.filter(x => x.tool === 'marker').length === 2, 'marca-texto não foi dividido');
    await page.click('#er-mode [data-m=stroke]');
    await draw([[160, 320], [160, 340]]); await saved();
    assert(!(await contentOf('Frações')).pages[0].strokes.some(x => x.tool === 'pencil'), 'lápis não apagado');
  });
  await step('formas perfeitas: círculo segurando a caneta', async () => {
    await page.click('[data-tool=pen]');
    const b = await stageBox();
    await page.mouse.move(b.x + 750, b.y + 300); await page.mouse.down();
    for (let i = 0; i <= 36; i++) { const t = (i / 36) * Math.PI * 2; await page.mouse.move(b.x + 700 + 50 * Math.cos(t), b.y + 300 + 50 * Math.sin(t)); }
    await wait(800); await page.mouse.up(); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.some(x => x.shape), 'forma não corrigida');
  });
  await step('laço: selecionar, mover, duplicar, mudar cor e apagar', async () => {
    await page.click('[data-tool=lasso]');
    await draw([[120, 220], [400, 220], [400, 300], [120, 300], [120, 221]]);
    assert(await page.locator('.selbar').isVisible(), 'barra de seleção não apareceu');
    const before = (await contentOf('Frações')).pages[0].strokes.find(x => x.tool === 'pen').points[0][0];
    await draw([[250, 260], [300, 300]]); await saved();
    const after = (await contentOf('Frações')).pages[0].strokes.find(x => x.tool === 'pen' && !x.shape).points[0][0];
    assert(after > before + 20, 'não moveu');
    const n0 = (await contentOf('Frações')).pages[0].strokes.length;
    await page.click('.selbar [data-a=dup]'); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.length === n0 + 1, 'não duplicou');
    await page.click('.selbar [data-a=color]'); await page.click('.modal .sw[data-c="#e5352b"]'); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.some(x => x.color === '#e5352b'), 'cor não mudou');
    await page.click('.selbar [data-a=del]'); await saved();
    assert((await contentOf('Frações')).pages[0].strokes.length === n0, 'não apagou');
  });
  await step('texto: criar e editar', async () => {
    await page.click('[data-tool=text]');
    const b = await stageBox(); await page.mouse.click(b.x + 450, b.y + 600); await wait(200);
    await page.keyboard.type('Olá, mundo'); await page.mouse.click(b.x + 450, b.y + 750); await wait(300); await saved();
    assert((await contentOf('Frações')).pages[0].texts.some(t => t.text === 'Olá, mundo'), 'texto não salvo');
  });
  await step('inserir imagem', async () => {
    await page.click('[data-tool=image]');
    await page.setInputFiles('#img-input', path.join(ROOT, 'icons/icon-192.png')); await wait(800); await saved();
    assert((await contentOf('Frações')).pages[0].images.length === 1, 'imagem não inserida');
  });
  await step('páginas: adicionar, navegar, visão geral (reordenar/duplicar) e excluir', async () => {
    await page.click('#pg-add'); await wait(300);
    assert((await page.textContent('#pg-label')).trim() === '2 / 2', 'não criou página');
    await page.click('#pg-prev'); await page.click('#pg-label'); await wait(300);
    await page.click('.pg-tools [data-dup="0"]'); await wait(300);
    await page.click('.pg-tools [data-right="0"]'); await wait(300);
    await closeModals(); await saved();
    assert((await contentOf('Frações')).pages.length === 3, 'duplicar página falhou');
    await page.click('#pg-del'); await page.click('.modal .btn.danger'); await saved();
    assert((await contentOf('Frações')).pages.length === 2, 'excluir página falhou');
  });
  await step('trocar papel e renomear no editor', async () => {
    await page.click('#ed-paper'); await page.click('.paper-opts[data-g=type] [data-v=smallgrid]'); await page.click('.modal .btn.primary'); await saved();
    assert((await contentOf('Frações')).bg.type === 'smallgrid', 'papel não mudou');
    await page.fill('#ed-title', 'Frações e decimais'); await page.press('#ed-title', 'Enter'); await page.click('[data-tool=pen]'); await saved();
    assert(await noteByTitle('Frações e decimais'), 'título não salvo');
  });

  // ================= CORREÇÃO =================
  console.log('Correção de escrita e contas');
  await step('corrigir escrita converte em texto', async () => {
    if (await page.locator('#pg-next').isEnabled()) await page.click('#pg-next');
    await page.click('[data-tool=pen]');
    await draw([[150, 520], [165, 500], [180, 520], [195, 500]]);
    await page.click('#ed-convert'); await draw([[130, 480], [230, 480], [230, 540], [130, 540], [130, 481]]); await wait(800);
    await page.click('.modal .btn.primary'); await saved();
    const casa = (await contentOf('Frações e decimais')).pages[1].texts.find(t => t.text === 'casa');
    assert(casa, 'não converteu');
    assert(casa.size === 30 && casa.font === 'caveat', 'o texto convertido devia ficar do tamanho da linha, em fonte manuscrita: ' + JSON.stringify(casa));
  });
  await step('verificar conta marca ✗ com resposta certa', async () => {
    await page.click('[data-tool=pen]');
    const y = 200;
    for (const pts of [[[150, y], [170, y - 20], [190, y]], [[215, y], [245, y]], [[230, y - 15], [230, y + 15]], [[265, y - 20], [285, y]], [[310, y - 5], [340, y - 5]]]) await draw(pts);
    await page.click('#ed-check'); await draw([[120, 150], [380, 150], [380, 250], [120, 250], [120, 151]]); await wait(900); await saved();
    assert((await contentOf('Frações e decimais')).pages[1].texts.some(t => t.mark && t.text.includes('certo: 5')), 'não marcou a conta');
  });

  // ================= COMPARTILHAR =================
  console.log('Compartilhar');
  await step('gera PDF válido de todas as páginas', async () => {
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#ed-share'); await page.click('.menu-item >> nth=0');
    const d = await dl; const f = path.join(OUT, 'teste.pdf'); await d.saveAs(f);
    const buf = fs.readFileSync(f);
    assert(buf.slice(0, 5).toString() === '%PDF-' && buf.toString('latin1').includes('/Count 2'), 'PDF inválido');
  });
  await step('gera imagem PNG da página', async () => {
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#ed-share'); await page.click('.menu-item:has-text("PNG")');
    const d = await dl; const f = path.join(OUT, 'teste.png'); await d.saveAs(f);
    assert(fs.readFileSync(f).slice(1, 4).toString() === 'PNG', 'PNG inválido');
  });

  // ================= IA =================
  console.log('Assistente de IA (respostas simuladas)');
  await step('chave inválida do Gemini mostra erro claro; chave válida responde', async () => {
    await page.click('#ed-settings'); await page.fill('#s-geminikey', 'chave-invalida'); await page.click('#s-aitest');
    await page.waitForFunction(() => /✗|✓/.test(document.getElementById('s-aistatus').textContent), null, { timeout: 8000 });
    assert((await page.textContent('#s-aistatus')).includes('Chave do Gemini inválida'), 'erro não amigável: ' + await page.textContent('#s-aistatus'));
    await page.fill('#s-geminikey', 'chave-teste'); await page.click('#s-aitest');
    await page.waitForFunction(() => /✓/.test(document.getElementById('s-aistatus').textContent), null, { timeout: 8000 });
    assert((await page.textContent('#s-aistatus')).includes('Tudo certo'), 'teste da chave falhou');
    await page.click('.modal-actions .btn.primary'); await wait(300);
  });
  await step('as 7 ações da IA respondem', async () => {
    await page.click('#ed-ai'); await wait(300);
    for (const a of ['summary', 'improve', 'expand', 'explain', 'quiz', 'flashcards', 'plan']) {
      await page.click(`.ai-act[data-a=${a}]`);
      await page.waitForSelector('.ai-turn.assistant:not(.streaming) .ai-result', { timeout: 8000 });
    }
  });
  await step('plano vira tarefas; flashcards viram baralho', async () => {
    const t0 = (await idb('tasks')).length;
    await page.click('.ai-result [data-r=tasks]'); await wait(500);
    assert((await idb('tasks')).length === t0 + 2, 'tarefas não criadas');
    await page.click('.ai-act[data-a=flashcards]'); await page.waitForSelector('.ai-result [data-r=cards]');
    await page.click('.ai-result [data-r=cards]'); await wait(500);
    assert((await idb('cards')).length === 7, 'flashcards não salvos');
  });
  await step('escrever resposta da IA na folha e conversar', async () => {
    await page.click('.ai-act[data-a=summary]'); await page.waitForSelector('.ai-result [data-r=new]');
    const n0 = (await contentOf('Frações e decimais')).pages.length;
    await page.click('.ai-result [data-r=new]'); await saved();
    assert((await contentOf('Frações e decimais')).pages.length === n0 + 1, 'não escreveu em página nova');
    await page.fill('#ai-q', 'O que é numerador?'); await page.click('#ai-send');
    await page.waitForFunction(() => document.querySelectorAll('.ai-turn.assistant:not(.streaming)').length >= 2, null, { timeout: 8000 });
    await page.click('#ai-close');
  });

  // ================= IMPORTAR =================
  console.log('Importar PDF');
  await step('importa PDF como páginas no editor', async () => {
    const n0 = (await contentOf('Frações e decimais')).pages.length;
    await page.click('#ed-import'); await page.setInputFiles('#import-input', path.join(OUT, 'teste.pdf')); await wait(4000); await saved();
    assert((await contentOf('Frações e decimais')).pages.length === n0 + 2, 'páginas do PDF não entraram');
  });
  await step('importa PDF pela biblioteca como anotação nova', async () => {
    await page.click('#ed-back'); await wait(900); await nav('all');
    await page.click('#btn-import'); await page.setInputFiles('#import-input', path.join(OUT, 'teste.pdf')); await wait(4500);
    assert(await noteByTitle('teste'), 'anotação importada não criada');
    await page.click('#ed-back'); await wait(900);
  });
  await step('menu da anotação: favoritar, duplicar, mover e excluir', async () => {
    await nav('all');
    await page.click('.card:has-text("teste") .more'); await page.click('.menu-item:has-text("Duplicar")'); await wait(400);
    assert(await noteByTitle('teste (cópia)'), 'não duplicou');
    await page.click('.card:has-text("teste (cópia)") .fav'); await wait(300);
    assert((await noteByTitle('teste (cópia)')).fav, 'não favoritou');
    await page.click('.card:has-text("teste (cópia)") .more'); await page.click('.menu-item:has-text("Mover")');
    await page.selectOption('#mv', { label: 'Ciências' }); await page.click('.modal .btn.primary'); await wait(300);
    await page.click('.card:has-text("teste (cópia)") .more'); await page.click('.menu-item:has-text("Excluir")'); await page.click('.modal .btn.danger'); await wait(400);
    assert(!(await noteByTitle('teste (cópia)')), 'não excluiu');
  });
  await step('IA pela biblioteca salva resumo como anotação', async () => {
    await page.click('.card:has-text("Frações e decimais") .more'); await page.click('.menu-item:has-text("Assistente IA")'); await wait(600);
    await page.click('.ai-dialog .ai-act[data-a=summary]'); await page.waitForFunction(() => !document.querySelector('.modal-actions .btn:nth-child(3)').disabled, null, { timeout: 10000 });
    await page.click('.modal-actions .btn >> nth=2'); await wait(1200);
    assert(await noteByTitle('IA – Frações e decimais'), 'resumo não salvo');
    await page.click('#ed-back'); await wait(900);
  });
  await step('busca e ordenação da biblioteca', async () => {
    await nav('all');
    await page.fill('#search', 'decimais'); await wait(300);
    assert(await page.locator('.card[data-id]').count() === 2, 'busca errada');
    await page.fill('#search', ''); await page.selectOption('#sort', 'title'); await wait(300);
    const titles = await page.locator('.card[data-id] .card-title').allTextContents();
    assert(JSON.stringify(titles) === JSON.stringify([...titles].sort((a, b) => a.localeCompare(b, 'pt-BR'))), 'ordenação errada');
  });

  // ================= TAREFAS =================
  console.log('Tarefas');
  await step('cria tarefa com prazo, prioridade e repetição semanal', async () => {
    await nav('tasks');
    await page.click('#btn-new'); await page.fill('#t-title', 'Lista de exercícios');
    await page.fill('#t-due', new Date().toISOString().slice(0, 10)); await page.selectOption('#t-prio', '3'); await page.selectOption('#t-repeat', 'weekly');
    await page.click('.modal .btn.primary'); await wait(400);
    const t = (await idb('tasks')).find(x => x.title === 'Lista de exercícios');
    assert(t && t.prio === 3 && t.repeat === 'weekly', 'tarefa errada');
  });
  await step('concluir tarefa repetida cria a próxima', async () => {
    await page.click('.task:has-text("Lista de exercícios") .task-check'); await wait(500);
    const ts = (await idb('tasks')).filter(x => x.title === 'Lista de exercícios');
    assert(ts.length === 2 && ts.some(x => x.done) && ts.some(x => !x.done), 'não criou a próxima');
  });
  await step('filtros de tarefas e compartilhar lista', async () => {
    await page.click('#task-filter [data-f=done]'); await wait(200);
    assert(await page.locator('.task.done').count() >= 1, 'filtro concluídas');
    await page.click('#task-filter [data-f=pending]'); await page.click('#btn-share-tasks'); await wait(400);
  });

  // ================= CENTRAL =================
  console.log('Hoje, Agenda, Foco, Flashcards, Hábitos');
  await step('Hoje: marcar hábito e concluir tarefa', async () => {
    await nav('today');
    await page.click('.hchip >> nth=1'); await wait(400);
    assert(Object.keys((await idb('habits')).find(h => h.name === 'Ler 20 páginas').days).length === 1, 'hábito não marcado');
  });
  await step('Agenda: navegar meses e criar tarefa num dia', async () => {
    await nav('calendar');
    await page.click('#cal-next'); await page.click('#cal-prev'); await page.click('#cal-today');
    await page.click('.cal-cell:not(.out) >> nth=27'); await page.click('#cal-add');
    await page.fill('#t-title', 'Tarefa da agenda'); await page.click('.modal .btn.primary'); await wait(400);
    assert((await idb('tasks')).find(t => t.title === 'Tarefa da agenda').due, 'tarefa sem data');
  });
  const dplus = n => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await step('Agenda: evento importante com prioridade fica salvo e aparece no calendário', async () => {
    await nav('calendar');
    assert((await page.textContent('#btn-new')).includes('Novo evento'), 'botão Novo evento');
    await page.click('#btn-new');
    await page.fill('#ev-title', 'Prova de Biologia'); await page.fill('#ev-date', dplus(5)); await page.fill('#ev-time', '08:30');
    await page.click('#ev-kind [data-k=prova]'); await page.click('#ev-prio [data-p="3"]'); await page.fill('#ev-notes', 'Capítulos 4 e 5');
    await page.click('.modal-actions .btn.primary'); await wait(500);
    const ev = (await idb('events')).find(e => e.title === 'Prova de Biologia');
    assert(ev && ev.prio === 3 && ev.date === dplus(5) && ev.time === '08:30' && ev.remind === true && ev.kind === 'prova', 'evento: ' + JSON.stringify(ev));
    assert(await page.locator('.cal-next .ev-row.p3:has-text("Prova de Biologia") .ev-badge').textContent() === 'Alta', 'prioridade na lista');
    await page.click('.cal-next .ev-row:has-text("Prova de Biologia")'); await wait(300);
    assert(await page.locator('.cal-cell.sel .cal-t.ev.p3').count() === 1, 'evento não aparece no dia do calendário');
    assert(await page.locator('.cal-day .ev-row:has-text("Prova de Biologia")').count() === 1, 'evento não aparece na lista do dia');
    await page.reload(); await wait(1300); await nav('calendar');
    assert(await page.locator('.cal-next .ev-row:has-text("Prova de Biologia")').count() === 1, 'evento não ficou salvo depois de reabrir');
  });
  await step('Agenda: botão de apagar evento (com desfazer) e editar prioridade', async () => {
    await page.click('.cal-next .ev-row:has-text("Prova de Biologia") [data-evdel]'); await wait(300);
    assert(!(await idb('events')).some(e => e.title === 'Prova de Biologia'), 'não apagou');
    await page.click('#toast .toast-btn'); await wait(400);
    assert((await idb('events')).some(e => e.title === 'Prova de Biologia'), 'desfazer não trouxe o evento');
    await page.click('.cal-next .ev-row:has-text("Prova de Biologia") [data-evedit]'); await page.click('#ev-prio [data-p="1"]'); await page.click('.modal-actions .btn.primary'); await wait(400);
    assert((await idb('events')).find(e => e.title === 'Prova de Biologia').prio === 1, 'prioridade não mudou');
    await page.click('.cal-next .ev-row:has-text("Prova de Biologia") [data-evedit]'); await page.click('.modal-actions .btn.danger'); await wait(400);
    assert(!(await idb('events')).some(e => e.title === 'Prova de Biologia'), 'Apagar na janela do evento não apagou');
  });
  await step('Agenda: aviso 1 dia antes (notificação do tablet + aviso no app) e só uma vez', async () => {
    await page.evaluate(async d => { const st = await import('./js/store.js'); await st.db.put('events', { id: 'ev-amanha', title: 'Entrega do trabalho de Geografia', date: d, time: '07:30', prio: 3, kind: 'trabalho', notes: '', remind: true, notified: {}, createdAt: Date.now() }); }, dplus(1));
    // o Chromium de teste não mostra notificações: simulamos a permissão do Android e guardamos o que seria mostrado
    await page.addInitScript(() => {
      try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch { /* */ }
      ServiceWorkerRegistration.prototype.showNotification = function (t, o) { (window.__notifs ||= []).push(`${t} | ${o && o.body}`); return Promise.resolve(); };
    });
    await page.reload();
    await toastHas('Amanhã: Entrega do trabalho de Geografia', 8000);
    const ev = (await idb('events')).find(e => e.id === 'ev-amanha');
    assert(ev.notified && ev.notified.before === dplus(1), 'não marcou o aviso: ' + JSON.stringify(ev.notified));
    const shown = await page.evaluate(() => window.__notifs || []);
    assert(shown.some(t => t.includes('Amanhã: Entrega do trabalho de Geografia') && t.includes('07:30') && t.includes('ALTA')), 'notificação do tablet: ' + shown.join(' / '));
    const n0 = await page.evaluate(async () => (await import('./js/events.js')).checkReminders());
    assert(n0 === 0, 'avisou de novo o mesmo evento');
    await nav('today');
    assert((await page.textContent('.t-events')).includes('Entrega do trabalho de Geografia'), 'Hoje não mostra os próximos eventos');
    assert(await page.locator('.sg:has-text("Amanhã: Entrega do trabalho de Geografia")').count() === 1, '"O que fazer agora" não lembra do evento');
  });
  await step('Foco: iniciar, pausar, pular e encerrar', async () => {
    await nav('focus');
    await page.click('#fc-start'); await wait(1300);
    assert(await page.locator('#focus-pill').count() === 1, 'relógio flutuante ausente');
    await page.click('#fc-start'); await wait(200);
    await page.selectOption('#fc-folder', { label: 'Matemática' });
    await page.click('#fc-skip'); await wait(300);
    assert((await page.textContent('#fc-mode .active')) !== 'Foco', 'não pulou');
    await page.click('#fc-mode [data-m=focus]'); await wait(200);
  });
  await step('Foco: sessão concluída enquanto o app estava fechado é registrada', async () => {
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('caderno-foco')); Object.assign(t, { mode: 'focus', running: true, endAt: Date.now() - 1000, startedAt: Date.now() - 25 * 60000 }); localStorage.setItem('caderno-foco', JSON.stringify(t)); });
    await page.reload(); await wait(1500);
    assert((await idb('sessions')).some(s => s.minutes === 25), 'sessão não registrada');
  });
  await step('Flashcards: baralho, carta, revisão com as 4 respostas', async () => {
    await nav('cards');
    await page.click('#btn-new'); await page.fill('#dk-name', 'Inglês'); await page.click('.modal .btn.primary'); await wait(300);
    await page.click('.deck:has-text("Inglês") [data-open]');
    for (const [f, b] of [['dog', 'cachorro'], ['cat', 'gato'], ['bird', 'pássaro'], ['fish', 'peixe']]) {
      await page.fill('#dk-front', f); await page.fill('#dk-backtxt', b); await page.click('#dk-form button[type=submit]'); await wait(150);
    }
    await page.click('#dk-study');
    for (const g of [0, 1, 2, 3]) { await page.click('#rv-show'); await page.click(`[data-g="${g}"]`); await wait(200); }
    await page.click('#rv-show'); await page.click('[data-g="2"]'); await wait(300);
    assert(await page.locator('.review-done').count() === 1, 'revisão não terminou');
    const cs = (await idb('cards')).filter(c => ['dog', 'cat', 'bird', 'fish'].includes(c.front));
    assert(cs.every(c => c.lastReview) && cs.find(c => c.front === 'dog').lapses === 1, 'agendamento errado');
    await page.click('#rv-end');
  });
  await step('Hábitos: criar, marcar dias e excluir', async () => {
    await nav('habits');
    await page.click('#btn-new'); await page.fill('#hb-name', 'Beber água'); await page.click('.modal .btn.primary'); await wait(300);
    await page.click('.habit-row:has-text("Beber água") .hcheck >> nth=5'); await page.click('.habit-row:has-text("Beber água") .hcheck >> nth=6'); await wait(300);
    assert(await page.textContent('.habit-row:has-text("Beber água") .hs b') === '2', 'sequência errada');
    await page.click('.habit-row:has-text("Beber água") [data-more]'); await page.click('.menu-item:has-text("Excluir")'); await page.click('.modal .btn.danger'); await wait(300);
    assert(!(await idb('habits')).some(h => h.name === 'Beber água'), 'não excluiu');
  });

  // ================= DESEMPENHO =================
  console.log('Leitura, Kindle, Notas, Relatório, Busca');
  await step('Leitura: livro, registrar páginas e citação vira flashcard', async () => {
    await nav('reading');
    await page.click('#btn-new'); await page.fill('#bk-title', 'Dom Casmurro'); await page.fill('#bk-total', '256'); await page.click('.modal .btn.primary'); await wait(300);
    await page.click('.book:has-text("Dom Casmurro") [data-log]'); await page.fill('#rd-page', '40'); await page.fill('#rd-min', '30'); await page.click('.modal .btn.primary'); await wait(400);
    assert((await idb('reads')).some(r => r.pages === 40 && r.minutes === 30), 'leitura não registrada');
    assert((await idb('books'))[0].currentPage === 40, 'página atual errada');
    await page.click('.book:has-text("Dom Casmurro") [data-quotes]'); await page.fill('#q-text', 'Capitu tinha olhos de ressaca'); await page.fill('#q-page', '30');
    await page.click('#q-form button'); await wait(300); await page.click('[data-card="0"]'); await wait(400); await closeModals();
    assert((await idb('decks')).some(d => d.name === 'Leitura — Dom Casmurro'), 'flashcard da citação não criado');
  });
  await step('Kindle: abre o app instalado (sem cair no read.amazon.com) e lembra o caminho que funcionou', async () => {
    const r = await page.evaluate(async () => {
      const m = await import('./js/perf.js');
      return [0, 1, 2, 3].map(i => m.kindleURL(i, 'https://x.github.io/app/'));
    });
    assert(r[0] === 'intent://book/#Intent;scheme=kindle;package=com.amazon.kindle;S.browser_fallback_url=https%3A%2F%2Fx.github.io%2Fapp%2F%3Fkt%3D1;end', 'caminho 1: ' + r[0]);
    assert(r.every(u => !u.includes('read.amazon.com%2F;') && !/fallback_url=https%3A%2F%2Fread/.test(u)), 'ainda cai no site do Kindle');
    assert(r[3].includes('scheme=market') && r[3].includes('id=com.amazon.kindle'), 'último caminho devia ser a Play Store: ' + r[3]);
    // o Chrome voltou ao Caderno porque o caminho 1 não abriu: oferece o próximo e guarda
    await page.goto(base + '?kt=1'); await page.waitForSelector('.modal h2:has-text("Abrir o Kindle")', { timeout: 5000 });
    assert((await page.textContent('.modal')).includes('2 de 4'), 'não ofereceu o próximo caminho');
    assert(await page.evaluate(() => localStorage.getItem('caderno-kindle-jeito')) === '1', 'não guardou o caminho');
    assert(await page.textContent('#view-title') === 'Leitura', 'devia voltar para a Leitura');
    await closeModals();
    const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await page.click('.kindle-hero [data-kindle]');
    assert(await popup, 'no computador devia abrir o Kindle na web');
  });
  await step('Notas: validação, média, meta e "quanto preciso tirar"', async () => {
    await nav('grades');
    await page.click('#btn-new'); await page.selectOption('#gr-folder', { label: 'Matemática' }); await page.fill('#gr-title', 'Prova 1'); await page.fill('#gr-score', '12');
    await page.click('.modal .btn.primary'); await toastHas('A nota precisa estar entre');
    assert(await page.locator('.modal').count() === 1, 'aceitou nota inválida');
    await page.fill('#gr-score', '5'); await page.click('.modal .btn.primary'); await wait(300);
    await page.click('#btn-new'); await page.selectOption('#gr-folder', { label: 'Matemática' }); await page.fill('#gr-title', 'Prova 2');
    const d = new Date(Date.now() + 5 * 86400000); await page.fill('#gr-date', d.toISOString().slice(0, 10)); await page.fill('#gr-weight', '2');
    await page.click('.modal .btn.primary'); await wait(300);
    const txt = await page.textContent('.subject:has-text("Matemática")');
    assert(txt.includes('Precisa de 6,5'), 'cálculo errado: ' + txt.slice(0, 200));
  });
  await step('Notas: plano de revisão cria tarefas até a prova', async () => {
    const t0 = (await idb('tasks')).length;
    await page.click('.exam [data-plan]'); await page.click('.modal .btn.primary'); await wait(500);
    assert((await idb('tasks')).length >= t0 + 3, 'tarefas de revisão não criadas');
  });
  await step('Relatório: indicadores, conquistas e análise da IA', async () => {
    await nav('report');
    assert(await page.locator('.kpi').count() === 6, 'indicadores ausentes');
    assert(await page.locator('.badge.on').count() >= 2, 'conquistas não liberadas');
    await page.click('#rp-ai'); await page.waitForSelector('#rp-actions .btn.primary', { timeout: 10000 });
    const t0 = (await idb('tasks')).length; await page.click('#rp-actions .btn.primary'); await wait(400);
    assert((await idb('tasks')).length === t0 + 2, 'tarefas da análise não criadas');
  });
  await step('Busca global (Ctrl+K) abre anotação', async () => {
    await nav('today');
    await page.keyboard.press('Control+k'); await page.fill('.pal-in input', 'decimais'); await page.keyboard.press('Enter'); await wait(1000);
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'não abriu pela busca');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Atalhos do ícone (?v=reading e ?a=nova-anotacao)', async () => {
    await page.goto(base + '?v=reading'); await wait(1200);
    assert(await page.textContent('#view-title') === 'Leitura', 'atalho de leitura');
    await page.goto(base + '?a=nova-anotacao'); await wait(1300);
    assert(await page.locator('#n-title').count() === 1, 'atalho de nova anotação');
    await closeModals();
  });

  // ================= BACKUP E OFFLINE =================
  console.log('Backup, offline e telas');
  let backupFile;
  await step('exporta backup com todos os dados', async () => {
    await page.click('#btn-data'); await page.waitForSelector('#dt-export');
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#dt-export'); const d = await dl; backupFile = path.join(OUT, 'backup.json'); await d.saveAs(backupFile);
    const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    for (const s of ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades', 'classes', 'journal', 'goals', 'quizzes']) assert(Array.isArray(data[s]), 'faltou ' + s);
    assert(data.books.length === 1 && data.grades.length === 2, 'dados incompletos');
  });
  await step('restaura backup num tablet "novo"', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); } catch { /* */ } });
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(base); await p2.waitForTimeout(1200);
    await p2.click('#btn-data'); await p2.waitForSelector('#dt-import'); await p2.setInputFiles('#backup-input', backupFile); await p2.waitForSelector('.modal h2:has-text("Restaurar backup")');
    await p2.click('.modal .btn.primary >> nth=-1');
    try {
      await p2.waitForFunction(() => (document.getElementById('toast') || {}).textContent?.includes('Backup restaurado'), null, { timeout: 30000 });
    } catch (e) { console.log('      (aviso na tela: ' + await p2.evaluate(() => document.getElementById('toast')?.textContent) + ')'); throw e; }
    const n = await p2.evaluate(() => new Promise(res => { const r = indexedDB.open('caderno-estudos'); r.onsuccess = () => { const q = r.result.transaction('books').objectStore('books').getAll(); q.onsuccess = () => res(q.result.length); }; }));
    await c2.close();
    assert(n === 1, 'backup não restaurado');
  });
  await step('funciona sem internet depois da primeira visita', async () => {
    await page.goto(base); await wait(1500);
    await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await wait(1500);
    await ctx.setOffline(true);
    await page.reload(); await wait(1500);
    const ok = await page.locator('.today-head h2').count();
    await ctx.setOffline(false);
    assert(ok === 1, 'não abriu offline');
  });
  await step('nenhuma tela passa da largura no tablet em pé (800px)', async () => {
    await page.setViewportSize({ width: 800, height: 1280 });
    const bad = [];
    for (const k of ['today', 'calendar', 'schedule', 'goals', 'tasks', 'quick', 'focus', 'cards', 'quiz', 'formulas', 'tutor', 'habits', 'journal', 'reading', 'grades', 'report', 'all', 'data']) {
      await page.evaluate(k => { document.body.classList.remove('side-open'); (k === 'data' ? document.getElementById('btn-data') : document.querySelector(`#nav-main [data-k=${k}]`)).click(); }, k); await wait(300);
      // conta só o que fica visível (o que está dentro de uma área com rolagem própria, como o mapa do ano, não estoura a tela)
      const over = await page.evaluate(() => {
        const main = document.querySelector('#main');
        const inScroller = el => { for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return true; return false; };
        return Math.max(...[...main.querySelectorAll('*')].filter(e => !inScroller(e)).map(e => e.getBoundingClientRect().right)) - window.innerWidth;
      });
      if (over > 2) bad.push(`${k} (+${Math.round(over)}px)`);
      await page.screenshot({ path: path.join(OUT, `retrato-${k}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    assert(!bad.length, 'estouram a largura: ' + bad.join(', '));
  });

  // ================= MAIS PRODUTIVIDADE =================
  console.log('Horário, tarefas (quadro/matriz/subtarefas), sons, diário, revisões');
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  await step('Horário: aula de agora aparece e "Anotar nesta aula" cria a anotação', async () => {
    await nav('schedule');
    const now = new Date(); const st = new Date(now.getTime() - 5 * 60000); const en = new Date(now.getTime() + 40 * 60000);
    const safeSt = st.getDate() !== now.getDate() ? '00:00' : hhmm(st), safeEn = en.getDate() !== now.getDate() ? '23:59' : hhmm(en);
    await page.click(`.class-add[data-day="${now.getDay()}"]`);
    await page.selectOption('#cl-folder', { label: 'Matemática' }); await page.fill('#cl-start', safeSt); await page.fill('#cl-end', safeEn); await page.fill('#cl-room', '12');
    await page.click('.modal .btn.primary'); await wait(400);
    assert((await page.textContent('.now-class')).includes('Matemática'), 'aula de agora não apareceu');
    await page.click('.now-class [data-note]'); await wait(1000);
    const t = `Matemática — ${now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
    const n = await noteByTitle(t);
    assert(n && n.review && n.review.step === 0, 'anotação da aula não criada com revisões');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Horário: validação de horário e repetir de segunda a sexta', async () => {
    await nav('schedule');
    await page.click('#btn-new'); await page.fill('#cl-name', 'Educação Física'); await page.fill('#cl-start', '10:00'); await page.fill('#cl-end', '09:00');
    await page.click('.modal .btn.primary'); await toastHas('O fim precisa ser depois do início');
    await page.fill('#cl-end', '10:50'); await page.check('#cl-rep'); await page.click('.modal .btn.primary'); await wait(500);
    assert((await idb('classes')).filter(c => c.name === 'Educação Física').length === 5, 'não repetiu nos 5 dias');
  });
  await step('Hoje mostra aulas, diário e revisões', async () => {
    const n = (await idb('notes')).find(x => x.review && x.review.step === 0);
    await page.evaluate(id => new Promise(res => { const r = indexedDB.open('caderno-estudos'); r.onsuccess = () => { const st = r.result.transaction('notes', 'readwrite').objectStore('notes'); const g = st.get(id); g.onsuccess = () => { const v = g.result; v.review.due = '2000-01-01'; st.put(v).onsuccess = () => res(); }; }; }), n.id);
    await page.reload(); await wait(1500);
    assert(await page.locator('.t-class').count() === 1, 'cartão de aulas');
    assert(await page.locator('.t-journal').count() === 1, 'cartão do diário');
    await page.click('.t-review [data-rvdone]'); await wait(500);
    const after = (await idb('notes')).find(x => x.id === n.id);
    assert(after.review.step === 1 && after.review.due > new Date().toISOString().slice(0, 10), 'revisão não avançou');
  });
  await step('Tarefas: subtarefas com progresso', async () => {
    await nav('tasks');
    await page.click('#task-mode [data-m=list]');
    await page.click('#btn-new'); await page.fill('#t-title', 'Trabalho de ciências');
    for (const x of ['Pesquisar', 'Escrever', 'Revisar']) { await page.fill('#t-subnew', x); await page.press('#t-subnew', 'Enter'); }
    await page.check('#t-subs [data-si="0"]'); await page.click('#t-subs [data-sr="2"]');
    await page.click('.modal .btn.primary'); await wait(400);
    const t = (await idb('tasks')).find(x => x.title === 'Trabalho de ciências');
    assert(t.subtasks.length === 2 && t.subtasks[0].done && !t.subtasks[1].done, 'subtarefas erradas');
    assert((await page.textContent('.task:has-text("Trabalho de ciências")')).includes('1/2'), 'progresso não aparece');
  });
  await step('Tarefas: quadro move de "A fazer" para "Fazendo" e "Feito"', async () => {
    await page.click('#task-mode [data-m=board]'); await wait(300);
    assert(await page.locator('.kanban .k-col').count() === 3, 'quadro não apareceu');
    await page.click('.k-col >> nth=0 >> .k-card:has-text("Trabalho de ciências") [data-to=doing]'); await wait(400);
    assert((await idb('tasks')).find(x => x.title === 'Trabalho de ciências').status === 'doing', 'não foi para Fazendo');
    await page.click('.k-col >> nth=1 >> .k-card:has-text("Trabalho de ciências") [data-to=done]'); await wait(500);
    assert((await idb('tasks')).find(x => x.title === 'Trabalho de ciências').done, 'não foi para Feito');
  });
  await step('Tarefas: matriz coloca tarefa urgente e importante em "Fazer agora"', async () => {
    await page.click('#task-mode [data-m=matrix]'); await wait(200);
    await page.click('#btn-new'); await page.fill('#t-title', 'Entregar redação'); await page.fill('#t-due', new Date().toISOString().slice(0, 10)); await page.selectOption('#t-prio', '3');
    await page.click('.modal .btn.primary'); await wait(400);
    assert((await page.textContent('.mq.q0')).includes('Entregar redação'), 'quadrante errado');
    await page.click('#task-mode [data-m=list]');
  });
  await step('Foco: som de fundo e modo tela cheia', async () => {
    await nav('focus');
    await page.selectOption('#fc-sound', 'brown'); await wait(300);
    await page.click('#fc-start'); await wait(800);
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-foco')).cfg);
    assert(cfg.sound === 'brown', 'som não salvo');
    await page.click('#fc-zen'); await wait(300);
    assert(await page.evaluate(() => document.body.classList.contains('zen')), 'tela cheia não ativou');
    assert(!(await page.locator('#sidebar').isVisible()), 'menu continua visível');
    await page.click('#zen-exit'); await wait(300);
    assert(!(await page.evaluate(() => document.body.classList.contains('zen'))), 'não saiu da tela cheia');
    await page.click('#fc-start'); await page.selectOption('#fc-sound', 'none');
  });
  await step('Diário: salvar dia, virar tarefa de revisão e resumo com IA', async () => {
    await nav('journal');
    await page.click('.mood[data-m="4"]'); await page.fill('#jr-learned', 'Frações equivalentes'); await page.fill('#jr-hard', 'Divisão de frações'); await page.click('#jr-form button[type=submit]'); await wait(400);
    const j = (await idb('journal'))[0];
    assert(j && j.mood === 4 && j.learned === 'Frações equivalentes', 'diário não salvo');
    await page.click('#jr-task'); await wait(400);
    assert((await idb('tasks')).some(t => t.title === 'Revisar: Divisão de frações'), 'tarefa de revisão não criada');
    await page.click('#jr-ai'); await page.waitForFunction(() => /Resumo/.test(document.getElementById('jr-out')?.textContent || ''), null, { timeout: 8000 });
  });

  // ================= NAVEGAÇÃO E NOVIDADES =================
  console.log('Navegação clara, prioridades, cronômetro, metas, simulado e aparência');
  await step('Tour de boas-vindas aparece na primeira visita e pode ser concluído', async () => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p3 = await c3.newPage(); watch(p3);
    await p3.goto(base); await p3.waitForSelector('.tour', { timeout: 5000 });
    for (let i = 0; i < 4; i++) { await p3.click('.modal-actions .btn.primary'); await p3.waitForTimeout(150); }
    assert(await p3.textContent('.modal-actions .btn.primary') === 'Começar', 'último passo');
    await p3.click('.modal-actions .btn.primary'); await p3.waitForTimeout(400);
    assert(await p3.locator('.tour').count() === 0, 'tour não fechou');
    await p3.reload(); await p3.waitForTimeout(1500);
    assert(await p3.locator('.tour').count() === 0, 'tour apareceu de novo');
    await c3.close();
  });
  await step('Menu lateral em 3 áreas com todos os recursos', async () => {
    await nav('today');
    const secs = await page.locator('#nav-main .nav-sec-h').allTextContents();
    assert(['Planejar', 'Estudar', 'Acompanhar', 'Caderno'].every(x => secs.includes(x)), 'áreas: ' + secs.join(','));
    for (const k of ['today', 'tasks', 'quick', 'calendar', 'schedule', 'goals', 'all', 'focus', 'cards', 'quiz', 'formulas', 'tutor', 'reading', 'habits', 'journal', 'grades', 'report']) assert(await page.locator(`#nav-main [data-k=${k}]`).count() >= 1, 'faltou ' + k);
    assert((await page.textContent('#view-section')).includes('Planejar'), 'nome da área no topo');
  });
  await step('Tela "Tudo" mostra cada recurso e abre ao tocar', async () => {
    await page.click('#btn-map'); await wait(300);
    assert(await page.locator('.map-card').count() === 17, 'cartões: ' + await page.locator('.map-card').count());
    await page.click('.map-card[data-go=goals]'); await wait(300);
    assert(await page.textContent('#view-title') === 'Metas', 'não abriu Metas');
  });
  await step('Dica do topo some ao tocar em "Entendi" e não volta', async () => {
    await nav('habits');
    assert(await page.locator('#view-hub > .view-tip').count() === 1, 'dica não apareceu');
    await page.click('#view-hub > .view-tip button'); await wait(200);
    await nav('today'); await nav('habits');
    assert(await page.locator('#view-hub > .view-tip').count() === 0, 'dica voltou');
  });
  await step('Botão + cria qualquer coisa e mostra a ação da tela atual', async () => {
    await nav('goals');
    await page.click('#fab'); await wait(300);
    assert(await page.locator('.quick').count() === 16, 'ações rápidas: ' + await page.locator('.quick').count());
    assert((await page.textContent('.quick-ctx')).includes('Nova meta'), 'ação da tela');
    await page.click('.quick[data-q=task]'); await wait(300);
    assert(await page.locator('#t-title').count() === 1, 'não abriu nova tarefa');
    await closeModals();
  });
  await step('Tablet em pé: barra de baixo e "Mais" com todas as partes', async () => {
    await page.setViewportSize({ width: 800, height: 1280 });
    assert(await page.locator('#bottom-bar').isVisible(), 'barra de baixo invisível');
    await page.click('#bottom-bar [data-bk=tasks]'); await wait(300);
    assert(await page.textContent('#view-title') === 'Tarefas', 'barra não navegou');
    await page.click('#bottom-bar [data-bk=more]'); await wait(300);
    assert(await page.locator('.more-sheet .map-card').count() === 17, 'Mais incompleto');
    await page.click('.more-sheet .map-card[data-go=report]'); await wait(400);
    assert(await page.textContent('#view-title') === 'Relatório', 'Mais não navegou');
    assert(!(await page.locator('#btn-new').isVisible()), 'botão + duplicado no topo');
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  await step('Prioridades de hoje: estrela, limite de 3 e lista no topo', async () => {
    for (const t of ['P1', 'P2', 'P3', 'P4']) await page.evaluate(async t => {
      const st = await import('./js/store.js');
      await st.db.put('tasks', { id: 'top-' + t, title: t, done: false, due: new Date().toISOString().slice(0, 10), prio: 2, createdAt: Date.now() });
    }, t);
    await page.reload(); await wait(1500);
    for (const t of ['P1', 'P2', 'P3', 'P4']) { await page.click(`.t-tasks [data-top="top-${t}"]`); await wait(250); }
    await toastHas('no máximo 3');
    const tops = (await idb('tasks')).filter(t => t.top === new Date().toISOString().slice(0, 10)).map(t => t.title).sort();
    assert(JSON.stringify(tops) === '["P1","P2","P3"]', 'prioridades: ' + tops);
    assert((await page.textContent('.top3')).includes('0 de 3 feitas'), 'contador das prioridades');
  });
  await step('Cronômetro livre: conta, pausa e salva o tempo estudado', async () => {
    await nav('focus');
    await page.click('#fc-mode [data-m=free]'); await wait(200);
    await page.click('#fc-start'); await wait(2200);
    const t1 = await page.textContent('#fc-time');
    assert(/00:0[1-3]/.test(t1), 'não contou: ' + t1);
    await page.click('#fc-start'); await wait(200);
    const s0 = (await idb('sessions')).length;
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('caderno-foco')); t.freeAcc = 125; localStorage.setItem('caderno-foco', JSON.stringify(t)); });
    await page.reload(); await wait(1300); await nav('focus');
    assert((await page.textContent('#fc-time')) === '02:05', 'tempo não continuou após reabrir');
    await page.click('#fc-stop'); await wait(400);
    const ss = await idb('sessions');
    assert(ss.length === s0 + 1 && ss[ss.length - 1].minutes === 2, 'sessão do cronômetro');
    await page.click('#fc-mode [data-m=focus]');
  });
  await step('Metas: progresso automático (foco) e contador manual', async () => {
    await nav('goals');
    await page.click('#btn-new'); await page.selectOption('#gl-type', 'focus'); await page.fill('#gl-title', 'Estudar 10 horas'); await page.fill('#gl-target', '10'); await page.check('#gl-past');
    await page.click('.modal .btn.primary'); await wait(400);
    const focusMin = (await idb('sessions')).reduce((a, x) => a + x.minutes, 0);
    const txt = await page.textContent('.goal-card:has-text("Estudar 10 horas")');
    const expect = (Math.round(focusMin / 60 * 10) / 10).toLocaleString('pt-BR');
    assert(txt.includes(expect) && txt.includes('de 10 h'), `progresso: ${txt.slice(0, 80)} (esperado ${expect})`);
    await page.click('#btn-new'); await page.selectOption('#gl-type', 'manual'); await page.fill('#gl-title', 'Fazer 2 simulados'); await page.fill('#gl-target', '2');
    await page.click('.modal .btn.primary'); await wait(300);
    await page.click('.goal-card:has-text("Fazer 2 simulados") [data-inc]'); await wait(300);
    await page.click('.goal-card:has-text("Fazer 2 simulados") [data-inc]'); await wait(300);
    await toastHas('Meta concluída');
    assert((await idb('goals')).find(g => g.title === 'Fazer 2 simulados').count === 2, 'contador manual');
    await nav('today');
    assert(await page.locator('.t-goals').count() === 1, 'metas não aparecem no Hoje');
  });
  await step('Metas separadas por área: escolher área, criar área nova, filtrar e agrupar', async () => {
    await nav('goals');
    const g1 = (await idb('goals')).find(g => g.title === 'Estudar 10 horas');
    assert(!(await page.textContent('.goal-card:has-text("Estudar 10 horas") .gl-area-tag')).includes('Saúde') && (await page.textContent('.goal-card:has-text("Estudar 10 horas") .gl-area-tag')).includes('Estudos'), 'área automática da meta de foco');
    await page.click('#btn-new'); await page.selectOption('#gl-type', 'manual'); await page.fill('#gl-title', 'Correr 12 vezes'); await page.fill('#gl-target', '12');
    await page.click('#gl-areas [data-area=saude]'); await page.click('.modal-actions .btn.primary'); await wait(400);
    assert((await idb('goals')).find(g => g.title === 'Correr 12 vezes').area === 'saude', 'área não salva');
    await page.click('#btn-new'); await page.selectOption('#gl-type', 'manual'); await page.fill('#gl-title', 'Aprender 3 músicas no violão'); await page.fill('#gl-target', '3');
    await page.click('#gl-areas [data-area="+"]'); await page.fill('.modal >> nth=-1 >> input', 'Música'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(300);
    await page.click('.modal-actions .btn.primary'); await wait(400);
    const gm = (await idb('goals')).find(g => g.title === 'Aprender 3 músicas no violão');
    assert(gm && gm.area && gm.area.startsWith('a-'), 'área nova: ' + JSON.stringify(gm));
    const heads = await page.locator('.gl-sec').allTextContents();
    assert(heads.some(t => t.includes('Estudos')) && heads.some(t => t.includes('Saúde')) && heads.some(t => t.includes('Música')), 'grupos: ' + heads.join(' | '));
    await page.click('.gl-filter [data-filt=saude]'); await wait(300);
    const titles = await page.locator('.goal-card b').allTextContents();
    assert(titles.includes('Correr 12 vezes') && !titles.includes('Estudar 10 horas'), 'filtro: ' + titles.join(','));
    await page.click('#gl-new'); await wait(300);
    assert(await page.locator('#gl-areas [data-area=saude].on').count() === 1, 'nova meta não veio na área do filtro');
    await closeModals();
    await page.reload(); await wait(1300); await nav('goals');
    assert(await page.locator('.gl-filter [data-filt=saude].on').count() === 1, 'não lembrou o filtro');
    await page.click('.gl-filter [data-filt=all]'); await wait(200);
  });
  await step('Simulado: IA cria a prova, responde, corrige, lança nota e cria flashcards dos erros', async () => {
    await nav('quiz');
    await page.selectOption('#qz-src', { label: 'Frações e decimais' });
    await page.click('#qz-go');
    await page.waitForSelector('.qz-opt', { timeout: 10000 });
    assert((await page.textContent('.qz-q h2')).includes('1/2 + 1/2'), 'pergunta');
    await page.click('.qz-opt[data-o="1"]'); await wait(150);
    assert(await page.locator('.qz-opt.right').count() === 1 && (await page.textContent('.qz-ex')).includes('Certo'), 'correção');
    await page.click('#qz-next'); await page.click('.qz-opt[data-o="0"]'); await page.click('#qz-next');
    await page.click('.qz-opt[data-o="0"]'); await page.click('#qz-next'); await wait(400);
    assert((await page.textContent('.qz-score')).trim() === '67%', 'nota: ' + await page.textContent('.qz-score'));
    await page.click('#qz-grade'); await wait(300);
    assert((await idb('grades')).some(g => g.title === 'Simulado — Frações e decimais' && Math.abs(g.score - 6.7) < 0.01), 'nota não lançada');
    await page.click('#qz-cards'); await wait(300);
    assert((await idb('decks')).some(d => d.name === 'Erros — Frações e decimais'), 'flashcards dos erros');
    assert((await idb('quizzes')).length === 1, 'histórico');
    await page.click('#qz-new'); await wait(300);
    assert((await page.textContent('.qz-hist')).includes('2/3'), 'histórico na tela');
  });
  await step('Aparência: tema escuro e texto maior', async () => {
    await page.click('#btn-settings'); await page.click('#s-theme [data-t=dark]'); await page.click('#s-scale [data-z="1.2"]');
    await page.click('.modal-actions .btn.primary'); await wait(300);
    const st = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, z: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim(), bg: getComputedStyle(document.body).backgroundColor }));
    assert(st.t === 'dark' && st.z === '1.2' && st.bg === 'rgb(21, 23, 27)', JSON.stringify(st));
    await page.setViewportSize({ width: 800, height: 1280 });
    for (const k of ['today', 'goals', 'quiz', 'quick', 'tutor', 'report']) {
      await page.evaluate(k => { document.body.classList.remove('side-open'); document.querySelector(`#nav-main [data-k=${k}]`).click(); }, k); await wait(250);
      const over = await page.evaluate(() => document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth);
      assert(over <= 2, `${k} estoura com texto maior (+${over}px)`);
      await page.screenshot({ path: path.join(OUT, `escuro-grande-${k}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('#btn-settings'); await page.click('#s-theme [data-t=auto]'); await page.click('#s-scale [data-z="1"]'); await page.click('.modal-actions .btn.primary'); await wait(200);
  });

  // ================= GEMINI RAPIDÃO =================
  console.log('IA só com o Gemini rapidão (respostas simuladas)');
  const modelOf = x => x.url.split('/models/')[1].split(':')[0];
  await step('Ajustes: só o Gemini (sem escolher provedor) e configurações antigas são limpas', async () => {
    await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('caderno-config') || '{}'); Object.assign(c, { aiProvider: 'groq', groqKey: 'gsk_velha', aiKey: 'sk-ant-velha', geminiModel: 'gemini-2.5-flash' }); localStorage.setItem('caderno-config', JSON.stringify(c)); });
    await page.goto(base); await wait(1200);
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-config')));
    assert(!['aiProvider', 'groqKey', 'aiKey', 'geminiModel'].some(k => k in cfg) && cfg.geminiKey === 'chave-teste', 'configuração antiga ficou: ' + Object.keys(cfg).join(','));
    await page.click('#btn-settings'); await wait(300);
    assert(await page.locator('#s-provider, #s-aikey, #s-groqkey').count() === 0, 'ainda há opções de outros provedores');
    assert(await page.locator('#s-geminikey').isVisible(), 'campo da chave do Gemini');
    assert(!/Groq|Claude|Anthropic/.test(await page.textContent('.modal')), 'os Ajustes ainda falam de outros provedores');
    await page.click('.modal-actions .btn.primary'); await wait(300);
  });
  await step('IA já vem ligada: sem colar chave nenhuma, o app usa a chave embutida', async () => {
    if (!(await page.evaluate(async () => (await import('./js/ai.js')).hasBuiltinKey()))) { console.log('      (sem chave embutida em js/chave.js: passo conferido só pela metade)'); await page.click('#btn-settings'); await page.click('#s-aiclear'); await wait(100); assert((await page.textContent('#s-aiwhich')).includes('Cole a chave'), 'aviso sem chave'); await page.fill('#s-geminikey', 'chave-teste'); await page.click('.modal-actions .btn.primary'); await wait(300); return; }
    await page.click('#btn-settings'); await page.click('#s-aiclear'); await wait(100);
    assert((await page.textContent('#s-aiwhich')).includes('chave embutida'), 'aviso da chave embutida');
    const n0 = gemReqs.length;
    await page.click('#s-aitest');
    await page.waitForFunction(() => /✓|✗/.test(document.getElementById('s-aistatus').textContent), null, { timeout: 8000 });
    assert((await page.textContent('#s-aistatus')).includes('Tudo certo'), 'IA não respondeu com a chave embutida');
    const k = gemReqs[n0].h['x-goog-api-key'];
    assert(k && k !== 'chave-teste' && k.length > 30, 'não usou a chave embutida');
    await page.click('.modal-actions .btn.primary'); await wait(300);
    // outra chave colada em Ajustes tem prioridade
    await page.click('#btn-settings'); await page.fill('#s-geminikey', 'chave-teste'); await page.click('.modal-actions .btn.primary'); await wait(300);
  });
  await step('Gemini: "Testar" usa o Flash-Lite com pensamento baixo e mostra o tempo', async () => {
    const n0 = gemReqs.length;
    await page.click('#btn-settings'); await page.click('#s-aitest');
    await page.waitForFunction(() => /✓|✗/.test(document.getElementById('s-aistatus').textContent), null, { timeout: 8000 });
    const st = await page.textContent('#s-aistatus');
    assert(/Gemini funcionando em [\d,]+ s: Tudo certo/.test(st), 'status: ' + st);
    await page.click('.modal-actions .btn.primary'); await wait(300);
    const last = gemReqs[gemReqs.length - 1];
    assert(gemReqs.length === n0 + 1 && modelOf(last) === 'gemini-flash-lite-latest' && last.url.endsWith(':streamGenerateContent?alt=sse'), 'modelo: ' + last.url);
    assert(last.h['x-goog-api-key'] === 'chave-teste', 'chave no cabeçalho');
    const gc = last.body.generationConfig;
    assert(gc.thinkingConfig && gc.thinkingConfig.thinkingLevel === 'low' && !('thinkingBudget' in gc.thinkingConfig), 'pensamento: ' + JSON.stringify(gc));
    assert(last.body.systemInstruction.parts[0].text.includes('assistente de estudos'), 'instruções ausentes');
    const quizReq = gemReqs.find(x => JSON.stringify(x.body.contents).includes('simulado com'));
    assert(quizReq && quizReq.body.generationConfig.responseMimeType === 'application/json', 'simulado não pediu JSON');
  });
  await step('Gemini: resumo de todas as páginas envia as imagens e ignora o "pensamento"', async () => {
    await nav('all');
    await page.click('.card:has-text("Frações e decimais")'); await wait(900);
    await page.click('#ed-ai'); await page.click('#ai-scope [data-s=all]');
    await page.click('.ai-act[data-a=summary]'); await page.waitForSelector('.ai-turn.assistant:not(.streaming) .ai-result', { timeout: 10000 });
    const b = gemReqs[gemReqs.length - 1].body;
    const imgs = b.contents[0].parts.filter(p => p.inline_data);
    const nPages = (await contentOf('Frações e decimais')).pages.length;
    assert(imgs.length === Math.min(nPages, 20) && imgs.every(p => p.inline_data.mime_type === 'image/jpeg' && p.inline_data.data.length > 1000), `imagens: ${imgs.length} de ${nPages}`);
    const txt = await page.textContent('.ai-turn.assistant');
    assert(txt.includes('Resumo pelo Gemini') && !txt.includes('pensando'), 'resposta errada: ' + txt.slice(0, 80));
  });
  await step('IA: botão Ouvir lê a resposta em voz alta', async () => {
    await page.evaluate(() => { window.__falas = []; speechSynthesis.speak = u => window.__falas.push(u.text); });
    await page.click('.ai-result [data-r=say]'); await wait(200);
    const falas = await page.evaluate(() => window.__falas);
    assert(falas.join(' ').includes('Frações são partes de um inteiro'), 'não leu: ' + falas.join('|'));
    assert(!falas.join(' ').includes('#'), 'leu os símbolos de título');
    assert((await page.textContent('.ai-result [data-r=say]')).includes('Parar'), 'botão não virou "Parar"');
    await page.click('.ai-result [data-r=say]'); await wait(100);
  });
  await step('Gemini: pergunta de acompanhamento mantém a conversa', async () => {
    await page.fill('#ai-q', 'Explique o denominador'); await page.click('#ai-send');
    await page.waitForFunction(() => document.querySelectorAll('.ai-turn.assistant:not(.streaming)').length >= 2, null, { timeout: 8000 });
    const c = gemReqs[gemReqs.length - 1].body.contents;
    assert(c.length === 3 && c[1].role === 'model' && c[2].role === 'user' && c[2].parts[0].text === 'Explique o denominador', 'histórico errado');
  });
  await step('Gemini: sobrecarregado tenta de novo e, se continuar, usa o reserva rápido', async () => {
    const run = async (mode, act) => {
      gemMode = mode; const n0 = gemReqs.length;
      await page.click(`.ai-act[data-a=${act}]`);
      await page.waitForFunction(() => document.querySelectorAll('.ai-turn.assistant:not(.streaming) .ai-result').length >= 1 && !document.querySelector('.ai-turn.streaming'), null, { timeout: 20000 });
      gemMode = 'ok';
      assert(!(await page.locator('.ai-turn.error').count()), 'mostrou erro no modo ' + mode);
      return gemReqs.slice(n0);
    };
    let r = await run('503once', 'summary');
    assert(r.map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-flash-lite-latest', '503 uma vez: ' + r.map(modelOf));
    r = await run('503primary', 'explain');
    assert(r.map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-flash-lite-latest,gemini-flash-lite-latest,gemini-3.1-flash-lite', '503 sempre: ' + r.map(modelOf));
    assert(!r[3].body.generationConfig.thinkingConfig, 'o reserva não deve receber thinkingLevel');
    r = await run('404primary', 'summary');
    assert(r.map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-3.1-flash-lite', '404: ' + r.map(modelOf));
  });
  await step('Gemini: cota esgotada nos dois modelos mostra aviso claro', async () => {
    gemMode = '429'; const n0 = gemReqs.length;
    await page.click('.ai-act[data-a=quiz]'); await page.waitForSelector('.ai-turn.error', { timeout: 8000 });
    assert((await page.textContent('.ai-turn.error')).includes('Limite do Gemini'), 'mensagem do 429');
    assert(gemReqs.slice(n0).map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-3.1-flash-lite', 'a cota é por modelo: devia tentar o reserva');
    gemMode = 'ok';
    await page.click('#ai-close'); await page.click('#ed-back'); await wait(900);
  });

  await step('Gemini rapidão: se o principal demorar, o reserva entra junto e vale o que responder primeiro', async () => {
    await page.click('#btn-settings');
    gemMode = 'slowprimary'; const n0 = gemReqs.length; const t0 = Date.now();
    await page.click('#s-aitest');
    await page.waitForFunction(() => /✓|✗/.test(document.getElementById('s-aistatus').textContent), null, { timeout: 15000 });
    const secs = (Date.now() - t0) / 1000;
    gemMode = 'ok';
    const st = await page.textContent('#s-aistatus');
    await page.click('.modal-actions .btn.primary'); await wait(300);
    assert(st.includes('Tudo certo'), 'status: ' + st);
    assert(secs >= 5.5 && secs < 7.9, `demorou ${secs.toFixed(1)} s (o reserva devia entrar aos 6 s, antes dos 8 s do principal)`);
    assert(gemReqs.slice(n0).map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-3.1-flash-lite', 'pedidos: ' + gemReqs.slice(n0).map(modelOf));
    assert(!errors.length, 'erro ao cancelar o mais lento: ' + errors.join(' | '));
  });

  // ================= MENU LATERAL RETRÁTIL =================
  console.log('Menu lateral retrátil');
  const bodyHas = c => page.evaluate(c => document.body.classList.contains(c), c);
  await step('Menu recolhe para só ícones, lembra depois de reabrir e abre de novo', async () => {
    await page.click('#btn-collapse'); await wait(350);
    let w = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
    assert(await bodyHas('side-collapsed') && w <= 90, 'não recolheu: ' + w);
    assert(await page.locator('#nav-main [data-k=today] .lbl-short').isVisible() && !(await page.locator('#nav-main [data-k=today] .lbl-full').isVisible()), 'nomes curtos');
    assert((await page.getAttribute('#nav-main [data-k=today]', 'title')) === 'Hoje', 'nome completo ao segurar o dedo');
    await page.click('#nav-main [data-k=tasks]'); await wait(300);
    assert(await page.textContent('#view-title') === 'Tarefas', 'menu recolhido não navega');
    await page.screenshot({ path: path.join(OUT, 'menu-recolhido.png') });
    await page.reload(); await wait(1300);
    assert(await bodyHas('side-collapsed'), 'não lembrou o menu recolhido');
    await page.click('#btn-menu'); await wait(350);
    w = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
    assert(!(await bodyHas('side-collapsed')) && w > 200, '☰ não abriu o menu: ' + w);
  });
  await step('Tablet em pé: arrastar da borda abre o menu e arrastar para a esquerda fecha', async () => {
    await page.setViewportSize({ width: 800, height: 1280 }); await wait(300);
    const swipe = (x0, x1) => page.evaluate(([a, b]) => {
      const ev = (t, x) => document.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: 600, pointerType: 'touch', bubbles: true }));
      ev('pointerdown', a); ev('pointerup', b);
    }, [x0, x1]);
    assert(!(await bodyHas('side-open')), 'começou aberto');
    await swipe(6, 220); await wait(300);
    assert(await bodyHas('side-open'), 'arrastar da borda não abriu');
    await swipe(400, 120); await wait(300);
    assert(!(await bodyHas('side-open')), 'arrastar para a esquerda não fechou');
    await page.click('#btn-menu'); await wait(300);
    assert(await bodyHas('side-open'), '☰ não abriu a gaveta');
    await page.click('#scrim', { position: { x: 700, y: 600 } }); await wait(300);
    assert(!(await bodyHas('side-open')), 'tocar fora não fechou');
    await page.setViewportSize({ width: 1280, height: 800 }); await wait(300);
  });

  // ================= NOTAS RÁPIDAS =================
  console.log('Notas rápidas');
  await step('Notas rápidas: lista de marcar, fixar no Hoje e virar tarefa', async () => {
    await nav('quick');
    await page.fill('#qn-new', 'Material da prova\n[ ] Comprar caderno\n[ ] Levar calculadora'); await page.click('#qn-form button[type=submit]'); await wait(400);
    let q = await idb('quicknotes');
    assert(q.length === 1 && q[0].text.includes('[ ] Levar calculadora'), 'nota não salva');
    await page.click('.qn-card .qn-check:has-text("Comprar caderno") input'); await wait(300);
    q = await idb('quicknotes');
    assert(q[0].text.includes('[x] Comprar caderno'), 'item não marcado: ' + q[0].text);
    assert((await page.textContent('.qn-card .qn-foot')).includes('1/2'), 'progresso da lista');
    await page.click('.qn-card [data-pin]'); await wait(300);
    assert((await idb('quicknotes'))[0].pinned, 'não fixou');
    const t0 = (await idb('tasks')).length;
    await page.click('.qn-card [data-task]'); await wait(400);
    const ts = await idb('tasks');
    assert(ts.length === t0 + 1 && ts.some(t => t.title === 'Levar calculadora'), 'só o item não marcado deve virar tarefa');
    await nav('today');
    assert((await page.textContent('.t-quick')).includes('Comprar caderno'), 'nota fixada não aparece no Hoje');
  });
  await step('Notas rápidas: nova com cor, buscar, apagar e desfazer', async () => {
    await nav('quick');
    await page.click('#btn-new'); await page.fill('#qn-text', 'Ideia: fazer mapa mental de Biologia'); await page.click('.qn-color[data-c=verde]'); await page.click('.modal-actions .btn.primary'); await wait(400);
    const q = await idb('quicknotes');
    assert(q.length === 2 && q.some(n => n.color === 'verde'), 'nova nota com cor');
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.qn-card[data-qc=verde]')).backgroundColor);
    assert(bg === 'rgb(217, 245, 212)', 'cor da nota: ' + bg);
    await page.fill('#qn-search', 'biologia'); await wait(300);
    assert(await page.locator('.qn-card').count() === 1, 'busca');
    await page.fill('#qn-search', ''); await wait(300);
    await page.click('.qn-card:has-text("Biologia") [data-more]'); await page.click('.menu-item:has-text("Apagar")'); await wait(300);
    assert((await idb('quicknotes')).length === 1, 'não apagou');
    await page.click('#toast .toast-btn'); await wait(400);
    assert((await idb('quicknotes')).length === 2 && await page.locator('.qn-card').count() === 2, 'desfazer não trouxe a nota de volta');
  });

  // ================= TUTOR IA =================
  console.log('Tutor IA');
  await step('Tutor: foto do exercício, resposta passo a passo e conversa salva', async () => {
    await nav('tutor');
    assert(!(await page.locator('#fab').isVisible()), 'botão + cobre a caixa de mensagem');
    const n0 = gemReqs.length;
    await page.setInputFiles('#tt-file', path.join(ROOT, 'icons', 'icon-512.png'));
    await page.waitForSelector('#tt-attach img');
    assert((await page.inputValue('#tt-q')).includes('passo a passo'), 'pergunta pronta para a foto');
    await page.click('#tt-send');
    await page.waitForSelector('.tt-msg.bot:not(.streaming) .tt-acts', { timeout: 10000 });
    const req = gemReqs[n0].body;
    const parts = req.contents[req.contents.length - 1].parts;
    assert(parts.some(p => p.inline_data && p.inline_data.mime_type === 'image/jpeg' && p.inline_data.data.length > 500), 'foto não foi enviada');
    assert(req.systemInstruction.parts[0].text.includes('tutor particular'), 'instruções do tutor');
    assert((await page.textContent('.tt-msg.bot')).includes('x = 4'), 'resposta não apareceu');
    assert(await page.locator('.tt-msg.user img').count() === 1, 'foto não aparece na conversa');
    const c = await idb('chats');
    assert(c.length === 1 && c[0].messages.length === 2 && c[0].messages[0].image.startsWith('data:image/jpeg'), 'conversa não salva');
    const box = await page.locator('.tt-compose').boundingBox();
    assert(box && box.y + box.height <= 800, 'caixa de mensagem fora da tela');
  });
  await step('Tutor: pergunta seguinte leva o histórico; ouvir, nota rápida e anotação', async () => {
    const n0 = gemReqs.length;
    await page.fill('#tt-q', 'E o que é denominador?'); await page.press('#tt-q', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.tt-msg.bot:not(.streaming) .tt-acts').length === 2, null, { timeout: 10000 });
    const cs = gemReqs[n0].body.contents;
    assert(cs.length === 3 && cs[1].role === 'model' && cs[2].parts.some(p => p.text === 'E o que é denominador?'), 'histórico: ' + cs.length);
    await page.evaluate(() => { window.__falas = []; speechSynthesis.speak = u => window.__falas.push(u.text); });
    await page.click('.tt-msg.bot >> nth=1 >> [data-a=say]'); await wait(200);
    assert((await page.evaluate(() => window.__falas)).join(' ').includes('denominador'), 'não leu em voz alta');
    const q0 = (await idb('quicknotes')).length;
    await page.click('.tt-msg.bot >> nth=1 >> [data-a=quick]'); await wait(400);
    assert((await idb('quicknotes')).length === q0 + 1, 'não salvou em nota rápida');
    await page.click('.tt-msg.bot >> nth=0 >> [data-a=note]'); await wait(1200);
    const note = (await idb('notes')).find(n => n.title.startsWith('Tutor — '));
    assert(note && (note.searchText || '').includes('x = 4'), 'anotação do tutor');
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'anotação não abriu');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Tutor: busca acha a conversa pelo conteúdo e reabre', async () => {
    await nav('today');
    await page.keyboard.press('Control+k'); await page.fill('.pal-in input', 'denominador mostra'); await wait(200);
    const item = page.locator('.pal-item:has-text("Conversa")').first();
    assert(await item.count() === 1 && (await item.textContent()).includes('denominador'), 'conversa não aparece na busca');
    await item.click(); await wait(500);
    assert(await page.textContent('#view-title') === 'Tutor IA' && await page.locator('.tt-msg.bot').count() === 2, 'não reabriu a conversa');
  });

  // ================= GRAVADOR DE AULA =================
  console.log('Gravador de aula (microfone simulado)');
  const aulaNote = async () => (await idb('notes')).find(n => n.title.startsWith('Aula — '));
  await step('Gravar aula pelo +: cria a anotação, grava o microfone e salva no banco', async () => {
    await nav('today');
    await page.click('#fab'); await page.click('.quick[data-q=record]');
    await page.waitForSelector('#rec-pill:not([hidden])', { timeout: 8000 });
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'anotação da aula não abriu');
    await wait(3300);
    assert(await page.locator('#ed-rec.recording').count() === 1, 'botão de gravar não ficou vermelho');
    assert(/0:0[2-5]/.test(await page.textContent('#rec-pill')), 'cronômetro: ' + await page.textContent('#rec-pill'));
    await page.screenshot({ path: path.join(OUT, 'gravando.png') });
    await page.click('#rec-pill');
    await toastHas('Gravação salva', 8000);
    const recs = await idb('recordings');
    const note = await aulaNote();
    assert(recs.length === 1 && recs[0].noteId === note.id && recs[0].duration >= 2 && recs[0].size > 1000 && !recs[0].partial, 'gravação: ' + JSON.stringify({ n: recs.length, d: recs[0] && recs[0].duration, s: recs[0] && recs[0].size }));
    const ok = await page.evaluate(() => new Promise(res => { const o = indexedDB.open('caderno-estudos'); o.onsuccess = () => { const q = o.result.transaction('recordings').objectStore('recordings').getAll(); q.onsuccess = () => { const b = q.result[0].blob; res(b instanceof Blob && b.size > 1000 && b.type.startsWith('audio/')); }; }; }));
    assert(ok, 'o áudio não ficou salvo no banco');
    assert(await page.locator('#ed-rec.recording').count() === 0 && await page.locator('#rec-pill').isHidden(), 'continuou parecendo gravar');
  });
  await step('Gravações: ouvir, resumo do áudio pela IA e escrever na anotação', async () => {
    await page.click('#ed-recs'); await page.waitForSelector('.rc-item audio');
    const n0 = gemReqs.length;
    await page.click('.rc-item [data-ai=summary]');
    await page.waitForFunction(() => /Aula de frações/.test(document.getElementById('rc-out')?.textContent || ''), null, { timeout: 15000 });
    const parts = gemReqs[n0].body.contents[0].parts;
    assert(parts.some(p => p.inline_data && /^audio\/webm/.test(p.inline_data.mime_type) && p.inline_data.data.length > 1000), 'o áudio não foi enviado ao Gemini');
    await page.click('#rc-acts .btn:has-text("Escrever na anotação")'); await wait(500); await saved();
    const texts = (await contentOf((await aulaNote()).title)).pages.flatMap(p => p.texts.map(t => t.text)).join('\n');
    assert(texts.includes('Frações representam partes de um inteiro'), 'resumo não foi escrito na anotação: ' + texts.slice(0, 120));
    assert((await idb('recordings'))[0].summary.includes('Aula de frações'), 'resumo não ficou salvo na gravação');
    assert(await page.locator('#rc-out').count() === 0 && await page.locator('.rc-item').count() === 1, 'janela errada fechou');
  });
  await step('Gravações: tarefas e datas ditas na aula viram tarefas', async () => {
    const t0 = (await idb('tasks')).length;
    await page.click('.rc-item [data-ai=tasks]');
    await page.waitForSelector('#rc-acts .btn:has-text("Criar estas tarefas")', { timeout: 15000 });
    await page.click('#rc-acts .btn:has-text("Criar estas tarefas")'); await wait(500);
    const ts = await idb('tasks');
    assert(ts.length === t0 + 2 && ts.some(t => t.title === 'Estudar frações para a prova de sexta') && !ts.some(t => /Tarefas da aula/.test(t.title)), 'tarefas da gravação: ' + ts.slice(t0).map(t => t.title).join(' | '));
    await closeModals();
    await page.click('#ed-back'); await wait(900);
  });
  await step('Caderno mostra o 🎙️ na anotação gravada e o menu abre as gravações', async () => {
    await nav('all');
    const card = page.locator('.card[data-id]:has-text("Aula — ")');
    assert((await card.locator('.rec-badge').textContent()).includes('1'), 'selo de gravação');
    await card.locator('.more').click(); await page.click('.menu-item:has-text("Gravações da aula (1)")');
    await page.waitForSelector('.rc-item audio');
    await closeModals();
  });

  // ================= SUGESTÕES, MAPA DO ANO E BUSCA =================
  console.log('O que fazer agora, mapa do ano e busca no conteúdo');
  await step('Hoje: "O que fazer agora" sugere a tarefa atrasada e já começa o foco nela', async () => {
    await page.evaluate(async () => {
      const st = await import('./js/store.js');
      const d = new Date(Date.now() - 40 * 86400000), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await st.db.put('tasks', { id: 'atrasada-1', title: 'Trabalho de História', done: false, due: day, prio: 3, folderId: '', createdAt: Date.now() });
      localStorage.removeItem('caderno-foco');
    });
    await page.reload(); await wait(1500);
    const sg = page.locator('.sg:has-text("Trabalho de História")');
    assert(await sg.count() === 1, 'sugestão da tarefa atrasada não apareceu: ' + (await page.locator('.sg-txt b').allTextContents()).join(' | '));
    assert((await sg.textContent()).includes('Atrasada'), 'motivo da sugestão');
    await sg.locator('[data-sg]').click(); await wait(500);
    assert(await page.textContent('#view-title') === 'Foco', 'não levou ao foco');
    assert(await page.$eval('#fc-task', s => s.value) === 'atrasada-1', 'o foco não ficou ligado à tarefa');
    await page.click('#fc-stop', { timeout: 3000 }); await wait(300);
    assert(!(await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-foco')).running)), '"Encerrar e salvar" não parou o foco');
  });
  await step('Relatório: mapa de estudos do ano com os dias estudados', async () => {
    await nav('report');
    const n = await page.locator('.hm-grid .hm').count();
    assert(n >= 365 && n <= 371, 'dias no mapa: ' + n);
    assert(await page.locator('.hm-grid .hm:not(.l0)').count() >= 1, 'nenhum dia marcado como estudado');
    await page.locator('.hm-grid .hm').last().click();
    assert((await page.textContent('#hm-tip')).includes(':'), 'detalhe do dia');
  });
  await step('Busca encontra texto dentro das notas rápidas', async () => {
    await page.keyboard.press('Control+k'); await page.fill('.pal-in input', 'calculadora'); await wait(200);
    const item = page.locator('.pal-item:has-text("Nota rápida")').first();
    assert((await item.textContent()).includes('calculadora'), 'trecho da nota rápida');
    await item.click(); await wait(400);
    assert(await page.textContent('#view-title') === 'Notas rápidas', 'não abriu as notas rápidas');
  });
  await step('Flashcards: botão Ouvir lê a carta', async () => {
    await page.evaluate(async () => { const st = await import('./js/store.js'); const cs = await st.db.all('cards'); const c = cs[0]; c.due = '2000-01-01'; await st.db.put('cards', c); });
    await page.reload(); await wait(1300);
    await nav('cards'); await page.click('#cd-study'); await page.waitForSelector('#rv-say');
    await page.evaluate(() => { window.__falas = []; speechSynthesis.speak = u => window.__falas.push(u.text); });
    const front = await page.textContent('.flash-front');
    await page.click('#rv-say'); await wait(200);
    assert((await page.evaluate(() => window.__falas)).join(' ').includes(front.trim().slice(0, 10)), 'não leu a frente da carta');
    assert(!(await page.locator('.flash.shown').count()), 'o botão Ouvir virou a carta');
    await page.click('#rv-quit'); await wait(300);
  });
  await step('Excluir tarefa tem "Desfazer"', async () => {
    await nav('tasks'); await page.click('#task-mode [data-m=list]'); await wait(200);
    const first = page.locator('#task-list .task').first();
    const id = await first.getAttribute('data-id');
    await first.locator('[data-del]').click(); await wait(300);
    assert(!(await idb('tasks')).some(t => t.id === id), 'não excluiu');
    await page.click('#toast .toast-btn'); await wait(400);
    assert((await idb('tasks')).some(t => t.id === id), 'desfazer não trouxe a tarefa');
    assert(await page.locator(`#task-list .task[data-id="${id}"]`).count() === 1, 'tarefa não voltou para a lista');
  });

  // ================= BANCO DE DADOS E BACKUP =================
  console.log('Banco de dados, cópias e backup');
  const STORES = ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades', 'classes', 'journal', 'goals', 'quizzes', 'quicknotes', 'chats', 'recordings', 'events'];
  await step('Dados e backup: a tela mostra o que está salvo no banco', async () => {
    await page.click('#btn-data'); await page.waitForSelector('.db-counts');
    assert(await page.locator('.db-counts div').count() === 18, 'caixas: ' + await page.locator('.db-counts div').count());
    const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.db-counts div')].map(d => [d.querySelector('span').textContent, +d.querySelector('b').textContent])));
    const real = { 'Anotações': 'notes', 'Tarefas': 'tasks', 'Notas rápidas': 'quicknotes', 'Gravações de aula': 'recordings', 'Conversas com o tutor': 'chats', 'Flashcards': 'cards', 'Pastas': 'folders' };
    for (const [label, s] of Object.entries(real)) { const n = (await idb(s)).length; assert(shown[label] === n, `${label}: tela ${shown[label]} ≠ banco ${n}`); }
    assert((await page.textContent('#dt-saved')) !== 'ainda não', 'último salvamento');
  });
  await step('Cópia no banco: fazer agora, mudar os dados e voltar no tempo', async () => {
    await page.click('#dt-snap'); await toastHas('Cópia feita');
    await page.waitForSelector('.snap-row');
    const snaps = await idb('snapshots');
    assert(snaps.length >= 1 && snaps.length <= 3, 'cópias no banco: ' + snaps.length);
    const t0 = (await idb('tasks')).length;
    await page.evaluate(async () => { const st = await import('./js/store.js'); await st.db.put('tasks', { id: 'depois-da-copia', title: 'Feita depois da cópia', done: false, due: '', prio: 2, createdAt: Date.now() }); });
    await page.click('.snap-row >> nth=0 >> [data-snap]'); await page.click('.modal-actions .btn.primary');
    await toastHas('Cópia restaurada', 10000);
    const ts = await idb('tasks');
    assert(ts.length === t0 && !ts.some(t => t.id === 'depois-da-copia'), 'não voltou no tempo');
    assert((await idb('recordings')).length === 1, 'restaurar a cópia apagou a gravação');
    assert((await idb('snapshots')).length <= 3, 'guardou cópias demais');
  });
  await step('Verificar e reparar corrige ligações quebradas', async () => {
    await page.evaluate(async () => {
      const st = await import('./js/store.js');
      await st.db.put('tasks', { id: 'tarefa-orfa', title: 'Tarefa de anotação apagada', done: false, due: '', prio: 2, noteId: 'anotacao-que-nao-existe', createdAt: Date.now() });
      await st.db.put('cards', { id: 'carta-orfa', deckId: 'baralho-que-sumiu', front: 'Pergunta perdida', back: 'Resposta', due: '2000-01-01', interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: Date.now() });
    });
    await page.click('#dt-check');
    await page.waitForFunction(() => /Corrigido/.test(document.getElementById('dt-check-out')?.textContent || ''), null, { timeout: 8000 });
    const t = (await idb('tasks')).find(x => x.id === 'tarefa-orfa');
    const c = (await idb('cards')).find(x => x.id === 'carta-orfa');
    const deck = (await idb('decks')).find(d => d.id === c.deckId);
    assert(t.noteId === '' && deck && deck.name === 'Recuperados', 'não reparou');
    await page.click('#dt-check');
    await page.waitForFunction(() => /está tudo certo/.test(document.getElementById('dt-check-out')?.textContent || ''), null, { timeout: 8000 });
  });
  let fullBackup;
  await step('Backup em arquivo leva tudo (até as gravações), mas não a chave da IA', async () => {
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#dt-export'); const d = await dl; fullBackup = path.join(OUT, 'backup-completo.json'); await d.saveAs(fullBackup);
    const data = JSON.parse(fs.readFileSync(fullBackup, 'utf8'));
    for (const s of STORES) assert(Array.isArray(data[s]) && data[s].length === (await idb(s)).length, 'faltou ou incompleto: ' + s);
    assert(data.quicknotes.length >= 2 && data.chats.length === 1 && data.recordings.length === 1, 'dados novos ausentes');
    assert(/^data:audio\/webm/.test(data.recordings[0].audio) && data.recordings[0].audio.length > 2000, 'o áudio não foi no backup');
    assert(data.prefs && Object.keys(data.prefs).some(k => k.startsWith('caderno-')), 'preferências não foram no backup');
    assert(!fs.readFileSync(fullBackup, 'utf8').includes('chave-teste'), 'a chave da IA foi para o backup!');
  });
  await step('Restaurar em outro tablet traz notas rápidas, conversas e o áudio', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); } catch { /* */ } });
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(base); await p2.waitForTimeout(1200);
    await p2.click('#btn-data'); await p2.waitForSelector('#dt-import');
    await p2.setInputFiles('#backup-input', fullBackup);
    await p2.waitForSelector('.modal h2:has-text("Restaurar backup")');
    await p2.click('.modal-actions .btn.danger');
    await p2.waitForFunction(() => (document.getElementById('toast') || {}).textContent?.includes('Backup restaurado'), null, { timeout: 30000 });
    const nq = JSON.parse(fs.readFileSync(fullBackup, 'utf8')).quicknotes.length;
    await p2.waitForFunction(n => [...document.querySelectorAll('.db-counts div')].some(d => d.textContent === n + 'Notas rápidas'), nq, { timeout: 8000 }).catch(() => {});
    const r = await p2.evaluate(() => new Promise(res => {
      const o = indexedDB.open('caderno-estudos');
      o.onsuccess = () => {
        const tx = o.result.transaction(['quicknotes', 'chats', 'recordings', 'notes']); const out = {}; let n = 0;
        for (const s of ['quicknotes', 'chats', 'recordings', 'notes']) { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; if (++n === 4) res({ q: out.quicknotes.length, c: out.chats.length, notes: out.notes.length, rec: out.recordings.length, blob: !!out.recordings[0] && out.recordings[0].blob instanceof Blob && out.recordings[0].blob.size > 1000 }); }; }
      };
    }));
    const shown = await p2.evaluate(() => [...document.querySelectorAll('.db-counts div')].map(d => d.textContent).join(' | '));
    await c2.close();
    const data = JSON.parse(fs.readFileSync(fullBackup, 'utf8'));
    assert(r.q === data.quicknotes.length && r.c === 1 && r.rec === 1 && r.blob && r.notes === data.notes.length, 'restauração: ' + JSON.stringify(r));
    assert(shown.includes(`${data.quicknotes.length}Notas rápidas`), 'tela de dados não atualizou: ' + shown);
  });
  await step('Fechar e abrir o app: tudo continua lá (banco e telas)', async () => {
    const before = {}; for (const s of STORES) before[s] = (await idb(s)).length;
    const ui = async () => {
      await nav('quick'); const q = await page.locator('.qn-card').count();
      await nav('tutor'); const c = await page.locator('.tt-item').count();
      await nav('tasks'); const t = await page.textContent('#nav-main [data-k=tasks] em').catch(() => '');
      return { q, c, t };
    };
    const u0 = await ui();
    await page.reload(); await wait(1500);
    const after = {}; for (const s of STORES) after[s] = (await idb(s)).length;
    const u1 = await ui();
    assert(JSON.stringify(before) === JSON.stringify(after), 'banco mudou: ' + JSON.stringify({ before, after }));
    assert(JSON.stringify(u0) === JSON.stringify(u1) && u0.q >= 2 && u0.c === 1, 'telas diferentes: ' + JSON.stringify({ u0, u1 }));
  });
  await step('Telas novas no tablet em pé e no tema escuro: nada estoura a largura', async () => {
    await page.click('#btn-settings'); await page.click('#s-theme [data-t=dark]'); await page.click('.modal-actions .btn.primary'); await wait(200);
    const bad = [];
    let qbg = '';
    for (const [w, hh] of [[800, 1280], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: hh }); await wait(250);
      for (const k of ['today', 'quick', 'tutor', 'data', 'report']) {
        await page.evaluate(k => { document.body.classList.remove('side-open'); (k === 'data' ? document.getElementById('btn-data') : document.querySelector(`#nav-main [data-k=${k}]`)).click(); }, k); await wait(400);
        const over = await page.evaluate(() => document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth);
        if (over > 2) bad.push(`${k} ${w}px (+${over})`);
        if (k === 'quick') qbg = await page.evaluate(() => getComputedStyle(document.querySelector('.qn-card')).backgroundColor);
        await page.screenshot({ path: path.join(OUT, `novas-${w > hh ? 'deitado' : 'em-pe'}-escuro-${k}.png`) });
      }
    }
    await page.click('#btn-settings'); await page.click('#s-theme [data-t=auto]'); await page.click('.modal-actions .btn.primary'); await wait(200);
    assert(!bad.length, 'estouram a largura: ' + bad.join(', '));
    assert(qbg && qbg !== 'rgb(255, 244, 184)', 'nota rápida continua clara no tema escuro: ' + qbg);
  });

  // ================= ESCRITA ORGANIZADA =================
  console.log('Escrita organizada com fontes manuscritas');
  const scribble = async (x, y) => {
    const b = await stageBox();
    await page.mouse.move(b.x + x, b.y + y); await page.mouse.down();
    for (let i = 1; i < 12; i++) await page.mouse.move(b.x + x + i * 12, b.y + y + (i % 2 ? 12 : -12), { steps: 2 });
    await page.mouse.up(); await wait(2300);
  };
  const flowTexts = async (pi = 0) => (await contentOf('Redação')).pages[pi].texts.filter(t => t.flow).sort((a, b) => a.para - b.para || a.ord - b.ord);
  await step('Escrita organizada: escreve em qualquer lugar e vira texto manuscrito nas linhas; ponto final abre parágrafo', async () => {
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Redação'); await page.click('.paper-opts[data-g=type] [data-v=lines]'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    await page.selectOption('#ed-auto', 'flow'); await wait(200);
    assert(await page.locator('#ed-flowopts').isVisible() && await page.locator('#ed-para-box').isVisible(), 'menu de fonte/tamanho/parágrafo');
    await page.selectOption('#ed-font', 'caveat'); await page.selectOption('#ed-fsize', '30'); await page.selectOption('#ed-para', '80');
    recogQueue.push('Hoje estudei a fotossíntese', 'nas plantas.', 'Elas produzem glicose');
    await scribble(600, 150); await scribble(150, 300); await scribble(500, 420); await saved();
    const c = await contentOf('Redação');
    assert(c.pages[0].strokes.length === 0, 'a escrita à mão devia sumir depois de virar texto');
    const t = await flowTexts();
    assert(t.length === 2 && t[0].text === 'Hoje estudei a fotossíntese nas plantas.' && t[1].text === 'Elas produzem glicose', 'texto: ' + t.map(x => x.text).join(' | '));
    assert(t[0].para === 0 && t[1].para === 1 && t[1].y - t[0].y === 40, 'o ponto final devia abrir parágrafo na linha de baixo');
    assert(t[0].x === 190 && t[1].x === 190, 'recuo de parágrafo médio (80): ' + t.map(x => x.x));
    assert(t.every(x => x.font === 'caveat' && x.size === 30), 'fonte manuscrita');
    assert(await page.evaluate(() => document.fonts.check('30px "Caveat"')), 'fonte não carregou');
  });
  await step('Escrita organizada: cor da caneta, recuo e fonte mudam pelo menu; desfazer funciona', async () => {
    await page.click('#tool-opts [data-c="#e5352b"]').catch(() => {});
    recogQueue.push('usando luz do sol.');
    await scribble(300, 250); await saved();
    let t = await flowTexts();
    assert(t.length === 3 && t[2].text === 'usando luz do sol.' && t[2].color === '#e5352b' && t[2].para === 1, 'cor/emenda: ' + JSON.stringify(t.map(x => [x.text, x.color, x.para])));
    await page.selectOption('#ed-para', '0'); await saved();
    t = await flowTexts();
    assert(t[0].x === 110 && t[1].x === 110, 'sem recuo: ' + t.map(x => x.x));
    await page.selectOption('#ed-font', 'dancing'); await saved();
    assert((await flowTexts()).every(x => x.font === 'dancing'), 'trocar fonte');
    await page.screenshot({ path: path.join(OUT, 'escrita-organizada.png') });
    await page.click('#ed-undo'); await saved();
    assert((await flowTexts()).every(x => x.font === 'caveat'), 'desfazer');
    await page.click('#tool-opts [data-c="#1d1d1f"]').catch(() => {});
  });
  await step('Escrita organizada: quando a folha enche, o texto continua na página seguinte', async () => {
    recogQueue.push(Array.from({ length: 70 }, (_, i) => `Frase número ${i + 1} sobre o ciclo da água e da fotossíntese`).join(', ') + '.');
    await scribble(400, 200); await saved();
    const c = await contentOf('Redação');
    assert(c.pages.length === 2 && c.pages[0].flowFull && c.pages[1].texts.some(t => t.flow), 'não continuou na página 2');
    assert((await page.textContent('#pg-label')).trim().startsWith('2 '), 'devia ir para a página 2');
    const all = [...c.pages[0].texts, ...c.pages[1].texts].filter(t => t.flow).map(t => t.text).join(' ');
    assert(all.includes('Frase número 1 ') && all.includes('Frase número 70 '), 'texto perdido na troca de página');
    assert(c.pages[0].texts.filter(t => t.flow).every(t => t.y < 1414 - 40), 'texto passou do fim da folha');
    await page.selectOption('#ed-auto', 'off');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Escrita organizada: na folha Cornell o texto vai para a coluna de anotações, nas pautas dela', async () => {
    const r = await page.evaluate(async () => {
      const f = await import('./js/flow.js');
      const g = f.paperGeom({ type: 'cornell' });
      const out = f.layoutFlow([{ runs: [{ text: 'Mitose é a divisão celular.', color: '#1d1d1f' }] }], { size: 30, indent: 0, startY: f.snapLine(150, g), geom: g });
      return { x: out.items[0].x, start: f.snapLine(150, g), g };
    });
    assert(r.x === 300 && r.start === 220, 'Cornell: ' + JSON.stringify(r));
  });

  // ================= FÓRMULAS =================
  console.log('Fórmulas de matemática e física');
  const fmIn = k => page.locator(`.fm-card.open input[data-k="${k}"]`);
  await step('Fórmulas: busca pelo nome e calcula sozinha o valor que falta', async () => {
    await nav('formulas');
    await page.fill('#fm-q', 'qual a fórmula da área da circunferência'); await wait(200);
    assert(await page.locator('.fm-card.open[data-fid="a-circulo"]').count() === 1, 'não abriu a área do círculo: ' + await page.locator('.fm-card.open .fm-head b').textContent().catch(() => '-'));
    assert((await page.textContent('.fm-card.open .fm-expr')) === 'A = π · r²', 'fórmula errada');
    await fmIn('r').fill('5'); await wait(100);
    assert(await fmIn('A').inputValue() === '78,5398' && await page.locator('.fm-card.open input.fm-auto[data-k="A"]').count() === 1, 'área calculada: ' + await fmIn('A').inputValue());
    assert((await page.textContent('.fm-card.open .fm-out')).includes('Área = 78,5398 u²'), 'resultado');
    // ao contrário: sabendo a área, descobre o raio
    await fmIn('A').fill('50'); await fmIn('r').fill(''); await wait(100);
    assert(await fmIn('r').inputValue() === '3,9894', 'raio a partir da área: ' + await fmIn('r').inputValue());
    await page.fill('#fm-q', 'velocidade com aceleração'); await wait(200);
    assert(await page.locator('.fm-card.open[data-fid="muv-v"]').count() === 1, 'MUV');
    await fmIn('v0').fill('2'); await fmIn('a').fill('3'); await fmIn('t').fill('4'); await wait(100);
    assert(await fmIn('v').inputValue() === '14', 'v = v0 + a·t: ' + await fmIn('v').inputValue());
    const q0 = (await idb('quicknotes')).length;
    await page.click('.fm-card.open [data-fm=quick]'); await wait(400);
    const qn = (await idb('quicknotes')).slice(-1)[0];
    assert((await idb('quicknotes')).length === q0 + 1 && /14/.test(qn.text) && /v₀/.test(qn.text), 'salvar em notas rápidas: ' + (qn && qn.text));
  });
  await step('Fórmulas: Bhaskara, filtro de física e busca sem resultado leva ao tutor', async () => {
    await page.fill('#fm-q', 'bhaskara'); await wait(200);
    await fmIn('a').fill('1'); await fmIn('b').fill('-5'); await fmIn('c').fill('6'); await wait(100);
    const out = await page.textContent('.fm-card.open .fm-out');
    assert(out.includes('Δ = b² − 4ac = -5² − 4 · 1 · 6 = 1') || out.includes('= 1'), 'delta: ' + out);
    assert(/x₁ = .* = 3/.test(out) && /x₂ = .* = 2/.test(out), 'raízes: ' + out);
    await page.fill('#fm-q', ''); await page.click('.fm-areas [data-area=fis]'); await wait(200);
    const groups = await page.locator('h3.sec').allTextContents();
    assert(groups.includes('Eletricidade') && !groups.includes('Áreas'), 'filtro de física: ' + groups.join(','));
    await page.click('.fm-areas [data-area=all]');
    await page.fill('#fm-q', 'xyzwq'); await wait(200);
    assert(await page.locator('#fm-tutor').isVisible(), 'sem resultado devia oferecer o tutor');
    await page.fill('#fm-q', ''); await wait(100);
  });
  await step('Fórmulas: a busca geral (lupa) acha e abre a fórmula', async () => {
    await nav('today');
    await page.keyboard.press('Control+k'); await page.fill('.pal-in input', 'lei de ohm'); await wait(200);
    await page.click('.pal-item:has-text("Fórmula") >> nth=0'); await wait(400);
    assert(await page.textContent('#view-title') === 'Fórmulas' && await page.locator('.fm-card.open[data-fid="ohm"]').count() === 1, 'não abriu a lei de Ohm');
  });

  await step('nenhum erro de JavaScript em todo o teste', async () => {
    assert(!errors.length, errors.slice(0, 5).join(' | '));
  });

  await browser.close(); srv.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length} de ${results.length} testes passaram.${fail.length ? ' Falhas:\n' + fail.map(f => ' - ' + f.name + ': ' + f.err).join('\n') : ' ✅'}`);
  console.log(`Capturas de tela em ${OUT}\n`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
