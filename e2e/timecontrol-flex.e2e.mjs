/**
 * Campi ORA (TimeControl): inserimento flessibile e svuotamento da tastiera.
 * Prova end-to-end indipendente.
 *
 * Chi prova non e' chi implementa: questo file esprime il comportamento
 * PROMESSO, non quello del codice. Il difetto:
 *   (1) '1030' + Tab lasciava il campo vuoto: mancava l'inserimento flessibile
 *       dei campi data (checkTime del legacy, JSLib.js);
 *   (2) Ctrl+A, Canc, Tab non svuotava: il valore tornava, si svuotava solo
 *       con la X di antd.
 * La correzione promessa: il TimeControl riceve lo stesso blur flessibile dei
 * campi data, e la X (allowClear) sparisce anche dai campi ora. Un'ora
 * svuotata da tastiera arriva al server come ''.
 *
 * Stesso impianto di e2e/sxadv5740-date.e2e.mjs: rende il VERO client (Shell ->
 * ViewRenderer -> TimeControl/TimestampControl) dal dev server Vite, contro un
 * server simulato con page.route: nessun DB, nessun Tomcat. Ogni campo ha un
 * campo di testo PRIMA (per entrarci col Tab) e uno DOPO (per vedere dove va
 * il Tab). Campi con `reload`: il valore si legge dal Post che parte subito;
 * senza: si preme "Salva" e si legge il parametro spedito. Il server fa l'eco
 * (applica i valori ricevuti e rimanda la maschera intera).
 *
 * Uso:
 *   node e2e/timecontrol-flex.e2e.mjs [--only <sottostringa>] [--headed] [--list]
 *   BASE=http://localhost:5175/entrasp/app/  (default)
 *
 * Il dev server: npx vite --config vite.config.poll.mts --port 5175 --strictPort
 * Esce con codice 1 se almeno un caso fallisce.
 */
import { createRequire } from 'node:module';

// playwright non e' fra le dipendenze del progetto: PLAYWRIGHT_DIR indica una
// cartella node_modules che lo contiene (npx playwright ne lascia una in ~/.npm/_npx).
const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:5175/entrasp/app/';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const HEADED = argv.includes('--headed');
const LIST_ONLY = argv.includes('--list');

