/**
 * SXADV-6008 — cambio di sessione applicativa: le barre di scorrimento devono
 * restare dove erano.
 *
 * Il difetto (collaudo): due sessioni aperte (schede S1, S2 della Shell). In
 * S1 la lista Fatture, AG Grid con molte righe e molte colonne; si porta la
 * barra verticale in fondo e quella orizzontale tutta a destra; si passa a S2
 * e si torna su S1: le barre sono tornate in alto a sinistra. Nel legacy
 * restano dove erano. La correzione e' trasversale: OGNI area scorrevole della
 * scheda (lista a pagina intera, griglia incorporata, l'area .tab-content del
 * dettaglio) deve ritrovare la posizione, senza chiedere niente al server.
 *
 * Chi prova non e' chi implementa: questo file esprime il comportamento
 * PROMESSO. Rende il VERO client (Shell -> ViewRenderer -> ListRenderer/AG
 * Grid) dal dev server Vite, contro un server simulato con page.route: nessun
 * DB, nessun Tomcat (anche immagini e plugin sono intercettati, niente arriva
 * a :9080). Il JSONMenu dichiara due sessioni (S1, S2): la Shell le ricostruisce
 * e rende S1; S2 si rende quando ci si entra.
 *
 * Le liste: 60 righe x 25 colonne larghe, tutte nella pagina (recordCount <=
 * pageSize), cosi' la griglia scorre in entrambe le direzioni. Le posizioni si
 * leggono da .ag-body-viewport (verticale), .ag-body-horizontal-scroll-viewport
 * (la barra orizzontale) e .ag-center-cols-viewport (il contenuto che si vede,
 * che AG Grid tiene allineato alla barra).
 *
 * Casi:
 *   1. S1 in fondo e tutta a destra -> S2 -> S1, ~2 s: ancora a fine corsa in
 *      entrambe le direzioni (fine corsa dell'escursione di adesso, entro 1px),
 *      l'ultima riga e' disegnata, e il ritorno non chiede niente al server;
 *   2. S1 a meta' (non agli estremi) -> S2 -> S1: le stesse posizioni (entro
 *      qualche px);
 *   3. dopo il ritorno, entro la finestra di ripristino (~1,5 s), l'utente
 *      scorre con la rotella: il ripristino non glielo annulla;
 *   4. andata e ritorno passando dalla Home;
 *   5. S2 e' un'altra lista: al primo ingresso parte da 0,0 (S1 non la
 *      contamina); scorsa a sua volta, S1 e S2 ritrovano ognuna la propria;
 *   6. S1 e' un dettaglio piu' alto dello schermo (scorre l'area della scheda):
 *      a meta' -> S2 -> S1, stessa posizione;
 *   7. S1 con una riga ricordata (cliccata in cima alla lista), poi scorsa in
 *      fondo: al ritorno resta in fondo, la lista non torna sulla riga
 *      ricordata durante il ripristino.
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv6008-session-scroll.e2e.mjs [--headed] [--only <sottostringa>] [--shots <dir>]
 *   BASE=http://localhost:5179/entrasp/app/  (default)
 *   PLAYWRIGHT_DIR=<node_modules con playwright>  (default: la cache di npx)
 * Il dev server: npx vite --config vite.config.poll.mts --port 5179 --strictPort
 * Esce con 1 se almeno una verifica fallisce.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';

// Playwright: PLAYWRIGHT_DIR, poi la cache di npx dei 5989, poi la prima cache
// npx che lo contiene (l'hash della cartella cambia da una macchina all'altra).
function cercaPlaywright() {
  const cand = [];
  if (process.env.PLAYWRIGHT_DIR) cand.push(process.env.PLAYWRIGHT_DIR);
  cand.push('/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules');
  const npx = `${process.env.HOME || '/home/luca'}/.npm/_npx`;
  if (existsSync(npx)) for (const d of readdirSync(npx)) cand.push(`${npx}/${d}/node_modules`);
  for (const c of cand) if (existsSync(`${c}/playwright/package.json`)) return c;
  throw new Error(`playwright non trovato (provati: ${cand.join(', ')}); impostare PLAYWRIGHT_DIR`);
}
const require = createRequire(cercaPlaywright().replace(/\/?$/, '/'));
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:5179/entrasp/app/';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const HEADED = argv.includes('--headed');
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ─────────────────────────────────────────────────────────────────── esiti
const FAILED = [];
let nPass = 0;
let current = '';
function check(what, ok, why = '') {
  if (ok) { nPass += 1; console.log(`  PASS ${what}`); } else {
    FAILED.push(`${current} · ${what}${why ? ' — ' + why : ''}`);
    console.log(`  FAIL ${what}${why ? ': ' + why : ''}`);
  }
  return ok;
}
const info = (t) => console.log(`  ..   ${t}`);
const eq = (what, got, want) =>
  check(what, JSON.stringify(got) === JSON.stringify(want),
    `atteso ${JSON.stringify(want)}, ottenuto ${JSON.stringify(got)}`);
/** Uguale entro `tol` px. */
const vicino = (what, got, want, tol = 3) =>
  check(what, typeof got === 'number' && Math.abs(got - want) <= tol, `atteso ${want} (±${tol}), ottenuto ${got}`);

