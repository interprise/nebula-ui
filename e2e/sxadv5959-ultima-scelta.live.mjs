/**
 * SXADV-5959 — mappa Fatture attive (docCliQuery, menu.documenti.FA), filtro
 * "Stato SDI" (stSdi, MultiSelect a pastiglie con reload): togliendo con la X
 * l'ULTIMA scelta rimasta, la scelta non deve ripresentarsi. Il filtro resta
 * vuoto, anche dopo un altro ridisegno della mappa e dopo una ricerca.
 *
 * Prova nel browser VERO (Playwright, headless), contro il client GIA'
 * COSTRUITO servito dal Tomcat vero (APP = :9080/entrasp/app/), con clic veri.
 * Non si fida di nessuna correzione: guarda solo cosa si vede e cosa viaggia.
 *
 * Casi:
 *   1. sequenza del ticket: tre scelte (SCARTATO_SDI, SCARTATO_DEST, SCARTATO)
 *      con una Conferma, X sulla PRIMA pastiglia tre volte -> 2, 1, 0 pastiglie
 *      a risposta arrivata (e ferme per 2 s); poi ridisegni: pannello riaperto
 *      senza nulla spuntato, e cambio di "Soggetto:" (reload) -> ancora 0;
 *   2. scelte inserite una alla volta, X sull'ULTIMA inserita per prima;
 *   3. casella "not" di Stato SDI spuntata, poi via tutte le scelte -> 0, e la
 *      ricerca non filtra per Stato SDI;
 *   4. svuotato il filtro, Esegui: il Post non porta scelte e il server non
 *      riporta "Stato SDI" fra i criteri (header.subtitle), con lo stesso
 *      numero di record della ricerca senza filtro; tornati alla mappa dalla
 *      catenella, il filtro e' ancora vuoto. Controprova di sensibilita': con
 *      SCARTATO scelto il subtitle/recordCount cambiano davvero;
 *   5. una sola scelta inserita e subito tolta con la X.
 * Per ogni azione si contano le richieste al server (una X = un Post, niente
 * cicli).
 *
 * SOLA LETTURA: ExecuteMenuItem, MultiSelectList, Post dei filtri, ClearQuery
 * (Pulisci), ExecuteQuery (Esegui), ritorno dalla catenella. Mai Salva/Nuovo/
 * Elimina.
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <APP>` (link monouso che
 * imposta il cookie; nessuna password passa di qui).
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv5959-ultima-scelta.live.mjs [--headed] [--only <sottostringa>]
 *   APP=http://localhost:9080/entrasp/app/  USER_LOGIN=44AMM  (default)
 *   SHOTS=<cartella screenshot dei fallimenti>
 *   PLAYWRIGHT_DIR=<node_modules con playwright>  (default: la cache di npx)
 * Esce con 1 se almeno una verifica fallisce, 2 se non riesce a entrare.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:9080/entrasp/app/';
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SHOTS = process.env.SHOTS || '/tmp/claude-1000/-home-luca-ui-new/2ee7dc99-0c77-4e4d-94fe-707c6a0bd6a4/scratchpad/5959';
const MENU_ID = 'menu.documenti.FA';
const WANTED = ['SCARTATO_SDI', 'SCARTATO_DEST', 'SCARTATO'];
const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
mkdirSync(SHOTS, { recursive: true });

// ─────────────────────────────────────────────────────────────────── esiti
const FAILED = [];
let nPass = 0;
let current = '';
let page;
let shotN = 0;
async function check(what, ok, why = '') {
  if (ok) { nPass += 1; console.log(`  PASS ${what}`); return true; }
  let shot = '';
  try {
    shot = path.join(SHOTS, `fail-${++shotN}-${current.split(' ')[0]}.png`);
    await page.screenshot({ path: shot });
  } catch { shot = ''; }
  FAILED.push(`${current} · ${what}${why ? ' — ' + why : ''}${shot ? ' [' + shot + ']' : ''}`);
  console.log(`  FAIL ${what}${why ? ': ' + why : ''}${shot ? '  (screenshot ' + shot + ')' : ''}`);
  return false;
}
const info = (t) => console.log(`  ..   ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loginLink() {
  const r = spawnSync('entrasp-sql', ['--login-session', USER, '--to', APP], {
    encoding: 'utf8',
    env: { ...process.env, ENTRASP_WS: process.env.ENTRASP_WS || 'ui-new' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/https?:\/\/localhost:\d+\/[0-9a-f]{32}/);
  if (!m) throw new Error('login-session non riuscito: ' + out.replace(/[0-9a-f]{32}/g, '<token>').trim());
  return m[0];
}

// ─────────────────────────────────────────────── richieste: conto e attesa

/** Tutte le POST verso controller/controller2, con action e corpo. */
const LOG = [];
function trackRequests(p) {
  p.on('request', (q) => {
    const u = new URL(q.url());
    if (q.method() !== 'POST' || !/\/controller2?$/.test(u.pathname)) return;
    const body = new URLSearchParams(q.postData() || '');
    LOG.push({ t: Date.now(), action: body.get('action') || '?', body });
  });
}