// ─────────────────────────────────────────────────────────────────── esiti
const FAILED = [];
let nPass = 0;
let current = '';
function check(what, ok, why = '') {
  if (ok) {
    nPass += 1;
    console.log(`  PASS ${what}`);
  } else {
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

// ───────────────────────────────────────────────────────── la maschera finta
const SID = 'S1';
const VS = `${SID}-0`;
const wire = (n) => `${n}.${VS}`;

/** I campi della maschera, in ordine di tabulazione. */
const CAMPI = [
  // [nome, tipo, format Java, valore iniziale, reload]
  ['oraVuota', 'time', undefined, null, false],
  ['oraVuotaR', 'time', undefined, null, true],
  ['oraPiena', 'time', undefined, '09:00', false],
  ['oraPienaR', 'time', undefined, '09:00', true],
  ['tsVuoto', 'timestamp', 'dd/MM/yyyy HH:mm', null, false],
  ['tsVuotoR', 'timestamp', 'dd/MM/yyyy HH:mm', null, true],
  // Secondo giro (contratto rivisto): data e data/ora valorizzate.
  ['dataPiena', 'date', 'dd/MM/yyyy', '05/07/2026', false],
  ['tsPieno', 'timestamp', 'dd/MM/yyyy HH:mm', '05/07/2026 10:30', false],
  ['tsPienoR', 'timestamp', 'dd/MM/yyyy HH:mm', '05/07/2026 10:30', true],
];
const PRIMO = CAMPI[0][0];

const idOf = (n) => `id_${n}`;
const primaDi = (n) => `prima_${n}`;
const dopoDi = (n) => `dopo_${n}`;
const conReload = (n) => CAMPI.find((c) => c[0] === n)[4];

function testo(name, value) {
  return {
    type: 'text', name: wire(name), id: idOf(name), editable: true, size: 12,
    value: value ?? '',
  };
}

function riga(i, prompt, control) {
  return {
    id: `r${i}`,
    cells: [
      { elementType: 0, prompt },
      { elementType: 1, control },
    ],
  };
}

function detailUi(stato) {
  const rows = [];
  let i = 0;
  for (const [n, tipo, format, , reload] of CAMPI) {
    rows.push(riga(i++, `Prima di ${n}:`, testo(primaDi(n), stato[primaDi(n)])));
    const c = {
      type: tipo, name: wire(n), id: idOf(n), editable: true, size: 10,
      value: stato[n] ?? null,
    };
    if (format) c.format = format;
    if (reload) { c.reload = 'true'; c.command = 'Post'; c.navpath = VS; }
    rows.push(riga(i++, `${n}:`, c));
    rows.push(riga(i++, `Dopo ${n}:`, testo(dopoDi(n), stato[dopoDi(n)])));
  }
  return {
    pageType: 2,
    viewName: 'timeFlexDetail',
    title: 'Prova ore',
    path: VS,
    breadcrumbs: 'Prova ore',
    rows,
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
const APERTO = '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)';

async function apriApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));

  const stato = {};
  for (const [n, , , v] of CAMPI) stato[n] = v;
  /** Ogni richiesta a /entrasp/controller, con i parametri decodificati. */
  const chiamate = [];

  await page.route('**/entrasp/controller2**', async (route) => {
    const p = leggiParametri(route.request());
    if (p.action === 'GetConfig') return route.fulfill(jsonBody({ loggedIn: true }));
    if (p.action === 'JSONMenu') {
      return route.fulfill(jsonBody({
        loginfo: { login: '44AMM', profile: 'Amministratore', customerKey: '02409720', changePassword: false, copyright: 'Sixtema Spa' },
        children: [{ id: 'menu.x', text: 'Prove', children: [] }],
        panels: [{ id: SID, title: 'Prova ore' }],
        sessionLimit: 0,
      }));
    }
    return route.fulfill(jsonBody({}));
  });

  await page.route('**/entrasp/controller**', async (route) => {
    const req = route.request();
    if (/controller2/.test(req.url())) return route.fallback();
    const p = leggiParametri(req);
    chiamate.push({ t: Date.now(), ...p });
    // Eco: il "server" applica i valori dei campi che gli arrivano.
    for (const [n] of CAMPI) if (p[wire(n)] !== undefined) stato[n] = p[wire(n)] === '' ? null : p[wire(n)];
    return route.fulfill(jsonBody({ ui: detailUi(stato), toolbar: TOOLBAR, uiData: {} }));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const pronto = await attendi(async () => (await page.locator(`#${idOf(PRIMO)}`).count()) > 0, 30000);
  if (!pronto) {
    const testoPagina = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    await ctx.close();
    throw new Error(`la maschera finta non si e' resa (manca #${idOf(PRIMO)}): richieste al controller ${chiamate.length}, errori ${JSON.stringify(errori).slice(0, 200)}, pagina "${testoPagina}"`);
  }
  // La pagina nuova porta da se' il fuoco sul primo campo modificabile
  // (SXADV-5803), in differita: si aspetta che l'abbia fatto, altrimenti quel
  // fuoco arriva a meta' prova e ruba il Tab o il tasto della prova.
  await attendi(async () => (await page.evaluate(() => document.activeElement?.id || '')) === idOf(primaDi(PRIMO)), 3000);
  await page.waitForTimeout(400);
  const base = chiamate.length;

  const t = {
    page, ctx, errori, chiamate, stato,
    dopoApertura: () => chiamate.slice(base),
    input: (n) => page.locator(`#${idOf(n)}`),
    async valore(n) { return page.locator(`#${idOf(n)}`).inputValue(); },
    async pannelloAperto() {
      const l = page.locator(APERTO);
      const c = await l.count();
      for (let i = 0; i < c; i++) if (await l.nth(i).isVisible()) return true;
      return false;
    },
    async fuocoSu() { return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName); },
    /** Entra nel campo da tastiera: clic sul campo di testo prima e Tab. */
    async entraColTab(n) {
      await page.locator(`#${idOf(primaDi(n))}`).click();
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
    },
    /** Il contenitore .ant-picker che contiene il campo. */
    picker(n) { return page.locator('.ant-picker').filter({ has: page.locator(`#${idOf(n)}`) }); },
    async salva() {
      const prima = chiamate.length;
      await page.locator('button').filter({ hasText: 'Salva' }).first().click();
      await attendi(() => chiamate.length > prima, 5000);
      await page.waitForTimeout(200);
      return chiamate.filter((c) => c.action === 'Save').at(-1);
    },
    /** I valori che il campo ha mandato al server, in ordine, dopo l'apertura. */
    inviati(n) {
      return t.dopoApertura().filter((c) => c[wire(n)] !== undefined).map((c) => ({ action: c.action, v: c[wire(n)] }));
    },
    posts() { return t.dopoApertura().filter((c) => c.action === 'Post'); },
  };
  return t;
}

/** Il valore arrivato al server: dal Post (campo con reload) o da Salva. */
async function arrivatoAlServer(t, n) {
  if (conReload(n)) {
    await attendi(() => t.posts().length > 0, 3000);
    await t.page.waitForTimeout(300);
    return { posts: t.posts().map((c) => c[wire(n)]) };
  }
  const s = await t.salva();
  return { save: s ? s[wire(n)] : '(nessun Save)' };
}

// ─────────────────────────────────────────────────────────────────── le prove
const PROVE = [];
const prova = (nome, fn) => PROVE.push([nome, fn]);

// ---------- T1 (difetto 1): '1030' + Tab -> 10:30, un Tab solo, il pannello non si apre
for (const n of ['oraVuota', 'oraVuotaR']) {
  prova(`T1 ora vuota ${conReload(n) ? 'con' : 'senza'} reload (${n}): '1030' + Tab -> 10:30 a video e al server`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    eq('il fuoco e\' sul campo ora', await t.fuocoSu(), idOf(n));
    check('entrare col Tab non apre il pannello', !(await t.pannelloAperto()));
    await t.page.keyboard.type('1030', { delay: 40 });
    await t.page.waitForTimeout(200);
    check('digitando le cifre il pannello resta chiuso', !(await t.pannelloAperto()));
    eq('prima di uscire il campo contiene quanto scritto', await t.valore(n), '1030');
    eq('nessun Post mentre si scrive', t.posts().length, 0);
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(500);
    eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
    eq('il campo mostra 10:30', await t.valore(n), '10:30');
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq('UN Post di reload, con 10:30', srv.posts, ['10:30']);
    else {
      eq('nessun Post (il campo non ha reload)', t.posts().length, 0);
      eq('Salva manda 10:30', srv.save, '10:30');
    }
    eq('dopo la risposta il campo mostra ancora 10:30', await t.valore(n), '10:30');
    await t.ctx.close();
  });
}

// ---------- T2: '930' e uscita col MOUSE (clic su un altro campo) -> 09:30
for (const n of ['oraVuota', 'oraVuotaR']) {
  prova(`T2 ora vuota ${conReload(n) ? 'con' : 'senza'} reload (${n}): '930' e uscita col mouse -> 09:30`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    await t.page.keyboard.type('930', { delay: 40 });
    await t.page.waitForTimeout(200);
    check('digitando il pannello resta chiuso', !(await t.pannelloAperto()));
    await t.page.locator(`#${idOf(primaDi(PRIMO))}`).click();
    await t.page.waitForTimeout(600);
    eq('il fuoco resta sul campo cliccato', await t.fuocoSu(), idOf(primaDi(PRIMO)));
    eq('il campo mostra 09:30', await t.valore(n), '09:30');
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq('UN Post di reload, con 09:30', srv.posts, ['09:30']);
    else eq('Salva manda 09:30', srv.save, '09:30');
    await t.ctx.close();
  });
}