async function attendi(cond, ms = 5000, passo = 50) {
  const fine = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fine) return false;
    await new Promise((r) => setTimeout(r, passo));
  }
}
async function foto(page, nome) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${current.split(' ')[0]}-${nome}.png` });
}

// ───────────────────────────────────────────────────────── le maschere finte
const N_RIGHE = 60;
const N_COLONNE = 25;

function riga(i, prompt, control) {
  return { id: `r${i}`, cells: [{ elementType: 0, prompt }, { elementType: 1, control }] };
}

/** Una lista a pagina intera: N_RIGHE x N_COLONNE, testi lunghi. */
function uiLista(sid, viewName, titolo) {
  const path = `${sid}-0`;
  const headers = [];
  for (let c = 0; c < N_COLONNE; c++) headers.push({ text: `${titolo} colonna ${c + 1} intestazione larga`, name: `c${c}` });
  const rows = [];
  for (let i = 0; i < N_RIGHE; i++) {
    const cells = [];
    for (let c = 0; c < N_COLONNE; c++) {
      cells.push({
        elementType: 1,
        control: { name: `c${c}`, id: `c${c}`, value: `${titolo} R${i + 1} C${c + 1} testo piuttosto lungo` },
      });
    }
    rows.push({ id: `r${i}`, props: { path: `${path}.${i}` }, cells });
  }
  return {
    pageType: 1, viewName, viewType: 'list', title: titolo, path, breadcrumbs: titolo,
    header: { title: titolo, recordCount: N_RIGHE, pageSize: 100, position: 0, path },
    headers, rows,
  };
}

/** Un dettaglio semplice (una riga). */
function uiDettaglioCorto(sid, titolo) {
  return {
    pageType: 2, viewName: 'clientiDetail', title: titolo, path: `${sid}-0`, breadcrumbs: titolo,
    rows: [riga(0, 'Codice:', { type: 'text', name: `codice.${sid}-0`, id: `codice${sid}`, editable: true, value: 'C01' })],
  };
}

/** Un dettaglio molto piu' alto dello schermo: 120 righe di campi. */
function uiDettaglioAlto(sid, titolo) {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push(riga(i, `Campo ${i + 1}:`, { type: 'text', name: `f${i}.${sid}-0`, id: `f${i}`, editable: true, value: `valore ${i + 1}`, size: 20 }));
  }
  return { pageType: 2, viewName: 'regoleDetail', title: titolo, path: `${sid}-0`, breadcrumbs: titolo, rows };
}

const TOOLBAR = [{ id: 'tb-esci', text: 'Esci', handler: 'Exit', disabled: false }];
const jsonBody = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

function leggiParametri(req) {
  const raw = req.method() === 'POST' ? (req.postData() || '') : new URL(req.url()).search.slice(1);
  const out = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = out[k] === undefined ? v : [].concat(out[k], v);
  return out;
}

// ───────────────────────────────────────────────────────────── banco di prova
/**
 * @param s1 { titolo, ui: () => UITree }
 * @param s2 { titolo, ui: () => UITree }
 */
async function apriApp(browser, s1, s2) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  const chiamate = [];

  // Niente deve arrivare al Tomcat condiviso.
  await page.route(/\/entrasp\/(images|app-plugins)\//, (route) => route.fulfill({ status: 404, body: '' }));

  await page.route('**/entrasp/controller2**', async (route) => {
    const p = leggiParametri(route.request());
    if (p.action === 'GetConfig') return route.fulfill(jsonBody({ loggedIn: true }));
    if (p.action === 'JSONMenu') {
      return route.fulfill(jsonBody({
        loginfo: { login: '44AMM', profile: 'Amministratore', customerKey: '02409720', changePassword: false, copyright: 'Sixtema Spa' },
        children: [{ id: 'menu.x', text: 'Prove', children: [] }],
        panels: [{ id: 'S1', title: s1.titolo }, { id: 'S2', title: s2.titolo }],
        sessionLimit: 0,
      }));
    }
    return route.fulfill(jsonBody({}));
  });

  await page.route('**/entrasp/controller**', async (route) => {
    const req = route.request();
    if (/controller2/.test(req.url())) return route.fallback();
    const p = leggiParametri(req);
    chiamate.push(p);
    const ui = p.sid === 'S2' ? s2.ui() : s1.ui();
    return route.fulfill(jsonBody({ ui, toolbar: TOOLBAR, uiData: {} }));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const pronto = await attendi(async () => (await page.locator('.tab-content').count()) > 0
    && (await scheda(page, s1.titolo).count()) > 0, 30000);
  if (!pronto) {
    const testo = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    await ctx.close();
    throw new Error(`la Shell non si e' resa: richieste ${chiamate.length}, errori ${JSON.stringify(errori).slice(0, 200)}, pagina "${testo}"`);
  }
  // Dopo un F5 si entra sulla prima sessione ricostruita; se si e' sulla
  // Home, si entra in S1.
  await vaiA(page, s1.titolo);
  return { page, ctx, errori, chiamate };
}

