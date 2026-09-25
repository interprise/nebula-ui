/**
 * SXADV-5989 — cambio di sessione applicativa: i valori scritti e non salvati
 * devono restare a video.
 *
 * Il difetto (collaudo, Elena): nella sessione S1 "Regole Sequenze" > Nuovo,
 * si compilano campi di testo e caselle senza salvare; clic sulla scheda S2
 * (un'altra funzione); ritorno su S1 -> i campi sono vuoti. Nel legacy nessun
 * tipo di campo perde il valore. La correzione e' trasversale: OGNI campo
 * modificabile deve tornare col valore che aveva.
 *
 * Chi prova non e' chi implementa: questo file esprime il comportamento
 * PROMESSO. Rende il VERO client (Shell -> ViewRenderer -> controlli) dal dev
 * server Vite, contro un server simulato con page.route: nessun DB, nessun
 * Tomcat (anche immagini e plugin sono intercettati, niente arriva a :9080).
 * Il JSONMenu dichiara due sessioni (S1, S2): la Shell le ricostruisce e rende
 * S1; S2 si rende quando ci si entra.
 *
 * Campi di S1, nessuno con `reload` (e' il caso del difetto: un campo con
 * reload fa il giro dal server e il suo control.value e' gia' quello nuovo):
 *   testo, casella, data, importo, combo locale, combo remoto (lookup), area
 *   di testo, multiselect a codici, e un campo di testo NON toccato (di
 *   controllo).
 *
 * Casi:
 *   1. si compila tutto, si va su S2, si torna su S1: ogni campo mostra il
 *      valore scritto (il combo remoto la DIDASCALIA scelta), e il ritorno non
 *      chiede niente al server;
 *   2. stessa andata e ritorno, poi Salva: al server arrivano i valori scritti
 *      (guardia: formValues non si e' mai perso, ed e' bene che resti cosi').
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv5989-session-switch.e2e.mjs [--headed] [--only <sottostringa>]
 *   BASE=http://localhost:5179/entrasp/app/  (default)
 *   PLAYWRIGHT_DIR=<node_modules con playwright>  (default: la cache di npx)
 * Il dev server: npx vite --config vite.config.poll.mts --port 5179 --strictPort
 * Esce con 1 se almeno una verifica fallisce.
 */
import { createRequire } from 'node:module';

const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:5179/entrasp/app/';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const HEADED = argv.includes('--headed');

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

async function attendi(cond, ms = 5000, passo = 50) {
  const fine = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fine) return false;
    await new Promise((r) => setTimeout(r, passo));
  }
}

// ───────────────────────────────────────────────────────── le maschere finte
const w = (sid, n) => `${n}.${sid}-0`;

const TIPI = [
  { value: 'A', text: 'Annuale' },
  { value: 'M', text: 'Mensile' },
  { value: 'G', text: 'Giornaliera' },
];
const STATI = [
  { value: 'B', text: 'Bozza' },
  { value: 'C', text: 'Confermato' },
  { value: 'X', text: 'Annullato' },
];
const CLIENTI = [
  { value: 'C01', text: 'ROSSI MARIO' },
  { value: 'C02', text: 'BIANCHI LUCA' },
  { value: 'C03', text: 'VERDI ANNA' },
];

function riga(i, prompt, control) {
  return { id: `r${i}`, cells: [{ elementType: 0, prompt }, { elementType: 1, control }] };
}

/** S1: la maschera di "Regole Sequenze" > Nuovo (record nuovo, tutto vuoto). */
function uiS1() {
  const sid = 'S1';
  const base = (n, extra) => ({ name: w(sid, n), id: n, editable: true, value: null, ...extra });
  const rows = [
    riga(0, 'Descrizione:', base('descr', { type: 'text', size: 30 })),
    riga(1, 'Attiva:', base('attiva', { type: 'boolean', value: false })),
    riga(2, 'Data inizio:', base('dataIni', { type: 'date', format: 'dd/MM/yyyy', size: 10 })),
    riga(3, 'Importo:', base('importo', { type: 'money', format: '#,##0.00', decimals: 2, currencySymbol: '€', size: 12 })),
    riga(4, 'Periodicita:', base('periodo', { type: 'combo', options: TIPI, size: 20 })),
    riga(5, 'Cliente:', base('cliente', { type: 'combo', remote: true, controlName: 'cliente', navpath: `${sid}-0`, size: 30 })),
    riga(6, 'Note:', base('note', { type: 'textarea', rows: 3 })),
    riga(7, 'Stati:', base('stati', { type: 'multiselect', options: STATI, value: '' })),
    riga(8, 'Non toccato:', base('fermo', { type: 'text', size: 20, value: 'dal server' })),
  ];
  return { pageType: 2, viewName: 'regoleSequenzeDetail', title: 'Regole Sequenze', path: `${sid}-0`, breadcrumbs: 'Regole Sequenze', rows };
}