// ---------- T3 (difetto 2): campo valorizzato, Ctrl+A, Canc, Tab -> vuoto e '' al server
for (const n of ['oraPiena', 'oraPienaR']) {
  prova(`T3 ora valorizzata ${conReload(n) ? 'con' : 'senza'} reload (${n}): Ctrl+A, Canc, Tab -> vuota a video e '' al server`, async (b) => {
    const t = await apriApp(b);
    eq('parte da 09:00', await t.valore(n), '09:00');
    await t.entraColTab(n);
    eq('il fuoco e\' sul campo ora', await t.fuocoSu(), idOf(n));
    await t.page.keyboard.press('Control+A');
    await t.page.keyboard.press('Delete');
    await t.page.waitForTimeout(150);
    eq('il campo e\' vuoto', await t.valore(n), '');
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(500);
    eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
    eq('il campo resta vuoto dopo il Tab', await t.valore(n), '');
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq('UN Post, con valore vuoto', srv.posts, ['']);
    else eq('Salva manda il campo vuoto', srv.save, '');
    eq('dopo la risposta del server il campo e\' ancora vuoto', await t.valore(n), '');
    await t.ctx.close();
  });
}

prova('T3 ora valorizzata con reload: Backspace fino a vuoto + Tab committa \'\' una sola volta', async (b) => {
  const n = 'oraPienaR';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('End');
  for (let i = 0; i < 7; i++) await t.page.keyboard.press('Backspace');
  await t.page.waitForTimeout(150);
  eq('il campo e\' vuoto', await t.valore(n), '');
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(500);
  const srv = await arrivatoAlServer(t, n);
  eq('UN Post, con valore vuoto', srv.posts, ['']);
  eq('il campo resta vuoto', await t.valore(n), '');
  await t.ctx.close();
});