/**
 * Esegue `act`, aspetta la risposta della richiesta `action` attesa, poi
 * aspetta la quiete (nessuna richiesta nuova per 1,5 s, tetto 10 s). Ritorna
 * le richieste partite nella finestra, il corpo della richiesta attesa e il
 * testo della sua risposta.
 */
async function withRequest(actionName, act) {
  const from = LOG.length;
  const respP = page.waitForResponse((r) => {
    if (!/\/controller2?$/.test(new URL(r.url()).pathname)) return false;
    return new URLSearchParams(r.request().postData() || '').get('action') === actionName;
  }, { timeout: 30000 });
  await act();
  const resp = await respP;
  const text = await resp.text().catch(() => '');
  const t0 = Date.now();
  let lastLen = LOG.length;
  let lastChange = Date.now();
  while (Date.now() - t0 < 10000) {
    await sleep(150);
    if (LOG.length !== lastLen) { lastLen = LOG.length; lastChange = Date.now(); }
    if (Date.now() - lastChange >= 1500) break;
  }
  const reqs = LOG.slice(from);
  return { reqs, body: new URLSearchParams(resp.request().postData() || ''), text };
}

const actionsOf = (reqs) => reqs.map((r) => r.action).join(',');
const stSdiParam = (body) => {
  const k = [...body.keys()].find((x) => /^stSdi\./.test(x));
  return k ? { key: k, value: body.get(k) } : null;
};
const notParam = (body) => {
  const k = [...body.keys()].find((x) => /^stSdi\..*\$not|^\$not.*stSdi|stSdi.*not/i.test(x));
  return k ? `${k}=${body.get(k)}` : null;
};

/** Una X: esattamente un Post, nessun'altra richiesta nella finestra. */
async function checkOnePost(reqs, label) {
  const posts = reqs.filter((r) => r.action === 'Post').length;
  await check(`${label}: una sola richiesta (un Post)`, reqs.length === 1 && posts === 1,
    `richieste ${reqs.length} [${actionsOf(reqs)}]`);
}

// ───────────────────────────────────────────────────── letture della pagina

const stsdi = () => page.locator('td[id^="stSdi."] .multiselect-container').first();
const chipTexts = () => stsdi().locator('.multiselect-chip').allInnerTexts().then((a) => a.map((s) => s.trim()));

/** Pastiglie dopo la risposta: campiona per 2 s, riporta l'ultima lettura e
 *  il massimo visto (una scelta che "si ripresenta" in ritardo si vede). */
async function settledChips() {
  let last = await chipTexts();
  let max = last.length;
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    last = await chipTexts();
    max = Math.max(max, last.length);
  }
  return { chips: last, max };
}

