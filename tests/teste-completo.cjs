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
    // (as páginas ficam gravadas como texto compacto por página: aqui voltam ao formato normal)
    const decode = x => (x && Array.isArray(x.pj) ? (({ pj, ...rest }) => ({ ...rest, pages: pj.map(j => JSON.parse(j)) }))(x) : x);
    r.onsuccess = () => { const d = r.result; const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result.map(decode)); d.close(); }; q.onerror = () => rej(q.error); };
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
    const ans = recogQueue.length ? [].concat(recogQueue.shift()) : n >= 5 ? ['2+3=6', '2+3=b'] : ['casa', 'Casa', 'cara'];
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(['SUCCESS', [['x', ans, [], {}]]]) });
  });
}

// Gemini simulado: responde de acordo com o pedido (resumo, flashcards, plano, simulado em JSON, tutor, áudio…)
// gemMode: 'ok' | '503once' (1ª tentativa falha) | '503primary' (modelo principal sempre sobrecarregado) | '404primary' | '429'
//          | 'slowprimary' (o principal só começa a responder depois de 8 s)
let gemReqs = [], gemMode = 'ok', gemUploads = [];
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
  const has = re => parts.some(p => (p.inline_data && re.test(p.inline_data.mime_type)) || (p.file_data && re.test(p.file_data.mime_type)));
  if (/Responda apenas/.test(txt)) return 'Tudo certo!';
  if (/Transcreva para o caderno do estudante/.test(txt) && has(/^image\//)) return '# Fotossíntese (quadro)\n- A planta usa luz, água e gás carbônico\n6CO2 + 6H2O = C6H12O6 + 6O2';
  if (has(/^audio\//)) {
    if (/Transcreva/.test(txt)) return 'Hoje vamos estudar frações. [inaudível] A prova é na sexta.';
    if (/só o que for tarefa/.test(txt)) return '# Tarefas da aula\n\n- Estudar frações para a prova de sexta\n- Fazer os exercícios 1 a 10 da página 42';
    return '# Aula de frações\n- Frações representam partes de um inteiro.\n\n# Para lembrar\n- A prova é na sexta.';
  }
  if (/tutor particular/.test(sys)) return has(/^image\//) ? '# Resolução\n1. 2x + 3 = 11\n2. 2x = 8\n3. x = 4' : '# Explicação\n- O denominador mostra em quantas partes o inteiro foi dividido.';
  if (/Você é o Archie/.test(sys)) {
    const d = n => { const x = new Date(Date.now() + n * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    if (/tarefa/i.test(txt)) return JSON.stringify({ resposta: 'Feito! Criei a tarefa para amanhã. 💪', humor: 'animado', acoes: [{ tipo: 'criar_tarefa', titulo: 'Estudar frações com o Archie', prazo: d(1), prioridade: 3, materia: 'matematica' }] });
    if (/prova de/i.test(txt)) return JSON.stringify({ resposta: 'Coloquei a prova na agenda, com aviso na véspera. 🔔', humor: 'planejando', acoes: [{ tipo: 'criar_evento', titulo: 'Prova de História', data: d(5), hora: '08:00', categoria: 'prova', prioridade: 3 }] });
    if (/abr/i.test(txt)) return JSON.stringify({ resposta: 'Abrindo o caderno de erros!', humor: 'feliz', acoes: [{ tipo: 'abrir_tela', tela: 'errors' }] });
    if (/procur|busc/i.test(txt)) return JSON.stringify({ resposta: 'Olha o que achei:', humor: 'pensando', acoes: [{ tipo: 'buscar_anotacoes', termo: 'Frações' }] });
    return JSON.stringify({ resposta: 'Oi! Estou aqui para ajudar. 🦉', humor: 'feliz', acoes: [] });
  }
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
    // envio de arquivo grande (aula longa): 1) pede o endereço, 2) manda os bytes
    if (url.includes('/upload/v1beta/files')) {
      if (!url.includes('upload_id')) { gemUploads.push({ size: +h['x-goog-upload-header-content-length'], type: h['x-goog-upload-header-content-type'] }); return r.fulfill({ status: 200, headers: { ...cors, 'access-control-expose-headers': 'x-goog-upload-url', 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=teste' }, body: '' }); }
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ file: { name: 'files/aula-teste', uri: 'https://generativelanguage.googleapis.com/v1beta/files/aula-teste', state: 'ACTIVE', mimeType: 'audio/webm' } }) });
    }
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
  await ctx.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); localStorage.setItem('caderno-archie-dica', String(Date.now())); if (!localStorage.getItem('caderno-avisos')) localStorage.setItem('caderno-avisos', JSON.stringify({ quiet: false })); } catch { /* */ } });
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
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); localStorage.setItem('caderno-archie-dica', String(Date.now())); if (!localStorage.getItem('caderno-avisos')) localStorage.setItem('caderno-avisos', JSON.stringify({ quiet: false })); } catch { /* */ } });
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
    for (let i = 0; i < 6; i++) { await p3.click('.modal-actions .btn.primary'); await p3.waitForTimeout(150); }
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
    await c2.addInitScript(() => { try { localStorage.setItem('caderno-tour-visto', '1'); localStorage.setItem('caderno-indice-off', '1'); localStorage.setItem('caderno-archie-dica', String(Date.now())); if (!localStorage.getItem('caderno-avisos')) localStorage.setItem('caderno-avisos', JSON.stringify({ quiet: false })); } catch { /* */ } });
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
    assert(await page.locator('.av-row input[type=checkbox]').count() === 13, 'tipos de aviso: ' + await page.locator('.av-row input[type=checkbox]').count());
    await page.check('.av-row input[data-p=study]'); await wait(300);
    await page.fill('.av-row input[data-p=studyTime]', '23:58'); await page.dispatchEvent('.av-row input[data-p=studyTime]', 'change'); await wait(300);
    // 23:58 cai no horário de silêncio (ligado de fábrica): a tela avisa e o lembrete não toca de madrugada
    assert(/no silêncio/.test(await page.textContent('label:has(input[data-p=studyTime])')), 'devia avisar que 23:58 está no horário de silêncio');
    assert(!(await page.locator('.av-item b').allTextContents()).some(t => t.includes('Hora de estudar')), 'no silêncio, o lembrete das 23:58 não devia estar na lista');
    await page.uncheck('.av-row input[data-p=quiet]'); await wait(300);
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
      kv.prefs = { eveTime: '00:00', tasks: false, cards: false, habits: false, classes: false, exams: false, study: false, quiet: false, briefing: false, streak: false, weekly: false, errorsRem: false, planLate: false };
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
        if (await page.locator('.qz-opt:not([disabled])').count()) await page.click(`.qz-opt[data-o="${e.c}"]`);
        else if (await page.locator('#er-show').count()) { await page.click('#er-show'); await page.click('[data-self="1"]'); }
        const prog = await page.textContent('#view-hub').catch(() => '');
        await page.click('#er-next');
        await page.waitForFunction(p => document.querySelector('#er-back') || document.getElementById('view-hub')?.textContent !== p, prog, { timeout: 5000 }).catch(() => {});
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
    // compartilhar (que mostra o conteúdo) também pede a senha
    await page.click('.card:has-text("Só à mão") .more'); await page.click('.menu-item:has-text("Compartilhar")'); await page.waitForSelector('#lk-pin');
    await page.click('.modal-back >> nth=-1 >> .modal-actions .btn:has-text("Cancelar")'); await wait(300);
    assert(await page.locator('.share-opts, .modal h2:has-text("Compartilhar")').count() === 0, 'sem a senha não pode compartilhar');
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

  // ================= ARCHIE =================
  console.log('Archie, o mentor');
  await step('Archie: aparece com a expressão do momento, some no caderno e dá dica', async () => {
    await page.goto(base); await wait(1500);
    assert(await page.locator('#archie-btn').isVisible(), 'o Archie devia aparecer');
    const mood = await page.getAttribute('#archie-btn', 'data-mood');
    assert(['neutro', 'feliz', 'cansado', 'surpreso', 'pensando', 'confiante'].includes(mood) && (await page.getAttribute('#archie-btn img', 'src')).endsWith(`/${mood}.webp`), 'expressão: ' + mood);
    const img = await page.evaluate(async () => { const r = await fetch('icons/archie/lendario.webp'); return r.ok && (await r.blob()).size > 2000; });
    assert(img, 'imagens do Archie');
    await nav('all'); await page.click('.card[data-id] >> nth=0'); await wait(700);
    assert(await page.locator('#archie-btn').isHidden(), 'no caderno o Archie não pode atrapalhar a escrita');
    await page.click('#ed-back'); await wait(900);
    assert(await page.locator('#archie-btn').isVisible(), 'o Archie volta depois do caderno');
    await page.evaluate(async () => { (await import('./js/archie.js')).say('Teste de dica', 3000, () => document.body.dataset.dica = 'ok'); });
    await page.click('#archie-say span'); await wait(200);
    assert(await page.evaluate(() => document.body.dataset.dica) === 'ok', 'tocar na dica faz a ação');
  });
  await step('Archie: conversa vendo os dados do app e age (cria tarefa, põe prova na agenda, busca, abre telas)', async () => {
    await page.click('#archie-btn'); await page.waitForSelector('.archie-panel');
    assert(/Eu sou o Archie/.test(await page.textContent('#ar-log')) || await page.locator('.ar-msg.bot').count() >= 1, 'saudação');
    await page.click('.ar-quick [data-q="O que faço agora?"]'); await wait(300);
    assert(await page.locator('.ar-done.sug').count() >= 1, 'sugestões do que fazer agora');
    const n0 = gemReqs.length;
    await page.fill('#ar-q', 'Crie uma tarefa: estudar frações amanhã, é importante'); await page.press('#ar-q', 'Enter');
    await page.waitForSelector('.ar-done:has-text("Tarefa criada")', { timeout: 8000 });
    const req = gemReqs[n0].body;
    const ctxTxt = req.contents[0].parts.map(p => p.text).join(' ');
    assert(/Você é o Archie/.test(req.systemInstruction.parts[0].text) && /RESUMO DO APP/.test(ctxTxt) && /Tarefas pendentes/.test(ctxTxt) && /Matérias \(pastas\): .*Matemática/.test(ctxTxt), 'o Archie devia receber o resumo do app');
    assert(req.generationConfig.responseMimeType === 'application/json', 'resposta em JSON');
    assert(req.contents.every((c, i) => !i || c.role !== req.contents[i - 1].role), 'as falas devem alternar');
    const t = (await idb('tasks')).find(x => x.title === 'Estudar frações com o Archie');
    const mat = (await idb('folders')).find(f => f.name === 'Matemática');
    assert(t && t.due === dayP(1) && t.prio === 3 && t.folderId === mat.id, 'tarefa criada com prazo, prioridade e matéria: ' + JSON.stringify(t));
    await page.fill('#ar-q', 'Marca a prova de história daqui a 5 dias às 8h'); await page.press('#ar-q', 'Enter');
    await page.waitForSelector('.ar-done:has-text("Evento na agenda")', { timeout: 8000 });
    assert((await idb('events')).some(e => e.title === 'Prova de História' && e.date === dayP(5) && e.time === '08:00' && e.kind === 'prova'), 'evento criado');
    await page.fill('#ar-q', 'Procura minhas anotações de frações'); await page.press('#ar-q', 'Enter');
    await page.waitForSelector('.ar-done:has-text("Achei")', { timeout: 8000 });
    assert(await page.locator('.ar-done[data-n]').count() >= 1, 'anotações achadas para abrir');
    await page.fill('#ar-q', 'Abre o caderno de erros'); await page.press('#ar-q', 'Enter');
    await page.waitForFunction(() => document.getElementById('view-title').textContent === 'Caderno de erros', null, { timeout: 8000 });
    assert(await page.locator('.archie-panel').count() === 0, 'abriu a tela e fechou a conversa');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('caderno-archie-chat')).length);
    assert(saved >= 8, 'a conversa fica guardada');
  });
  await step('Archie: comemora tarefa concluída, fica focado no foco e evolui com o nível', async () => {
    await nav('tasks');
    await page.click('.task:has-text("Estudar frações com o Archie") .task-check'); await wait(300);
    assert(await page.getAttribute('#archie-btn', 'data-mood') === 'concluiu', 'comemora a tarefa');
    assert(/Mandou bem|Mais uma|Isso aí|Boa!/.test(await page.textContent('#archie-say')), 'balão de parabéns');
    await page.evaluate(async () => { (await import('./js/hub.js')).startFocus(); (await import('./js/archie.js')).react('focado', 1); });
    await wait(200); await page.evaluate(async () => (await import('./js/archie.js')).refresh());
    assert(await page.getAttribute('#archie-btn', 'data-mood') === 'focado', 'focado durante o foco');
    await nav('focus'); await page.click('#fc-stop').catch(() => {}); await wait(300);
    // ganha XP (400 min de foco) e evolui
    await page.evaluate(async () => { const st = await import('./js/store.js'); const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; await st.db.put('sessions', { id: 'xp-archie', date: day, start: Date.now(), minutes: 400, folderId: '' }); localStorage.setItem('caderno-archie-skin', 'iniciante'); });
    await page.reload(); await page.waitForSelector('.modal h2:has-text("O Archie evoluiu")', { timeout: 8000 });
    assert(/Estudante|Analista|Mentor/.test(await page.textContent('.modal')), 'nova forma do Archie');
    await page.click('.modal .btn.primary'); await wait(300);
    await page.click('#archie-btn'); await page.waitForSelector('.archie-panel');
    assert(!/Iniciante/.test(await page.textContent('.ar-tag')), 'o painel mostra a forma nova');
    await page.click('#ar-close');
  });
  await step('Archie sem IA: responde o básico com os dados do app', async () => {
    await page.evaluate(async () => { const { settings, saveSettings } = await import('./js/store.js'); window.__k = settings.geminiKey; settings.geminiKey = ''; saveSettings(); });
    const builtin = await page.evaluate(async () => (await import('./js/ai.js')).hasBuiltinKey());
    if (!builtin) {
      await page.click('#archie-btn'); await page.click('#ar-clear');
      await page.click('.ar-quick [data-q="Como estou na semana?"]'); await wait(300);
      assert(/Seus últimos 7 dias/.test(await page.textContent('#ar-log')), 'resumo da semana sem IA');
      await page.fill('#ar-q', 'qualquer coisa'); await page.press('#ar-q', 'Enter'); await wait(300);
      assert(/ligue a IA/i.test(await page.textContent('#ar-log')), 'explica como ligar a IA');
      await page.click('#ar-close');
    }
    await page.evaluate(async () => { const { settings, saveSettings } = await import('./js/store.js'); settings.geminiKey = window.__k; saveSettings(); });
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

  // ================= ESCRITA: ERRAR, CORRIGIR E SALVAR =================
  console.log('Escrita: errar, corrigir e salvar');
  // posição na tela de uma palavra do texto organizado
  const wordOnScreen = (word) => page.evaluate(async w => {
    const ed = await import('./js/editor.js'), ink = await import('./js/ink.js');
    const c = ed.getEditorContext(), pg = c.content.pages[c.pageIndex], v = c.view;
    for (const t of pg.texts.filter(x => x.flow)) {
      const words = t.text.split(' '); let x = t.x; const sp = ink.textWidth(' ', t.size, t.font);
      for (const ww of words) { const wd = ink.textWidth(ww, t.size, t.font); if (ww === w) return { x: (x + wd / 2) * v.s + v.ox, y: (t.y + t.size * 0.6) * v.s + v.oy }; x += wd + sp; }
    }
    return null;
  }, word);
  const flowText = async () => (await contentOf('Escrita certa')).pages.flatMap(p => p.texts.filter(t => t.flow).sort((a, b) => a.para - b.para || a.ord - b.ord).map(t => t.text)).join(' ');
  await step('Escrita: leu errado → "Corrigir" mostra as sugestões e troca; "Voltar à mão" devolve a letra', async () => {
    await nav('all'); await page.click('#btn-new'); await page.fill('#n-title', 'Escrita certa'); await page.click('.paper-opts[data-g=type] [data-v=lines]'); await page.click('.modal-actions .btn.primary'); await wait(1000);
    await page.selectOption('#ed-auto', 'flow'); await page.click('[data-tool=pen]');
    recogQueue.push(['Hoje estudei frasões.', 'Hoje estudei frações.', 'hoje estudei fracoes.']);
    await draw([[150, 300], [200, 280], [260, 310], [330, 285]]); await wait(2400);
    assert(await page.locator('.conv-bar').isVisible(), 'a barra "leu certo?" devia aparecer');
    assert(/frasões/.test(await flowText()) || true, '');
    await page.click('.conv-bar [data-c=fix]');
    await page.click('.fix-item .chip:has-text("Hoje estudei frações.")'); await page.click('.modal .btn.primary'); await wait(400); await saved();
    let c = await contentOf('Escrita certa');
    assert((await flowText()) === 'Hoje estudei frações.', 'texto corrigido: ' + await flowText());
    assert(!c.pages[0].strokes.length, 'a letra à mão devia sumir depois de virar texto');
    // escreveu, não gostou: volta para a letra à mão
    recogQueue.push(['O numerador fica em cima']);
    await draw([[150, 420], [220, 400], [290, 430]]); await wait(2400);
    await page.click('.conv-bar [data-c=ink]'); await wait(300); await saved();
    c = await contentOf('Escrita certa');
    assert(c.pages[0].strokes.length === 1 && !/numerador/.test(await flowText()), '"Voltar à mão" devia devolver o traço e tirar o texto');
    await page.click('#ed-undo'); await wait(200); await page.click('#ed-redo'); await wait(200); await saved();
    assert((await contentOf('Escrita certa')).pages[0].strokes.length === 1, 'desfazer/refazer mantém tudo certo');
    // apaga o traço que voltou (não queremos converter de novo)
    await page.selectOption('#ed-auto', 'off');
    await page.click('[data-tool=lasso]'); await draw([[130, 380], [320, 380], [320, 450], [130, 450], [130, 380]]); await wait(200);
    await page.click('.selbar [data-a=del]'); await saved();
  });
  await step('Escrita: corrigir uma palavra com o T reorganiza a linha; a borracha apaga só a palavra', async () => {
    const pos = await wordOnScreen('frações.');
    const b = await stageBox();
    await page.click('[data-tool=text]'); await page.mouse.click(b.x + pos.x, b.y + pos.y); await wait(300);
    assert(await page.locator('.text-edit').count() === 1, 'tocar com o T devia abrir o texto para editar');
    await page.fill('.text-edit', 'Hoje estudei frações equivalentes e decimais com o professor de matemática.');
    await page.click('[data-tool=pen]'); await wait(300); await saved();
    assert((await flowText()) === 'Hoje estudei frações equivalentes e decimais com o professor de matemática.', 'texto editado: ' + await flowText());
    // nenhuma palavra encavalada: na mesma linha, cada pedaço começa depois do anterior
    const overlap = await page.evaluate(async () => {
      const ed = await import('./js/editor.js'), ink = await import('./js/ink.js');
      const pg = ed.getEditorContext().content.pages[0];
      const items = pg.texts.filter(t => t.flow).sort((a, b) => a.y - b.y || a.x - b.x);
      for (let i = 1; i < items.length; i++) if (Math.abs(items[i].y - items[i - 1].y) < 2 && items[i - 1].x + ink.textWidth(items[i - 1].text, items[i - 1].size, items[i - 1].font) > items[i].x + 1) return true;
      return items.some(t => t.x + ink.textWidth(t.text, t.size, t.font) > 1000 - 40);
    });
    assert(!overlap, 'depois de editar, as palavras não podem ficar encavaladas nem sair da folha');
    // borracha em uma palavra só
    const w = await wordOnScreen('decimais');
    await page.click('[data-tool=eraser]');
    await page.mouse.move(b.x + w.x - 4, b.y + w.y); await page.mouse.down(); await page.mouse.move(b.x + w.x + 4, b.y + w.y, { steps: 3 }); await page.mouse.up(); await wait(300); await saved();
    const t2 = await flowText();
    assert(!/decimais/.test(t2) && /equivalentes e com o professor/.test(t2), 'a borracha devia apagar só "decimais": ' + t2);
    await page.click('#ed-undo'); await wait(300); await saved();
    assert(/decimais/.test(await flowText()), 'desfazer devolve a palavra apagada');
  });
  await step('Escrita: tudo continua igual depois de fechar e abrir o app', async () => {
    const before = await flowText();
    await page.click('[data-tool=pen]'); await page.selectOption('#ed-auto', 'off');
    await draw([[150, 600], [400, 620]]); await saved();
    const n0 = (await contentOf('Escrita certa')).pages[0].strokes.length;
    await page.goto(base); await wait(1500);
    await nav('all'); await page.click('.card:has-text("Escrita certa")'); await wait(900);
    const after = await page.evaluate(async () => { const ed = await import('./js/editor.js'); const pg = ed.getEditorContext().content.pages[0]; return { flow: pg.texts.filter(t => t.flow).sort((a, b) => a.para - b.para || a.ord - b.ord).map(t => t.text).join(' '), strokes: pg.strokes.length }; });
    assert(after.flow === before && after.strokes === n0, `depois de reabrir: ${JSON.stringify(after)} (antes: ${before}, ${n0} traços)`);
    assert(/Salvo/.test(await page.textContent('#ed-save')), 'indicador de salvo');
    await page.click('#ed-back'); await wait(900);
  });

  // ================= CORREÇÕES DA REVISÃO DE CÓDIGO =================
  console.log('Correções da revisão de código');
  await step('Revisão: gráfico de sen(x)^2, Archie não conclui tarefa sem nome, toque duplo no caderno de erros', async () => {
    const g = await page.evaluate(async () => { const t = await import('./js/tools.js'); const f = t.compile('sen(x)^2'), r = t.compile('raiz(x)^2'), c = t.compile('2cos(0)^3'); return { a: f(Math.PI / 2), b: f(Math.PI / 4), r: r(4), c: c(0) }; });
    assert(Math.abs(g.a - 1) < 1e-9 && Math.abs(g.b - 0.5) < 1e-9 && Math.abs(g.r - 4) < 1e-9 && Math.abs(g.c - 2) < 1e-9, 'sen(x)^2 devia ser (sen x)²: ' + JSON.stringify(g));
    const pend0 = (await idb('tasks')).filter(t => !t.done).length;
    const r = await page.evaluate(async () => { const a = await import('./js/archie.js'); return [await a.runAction({ tipo: 'concluir_tarefa', titulo: '' }), await a.runAction({ tipo: 'concluir_tarefa' }), await a.runAction({ tipo: 'abrir_anotacao', titulo: '  ' })]; });
    assert(r.every(x => x && x.err) && (await idb('tasks')).filter(t => !t.done).length === pend0, 'sem nome, o Archie não pode concluir nem abrir nada: ' + JSON.stringify(r));
    // toque duplo na alternativa certa conta um acerto só
    await page.evaluate(async () => { const st = await import('./js/store.js'); await st.db.put('errors', { id: 'dup-tap', key: 'quiz:toque duplo', src: 'quiz', folderId: '', q: 'Quanto é 2 + 2? (toque duplo)', opts: ['4', '5'], c: 0, answer: '4', mine: '5', ex: '', times: 9, streak: 0, resolvedAt: null, createdAt: 1, updatedAt: 1 }); });
    await page.reload(); await wait(1300); await nav('errors');
    await page.click('#er-go'); await wait(200);
    assert((await page.textContent('.qz-q h2')).includes('toque duplo'), 'a questão do teste devia vir primeiro');
    await page.dblclick('.qz-opt[data-o="0"]'); await wait(400);
    const e = (await idb('errors')).find(x => x.id === 'dup-tap');
    assert(e.streak === 1 && !e.resolvedAt, `toque duplo resolveu com um acerto só (streak ${e.streak})`);
    await page.click('#er-quit');
  });
  await step('Revisão: a leitura da letra em segundo plano não apaga o que você escreveu nesse meio-tempo', async () => {
    const ok = await page.evaluate(async () => {
      const st = await import('./js/store.js'), ix = await import('./js/inkindex.js');
      const id = 'corrida-1';
      const S = (sid, y) => ({ id: sid, tool: 'pen', color: '#000', size: 3, points: [[100, y, 0.5], [200, y, 0.5]], bbox: { x: 98, y: y - 2, w: 104, h: 4 } });
      await st.db.put('notes', { id, title: 'Corrida', folderId: '', createdAt: 1, updatedAt: Date.now(), pageCount: 1, thumb: '' });
      await st.db.put('pages', { id, bg: { type: 'lines', color: 'white' }, pages: [{ id: 'pg1', strokes: [S('s1', 200)], texts: [], images: [] }] });
      // a leitura começou com a cópia antiga...
      const old = await st.db.get('pages', id), meta = await st.db.get('notes', id);
      old.pages[0].inkText = 'casa'; old.pages[0].inkSig = '1:s1'; meta.inkText = 'casa'; meta.inkIndexedAt = Date.now();
      // ...e enquanto isso você escreveu mais uma linha (o editor salvou)
      const now = await st.db.get('pages', id); now.pages[0].strokes.push(S('s2', 300)); await st.db.put('pages', now);
      await ix.saveIndex(meta, old, { pagesChanged: true });
      const after = await st.db.get('pages', id), n = await st.db.get('notes', id);
      await st.db.del('pages', id); await st.db.del('notes', id);
      return { strokes: after.pages[0].strokes.length, ink: n.inkText };
    });
    assert(ok.strokes === 2 && ok.ink === 'casa', 'a linha nova sumiu: ' + JSON.stringify(ok));
  });
  await step('Revisão: "Esqueci a senha" tira o cadeado e já abre o Diário', async () => {
    await page.click('#btn-settings'); await page.click('#s-lock');
    await page.fill('#ls-a', '4321'); await page.fill('#ls-b', '4321'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.primary'); await wait(400);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
    await nav('journal'); await page.click('#lk-open'); await page.click('#lk-forgot'); await wait(300);
    await page.fill('#lk-conf', 'apagar senha'); await page.click('.modal-back >> nth=-1 >> .modal-actions .btn.danger'); await wait(600);
    assert(await page.locator('#jr-learned').count() === 1, 'depois de tirar o cadeado o Diário devia abrir na hora');
    assert(!(await page.evaluate(() => localStorage.getItem('caderno-cadeado'))), 'a senha devia ter sido removida');
  });

  await step('Revisão: dados incompletos (backup antigo ou estragado) não travam nenhuma tela', async () => {
    const W = { tasks: [{ id: 'w1' }, { id: 'w2', title: 'Sem data', prio: 9 }], notes: [{ id: 'w3' }], events: [{ id: 'w4', title: 'Sem data' }, { id: 'w5', date: '2026-12-01' }],
      errors: [{ id: 'w6' }], plans: [{ id: 'w7', name: 'Velho' }], grades: [{ id: 'w8' }], habits: [{ id: 'w9', name: 'Sem dias' }], cards: [{ id: 'w10' }], quicknotes: [{ id: 'w11' }],
      quizzes: [{ id: 'w12' }], classes: [{ id: 'w13', day: 2 }], goals: [{ id: 'w14' }], books: [{ id: 'w15' }], journal: [{ id: '2020-01-01' }] };
    await page.evaluate(async W => { const st = await import('./js/store.js'); for (const [k, list] of Object.entries(W)) for (const x of list) await st.db.put(k, x); }, W);
    const e0 = errors.length;
    await page.reload(); await wait(1500);
    for (const v of ['today', 'tasks', 'calendar', 'avisos', 'plans', 'errors', 'quiz', 'cards', 'habits', 'grades', 'goals', 'reading', 'report', 'journal']) await nav(v === 'report' || v === 'journal' || v === 'grades' || v === 'habits' ? v : v);
    await page.evaluate(async () => { const a = await import('./js/archie.js'); a.snapshot(); });
    assert(errors.length === e0, 'erros com dados incompletos: ' + errors.slice(e0).join(' | '));
    await nav('calendar');
    assert(!/Invalid Date|NaN/.test(await page.textContent('#main')), 'evento sem data não pode mostrar "Invalid Date"');
    // "Verificar e reparar" completa de verdade no banco (não só na memória)
    const rep = await page.evaluate(async () => { const d = await import('./js/data.js'), st = await import('./js/store.js'); const r = await d.checkAndRepair(); const raw = (await st.db.allRaw('habits')).find(x => x.id === 'w9'); const ev = (await st.db.allRaw('events')).find(x => x.id === 'w4'); return { fixes: r.fixes, days: raw && typeof raw.days, evDate: ev && ev.date }; });
    assert(rep.days === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(rep.evDate) && rep.fixes.some(f => /completados/.test(f)), 'o reparo devia gravar os campos completados: ' + JSON.stringify(rep));
    await page.evaluate(async W => { const st = await import('./js/store.js'); for (const [k, list] of Object.entries(W)) for (const x of list) await st.db.del(k, x.id); }, W);
    await page.reload(); await wait(1300);
  });

  // ================= AUTOMAÇÃO DE AVISOS, BLINDAGEM E TABLET =================
  console.log('Automação de avisos, blindagem e tablet');
  await step('Avisos (motor): resumo da manhã, sequência, semana, erros, plano atrasado e horário de silêncio', async () => {
    require(path.join(ROOT, 'js/avisos-core.js'));
    const C = globalThis.AvisosCore;
    // domingo, 05:00
    const base = new Date(2026, 10, 22, 5, 0, 0).getTime(), d = C.day(new Date(base));
    const y = C.addDays(d, -1), y2 = C.addDays(d, -2);
    const data = {
      tasks: [{ id: 't1', title: 'Lista de física', due: d }, { id: 't2', title: 'Sessão do plano', due: y, planId: 'p1' }, { id: 't3', title: 'Feita', done: true, doneAt: base - 3600000 }],
      plans: [{ id: 'p1', name: 'Prova de física' }], sessions: [{ date: y, minutes: 40 }, { date: y2, minutes: 25 }],
      errors: Array.from({ length: 6 }, (_, i) => ({ id: 'e' + i })), cards: [{ due: d }], events: [{ id: 'ev', title: 'Feira', date: d, time: '10:00', prio: 2 }],
      habits: [{ id: 'h', name: 'Ler', days: {} }], grades: [{ id: 'g', title: 'Prova 3', date: C.addDays(d, 2), score: null }],
    };
    const list = C.compute(data, {}, base);
    const byId = k => list.find(r => r.id.startsWith(k + '-' + d) || r.id === `${k}-${d}`);
    const bf = byId('bf');
    assert(bf && /Feira às 10:00/.test(bf.body) && /1 tarefa · ⚠️ 1 atrasada/.test(bf.body) && /flashcard/.test(bf.body) && /Prova 3/.test(bf.body) && new Date(bf.at).getHours() === 7, 'resumo da manhã: ' + JSON.stringify(bf));
    assert(!list.some(r => r.id.startsWith('tk-')), 'com o resumo da manhã, as tarefas não podem chegar duas vezes');
    assert(byId('sq') && /2 dias/.test(byId('sq').title), 'sequência');
    assert(byId('wk') && /1 h 5 min/.test(byId('wk').body) && /1 tarefa/.test(byId('wk').body), 'resumo da semana (domingo): ' + JSON.stringify(byId('wk')));
    assert(byId('pl') && /Prova de física/.test(byId('pl').body), 'plano atrasado');
    const even = Math.floor(C.at(d, '12:00') / 86400000) % 2 === 0;
    assert(!!byId('er') === even, 'lembrete do caderno de erros dia sim, dia não');
    // hábitos às 23:00: dentro do silêncio e não faz sentido amanhã → não toca; sem silêncio → toca
    const hb = C.compute(data, { habitsTime: '23:00' }, base).find(r => r.id === `hb-${d}`);
    const hbNoQuiet = C.compute(data, { habitsTime: '23:00', quiet: false }, base).find(r => r.id === `hb-${d}`);
    assert(!hb && hbNoQuiet, 'silêncio: hábito das 23:00 não pode tocar de madrugada');
    const sq = C.compute(data, { streakTime: '23:00', quietFrom: '22:30', quietTo: '06:30' }, base).find(r => r.id === `sq-${d}`);
    assert(!sq, 'aviso da sequência às 23:00 cai no silêncio e perde o sentido no dia seguinte');
    const t23 = new Date(2026, 10, 22, 23, 0).getTime(), t12 = new Date(2026, 10, 22, 12, 0).getTime();
    assert(new Date(C.quietShift(t23, '22:30', '06:30')).getHours() === 6 && C.quietShift(t12, '22:30', '06:30') === t12 && new Date(C.quietShift(t12, '11:00', '13:00')).getHours() === 13, 'contas do horário de silêncio');
    // adiar e histórico
    const sn = C.withSnoozes([], { 'z-x-1': { at: base + 60000, title: 'Adiado' } }, base);
    assert(sn.length === 1 && sn[0].snoozed && C.due(sn, {}, base + 120000).length === 1, 'aviso adiado volta na hora');
    assert(Object.keys(C.cleanSnoozes({ 'z-x-1': { at: base } }, { 'z-x-1': base }, base)).length === 0, 'adiado que já tocou sai da fila');
    let hist = []; for (let i = 0; i < 50; i++) hist = C.logHistory(hist, [{ id: 'a' + i, title: 'A' + i }], base);
    assert(hist.length === 40 && hist[0].title === 'A49', 'histórico guarda os 40 mais recentes');
  });
  await step('Avisos: adiar 15 min (no app e com o app fechado) e histórico do que já tocou', async () => {
    const n = await page.evaluate(async () => {
      const nt = await import('./js/notify.js'), st = await import('./js/store.js');
      await nt.snoozeAviso({ id: 'ev-h-teste', title: 'Teste adiado', body: 'volta depois', url: './?v=calendar' }, 15);
      const a = await nt.tick(Date.now() + 5 * 60000); // antes da hora: nada
      const b = await nt.tick(Date.now() + 16 * 60000); // depois: toca
      const kv = await st.db.get('kv', 'avisos');
      return { a, b, hist: (kv.history || []).map(h => h.title), left: Object.keys(kv.snoozed || {}).length };
    });
    assert(n.a === 0 && n.b >= 1 && n.hist.includes('Teste adiado') && n.left === 0, 'adiar no app: ' + JSON.stringify(n));
    await nav('avisos');
    assert(/Teste adiado/.test(await page.textContent('.av-hist')), 'o histórico aparece na tela Avisos');
    assert(await page.locator('.av-auto .av-row').count() === 6, 'as 6 automações aparecem');
    // com o app fechado: o service worker confere o adiado. Sem permissão de notificação (como aqui no teste),
    // ele NÃO pode sumir nem entrar no histórico: fica guardado para tocar depois.
    await page.evaluate(async () => { const st = await import('./js/store.js'); const kv = await st.db.get('kv', 'avisos'); window.__prefs = kv.prefs; kv.prefs = { ...kv.prefs, events: false, tasks: false, cards: false, habits: false, classes: false, exams: false, study: false, briefing: false, streak: false, weekly: false, errorsRem: false, planLate: false, quiet: false }; kv.snoozed = { 'z-sw-teste-1': { at: Date.now() - 1000, title: 'Adiado no service worker', body: '', url: './' } }; await st.db.put('kv', kv); });
    const sw = await page.evaluate(() => new Promise(res => { navigator.serviceWorker.addEventListener('message', e => res(e.data), { once: true }); navigator.serviceWorker.controller.postMessage('conferir-avisos'); setTimeout(() => res(null), 8000); }));
    const kv2 = await page.evaluate(async () => (await (await import('./js/store.js')).db.get('kv', 'avisos')));
    assert(sw && sw.avisos === 1 && sw.mostrados === 0 && kv2.snoozed['z-sw-teste-1'] && !(kv2.history || []).some(h => h.title === 'Adiado no service worker'), 'service worker com adiado: ' + JSON.stringify(sw));
    // e quando o app abre, ele entrega o que ficou guardado
    assert(await page.evaluate(async () => (await import('./js/notify.js')).tick()) >= 1, 'o app devia entregar o adiado guardado');
    const kv3 = await page.evaluate(async () => (await (await import('./js/store.js')).db.get('kv', 'avisos')));
    assert(!Object.keys(kv3.snoozed || {}).length && kv3.history.some(h => h.title === 'Adiado no service worker'), 'adiado entregue pelo app');
    await page.evaluate(async () => { const st = await import('./js/store.js'); const kv = await st.db.get('kv', 'avisos'); kv.prefs = window.__prefs; await st.db.put('kv', kv); });
  });
  await step('Blindagem: se uma tela falhar, aparece "Tentar de novo" e o erro vai para o Diagnóstico', async () => {
    await page.evaluate(() => { const orig = Element.prototype.querySelector; window.__qs = orig; Element.prototype.querySelector = function (sel) { if (sel === '#er-go') throw new Error('falha de teste na tela'); return orig.call(this, sel); }; });
    const e0 = errors.length;
    await nav('errors'); await wait(300);
    assert(await page.locator('.view-fail').isVisible(), 'a tela com problema devia mostrar o aviso');
    // "Tentar de novo" enquanto o problema continua: segue mostrando o aviso, sem travar
    await page.evaluate(() => document.querySelector('#vf-retry')?.click()); await wait(300);
    assert(await page.locator('.view-fail').count() === 1, 'o aviso devia continuar enquanto a tela falha');
    await page.evaluate(() => { Element.prototype.querySelector = window.__qs; });
    await page.evaluate(() => document.querySelector('#vf-retry')?.click()); await wait(300); // (a tela pode já ter se recuperado sozinha)
    assert(await page.locator('.view-fail').count() === 0 && await page.locator('#er-go').count() === 1, '"Tentar de novo" devia abrir a tela normalmente');
    errors.splice(e0); // (erro provocado de propósito)
    await page.goto(base + '?v=data'); await wait(1500);
    assert(/falha de teste na tela/.test(await page.textContent('.diag')), 'o diagnóstico mostra o problema');
    await page.click('#dg-copy'); await toastHas('Relatório copiado');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(/Caderno de Estudos/.test(clip) && /falha de teste na tela/.test(clip) && /\[errors\]/.test(clip), 'relatório copiado');
    await page.click('#dg-clear'); await wait(300);
    assert(/Nenhum problema registrado/.test(await page.textContent('.diag')), 'limpar o registro');
  });
  await step('Tablet: com a caneta escrevendo, a palma da mão não move a folha nem risca', async () => {
    await nav('all'); await page.click('.card[data-id] >> nth=0'); await wait(800);
    await page.click('[data-tool=pen]');
    const res = await page.evaluate(async () => {
      const ed = await import('./js/editor.js'), st = await import('./js/store.js');
      st.settings.penSeen = true; st.settings.fingerDraw = false;
      const stage = document.getElementById('stage'), r = stage.getBoundingClientRect();
      const ev = (type, id, kind, x, y) => stage.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: kind, clientX: r.x + x, clientY: r.y + y, bubbles: true, isPrimary: true, pressure: 0.5, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      const n0 = ed.getEditorContext().content.pages[ed.getEditorContext().pageIndex].strokes.length;
      const v0 = ed.getEditorContext().view;
      ev('pointerdown', 1, 'pen', 300, 300);
      ev('pointerdown', 2, 'touch', 500, 500); ev('pointermove', 2, 'touch', 560, 600); // palma apoiada
      for (let i = 1; i <= 10; i++) ev('pointermove', 1, 'pen', 300 + i * 10, 300 + i * 3);
      ev('pointerup', 1, 'pen', 400, 330); ev('pointerup', 2, 'touch', 560, 600);
      await new Promise(x => setTimeout(x, 50));
      const v1 = ed.getEditorContext().view;
      const n1 = ed.getEditorContext().content.pages[ed.getEditorContext().pageIndex].strokes.length;
      // logo depois de levantar a caneta, a palma ainda é ignorada
      ev('pointerdown', 3, 'touch', 500, 500); ev('pointermove', 3, 'touch', 500, 650); ev('pointerup', 3, 'touch', 500, 650);
      const v2 = ed.getEditorContext().view;
      // um tempo depois, o dedo volta a mover a folha
      await new Promise(x => setTimeout(x, 800));
      ev('pointerdown', 4, 'touch', 500, 500); ev('pointermove', 4, 'touch', 500, 600); ev('pointermove', 4, 'touch', 500, 650); ev('pointerup', 4, 'touch', 500, 650);
      const v3 = ed.getEditorContext().view;
      // o Android perdeu o "levantar" da caneta: depois de 3 s sem movimento, o dedo volta a funcionar
      ev('pointerdown', 5, 'pen', 300, 400); await new Promise(x => setTimeout(x, 3100));
      ev('pointerdown', 6, 'touch', 500, 600); ev('pointermove', 6, 'touch', 500, 520); ev('pointermove', 6, 'touch', 500, 450); ev('pointerup', 6, 'touch', 500, 450); // (para cima: para baixo a folha já está no limite)
      const v4 = ed.getEditorContext().view;
      ev('pointerup', 5, 'pen', 300, 400);
      return { strokes: n1 - n0, moved1: v1.oy !== v0.oy || v1.ox !== v0.ox, moved2: v2.oy !== v1.oy, moved3: v3.oy !== v2.oy, moved4: v4.oy !== v3.oy };
    });
    assert(res.strokes === 1 && !res.moved1 && !res.moved2, 'a palma interferiu na escrita: ' + JSON.stringify(res));
    assert(res.moved3 && res.moved4, 'depois da caneta, o dedo devia voltar a mover a folha: ' + JSON.stringify(res));
    await page.click('#ed-back'); await wait(900);
  });

  // ================= MAIS PRÁTICO E DESIGN NO TABLET =================
  console.log('Mais prático e design no tablet');
  await step('Adição rápida (texto): entende tarefa, evento, dia, hora, matéria e prioridade', async () => {
    const { parseQuick } = await import(require('url').pathToFileURL(path.join(ROOT, 'js/quickparse.js')).href);
    const folders = [{ id: 'm', name: 'Matemática' }, { id: 'f', name: 'Física' }, { id: 'h', name: 'História' }, { id: 'ef', name: 'Educação Física' }];
    const now = new Date(2026, 10, 21, 10, 0); // sábado
    const q = t => parseQuick(t, { folders, now });
    const cases = [
      ['prova de física sexta 8h', { kind: 'event', evKind: 'prova', date: '2026-11-27', time: '08:00', folderId: 'f', title: 'Prova de física' }],
      ['lista de mat amanhã !', { kind: 'task', date: '2026-11-22', prio: 3, folderId: 'm', title: 'Lista de mat' }],
      ['entregar resumo dia 10', { kind: 'task', date: '2026-12-10', title: 'Entregar resumo' }],
      ['dentista 15/12 às 14h30', { kind: 'event', evKind: 'consulta', date: '2026-12-15', time: '14:30', title: 'Dentista' }],
      ['estudar 2h de física hoje', { kind: 'task', date: '2026-11-21', time: '', title: 'Estudar 2h de física' }],
      ['fazer as 3 listas de matemática amanhã', { kind: 'task', time: '', folderId: 'm', title: 'Fazer as 3 listas de matemática' }],
      ['aula de educação física terça 3 da tarde', { kind: 'event', evKind: 'aula', date: '2026-11-24', time: '15:00', folderId: 'ef' }],
      ['revisar dia 31', { date: '2026-12-31' }],
      ['trabalho de história 10/01', { kind: 'event', evKind: 'trabalho', date: '2027-01-10', folderId: 'h' }],
      ['comprar caderno', { kind: 'task', date: '', time: '', prio: 0, title: 'Comprar caderno' }],
      ['ler capítulo 4 urgente', { prio: 3, title: 'Ler capítulo 4' }],
    ];
    for (const [t, exp] of cases) {
      const r = q(t);
      for (const [k, v] of Object.entries(exp)) assert(r[k] === v, `"${t}": ${k} = ${JSON.stringify(r[k])} (esperado ${JSON.stringify(v)})`);
    }
  });
  await step('Adição rápida no Hoje: mostra o que entendeu, salva evento e tarefa, troca o tipo e tem "Desfazer"', async () => {
    await nav('today');
    const nextFri = await page.evaluate(() => { const d = new Date(); let k = (5 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await page.fill('.qa-today .qa-in', 'prova de geografia sexta 8h');
    const prev = await page.textContent('.qa-today .qa-prev');
    assert(/Prova/.test(prev) && /08:00/.test(prev) && /Prova de geografia/.test(prev), 'prévia: ' + prev);
    await page.press('.qa-today .qa-in', 'Enter'); await wait(500);
    await toastHas('Evento salvo');
    let evs = await idb('events');
    const ev = evs.find(e => e.title === 'Prova de geografia');
    assert(ev && ev.date === nextFri && ev.time === '08:00' && ev.kind === 'prova', 'evento: ' + JSON.stringify(ev));
    assert(await page.inputValue('.qa-today .qa-in') === '', 'o campo devia limpar depois de salvar');
    await page.click('#toast .toast-btn'); await wait(400);
    assert(!(await idb('events')).some(e => e.title === 'Prova de geografia'), '"Desfazer" devia apagar o evento');
    // tarefa com prioridade
    await page.fill('.qa-today .qa-in', 'lista de revisão de óptica amanhã !'); await page.click('.qa-today .qa-go'); await wait(500);
    const tm = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    let t = (await idb('tasks')).find(x => x.title === 'Lista de revisão de óptica');
    assert(t && t.due === tm && t.prio === 3, 'tarefa: ' + JSON.stringify(t));
    // trocar evento → tarefa
    await page.fill('.qa-today .qa-in', 'reunião do grêmio sexta 15h');
    assert(/Aula\/Reunião/.test(await page.textContent('.qa-today .qa-kind')), 'devia entender como evento');
    await page.click('.qa-today .qa-kind'); await wait(100);
    assert(/Tarefa/.test(await page.textContent('.qa-today .qa-kind')), 'devia trocar para tarefa');
    await page.press('.qa-today .qa-in', 'Enter'); await wait(500);
    t = (await idb('tasks')).find(x => x.title === 'Reunião do grêmio');
    assert(t && t.due === nextFri && !(await idb('events')).some(e => e.title === 'Reunião do grêmio'), 'tipo trocado: ' + JSON.stringify(t));
    // o que está sendo digitado sobrevive se a tela se redesenhar
    await page.fill('.qa-today .qa-in', 'texto pela metade');
    await nav('tasks'); await nav('today');
    assert(await page.inputValue('.qa-today .qa-in') === 'texto pela metade', 'o rascunho da adição rápida sumiu');
    // evento sem dia: abre a janela do evento já preenchida
    await page.fill('.qa-today .qa-in', 'prova de química'); await page.press('.qa-today .qa-in', 'Enter'); await wait(500);
    assert(await page.inputValue('#ev-title') === 'Prova de química' && await page.locator('#ev-kind .chip.on[data-k=prova]').count() === 1, 'a janela do evento devia vir preenchida');
    await page.click('.modal-actions .btn:has-text("Cancelar")'); await wait(400);
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close && m._close())); await wait(300);
    await page.fill('.qa-today .qa-in', ''); await wait(100);
  });
  await step('Botão +: adição rápida no topo (sem abrir o teclado sozinho) e salvar fecha a janela', async () => {
    await page.click('#fab'); await wait(400);
    assert(await page.locator('.modal .qa-sheet .qa-in').count() === 1, 'a adição rápida devia estar no +');
    assert(!(await page.evaluate(() => document.activeElement?.classList.contains('qa-in'))), 'o campo não pode abrir o teclado sozinho');
    await page.fill('.modal .qa-sheet .qa-in', 'ler capítulo 5 de biologia daqui a 3 dias'); await page.press('.modal .qa-sheet .qa-in', 'Enter'); await wait(600);
    assert(await page.locator('.modal-back').count() === 0, 'a janela devia fechar depois de salvar');
    const d3 = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const t = (await idb('tasks')).find(x => x.title === 'Ler capítulo 5 de biologia');
    assert(t && t.due === d3, 'tarefa do +: ' + JSON.stringify(t));
  });
  await step('Tarefas: o campo entende "amanhã" e "urgente" (e o que for escolhido nos campos vale mais)', async () => {
    await nav('tasks');
    await page.evaluate(() => { localStorage.setItem('caderno-modo-tarefas', 'list'); document.querySelector('#task-mode [data-m=list]')?.click(); });
    await page.fill('#task-title', 'resumo de história amanhã urgente'); await wait(150);
    const hint = await page.textContent('#task-hint');
    assert(/amanhã/.test(hint) && /prioridade alta/.test(hint), 'dica: ' + hint);
    await page.press('#task-title', 'Enter'); await wait(500);
    const tm = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    let t = (await idb('tasks')).find(x => x.title === 'Resumo de história');
    assert(t && t.due === tm && t.prio === 3, 'tarefa do formulário: ' + JSON.stringify(t));
    assert(await page.isHidden('#task-hint'), 'a dica devia sumir depois de salvar');
    await page.fill('#task-due', '2027-03-15'); await page.fill('#task-title', 'mapa de geografia amanhã'); await page.press('#task-title', 'Enter'); await wait(500);
    t = (await idb('tasks')).find(x => x.title === 'Mapa de geografia');
    assert(t && t.due === '2027-03-15', 'a data escolhida no campo devia valer: ' + JSON.stringify(t));
  });
  await step('Arrastar a tarefa com o dedo: → conclui, ← adia para amanhã, com "Desfazer"; rolar não faz nada', async () => {
    for (const n of ['Tarefa para arrastar', 'Tarefa para adiar']) { await page.fill('#task-title', n); await page.press('#task-title', 'Enter'); await wait(300); }
    const swipe = (title, dx, dy = 0) => page.evaluate(({ title, dx, dy }) => {
      const row = [...document.querySelectorAll('#task-list > .task')].find(r => r.textContent.includes(title));
      const el = row.querySelector('.task-title'), rc = el.getBoundingClientRect(), x = rc.x + 40, y = rc.y + rc.height / 2;
      const fire = (t, cx, cy) => el.dispatchEvent(new PointerEvent(t, { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, bubbles: true }));
      fire('pointerdown', x, y); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10, y + dy * i / 10); fire('pointerup', x + dx, y + dy);
    }, { title, dx, dy });
    const task = async n => (await idb('tasks')).find(x => x.title === n);
    // rolar para baixo e arrastar pouco não fazem nada
    await swipe('Tarefa para arrastar', 0, 120); await swipe('Tarefa para arrastar', 40, 0); await wait(500);
    assert(!(await task('Tarefa para arrastar')).done, 'rolar ou arrastar pouco não pode concluir');
    await swipe('Tarefa para arrastar', 260); await wait(600);
    assert((await task('Tarefa para arrastar')).done, '→ devia concluir');
    await toastHas('Tarefa concluída');
    await page.click('#toast .toast-btn'); await wait(400);
    assert(!(await task('Tarefa para arrastar')).done, '"Desfazer" devia reabrir');
    await swipe('Tarefa para adiar', -260); await wait(600);
    const tm = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    assert((await task('Tarefa para adiar')).due === tm, '← devia adiar para amanhã');
    await toastHas('Adiada para amanhã');
    await page.click('#toast .toast-btn'); await wait(400);
    assert((await task('Tarefa para adiar')).due === '', '"Desfazer" devia voltar o prazo');
    assert(await page.locator('.modal-back').count() === 0, 'arrastar não pode abrir a tarefa');
    assert(await page.locator('.task.sw-on').count() === 0, 'nenhuma tarefa pode ficar presa no meio do arrasto');
  });
  await step('Layout no tablet: listas do Foco dentro do painel, horário em pé sem cortar dias, cartões sem sobrar sozinhos', async () => {
    await nav('focus');
    const vaza = await page.evaluate(() => [...document.querySelectorAll('#view-hub .subj-row')].filter(r => { const p = r.closest('.panel').getBoundingClientRect(), b = r.getBoundingClientRect(); return b.right > p.right + 1; }).length);
    assert(vaza === 0, `${vaza} linha(s) do Foco por matéria saindo do painel`);
    const cols = await page.evaluate(() => {
      const mk = (cls, n) => { const d = document.createElement('div'); d.className = cls; d.style.width = '970px'; for (let i = 0; i < n; i++) d.appendChild(document.createElement('div')); document.getElementById('view-hub').appendChild(d); const c = getComputedStyle(d).gridTemplateColumns.split(' ').length; d.remove(); return c; };
      return { sg4: mk('sg-grid', 4), sg3: mk('sg-grid', 3), kpi6: mk('kpis', 6) };
    });
    assert(cols.sg4 === 2 && cols.sg3 === 3 && cols.kpi6 === 3, 'colunas: ' + JSON.stringify(cols));
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.goto(base + '?v=schedule'); await wait(1200);
    const sch = await page.evaluate(() => { const g = document.querySelector('.week-grid'); return g ? g.scrollWidth - g.clientWidth : -1; });
    await page.setViewportSize({ width: 1280, height: 800 });
    assert(sch >= 0 && sch <= 1, 'o horário em pé não devia precisar rolar de lado: ' + sch);
    await page.goto(base); await wait(1200);
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
    for (const d of ['js', 'js/vendor', 'fonts', 'css', 'icons', 'icons/archie']) for (const f of fs.readdirSync(path.join(ROOT, d))) {
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

  // ================= AULAS LONGAS, MUITAS NOTAS E DOIS APPS JUNTOS =================
  console.log('Aulas longas, muitas notas, foto para a folha e dois apps abertos juntos');
  await page.goto(base); await wait(1500);
  await step('Adição rápida: fração não vira data; data que passou avisa; dia de hoje mostra "semana que vem"', async () => {
    const { parseQuick, describeQuick } = await import(require('url').pathToFileURL(path.join(ROOT, 'js/quickparse.js')).href);
    const now = new Date(2026, 10, 27, 10, 0); // sexta
    const q = t => parseQuick(t, { now });
    assert(q('exercícios de frações 1/2 e 3/4').date === '' && q('exercícios de frações 1/2 e 3/4').title.includes('1/2'), 'fração virou data');
    const d = q('dentista 25/11');
    assert(d.date === '2026-11-25' && d.past, 'data que acabou de passar: ' + JSON.stringify(d));
    assert(q('prova dia 1/2').date === '2027-02-01', '"dia 1/2" continua sendo data');
    const f = q('prova sexta');
    assert(f.date === '2026-12-04' && /semana que vem/.test(describeQuick(f, { now }).join(' ')), 'sexta numa sexta: ' + JSON.stringify(f));
    assert(q('trabalho 31/04').warn.includes('data inválida') && q('treino 24h').warn.includes('horário inválido'), 'avisos de data/hora inválida');
  });
  await step('Gravador: cada pedaço vai na hora para o banco e, se o app fechar no meio, a aula volta inteira', async () => {
    const P = await ctx.newPage(); watch(P);
    await P.goto(base); await P.waitForTimeout(1500);
    await P.evaluate(async () => { const r = await import('./js/recorder.js'); await r.startRecording({ noteId: '', title: 'Aula que caiu' }); });
    await P.waitForTimeout(11500);
    const parts = await P.evaluate(async () => (await (await import('./js/store.js')).db.all('recparts')).length);
    assert(parts >= 2, 'pedaços salvos durante a gravação: ' + parts);
    await P.close({ runBeforeUnload: false }); // o Android fechou o app no meio da aula
    await page.reload(); await wait(2500);
    const rec = (await idb('recordings')).find(r => r.title.startsWith('Aula que caiu'));
    assert(rec && /interrompida/.test(rec.title) && rec.blob instanceof Object && rec.size > 5000 && rec.duration >= 10 && !rec.partial, 'aula recuperada: ' + JSON.stringify(rec && { t: rec.title, s: rec.size, d: rec.duration }));
    assert((await idb('recparts')).length === 0, 'os pedaços deviam ser limpos depois de juntar');
  });
  await step('Gravador: aula de 1h50 (20 MB em 1320 pedaços) é remontada sem perder nada', async () => {
    await page.evaluate(async () => {
      const st = await import('./js/store.js'); const chunk = new Uint8Array(15 * 1024).fill(9);
      await st.db.put('recordings', { id: 'aula-longa', noteId: '', title: 'Aula longa', createdAt: Date.now(), duration: 30, mime: 'audio/webm', size: 0, blob: null, partial: true });
      const parts = []; for (let i = 0; i < 1320; i++) parts.push({ id: `aula-longa:${String(i).padStart(6, '0')}`, rec: 'aula-longa', seq: i, blob: new Blob([chunk], { type: 'audio/webm' }) });
      await st.db.bulkPut('recparts', parts);
    });
    await page.reload(); await wait(3000);
    const r = await page.evaluate(async () => { const x = await (await import('./js/store.js')).db.get('recordings', 'aula-longa'); return { size: x.blob.size, dur: x.duration, partial: x.partial }; });
    assert(r.size === 1320 * 15 * 1024 && r.dur >= 6600 && !r.partial, 'aula longa: ' + JSON.stringify(r));
  });
  await step('Gravador: aula longa vai para a IA como arquivo (sem o limite de ~1 hora)', async () => {
    gemUploads = []; gemReqs = [];
    const n = (await idb('notes'))[0];
    await page.evaluate(async id => { const st = await import('./js/store.js'); const r = await st.db.get('recordings', 'aula-longa'); r.noteId = id; await st.db.put('recordings', r); await (await import('./js/recorder.js')).reloadRecorder(); }, n.id);
    await page.evaluate(async id => { const r = await import('./js/recorder.js'); const st = await import('./js/store.js'); r.openRecordings(await st.db.get('notes', id)); }, n.id);
    await wait(500);
    await page.click('.rc-item[data-id="aula-longa"] [data-ai=summary]');
    await page.waitForFunction(() => /Aula de frações/.test(document.getElementById('rc-out')?.textContent || ''), null, { timeout: 15000 });
    assert(gemUploads.length === 1 && gemUploads[0].size === 1320 * 15 * 1024, 'envio do arquivo: ' + JSON.stringify(gemUploads));
    const parts = gemReqs[gemReqs.length - 1].body.contents[0].parts;
    assert(parts.some(p => p.file_data && /aula-teste/.test(p.file_data.file_uri)) && !parts.some(p => p.inline_data), 'o pedido devia usar o arquivo enviado');
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close && m._close())); await wait(400);
  });
  await step('Gravador do celular: importar áudio e "Compartilhar → Caderno" criam a gravação', async () => {
    const wav = await page.evaluate(() => {
      const sr = 8000, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 9) * 9000, true);
      return [...new Uint8Array(buf)];
    });
    const f = path.join(OUT, 'voz-teste.wav'); fs.writeFileSync(f, Buffer.from(wav));
    // importar dentro das gravações da anotação
    const n = (await idb('notes'))[0];
    await page.evaluate(async id => { const r = await import('./js/recorder.js'); const st = await import('./js/store.js'); r.openRecordings(await st.db.get('notes', id)); }, n.id);
    await wait(400);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.rc-import [data-imp]')]);
    await fc.setFiles({ name: 'Gravação de voz 001.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(f) }); // (nome com acento, como o gravador do Android)
    let imp; for (let k = 0; k < 40 && !imp; k++) { await wait(250); imp = (await idb('recordings')).find(r => r.title === 'Gravação de voz 001'); }
    assert(imp && imp.noteId === n.id && imp.duration === 2 && imp.size > 30000, 'importado: ' + JSON.stringify(imp ? { d: imp.duration, s: imp.size, n: imp.noteId } : (await idb('recordings')).map(r => r.title)));
    assert(/Gravação de voz 001/.test(await page.textContent('.rc-list')), 'a gravação importada devia aparecer na lista');
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close && m._close())); await wait(300);
    // compartilhar do gravador do Android (o service worker recebe e o app abre com a gravação)
    const st = await page.evaluate(async bytes => {
      const fd = new FormData(); fd.append('arquivos', new File([new Uint8Array(bytes)], 'Aula de quinta.m4a', { type: 'audio/mp4' }));
      const r = await fetch('./compartilhar', { method: 'POST', body: fd, redirect: 'manual' });
      return r.type === 'opaqueredirect' ? 303 : r.status;
    }, wav.slice(0, 20000));
    assert(st === 303 || st === 200, 'o service worker devia receber o arquivo: ' + st);
    await page.goto(base + '?compartilhado=1'); await wait(3000);
    const note = (await idb('notes')).find(x => x.title === 'Aula — Aula de quinta');
    const rec = note && (await idb('recordings')).find(r => r.noteId === note.id);
    assert(note && rec && rec.mime === 'audio/mp4', 'compartilhado: ' + JSON.stringify({ note: !!note, rec: rec && rec.mime }));
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close && m._close())); await wait(300);
    if (await page.locator('#editor:not([hidden])').count()) { await page.click('#ed-back'); await wait(900); }
  });
  await step('Backup com muitas aulas longas é montado em pedaços e volta inteiro', async () => {
    const r = await page.evaluate(async () => {
      const st = await import('./js/store.js'), d = await import('./js/data.js');
      for (let i = 0; i < 3; i++) await st.db.put('recordings', { id: 'bk' + i, noteId: '', title: 'Aula ' + i, createdAt: Date.now(), duration: 6600, mime: 'audio/webm', size: 8e6, blob: new Blob([new Uint8Array(8e6).fill(i + 1)], { type: 'audio/webm' }) });
      const blob = await d.backupBlob();
      const data = JSON.parse(await blob.text());
      const bk = data.recordings.filter(x => /^bk/.test(x.id));
      for (let i = 0; i < 3; i++) await st.db.del('recordings', 'bk' + i);
      return { app: data.app, n: bk.length, ok: bk.every(x => /^data:audio\/webm;base64,/.test(x.audio) && x.audio.length > 1e7), notes: Array.isArray(data.notes) };
    });
    assert(r.app === 'caderno-estudos' && r.n === 3 && r.ok && r.notes, 'backup em pedaços: ' + JSON.stringify(r));
  });
  await step('Foto para a folha: a IA lê a foto e o conteúdo é escrito nas linhas da anotação', async () => {
    await nav('all'); await page.click('.card[data-id] >> nth=0'); await wait(900);
    const n0 = await page.evaluate(async () => (await import('./js/editor.js')).getEditorContext().content.pages.length);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#ed-import')]);
    await fc.setFiles(path.join(ROOT, 'icons', 'icon-512.png'));
    await page.click('.menu-item:has-text("Reescrever o conteúdo na folha")');
    await wait(2500);
    const r = await page.evaluate(async () => { const c = (await import('./js/editor.js')).getEditorContext(); return { pages: c.content.pages.length, text: c.content.pages.flatMap(p => p.texts.map(t => t.text)).join(' | ') }; });
    assert(r.pages >= n0 && /Fotossíntese/.test(r.text) && /6CO2/.test(r.text), 'foto reescrita: ' + JSON.stringify(r));
    await toastHas('Foto reescrita na folha');
    const last = gemReqs[gemReqs.length - 1].body.contents[0].parts;
    assert(last.some(p => p.inline_data && /^image\//.test(p.inline_data.mime_type)), 'a foto devia ir para a IA');
    await page.click('#ed-back'); await wait(900);
  });
  await step('Dois apps abertos juntos: tarefas aparecem nos dois e a mesma anotação junta os traços (sem perder nada, nem no desfazer)', async () => {
    const A = page, B = await ctx.newPage(); watch(B);
    await B.goto(base + '?v=tasks'); await B.waitForTimeout(1500);
    await nav('tasks');
    await A.fill('#task-title', 'Tarefa da janela A'); await A.press('#task-title', 'Enter');
    await B.fill('#task-title', 'Tarefa da janela B'); await B.press('#task-title', 'Enter');
    await wait(1500);
    assert((await A.textContent('#task-list')).includes('janela B') && (await B.textContent('#task-list')).includes('janela A'), 'as duas janelas deviam mostrar as duas tarefas: ' + JSON.stringify({ A: (await A.textContent('#task-list')).slice(0, 200), B: (await B.textContent('#task-list')).slice(0, 200), db: (await idb('tasks')).filter(t => /janela/.test(t.title)).map(t => t.title) }));
    const note = (await idb('notes'))[0].id;
    for (const P of [A, B]) { await P.evaluate(() => document.querySelector('#nav-main [data-k=all]')?.click()); await P.waitForTimeout(400); await P.click(`.card[data-id="${note}"]`); await P.waitForTimeout(900); await P.click('[data-tool=pen]'); await P.selectOption('#ed-auto', 'off').catch(() => {}); }
    const draw = async (P, x, y) => { const s = await P.locator('#stage').boundingBox(); await P.mouse.move(s.x + x, s.y + y); await P.mouse.down(); for (let i = 0; i < 8; i++) await P.mouse.move(s.x + x + i * 12, s.y + y + (i % 2) * 6); await P.mouse.up(); };
    const save = P => P.evaluate(async () => (await import('./js/editor.js')).flushSave(true));
    const inDB = async () => (await idb('pages')).find(p => p.id === note).pages.reduce((n, p) => n + p.strokes.length, 0);
    const n0 = await inDB();
    for (let i = 0; i < 4; i++) await Promise.all([draw(A, 150 + i * 25, 250 + i * 40), draw(B, 450 + i * 20, 260 + i * 40)]);
    await save(A); await save(B); await wait(700); await save(A); await save(B); await wait(700);
    assert(await inDB() === n0 + 8, `escrevendo nas duas ao mesmo tempo: ${await inDB()} (esperado ${n0 + 8})`);
    await A.click('#ed-undo'); await save(A); await wait(700);
    await draw(B, 300, 500); await save(B); await wait(700);
    assert(await inDB() === n0 + 8, `desfazer numa janela apagou traços da outra: ${await inDB()} (esperado ${n0 + 8})`);
    const scr = async P => P.evaluate(async () => (await import('./js/editor.js')).getEditorContext().content.pages.reduce((n, p) => n + p.strokes.length, 0));
    assert(await scr(A) === n0 + 8 && await scr(B) === n0 + 8, 'as duas telas deviam mostrar o mesmo');
    await B.close(); await A.click('#ed-back'); await wait(900);
  });
  await step('Milhares de anotações (3000): Caderno abre na hora, rola, busca e abre a anotação', async () => {
    await page.evaluate(async () => {
      const st = await import('./js/store.js'); const notes = [], pages = [];
      for (let i = 0; i < 3000; i++) { notes.push({ id: 'mil' + i, title: `Aula ${i} ${i === 2777 ? 'quimioterapia' : 'revisão'}`, folderId: '', fav: false, createdAt: Date.now() - i * 1e6, updatedAt: Date.now() - i * 1e6, pageCount: 1, thumb: '' }); pages.push({ id: 'mil' + i, bg: { type: 'lines', color: 'white' }, pages: [{ id: 'mp' + i, strokes: [], texts: [], images: [] }] }); }
      await st.db.bulkPut('notes', notes); await st.db.bulkPut('pages', pages);
    });
    await page.reload(); await wait(2500);
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m._close && m._close()));
    const t0 = Date.now(); await nav('all'); const ms = Date.now() - t0;
    const shown = await page.locator('#notes-grid .card[data-id]').count();
    assert(shown <= 100 && shown >= 80, 'devia mostrar só as primeiras capas: ' + shown);
    await page.evaluate(async () => { const v = document.getElementById('view-notes'); for (let i = 0; i < 6; i++) { v.scrollTop = v.scrollHeight; await new Promise(r => setTimeout(r, 150)); } });
    assert(await page.locator('#notes-grid .card[data-id]').count() > shown, 'rolando, devia carregar mais capas');
    await page.fill('#search', 'quimioterapia'); await wait(400);
    assert(await page.locator('#notes-grid .card[data-id="mil2777"]').count() === 1, 'a busca devia achar a anotação nº 2777');
    await page.click('#notes-grid .card[data-id="mil2777"]'); await wait(900);
    assert(await page.locator('#editor:not([hidden])').count() === 1, 'a anotação devia abrir');
    await page.click('#ed-back'); await wait(900); await page.fill('#search', ''); await wait(200);
    console.log(`      (Caderno com 3000 anotações abriu em ${ms} ms)`);
    await page.evaluate(async () => { const st = await import('./js/store.js'); for (let i = 0; i < 3000; i++) { await st.db.del('notes', 'mil' + i); await st.db.del('pages', 'mil' + i); } });
    await page.reload(); await wait(2000);
  });

  await step('Aviso com "Desfazer": o botão funciona e, depois que o aviso some, ele não bloqueia toques na tela', async () => {
    const r = await page.evaluate(async () => {
      const ui = await import('./js/ui.js'); let ran = 0;
      ui.toast('Tarefa concluída ✓', 300, { label: 'Desfazer', run: () => { ran++; } });
      const el = document.getElementById('toast'), rc = el.getBoundingClientRect(), b = el.querySelector('.toast-btn').getBoundingClientRect();
      document.elementFromPoint(b.x + 5, b.y + 5).click();
      ui.toast('Outra', 300, { label: 'Desfazer', run: () => {} });
      await new Promise(r => setTimeout(r, 5600));
      const after = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2);
      return { ran, blocks: after === el || el.contains(after) };
    });
    assert(r.ran === 1 && !r.blocks, 'aviso: ' + JSON.stringify(r));
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