// ---------- T4: il passaggio col Tab non committa niente
prova('T4 campi ora vuoti: il passaggio col Tab non fa partire commit ne\' reload', async (b) => {
  const t = await apriApp(b);
  for (const n of ['oraVuota', 'oraVuotaR']) {
    await t.entraColTab(n);
    eq(`(${n}) il fuoco e' sul campo`, await t.fuocoSu(), idOf(n));
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(300);
    eq(`(${n}) un Tab porta al campo successivo`, await t.fuocoSu(), idOf(dopoDi(n)));
    eq(`(${n}) il campo resta vuoto`, await t.valore(n), '');
  }
  await t.page.waitForTimeout(400);
  eq('nessun Post di reload e\' partito', t.posts().length, 0);
  const s = await t.salva();
  check('Salva non porta oraVuota', s && s[wire('oraVuota')] === undefined, JSON.stringify(s && s[wire('oraVuota')]));
  await t.ctx.close();
});

prova('T4 campi ora valorizzati: il passaggio col Tab senza toccare non fa partire commit ne\' reload', async (b) => {
  const t = await apriApp(b);
  for (const n of ['oraPiena', 'oraPienaR']) {
    await t.entraColTab(n);
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(300);
    eq(`(${n}) un Tab porta al campo successivo`, await t.fuocoSu(), idOf(dopoDi(n)));
    eq(`(${n}) il valore e' intatto`, await t.valore(n), '09:00');
  }
  await t.page.waitForTimeout(400);
  eq('nessun Post di reload e\' partito', t.posts().length, 0);
  await t.ctx.close();
});

prova('T4 ora valorizzata con reload: riscrivo lo STESSO valore (09:00) e Tab: nessun secondo commit', async (b) => {
  const n = 'oraPienaR';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('Control+A');
  await t.page.keyboard.type('09:00', { delay: 30 });
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(700);
  eq('il campo mostra 09:00', await t.valore(n), '09:00');
  eq('nessun Post (il valore non e\' cambiato)', t.posts().map((c) => c[wire(n)]), []);
  await t.ctx.close();
});