const scheda = (page, testo) => page.locator('.session-tabs .ant-tabs-tab').filter({ hasText: testo });
const vaiA = (page, testo) => scheda(page, testo).first().click();

/** Aspetta una lista disegnata con escursione in entrambe le direzioni. */
async function attendiLista(page, ms = 15000) {
  return attendi(async () => page.evaluate(() => {
    const tc = document.querySelector('.tab-content');
    const v = tc?.querySelector('.ag-body-viewport');
    const h = tc?.querySelector('.ag-body-horizontal-scroll-viewport');
    return !!v && !!h && tc.querySelectorAll('.ag-row').length > 5
      && v.scrollHeight > v.clientHeight + 200 && h.scrollWidth > h.clientWidth + 200;
  }), ms);
}

/** Posizioni della griglia della scheda in primo piano. */
async function griglia(page) {
  return page.evaluate(() => {
    const tc = document.querySelector('.tab-content');
    const v = tc?.querySelector('.ag-body-viewport');
    const h = tc?.querySelector('.ag-body-horizontal-scroll-viewport');
    const c = tc?.querySelector('.ag-center-cols-viewport');
    const hd = tc?.querySelector('.ag-header-viewport');
    if (!v || !h) return null;
    const indici = Array.from(tc.querySelectorAll('.ag-center-cols-container .ag-row[row-index]'))
      .map((r) => Number(r.getAttribute('row-index')));
    return {
      top: v.scrollTop, maxTop: v.scrollHeight - v.clientHeight,
      left: h.scrollLeft, maxLeft: h.scrollWidth - h.clientWidth,
      contenutoLeft: c ? c.scrollLeft : null,
      intestazioniLeft: hd ? hd.scrollLeft : null,
      ultimaRiga: indici.length ? Math.max(...indici) : -1,
      primaRiga: indici.length ? Math.min(...indici) : -1,
    };
  });
}

