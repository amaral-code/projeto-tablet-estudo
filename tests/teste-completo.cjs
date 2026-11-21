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
const ENEM_JSON = JSON.stringify([1, 2, 3, 4, 5].map(i => ({ texto: `Texto-base ${i}: um mercado vende 3 maçãs por R$ ${i},00.`, pergunta: `Questão ${i}: quanto custam 6 maçãs?`, alternativas: [`R$ ${2 * i},00`, `R$ ${3 * i},00`, `R$ ${i},00`, `R$ ${4 * i},00`, `R$ ${5 * i},00`], correta: 0, explicacao: `6 é o dobro de 3, então custa o dobro: R$ ${2 * i},00.` })));
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
  if (/estilo do ENEM/i.test(txt)) return ENEM_JSON;
  if (/mapa mental/i.test(txt)) return JSON.stringify({ centro: 'Frações', ramos: [{ titulo: 'Numerador', itens: ['fica em cima'] }, { titulo: 'Denominador', itens: ['fica embaixo', 'partes do inteiro'] }, { titulo: 'Soma', itens: ['mesmo denominador'] }, { titulo: 'Equivalentes', itens: ['1/2 = 2/4'] }] });
  if (/Traduza/.test(txt)) return 'Eu estou estudando há duas horas.\n\n# Palavras importantes\n- have been studying: presente perfeito contínuo';
  if (/errei esta questão/.test(txt)) return '# Por que\n- A certa é a alternativa indicada porque segue a regra.\n\nDica: leia o comando com atenção.';
  if (/assuntos principais para estudar/.test(txt)) return JSON.stringify({ 'Matemática': ['Frações', 'Porcentagem', 'Equação do 1º grau'], 'Português': ['Crase', 'Concordância'] });
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
    if (gemMode === '429two' && !url.includes('/models/gemini-3.5-flash:')) return err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota');
    if (gemMode === 'slowprimary' && primary) await new Promise(res => setTimeout(res, 8000));
    const reply = geminiReply(body);
    let sse = `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'pensando…', thought: true }] } }] })}\r\n\r\n`;
    for (const ch of reply.match(/[\s\S]{1,10}/g)) sse += `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: ch }] } }], modelVersion: 'gemini-x' })}\r\n\r\n`;
    sse += `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }] })}\r\n\r\n`;
    try { await r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse }); } catch { /* pedido já cancelado pelo app */ }
  });
}