/** S2: un'altra funzione qualsiasi. */
function uiS2() {
  const sid = 'S2';
  return {
    pageType: 2, viewName: 'fattureDetail', title: 'Fatture', path: `${sid}-0`, breadcrumbs: 'Fatture',
    rows: [riga(0, 'Numero:', { type: 'text', name: w(sid, 'numero'), id: 'numeroS2', editable: true, value: '42' })],
  };
}

const TOOLBAR = [{ id: 'tb-salva', text: 'Salva', handler: 'Save', disabled: false }];
const jsonBody = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

function leggiParametri(req) {
  const raw = req.method() === 'POST' ? (req.postData() || '') : new URL(req.url()).search.slice(1);
  const out = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = out[k] === undefined ? v : [].concat(out[k], v);
  return out;
}

// ───────────────────────────────────────────────────────────── banco di prova
async function apriApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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
        panels: [{ id: 'S1', title: 'Regole Sequenze' }, { id: 'S2', title: 'Fatture' }],
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
    if (p.action === 'ListUIControlList') {
      const q = String(p.query || '').toUpperCase();
      const rows = CLIENTI.filter((c) => !q || c.text.includes(q) || c.value.includes(q));
      return route.fulfill(jsonBody({ rows, resultSize: rows.length }));
    }
    const ui = p.sid === 'S2' ? uiS2() : uiS1();
    return route.fulfill(jsonBody({ ui, toolbar: TOOLBAR, uiData: {} }));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const pronto = await attendi(async () => (await page.locator('#descr').count()) > 0, 30000);
  if (!pronto) {
    const testo = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    await ctx.close();
    throw new Error(`S1 non si e' resa (manca #descr): richieste ${chiamate.length}, errori ${JSON.stringify(errori).slice(0, 200)}, pagina "${testo}"`);
  }
  // Il fuoco iniziale sul primo campo arriva in differita (SXADV-5803).
  await page.waitForTimeout(600);
  return { page, ctx, errori, chiamate };
}

const scheda = (page, testo) => page.locator('.session-tabs .ant-tabs-tab').filter({ hasText: testo });

/** Il Select antd che contiene l'input #id. */
const selectDi = (page, id) => page.locator('.ant-select').filter({ has: page.locator(`#${id}`) });

/** Didascalia mostrata come valore scelto di un Select (vuota se nessuno). */
async function didascalia(page, id) {
  return selectDi(page, id).evaluate((el) => {
    const c = el.querySelector('.ant-select-content-has-value, .ant-select-selection-item');
    if (!c) return '';
    return (c.getAttribute('title') || c.textContent || '').trim();
  });
}

async function leggiS1(page) {
  return {
    descr: await page.locator('#descr').inputValue(),
    attiva: await page.locator('#attiva').isChecked(),
    dataIni: await page.locator('#dataIni').inputValue(),
    importo: await page.locator('#importo').inputValue(),
    periodo: await didascalia(page, 'periodo'),
    cliente: await didascalia(page, 'cliente'),
    note: await page.locator('#note').inputValue(),
    stati: await page.locator('.multiselect-container .multiselect-chip').allInnerTexts().then((a) => a.map((x) => x.trim())),
    fermo: await page.locator('#fermo').inputValue(),
  };
}

const ATTESO = {
  descr: 'Sequenza fatture 2026',
  attiva: true,
  dataIni: '31/12/2026',
  importo: '1234,50',
  periodo: 'Mensile',
  cliente: 'BIANCHI LUCA',
  note: 'riga uno\nriga due',
  stati: ['Bozza', 'Annullato'],
  fermo: 'dal server',
};

