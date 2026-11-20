// Teste completo do Caderno de Estudos: usa o app de verdade num navegador (Chromium),
// passando por todas as funções e conferindo os dados salvos.
// Como rodar:  npm i -D playwright && npx playwright install chromium && node tests/teste-completo.cjs
// Os serviços externos (reconhecimento de escrita do Google e API da Anthropic) são simulados.
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
async function mocks(c) {
  await c.route('https://inputtools.google.com/**', async r => {
    const n = JSON.parse(r.request().postData()).requests[0].ink.length;
    const ans = n >= 5 ? ['2+3=6', '2+3=b'] : ['casa', 'Casa', 'cara'];
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(['SUCCESS', [['x', ans, [], {}]]]) });
  });
  await c.route('https://api.anthropic.com/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const body = JSON.parse(r.request().postData());
    const h = await r.request().allHeaders();
    if (JSON.stringify(h).includes('sk-ant-invalida')) return r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    const last = body.messages[body.messages.length - 1];
    const txt = typeof last.content === 'string' ? last.content : last.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
    let reply;
    if (/Responda apenas/.test(txt)) reply = 'Tudo certo!';
    else if (/plano de estudo|Analise minha semana/i.test(txt)) reply = '# Análise\n- Você estudou bem.\n\n# Tarefas\n- Revisar frações\n- Fazer simulado de matemática\n';
    else if (/flashcards/i.test(txt)) reply = 'P: Quanto é 3/4 + 1/4?\nR: 1\n\nP: O que é o denominador?\nR: O número de baixo da fração.\n\nP: 1/2 equivale a quantos quartos?\nR: 2/4';
    else if (/plano de estudo|Analise minha semana/i.test(txt)) reply = '# Análise\n- Você estudou bem.\n\n# Tarefas\n- Revisar frações\n- Fazer simulado de matemática\n';
    else reply = '# Resumo\n- Fração representa partes de um inteiro.\n- Numerador em cima, denominador embaixo.\n\n# Para lembrar\n1. Some numeradores quando o denominador é igual.';
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    let sse = ev('message_start', { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    sse += ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    for (const ch of reply.match(/[\s\S]{1,30}/g)) sse += ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ch } });
    sse += ev('content_block_stop', { type: 'content_block_stop', index: 0 });
    sse += ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } });
    sse += ev('message_stop', { type: 'message_stop' });
    await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse });
  });
}