/** Scorre la griglia come la rotella: in verticale .ag-body-viewport, in
 *  orizzontale il contenuto (.ag-center-cols-viewport), che AG Grid allinea
 *  poi a barra e intestazioni. (Scrivere scrollLeft sulla sola barra,
 *  .ag-body-horizontal-scroll-viewport, NON muove il contenuto: la barra si
 *  sposta e le colonne restano li'.) */
async function scorriGriglia(page, { top, left }) {
  await page.evaluate(({ top, left }) => {
    const tc = document.querySelector('.tab-content');
    const v = tc.querySelector('.ag-body-viewport');
    const c = tc.querySelector('.ag-center-cols-viewport');
    const fino = (x, max) => (x === 'fine' ? max : x);
    if (top !== undefined) v.scrollTop = fino(top, v.scrollHeight - v.clientHeight);
    if (left !== undefined) c.scrollLeft = fino(left, c.scrollWidth - c.clientWidth);
  }, { top, left });
  // AG Grid disegna le righe nuove e allinea il contenuto alla barra.
  await page.waitForTimeout(500);
}

/** Su S2 e ritorno; restituisce le richieste partite AL RITORNO. */
async function andataERitorno(t, s1, s2, { attesa = 2000, pronto } = {}) {
  const { page } = t;
  await vaiA(page, s2.titolo);
  const ok2 = await attendi(async () => (await page.locator('.session-tabs .ant-tabs-tab-active').filter({ hasText: s2.titolo }).count()) > 0, 10000);
  check(`la scheda ${s2.titolo} e' in primo piano`, ok2);
  if (pronto) await pronto();
  await page.waitForTimeout(500);
  const primaDelRitorno = t.chiamate.length;
  await vaiA(page, s1.titolo);
  await attendi(async () => (await page.locator('.session-tabs .ant-tabs-tab-active').filter({ hasText: s1.titolo }).count()) > 0, 10000);
  await page.waitForTimeout(attesa);
  return t.chiamate.slice(primaDelRitorno);
}

// ─────────────────────────────────────────────────────────────────── le prove
const PROVE = [];
const prova = (nome, fn) => PROVE.push([nome, fn]);

const FATTURE = { titolo: 'Fatture', ui: () => uiLista('S1', 'fattureList', 'Fatture') };
const CLIENTE = { titolo: 'Cliente', ui: () => uiDettaglioCorto('S2', 'Cliente') };
const ARTICOLI = { titolo: 'Articoli', ui: () => uiLista('S2', 'articoliList', 'Articoli') };
const REGOLE = { titolo: 'Regole', ui: () => uiDettaglioAlto('S1', 'Regole') };

/** Premessa comune: la lista di S1 c'e' e scorre. Se manca, e' il banco. */
async function premessaLista(t, nome = 'S1') {
  const ok = await attendiLista(t.page);
  const g = await griglia(t.page);
  info(`${nome} disegnata: ${JSON.stringify(g)}`);
  check(`premessa: la lista di ${nome} e' disegnata e scorre in entrambe le direzioni`, ok);
  return ok;
}