async function compilaS1(page) {
  await page.locator('#descr').click();
  await page.keyboard.type(ATTESO.descr, { delay: 10 });

  await page.locator('#attiva').click();

  await page.locator('#dataIni').click();
  await page.keyboard.type('31122026', { delay: 20 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);

  await page.locator('#importo').click();
  await page.keyboard.type('1234,5', { delay: 20 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);

  // Combo locale: si digita, si sceglie la voce.
  await page.locator('#periodo').click();
  await page.keyboard.type('Mens', { delay: 30 });
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Mensile' }).first().click();
  await page.waitForTimeout(200);

  // Combo remoto: si digita, il server propone, si sceglie.
  await page.locator('#cliente').click();
  await page.keyboard.type('BIA', { delay: 30 });
  const voce = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'BIANCHI LUCA' }).first();
  await voce.waitFor({ timeout: 5000 });
  await voce.click();
  await page.waitForTimeout(200);

  await page.locator('#note').click();
  await page.keyboard.type('riga uno', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('riga due', { delay: 10 });

  // Multiselect: pannello, due voci, Conferma.
  await page.locator('.multiselect-container .multiselect-chips').click();
  await page.locator('.ant-drawer .multiselect-option').first().waitFor({ timeout: 5000 });
  await page.locator('.ant-drawer .multiselect-option').filter({ hasText: 'Bozza' }).first().click();
  await page.locator('.ant-drawer .multiselect-option').filter({ hasText: 'Annullato' }).first().click();
  await page.locator('.ant-drawer button').filter({ hasText: /^Conferma/ }).click();
  await page.waitForTimeout(500);

  // Fuori da tutto, cosi' nessun campo resta a meta' modifica.
  await page.locator('#fermo').click();
  await page.waitForTimeout(300);
}

async function andataERitorno(t) {
  const { page } = t;
  await scheda(page, 'Fatture').click();
  const s2 = await attendi(async () => (await page.locator('#numeroS2').count()) > 0, 10000);
  check('la scheda S2 si e\' resa', s2);
  check('su S2 la maschera di S1 non c\'e\' piu\' (e\' davvero smontata)', (await page.locator('#descr').count()) === 0);
  await page.waitForTimeout(400);
  const primaDelRitorno = t.chiamate.length;
  await scheda(page, 'Regole Sequenze').click();
  const s1 = await attendi(async () => (await page.locator('#descr').count()) > 0, 10000);
  check('di nuovo su S1', s1);
  await page.waitForTimeout(600);
  return t.chiamate.slice(primaDelRitorno);
}

function confronta(letti, prefisso) {
  for (const k of Object.keys(ATTESO)) eq(`${prefisso}${k}`, letti[k], ATTESO[k]);
}

// ─────────────────────────────────────────────────────────────────── le prove
const PROVE = [];
const prova = (nome, fn) => PROVE.push([nome, fn]);

prova('1 S1 compilata -> S2 -> S1: ogni campo mostra il valore scritto', async (b) => {
  const t = await apriApp(b);
  await compilaS1(t.page);
  const prima = await leggiS1(t.page);
  info(`prima del cambio scheda: ${JSON.stringify(prima)}`);
  // Se questo non torna, e' la prova (o l'ambiente) a non saper compilare,
  // non il difetto: i confronti dopo il ritorno non significherebbero niente.
  confronta(prima, 'compilato (premessa): ');
  const alRitorno = await andataERitorno(t);
  const dopo = await leggiS1(t.page);
  info(`dopo il ritorno su S1: ${JSON.stringify(dopo)}`);
  confronta(dopo, 'dopo il ritorno su S1: ');
  eq('il ritorno su S1 non chiede niente al server', alRitorno.map((c) => c.action), []);
  eq('nessun errore JavaScript', t.errori, []);
  await t.ctx.close();
});

prova('2 S1 compilata -> S2 -> S1 -> Salva: al server i valori scritti', async (b) => {
  const t = await apriApp(b);
  await compilaS1(t.page);
  await andataERitorno(t);
  const n = t.chiamate.length;
  await t.page.locator('button').filter({ hasText: 'Salva' }).first().click();
  await attendi(() => t.chiamate.slice(n).some((c) => c.action === 'Save'), 5000);
  const save = t.chiamate.slice(n).find((c) => c.action === 'Save');
  check('Salva e\' partito', !!save);
  if (save) {
    const v = (k) => save[w('S1', k)];
    eq('descr spedita', v('descr'), ATTESO.descr);
    eq('attiva spedita', v('attiva'), 'true');
    eq('dataIni spedita', v('dataIni'), ATTESO.dataIni);
    // toLocaleString('it-IT') di Chromium non raggruppa le migliaia sotto
    // 10.000: vanno bene entrambe le forme, il server le legge uguali.
    check('importo spedito', ['1234,50', '1.234,50'].includes(v('importo')), `ottenuto ${JSON.stringify(v('importo'))}`);
    eq('periodo spedito (codice)', v('periodo'), 'M');
    eq('cliente spedito (codice)', v('cliente'), 'C02');
    eq('note spedite', v('note'), ATTESO.note);
    eq('stati spediti', v('stati'), 'B,X');
  }
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