let groqReqs = [], groqMode = 'ok';
async function groqMock(c) {
  await c.route('https://api.groq.com/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const h = await r.request().allHeaders();
    const body = JSON.parse(r.request().postData());
    groqReqs.push({ h, body });
    const cors = { 'access-control-allow-origin': '*' };
    if (/gsk_invalida/.test(h.authorization || '')) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid API Key', type: 'invalid_request_error' } }) });
    if (groqMode === '429') return r.fulfill({ status: 429, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Rate limit reached' } }) });
    const first = body.messages[0].content;
    const txt = typeof first === 'string' ? first : first.filter(p => p.type === 'text').map(p => p.text).join(' ');
    const reply = /Responda apenas/.test(txt) ? 'Tudo certo!' : '# Resumo pela Groq\n- Frações são partes de um inteiro.';
    let sse = '';
    for (const ch of reply.match(/[\s\S]{1,12}/g)) sse += `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] })}\n\n`;
    sse += `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse });
  });
}

function watch(p) {
  p.on('pageerror', e => errors.push('ERRO DE PÁGINA: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
}

(async () => {
  const srv = await serve();
  base = `http://127.0.0.1:${srv.address().port}/`;
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, acceptDownloads: true, locale: 'pt-BR', permissions: ['clipboard-read', 'clipboard-write'] });
  await mocks(ctx);
  await groqMock(ctx);
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
    assert((await contentOf('Frações e decimais')).pages[1].texts.some(t => t.text === 'casa'), 'não converteu');
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
  await step('chave inválida mostra erro claro', async () => {
    await page.click('#ed-settings'); await page.fill('#s-aikey', 'sk-ant-invalida'); await page.click('#s-aitest'); await wait(1500);
    assert((await page.textContent('#s-aistatus')).includes('Chave da API inválida'), 'erro não amigável');
    await page.fill('#s-aikey', 'sk-ant-teste'); await page.click('#s-aitest'); await wait(1200);
    assert((await page.textContent('#s-aistatus')).includes('Tudo certo'), 'teste da chave falhou');
    await page.click('.modal .btn.primary'); await wait(300);
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
  await step('Kindle: link do app no Android e versão web no computador', async () => {
    const r = await page.evaluate(async () => {
      const m = await import('./js/perf.js');
      const k = { url: 'https://read.amazon.com/', pkg: 'com.amazon.kindle', scheme: 'kindle://home' };
      return [m.shortcutURL(k, true), m.shortcutURL(k, false)];
    });
    assert(r[0] === 'intent://home#Intent;scheme=kindle;package=com.amazon.kindle;S.browser_fallback_url=https%3A%2F%2Fread.amazon.com%2F;end', 'intent errado: ' + r[0]);
    assert(r[1] === 'https://read.amazon.com/', 'link web errado');
    const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await page.click('.kindle-hero [data-kindle]');
    assert(await popup, 'não abriu o Kindle');
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
    await page.click('#btn-settings');
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#s-export'); const d = await dl; backupFile = path.join(OUT, 'backup.json'); await d.saveAs(backupFile);
    await closeModals();
    const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    for (const s of ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades', 'classes', 'journal']) assert(Array.isArray(data[s]), 'faltou ' + s);
    assert(data.books.length === 1 && data.grades.length === 2, 'dados incompletos');
  });
  await step('restaura backup num tablet "novo"', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(base); await p2.waitForTimeout(1200);
    await p2.click('#btn-settings'); await p2.waitForSelector('.modal h2:has-text("Ajustes")'); await p2.setInputFiles('#backup-input', backupFile); await p2.waitForSelector('.modal h2:has-text("Restaurar backup")');
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
    for (const k of ['today', 'calendar', 'schedule', 'tasks', 'focus', 'cards', 'habits', 'journal', 'reading', 'grades', 'report', 'all']) {
      await page.evaluate(k => { document.body.classList.remove('side-open'); document.querySelector(`#nav-main [data-k=${k}]`).click(); }, k); await wait(250);
      const over = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#main *')].map(e => e.getBoundingClientRect().right)) - window.innerWidth);
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

  // ================= GROQ =================
  console.log('IA pela Groq (respostas simuladas)');
  await step('Groq: chave inválida e chave válida no "Testar"', async () => {
    await page.goto(base); await wait(1200);
    await page.click('#btn-settings'); await page.click('#s-provider [data-p=groq]');
    assert(await page.locator('#s-groqkey').isVisible(), 'campos da Groq não apareceram');
    await page.fill('#s-groqkey', 'gsk_invalida'); await page.click('#s-aitest'); await wait(1000);
    assert((await page.textContent('#s-aistatus')).includes('Chave da Groq inválida'), 'erro 401 não amigável');
    await page.fill('#s-groqkey', 'gsk_teste'); await page.click('#s-aitest'); await wait(1000);
    assert((await page.textContent('#s-aistatus')).includes('Groq funcionando: Tudo certo'), 'teste falhou: ' + await page.textContent('#s-aistatus'));
    await page.click('.modal-actions .btn.primary'); await wait(300);
    const last = groqReqs[groqReqs.length - 1];
    // modelo antigo (desligado pela Groq) salvo de versões anteriores é trocado sozinho
    const migr = await page.evaluate(async () => { const st = await import('./js/store.js'); const ai = await import('./js/ai.js'); const old = st.settings.groqModel; st.settings.groqModel = 'meta-llama/llama-4-scout-17b-16e-instruct'; const m = ai.groqModel(); st.settings.groqModel = old; return m; });
    assert(migr === 'qwen/qwen3.8-27b', 'não trocou modelo descontinuado');
    assert(last.h.authorization === 'Bearer gsk_teste' && last.body.stream === true && last.body.model === 'qwen/qwen3.8-27b' && last.body.reasoning_format === 'hidden', 'pedido errado: ' + JSON.stringify({ m: last.body.model, r: last.body.reasoning_format }));
  });
  await step('Groq: resumo de todas as páginas envia no máximo 3 imagens (limite do Qwen 3.8)', async () => {
    await nav('all');
    await page.click('.card:has-text("Frações e decimais")'); await wait(900);
    await page.click('#ed-ai'); await page.click('#ai-scope [data-s=all]');
    await page.click('.ai-act[data-a=summary]'); await page.waitForSelector('.ai-turn.assistant:not(.streaming) .ai-result', { timeout: 10000 });
    const b = groqReqs[groqReqs.length - 1].body;
    const parts = b.messages[0].content;
    const imgs = parts.filter(p => p.type === 'image_url');
    assert(imgs.length === 3, 'imagens: ' + imgs.length);
    assert(imgs.every(p => p.image_url.url.startsWith('data:image/jpeg;base64,')), 'formato da imagem');
    assert(parts[0].type === 'text' && parts[0].text.includes('assistente de estudos'), 'instruções ausentes');
    assert((await page.textContent('.ai-turn.assistant')).includes('Resumo pela Groq'), 'resposta não apareceu');
  });
  await step('Groq: pergunta de acompanhamento mantém a conversa', async () => {
    await page.fill('#ai-q', 'Explique o denominador'); await page.click('#ai-send');
    await page.waitForFunction(() => document.querySelectorAll('.ai-turn.assistant:not(.streaming)').length >= 2, null, { timeout: 8000 });
    const m = groqReqs[groqReqs.length - 1].body.messages;
    assert(m.length === 3 && m[1].role === 'assistant' && typeof m[1].content === 'string' && m[2].content === 'Explique o denominador', 'histórico errado');
  });
  await step('Groq: limite atingido mostra aviso claro', async () => {
    groqMode = '429';
    await page.click('.ai-act[data-a=quiz]'); await page.waitForSelector('.ai-turn.error', { timeout: 8000 });
    assert((await page.textContent('.ai-turn.error')).includes('Limite da Groq'), 'mensagem do 429');
    groqMode = 'ok';
    await page.click('#ai-close'); await page.click('#ed-back'); await wait(900);
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