async function expectChips(expected, label) {
  const s = await settledChips();
  info(`${label}: pastiglie ${JSON.stringify(s.chips)}`);
  await check(`${label}: ${expected} pastiglie`, s.chips.length === expected && s.max === expected,
    `viste ${JSON.stringify(s.chips)} (massimo nei 2 s: ${s.max})`);
  if (expected === 0) {
    const hint = await stsdi().getByText('Clicca per selezionare').count();
    await check(`${label}: la banda dice "Clicca per selezionare"`, hint === 1);
  }
  return s.chips;
}

// ───────────────────────────────────────────────────────────────── percorso

async function openFromMenu() {
  const search = page.getByPlaceholder('Cerca nel menu...');
  await search.click();
  await search.fill('Fatture');
  const item = page.locator(`li[data-menu-id$="-${MENU_ID}"]`).first();
  await withRequest('ExecuteMenuItem', () => item.click());
  await stsdi().waitFor({ timeout: 30000 });
}

/** Pulisci: parte pulita (una selezione rimasta da un caso non conta). */
async function clearMap() {
  const btn = page.locator('button').filter({ hasText: /^Pulisci$/ }).first();
  await withRequest('ClearQuery', () => btn.click());
  await stsdi().waitFor({ timeout: 20000 });
  const c = await chipTexts();
  if (c.length) info(`dopo Pulisci restano pastiglie: ${JSON.stringify(c)}`);
  return c;
}

async function openDrawer() {
  await stsdi().locator('.multiselect-picker-btn').click();
  const drawer = page.locator('.ant-drawer-open').last();
  await drawer.locator('.multiselect-option').first().waitFor({ timeout: 20000 });
  return drawer;
}

/** Spunta le voci per testo esatto e conferma; aspetta il Post. */
async function addViaDrawer(labels) {
  const drawer = await openDrawer();
  for (const l of labels) {
    await drawer.locator('.multiselect-option').filter({ hasText: new RegExp(`^\\s*${l}\\s*$`) }).first().click();
  }
  return withRequest('Post', () => drawer.locator('button').filter({ hasText: /^Conferma/ }).click());
}

/** Riapre il pannello: nulla deve risultare spuntato. Chiude con Annulla. */
async function drawerPreselection() {
  const drawer = await openDrawer();
  const conf = (await drawer.locator('button').filter({ hasText: /^Conferma/ }).innerText()).trim();
  const checked = await drawer.locator('.multiselect-option').evaluateAll((els) =>
    els.filter((e) => e.querySelector('.ant-checkbox-checked')).map((e) => e.textContent.trim()));
  const from = LOG.length;
  await drawer.locator('button').filter({ hasText: /^Annulla$/ }).click();
  await page.locator('.ant-drawer-open').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await sleep(600);
  const extra = LOG.slice(from);
  return { conf, checked, extraReqs: extra };
}

/** X sulla pastiglia con quel testo (o la prima/ultima). */
async function removeChip(which) {
  const chips = stsdi().locator('.multiselect-chip');
  let chip;
  if (which === 'first') chip = chips.first();
  else if (which === 'last') chip = chips.last();
  else chip = chips.filter({ hasText: new RegExp(`^\\s*${which}\\s*$`) }).first();
  const label = (await chip.innerText()).trim();
  const r = await withRequest('Post', () => chip.locator('.anticon-close').click());
  const p = stSdiParam(r.body);
  info(`X su ${label} -> Post ${p ? `${p.key}=${JSON.stringify(p.value)}` : '(stSdi non spedito)'} · richieste [${actionsOf(r.reqs)}]`);
  return { ...r, label, sent: p };
}

/** Toglie le pastiglie una a una e verifica il conto dopo ciascuna. */
async function removeAll(order, start) {
  let remaining = start.slice();
  while (remaining.length) {
    const r = await removeChip(order);
    remaining = remaining.filter((x) => x !== r.label);
    await checkOnePost(r.reqs, `X su ${r.label}`);
    const sentKeys = r.sent ? r.sent.value.split(',').filter(Boolean) : null;
    await check(`X su ${r.label}: il Post porta ${remaining.length} scelte`,
      sentKeys !== null && sentKeys.length === remaining.length,
      r.sent ? `spedito ${JSON.stringify(r.sent.value)}` : 'stSdi non spedito');
    const now = await expectChips(remaining.length, `dopo la X su ${r.label}`);
    await check(`dopo la X su ${r.label}: restano quelle giuste`,
      JSON.stringify([...now].sort()) === JSON.stringify([...remaining].sort()),
      `viste ${JSON.stringify(now)}, attese ${JSON.stringify(remaining)}`);
    if (now.length !== remaining.length) return false;
  }
  return true;
}