// Wikipédia e Wikimedia Commons simulados (mesmo formato das respostas de verdade)
let wikiMode = 'ok';
async function wikiMock(c) {
  const cors = { 'access-control-allow-origin': '*' };
  const png = fs.readFileSync(path.join(ROOT, 'icons', 'icon-192.png'));
  await c.route('https://upload.wikimedia.org/**', r => r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: png }));
  // o endereço novo das miniaturas recusa: o app tem que baixar a mesma imagem pelo upload.wikimedia.org
  await c.route('https://thumb.wikimedia.org/**', r => r.fulfill({ status: 403, body: 'forbidden' }));
  await c.route(/https:\/\/(pt|en)\.wikipedia\.org\/w\/api\.php.*/, r => {
    if (wikiMode === '429') return r.fulfill({ status: 429, headers: cors, body: 'You are making too many requests' });
    if (wikiMode === '429once') { wikiMode = 'ok'; return r.fulfill({ status: 429, headers: cors, body: 'You are making too many requests' }); }
    const pages = { 101: { pageid: 101, index: 1, title: 'Bhaskara II', description: 'matemático indiano do século XII', thumbnail: { source: 'https://thumb.wikimedia.org/x/Bhaskara.png', width: 400, height: 400 }, pageimage: 'Bhaskara.png' },
      102: { pageid: 102, index: 2, title: 'Fórmula de Bhaskara', description: 'fórmula da equação do segundo grau', thumbnail: { source: 'https://upload.wikimedia.org/x/Formula.png', width: 400, height: 200 }, pageimage: 'Formula.png' },
      103: { pageid: 103, index: 3, title: 'Equação quadrática' } };
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ query: { pages } }) });
  });
  await c.route(/https:\/\/commons\.wikimedia\.org\/w\/api\.php.*/, r => {
    if (wikiMode === '429') return r.fulfill({ status: 429, headers: cors, body: 'You are making too many requests' });
    const u = r.request().url();
    if (u.includes('titles=')) return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ query: { pages: { '-1': { imageinfo: [{ extmetadata: { Artist: { value: '<a href="x">Autor do retrato</a>' }, LicenseShortName: { value: 'Domínio público' } } }] } } } }) });
    const ii = (n, mime) => ({ pageid: 200 + n, index: n, title: `File:Imagem ${n}.png`, imageinfo: [{ mime, thumburl: `https://upload.wikimedia.org/x/img${n}.png`, descriptionurl: 'https://commons.wikimedia.org/wiki/File:x', extmetadata: { Artist: { value: '<b>Fulano</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ObjectName: { value: `Desenho ${n}` } } }] });
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ query: { pages: { 201: ii(1, 'image/png'), 202: ii(2, 'image/svg+xml'), 203: ii(3, 'application/pdf') } } }) });
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
  await ctx.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); } catch { /* */ } });
  await geminiMock(ctx);
  await wikiMock(ctx);
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
    assert(casa.size === 30 && casa.font === 'dancing', 'o texto convertido devia ficar do tamanho da linha, em cursiva (escrito num traço só): ' + JSON.stringify(casa));
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
  await step('Agenda: aviso na véspera (notificação do tablet + aviso no app) e só uma vez', async () => {
    await page.evaluate(async d => {
      const st = await import('./js/store.js');
      await st.db.put('events', { id: 'ev-amanha', title: 'Entrega do trabalho de Geografia', date: d, time: '07:30', prio: 3, kind: 'trabalho', notes: '', remind: true, createdAt: Date.now() });
      // véspera "às 00:00" para o aviso já estar na hora; os outros tipos ficam desligados neste teste
      localStorage.setItem('caderno-avisos', JSON.stringify({ eveTime: '00:00', tasks: false, cards: false, habits: false, classes: false, exams: false }));
    }, dplus(1));
    // o Chromium de teste não mostra notificações: simulamos a permissão do Android e guardamos o que seria mostrado
    await page.addInitScript(() => {
      try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch { /* */ }
      ServiceWorkerRegistration.prototype.showNotification = function (t, o) { (window.__notifs ||= []).push(`${t} | ${o && o.body} | ${o && o.data && o.data.url}`); return Promise.resolve(); };
    });
    await page.reload();
    await toastHas('Amanhã: Entrega do trabalho de Geografia', 8000);
    const shown = await page.evaluate(() => window.__notifs || []);
    assert(shown.some(t => t.includes('Amanhã: Entrega do trabalho de Geografia') && t.includes('07:30') && t.includes('ALTA') && t.includes('v=calendar')), 'notificação do tablet: ' + shown.join(' / '));
    const kv = (await idb('kv')).find(x => x.id === 'avisos');
    assert(kv && kv.fired[`ev-v-ev-amanha-${dplus(1)}`], 'não guardou o aviso dado');
    const n0 = await page.evaluate(async () => (await import('./js/notify.js')).tick());
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
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); } catch { /* */ } });
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
    for (const k of ['today', 'calendar', 'avisos', 'schedule', 'goals', 'tasks', 'quick', 'focus', 'cards', 'quiz', 'formulas', 'tutor', 'habits', 'journal', 'reading', 'grades', 'report', 'all', 'data']) {
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
    assert(await p3.locator('.tour .tour-logo').count() === 1, 'o primeiro passo mostra o logo');
    for (let i = 0; i < 5; i++) { await p3.click('.modal-actions .btn.primary'); await p3.waitForTimeout(150); }
    assert(await p3.textContent('.modal-actions .btn.primary') === 'Começar', 'último passo');
    assert(/IA/.test(await p3.textContent('.tour h3')), 'o último passo fala da IA');
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
    for (const k of ['today', 'tasks', 'quick', 'calendar', 'avisos', 'schedule', 'goals', 'all', 'focus', 'cards', 'quiz', 'formulas', 'tutor', 'reading', 'habits', 'journal', 'grades', 'report']) assert(await page.locator(`#nav-main [data-k=${k}]`).count() >= 1, 'faltou ' + k);
    assert((await page.textContent('#view-section')).includes('Planejar'), 'nome da área no topo');
  });
  await step('Tela "Tudo" mostra cada recurso e abre ao tocar', async () => {
    await page.click('#btn-map'); await wait(300);
    assert(await page.locator('.map-card').count() === 21, 'cartões: ' + await page.locator('.map-card').count());
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
    assert(await page.locator('.more-sheet .map-card').count() === 21, 'Mais incompleto: ' + await page.locator('.more-sheet .map-card').count());
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
  await step('Gemini: cota esgotada em dois modelos → o terceiro responde; nos três → aviso claro', async () => {
    gemMode = '429two'; let n0 = gemReqs.length;
    await page.click('.ai-act[data-a=summary]'); await wait(300);
    await page.waitForFunction(() => document.querySelectorAll('.ai-turn.assistant:not(.streaming) .ai-result').length >= 1 && !document.querySelector('.ai-turn.streaming'), null, { timeout: 15000 });
    assert(!(await page.locator('.ai-turn.error').count()), 'mostrou erro com o terceiro modelo livre');
    assert(gemReqs.slice(n0).map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash', 'fila de modelos: ' + gemReqs.slice(n0).map(modelOf));
    gemMode = '429'; n0 = gemReqs.length;
    await page.click('.ai-act[data-a=quiz]'); await page.waitForSelector('.ai-turn.error', { timeout: 8000 });
    assert((await page.textContent('.ai-turn.error')).includes('Limite do Gemini'), 'mensagem do 429');
    assert(gemReqs.slice(n0).map(modelOf).join(',') === 'gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash', 'a cota é por modelo: devia tentar os reservas');
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
  const STORES = ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades', 'classes', 'journal', 'goals', 'quizzes', 'quicknotes', 'chats', 'recordings', 'events', 'images', 'errors', 'plans'];
  await step('Dados e backup: a tela mostra o que está salvo no banco', async () => {
    await page.click('#btn-data'); await page.waitForSelector('.db-counts');
    assert(await page.locator('.db-counts div').count() === 21, 'caixas: ' + await page.locator('.db-counts div').count());
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
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); } catch { /* */ } });
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
      for (const k of ['today', 'quick', 'tutor', 'data', 'report', 'avisos', 'formulas', 'calendar', 'goals']) {
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

  await step('Letra: "igual à minha letra" (cursiva → cursiva, de forma → de forma) e tamanho Enorme em 2 linhas', async () => {
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Treino de letra'); await page.click('.paper-opts[data-g=type] [data-v=lines]'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    await page.selectOption('#ed-auto', 'flow'); await page.selectOption('#ed-font', 'auto'); await page.selectOption('#ed-fsize', '30'); await page.selectOption('#ed-para', '0');
    recogQueue.push('fotossíntese');
    await scribble(300, 150); // um traço só = cursiva
    recogQueue.push('casa.');
    const b = await stageBox();
    for (let i = 0; i < 6; i++) { // seis traços curtos separados = letra de forma
      await page.mouse.move(b.x + 400 + i * 30, b.y + 300); await page.mouse.down();
      await page.mouse.move(b.x + 410 + i * 30, b.y + 330, { steps: 3 }); await page.mouse.up();
    }
    await wait(2500); await saved();
    const t = (await contentOf('Treino de letra')).pages[0].texts.filter(x => x.flow).sort((a, c) => a.ord - c.ord);
    assert(t.length === 2 && t[0].text === 'fotossíntese' && t[0].font === 'dancing' && t[1].text === 'casa.' && t[1].font === 'patrick', 'estilo: ' + JSON.stringify(t.map(x => [x.text, x.font])));
    assert(t[0].y === t[1].y || Math.abs(t[0].y - t[1].y) < 6, 'as duas palavras deviam ficar na mesma linha');
    await page.selectOption('#ed-fsize', '60'); await saved();
    recogQueue.push('Nova frase grande.');
    await scribble(300, 300); await saved();
    const big = (await contentOf('Treino de letra')).pages[0].texts.filter(x => x.flow).sort((a, c) => a.para - c.para || a.ord - c.ord);
    assert(big.every(x => x.size === 60), 'tamanho Enorme');
    const lineOf = x => x.y; const p0 = big.filter(x => x.para === 0), p1 = big.filter(x => x.para === 1);
    assert(p1.length && Math.round(lineOf(p1[0]) - lineOf(p0[0])) >= 75, 'o tamanho Enorme devia pular duas linhas: ' + (lineOf(p1[0]) - lineOf(p0[0])));
    await page.selectOption('#ed-fsize', '30'); await page.selectOption('#ed-auto', 'off');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Letra encostada na linha em todas as fontes e tamanhos (medido nos pixels)', async () => {
    const r = await page.evaluate(async () => {
      const ink = await import('./js/ink.js'); const fl = await import('./js/flow.js');
      await ink.loadHandFonts();
      const bad = [];
      for (const font of [undefined, ...Object.keys(ink.HAND_FONTS)]) for (const size of [24, 30, 36, 44, 60]) {
        const { items } = fl.layoutFlow([{ runs: [{ text: 'aeno mnu', color: '#000' }] }], { font, size, indent: 0, startY: 200 });
        const c = document.createElement('canvas'); c.width = 1000; c.height = 400; const ctx = c.getContext('2d');
        ink.drawText(ctx, items[0]);
        const d = ctx.getImageData(0, 0, 1000, 400).data;
        let bottom = -1;
        for (let y = 0; y < 400; y++) for (let x = 0; x < 1000; x += 2) if (d[(y * 1000 + x) * 4 + 3] > 128) bottom = Math.max(bottom, y);
        if (bottom < 196 || bottom > 201) bad.push(`${font || 'normal'} ${size}: ${bottom - 200}px`);
      }
      return bad;
    });
    assert(!r.length, 'fora da linha: ' + r.join(', '));
  });

  // ================= BOTÃO IMAGEM =================
  console.log('Botão Imagem (busca na internet, simulada)');
  await step('Imagem: escreve o nome, aparecem várias, a escolhida vai para a folha com o nome em cima e fica salva', async () => {
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Matemáticos'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    assert(await page.locator('#ed-imgsearch').isVisible(), 'botão Imagem no editor');
    await page.click('#ed-imgsearch'); await page.fill('#is-q', 'Bhaskara'); await page.click('.is-form button[type=submit]');
    await page.waitForSelector('.is-item', { timeout: 8000 });
    const titles = await page.locator('.is-item b').allTextContents();
    assert(titles[0] === 'Bhaskara II' && titles.includes('Fórmula de Bhaskara') && titles.includes('Desenho 1') && titles.includes('Desenho 2') && !titles.includes('Desenho 3'), 'resultados: ' + titles.join(' | '));
    assert((await page.textContent('#is-status')).includes('4 imagens'), 'contagem');
    await page.click('.is-item >> nth=0'); await wait(1200); await saved();
    const pg = (await contentOf('Matemáticos')).pages[0];
    assert(pg.images.length === 1 && pg.images[0].src.startsWith('data:image/png'), 'imagem não foi para a folha');
    const name = pg.texts.find(t => t.text === 'Bhaskara II'), credit = pg.texts.find(t => t.credit);
    assert(name && name.y < pg.images[0].y, 'nome em cima da imagem');
    assert(credit && credit.text.includes('Autor do retrato') && credit.text.includes('Domínio público') && credit.y > pg.images[0].y, 'crédito embaixo: ' + (credit && credit.text));
    const imgs = await idb('images');
    assert(imgs.length === 1 && imgs[0].title === 'Bhaskara II' && imgs[0].src.startsWith('data:image/'), 'imagem não ficou salva no app');
    assert(await page.locator('.selbox').count() === 1, 'imagem e nome deviam ficar selecionados para mover');
  });
  await step('Imagem: "Minhas imagens" funciona sem buscar de novo; sem o nome; apagar das salvas', async () => {
    await page.click('#ed-imgsearch'); await page.click('.is-tabs [data-tab=saved]'); await wait(200);
    assert(await page.locator('.is-item').count() === 1 && (await page.textContent('#is-n')) === '1', 'imagens salvas');
    await page.uncheck('#is-name');
    await page.click('.is-item >> nth=0'); await wait(600); await saved();
    const pg = (await contentOf('Matemáticos')).pages[0];
    assert(pg.images.length === 2 && pg.texts.filter(t => t.text === 'Bhaskara II').length === 1, 'sem o nome desta vez');
    await page.click('#ed-imgsearch'); await page.check('#is-name'); await page.click('.is-tabs [data-tab=saved]');
    await page.click('.is-item [data-del]'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.danger'); await wait(300);
    assert((await idb('images')).length === 0 && await page.locator('.is-item').count() === 0, 'não apagou das salvas');
    assert((await contentOf('Matemáticos')).pages[0].images.length === 2, 'apagar da galeria não pode tirar da folha');
    await closeModals();
  });
  await step('Imagem: limite de buscas mostra aviso claro', async () => {
    wikiMode = '429';
    await page.click('#ed-imgsearch'); await page.fill('#is-q', 'Pedro Álvares Cabral'); await page.click('.is-form button[type=submit]');
    await page.waitForFunction(() => /Muitas buscas/.test(document.getElementById('is-status').textContent), null, { timeout: 15000 });
    // se o limite passar logo, o app tenta de novo sozinho e mostra as imagens
    wikiMode = '429once';
    await page.click('.is-form button[type=submit]');
    await page.waitForSelector('.is-item', { timeout: 15000 });
    wikiMode = 'ok';
    await closeModals(); await page.click('#ed-back'); await wait(900);
  });

  // ================= CENTRAL DE AVISOS =================
  console.log('Central de Avisos');
  await step('Avisos: escolher o que avisar e a que horas; a lista mostra os próximos avisos', async () => {
    await page.evaluate(() => localStorage.removeItem('caderno-avisos'));
    await nav('avisos');
    assert((await page.textContent('.av-status h3')).includes('ligados'), 'status dos avisos');
    assert(await page.locator('.av-row input[type=checkbox]').count() === 7, 'tipos de aviso');
    await page.check('.av-row input[data-p=study]'); await wait(300);
    await page.fill('.av-row input[data-p=studyTime]', '23:58'); await page.dispatchEvent('.av-row input[data-p=studyTime]', 'change'); await wait(300);
    const list = await page.locator('.av-item b').allTextContents();
    assert(list.some(t => t.includes('Hora de estudar')), 'lista: ' + list.slice(0, 6).join(' | '));
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-avisos')));
    const kv = (await idb('kv')).find(x => x.id === 'avisos');
    assert(prefs.study === true && prefs.studyTime === '23:58' && kv.prefs.studyTime === '23:58', 'preferências não foram salvas (app e banco)');
    await page.uncheck('.av-row input[data-p=study]'); await wait(200);
  });
  await step('Avisos: Google Agenda em cada evento e exportar eventos (.ics)', async () => {
    await nav('calendar');
    const href = await page.getAttribute('.cal-next .ev-row:has-text("Entrega do trabalho") .ev-gcal', 'href');
    assert(href.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE') && href.includes('Entrega%20do%20trabalho') && href.includes(`dates=${dplus(1).replace(/-/g, '')}T073000/`), 'link do Google Agenda: ' + href);
    await nav('avisos');
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await page.click('#av-ics'); const f = path.join(OUT, 'eventos.ics'); await (await dl).saveAs(f);
    const ics = fs.readFileSync(f, 'utf8');
    assert(ics.includes('BEGIN:VCALENDAR') && ics.includes('SUMMARY:Entrega do trabalho de Geografia') && ics.includes('TRIGGER:-P1D'), 'arquivo .ics');
  });
  await step('Avisos com o app fechado: o service worker usa o mesmo motor e acha o aviso', async () => {
    await page.evaluate(async d => {
      const st = await import('./js/store.js');
      await st.db.put('events', { id: 'ev-sw', title: 'Feira de ciências', date: d, time: '', prio: 2, kind: 'outro', remind: true, createdAt: Date.now() });
      // o app não avisa este (eventos desligados nele); o service worker lê as preferências do banco
      localStorage.setItem('caderno-avisos', JSON.stringify({ events: false }));
      const kv = (await st.db.get('kv', 'avisos')) || { id: 'avisos', fired: {} };
      kv.prefs = { eveTime: '00:00', tasks: false, cards: false, habits: false, classes: false, exams: false, study: false };
      await st.db.put('kv', kv);
    }, dplus(1));
    const n = await page.evaluate(() => new Promise(res => {
      navigator.serviceWorker.addEventListener('message', e => res(e.data.avisos), { once: true });
      navigator.serviceWorker.controller.postMessage('conferir-avisos');
      setTimeout(() => res(-1), 8000);
    }));
    assert(n >= 1, 'o service worker não achou o aviso: ' + n);
    await page.evaluate(() => localStorage.removeItem('caderno-avisos'));
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

  // ================= ESTUDO INTELIGENTE =================
  console.log('Estudo inteligente: erros, ENEM, desempenho, plano, busca na letra, mapa mental, ferramentas, cadeado e Drive');
  const today0 = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayP = n => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await step('Simulado ENEM: 5 alternativas, texto-base, relógio da prova, entregar e gabarito comentado', async () => {
    await nav('quiz');
    await page.click('#qz-mode [data-m=enem]'); await page.selectOption('#qz-area', 'matematica'); await page.fill('#qz-topic', 'proporção');
    await page.click('#qz-enem-go');
    await page.waitForSelector('.quiz-run.exam', { timeout: 10000 });
    const req = gemReqs[gemReqs.length - 1].body.contents[0].parts.map(p => p.text).join(' ');
    assert(/Matemática/.test(req) && /proporção/.test(req) && /5 alternativas/.test(req), 'pedido do ENEM');
    assert(await page.locator('.qz-opt').count() === 5 && /Texto-base 1/.test(await page.textContent('.qz-base')), 'questão no formato ENEM');
    await page.waitForFunction(() => /⏱ 1[45]:\d\d/.test(document.getElementById('qz-timer').textContent), null, { timeout: 3000 });
    await page.click('.qz-opt[data-o="0"]'); await page.click('#qz-nxt');
    await page.click('.qz-opt[data-o="3"]'); await page.click('.qz-dot[data-go="0"]');
    assert(await page.locator('.qz-opt.picked[data-o="0"]').count() === 1, 'a resposta da 1ª ficou guardada ao voltar');
    await page.click('#qz-end'); await page.click('.modal .modal-actions .btn:has-text("Entregar")'); await wait(600);
    assert((await page.textContent('.review-done h2')).includes('1 de 5'), 'resultado: ' + await page.textContent('.review-done h2'));
    assert(await page.locator('.qz-wrong').count() === 4 && /Texto-base 2/.test(await page.textContent('.qz-wrong >> nth=0')), 'gabarito comentado dos erros');
    const errs = (await idb('errors')).filter(e => e.src === 'enem');
    assert(errs.length === 4 && errs.every(e => e.opts.length === 5 && e.c === 0) && errs.some(e => e.mine === '(sem resposta)'), 'erros do ENEM no caderno de erros: ' + errs.length);
    const qz = (await idb('quizzes')).find(q => q.exam);
    assert(qz && qz.right === 1 && qz.total === 5, 'simulado ENEM salvo no histórico');
    await page.click('#qz-new'); await wait(300);
  });
  await step('Caderno de erros: junta simulado, flashcard e conta; explica com IA; acertar 2 vezes resolve', async () => {
    assert((await idb('errors')).some(e => e.src === 'conta'), 'a conta marcada com ✗ no caderno devia virar erro');
    // flashcard errado pela 2ª vez
    await page.evaluate(async () => { const st = await import('./js/store.js'); const cs = await st.db.all('cards'); for (const c of cs) { c.due = '2000-01-01'; c.lapses = 1; await st.db.put('cards', c); } });
    await page.reload(); await wait(1300);
    await nav('cards'); await page.click('#cd-study'); await page.click('#rv-show'); await page.click('[data-g="0"]'); await wait(400);
    assert((await idb('errors')).some(e => e.src === 'card'), 'flashcard errado de novo devia virar erro');
    await nav('errors');
    const n = (await idb('errors')).filter(e => !e.resolvedAt).length;
    assert((await page.textContent('.er-stats')).includes(`${n} para revisar`), 'contagem na tela');
    await page.click('.er-card [data-ex] >> nth=0');
    await page.waitForFunction(() => /Dica/.test(document.querySelector('.er-card .er-ai').textContent), null, { timeout: 8000 });
    // revisa tudo acertando, duas vezes
    for (let round = 0; round < 2; round++) {
      await page.click('#er-go'); await wait(200);
      for (let k = 0; k < 20; k++) {
        if (await page.locator('#er-back').count()) break;
        const q = await page.textContent('.qz-q h2');
        const e = (await idb('errors')).find(x => x.q === q);
        if (await page.locator('.qz-opt').count()) await page.click(`.qz-opt[data-o="${e.c}"]`);
        else { await page.click('#er-show'); await page.click('[data-self="1"]'); }
        await page.click('#er-next'); await wait(100);
      }
      await page.click('#er-back'); await wait(200);
    }
    const left = (await idb('errors')).filter(e => !e.resolvedAt).length;
    assert(n <= 15 ? left === 0 : left < n, `depois de acertar 2 vezes, os erros deviam estar resolvidos (sobraram ${left} de ${n})`);
    assert(await page.locator('.er-filter [data-f=done]').textContent().then(t => /Resolvidos \(\d+\)/.test(t)), 'filtro de resolvidos');
  });
  await step('Desempenho por matéria: mostra cada matéria e sugere reforçar a mais fraca', async () => {
    const folders = await idb('folders');
    const mat = folders.find(f => f.name === 'Matemática');
    await page.evaluate(async fid => { const st = await import('./js/store.js'); const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; await st.db.put('quizzes', { id: 'fraco-1', title: 'Teste', folderId: fid, level: 'medio', date: day, right: 0, total: 40, createdAt: Date.now(), qs: [], answers: [] }); }, mat.id);
    await page.reload(); await wait(1300);
    await nav('report');
    assert(await page.locator('.subj-row:not(.head)').count() === folders.length, 'uma linha por matéria');
    assert((await page.textContent('.subj-row:not(.head) >> nth=0')).includes('Matemática'), 'Matemática devia aparecer primeiro (a mais fraca)');
    const weak = await page.evaluate(async () => (await import('./js/subjects.js')).weakSubject());
    assert(weak && weak.name === 'Matemática' && /simulados/.test(weak.why), 'a matéria mais fraca devia ser Matemática: ' + JSON.stringify(weak));
  });
  await step('Plano de estudos: distribui os assuntos até a prova, põe na agenda e reorganiza o que atrasou', async () => {
    await nav('plans');
    await page.click('#btn-new'); await page.fill('#pl-name', 'Prova do bimestre'); await page.fill('#pl-exam', dayP(12));
    await page.click('#pl-subs [data-f] >> text=Matemática'); await page.fill('#pl-extra', 'Português'); await page.press('#pl-extra', 'Enter');
    await page.click('#pl-ai'); await page.waitForFunction(() => /Frações/.test(document.querySelector('[data-topics]').value), null, { timeout: 8000 });
    assert(/Crase/.test(await page.inputValue('[data-topics] >> nth=1')), 'a IA devia sugerir assuntos para as duas matérias');
    await page.click('.modal-actions .btn.primary'); await wait(800);
    const plan = (await idb('plans')).find(p => p.name === 'Prova do bimestre');
    const ts = (await idb('tasks')).filter(t => t.planId === plan.id);
    assert(plan && ts.length >= 10, 'sessões criadas: ' + ts.length);
    assert(ts.every(t => t.due >= today0() && t.due < dayP(12)), 'todas as sessões antes da prova');
    assert(ts.some(t => /Frações/.test(t.title)) && ts.some(t => /Crase/.test(t.title)) && ts.some(t => /Simulado completo/.test(t.title)), 'assuntos, revisão e simulado no plano');
    const first = ts.filter(t => !/Revisão geral|Simulado/.test(t.title)).sort((a, b) => (a.due < b.due ? -1 : 1));
    assert(new Set(first.slice(0, 4).map(t => t.folderId || 'pt')).size === 2, 'as matérias deviam ser intercaladas');
    assert((await idb('events')).some(e => e.title === 'Prova do bimestre' && e.date === dayP(12)), 'a prova devia ir para a agenda');
    // atrasou 3 sessões
    await page.evaluate(async ([id, y]) => { const st = await import('./js/store.js'); const all = (await st.db.all('tasks')).filter(t => t.planId === id).slice(0, 3); for (const t of all) { t.due = y; await st.db.put('tasks', t); } }, [plan.id, dayP(-2)]);
    await page.reload(); await wait(1300); await nav('plans');
    assert((await page.textContent('[data-reorg]')).includes('3 atrasadas'), 'mostra as atrasadas');
    await page.click('[data-reorg]'); await wait(600);
    const after = (await idb('tasks')).filter(t => t.planId === plan.id && !t.done);
    assert(after.every(t => t.due >= today0() && t.due < dayP(12)), 'reorganizar devia tirar os atrasos e manter antes da prova');
  });
  await step('Busca na letra à mão: o que você escreve à mão é achado pela busca', async () => {
    await page.evaluate(() => localStorage.removeItem('caderno-indice-off'));
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Só à mão'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    await page.selectOption('#ed-auto', 'off'); await page.click('[data-tool=pen]');
    recogQueue.push('fotossintese clorofila');
    await draw([[150, 300], [200, 260], [250, 300], [300, 260]]); await saved();
    // a leitura da letra acontece uns 5 s depois que você para de escrever
    let lido = false;
    for (let k = 0; k < 30 && !lido; k++) { await wait(500); lido = /clorofila/.test(((await idb('notes')).find(x => x.title === 'Só à mão') || {}).inkText || ''); }
    assert(lido, 'a letra à mão não foi lida para a busca');
    await page.click('#ed-back'); await wait(900);
    await page.keyboard.press('Control+k'); await page.fill('.pal-in input', 'clorofila'); await wait(300);
    const palN = await page.locator('.pal-item').count();
    const dbInk = await page.evaluate(async () => { const st = await import('./js/store.js'); return (await st.db.all('notes')).filter(x => /clorofila/.test(x.inkText || '')).map(x => x.title); });
    assert(await page.locator('.pal-item:has-text("Só à mão")').count() >= 1, `a busca não achou a palavra escrita à mão (itens: ${palN}; no banco: ${dbInk.join(', ')}; editor aberto: ${await page.locator('#editor:not([hidden])').count()})`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.setItem('caderno-indice-off', '1'));
  });
  await step('Mapa mental pela IA e modelos de página', async () => {
    await nav('all'); await page.click('.card:has-text("Só à mão")'); await wait(900);
    const n0 = (await contentOf('Só à mão')).pages.length;
    await page.click('#ed-ai'); await page.click('.ai-act[data-a=mindmap]');
    await page.waitForFunction(() => /Mapa mental desenhado/.test(document.getElementById('toast').textContent), null, { timeout: 10000 });
    await saved();
    let c = await contentOf('Só à mão');
    const mp = c.pages[c.pages.length - 1];
    assert(c.pages.length === n0 + 1 && mp.texts.some(t => t.text === 'Frações') && mp.texts.some(t => /Denominador/.test(t.text)) && mp.strokes.length >= 8, 'mapa mental desenhado numa página nova');
    assert(/Numerador/.test(await page.textContent('.ai-turn.assistant')), 'a conversa mostra o mapa em tópicos');
    await page.click('#ai-close');
    await page.click('#pg-tpl'); await page.click('.tpl-item[data-t=resumo]'); await saved();
    c = await contentOf('Só à mão');
    assert(c.pages[c.pages.length - 1].texts.some(t => t.text === 'Ideias principais'), 'modelo Resumo');
    await page.click('#pg-tpl'); await page.click('.tpl-item[data-t=grafico]'); await saved();
    c = await contentOf('Só à mão');
    assert(c.pages[c.pages.length - 1].strokes.length > 40, 'modelo Plano cartesiano');
  });
  await step('Ouvir daqui: o traço lembra o momento da gravação; Ditar escreve nas linhas', async () => {
    await page.click('#ed-rec'); await page.waitForSelector('#rec-pill:not([hidden])', { timeout: 8000 });
    await page.click('[data-tool=pen]');
    await draw([[150, 250], [260, 250]]); await wait(3200);
    await draw([[150, 330], [260, 330]]); await wait(400); await saved();
    await page.click('#rec-pill'); await toastHas('Gravação salva', 8000);
    const pg = (await contentOf('Só à mão')).pages;
    const st = pg[pg.length - 1].strokes.filter(x => x.rec);
    assert(st.length === 2 && st[1].rec.t - st[0].rec.t >= 3, 'os traços deviam guardar o segundo da gravação: ' + JSON.stringify(st.map(x => x.rec)) + ' · páginas: ' + pg.length + ' · traços na última: ' + pg[pg.length - 1].strokes.length + ' · em todas com rec: ' + pg.map(p => p.strokes.filter(x => x.rec).length).join(','));
    await page.click('[data-tool=lasso]'); await draw([[130, 310], [290, 310], [290, 350], [130, 350], [130, 310]]); await wait(300);
    assert(await page.locator('.selbar [data-a=listen]').isVisible(), 'o botão Ouvir daqui devia aparecer');
    await page.click('.selbar [data-a=listen]');
    await page.waitForSelector('.rec-player audio', { timeout: 5000 });
    const tt = await page.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('.rec-player audio').currentTime), 700)));
    assert(tt >= Math.max(0, st[1].rec.t - 3) - 0.2, `devia tocar a partir de ${st[1].rec.t - 3}s (tocou ${tt})`);
    await page.click('.rec-player button');
    // ditado (microfone simulado)
    await page.evaluate(() => {
      window.SpeechRecognition = class { start() { setTimeout(() => { const r = [Object.assign([{ transcript: 'hoje estudei frações ponto as partes do inteiro vírgula numerador ponto' }], { isFinal: true })]; this.onresult && this.onresult({ resultIndex: 0, results: r }); setTimeout(() => this.onend && this.onend(), 50); }, 100); } stop() {} };
    });
    await page.click('[data-tool=pen]'); await page.click('#ed-dictate'); await wait(800); await saved();
    // (a página do gráfico já está cheia: o ditado continua na página seguinte, como no "Organizar nas linhas")
    const flow = (await contentOf('Só à mão')).pages.flatMap(p => p.texts.filter(t => t.flow).map(t => t.text)).join(' ');
    assert(/Hoje estudei frações\./.test(flow) && /As partes do inteiro, numerador\./.test(flow), 'ditado nas linhas: ' + flow);
    await page.click('#ed-back'); await wait(900);
  });
  await step('Ferramentas: tabela periódica, gráfico de funções (com colar na anotação) e tradutor', async () => {
    await nav('tools');
    assert(await page.locator('.pt-el').count() === 118, 'os 118 elementos');
    await page.fill('#pt-q', 'sódio'); await wait(200);
    const info = await page.textContent('#pt-info');
    assert(/Sódio/.test(info) && /1s2 2s2 2p6 3s1/.test(info) && /2 · 8 · 1/.test(info), 'detalhes do sódio: ' + info.slice(0, 200));
    const m = await page.evaluate(async () => {
      const t = await import('./js/tools.js');
      const f = t.compile('x^2 - 5x + 6'), g = t.compile('2(x+1)'), r = t.compile('raiz(x)'), s2 = t.compile('sen(pi/2)'), p = t.compile('-x^2');
      let bad = ''; try { t.compile('x +'); } catch (e) { bad = e.message; }
      return { f2: f(2), roots: t.roots(f, -10, 10).map(x => Math.round(x * 1000) / 1000), g1: g(1), r9: r(9), s: s2(0), p3: p(3), bad };
    });
    assert(m.f2 === 0 && JSON.stringify(m.roots) === '[2,3]' && m.g1 === 4 && m.r9 === 3 && Math.abs(m.s - 1) < 1e-9 && m.p3 === -9 && m.bad, 'leitor de funções: ' + JSON.stringify(m));
    await page.click('[data-t=grafico]'); await page.fill('.gr-fn input[data-k="0"]', 'x^2 - 5x + 6'); await wait(300);
    assert(/corta o eixo x em 2 e 3/.test(await page.textContent('#gr-info')), 'raízes mostradas: ' + await page.textContent('#gr-info'));
    await page.click('#gr-note'); await wait(600);
    const gnote = (await idb('notes')).find(n => n.title.startsWith('Gráfico: y = x^2 - 5x + 6'));
    assert(gnote && (await idb('pages')).find(p => p.id === gnote.id).pages[0].images[0].src.startsWith('data:image/png'), 'gráfico colado numa anotação');
    await page.click('[data-t=tradutor]'); await page.fill('#tr-in', 'I have been studying for two hours'); await page.click('#tr-go');
    await page.waitForFunction(() => /estudando há duas horas/.test(document.getElementById('tr-out').textContent), null, { timeout: 8000 });
  });
  await step('Cadeado: senha protege o Diário e anotações trancadas', async () => {
    await page.click('#btn-settings'); await page.click('#s-lock');
    await page.fill('#ls-a', '1234'); await page.fill('#ls-b', '1234'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(400);
    assert(await page.evaluate(() => !!JSON.parse(localStorage.getItem('caderno-cadeado')).hash), 'senha salva');
    assert(!(await page.evaluate(() => localStorage.getItem('caderno-cadeado'))).includes('1234'), 'a senha não pode ficar guardada em texto');
    // tranca uma anotação
    await nav('all'); await page.click('.card:has-text("Só à mão") .more'); await page.click('.menu-item:has-text("Trancar com senha")'); await wait(400);
    assert(await page.locator('.card:has-text("Só à mão") .thumb-lock').count() === 1, 'a anotação trancada não mostra a miniatura');
    // saiu do app: tranca de novo
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
    await page.click('.card:has-text("Só à mão")'); await page.waitForSelector('#lk-pin');
    await page.fill('#lk-pin', '9999'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(300);
    assert(await page.locator('#lk-err:not([hidden])').count() === 1 && await page.locator('#editor:not([hidden])').count() === 0, 'senha errada não pode abrir');
    await page.fill('#lk-pin', '1234'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(900);
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'a senha certa abre a anotação');
    await page.click('#ed-back'); await wait(900);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
    await nav('journal');
    assert(await page.locator('.locked-screen').count() === 1 && await page.locator('#jr-learned').count() === 0, 'o diário devia estar trancado');
    await page.click('#lk-open'); await page.fill('#lk-pin', '1234'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(500);
    assert(await page.locator('#jr-learned').count() === 1, 'o diário abre com a senha');
    // tira o cadeado para os próximos testes
    await page.evaluate(() => localStorage.removeItem('caderno-cadeado'));
  });
  await step('Google Drive: envia o backup para a conta e traz de volta', async () => {
    let uploaded = null;
    await page.route('https://www.googleapis.com/**', async r => {
      const u = r.request().url(), m = r.request().method();
      const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Location', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (u.includes('/upload/drive/v3/files') && !u.includes('upload_id')) {
        assert((await r.request().allHeaders()).authorization === 'Bearer tok-teste', 'token do Google');
        return r.fulfill({ status: 200, headers: { ...cors, Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc' }, body: '' });
      }
      if (u.includes('upload_id=abc') && m === 'PUT') { uploaded = r.request().postData(); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"id":"arquivo-1"}' }); }
      if (u.includes('/drive/v3/files/arquivo-1?alt=media')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: uploaded });
      return r.fulfill({ status: 404, headers: cors, body: '{}' });
    });
    await page.goto(base + '?v=data'); await wait(1500);
    await page.evaluate(() => { window.google = { accounts: { oauth2: { initTokenClient: o => ({ requestAccessToken: () => setTimeout(() => o.callback({ access_token: 'tok-teste', expires_in: 3600 }), 50) }) } } }; });
    await page.click('#dr-setup'); await page.fill('#dr-id', '123-abc.apps.googleusercontent.com'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary');
    await toastHas('Backup salvo no seu Google Drive', 10000);
    const data = JSON.parse(uploaded);
    assert(data.app === 'caderno-estudos' && data.notes.length === (await idb('notes')).length && Array.isArray(data.errors), 'o backup enviado tem tudo');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-drive')).fileId) === 'arquivo-1', 'lembra o arquivo do Drive');
    await wait(300);
    await page.click('#dr-restore'); await page.click('.modal .modal-actions .btn:has-text("Juntar")');
    await toastHas('Backup restaurado', 10000);
    await page.unroute('https://www.googleapis.com/**');
    await page.evaluate(() => { localStorage.removeItem('caderno-drive'); delete window.google; });
  });

  // ================= POST-IT, GRIFO E GRAVAÇÃO =================
  console.log('Post-it, grifo e gravação');
  await step('Post-it: escolhe a cor, cola na folha, escreve dentro e o desenho cobre o que estava embaixo', async () => {
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Com post-it'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    await page.selectOption('#ed-auto', 'off');
    await page.click('#ed-sticky'); await page.click('.sticky-sw[data-c=rosa]'); await wait(300);
    assert(await page.locator('[data-tool=pen].active').count() === 1, 'depois de colar, a caneta devia estar pronta');
    const b = await stageBox(), cx = b.width / 2, cy = b.height / 2;
    await draw([[cx - 60, cy - 20], [cx - 30, cy + 20], [cx, cy - 20], [cx + 30, cy + 20]]);
    await saved();
    const pg = (await contentOf('Com post-it')).pages[0];
    const note = pg.images.find(i => i.sticky === 'rosa');
    assert(note && !note.src && note.at, 'post-it não foi salvo: ' + JSON.stringify(pg.images));
    const st = pg.strokes[pg.strokes.length - 1];
    assert(st.at > note.at && st.bbox.x > note.x && st.bbox.x + st.bbox.w < note.x + note.w, 'a escrita devia ficar dentro do post-it');
    // o post-it cobre o texto antigo e mostra o que foi escrito nele depois
    const px = await page.evaluate(async () => {
      const ink = await import('./js/ink.js');
      const dark = (texts) => { const c = ink.renderPageToCanvas({ strokes: [], images: [{ id: 'n', sticky: 'amarelo', x: 100, y: 100, w: 300, h: 300, at: 1000 }], texts }, { type: 'blank', color: 'white' }, ink.PAGE_W); const d = c.getContext('2d').getImageData(150, 220, 200, 60).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++; return n; };
      const T = at => [{ id: 't', x: 150, y: 220, text: 'MMMMMM', size: 48, color: '#000', at }];
      return { old: dark(T(0)), novo: dark(T(2000)) };
    });
    assert(px.old === 0 && px.novo > 200, 'camadas do post-it: ' + JSON.stringify(px));
  });
  await step('Post-it: com "Organizar nas linhas", o que é escrito no post-it fica à mão; tocar com o laço leva tudo junto', async () => {
    await page.selectOption('#ed-auto', 'flow');
    const b = await stageBox(), cx = b.width / 2, cy = b.height / 2;
    recogQueue.push('lembrete');
    await draw([[cx - 40, cy + 60], [cx + 40, cy + 60]]); await wait(2300);
    const pg = (await contentOf('Com post-it')).pages[0];
    assert(pg.strokes.length === 2 && !pg.texts.some(t => t.flow), 'a escrita do post-it foi para as linhas');
    recogQueue.length = 0;
    await page.selectOption('#ed-auto', 'off');
    await page.click('[data-tool=lasso]');
    await page.mouse.click(b.x + cx + 120, b.y + cy + 120); await wait(300);
    await page.click('.selbar [data-a=del]'); await saved();
    const after = (await contentOf('Com post-it')).pages[0];
    assert(!after.images.length && !after.strokes.length, 'apagar o post-it devia levar o que estava escrito nele');
    await page.click('#ed-undo'); await saved();
    assert((await contentOf('Com post-it')).pages[0].images.length === 1, 'desfazer não trouxe o post-it');
  });
  await step('Grifar: texto digitado ganha grifo (e tira com outro toque); letra à mão ganha grifo reto', async () => {
    const b = await stageBox();
    await page.click('[data-tool=text]'); await page.mouse.click(b.x + 160, b.y + 120); await wait(200);
    await page.keyboard.type('Importante para a prova'); await page.click('[data-tool=lasso]'); await wait(200);
    await page.mouse.click(b.x + 200, b.y + 120 + 8); await wait(300);
    await page.click('.selbar [data-a=hl]'); await saved();
    let t = (await contentOf('Com post-it')).pages[0].texts.find(x => x.text === 'Importante para a prova');
    assert(t && t.hl, 'o texto não foi grifado');
    await page.click('.selbar [data-a=hl]'); await saved();
    t = (await contentOf('Com post-it')).pages[0].texts.find(x => x.text === 'Importante para a prova');
    assert(t && !t.hl, 'o segundo toque devia tirar o grifo');
    // escrita à mão: circula com o laço e grifa
    await page.click('[data-tool=pen]');
    await draw([[120, 560], [140, 530], [160, 560], [180, 530], [200, 560]]);
    await page.click('[data-tool=lasso]');
    await draw([[100, 500], [240, 500], [240, 590], [100, 590], [100, 500]]); await wait(300);
    await page.click('.selbar [data-a=hl]'); await saved();
    const mk = (await contentOf('Com post-it')).pages[0].strokes.filter(x => x.tool === 'marker');
    assert(mk.length === 1 && mk[0].points.length === 2 && mk[0].points[0][1] === mk[0].points[1][1], 'grifo da letra à mão: ' + JSON.stringify(mk.map(x => x.points.length)));
    // marca-texto feito à mão, quase reto, vira grifo reto
    await page.click('#overlay', { position: { x: 5, y: 5 } }).catch(() => {});
    await page.click('[data-tool=marker]');
    await draw([[120, 430], [220, 435], [320, 427], [400, 432]]); await saved();
    const mk2 = (await contentOf('Com post-it')).pages[0].strokes.filter(x => x.tool === 'marker');
    const last = mk2[mk2.length - 1];
    assert(mk2.length === 2 && last.points.length === 2 && last.points[0][1] === last.points[1][1], 'marca-texto não ficou reto');
    await page.click('[data-tool=pen]');
  });
  await step('Gravação: quando o app sai da tela, o áudio gravado até ali já fica salvo', async () => {
    await page.click('#ed-rec'); await page.waitForSelector('#rec-pill:not([hidden])', { timeout: 8000 });
    await wait(2500);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(1500);
    const note = await noteByTitle('Com post-it');
    const part = (await idb('recordings')).find(r => r.noteId === note.id);
    await page.evaluate(() => { delete document.hidden; });
    assert(part && part.partial && part.size > 500, 'não salvou ao sair da tela: ' + JSON.stringify(part && { p: part.partial, s: part.size }));
    await page.click('#rec-pill'); await toastHas('Gravação salva', 8000);
    const fin = (await idb('recordings')).find(r => r.noteId === note.id);
    assert(fin && !fin.partial && fin.size >= part.size, 'gravação final');
    await page.click('#ed-back'); await wait(900);
  });

  // ================= SALVAMENTO =================
  console.log('Salvamento: nada se perde');
  await step('Caderno: botão Salvar, título salva enquanto digita e salva mesmo escrevendo sem parar', async () => {
    await nav('all');
    await page.click('.card[data-id] >> nth=0'); await wait(800);
    assert(/Salvo/.test(await page.textContent('#ed-save')), 'botão mostra "Salvo"');
    await page.click('#ed-title'); await page.keyboard.press('Control+a'); await page.keyboard.type('Título sem sair do campo');
    await wait(1400);
    assert(await noteByTitle('Título sem sair do campo'), 'o título não salvou enquanto digitava');
    await page.click('[data-tool=pen]'); await page.selectOption('#ed-auto', 'off'); await wait(200);
    // escrevendo sem parar por 6 s: precisa salvar no meio, não só no fim
    const b = await stageBox(); const n0 = (await contentOf('Título sem sair do campo')).pages[0].strokes.length;
    const t0 = Date.now(); let k = 0;
    while (Date.now() - t0 < 6000) { await draw([[120 + (k % 10) * 30, 500], [140 + (k % 10) * 30, 540]]); await wait(250); k++; }
    const mid = (await contentOf('Título sem sair do campo')).pages[0].strokes.length;
    assert(mid > n0 + 3, `escrevendo sem parar não salvou no meio (${n0} → ${mid}, ${k} traços)`);
    await page.click('#ed-save'); await toastHas('Salvo ✓');
    const end = (await contentOf('Título sem sair do campo')).pages[0].strokes.length;
    assert(end === n0 + k, `traços salvos ${end - n0} de ${k}`);
  });
  await step('Caderno: se o Android fechar o app antes de gravar, a cópia de emergência volta ao abrir', async () => {
    const n = await noteByTitle('Título sem sair do campo');
    const c = await contentOf('Título sem sair do campo');
    await page.click('#ed-back'); await wait(900);
    // simula: a cópia de emergência ficou mais nova que o banco (o app foi fechado no meio da gravação)
    await page.evaluate(([meta, content]) => {
      content.pages[0].texts.push({ id: 'resgate', x: 120, y: 700, text: 'Escrito antes de fechar', size: 28, color: '#000' });
      localStorage.setItem('caderno-resgate', JSON.stringify({ meta: { ...meta, title: 'Anotação recuperada', updatedAt: meta.updatedAt + 5000 }, content }));
    }, [n, c]);
    await page.goto(base); await toastHas('Recuperei', 8000);
    const back = await contentOf('Anotação recuperada');
    assert(back && back.pages[0].texts.some(t => t.text === 'Escrito antes de fechar'), 'não recuperou a anotação');
    assert(!(await page.evaluate(() => localStorage.getItem('caderno-resgate'))), 'a cópia de emergência não foi apagada');
    // uma cópia mais velha que o banco é ignorada
    await page.evaluate(([meta, content]) => localStorage.setItem('caderno-resgate', JSON.stringify({ meta: { ...meta, title: 'Velha', updatedAt: 1 }, content })), [n, c]);
    await page.goto(base); await wait(1500);
    assert(!(await noteByTitle('Velha')) && await noteByTitle('Anotação recuperada'), 'uma cópia velha sobrescreveu a anotação');
  });
  await step('Janelas: tocar fora não apaga o que foi escrito; o rascunho volta depois', async () => {
    await nav('tasks');
    await page.click('#btn-new'); await page.fill('#t-title', 'Tarefa quase perdida');
    await page.mouse.click(5, 5); await wait(300);
    assert(await page.locator('#t-title').count() === 1, 'a janela fechou e apagou o texto');
    assert(await page.locator('.modal-keep').count() === 1, 'não perguntou se quer guardar');
    await page.click('.modal-keep [data-k=save]'); await wait(500);
    assert((await idb('tasks')).some(t => t.title === 'Tarefa quase perdida'), 'o "Salvar" da pergunta não salvou');
    // app fechado com a janela aberta: o rascunho volta
    await page.click('#btn-new'); await page.fill('#t-title', 'Rascunho de tarefa'); await page.fill('#t-notes', 'detalhes importantes'); await wait(500);
    await page.goto(base); await wait(1300); await nav('tasks');
    await page.click('#btn-new'); await wait(300);
    assert(await page.inputValue('#t-title') === 'Rascunho de tarefa' && await page.inputValue('#t-notes') === 'detalhes importantes', 'o rascunho não voltou');
    assert(await page.locator('.modal-draft').count() === 1, 'não avisou que recuperou');
    await page.click('.modal .btn.primary'); await wait(500);
    await page.click('#btn-new'); await wait(300);
    assert(await page.inputValue('#t-title') === '', 'depois de salvar, o rascunho devia sumir');
    // sem nada escrito, tocar fora fecha normalmente
    await page.mouse.click(5, 5); await wait(400);
    assert(await page.locator('#t-title').count() === 0, 'janela vazia não fechou ao tocar fora');
  });
  await step('Diário salva sozinho enquanto escreve; nota rápida e pergunta ao tutor guardam rascunho', async () => {
    await nav('journal');
    await page.fill('#jr-tomorrow', 'Revisar geometria amanhã'); await wait(1300);
    assert(/Salvo automaticamente/.test(await page.textContent('#jr-auto')), 'não mostrou "Salvo automaticamente"');
    await nav('quick');
    await page.fill('#qn-new', 'Ideia que não posso perder'); await wait(500);
    await page.goto(base); await wait(1300);
    const today = (await idb('journal')).find(j => j.tomorrow === 'Revisar geometria amanhã');
    assert(today, 'o diário não salvou sozinho');
    await nav('quick');
    assert(await page.inputValue('#qn-new') === 'Ideia que não posso perder', 'a nota rápida não guardou o rascunho');
    await page.press('#qn-new', 'Enter'); await wait(500);
    assert(await page.inputValue('#qn-new') === '', 'depois de salvar a nota o campo devia ficar vazio');
    await nav('today'); await nav('quick');
    assert(await page.inputValue('#qn-new') === '', 'o rascunho voltou depois de salvar');
  });

  // ================= CONFIABILIDADE =================
  console.log('Confiabilidade: atualização, offline e listas grandes');
  await step('Offline: todos os arquivos do app (inclusive fontes e telas novas) ficam guardados', async () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const listed = new Set([...sw.matchAll(/'((?:js|fonts|icons|css)\/[^']+)'/g)].map(m => m[1]));
    const missing = [];
    for (const d of ['js', 'js/vendor', 'fonts', 'css', 'icons']) for (const f of fs.readdirSync(path.join(ROOT, d))) {
      const rel = `${d}/${f}`;
      if (fs.statSync(path.join(ROOT, rel)).isFile() && !f.endsWith('.txt') && !listed.has(rel)) missing.push(rel);
    }
    assert(!missing.length, 'fora do cache offline: ' + missing.join(', '));
  });
  await step('Logo: ícones do app, do Android (recorte redondo), das notificações e dos atalhos', async () => {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const pngSize = f => { const b = fs.readFileSync(path.join(ROOT, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    for (const ic of man.icons) {
      assert(fs.existsSync(path.join(ROOT, ic.src)), 'falta ' + ic.src);
      if (ic.type === 'image/png') { const [w, hh] = pngSize(ic.src); assert(ic.sizes === `${w}x${hh}`, `${ic.src} tem ${w}x${hh}, o manifesto diz ${ic.sizes}`); }
    }
    for (const pur of ['any', 'maskable', 'monochrome']) assert(man.icons.some(i => i.purpose === pur), 'sem ícone ' + pur);
    for (const sc of man.shortcuts) assert(sc.icons.every(i => fs.existsSync(path.join(ROOT, i.src))), 'atalho sem ícone: ' + sc.name);
    // o ícone das notificações tem que ser branco com fundo transparente (o Android pinta só a silhueta)
    const c5 = await browser.newContext(); const p5 = await c5.newPage();
    await p5.goto(base + 'icons/badge-96.png');
    const px = await p5.evaluate(async () => { const im = document.querySelector('img'); await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, 96, 96).data; let clear = 0, white = 0, other = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 10) clear++; else if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++; else if (d[i + 3] > 200) other++; } return { clear, white, other }; });
    assert(px.clear > 2000 && px.white > 1000 && px.other < 50, 'badge não é silhueta branca: ' + JSON.stringify(px));
    // o recorte redondo do Android não corta o desenho: nada fora do círculo seguro (raio 40%) diferente do fundo
    await p5.goto(base + 'icons/icon-maskable-512.png');
    const out = await p5.evaluate(async () => { const im = document.querySelector('img'); await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, 512, 512).data; let bad = 0; for (let y = 0; y < 512; y += 4) for (let xx = 0; xx < 512; xx += 4) { if (Math.hypot(xx - 256, y - 256) < 210) continue; const i = (y * 512 + xx) * 4; if (d[i] > 200 && d[i + 1] > 200) bad++; } return bad; });
    assert(out === 0, `${out} pontos claros fora da área segura do ícone redondo`);
    await c5.close();
    // a tela de abertura some sozinha e nunca bloqueia toques
    assert(await page.locator('#boot').count() === 0, 'a tela de abertura ficou na frente');
  });
  await step('Atualização: quem tinha uma versão antiga do app não perde nada', async () => {
    const c4 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p4 = await c4.newPage(); watch(p4);
    await p4.goto(base + 'icons/icon.svg');
    await p4.evaluate(() => new Promise((res, rej) => {
      const old = ['folders', 'notes', 'pages', 'tasks', 'sessions', 'habits', 'decks', 'cards', 'books', 'reads', 'grades', 'classes', 'journal', 'goals', 'quizzes', 'quicknotes', 'chats', 'recordings', 'snapshots'];
      const r = indexedDB.open('caderno-estudos', 6);
      r.onupgradeneeded = () => { for (const st of old) r.result.createObjectStore(st, { keyPath: 'id' }); };
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction(['notes', 'pages', 'tasks', 'cards', 'decks'], 'readwrite');
        tx.objectStore('notes').put({ id: 'n1', title: 'Anotação antiga', folderId: '', fav: false, createdAt: 1, updatedAt: 2, pageCount: 1, thumb: '' });
        tx.objectStore('pages').put({ id: 'n1', bg: { type: 'lines', color: 'white' }, pages: [{ id: 'p1', strokes: [], texts: [{ id: 't1', x: 110, y: 100, text: 'Texto antigo', size: 28, color: '#000' }], images: [] }] });
        for (let i = 0; i < 9; i++) tx.objectStore('tasks').put({ id: 'k' + i, title: 'Tarefa antiga ' + i, done: false, due: '', prio: 2, createdAt: i });
        tx.objectStore('decks').put({ id: 'd1', name: 'Baralho antigo', createdAt: 1 });
        tx.objectStore('cards').put({ id: 'c1', deckId: 'd1', front: 'Pergunta', back: 'Resposta', due: '2000-01-01', interval: 0, ease: 2.5, reps: 0, lapses: 0 });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
    }));
    await p4.evaluate(() => { localStorage.setItem('caderno-config', JSON.stringify({ aiProvider: 'groq', groqKey: 'x', handFont: 'caveat', geminiKey: 'minha-chave' })); localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-seeded', '1'); localStorage.setItem('caderno-hub-seeded', '1'); });
    await p4.goto(base); await p4.waitForTimeout(2500);
    const r = await p4.evaluate(async () => {
      const st = await import('./js/store.js');
      const o = {}; for (const x of ['notes', 'pages', 'tasks', 'cards', 'events', 'images']) o[x] = (await st.db.all(x)).length;
      return { o, cfg: JSON.parse(localStorage.getItem('caderno-config')) };
    });
    assert(r.o.notes === 1 && r.o.pages === 1 && r.o.tasks === 9 && r.o.cards === 1 && r.o.events === 0 && r.o.images === 0, 'dados depois de atualizar: ' + JSON.stringify(r.o));
    assert(r.cfg.geminiKey === 'minha-chave' && !('groqKey' in r.cfg) && r.cfg.handFont === 'auto', 'configuração: ' + JSON.stringify(r.cfg));
    assert(await p4.locator('.sg:has-text("primeiro backup")').count() === 1, '"O que fazer agora" devia lembrar do backup');
    await p4.click('#nav-main [data-k=all]'); await p4.click('.card:has-text("Anotação antiga")'); await p4.waitForTimeout(800);
    assert(await p4.locator('#editor:not([hidden])').count() === 1, 'a anotação antiga não abriu');
    await c4.close();
  });
  await step('Listas grandes: 300 tarefas aparecem em blocos de 200 com "Mostrar mais"', async () => {
    await page.evaluate(async () => { const st = await import('./js/store.js'); await st.db.bulkPut('tasks', Array.from({ length: 300 }, (_, i) => ({ id: 'muitas-' + i, title: 'Tarefa em massa ' + i, done: false, due: '', prio: 1, createdAt: Date.now() + i }))); });
    await page.reload(); await wait(1300);
    await nav('tasks'); await page.click('#task-mode [data-m=list]'); await page.click('#task-filter [data-f=pending]'); await wait(200);
    const n0 = await page.locator('#task-list .task').count();
    assert(n0 === 200 && await page.locator('#task-more').isVisible(), 'primeiro bloco: ' + n0);
    await page.click('#task-more'); await wait(200);
    assert(await page.locator('#task-list .task').count() > 300, 'Mostrar mais');
    await page.evaluate(async () => { const st = await import('./js/store.js'); for (let i = 0; i < 300; i++) await st.db.del('tasks', 'muitas-' + i); });
    await page.reload(); await wait(1200);
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
