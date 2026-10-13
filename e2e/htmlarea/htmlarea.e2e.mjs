/**
 * HtmlAreaControl — prova end-to-end indipendente (chi prova non e' chi implementa).
 *
 * Esprime quel che il controllo PROMETTE, non quel che il codice fa:
 *   A) SICUREZZA. Incollare HTML ostile non esegue nulla e il valore salvato
 *      (onChange -> editor.getHTML()) e' ripulito: niente on*, <script>, <iframe>,
 *      href javascript:. Sono GUARDIE DI REGRESSIONE, non la riproduzione di
 *      GHSA-c8x8-7fp4-3x9w: con lo schema di questo editor (StarterKit + stili di
 *      testo) quel buco di prosemirror-view non e' raggiungibile, e i casi passano
 *      anche su Tiptap 3.27.3 / prosemirror-view 1.42.0. La correzione della
 *      libreria la garantisce la versione (npm audit / npm ls prosemirror-view).
 *      Ogni caso verifica anche che l'incolla sia arrivato, e un controllo
 *      positivo prova che il sensore __pwned scatta davvero.
 *   B) COMPORTAMENTO. La barra (stessi pulsanti/ordine/etichette), grassetto,
 *      elenchi, il round-trip del contenuto legacy CKEditor (color/background/
 *      text-align), documento vuoto -> '' (non '<p></p>'), incolla da Word e da
 *      pagina web -> risultato ragionevole senza markup estraneo.
 *
 * Monta il VERO HtmlAreaControl via una pagina harness servita da Vite (vedi
 * harness.html / harness.tsx / vite.config.mjs), NON il vitest del progetto (che
 * gira senza DOM). L'incolla e' un vero ClipboardEvent('paste') con un
 * DataTransfer che porta text/html, come un Ctrl-V da un'altra app.
 *
 * USO (il server Vite lo avvia da solo su :5181; passa --no-server se ne hai
 * gia' uno su BASE):
 *   PLAYWRIGHT_DIR=/home/luca/.npm/_npx/7f4967a1621aa3dc/node_modules \
 *     node e2e/htmlarea/htmlarea.e2e.mjs [--headed] [--only <sottostringa>] [--list]
 *
 * Confronto vecchia/nuova versione di Tiptap: avvia un dev server su una copia
 * del repo con la 3.27.3 installata e punta qui con --no-server BASE=...; il
 * 13/10/2026 ha dato lo stesso esito su 3.27.3 e su 3.31.4. Esce 1 se almeno un
 * caso fallisce.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/7f4967a1621aa3dc/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const LIST_ONLY = argv.includes('--list');
const NO_SERVER = argv.includes('--no-server');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const PORT = process.env.PORT || '5181';
const BASE = process.env.BASE || `http://localhost:${PORT}/e2e/htmlarea/harness.html`;
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const VITE_CONFIG = fileURLToPath(new URL('./vite.config.mjs', import.meta.url));

/* ---- piccola libreria di asserzioni ------------------------------------ */
let failures = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { results.push({ name, ok: true }); }
  else { failures++; results.push({ name, ok: false, detail }); }
}

/* ---- payload ------------------------------------------------------------ */
// Markup ostile "classico": se qualcosa esegue, scrive window.__pwned=1.
// (alert/confirm/print sono gia' dirottati sul flag nell'harness.)
const HOSTILE_HTML = [
  '<img src=x onerror="window.__pwn()">',
  '<svg><script>window.__pwn()</script></svg>',
  '<script>window.__pwn()</script>',
  '<iframe src="javascript:window.__pwn()"></iframe>',
  '<a href="javascript:window.__pwn()">clic</a>',
  '<p onclick="window.__pwn()" onmouseover="window.__pwn()">testo</p>',
  '<img src=1 href=1 onerror="window.__pwn()"></img>',
  '<body onload="window.__pwn()">x</body>',
  '<details open ontoggle="window.__pwn()"></details>',
].join('\n');

// Contenuto con un `data-pm-slice` ostile (il canale del contesto di ProseMirror).
// Guardia generica: `link` e' un mark, non un nodo, e `onclick` non e' un attributo
// di `paragraph`, quindi qui addContext non ricostruisce niente su nessuna versione.
const PM_SLICE_HTML =
  '<div data-pm-slice=\'1 1 [["link",{"href":"javascript:window.__pwn()"}],' +
  '["paragraph",{"onclick":"window.__pwn()"}]]\'>' +
  '<p><a href="javascript:window.__pwn()">x</a></p></div>';

// Contenuto legacy CKEditor: deve fare il giro senza perdere la formattazione.
const LEGACY_HTML =
  '<p style="text-align:center"><span style="color:#ff0000">rosso</span> ' +
  '<span style="background-color:#ffff00">evidenziato</span> <strong>grassetto</strong></p>';

// Incolla da Word: classi MsoNormal, <o:p>, commenti condizionali, stili mso-*.
const WORD_HTML =
  '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->' +
  '<p class="MsoNormal" style="mso-margin-top-alt:auto"><o:p></o:p>' +
  '<span style="mso-fareast-font-family:Calibri">Testo da <b>Word</b></span></p>';