prova('T4 ora valorizzata con reload: scrivo \'900\' (= 09:00, gia\' presente) e Tab: a video torna 09:00', async (b) => {
  // A video il testo va sempre normalizzato in HH:mm. Se parta o no un Post
  // e' ambiguo: il contratto dice "se il testo e' uguale al valore gia'
  // presente non parte un secondo commit", ma '900' non e' lo stesso TESTO,
  // e' la stessa ora; il legacy (onchange sul testo) ricaricava. Il Post
  // quindi si registra soltanto.
  const n = 'oraPienaR';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('Control+A');
  await t.page.keyboard.type('900', { delay: 30 });
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(700);
  eq('il campo mostra 09:00', await t.valore(n), '09:00');
  info(`Post partiti con '900' su 09:00: ${JSON.stringify(t.posts().map((c) => c[wire(n)]))}`);
  await t.ctx.close();
});

// ---------- T5: testo non interpretabile -> nessun commit, e a video torna il
// valore di partenza (contratto rivisto: il testo scritto NON resta).
for (const n of ['oraVuota', 'oraVuotaR', 'oraPiena', 'oraPienaR']) {
  for (const testoNonValido of ['2599', '2500', '9:75', '10a']) {
    for (const uscita of ['Tab', 'mouse']) {
      prova(`T5 ${n}: '${testoNonValido}' e uscita col ${uscita}: niente commit, a video torna il valore di partenza`, async (b) => {
        const t = await apriApp(b);
        const iniziale = await t.valore(n);
        await t.entraColTab(n);
        if (iniziale) await t.page.keyboard.press('Control+A');
        await t.page.keyboard.type(testoNonValido, { delay: 30 });
        await t.page.waitForTimeout(150);
        if (uscita === 'Tab') {
          await t.page.keyboard.press('Tab');
          await t.page.waitForTimeout(600);
          eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
        } else {
          await t.page.locator(`#${idOf(primaDi(PRIMO))}`).click();
          await t.page.waitForTimeout(600);
          eq('il fuoco resta sul campo cliccato', await t.fuocoSu(), idOf(primaDi(PRIMO)));
        }
        eq(`a video torna ${JSON.stringify(iniziale)}`, await t.valore(n), iniziale);
        check('nessun pannello aperto', !(await t.pannelloAperto()));
        const inv = t.inviati(n);
        check('nessun valore inviato dal campo (niente Post, niente commit)', inv.length === 0, JSON.stringify(inv));
        eq('nessun Post', t.posts().length, 0);
        if (!conReload(n)) {
          const s = await t.salva();
          // Il client manda con Salva i valori dei campi valorizzati: senza
          // commit porta quello di partenza (o niente, se era vuoto).
          eq('Salva porta il valore di partenza (nessun commit)', s && s[wire(n)], iniziale || undefined);
        }
        await t.ctx.close();
      });
    }
  }
}

// ---------- T5b (contratto rivisto): ora seguita solo dal separatore = ora intera
for (const [n, scritto, atteso] of [
  ['oraVuota', '9:', '09:00'],
  ['oraVuotaR', '10.', '10:00'],
]) {
  prova(`T5b ${n}: '${scritto}' + Tab -> ${atteso}`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    await t.page.keyboard.type(scritto, { delay: 30 });
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(500);
    eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
    eq(`il campo mostra ${atteso}`, await t.valore(n), atteso);
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq(`UN Post, con ${atteso}`, srv.posts, [atteso]);
    else eq(`Salva manda ${atteso}`, srv.save, atteso);
    await t.ctx.close();
  });
}