prova('1 S1 in fondo e tutta a destra -> S2 -> S1: ancora a fine corsa, nessuna richiesta', async (b) => {
  const t = await apriApp(b, FATTURE, CLIENTE);
  if (!(await premessaLista(t))) { await foto(t.page, 'premessa'); await t.ctx.close(); return; }
  await scorriGriglia(t.page, { top: 'fine', left: 'fine' });
  const prima = await griglia(t.page);
  info(`prima del cambio scheda: ${JSON.stringify(prima)}`);
  // Se lo scorrimento non e' andato, la prova non significa niente.
  check('premessa: in fondo prima di uscire', prima.top >= prima.maxTop - 1 && prima.maxTop > 200, JSON.stringify(prima));
  check('premessa: tutta a destra prima di uscire', prima.left >= prima.maxLeft - 1 && prima.maxLeft > 200, JSON.stringify(prima));
  check('premessa: l\'ultima riga e\' disegnata prima di uscire', prima.ultimaRiga === N_RIGHE - 1, `ultima ${prima.ultimaRiga}`);
  check('premessa: barra, contenuto e intestazioni allineati prima di uscire',
    Math.abs(prima.contenutoLeft - prima.left) <= 1 && Math.abs(prima.intestazioniLeft - prima.left) <= 1, JSON.stringify(prima));
  await foto(t.page, 'prima');
  const alRitorno = await andataERitorno(t, FATTURE, CLIENTE, {
    pronto: async () => {
      const s2 = await attendi(async () => (await t.page.locator('#codiceS2').count()) > 0, 10000);
      check('su S2 si vede il dettaglio di S2', s2);
      check('su S2 la lista di S1 non c\'e\' piu\' (e\' davvero smontata)', (await t.page.locator('.tab-content .ag-body-viewport').count()) === 0);
      await foto(t.page, 's2');
    },
  });
  await attendiLista(t.page, 5000);
  const dopo = await griglia(t.page);
  info(`dopo il ritorno su S1: ${JSON.stringify(dopo)}`);
  await foto(t.page, 'dopo');
  check('dopo il ritorno: barra verticale in fondo', dopo && dopo.top >= dopo.maxTop - 1, JSON.stringify(dopo));
  check('dopo il ritorno: barra orizzontale tutta a destra', dopo && dopo.left >= dopo.maxLeft - 1, JSON.stringify(dopo));
  check('dopo il ritorno: il contenuto (le colonne) e\' tutto a destra come la barra', dopo && dopo.contenutoLeft !== null && Math.abs(dopo.contenutoLeft - dopo.left) <= 3 && dopo.contenutoLeft > 200, JSON.stringify(dopo));
  check('dopo il ritorno: le intestazioni seguono il contenuto', dopo && dopo.intestazioniLeft !== null && Math.abs(dopo.intestazioniLeft - dopo.contenutoLeft) <= 3, JSON.stringify(dopo));
  check('dopo il ritorno: l\'ultima riga e\' disegnata', dopo && dopo.ultimaRiga === N_RIGHE - 1, `ultima ${dopo?.ultimaRiga}`);
  eq('il ritorno su S1 non chiede niente al server', alRitorno.map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('2 S1 a meta\' -> S2 -> S1: stessa posizione', async (b) => {
  const t = await apriApp(b, FATTURE, CLIENTE);
  if (!(await premessaLista(t))) { await t.ctx.close(); return; }
  const g0 = await griglia(t.page);
  const top = Math.round(g0.maxTop * 0.45);
  const left = Math.round(g0.maxLeft * 0.4);
  await scorriGriglia(t.page, { top, left });
  const prima = await griglia(t.page);
  info(`prima: ${JSON.stringify(prima)}`);
  vicino('premessa: verticale a meta\' prima di uscire', prima.top, top, 1);
  vicino('premessa: orizzontale a meta\' prima di uscire (barra)', prima.left, left, 1);
  vicino('premessa: orizzontale a meta\' prima di uscire (contenuto)', prima.contenutoLeft, left, 1);
  const alRitorno = await andataERitorno(t, FATTURE, CLIENTE);
  await attendiLista(t.page, 5000);
  const dopo = await griglia(t.page);
  info(`dopo: ${JSON.stringify(dopo)}`);
  await foto(t.page, 'dopo');
  vicino('dopo il ritorno: verticale come prima', dopo?.top, prima.top);
  vicino('dopo il ritorno: orizzontale come prima', dopo?.left, prima.left);
  vicino('dopo il ritorno: il contenuto (le colonne) come prima', dopo?.contenutoLeft, prima.contenutoLeft);
  vicino('dopo il ritorno: le intestazioni come prima', dopo?.intestazioniLeft, prima.intestazioniLeft);
  check('dopo il ritorno: le righe disegnate sono quelle di prima', dopo && Math.abs(dopo.primaRiga - prima.primaRiga) <= 1,
    `prima ${prima.primaRiga}, dopo ${dopo?.primaRiga}`);
  eq('il ritorno su S1 non chiede niente al server', alRitorno.map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('3 rotella dell\'utente subito dopo il ritorno: il ripristino non la annulla', async (b) => {
  const t = await apriApp(b, FATTURE, CLIENTE);
  if (!(await premessaLista(t))) { await t.ctx.close(); return; }
  const g0 = await griglia(t.page);
  const top = Math.round(g0.maxTop * 0.3);
  await scorriGriglia(t.page, { top });
  const prima = await griglia(t.page);
  // Ritorno con attesa breve: si resta dentro la finestra di ripristino.
  await andataERitorno(t, FATTURE, CLIENTE, { attesa: 400 });
  const ripristinata = await griglia(t.page);
  info(`a 400 ms dal ritorno: ${JSON.stringify(ripristinata)}`);
  vicino('premessa: a 400 ms dal ritorno la posizione e\' gia\' quella di prima', ripristinata?.top, prima.top, 3);
  // La rotella, sopra la griglia.
  const box = await t.page.locator('.tab-content .ag-body-viewport').first().boundingBox();
  await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await t.page.mouse.wheel(0, 350);
  await t.page.waitForTimeout(300);
  const dopoRotella = await griglia(t.page);
  info(`subito dopo la rotella: ${JSON.stringify(dopoRotella)}`);
  check('premessa: la rotella ha spostato la griglia', dopoRotella && dopoRotella.top > (ripristinata?.top ?? 0) + 200,
    `da ${ripristinata?.top} a ${dopoRotella?.top}`);
  await t.page.waitForTimeout(2000);
  const fine = await griglia(t.page);
  info(`a finestra chiusa: ${JSON.stringify(fine)}`);
  vicino('lo scorrimento dell\'utente resta (non torna alla posizione fotografata)', fine?.top, dopoRotella?.top, 3);
  check('...e non e\' tornato a quella di prima', fine && fine.top > prima.top + 200, `prima ${prima.top}, ora ${fine?.top}`);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('4 S1 -> Home -> S1: stessa posizione', async (b) => {
  const t = await apriApp(b, FATTURE, CLIENTE);
  if (!(await premessaLista(t))) { await t.ctx.close(); return; }
  const g0 = await griglia(t.page);
  await scorriGriglia(t.page, { top: Math.round(g0.maxTop * 0.6), left: 'fine' });
  const prima = await griglia(t.page);
  info(`prima: ${JSON.stringify(prima)}`);
  await scheda(t.page, 'Home').first().click();
  const home = await attendi(async () => (await t.page.locator('.session-tabs .ant-tabs-tab-active').filter({ hasText: 'Home' }).count()) > 0, 10000);
  check('la Home e\' in primo piano', home);
  check('sulla Home la lista di S1 non c\'e\' piu\'', (await t.page.locator('.tab-content .ag-body-viewport').count()) === 0);
  await t.page.waitForTimeout(800);
  await foto(t.page, 'home');
  const n = t.chiamate.length;
  await vaiA(t.page, FATTURE.titolo);
  await t.page.waitForTimeout(2000);
  await attendiLista(t.page, 5000);
  const dopo = await griglia(t.page);
  info(`dopo: ${JSON.stringify(dopo)}`);
  vicino('dopo il ritorno dalla Home: verticale come prima', dopo?.top, prima.top);
  check('dopo il ritorno dalla Home: orizzontale tutta a destra (barra e contenuto)', dopo && dopo.left >= dopo.maxLeft - 1
    && Math.abs(dopo.contenutoLeft - dopo.left) <= 3, JSON.stringify(dopo));
  eq('il ritorno su S1 dalla Home non chiede niente al server', t.chiamate.slice(n).map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('5 S2 e\' un\'altra lista: parte da 0,0 e ognuna ritrova la propria', async (b) => {
  const t = await apriApp(b, FATTURE, ARTICOLI);
  if (!(await premessaLista(t))) { await t.ctx.close(); return; }
  const g0 = await griglia(t.page);
  await scorriGriglia(t.page, { top: Math.round(g0.maxTop * 0.7), left: Math.round(g0.maxLeft * 0.5) });
  const s1 = await griglia(t.page);
  info(`S1: ${JSON.stringify(s1)}`);
  // Primo ingresso in S2.
  await vaiA(t.page, ARTICOLI.titolo);
  const ok2 = await attendi(async () => (await t.page.locator('.tab-content .ag-row').filter({ hasText: 'Articoli R1 ' }).count()) > 0, 15000);
  check('premessa: la lista di S2 e\' disegnata', ok2);
  await attendiLista(t.page, 5000);
  await t.page.waitForTimeout(2000);
  const s2primo = await griglia(t.page);
  info(`S2 al primo ingresso: ${JSON.stringify(s2primo)}`);
  vicino('S2 al primo ingresso: verticale a 0', s2primo?.top, 0, 0);
  vicino('S2 al primo ingresso: orizzontale a 0', s2primo?.left, 0, 0);
  vicino('S2 al primo ingresso: contenuto a 0', s2primo?.contenutoLeft, 0, 0);
  // S2 scorsa a sua volta.
  await scorriGriglia(t.page, { top: Math.round(s2primo.maxTop * 0.25), left: Math.round(s2primo.maxLeft * 0.2) });
  const s2 = await griglia(t.page);
  info(`S2 scorsa: ${JSON.stringify(s2)}`);
  // Su S1.
  await vaiA(t.page, FATTURE.titolo);
  await t.page.waitForTimeout(2000);
  await attendiLista(t.page, 5000);
  const s1dopo = await griglia(t.page);
  info(`S1 al ritorno: ${JSON.stringify(s1dopo)}`);
  vicino('S1 al ritorno: verticale sua', s1dopo?.top, s1.top);
  vicino('S1 al ritorno: orizzontale sua', s1dopo?.left, s1.left);
  vicino('S1 al ritorno: contenuto suo', s1dopo?.contenutoLeft, s1.contenutoLeft);
  // Di nuovo su S2.
  const n = t.chiamate.length;
  await vaiA(t.page, ARTICOLI.titolo);
  await t.page.waitForTimeout(2000);
  await attendiLista(t.page, 5000);
  const s2dopo = await griglia(t.page);
  info(`S2 al ritorno: ${JSON.stringify(s2dopo)}`);
  vicino('S2 al ritorno: verticale sua (non quella di S1)', s2dopo?.top, s2.top);
  vicino('S2 al ritorno: orizzontale sua (non quella di S1)', s2dopo?.left, s2.left);
  vicino('S2 al ritorno: contenuto suo (non quello di S1)', s2dopo?.contenutoLeft, s2.contenutoLeft);
  eq('il ritorno su S2 non chiede niente al server', t.chiamate.slice(n).map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('6 S1 dettaglio piu\' alto dello schermo, a meta\' -> S2 -> S1: stessa posizione', async (b) => {
  const t = await apriApp(b, REGOLE, CLIENTE);
  const pronto = await attendi(async () => (await t.page.locator('#f119').count()) > 0, 15000);
  check('premessa: il dettaglio alto e\' disegnato', pronto);
  await t.page.waitForTimeout(800);
  // L'area che scorre: .tab-content se scorre lei, altrimenti la piu' alta
  // dentro di lei. Marcata per ritrovarla (e riconoscerla) dopo.
  const leggi = () => t.page.evaluate(() => {
    const tc = document.querySelector('.tab-content');
    const tutte = [tc, ...tc.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 100
      && getComputedStyle(e).overflowY !== 'hidden' && getComputedStyle(e).overflowY !== 'visible');
    tutte.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const e = tutte[0];
    if (!e) return null;
    return { cls: e === tc ? '.tab-content' : String(e.className), top: e.scrollTop, maxTop: e.scrollHeight - e.clientHeight };
  });
  const area = await leggi();
  info(`area scorrevole del dettaglio: ${JSON.stringify(area)}`);
  if (!check('premessa: il dettaglio scorre', !!area && area.maxTop > 400)) { await foto(t.page, 'premessa'); await t.ctx.close(); return; }
  const meta = Math.round(area.maxTop / 2);
  await t.page.evaluate(({ meta }) => {
    const tc = document.querySelector('.tab-content');
    const tutte = [tc, ...tc.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 100
      && getComputedStyle(e).overflowY !== 'hidden' && getComputedStyle(e).overflowY !== 'visible');
    tutte.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    tutte[0].scrollTop = meta;
    tutte[0].dispatchEvent(new Event('scroll'));
  }, { meta });
  await t.page.waitForTimeout(300);
  const prima = await leggi();
  info(`prima: ${JSON.stringify(prima)}`);
  vicino('premessa: a meta\' prima di uscire', prima?.top, meta, 1);
  await foto(t.page, 'prima');
  const alRitorno = await andataERitorno(t, REGOLE, CLIENTE);
  await attendi(async () => (await t.page.locator('#f119').count()) > 0, 5000);
  const dopo = await leggi();
  info(`dopo: ${JSON.stringify(dopo)}`);
  await foto(t.page, 'dopo');
  eq('dopo il ritorno: scorre la stessa area', dopo?.cls, prima?.cls);
  vicino('dopo il ritorno: a meta\' come prima', dopo?.top, prima?.top);
  eq('il ritorno su S1 non chiede niente al server', alRitorno.map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('7 riga ricordata in cima, lista in fondo -> S2 -> S1: resta in fondo', async (b) => {
  const t = await apriApp(b, FATTURE, CLIENTE);
  if (!(await premessaLista(t))) { await t.ctx.close(); return; }
  // Clic sulla terza riga: la lista la ricorda (rowSelectionMemory). Il
  // server simulato risponde con la lista stessa.
  const n0 = t.chiamate.length;
  await t.page.locator('.tab-content .ag-center-cols-container .ag-row[row-index="2"] .ag-cell').first().click();
  await t.page.waitForTimeout(1500);
  info(`richieste dal clic: ${JSON.stringify(t.chiamate.slice(n0).map((c) => c.action))}`);
  await attendiLista(t.page, 5000);
  await scorriGriglia(t.page, { top: 'fine' });
  const prima = await griglia(t.page);
  info(`prima: ${JSON.stringify(prima)}`);
  check('premessa: in fondo prima di uscire', prima && prima.top >= prima.maxTop - 1 && prima.maxTop > 200, JSON.stringify(prima));
  await andataERitorno(t, FATTURE, CLIENTE);
  await attendiLista(t.page, 5000);
  const dopo = await griglia(t.page);
  info(`dopo: ${JSON.stringify(dopo)}`);
  await foto(t.page, 'dopo');
  check('dopo il ritorno: ancora in fondo (non riallineata sulla riga ricordata)', dopo && dopo.top >= dopo.maxTop - 1, JSON.stringify(dopo));
  const evidenziata = await t.page.locator('.tab-content .ag-row[row-index="2"].record-group-selected, .tab-content .ag-row[row-index="2"].ag-row-selected').count();
  info(`riga ricordata evidenziata (nel DOM solo se disegnata): ${evidenziata}`);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

// ─────────────────────────────────────────────────────────────────── main
let browser;
try {
  browser = await chromium.launch({ headless: !HEADED });
  for (const [nome, fn] of PROVE) {
    if (ONLY && !nome.toLowerCase().includes(ONLY.toLowerCase())) continue;
    current = nome;
    console.log(`\n${nome}`);
    try {
      await fn(browser);
    } catch (e) {
      FAILED.push(`${nome} · eccezione: ${e.message}`);
      console.log(`  FAIL eccezione: ${e.message}`);
    }
  }
} finally {
  if (browser) await browser.close();
}

console.log(`\n${nPass} PASS, ${FAILED.length} FAIL`);
for (const f of FAILED) console.log('  - ' + f);
process.exit(FAILED.length ? 1 : 0);