// Incolla da pagina web: div/span/link/heading.
const WEB_HTML =
  '<div><h2>Titolo</h2><p>Un <a href="https://esempio.it">collegamento</a> e ' +
  '<span style="font-weight:bold">testo</span>.</p></div>';

/* ---- gesto di incolla nel browser -------------------------------------- */
async function pasteHTML(page, html) {
  await page.evaluate((h) => {
    const el = window.__editorEl();
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', h.replace(/<[^>]+>/g, ''));
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    el.dispatchEvent(ev);
  }, html);
  await page.waitForTimeout(150);
}

async function freshPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('nessun errore nella pagina', false, String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  await page.waitForSelector('.htmlarea .ProseMirror', { timeout: 15000 });
  return page;
}

/* ---- i casi ------------------------------------------------------------- */
const DANGEROUS = /on\w+\s*=|<script|<iframe|<svg|javascript:|onerror|onload|onclick|ontoggle|onmouseover/i;

const TESTS = [
  /* -- A) sicurezza -- */
  ['sensore: un payload eseguito fuori dall\'editor porta __pwned a 1', async (page) => {
    await page.evaluate(() => {
      const img = document.createElement('img');
      img.setAttribute('onerror', 'window.__pwn()');
      img.src = 'x';
      document.body.appendChild(img);
    });
    await page.waitForFunction(() => window.__pwned === 1, { timeout: 3000 }).catch(() => {});
    check('il sensore scatta', await page.evaluate(() => window.__pwned) === 1);
  }],

  ['sicurezza: incolla ostile non esegue e il valore e\' ripulito', async (page) => {
    await pasteHTML(page, HOSTILE_HTML);
    check('incolla arrivato (ostile)', /testo/.test(await page.evaluate(() => window.__editorHTML())));
    const pwned = await page.evaluate(() => window.__pwned);
    const saved = await page.evaluate(() => window.__lastValue());
    const dom = await page.evaluate(() => window.__editorHTML());
    check('nessun codice eseguito (ostile)', pwned === 0, `__pwned=${pwned}`);
    check('valore salvato senza markup pericoloso', typeof saved !== 'string' || !DANGEROUS.test(saved), `saved=${saved}`);
    check('DOM editor senza markup pericoloso', !DANGEROUS.test(dom), `dom=${dom}`);
  }],

  ['sicurezza: data-pm-slice ostile (guardia generica) non esegue e non inietta', async (page) => {
    await pasteHTML(page, PM_SLICE_HTML);
    check('incolla arrivato (pm-slice)', />x</.test(await page.evaluate(() => window.__editorHTML())));
    const pwned = await page.evaluate(() => window.__pwned);
    const saved = await page.evaluate(() => window.__lastValue());
    const dom = await page.evaluate(() => window.__editorHTML());
    check('nessun codice eseguito (pm-slice)', pwned === 0, `__pwned=${pwned}`);
    check('valore salvato senza href javascript: ne on*', typeof saved !== 'string' || !DANGEROUS.test(saved), `saved=${saved}`);
    check('DOM editor senza href javascript: ne on*', !DANGEROUS.test(dom), `dom=${dom}`);
  }],

  /* -- B) comportamento -- */
  ['barra: stessi pulsanti, stesso ordine, stesse etichette e title', async (page) => {
    const btns = await page.$$eval('.htmlarea-toolbar button', (els) =>
      els.map((b) => ({ label: b.textContent, title: b.getAttribute('title') })));
    const expected = [
      ['B', 'Grassetto'], ['I', 'Corsivo'], ['U', 'Sottolineato'], ['S', 'Barrato'],
      ['H1', 'Titolo 1'], ['H2', 'Titolo 2'], ['¶', 'Paragrafo'],
      ['• List', 'Elenco puntato'], ['1. List', 'Elenco numerato'], ['❝', 'Citazione'],
      ['⯇', 'Allinea a sinistra'], ['≡', 'Centra'], ['⯈', 'Allinea a destra'],
      ['A', 'Colore testo'], ['🖍', 'Colore sfondo'],
      ['🔗', 'Inserisci/modifica link'], ['⏎', 'Linea orizzontale'], ['⨯', 'Rimuovi formattazione'],
    ];
    const got = btns.map((b) => [b.label, b.title]);
    check('barra identica (pulsanti/ordine/etichette/title)',
      JSON.stringify(got) === JSON.stringify(expected), `got=${JSON.stringify(got)}`);
  }],

  ['grassetto: scrivere e attivare B produce <strong>', async (page) => {
    await page.click('.htmlarea .ProseMirror');
    await page.keyboard.type('ciao');
    // La selezione deve essere quella di ProseMirror (un Range DOM a mano non si
    // propaga allo stato): seleziono tutto dalla tastiera, come farebbe l'utente.
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(50);
    await page.click('.htmlarea-toolbar button[title="Grassetto"]');
    await page.waitForTimeout(80);
    const saved = await page.evaluate(() => window.__lastValue());
    check('grassetto -> <strong> o <b>', typeof saved === 'string' && /<(strong|b)>/.test(saved), `saved=${saved}`);
  }],

  ['elenco puntato: il pulsante produce <ul><li>', async (page) => {
    await page.click('.htmlarea .ProseMirror');
    await page.keyboard.type('voce');
    await page.click('.htmlarea-toolbar button[title="Elenco puntato"]');
    await page.waitForTimeout(80);
    const saved = await page.evaluate(() => window.__lastValue());
    check('elenco puntato -> <ul><li>', typeof saved === 'string' && /<ul>\s*<li>/.test(saved), `saved=${saved}`);
  }],

  ['elenco numerato: il pulsante produce <ol><li>', async (page) => {
    await page.click('.htmlarea .ProseMirror');
    await page.keyboard.type('voce');
    await page.click('.htmlarea-toolbar button[title="Elenco numerato"]');
    await page.waitForTimeout(80);
    const saved = await page.evaluate(() => window.__lastValue());
    check('elenco numerato -> <ol><li>', typeof saved === 'string' && /<ol>\s*<li>/.test(saved), `saved=${saved}`);
  }],

  ['legacy CKEditor: color/background/text-align fanno il giro', async (page) => {
    await page.evaluate((h) => window.__setIncoming(h), LEGACY_HTML);
    await page.waitForTimeout(120);
    // forza una serializzazione: scrivo e ripristino per far partire onUpdate
    const dom = await page.evaluate(() => window.__editorHTML());
    check('colore testo conservato', /color:\s*(#ff0000|rgb\(255,\s*0,\s*0\))/i.test(dom), `dom=${dom}`);
    check('colore sfondo conservato', /background-color:\s*(#ffff00|rgb\(255,\s*255,\s*0\))/i.test(dom), `dom=${dom}`);
    check('allineamento centrato conservato', /text-align:\s*center/i.test(dom), `dom=${dom}`);
    check('grassetto conservato', /<strong>|font-weight/i.test(dom), `dom=${dom}`);
  }],

  ['documento vuoto -> valore \'\' (non <p></p>)', async (page) => {
    await page.click('.htmlarea .ProseMirror');
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(80);
    const saved = await page.evaluate(() => window.__lastValue());
    check('vuoto salva stringa vuota', saved === '', `saved=${JSON.stringify(saved)}`);
  }],

  ['incolla da Word: niente o:p / MsoNormal / commenti condizionali nel salvato', async (page) => {
    await pasteHTML(page, WORD_HTML);
    const saved = await page.evaluate(() => window.__lastValue());
    const dom = await page.evaluate(() => window.__editorHTML());
    check('testo di Word presente', /Word/.test(dom), `dom=${dom}`);
    check('niente markup estraneo di Word nel salvato',
      typeof saved === 'string' && !/o:p|MsoNormal|mso-|<!--/i.test(saved), `saved=${saved}`);
  }],

  ['incolla da pagina web: heading/link/testo ragionevoli e senza markup estraneo', async (page) => {
    await pasteHTML(page, WEB_HTML);
    const saved = await page.evaluate(() => window.__lastValue());
    check('contenuto incollato presente', typeof saved === 'string' && /Titolo/.test(saved) && /collegamento/.test(saved), `saved=${saved}`);
    check('link buono conservato (https)', /href="https:\/\/esempio\.it"/.test(saved), `saved=${saved}`);
    check('niente on*/script nel salvato', typeof saved === 'string' && !DANGEROUS.test(saved), `saved=${saved}`);
  }],
];

/* ---- avvio del dev server Vite (se non --no-server) --------------------- */
function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error(`porta ${port} non risponde`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function main() {
  if (LIST_ONLY) { TESTS.forEach(([n]) => console.log(n)); return; }

  let viteProc = null;
  if (!NO_SERVER) {
    const bin = REPO + 'node_modules/.bin/vite';
    viteProc = spawn(bin, ['--config', VITE_CONFIG, '--port', PORT, '--strictPort'],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    viteProc.stdout.on('data', () => {});
    viteProc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    await waitPort(Number(PORT), 30000);
  }

  // Il playwright di ~/.npm/_npx si aspetta una revisione di Chromium diversa da
  // quella presente in ~/.cache/ms-playwright: si punta al binario presente.
  const CHROME_BIN = process.env.CHROME_BIN
    || '/home/luca/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
  const browser = await chromium.launch({
    headless: !HEADED,
    executablePath: CHROME_BIN,
  });
  const ctx = await browser.newContext();
  try {
    for (const [name, fn] of TESTS) {
      if (ONLY && !name.includes(ONLY)) continue;
      const page = await freshPage(ctx);
      try { await fn(page); }
      catch (e) { check(name + ' (eccezione)', false, String(e)); }
      await page.close();
    }
  } finally {
    await browser.close();
    if (viteProc) viteProc.kill('SIGTERM');
  }

  console.log('\n=== Esiti HtmlAreaControl ===');
  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`);
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} verifiche passate; ${failures} fallite.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