async function checkDrawerEmpty(label) {
  const d = await drawerPreselection();
  info(`${label}: pannello "${d.conf}", spuntate ${JSON.stringify(d.checked)}`);
  await check(`${label}: nel pannello nessuna voce spuntata`, d.checked.length === 0 && /\(0\)/.test(d.conf),
    `"${d.conf}", spuntate ${JSON.stringify(d.checked)}`);
  await check(`${label}: aprire/annullare il pannello non manda Post`, !d.extraReqs.some((x) => x.action === 'Post'),
    `[${actionsOf(d.extraReqs)}]`);
  await expectChips(0, `${label} (chiuso il pannello)`);
}

/** Cambia "Soggetto:" (codetable con reload): un ridisegno della mappa. */
async function rerenderViaSoggetto(label) {
  const td = page.locator('td.content-cell').filter({ has: page.locator('.ant-select') })
    .and(page.locator(`xpath=//td[preceding-sibling::td[1][normalize-space(.)='Soggetto:']]`)).first();
  if (!(await td.count())) { info('campo "Soggetto:" non trovato: salto questo ridisegno'); return; }
  await td.scrollIntoViewIfNeeded();
  const r = await withRequest('Post', async () => {
    await td.locator('.ant-select').first().click();
    const opt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .filter({ hasNotText: /^\s*$/ }).nth(1);
    await opt.click();
  });
  const p = stSdiParam(r.body);
  info(`${label}: Post di Soggetto, stSdi ${p ? JSON.stringify(p.value) : 'non spedito'} · richieste [${actionsOf(r.reqs)}]`);
  await check(`${label}: il Post di Soggetto non rimette scelte in stSdi`, !p || p.value === '' ,
    p ? JSON.stringify(p.value) : '');
  await check(`${label}: una sola richiesta`, r.reqs.length === 1, `[${actionsOf(r.reqs)}]`);
  await expectChips(0, `${label} (dopo il ridisegno)`);
}

/** Esegui: ritorna criteri (subtitle), recordCount e il corpo spedito. */
async function execute() {
  const btn = page.locator('button').filter({ hasText: /^Esegui$/ }).first();
  const r = await withRequest('ExecuteQuery', () => btn.click());
  let header = null;
  let msgs = [];
  try {
    const j = JSON.parse(r.text);
    header = j?.ui?.header ?? null;
    msgs = (j?.errors || []).map((e) => `${e.type}: ${e.message || e.mnemonic}`);
  } catch { /* sotto */ }
  const sub = header?.subtitle ?? '';
  const cnt = header?.recordCount ?? null;
  const p = stSdiParam(r.body);
  info(`Esegui -> ${header ? `lista, recordCount ${cnt}, criteri "${sub}"` : `nessuna lista (${msgs.join(' | ') || 'nessun messaggio'})`}, stSdi ${p ? JSON.stringify(p.value) : 'non spedito'}${notParam(r.body) ? ', ' + notParam(r.body) : ''} · richieste [${actionsOf(r.reqs)}]`);
  if (header) await page.locator('.ant-breadcrumb').getByText('Interrogazione', { exact: false }).first().waitFor({ timeout: 20000 });
  return { sub, cnt, sent: p, reqs: r.reqs, header, msgs };
}

/** Dalla lista alla mappa: la voce "... Interrogazione" della catenella. */
async function backToMap() {
  const crumb = page.locator('.ant-breadcrumb a, .ant-breadcrumb .ant-breadcrumb-link')
    .filter({ hasText: /Interrogazione/ }).first();
  const from = LOG.length;
  await crumb.click();
  await stsdi().waitFor({ timeout: 20000 });
  await sleep(1500);
  info(`ritorno alla mappa · richieste [${actionsOf(LOG.slice(from))}]`);
}