// ---------- T9 (contratto rivisto): il ramo che rimonta il valore chiude anche
// il pannello. Scrivo un testo che si completa nel valore gia' presente (o uno
// non valido), apro il pannello col clic nel campo, esco col mouse su un ALTRO
// campo: il pannello non deve restare aperto e a video torna il valore.
for (const [n, scritto, iniziale] of [
  ['oraPiena', '900', '09:00'],
  ['oraPienaR', '900', '09:00'],
  ['oraPiena', '2500', '09:00'],
  ['dataPiena', '5/7/2026', '05/07/2026'],
  ['dataPiena', '31022026', '05/07/2026'],
]) {
  prova(`T9 ${n} = ${iniziale}: scrivo '${scritto}', clic nel campo apre il pannello, clic su un altro campo lo chiude e a video torna ${iniziale}`, async (b) => {
    const t = await apriApp(b);
    eq('valore di partenza', await t.valore(n), iniziale);
    await t.entraColTab(n);
    await t.page.keyboard.press('Control+A');
    await t.page.keyboard.type(scritto, { delay: 30 });
    await t.page.waitForTimeout(200);
    check('(digitando il pannello resta chiuso)', !(await t.pannelloAperto()));
    await t.input(n).click();
    const aperto = await attendi(() => t.pannelloAperto(), 1500);
    check('il clic nel campo apre il pannello', aperto);
    await t.page.locator(`#${idOf(primaDi(PRIMO))}`).click();
    // La chiusura ha una dissolvenza (225-470 ms misurati nella prova 5740).
    const chiuso = await attendi(async () => !(await t.pannelloAperto()), 1500);
    check('uscito col mouse su un altro campo, nessun .ant-picker-dropdown visibile', chiuso);
    await t.page.waitForTimeout(300);
    eq('il fuoco e\' sul campo cliccato', await t.fuocoSu(), idOf(primaDi(PRIMO)));
    eq(`a video torna ${iniziale}`, await t.valore(n), iniziale);
    const inv = t.inviati(n).filter((x) => x.v !== iniziale);
    check('nessun valore diverso da quello di partenza inviato', inv.length === 0, JSON.stringify(inv));
    if (conReload(n)) info(`Post partiti: ${JSON.stringify(t.posts().map((c) => c[wire(n)]))}`);
    await t.ctx.close();
  });
}

// ---------- T6: nessuna X di pulizia sui campi ora
for (const n of ['oraPiena', 'oraPienaR']) {
  prova(`T6 ${n}: nessuna X di pulizia (.ant-picker-clear) neanche col mouse sopra`, async (b) => {
    const t = await apriApp(b);
    const p = t.picker(n);
    await p.scrollIntoViewIfNeeded();
    await p.hover();
    await t.page.waitForTimeout(300);
    const clear = p.locator('.ant-picker-clear');
    const n1 = await clear.count();
    let visibile = false;
    for (let i = 0; i < n1; i++) if (await clear.nth(i).isVisible()) visibile = true;
    check('col mouse sopra, nessuna .ant-picker-clear nel campo', n1 === 0, `trovate ${n1}, visibili: ${visibile}`);
    // Anche col fuoco dentro (antd la mostra pure li').
    await t.input(n).click();
    await t.page.waitForTimeout(300);
    eq('col fuoco nel campo, nessuna .ant-picker-clear', await p.locator('.ant-picker-clear').count(), 0);
    await t.ctx.close();
  });
}

// ---------- T7: digitare non apre il pannello (anche partendo da un campo valorizzato)
prova('T7 ora valorizzata: Ctrl+A e digitare \'1415\' non apre il pannello; Tab -> 14:15', async (b) => {
  const n = 'oraPiena';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('Control+A');
  await t.page.keyboard.type('1415', { delay: 40 });
  await t.page.waitForTimeout(250);
  check('digitando il pannello resta chiuso', !(await t.pannelloAperto()));
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(500);
  eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
  eq('il campo mostra 14:15', await t.valore(n), '14:15');
  const s = await t.salva();
  eq('Salva manda 14:15', s && s[wire(n)], '14:15');
  await t.ctx.close();
});

// ---------- T8: campo data/ora, parte oraria flessibile
for (const n of ['tsVuoto', 'tsVuotoR']) {
  prova(`T8 data/ora ${conReload(n) ? 'con' : 'senza'} reload (${n}): '05072026 930' + Tab -> 05/07/2026 09:30`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    eq('il fuoco e\' sul campo', await t.fuocoSu(), idOf(n));
    await t.page.keyboard.type('05072026 930', { delay: 30 });
    await t.page.waitForTimeout(200);
    check('digitando il calendario resta chiuso', !(await t.pannelloAperto()));
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(600);
    eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
    eq('il campo mostra 05/07/2026 09:30', await t.valore(n), '05/07/2026 09:30');
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq('UN Post, con 05/07/2026 09:30', srv.posts, ['05/07/2026 09:30']);
    else eq('Salva manda 05/07/2026 09:30', srv.save, '05/07/2026 09:30');
    await t.ctx.close();
  });
}

