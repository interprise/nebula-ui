/**
 * SXADV-5740 — campi Data in React: prova end-to-end indipendente.
 *
 * Chi prova non e' chi implementa: questo file esprime il comportamento
 * PROMESSO dal ticket, non quello del codice. Rende il VERO client (Shell ->
 * ViewRenderer -> DateControl/TimestampControl/TimeControl) dal dev server
 * Vite, contro un server simulato con page.route: nessun DB, nessun Tomcat.
 *
 * La maschera finta (una detail, pageType 2) ha, per ogni campo data, un campo
 * di testo PRIMA (per entrarci col Tab) e uno DOPO (per verificare dove va il
 * Tab). Ci sono campi data con e senza `reload` (come "Data doc" in fattura,
 * che ricarica al cambio): per quelli con reload il valore si legge dal Post
 * che parte subito; per quelli senza si preme "Salva" e si legge il parametro
 * spedito (il client manda i formValues con ogni azione).
 *
 * Il server simulato fa l'eco: tiene lo stato dei campi, applica i valori che
 * gli arrivano e rimanda la maschera intera, come farebbe un Post vero.
 *
 * Uso:
 *   node e2e/sxadv5740-date.e2e.mjs [--only <sottostringa>] [--headed] [--list]
 *   BASE=http://localhost:5174/entrasp/app/  (default)
 *
 * Il dev server: npx vite --config vite.config.poll.mts --port 5174 --strictPort
 * Esce con codice 1 se almeno un caso fallisce.
 */
import { createRequire } from 'node:module';

// playwright non e' fra le dipendenze del progetto: PLAYWRIGHT_DIR indica una
// cartella node_modules che lo contiene (npx playwright ne lascia una in ~/.npm/_npx).
const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:5174/entrasp/app/';
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

const p2 = (n) => String(n).padStart(2, '0');
const oggi = () => {
  const d = new Date();
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// ───────────────────────────────────────────────────────── la maschera finta
const SID = 'S1';
const VS = `${SID}-0`;
const wire = (n) => `${n}.${VS}`;

/** I campi della maschera, in ordine di tabulazione. */
const CAMPI = [
  // [nome, tipo, format Java, valore iniziale, reload]
  ['dataVuota', 'date', 'dd/MM/yyyy', null, false],
  ['dataPiena', 'date', 'dd/MM/yyyy', '05/08/2026', false],
  ['dataVuotaR', 'date', 'dd/MM/yyyy', null, true],
  ['dataPienaR', 'date', 'dd/MM/yyyy', '05/08/2026', true],
  ['tsVuoto', 'timestamp', 'dd/MM/yyyy HH:mm', null, false],
  ['tsPieno', 'timestamp', 'dd/MM/yyyy HH:mm', '05/08/2026 10:30', false],
  ['tsPienoR', 'timestamp', 'dd/MM/yyyy HH:mm', '05/08/2026 10:30', true],
  ['oraVuota', 'time', undefined, null, false],
  // Aggiunti per C6 (scrittura completa nel formato esatto, uscita col mouse)
  ['tsVuotoR', 'timestamp', 'dd/MM/yyyy HH:mm', null, true],
  ['oraPiena', 'time', undefined, '09:00', false],
  ['oraVuotaR', 'time', undefined, null, true],
  ['oraPienaR', 'time', undefined, '09:00', true],
  // C7: nasce NON modificabile; lo diventa con la risposta di un reload di un
  // altro campo (qualunque Post, nel server finto).
  ['dataDis', 'date', 'dd/MM/yyyy', null, false],
];

/** Campi che nascono non modificabili: `stato['editable:' + nome]`. */
const NON_MODIFICABILI_ALL_INIZIO = ['dataDis'];

const idOf = (n) => `id_${n}`;
const primaDi = (n) => `prima_${n}`;
const dopoDi = (n) => `dopo_${n}`;

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
      type: tipo, name: wire(n), id: idOf(n), editable: stato[`editable:${n}`] ?? true, size: 10,
      value: stato[n] ?? null,
    };
    if (format) c.format = format;
    if (reload) { c.reload = 'true'; c.command = 'Post'; c.navpath = VS; }
    rows.push(riga(i++, `${n}:`, c));
    rows.push(riga(i++, `Dopo ${n}:`, testo(dopoDi(n), stato[dopoDi(n)])));
  }
  return {
    pageType: 2,
    viewName: 'sxadv5740Detail',
    title: 'Prova date',
    path: VS,
    breadcrumbs: 'Prova date',
    rows,
  };
}

const TOOLBAR = [
  { id: 'tb-salva', text: 'Salva', handler: 'Save', disabled: false },
  // C8: un bottone della toolbar SENZA id (il fuoco su di lui non ha un id
  // da ricordare, e un ripiego sull'id del campo data lo riporterebbe li').
  { text: 'Altro', handler: 'Altro', disabled: false },
];