// ─────────────────────────────────────────────────────────────────── main

let browser;
const run = (name) => !ONLY || name.toLowerCase().includes(ONLY.toLowerCase());
try {
  browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 850 } });
  page = await ctx.newPage();
  trackRequests(page);
  try {
    await page.goto(loginLink(), { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  } catch (e) {
    console.error('FAIL  accesso: ' + e.message);
    await browser.close();
    process.exit(2);
  }
  await openFromMenu();

  // Le tre voci del ticket, se il server le offre.
  {
    const d = await openDrawer();
    const all = (await d.locator('.multiselect-option').allInnerTexts()).map((s) => s.trim());
    await d.locator('button').filter({ hasText: /^Annulla$/ }).click();
    await sleep(500);
    const missing = WANTED.filter((w) => !all.includes(w));
    if (missing.length) throw new Error(`opzioni del ticket assenti: ${missing.join(', ')} (offerte: ${all.join(', ')})`);
  }

  // ── baseline per il caso 4: ricerca senza aver toccato il filtro
  let baseline = null;
  if (run('4')) {
    current = '4-baseline ricerca senza filtro';
    console.log(`\n${current}`);
    await clearMap();
    baseline = await execute();
    await backToMap();
  }

  const cases = [
    ['1 ticket: tre scelte, X sulla prima x3, poi ridisegni', async () => {
      await clearMap();
      const r = await addViaDrawer(WANTED);
      info(`Conferma -> ${JSON.stringify(stSdiParam(r.body)?.value)} · richieste [${actionsOf(r.reqs)}]`);
      const start = await expectChips(3, 'dopo la Conferma');
      if (start.length !== 3) return;
      if (!(await removeAll('first', start))) return;
      await checkDrawerEmpty('ridisegno 1');
      await rerenderViaSoggetto('ridisegno 2');
    }],
    ['2 ordine diverso: una alla volta, X sull\'ultima inserita per prima', async () => {
      await clearMap();
      for (const w of WANTED) {
        const r = await addViaDrawer([w]);
        await check(`aggiunta ${w}: una sola richiesta`, r.reqs.length === 1, `[${actionsOf(r.reqs)}]`);
      }
      const start = await expectChips(3, 'dopo tre Conferme');
      if (start.length !== 3) return;
      // l'ultima inserita per prima, poi la penultima, poi la prima
      let ok = true;
      let remaining = start.slice();
      for (const w of [...WANTED].reverse()) {
        const r = await removeChip(w);
        remaining = remaining.filter((x) => x !== r.label);
        await checkOnePost(r.reqs, `X su ${w}`);
        const now = await expectChips(remaining.length, `dopo la X su ${w}`);
        if (now.length !== remaining.length) { ok = false; break; }
      }
      if (ok) await checkDrawerEmpty('ridisegno');
    }],
    ['3 casella "not" spuntata, poi via tutte le scelte', async () => {
      await clearMap();
      const r = await addViaDrawer(WANTED);
      info(`Conferma -> ${JSON.stringify(stSdiParam(r.body)?.value)}`);
      const start = await expectChips(3, 'dopo la Conferma');
      if (start.length !== 3) return;
      const box = page.locator('td[id^="stSdi."] .negation-box input[type="checkbox"]').first();
      const from = LOG.length;
      await box.check();
      await sleep(800);
      info(`"not" spuntata · richieste [${actionsOf(LOG.slice(from))}]`);
      await check('"not" risulta spuntata', await box.isChecked());
      if (!(await removeAll('first', start))) return;
      await check('"not" ancora spuntata dopo le X (informativo sul ridisegno)', await box.isChecked().catch(() => false));
      await checkDrawerEmpty('ridisegno');
      const q = await execute();
      await check('Esegui: il Post non porta scelte di Stato SDI', !q.sent || q.sent.value === '', JSON.stringify(q.sent));
      await check('Esegui: il server non riporta Stato SDI fra i criteri', !/stato\s*sdi|statoSdi/i.test(q.sub), `criteri "${q.sub}"`);
      if (baseline) {
        await check('Esegui: stessi criteri della ricerca senza filtro', q.sub === baseline.sub, `"${q.sub}" vs "${baseline.sub}"`);
        await check('Esegui: stesso numero di record della ricerca senza filtro', q.cnt === baseline.cnt, `${q.cnt} vs ${baseline.cnt}`);
      }
      await backToMap();
      await expectChips(0, 'tornati alla mappa');
    }],
    ['4 filtro svuotato, Esegui, ritorno alla mappa', async () => {
      await clearMap();
      // controprova: con SCARTATO la ricerca e' davvero filtrata
      await addViaDrawer(['SCARTATO']);
      await expectChips(1, 'SCARTATO scelto');
      const f = await execute();
      // Sensibile se cambia la lista (criteri/record) o se non c'e' proprio
      // lista (nessun documento SCARTATO: la mappa resta col messaggio).
      const sensitive = !f.header || f.sub !== baseline?.sub || f.cnt !== baseline?.cnt;
      await check('controprova: con SCARTATO la ricerca e\' davvero filtrata', sensitive,
        `criteri "${f.sub}", record ${f.cnt} (senza filtro "${baseline?.sub}", ${baseline?.cnt})`);
      if (f.header) await backToMap();
      else await sleep(1000);
      await expectChips(1, 'tornati alla mappa con SCARTATO');
      const r = await removeChip('SCARTATO');
      await checkOnePost(r.reqs, 'X su SCARTATO');
      await expectChips(0, 'dopo la X su SCARTATO');
      const q = await execute();
      await check('Esegui: il Post non porta scelte di Stato SDI', !q.sent || q.sent.value === '', JSON.stringify(q.sent));
      await check('Esegui: una sola richiesta ExecuteQuery', q.reqs.filter((x) => x.action === 'ExecuteQuery').length === 1,
        `[${actionsOf(q.reqs)}]`);
      await check('Esegui: arriva la lista', !!q.header, q.msgs.join(' | '));
      await check('Esegui: il server non riporta Stato SDI fra i criteri', !/stato\s*sdi|statoSdi/i.test(q.sub), `criteri "${q.sub}"`);
      await check('Esegui: criteri uguali alla ricerca senza filtro', q.sub === baseline.sub, `"${q.sub}" vs "${baseline.sub}"`);
      await check('Esegui: stesso recordCount della ricerca senza filtro', q.cnt === baseline.cnt, `${q.cnt} vs ${baseline.cnt}`);
      await backToMap();
      await expectChips(0, 'tornati alla mappa');
      await checkDrawerEmpty('tornati alla mappa');
    }],
    ['5 una sola scelta, subito tolta', async () => {
      await clearMap();
      await addViaDrawer(['SCARTATO_DEST']);
      const start = await expectChips(1, 'dopo la Conferma');
      if (start.length !== 1) return;
      if (!(await removeAll('first', start))) return;
      await checkDrawerEmpty('ridisegno');
    }],
  ];

  for (const [name, fn] of cases) {
    if (!run(name.split(' ')[0]) && !run(name)) continue;
    current = name;
    console.log(`\n${current}`);
    try { await fn(); } catch (e) {
      await check('eccezione', false, e.message.split('\n')[0]);
    }
  }
  // Lascia la mappa pulita per chi viene dopo.
  try { if (await stsdi().count()) await clearMap(); } catch { /* niente */ }
} catch (e) {
  FAILED.push(`${current} · eccezione: ${e.message}`);
  console.log(`  FAIL eccezione: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

console.log(`\n${nPass} PASS, ${FAILED.length} FAIL — ${LOG.length} richieste in tutto`);
for (const f of FAILED) console.log('  - ' + f);
process.exit(FAILED.length ? 1 : 0);