prova('T8 data/ora senza reload: \'05072026 1030\' + Tab -> 05/07/2026 10:30', async (b) => {
  const n = 'tsVuoto';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.type('05072026 1030', { delay: 30 });
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(600);
  eq('il campo mostra 05/07/2026 10:30', await t.valore(n), '05/07/2026 10:30');
  const s = await t.salva();
  eq('Salva manda 05/07/2026 10:30', s && s[wire(n)], '05/07/2026 10:30');
  await t.ctx.close();
});

// ---------- T8b (contratto rivisto): data/ora con ora non valida -> niente
// commit e torna il valore (prima l'ora diventava 00:00); una data senza ora
// vale ancora 00:00.
for (const n of ['tsPieno', 'tsPienoR']) {
  for (const uscita of ['Tab', 'mouse']) {
    prova(`T8b ${n} = 05/07/2026 10:30: '05/07/2026 25:00' e uscita col ${uscita}: niente commit, torna 05/07/2026 10:30`, async (b) => {
      const t = await apriApp(b);
      await t.entraColTab(n);
      await t.page.keyboard.press('Control+A');
      await t.page.keyboard.type('05/07/2026 25:00', { delay: 30 });
      await t.page.waitForTimeout(150);
      if (uscita === 'Tab') {
        await t.page.keyboard.press('Tab');
        await t.page.waitForTimeout(600);
        eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
      } else {
        await t.page.locator(`#${idOf(primaDi(PRIMO))}`).click();
        await t.page.waitForTimeout(600);
      }
      eq('a video torna 05/07/2026 10:30', await t.valore(n), '05/07/2026 10:30');
      check('nessun calendario aperto', !(await t.pannelloAperto()));
      const inv = t.inviati(n);
      check('nessun valore inviato dal campo', inv.length === 0, JSON.stringify(inv));
      eq('nessun Post', t.posts().length, 0);
      if (!conReload(n)) {
        const s = await t.salva();
        eq('Salva porta il valore di partenza (nessun commit)', s && s[wire(n)], '05/07/2026 10:30');
      }
      await t.ctx.close();
    });
  }
}

for (const n of ['tsVuoto', 'tsVuotoR']) {
  prova(`T8b ${n}: '05072026' (data senza ora) + Tab -> 05/07/2026 00:00`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    await t.page.keyboard.type('05072026', { delay: 30 });
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(600);
    eq('il campo mostra 05/07/2026 00:00', await t.valore(n), '05/07/2026 00:00');
    const srv = await arrivatoAlServer(t, n);
    if (conReload(n)) eq('UN Post, con 05/07/2026 00:00', srv.posts, ['05/07/2026 00:00']);
    else eq('Salva manda 05/07/2026 00:00', srv.save, '05/07/2026 00:00');
    await t.ctx.close();
  });
}

// ─────────────────────────────────────────────────────────────────── esecuzione
if (LIST_ONLY) {
  for (const [nome] of PROVE) console.log(nome);
  process.exit(0);
}

const browser = await chromium.launch({ headless: !HEADED });
try {
  for (const [nome, fn] of PROVE) {
    if (ONLY && !nome.includes(ONLY)) continue;
    current = nome;
    console.log(`\n${nome}`);
    try {
      await fn(browser);
    } catch (e) {
      check('la prova arriva in fondo', false, String(e && e.message || e).split('\n')[0]);
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${nPass} controlli passati, ${FAILED.length} falliti`);
for (const f of FAILED) console.log(`  FAIL ${f}`);
process.exit(FAILED.length ? 1 : 0);