const jsonBody = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

function leggiParametri(req) {
  const raw = req.method() === 'POST' ? (req.postData() || '') : new URL(req.url()).search.slice(1);
  const out = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = out[k] === undefined ? v : [].concat(out[k], v);
  return out;
}

// ───────────────────────────────────────────────────────────── banco di prova
const APERTO = '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)';

async function apriApp(browser, opzioni = {}) {
  /** ms di attesa prima di rispondere a un Post (reload "in volo"). */
  const ritardoPost = opzioni.ritardoPost ?? 0;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));

  const stato = {};
  for (const [n, , , v] of CAMPI) stato[n] = v;
  for (const n of NON_MODIFICABILI_ALL_INIZIO) stato[`editable:${n}`] = false;
  /** Ogni richiesta a /entrasp/controller, con i parametri decodificati. */
  const chiamate = [];

  await page.route('**/entrasp/controller2**', async (route) => {
    const p = leggiParametri(route.request());
    if (p.action === 'GetConfig') return route.fulfill(jsonBody({ loggedIn: true }));
    if (p.action === 'JSONMenu') {
      return route.fulfill(jsonBody({
        loginfo: { login: '44AMM', profile: 'Amministratore', customerKey: '02409720', changePassword: false, copyright: 'Sixtema Spa' },
        children: [{ id: 'menu.x', text: 'Prove', children: [] }],
        panels: [{ id: SID, title: 'Prova date' }],
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
    // C7: un reload di un altro campo rende modificabile il campo nato disabilitato.
    if (p.action === 'Post') for (const n of NON_MODIFICABILI_ALL_INIZIO) stato[`editable:${n}`] = true;
    if (p.action === 'Post' && ritardoPost) await new Promise((r) => setTimeout(r, ritardoPost));
    return route.fulfill(jsonBody({ ui: detailUi(stato), toolbar: TOOLBAR, uiData: {} }));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const pronto = await attendi(async () => (await page.locator(`#${idOf('dataVuota')}`).count()) > 0, 30000);
  if (!pronto) {
    const testoPagina = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    await ctx.close();
    throw new Error(`la maschera finta non si e' resa (manca #id_dataVuota): richieste al controller ${chiamate.length}, errori ${JSON.stringify(errori).slice(0, 200)}, pagina "${testoPagina}"`);
  }
  // La pagina nuova porta da se' il fuoco sul primo campo modificabile
  // (SXADV-5803), in differita: si aspetta che l'abbia fatto, altrimenti quel
  // fuoco arriva a meta' prova e ruba il Tab o il tasto della prova.
  await attendi(async () => (await page.evaluate(() => document.activeElement?.id || '')) === `id_${'prima_dataVuota'}`, 3000);
  await page.waitForTimeout(400);
  const base = chiamate.length;

  const t = {
    page, ctx, errori, chiamate, stato,
    /** Le chiamate fatte DOPO l'apertura della maschera. */
    dopoApertura: () => chiamate.slice(base),
    input: (n) => page.locator(`#${idOf(n)}`),
    async valore(n) { return page.locator(`#${idOf(n)}`).inputValue(); },
    async calendarioAperto() {
      const l = page.locator(APERTO);
      const c = await l.count();
      for (let i = 0; i < c; i++) if (await l.nth(i).isVisible()) return true;
      return false;
    },
    /** Aspetta che il calendario sia chiuso (la chiusura ha una dissolvenza). */
    async chiusoEntro(ms = 1500) { return attendi(async () => !(await t.calendarioAperto()), ms); },
    async fuocoSu() { return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName); },
    /** Entra nel campo da tastiera: clic sul campo di testo prima e Tab. */
    async entraColTab(n) {
      await page.locator(`#${idOf(primaDi(n))}`).click();
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
    },
    /** Il suffisso (icona calendario/orologio) del picker che contiene il campo. */
    icona(n) {
      return page.locator('.ant-picker').filter({ has: page.locator(`#${idOf(n)}`) }).locator('.ant-picker-suffix');
    },
    /** Clic VERO dove l'utente vede l'icona calendario: il mouse ci passa sopra
     *  e preme nel centro del suffisso. Niente locator.click (che rifiuta se un
     *  altro elemento sta sopra): se al passaggio del mouse l'icona e' coperta da
     *  qualcos'altro (la X di antd per svuotare), l'utente clicca QUELLO, e la
     *  prova deve vedere lo stesso. Restituisce cosa c'era sotto il puntatore. */
    async cliccaIcona(n) {
      await t.icona(n).scrollIntoViewIfNeeded();
      const box = await t.icona(n).boundingBox();
      if (!box) throw new Error(`icona di ${n} non trovata`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(150);
      const sotto = await page.evaluate(([px, py]) => {
        const e = document.elementFromPoint(px, py);
        const s = e && e.closest('.ant-picker-suffix, .ant-picker-clear');
        return s ? s.className : (e ? e.tagName + '.' + e.className : null);
      }, [x, y]);
      await page.mouse.down();
      await page.mouse.up();
      return sotto;
    },
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

// ─────────────────────────────────────────────────────────────────── le prove
const PROVE = [];
const prova = (nome, fn) => PROVE.push([nome, fn]);

// ---------- 5740.0: digitare in un campo vuoto, un Tab solo, inserimento flessibile
for (const [n, desc, atteso] of [
  ['dataVuota', 'DateControl senza reload', '05/07/2026'],
  ['dataVuotaR', 'DateControl con reload', '05/07/2026'],
  ['tsVuoto', 'TimestampControl', '05/07/2026 00:00'],
]) {
  prova(`C1 5740.0 ${desc}: 05072026 non apre il calendario, un Tab esce e committa ${atteso}`, async (b) => {
    const t = await apriApp(b);
    await t.entraColTab(n);
    eq('il fuoco e\' sul campo data', await t.fuocoSu(), idOf(n));
    check('entrare col Tab non apre il calendario', !(await t.calendarioAperto()));
    await t.page.keyboard.type('05072026', { delay: 40 });
    await t.page.waitForTimeout(200);
    check('digitando le cifre il calendario resta chiuso', !(await t.calendarioAperto()));
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(400);
    eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
    check('dopo il Tab il calendario e\' chiuso', !(await t.calendarioAperto()));
    eq('il campo mostra la data completata', await t.valore(n), atteso);
    if (n.endsWith('R')) {
      await attendi(() => t.posts().length > 0, 3000);
      eq('parte UN Post di reload con la data completata', t.inviati(n).filter((x) => x.action === 'Post').map((x) => x.v), [atteso]);
    } else {
      const s = await t.salva();
      eq('Salva manda la data completata', s && s[wire(n)], atteso);
    }
    await t.ctx.close();
  });
}

prova('C1 5740.0 TimeControl: digitare 1030 non apre il pannello, un Tab esce', async (b) => {
  const n = 'oraVuota';
  const t = await apriApp(b);
  await t.entraColTab(n);
  eq('il fuoco e\' sul campo ora', await t.fuocoSu(), idOf(n));
  check('entrare col Tab non apre il pannello', !(await t.calendarioAperto()));
  await t.page.keyboard.type('1030', { delay: 40 });
  await t.page.waitForTimeout(200);
  check('digitando le cifre il pannello resta chiuso', !(await t.calendarioAperto()));
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(300);
  eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
  info(`valore mostrato dopo il Tab: ${JSON.stringify(await t.valore(n))}`);
  await t.ctx.close();
});

// ---------- 2: come si apre il calendario (specifica corretta dal coordinamento, 21/09):
// il clic nel TESTO lo apre (accettato dalla tester), l'icona lo apre, Freccia
// giu' (anche con Alt o Ctrl) e Ctrl+Spazio lo aprono, Invio NO; digitare non lo
// apre mai e, se era aperto, lo chiude; un Tab basta per uscire.
for (const [n, desc, iniziale] of [
  ['dataVuota', 'DateControl vuoto', ''],
  ['dataPiena', 'DateControl valorizzato', '05/08/2026'],
  ['tsPieno', 'TimestampControl valorizzato', '05/08/2026 10:30'],
]) {
  prova(`C2 ${desc}: clic nel testo e icona aprono; Freccia giu', Alt/Ctrl+Freccia giu', Ctrl+Spazio aprono; Invio no`, async (b) => {
    const t = await apriApp(b);
    await t.input(n).click();
    await t.page.waitForTimeout(300);
    eq('il clic nel testo da\' il fuoco al campo', await t.fuocoSu(), idOf(n));
    check('il clic nel testo apre il calendario', await t.calendarioAperto());
    await t.page.keyboard.press('Escape');
    await t.page.waitForTimeout(300);
    // Il calendario si chiude con una dissolvenza di 225-470 ms (misurato il
    // 21/09): si aspetta la chiusura, non un tempo fisso.
    check('(Esc lo chiude)', await t.chiusoEntro());
    eq('aprire e chiudere con Esc non tocca il valore', await t.valore(n), iniziale);

    // L'icona, partendo da fuori: il mouse ci va sopra come farebbe l'utente.
    await t.page.locator(`#${idOf(dopoDi(n))}`).click();
    const sotto = await t.cliccaIcona(n);
    await t.page.waitForTimeout(300);
    check('sotto il puntatore, sull\'icona, NON c\'e\' la X che svuota', !/ant-picker-clear/.test(String(sotto)), `sotto il puntatore: ${sotto}`);
    check('il clic sull\'icona apre il calendario', await t.calendarioAperto());
    await t.page.keyboard.press('Escape');
    await t.page.waitForTimeout(300);
    eq('il valore e\' ancora quello di partenza', await t.valore(n), iniziale);

    for (const [tasto, deveAprire] of [
      ['ArrowDown', true], ['Alt+ArrowDown', true], ['Control+ArrowDown', true],
      ['Control+Space', true], ['Enter', false],
    ]) {
      await t.entraColTab(n);
      check(`(entrando col Tab e' chiuso, prima di ${tasto})`, !(await t.calendarioAperto()));
      await t.page.keyboard.press(tasto);
      await t.page.waitForTimeout(300);
      if (deveAprire) check(`${tasto} apre il calendario`, await t.calendarioAperto());
      else check(`${tasto} NON apre il calendario`, !(await t.calendarioAperto()));
      await t.page.keyboard.press('Escape');
      await t.chiusoEntro();
    }
    eq('dopo tutto questo il valore non e\' cambiato', await t.valore(n), iniziale);
    const s = await t.salva();
    const atteso = iniziale === '' ? undefined : iniziale;
    eq('Salva manda il valore di partenza (nessun commit nel frattempo)', s && s[wire(n)], atteso);
    await t.ctx.close();
  });
}

prova('C2 DateControl vuoto: aperto col clic, digitare lo CHIUDE, un Tab esce e committa 05/07/2026', async (b) => {
  const n = 'dataVuota';
  const t = await apriApp(b);
  await t.input(n).click();
  await t.page.waitForTimeout(300);
  check('(il clic nel testo lo ha aperto)', await t.calendarioAperto());
  await t.page.keyboard.type('05072026', { delay: 40 });
  await t.page.waitForTimeout(300);
  check('digitando, il calendario aperto si chiude', !(await t.calendarioAperto()));
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(400);
  eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
  eq('il campo mostra la data completata', await t.valore(n), '05/07/2026');
  const s = await t.salva();
  eq('Salva manda la data completata', s && s[wire(n)], '05/07/2026');
  await t.ctx.close();
});

prova('C2 DateControl con reload, aperto col clic: un Tab (col calendario aperto) esce verso il campo dopo', async (b) => {
  const n = 'dataPienaR';
  const t = await apriApp(b);
  await t.input(n).click();
  await t.page.waitForTimeout(300);
  check('(il clic nel testo lo ha aperto)', await t.calendarioAperto());
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(600);
  eq('UN solo Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
  check('il calendario e\' chiuso', !(await t.calendarioAperto()));
  eq('il valore e\' intatto', await t.valore(n), '05/08/2026');
  const inv = t.inviati(n).filter((x) => x.action === 'Post');
  check('nessun Post vuoto e nessun Post con un altro valore', inv.every((x) => x.v === '05/08/2026'), JSON.stringify(inv));
  await t.ctx.close();
});

// ---------- 5740.1: campo valorizzato, scelta dal calendario sostituisce il valore
/** Clicca nel calendario aperto la cella del giorno `gg` del mese mostrato. */
async function scegliGiorno(t, gg) {
  const drop = t.page.locator(APERTO).last();
  const cella = drop.locator('td.ant-picker-cell-in-view').filter({ hasText: new RegExp(`^${gg}$`) }).first();
  // Clic VERO (mousedown + mouseup del mouse): un click sintetico non toglie
  // il fuoco all'input e nasconde il difetto di 5740.1.
  await cella.click({ timeout: 3000 });
}

for (const [n, desc, reload] of [
  ['dataPiena', 'DateControl senza reload', false],
  ['dataPienaR', 'DateControl con reload (come Data doc)', true],
]) {
  prova(`C3 5740.1 ${desc}: 05/08/2026 -> scelgo il 20 dall'icona, il campo diventa 20/08/2026 e nessun commit vuoto`, async (b) => {
    const t = await apriApp(b);
    eq('parte da 05/08/2026', await t.valore(n), '05/08/2026');
    // Il gesto dell'utente: clic nel campo, poi (se non e' gia' aperto) l'icona.
    await t.input(n).click();
    await t.page.waitForTimeout(250);
    if (!(await t.calendarioAperto())) { await t.cliccaIcona(n); await t.page.waitForTimeout(250); }
    check('il calendario e\' aperto', await t.calendarioAperto());
    await scegliGiorno(t, 20);
    await t.page.waitForTimeout(600);
    eq('subito dopo la scelta il campo mostra 20/08/2026', await t.valore(n), '20/08/2026');
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(500);
    eq('dopo il Tab il campo mostra ancora 20/08/2026', await t.valore(n), '20/08/2026');
    if (reload) {
      await attendi(() => t.posts().length > 0, 3000);
      const inv = t.inviati(n);
      info(`valori inviati dal campo: ${JSON.stringify(inv)}`);
      check('nessun valore vuoto arriva al server', inv.every((x) => x.v !== ''), JSON.stringify(inv));
      eq('l\'ultimo valore arrivato al server e\' 20/08/2026', inv.at(-1)?.v, '20/08/2026');
    } else {
      const s = await t.salva();
      eq('Salva manda 20/08/2026', s && s[wire(n)], '20/08/2026');
    }
    await t.ctx.close();
  });

  prova(`C3 5740.1 ${desc}: 05/08/2026 -> icona -> "Oggi" sostituisce il valore`, async (b) => {
    const t = await apriApp(b);
    const sotto = await t.cliccaIcona(n);
    await t.page.waitForTimeout(300);
    check('sotto il puntatore, sull\'icona, NON c\'e\' la X che svuota', !/ant-picker-clear/.test(String(sotto)), `sotto il puntatore: ${sotto}`);
    check('il calendario e\' aperto', await t.calendarioAperto());
    const bottone = t.page.locator(`${APERTO} .ant-picker-now-btn, ${APERTO} .ant-picker-today-btn`).first();
    const cE = (await bottone.count()) > 0 && (await bottone.isVisible());
    check('c\'e\' il bottone Oggi', cE);
    if (cE) await bottone.click({ timeout: 3000 });
    await t.page.waitForTimeout(600);
    eq('il campo mostra oggi', await t.valore(n), oggi());
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(500);
    eq('dopo il Tab il campo mostra ancora oggi', await t.valore(n), oggi());
    if (reload) {
      await attendi(() => t.posts().length > 0, 3000);
      const inv = t.inviati(n);
      info(`valori inviati dal campo: ${JSON.stringify(inv)}`);
      check('nessun valore vuoto arriva al server', inv.every((x) => x.v !== ''), JSON.stringify(inv));
      eq('l\'ultimo valore arrivato al server e\' oggi', inv.at(-1)?.v, oggi());
    } else {
      const s = await t.salva();
      eq('Salva manda oggi', s && s[wire(n)], oggi());
    }
    await t.ctx.close();
  });
}

prova('C3 controprova: campo VUOTO -> icona -> giorno 20 del mese mostrato -> il campo lo mostra e Salva lo manda', async (b) => {
  const n = 'dataVuota';
  const t = await apriApp(b);
  const sotto = await t.cliccaIcona(n);
  await t.page.waitForTimeout(300);
  check('sotto il puntatore, sull\'icona, NON c\'e\' la X che svuota', !/ant-picker-clear/.test(String(sotto)), `sotto il puntatore: ${sotto}`);
  check('il calendario e\' aperto', await t.calendarioAperto());
  await scegliGiorno(t, 20);
  await t.page.waitForTimeout(600);
  const d = new Date();
  const atteso = `20/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  eq('il campo mostra il giorno scelto', await t.valore(n), atteso);
  const s = await t.salva();
  eq('Salva lo manda', s && s[wire(n)], atteso);
  await t.ctx.close();
});

prova('C3 5740.1 TimestampControl con reload: 05/08/2026 10:30 -> icona -> giorno 20 -> OK: sostituisce, mai vuoto', async (b) => {
  const n = 'tsPienoR';
  const t = await apriApp(b);
  const sotto = await t.cliccaIcona(n);
  await t.page.waitForTimeout(300);
  check('sotto il puntatore, sull\'icona, NON c\'e\' la X che svuota', !/ant-picker-clear/.test(String(sotto)), `sotto il puntatore: ${sotto}`);
  check('il calendario e\' aperto', await t.calendarioAperto());
  await scegliGiorno(t, 20);
  await t.page.waitForTimeout(200);
  const ok = t.page.locator(`${APERTO} .ant-picker-ok button`).first();
  if ((await ok.count()) && (await ok.isVisible())) await ok.click({ timeout: 3000 });
  await t.page.waitForTimeout(600);
  eq('il campo mostra 20/08/2026 10:30', await t.valore(n), '20/08/2026 10:30');
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(500);
  await attendi(() => t.posts().length > 0, 3000);
  const inv = t.inviati(n);
  info(`valori inviati dal campo: ${JSON.stringify(inv)}`);
  check('nessun valore vuoto arriva al server', inv.every((x) => x.v !== ''), JSON.stringify(inv));
  eq('l\'ultimo valore arrivato al server e\' 20/08/2026 10:30', inv.at(-1)?.v, '20/08/2026 10:30');
  await t.ctx.close();
});

// ---------- Timestamp: Freccia giu' -> giorno -> OK -> Tab. Una volta sola, dal
// coordinamento, l'uscita ha committato un SECONDO valore con l'ora azzerata
// ('13/08/2026 00:00'). Qui la sequenza si ripete piu' volte per campo: ogni
// valore arrivato al server deve essere quello mostrato, e uno solo.
for (const [n, desc, reload, atteso] of [
  ['tsPieno', 'senza reload', false, '13/08/2026 10:30'],
  ['tsPienoR', 'con reload', true, '13/08/2026 10:30'],
  ['tsVuoto', 'vuoto, senza reload', false, null],
]) {
  prova(`C5 TimestampControl ${desc}: Freccia giu' -> giorno 13 -> OK -> Tab, x3: un solo valore, mai l'ora azzerata`, async (b) => {
    for (let giro = 1; giro <= 3; giro++) {
      const t = await apriApp(b);
      await t.entraColTab(n);
      await t.page.keyboard.press('ArrowDown');
      await t.page.waitForTimeout(300);
      if (!check(`[giro ${giro}] Freccia giu' apre il calendario`, await t.calendarioAperto())) { await t.ctx.close(); continue; }
      await scegliGiorno(t, 13);
      await t.page.waitForTimeout(200);
      const ok = t.page.locator(`${APERTO} .ant-picker-ok button`).first();
      if ((await ok.count()) && (await ok.isVisible())) await ok.click({ timeout: 3000 });
      await t.page.waitForTimeout(500);
      const mostrato = await t.valore(n);
      info(`[giro ${giro}] dopo OK il campo mostra ${JSON.stringify(mostrato)}, fuoco su ${await t.fuocoSu()}`);
      if (atteso) eq(`[giro ${giro}] il campo mostra ${atteso}`, mostrato, atteso);
      else check(`[giro ${giro}] il campo mostra il 13 del mese corrente`, /^13\/\d\d\/\d{4} \d\d:\d\d$/.test(mostrato), JSON.stringify(mostrato));
      await t.page.keyboard.press('Tab');
      await t.page.waitForTimeout(600);
      eq(`[giro ${giro}] dopo il Tab il campo mostra ancora lo stesso valore`, await t.valore(n), mostrato);
      if (reload) {
        await attendi(() => t.posts().length > 0, 3000);
        await t.page.waitForTimeout(400);
        const inv = t.inviati(n).filter((x) => x.action === 'Post').map((x) => x.v);
        info(`[giro ${giro}] valori inviati: ${JSON.stringify(inv)}`);
        eq(`[giro ${giro}] al server arriva UN valore, quello mostrato`, inv, [mostrato]);
      } else {
        const s = await t.salva();
        eq(`[giro ${giro}] Salva manda il valore mostrato`, s && s[wire(n)], mostrato);
      }
      await t.ctx.close();
    }
  });
}

// ---------- C6 (dal revisore): data COMPLETA scritta nel formato esatto, uscita
// col Tab, col mouse su un altro campo, o direttamente su Salva. Il valore deve
// arrivare al server UNA volta (un solo Post se c'e' reload, nessuno se non c'e')
// e il campo deve mostrarlo.
const C6_VALORI = {
  date: '13/08/2026',
  timestamp: '14/08/2026 11:15',
  time: '11:45',
};
const C6_CAMPI = [
  'dataVuota', 'dataPiena', 'dataVuotaR', 'dataPienaR',
  'tsVuoto', 'tsPieno', 'tsVuotoR', 'tsPienoR',
  'oraVuota', 'oraPiena', 'oraVuotaR', 'oraPienaR',
];
for (const n of C6_CAMPI) {
  const [, tipo, , iniziale, reload] = CAMPI.find((c) => c[0] === n);
  const v = C6_VALORI[tipo];
  for (const uscita of ['Tab', 'clic su un altro campo', 'clic su Salva']) {
    prova(`C6 ${tipo} ${iniziale ? 'valorizzato' : 'vuoto'} ${reload ? 'con' : 'senza'} reload (${n}): scrivo '${v}', esco con ${uscita}: un commit solo, e il campo lo mostra`, async (b) => {
      const t = await apriApp(b);
      await t.entraColTab(n);
      eq('il fuoco e\' sul campo', await t.fuocoSu(), idOf(n));
      if (iniziale) await t.page.keyboard.press('Control+A');
      await t.page.keyboard.type(v, { delay: 30 });
      await t.page.waitForTimeout(200);
      eq('prima di uscire il campo contiene quanto scritto', await t.valore(n), v);
      let saveDiUscita;
      const postPrimaDiUscire = t.posts().length;
      if (reload) info(`Post partiti PRIMA di uscire (mentre si scriveva): ${postPrimaDiUscire}`);
      if (uscita === 'Tab') {
        await t.page.keyboard.press('Tab');
        await t.page.waitForTimeout(700);
        eq('UN Tab porta al campo successivo', await t.fuocoSu(), idOf(dopoDi(n)));
      } else if (uscita === 'clic su un altro campo') {
        await t.page.locator(`#${idOf(primaDi('dataVuota'))}`).click();
        await t.page.waitForTimeout(700);
        eq('il fuoco resta sul campo cliccato', await t.fuocoSu(), idOf(primaDi('dataVuota')));
      } else {
        saveDiUscita = await t.salva();
        await t.page.waitForTimeout(500);
      }
      check('il calendario e\' chiuso', !(await t.calendarioAperto()));
      eq('il campo mostra il valore scritto', await t.valore(n), v);
      const post = t.posts().map((c) => c[wire(n)]);
      if (reload) {
        eq('UN solo Post di reload, con il valore scritto', post, [v]);
        eq('e parte all\'uscita, non mentre si scrive', postPrimaDiUscire, 0);
      }
      else eq('nessun Post (il campo non ha reload)', t.posts().length, 0);
      const s = saveDiUscita ?? (await t.salva());
      eq('un solo Save', t.dopoApertura().filter((c) => c.action === 'Save').length, 1);
      eq('Salva manda il valore scritto', s && s[wire(n)], v);
      await t.ctx.close();
    });
  }
}

// ---------- C7: un clic su un campo data NON modificabile non resta "in canna":
// quando una risposta lo rende modificabile, il calendario non si apre da solo.
async function cliccaDentro(t, n, dove = 'testo') {
  const l = dove === 'icona' ? t.icona(n) : t.input(n);
  await l.scrollIntoViewIfNeeded();
  const box = await l.boundingBox();
  await t.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
for (const dove of ['testo', 'icona']) {
  prova(`C7 data disabilitata, clic sul ${dove}, poi resa modificabile da un reload: il calendario non si apre da solo`, async (b) => {
    const n = 'dataDis';
    const t = await apriApp(b);
    check('(il campo nasce disabilitato)', await t.input(n).isDisabled());
    await cliccaDentro(t, n, dove);
    await t.page.waitForTimeout(300);
    check('il clic sul campo disabilitato non apre il calendario', !(await t.calendarioAperto()));
    // Il reload di un altro campo lo rende modificabile.
    await t.entraColTab('dataVuotaR');
    await t.page.keyboard.type('13/08/2026', { delay: 30 });
    await t.page.keyboard.press('Tab');
    const abilitato = await attendi(async () => !(await t.input(n).isDisabled()), 4000);
    check('(la risposta del reload lo ha reso modificabile)', abilitato);
    await t.page.waitForTimeout(800);
    check('quando diventa modificabile il calendario NON si apre da solo', !(await t.calendarioAperto()));
    const fuoco = await t.fuocoSu();
    check('e il fuoco non gli salta addosso', fuoco !== idOf(n), `fuoco su ${fuoco}`);
    // Controprova: ora e' un campo normale, il clic nel testo lo apre (C2).
    await cliccaDentro(t, n, 'testo');
    await t.page.waitForTimeout(300);
    check('(controprova: ora un clic nel testo lo apre)', await t.calendarioAperto());
    await t.ctx.close();
  });
}

// ---------- C8: campo con reload, dove va il fuoco dopo la risposta.
prova('C8 data con reload: scrivo e Tab, con il reload lento (1,2 s): alla risposta il fuoco e\' sul campo dopo', async (b) => {
  const n = 'dataVuotaR';
  const t = await apriApp(b, { ritardoPost: 1200 });
  await t.entraColTab(n);
  await t.page.keyboard.type('13/08/2026', { delay: 30 });
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(100);
  const fuocoInVolo = await t.fuocoSu();
  await attendi(() => t.posts().length > 0, 3000);
  await t.page.waitForTimeout(2000);
  info(`fuoco 100 ms dopo il Tab (reload in volo): ${fuocoInVolo}`);
  eq('mentre il reload e\' in volo il fuoco e\' gia\' sul campo dopo', fuocoInVolo, idOf(dopoDi(n)));
  eq('dopo la risposta il fuoco e\' sul campo dopo', await t.fuocoSu(), idOf(dopoDi(n)));
  eq('UN Post', t.posts().map((c) => c[wire(n)]), ['13/08/2026']);
  await t.ctx.close();
});

prova('C8 data con reload, inserimento FLESSIBILE: scrivo 13082026 e Tab, reload lento: alla risposta il fuoco e\' sul campo dopo', async (b) => {
  const n = 'dataVuotaR';
  const t = await apriApp(b, { ritardoPost: 1200 });
  await t.entraColTab(n);
  await t.page.keyboard.type('13082026', { delay: 30 });
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(100);
  const fuocoInVolo = await t.fuocoSu();
  await attendi(() => t.posts().length > 0, 3000);
  await t.page.waitForTimeout(2000);
  info(`fuoco 100 ms dopo il Tab (reload in volo): ${fuocoInVolo}`);
  eq('dopo la risposta il fuoco e\' sul campo dopo', await t.fuocoSu(), idOf(dopoDi(n)));
  eq('UN Post', t.posts().map((c) => c[wire(n)]), ['13/08/2026']);
  await t.ctx.close();
});

for (const [come, desc] of [
  ['tab-poi-bottone', 'Tab, poi clic su un bottone della toolbar senza id mentre il reload e\' in volo'],
  ['bottone', 'esco direttamente cliccando un bottone della toolbar senza id'],
]) {
  prova(`C8 data con reload: scrivo, ${desc}: il fuoco NON torna sulla data`, async (b) => {
    const n = 'dataVuotaR';
    const t = await apriApp(b, { ritardoPost: 1200 });
    const bottone = t.page.locator('button').filter({ hasText: 'Altro' }).first();
    check('(il bottone "Altro" c\'e\' e non ha id)', (await bottone.count()) === 1 && !(await bottone.getAttribute('id')));
    await t.entraColTab(n);
    await t.page.keyboard.type('13/08/2026', { delay: 30 });
    if (come === 'tab-poi-bottone') {
      await t.page.keyboard.press('Tab');
      await attendi(() => t.posts().length > 0, 3000);
      await t.page.waitForTimeout(150);
    }
    await bottone.click();
    await t.page.waitForTimeout(3000);
    const fuoco = await t.fuocoSu();
    info(`richieste dopo l'apertura: ${JSON.stringify(t.dopoApertura().map((c) => c.action))}, fuoco finale su ${fuoco}`);
    check('il fuoco NON e\' tornato sulla data', fuoco !== idOf(n), `fuoco su ${fuoco}`);
    check('il calendario e\' chiuso', !(await t.calendarioAperto()));
    eq('il campo mostra la data scritta', await t.valore(n), '13/08/2026');
    await t.ctx.close();
  });
}

// ---------- 5740.2: svuotare committa '' una volta; passare col Tab su un vuoto non committa
prova('C4 5740.2 DateControl con reload: Canc fino a vuoto + Tab committa \'\' una sola volta', async (b) => {
  const n = 'dataPienaR';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('End');
  for (let i = 0; i < 12; i++) await t.page.keyboard.press('Backspace');
  await t.page.waitForTimeout(150);
  eq('il campo e\' vuoto', await t.valore(n), '');
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(600);
  await attendi(() => t.posts().length > 0, 3000);
  eq('il campo resta vuoto dopo il Tab', await t.valore(n), '');
  eq('UN Post, con valore vuoto', t.posts().map((c) => c[wire(n)]), ['']);
  await t.ctx.close();
});

prova('C4 5740.2 DateControl senza reload: selezione + Canc + Tab, Salva manda \'\'', async (b) => {
  const n = 'dataPiena';
  const t = await apriApp(b);
  await t.entraColTab(n);
  await t.page.keyboard.press('Control+A');
  await t.page.keyboard.press('Delete');
  await t.page.waitForTimeout(150);
  eq('il campo e\' vuoto', await t.valore(n), '');
  await t.page.keyboard.press('Tab');
  await t.page.waitForTimeout(400);
  eq('il campo resta vuoto dopo il Tab', await t.valore(n), '');
  const s = await t.salva();
  eq('Salva manda il campo vuoto', s && s[wire(n)], '');
  await t.ctx.close();
});

prova('C4 5740.2 campi vuoti: il passaggio col Tab non committa nulla', async (b) => {
  const t = await apriApp(b);
  for (const n of ['dataVuota', 'dataVuotaR', 'tsVuoto']) {
    await t.entraColTab(n);
    eq(`(${n}) il fuoco e' sul campo`, await t.fuocoSu(), idOf(n));
    await t.page.keyboard.press('Tab');
    await t.page.waitForTimeout(300);
    eq(`(${n}) un Tab porta al campo successivo`, await t.fuocoSu(), idOf(dopoDi(n)));
  }
  await t.page.waitForTimeout(400);
  eq('nessun Post di reload e\' partito', t.posts().length, 0);
  const s = await t.salva();
  check('Salva non porta dataVuota', s && s[wire('dataVuota')] === undefined, JSON.stringify(s && s[wire('dataVuota')]));
  check('Salva non porta tsVuoto', s && s[wire('tsVuoto')] === undefined, JSON.stringify(s && s[wire('tsVuoto')]));
  await t.ctx.close();
});

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
