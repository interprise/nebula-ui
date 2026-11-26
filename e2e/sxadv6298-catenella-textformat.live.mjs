/**
 * SXADV-6298 — catenella (NavigateView) nelle colonne di lista TextFormat.
 *
 * Il difetto (tester): Fatt. attiva > «Fatture» > Ft. ven. 29 del 23/10/2026 >
 * tab «Reg. contabili» > rigo 205.04.01 > dettaglio > «Saldo contabile» >
 * catenella > «Schede Contabili - Lista». Nella colonna «Documento» il legacy
 * ha in ogni riga l'icona che apre il dettaglio del documento; in React niente.
 * Intervento richiesto: TRASVERSALE, tutte le colonne analoghe.
 *
 * Il contratto (legacy + correzione gia' fatta per le colonne di testo,
 * SXADV-5759.3), letto sulle risposte JSON di POST /entrasp/controller:
 *   1. una cella di LISTA il cui ViewItem ha contentViewName e un valore NON
 *      vuoto porta control.navigateView = { command, navpath, controlName };
 *      vale gia' per le colonne di testo, deve valere anche per quelle
 *      controlType="TextFormat" (tipo colonna "html" nel JSON);
 *   2. valore vuoto -> nessuna navigateView;
 *   3. per le stesse celle TextFormat contentClass/contentStyle del ViewItem
 *      (anche dinamici "?espressione") arrivano come control.cls/control.style,
 *      come per le colonne di testo;
 *   4. il testo mostrato non cambia;
 *   a schermo: nella cella la catenella (.list-cell-nav, la stessa delle colonne
 *   di testo); il clic apre il dettaglio di contentViewName; la briciola riporta
 *   indietro.
 *
 * Casi (azienda 02409720 C.N.A. SERVIZI MODENA, sede 000 - PROVINCIALE, utente 44AMM):
 *   A percorso della tester: Ft. ven. 29 del 23/10/2026, rigo 205.04.01 >
 *     schedeContabiliSingoleList, colonna «Documento» (TextFormat ->
 *     documentiDetail). Riferimento: colonna «Saldo contabile» del tab
 *     Reg. contabili (Text con contentViewName), che la catenella l'ha gia'.
 *   B stessa fattura, tab «Righe fattura» = docRigheCliList, colonna «Servizio»
 *     (TextFormat -> articoliVariantiDetail). Riferimento: «Sottoconto» (List
 *     con contentViewName), nel JSON. «Sottoconto» sta sulla BANDA di
 *     continuazione: catenella a video, clic (navpath della riga, option1 =
 *     controlName, riga non attivata) -> sottocontiDetail, ritorno. Impaginazione
 *     della banda: la cella con catenella sta nella colonna della sua etichetta
 *     di banda, la cella dopo non si sposta, l'icona sta dentro il riquadro della
 *     cella. Modalita' una-riga: l'icona della cella promossa e' visibile dentro
 *     la cella.
 *   D bersaglio nullo (legacy NavigateViewUIControl.renderLink): con navigateTo
 *     la catenella c'e' solo se la relazione della riga esiste. Fatture Sede >
 *     «Note proforma fatturabili» > «Sel. per riga» = docRigheCliNpfSelList,
 *     colonna TextFormat navigateTo="articoloVariante":
 *       - n. 876 del 01/08/2018 (anagrafica 25): righi NPF 10/11/12 senza
 *         articolo e con testo («Rimborso spese condominiali ...») -> nessuna
 *         catenella;
 *       - n. 493 del 06/11/2020 (anagrafica 6887): rigo CONFAVP con articolo ->
 *         catenella.
 *     Nel JSON il rigo con articolo si riconosce dal <br /> del codice
 *     ("{#articoloVariante.codiceEsterno##br#}#descrizioneArticoloStampa#").
 *   C Ordini Clienti > 24/00001 (l'unico ordine su ALFA per l'azienda), tab
 *     «Righe» = ordiniClientiRigheList, colonna «Articolo/Descrizione»
 *     (TextFormat, contentClass="?stileCapitolo": "bold" sul rigo capitolo C,
 *     null sugli articoli A). Riferimento: «Importo» (ExtMoney, stesso
 *     contentClass) e «Quantità» (Text, contentStyle).
 *
 * SOLA LETTURA sul DB di collaudo ALFA: mai Salva, Conferma, Cancella. Si
 * naviga, si apre e si torna con la briciola; in fondo «Annulla» se la sessione
 * risultasse sporca.
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv6298-catenella-textformat.live.mjs <link-monouso | host> [--headed] [--only A|B|C]
 *   - link monouso: http://127.0.0.47:<porta>/<token> (da `entrasp-sql
 *     --login-session 44AMM --to http://127.0.0.47:9080/entrasp/app/`, con
 *     inoltra.py avviato sulla porta: il server monouso ascolta solo su 127.0.0.1);
 *   - host (es. 127.0.0.47, default): lo script fa da se' login e inoltro.
 *   SHOTS=<cartella screenshot dei fallimenti>  PLAYWRIGHT_DIR=<node_modules con playwright>
 * Esce con 1 se almeno una verifica fallisce, 2 se non riesce a entrare.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync, readFileSync, openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function playwrightDir() {
  if (process.env.PLAYWRIGHT_DIR) return process.env.PLAYWRIGHT_DIR;
  const local = path.join(here, '../node_modules');
  if (existsSync(path.join(local, 'playwright'))) return local;
  const base = path.join(os.homedir(), '.npm/_npx');
  for (const d of existsSync(base) ? readdirSync(base) : []) {
    const nm = path.join(base, d, 'node_modules');
    if (existsSync(path.join(nm, 'playwright'))) return nm;
  }
  throw new Error('playwright non trovato: impostare PLAYWRIGHT_DIR');
}
const require = createRequire(playwrightDir().replace(/\/?$/, '/'));
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].toUpperCase() : null;
const POS = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only');
const TARGET = POS[0] || '127.0.0.47';
const USER = process.env.USER_LOGIN || '44AMM';
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'sxadv6298');
const SEDE = '000 - PROVINCIALE';
const FT_NUM = '29';
const FT_DATA = '23/10/2026';
const SOTTOCONTO = '205.04.01';
const ORDINE = '24/00001';
mkdirSync(SHOTS, { recursive: true });

// ─────────────────────────────────────────────────────────────────── esiti
const FAILED = [];
const NOTES = [];
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
const note = (t) => { NOTES.push(`${current.split(' ')[0]}: ${t}`); console.log(`  NOTA ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Testo come lo legge l'utente: <br/> = a capo, tag tolti, entita' minime. */
const asText = (v) => squash(String(v ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x20AC;/gi, '€'));

// ─────────────────────────────────────────────────────────────────── accesso

/** Link monouso: dato come argomento, oppure chiesto a entrasp-sql per l'host dato. */
async function loginLink() {
  if (/^https?:\/\//.test(TARGET)) return TARGET;
  const host = TARGET;
  const out = path.join(SHOTS, 'login-session.out');
  // Niente pipe ne' timeout attorno a --login-session: output su file, processo staccato.
  const fd = openSync(out, 'w');
  spawn('setsid', ['entrasp-sql', '--ws', 'ui-new', '--login-session', USER, '--to', `http://${host}:9080/entrasp/app/`],
    { detached: true, stdio: ['ignore', fd, fd] }).unref();
  let m = null;
  for (let i = 0; i < 60 && !m; i++) {
    await sleep(500);
    m = (existsSync(out) ? readFileSync(out, 'utf8') : '').match(/http:\/\/localhost:(\d+)\/([0-9a-f]{32})/);
  }
  if (!m) throw new Error('login-session non riuscito (vedi ' + out + ')');
  if (host !== 'localhost') {
    const fwd = ['/home/luca/ui-new/entrasp-ui/.claude/skills/verify/inoltra.py', path.join(here, '../.claude/skills/verify/inoltra.py')]
      .find((p) => existsSync(p));
    if (!fwd) throw new Error('inoltra.py non trovato');
    spawn('setsid', ['python3', fwd, host, m[1]], { detached: true, stdio: 'ignore' }).unref();
    await sleep(700);
  }
  return `http://${host}:${m[1]}/${m[2]}`;
}

// ─────────────────────────────────────────────── richieste e risposte JSON

/** Ogni POST verso controller/controller2: action, corpo, risposta JSON. */
const LOG = [];
function relaxedParse(text) {
  try { return JSON.parse(text); } catch { /* sotto */ }
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    return JSON.parse(t.replace(/'([^']*)'/g, (_m, s) => JSON.stringify(s))
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'));
  } catch { return null; }
}
function track(p) {
  p.on('request', (q) => {
    const u = new URL(q.url());
    if (q.method() !== 'POST' || !/\/controller2?$/.test(u.pathname)) return;
    const body = new URLSearchParams(q.postData() || '');
    const e = { t: Date.now(), action: body.get('action') || '?', body, json: null };
    LOG.push(e);
    q.response().then(async (r) => { if (r) e.json = relaxedParse(await r.text().catch(() => '')); }).catch(() => {});
  });
}
const actionsOf = (reqs) => reqs.map((r) => r.action).join(',');

async function quiet(ms = 1500, cap = 15000) {
  const t0 = Date.now();
  let lastLen = LOG.length;
  let lastChange = Date.now();
  while (Date.now() - t0 < cap) {
    await sleep(150);
    if (LOG.length !== lastLen) { lastLen = LOG.length; lastChange = Date.now(); }
    if (Date.now() - lastChange >= ms && LOG.every((e) => e.json !== null || Date.now() - e.t > 60000 || e.action === 'JSONProgress')) break;
  }
}

async function withRequest(actionName, act, timeout = 60000) {
  const from = LOG.length;
  const respP = page.waitForResponse((r) => {
    if (!/\/controller2?$/.test(new URL(r.url()).pathname)) return false;
    return new URLSearchParams(r.request().postData() || '').get('action') === actionName;
  }, { timeout });
  respP.catch(() => {});
  await act();
  const resp = await respP;
  await quiet();
  return { reqs: LOG.slice(from), body: new URLSearchParams(resp.request().postData() || '') };
}

/** Oggetti con viewName = `view` e righe (ui di pagina, o detailView incorporata). */
function listObjects(json, view) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.viewName === view && Array.isArray(o.rows) && Array.isArray(o.columns)) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(json);
  return out;
}

/**
 * L'ultima resa della lista `view` vista dal client: colonne dall'ultima risposta
 * che le porta, righe dall'ultima risposta (anche pageOnly di SetPageSize) dopo di essa.
 */
function lastList(view, from = 0) {
  let idx = -1;
  let obj = null;
  for (let i = LOG.length - 1; i >= from; i--) {
    const l = listObjects(LOG[i].json, view);
    if (l.length) { idx = i; obj = l[l.length - 1]; break; }
  }
  if (!obj) return null;
  let rows = obj.rows;
  for (let i = idx + 1; i < LOG.length; i++) {
    const j = LOG[i].json;
    if (j?.ui?.pageOnly && Array.isArray(j.ui.rows)) rows = j.ui.rows;
  }
  return { columns: obj.columns, rows, path: obj.path };
}

const colIndex = (list, name) => list.columns.findIndex((c) => c?.control?.name === name);
/** Righe primarie (quelle col percorso del record), con la cella della colonna `idx`. */
const primaryCells = (list, idx) => list.rows
  .filter((r) => r?.props?.path && r.cls !== 'breakRow')
  .map((r) => ({ path: r.props.path, cell: r.cells?.[idx], row: r }));
const ctlValue = (c) => c?.control?.displayValue ?? c?.control?.value;
const nonEmpty = (v) => v != null && String(v).trim() !== '';
const navOk = (nav, rowPath) => !!nav && typeof nav === 'object'
  && nonEmpty(nav.command) && nonEmpty(nav.controlName) && nonEmpty(nav.navpath)
  && (!rowPath || nav.navpath === rowPath);
const fmtNav = (nav) => (nav ? JSON.stringify(nav) : 'assente');

// ───────────────────────────────────────────────────── letture della pagina

const crumbsText = async () =>
  (await page.locator('.ant-breadcrumb a, .ant-breadcrumb span[title]').allInnerTexts()).map(squash).filter(Boolean);
const crumbLink = (re) => page.locator('.ant-breadcrumb a').filter({ hasText: re }).first();
const topButton = (label) => page.locator('button').filter({ hasText: new RegExp(`^${label}$`) }).first();
const annullaEnabled = () => topButton('Annulla').isEnabled().catch(() => false);
const anyModal = () => page.locator('.ant-modal:visible').last();
const titleText = async () => squash(await page.locator('text=/ - (Lista|Dettaglio)$/').first().innerText().catch(() => ''));

/** Celle visibili della colonna `colId` (righe AG Grid nel contenitore centrale, griglia visibile). */
async function gridCells(colId, scope = page) {
  return scope.locator(`.ag-center-cols-container .ag-row:visible .ag-cell[col-id="${colId}"]`);
}
async function cellsInfo(colId, scope = page) {
  const cells = await gridCells(colId, scope);
  return cells.evaluateAll((els) => els.map((e) => ({
    text: (e.innerText || '').replace(/\s+/g, ' ').trim(),
    nav: !!e.querySelector('.list-cell-nav .nav-icon'),
    cls: e.className,
    rowIndex: e.closest('.ag-row')?.getAttribute('row-index'),
  })));
}
/** col-id dell'intestazione con quel testo (nella griglia visibile). */
async function colIdByHeader(text) {
  const h = page.locator('.ag-header-cell:visible').filter({ hasText: new RegExp(`^\\s*${text}\\s*`) }).first();
  return h.getAttribute('col-id', { timeout: 5000 }).catch(() => null);
}

// ───────────────────────────────────────────────────────────────── percorso

async function ensureSede() {
  const sel = page.locator('.header-select').nth(1);
  const now = squash(await sel.innerText());
  if (now.includes(SEDE)) { info(`sede gia' ${SEDE}`); return; }
  info(`sede ${now} -> ${SEDE}`);
  await sel.click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: SEDE }).first().click();
  await quiet(2500);
  await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  if (!squash(await page.locator('.header-select').nth(1).innerText()).includes(SEDE)) throw new Error('cambio sede non riuscito');
}

/** Voce di menu per id; se chiede «modifiche non salvate», OK (non c'e' nulla di nostro da salvare). */
async function menuClick(query, menuIdSuffix) {
  const search = page.getByPlaceholder('Cerca nel menu...');
  await search.click();
  await search.fill(query);
  const item = page.locator(`li[data-menu-id$="${menuIdSuffix}"]`).first();
  await item.waitFor({ timeout: 10000 });
  await withRequest('ExecuteMenuItem', () => item.click());
  await sleep(300);
  if (await anyModal().isVisible().catch(() => false)) {
    info(`menu: finestra «${squash(await anyModal().innerText()).slice(0, 80)}», OK`);
    await withRequest('ExecuteMenuItem', () => anyModal().locator('button').filter({ hasText: /^OK$/ }).last().click());
  }
}

/** Fatture > Numero 29 > Esegui > rigo Ft. ven. 29 del 23/10/2026 > dettaglio. */
async function openFattura() {
  await menuClick('Fatture', 'menu.documenti.FA');
  const num = page.locator('td[id^="numDocDa."] input').first();
  await num.waitFor({ timeout: 20000 });
  await num.fill(FT_NUM);
  await num.press('Tab');
  await quiet(800);
  await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
  // Tipo doc. e Prot. stanno nelle colonne fissate a sinistra: la riga si riconosce
  // dalla data (al centro) e da «Ft. ven. 29» (a sinistra, stesso row-index).
  const dated = page.locator('.ag-center-cols-container .ag-row').filter({ hasText: FT_DATA });
  await dated.first().waitFor({ timeout: 20000 });
  let rowIdx = null;
  for (const idx of await dated.evaluateAll((els) => els.map((e) => e.getAttribute('row-index')))) {
    const left = squash(await page.locator(`.ag-pinned-left-cols-container .ag-row[row-index="${idx}"]`).first().innerText().catch(() => ''));
    const mid = squash(await page.locator(`.ag-center-cols-container .ag-row[row-index="${idx}"]`).first().innerText().catch(() => ''));
    if (/Ft\. ven\./.test(left + ' ' + mid) && new RegExp(`(^|\\s)${FT_NUM}(\\s|$)`).test(`${left} ${mid}`)) { rowIdx = idx; break; }
  }
  if (rowIdx === null) throw new Error(`nella lista nessuna Ft. ven. ${FT_NUM} del ${FT_DATA}`);
  const row = page.locator(`.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`).first();
  await withRequest('NavigateDetail', () => row.click());
  await page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. contabili' }).first().waitFor({ timeout: 20000 });
  const n = await page.locator('td.content-cell[id^="numDoc"] input').first().inputValue({ timeout: 3000 }).catch(() => null);
  info(`aperta la fattura: Num. doc. ${n}`);
  if (n !== null && n.trim() !== FT_NUM) throw new Error(`aperta la fattura n. ${n}, attesa ${FT_NUM}`);
}

async function changeTab(label) {
  await withRequest('ChangeTab', () => page.locator('.ant-tabs-tab').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click());
  await page.locator('.ag-header:visible').first().waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(400);
}

/** Apre la riga (freccia «Apri dettaglio» nella colonna fissata a sinistra). */
async function openRowDetail(textRe) {
  const r = page.locator('.ag-center-cols-container .ag-row:visible').filter({ hasText: textRe }).first();
  await r.waitFor({ timeout: 15000 });
  const idx = await r.getAttribute('row-index');
  const sel = page.locator(`.ag-pinned-left-cols-container .ag-row[row-index="${idx}"]:visible .selector-nav`).first();
  await withRequest('NavigateDetail', () => sel.click());
}

async function cleanup() {
  try {
    for (let k = 0; k < 3 && await anyModal().isVisible().catch(() => false); k++) {
      info(`pulizia: finestra «${squash(await anyModal().innerText()).slice(0, 80)}», Annulla/OK`);
      const b = anyModal().locator('button').filter({ hasText: /^(Annulla|OK)$/ }).first();
      await b.click().catch(() => {});
      await quiet(1000);
    }
    if (await annullaEnabled()) {
      info('pulizia: sessione sporca, «Annulla» in alto');
      await withRequest('Cancel', () => topButton('Annulla').click()).catch(() => {});
    }
  } catch (e) { info(`pulizia non riuscita: ${e.message.split('\n')[0]}`); }
}

// ─────────────────────────────────────────────────── verifiche riutilizzate

/**
 * JSON: ogni rigo primario della colonna `name` con valore ha navigateView del
 * rigo; quelli vuoti no. `label` per i messaggi. Ritorna i righi.
 */
async function checkNavJson(label, list, name, { expectNav = true } = {}) {
  const idx = colIndex(list, name);
  if (!(await check(`${label}: colonna «${name}» presente nella resa della lista`, idx >= 0,
    list.columns.map((c) => c?.control?.name).join(' | ')))) return [];
  const rows = primaryCells(list, idx);
  const full = rows.filter((r) => nonEmpty(ctlValue(r.cell)));
  const empty = rows.filter((r) => !nonEmpty(ctlValue(r.cell)));
  info(`${label}: ${rows.length} righi, ${full.length} con valore, ${empty.length} vuoti; tipo colonna ${list.columns[idx]?.control?.type}`);
  if (expectNav) {
    const bad = full.filter((r) => !navOk(r.cell?.control?.navigateView, r.path));
    await check(`${label}: ogni cella «${name}» con valore porta control.navigateView {command, navpath del rigo, controlName}`,
      full.length > 0 && bad.length === 0,
      full.length === 0 ? 'nessun rigo con valore' : `${bad.length}/${full.length} senza: ${bad.slice(0, 3).map((r) => `${r.path} «${asText(ctlValue(r.cell))}» nav=${fmtNav(r.cell?.control?.navigateView)}`).join('; ')}`);
    if (full[0]?.cell?.control?.navigateView) info(`${label}: navigateView del primo rigo ${fmtNav(full[0].cell.control.navigateView)}`);
  }
  if (empty.length) {
    const wrong = empty.filter((r) => r.cell?.control?.navigateView);
    await check(`${label}: le celle «${name}» vuote NON portano navigateView`, wrong.length === 0,
      wrong.map((r) => r.path).join(', '));
  } else {
    note(`«${name}»: nessun rigo con valore vuoto, il caso «vuoto -> niente catenella» qui non si esercita`);
  }
  return rows;
}

/** A schermo: catenella in ogni cella con testo della colonna, testo = valore JSON. */
async function checkNavScreen(label, colId, rows, { expectNav = true } = {}) {
  const cells = await cellsInfo(colId);
  const withText = cells.filter((c) => c.text);
  info(`${label}: a video ${cells.length} celle in ${colId}, ${withText.length} con testo, ${cells.filter((c) => c.nav).length} con catenella`);
  if (expectNav) {
    await check(`${label}: a video la catenella (.list-cell-nav) in ogni cella con testo`,
      withText.length > 0 && withText.every((c) => c.nav),
      `${withText.filter((c) => !c.nav).length}/${withText.length} senza: ${withText.filter((c) => !c.nav).slice(0, 3).map((c) => `«${c.text}»`).join(', ')}`);
  }
  const empties = cells.filter((c) => !c.text);
  if (empties.length) await check(`${label}: a video nessuna catenella nelle celle vuote`, empties.every((c) => !c.nav));
  // testo invariato: quello che si legge = il valore che il server manda
  const expected = rows.map((r) => asText(ctlValue(r.cell))).filter(Boolean);
  const shown = withText.map((c) => c.text);
  const missing = expected.filter((t) => !shown.includes(t));
  await check(`${label}: il testo a video e' il valore del server (nessun testo cambiato o perso)`,
    missing.length === 0 && shown.length >= expected.length,
    `mancano ${JSON.stringify(missing.slice(0, 3))}; a video ${JSON.stringify(shown.slice(0, 3))}`);
  return cells;
}

/** Clic sulla catenella della cella `rowIndex` della colonna `colId`. */
async function clickCellNav(colId, rowIndex) {
  const icon = page.locator(`.ag-center-cols-container .ag-row[row-index="${rowIndex}"]:visible .ag-cell[col-id="${colId}"] .list-cell-nav .nav-icon`).first();
  const from = LOG.length;
  await icon.click();
  await quiet(2000, 30000);
  return LOG.slice(from);
}

/**
 * Misure a video, nella griglia visibile: per ogni testo il riquadro del testo
 * (Range sul nodo di testo), l'etichetta d'intestazione (foglia con quel testo
 * esatto dentro .ag-header), e per `navText` l'icona della catenella della sua
 * riga e il riquadro della cella = il contenitore piu' piccolo che ha testo e
 * icona ma non il testo della cella dopo (`nextText`).
 */
async function measureBand(navText, nextText, navLabel, nextLabel, refText, refLabel) {
  return page.evaluate(({ navText, nextText, navLabel, nextLabel, refText, refLabel }) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const grid = [...document.querySelectorAll('.ag-root-wrapper')].find(vis);
    if (!grid) return { err: 'nessuna griglia visibile' };
    const textNode = (txt) => {
      const w = document.createTreeWalker(grid.querySelector('.ag-body') || grid, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.textContent.replace(/\s+/g, ' ').trim().includes(txt) && vis(n.parentElement)) return n;
      }
      return null;
    };
    const textBox = (n) => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    // Etichette: intestazione AG Grid o riga delle etichette di banda, nel contenitore
    // della griglia visibile; si misura il NODO DI TESTO (come per le celle) e il box.
    const scope = grid.closest('.list-container') || grid.parentElement || document.body;
    const label = (txt) => {
      for (const e of scope.querySelectorAll('*')) {
        if (!vis(e) || e.closest('.ag-body, .ag-center-cols-container, .ag-full-width-container')) continue;
        const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() === txt);
        if (!tn) continue;
        const t = textBox(tn);
        const r = e.getBoundingClientRect();
        return { left: t.left, right: t.right, boxLeft: r.left, boxRight: r.right };
      }
      return null;
    };
    const nav = textNode(navText);
    const next = textNode(nextText);
    const ref = textNode(refText);
    if (!nav || !next || !ref) return { err: `testo non trovato: ${!nav ? navText : !next ? nextText : refText}` };
    const row = nav.parentElement.closest('.ag-row');
    const icon = row?.querySelector('.list-cell-nav .nav-icon');
    let cell = null;
    if (icon) {
      for (let a = nav.parentElement; a && a !== row; a = a.parentElement) {
        if (a.contains(icon) && !a.contains(next)) cell = a; else if (a.contains(next)) break;
      }
    }
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    // l'icona si vede davvero: al suo centro c'e' l'icona (o un suo figlio)
    let iconOnTop = null;
    if (icon) {
      const b = icon.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      iconOnTop = !!hit && (hit === icon || icon.contains(hit));
    }
    return {
      navText: textBox(nav), nextText: textBox(next), refText: textBox(ref),
      navLabel: label(navLabel), nextLabel: label(nextLabel), refLabel: label(refLabel),
      icon: box(icon), cell: box(cell), iconOnTop,
    };
  }, { navText, nextText, navLabel, nextLabel, refText, refLabel });
}

async function requestsDuring(act, ms = 1500) {
  const from = LOG.length;
  await act();
  await quiet(ms);
  return LOG.slice(from);
}

const px = (n) => (n == null ? 'n/d' : Math.round(n * 10) / 10);
const inside = (a, b, tol = 1) => !!a && !!b && a.left >= b.left - tol && a.right <= b.right + tol && a.top >= b.top - tol && a.bottom <= b.bottom + tol;

/**
 * Banda di continuazione di Righe fattura: la cella con catenella («Sottoconto»)
 * sta nella colonna della sua etichetta di banda, la cella dopo («IVA») non si
 * sposta, l'icona sta dentro il riquadro della cella. Lo scarto fra testo ed
 * etichetta si tara sulla prima banda («Servizio»: testo della cella contro la
 * sua intestazione), che la catenella ce l'ha nella sua colonna di AG Grid.
 */
async function checkBandLayout(sottoText, ivaText) {
  const m = await measureBand(sottoText, ivaText, 'Sottoconto', 'IVA', '0011', 'Servizio');
  if (!(await check('banda: misure a video leggibili', !m.err && m.navLabel && m.nextLabel && m.refLabel,
    m.err || `etichette: Sottoconto ${!!m.navLabel}, IVA ${!!m.nextLabel}, Servizio ${!!m.refLabel}`))) return;
  const calib = m.refText.left - m.refLabel.left;
  const dSotto = m.navText.left - m.navLabel.left;
  const dIva = m.nextText.left - m.nextLabel.left;
  info(`banda: scarto testo-etichetta prima banda ${px(calib)}; Sottoconto ${px(dSotto)}; IVA ${px(dIva)}; cella [${px(m.cell?.left)}, ${px(m.cell?.right)}], etichette Sottoconto ${px(m.navLabel.left)} IVA ${px(m.nextLabel.left)}; icona [${px(m.icon?.left)}, ${px(m.icon?.right)}]`);
  await check('banda: la cella con catenella parte dove la sua etichetta di banda («Sottoconto»)', Math.abs(dSotto - calib) <= 3,
    `scarto ${px(dSotto)} contro ${px(calib)} della prima banda`);
  await check('banda: la cella dopo («IVA 22%») resta sotto la sua etichetta (non si sposta)', Math.abs(dIva - calib) <= 3,
    `scarto ${px(dIva)} contro ${px(calib)} della prima banda`);
  await check('banda: il riquadro della cella con catenella coincide con quello della sua etichetta di banda (stessa posizione e larghezza)',
    !!m.cell && Math.abs(m.cell.left - m.navLabel.boxLeft) <= 2 && Math.abs(m.cell.right - m.navLabel.boxRight) <= 2,
    `cella [${px(m.cell?.left)}, ${px(m.cell?.right)}], etichetta «Sottoconto» [${px(m.navLabel.boxLeft)}, ${px(m.navLabel.boxRight)}]`);
  await check('banda: la cella con catenella finisce dove comincia la colonna dopo',
    !!m.cell && Math.abs(m.cell.right - m.nextLabel.boxLeft) <= 2 && m.cell.right <= m.nextText.left + 1,
    `cella fino a ${px(m.cell?.right)}, colonna IVA da ${px(m.nextLabel.boxLeft)}, testo IVA da ${px(m.nextText.left)}`);
  await check('banda: l\'icona sta dentro il riquadro della cella', inside(m.icon, m.cell),
    `icona ${JSON.stringify(m.icon)} cella ${JSON.stringify(m.cell)}`);
  await check('banda: l\'icona non sconfina nella cella dopo', !!m.icon && m.icon.right <= m.nextText.left, `${px(m.icon?.right)} > ${px(m.nextText.left)}`);
  await check('banda: l\'icona si vede (non coperta)', m.iconOnTop === true);
}

/**
 * Modalita' una-riga sulla lista visibile (pulsante «Riduce layout»): la cella
 * promossa con catenella mostra l'icona dentro il proprio riquadro (.ag-cell),
 * non sotto e non tagliata; poi si torna al layout di prima.
 */
async function checkOneLine(sottoText) {
  const btn = page.locator('button[aria-label="Riduce layout"]:visible').first();
  if (!(await btn.count())) { note('pulsante una-riga non presente su Righe fattura: non esercitato'); return; }
  await requestsDuring(() => btn.click(), 1200);
  await sleep(800);
  try {
    // le colonne promosse stanno a destra: si scorre in orizzontale finche' AG Grid
    // non disegna la cella (virtualizzazione delle colonne)
    const cell = page.locator('.ag-row:visible .ag-cell').filter({ hasText: sottoText }).first();
    const hs = page.locator('.ag-body-horizontal-scroll-viewport:visible').first();
    for (let k = 0; k < 20 && !(await cell.count()); k++) {
      await hs.evaluate((e) => { e.scrollLeft += 300; }).catch(() => {});
      await sleep(250);
    }
    if (!(await check('una-riga: il Sottoconto e\' una cella di colonna', (await cell.count()) > 0))) return;
    await cell.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    const r = await cell.evaluate((c) => {
      const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
      const icon = c.querySelector('.list-cell-nav .nav-icon');
      const ib = icon?.getBoundingClientRect();
      const hit = ib ? document.elementFromPoint(ib.left + ib.width / 2, ib.top + ib.height / 2) : null;
      return { cell: box(c), icon: box(icon), onTop: !!icon && !!hit && (hit === icon || icon.contains(hit)) };
    });
    info(`una-riga: cella ${JSON.stringify(r.cell)} icona ${JSON.stringify(r.icon)}`);
    await check('una-riga: la cella promossa ha l\'icona catenella', !!r.icon);
    await check('una-riga: l\'icona ha dimensioni (non tagliata a zero)', !!r.icon && r.icon.w >= 8 && r.icon.h >= 8, JSON.stringify(r.icon));
    await check('una-riga: l\'icona sta dentro il riquadro della cella (non sotto, non tagliata)', inside(r.icon, r.cell),
      `icona ${JSON.stringify(r.icon)} cella ${JSON.stringify(r.cell)}`);
    await check('una-riga: l\'icona si vede (al suo centro c\'e\' l\'icona)', r.onTop === true);
  } finally {
    const back = page.locator('button[aria-label="Ingrandisce layout"]:visible').first();
    if (await back.count()) { await requestsDuring(() => back.click(), 1200); info('una-riga: layout ripristinato'); }
  }
}

/** Fatture Sede > numero + data > (dettaglio diretto se unico) > Note proforma fatturabili > Sel. per riga. */
async function openNpfRighe(num, data) {
  await menuClick('Fatture Sede', 'menu.documenti.VEN01');
  const n = page.locator('td[id^="numDocDa."] input').first();
  await n.waitFor({ timeout: 20000 });
  await n.fill(num);
  await n.press('Tab');
  const dd = page.locator('td[id^="dataDoc."] input').first();
  await dd.click();
  await dd.fill(data);
  await dd.press('Enter');
  await sleep(400);
  await page.keyboard.press('Escape').catch(() => {});
  await quiet(800);
  await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
  const tab = page.locator('.ant-tabs-tab').filter({ hasText: 'Sel. per riga' }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    const row = page.locator('.ag-center-cols-container .ag-row').filter({ hasText: data }).first();
    await withRequest('NavigateDetail', () => row.click());
  }
  const nd = await page.locator('td.content-cell[id^="numDoc"] input').first().inputValue({ timeout: 5000 }).catch(() => null);
  if (nd !== null && nd.trim() !== num) throw new Error(`aperto il documento ${nd}, atteso ${num}`);
  await tab.waitFor({ timeout: 15000 });
  await withRequest('ChangeTab', () => tab.click());
  await page.locator('.ag-header:visible').filter({ hasText: 'Descrizione/articolo' }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await quiet(1500);
  return lastList('docRigheCliNpfSelList');
}

// ─────────────────────────────────────────────────────────────────── casi

const cases = [
  ['A percorso della tester: Schede Contabili - Lista, colonna «Documento»', async () => {
    await openFattura();
    await changeTab('Reg. contabili');
    // Riferimento: «Saldo contabile» (Text + contentViewName) nella lista Reg. contabili
    const reg = lastList('docRegContabiliMultiEditList');
    if (await check('riferimento: lista Reg. contabili nella risposta', !!reg)) {
      await checkNavJson('riferimento Reg. contabili', reg, 'totSchedaContabile');
      const idx = colIndex(reg, 'totSchedaContabile');
      const st = primaryCells(reg, idx).map((r) => r.cell?.control?.style);
      await check('riferimento Reg. contabili: contentStyle della colonna di testo arriva come control.style',
        st.length > 0 && st.every((s) => /text-align:\s*right/.test(s || '')), JSON.stringify(st));
      const cells = await cellsInfo(`col_${idx}`);
      await check('riferimento Reg. contabili: a video la catenella in ogni «Saldo contabile»',
        cells.length > 0 && cells.filter((c) => c.text).every((c) => c.nav), JSON.stringify(cells.map((c) => [c.text, c.nav])));
    }
    // rigo 205.04.01 > dettaglio > catenella del Saldo contabile
    await openRowDetail(new RegExp(SOTTOCONTO.replace(/\./g, '\\.')));
    await page.locator('td[id^="totSchedaContabile."] .nav-icon').first().waitFor({ timeout: 15000 });
    const from = LOG.length;
    await page.locator('td[id^="totSchedaContabile."] .nav-icon').first().click();
    // VisualizzaSchedaContabile e' un job asincrono: la lista arriva con JSONProgress
    const t0 = Date.now();
    let list = null;
    while (Date.now() - t0 < 120000 && !(list = lastList('schedeContabiliSingoleList', from))) await sleep(500);
    await quiet(2000, 20000);
    list = lastList('schedeContabiliSingoleList', from) || list;
    info(`richieste [${actionsOf(LOG.slice(from)).replace(/(JSONProgress,)+/g, 'JSONProgress*,')}] in ${Date.now() - t0} ms`);
    if (!(await check('la catenella del Saldo contabile apre schedeContabiliSingoleList', !!list))) return;
    await page.locator('.ag-header-cell:visible').filter({ hasText: 'Documento' }).first().waitFor({ timeout: 20000 });
    info(`catenella: ${JSON.stringify(await crumbsText())}`);

    const idx = colIndex(list, '#descrizioneBreve# #numDoc# del #dataDoc#');
    await check('colonna Documento: tipo "html" (TextFormat) nel JSON', list.columns[idx]?.control?.type === 'html',
      JSON.stringify(list.columns[idx]?.control));
    const rows = await checkNavJson('Schede Contabili', list, '#descrizioneBreve# #numDoc# del #dataDoc#');
    const odd = rows.filter((r) => nonEmpty(ctlValue(r.cell)) && !/^.+ \S+ del \d\d\/\d\d\/\d{4}$/.test(asText(ctlValue(r.cell))));
    await check('Schede Contabili: il testo di «Documento» resta "<tipo> <num> del <data>"', odd.length === 0,
      odd.map((r) => ctlValue(r.cell)).join(' | '));
    const colId = await colIdByHeader('Documento') || `col_${idx}`;
    info(`colonna Documento a video: ${colId}`);
    const cells = await checkNavScreen('Schede Contabili', colId, rows);
    const crumbsList = await crumbsText();

    // clic sulla catenella del rigo «Ft. ven. 29 del 23/10/2026» se c'e' (oggi no: la
    // fattura e' provvisoria), altrimenti della prima fattura di vendita, altrimenti del primo rigo
    const target = cells.find((c) => c.nav && c.text.includes(`${FT_NUM} del ${FT_DATA}`))
      || cells.find((c) => c.nav && /^Ft\. ven\./.test(c.text)) || cells.find((c) => c.nav);
    if (!(await check('Schede Contabili: c\'e\' una catenella da cliccare', !!target))) return;
    const want = target.text.match(/(\S+) del (\d\d\/\d\d\/\d{4})$/);
    info(`clic sulla catenella di «${target.text}» (row-index ${target.rowIndex})`);
    const reqs = await clickCellNav(colId, target.rowIndex);
    const navReq = reqs.find((r) => /Navigate/.test(r.action));
    info(`richieste [${actionsOf(reqs)}] ${navReq ? `navpath=${navReq.body.get('navpath')} option1=${navReq.body.get('option1')}` : ''}`);
    const det = reqs.map((r) => r.json).reverse().find((j) => j?.template?.viewName || j?.ui?.viewName);
    const vn = det?.template?.viewName || det?.ui?.viewName;
    await check('clic: si apre documentiDetail (contentViewName della colonna)', vn === 'documentiDetail', `viewName ${vn}`);
    const nd = await page.locator('td.content-cell[id^="numDoc"] input').first().inputValue({ timeout: 5000 }).catch(() => null);
    const hasDate = await page.locator('input').evaluateAll((els, d) => els.some((e) => e.value === d), want?.[2]).catch(() => false);
    await check(`clic: a video il documento del rigo (n. ${want?.[1]} del ${want?.[2]})`, nd?.trim() === want?.[1] && hasDate,
      `Num. doc. ${nd}, data ${hasDate ? 'presente' : 'assente'}`);
    await check('clic: la catenella ha la briciola «Schede Contabili - Lista»', !!(await crumbLink(/Schede Contabili - Lista/).count()),
      JSON.stringify(await crumbsText()));
    // ritorno
    const back = await withRequest('BackTo', () => crumbLink(/Schede Contabili - Lista/).click()).catch((e) => ({ err: e }));
    await check('ritorno: la briciola manda BackTo', !back.err, back.err?.message);
    await sleep(500);
    await check('ritorno: nessuna domanda', !(await anyModal().isVisible().catch(() => false)));
    await check('ritorno: di nuovo «Schede Contabili - Lista», stessa catenella', JSON.stringify(await crumbsText()) === JSON.stringify(crumbsList),
      `${JSON.stringify(await crumbsText())} vs ${JSON.stringify(crumbsList)}`);
    const again = (await cellsInfo(colId)).map((c) => c.text);
    await check('ritorno: la lista mostra gli stessi documenti', JSON.stringify(again) === JSON.stringify(cells.map((c) => c.text)),
      JSON.stringify(again.slice(0, 3)));
  }],

  ['B stessa fattura, «Righe fattura» = docRigheCliList, colonna «Servizio»', async () => {
    await openFattura();
    await changeTab('Righe fattura');
    const list = lastList('docRigheCliList');
    if (!(await check('lista Righe fattura nella risposta', !!list))) return;
    // Riferimento: Sottoconto (List + contentViewName), sul secondo rigo di banda del record
    const sIdx = list.rows.findIndex((r) => (r.cells || []).some((c) => c?.control?.navigateView?.controlName === 'sottoconto'));
    const sotto = sIdx >= 0 ? list.rows[sIdx].cells.find((c) => c?.control?.navigateView?.controlName === 'sottoconto') : null;
    await check('riferimento: la cella «Sottoconto» (List con contentViewName) porta navigateView', !!sotto,
      'nessuna cella sottoconto con navigateView');
    if (sotto) info(`riferimento Sottoconto: «${sotto.control.displayValue}» ${fmtNav(sotto.control.navigateView)}`);
    const name = '#articoloVariante.codiceEsterno# #articoloVariante.descrizioneBiLiHtml#';
    const idx = colIndex(list, name);
    await check('colonna Servizio: tipo "html" (TextFormat) nel JSON', list.columns[idx]?.control?.type === 'html',
      JSON.stringify(list.columns[idx]?.control));
    const rows = await checkNavJson('Righe fattura', list, name);
    const first = rows.find((r) => nonEmpty(ctlValue(r.cell)));
    await check('Righe fattura: il testo di «Servizio» del rigo 1 resta «0011 LIBRO UNICO DEL LAVORO»',
      asText(ctlValue(first?.cell)) === '0011 LIBRO UNICO DEL LAVORO', JSON.stringify(ctlValue(first?.cell)));
    const colId = await colIdByHeader('Servizio') || `col_${idx}`;
    info(`colonna Servizio a video: ${colId}`);
    const cells = await checkNavScreen('Righe fattura', colId, rows);
    // Sottoconto sta sulla banda di continuazione del record (riga a tutta larghezza):
    // la catenella c'e' come nella prima banda; il clic manda il comando col percorso
    // della RIGA e option1 = controlName, senza attivare la riga; poi si torna.
    if (sotto) {
      const recPath = list.rows.slice(0, sIdx).reverse().find((r) => r?.props?.path)?.props?.path;
      const band = page.locator('.ag-row:visible').filter({ hasText: String(sotto.control.displayValue) }).first();
      const nIcons = await band.locator('.list-cell-nav .nav-icon').count();
      if (await check('banda di continuazione: a video la catenella su «Sottoconto»', nIcons === 1, `${nIcons} icone sulla banda`)) {
        await checkBandLayout(String(sotto.control.displayValue), 'IVA 22%');
        const crumbsBefore = await crumbsText();
        const from = LOG.length;
        await band.locator('.list-cell-nav .nav-icon').first().click();
        await quiet(2000, 30000);
        const reqs = LOG.slice(from);
        const cmd = sotto.control.navigateView.command;
        const nav = reqs.find((r) => r.action === cmd);
        info(`clic banda: richieste [${actionsOf(reqs)}] ${nav ? `navpath=${nav.body.get('navpath')} option1=${nav.body.get('option1')}` : ''}`);
        await check(`banda: il clic manda ${cmd} con navpath del record (${recPath}) e option1=sottoconto`,
          !!nav && nav.body.get('navpath') === recPath && nav.body.get('option1') === 'sottoconto',
          nav ? `navpath=${nav.body.get('navpath')} option1=${nav.body.get('option1')}` : `nessuna; [${actionsOf(reqs)}]`);
        await check('banda: il clic non attiva la riga (nessun NavigateDetail, nessun pannello)',
          !reqs.some((r) => r.action === 'NavigateDetail') && !(await page.locator('.edit-panel:visible').count()), `[${actionsOf(reqs)}]`);
        const det = reqs.map((r) => r.json).reverse().find((j) => j?.template?.viewName || j?.ui?.viewName);
        const vn = det?.template?.viewName || det?.ui?.viewName;
        await check('banda: si apre sottocontiDetail (contentViewName di «Sottoconto»)', vn === 'sottocontiDetail', `viewName ${vn}`);
        await check('banda: a video il sottoconto 205.04.01',
          (await page.locator('input').evaluateAll((els) => els.some((e) => /205\.04\.01/.test(e.value))).catch(() => false))
          || (await page.getByText('205.04.01', { exact: false }).count()) > 0);
        if (vn && vn !== 'documentiDetail') {
          const back = await withRequest('BackTo', () => crumbLink(/Fatture - Dettaglio/).click()).catch((e) => ({ err: e }));
          await check('banda: ritorno con la briciola «Fatture - Dettaglio» (BackTo)', !back.err, back.err?.message);
          await sleep(500);
          await check('banda: ritorno senza domande', !(await anyModal().isVisible().catch(() => false)));
          await check('banda: dopo il ritorno, catenella come prima', JSON.stringify(await crumbsText()) === JSON.stringify(crumbsBefore),
            `${JSON.stringify(await crumbsText())} vs ${JSON.stringify(crumbsBefore)}`);
          await page.locator('.ag-row:visible').filter({ hasText: String(sotto.control.displayValue) }).first()
            .waitFor({ timeout: 15000 }).catch(() => {});
          await check('banda: dopo il ritorno, «Righe fattura» mostra di nuovo il rigo',
            (await page.locator('.ag-row:visible').filter({ hasText: String(sotto.control.displayValue) }).count()) > 0);
        }
      }
    }

    const target = cells.find((c) => c.nav);
    if (!(await check('Righe fattura: c\'e\' una catenella da cliccare in «Servizio»', !!target))) return;
    const crumbsBefore = await crumbsText();
    const reqs = await clickCellNav(colId, target.rowIndex);
    const det = reqs.map((r) => r.json).reverse().find((j) => j?.template?.viewName || j?.ui?.viewName);
    const vn = det?.template?.viewName || det?.ui?.viewName;
    info(`richieste [${actionsOf(reqs)}] -> ${vn}`);
    await check('clic: si apre articoliVariantiDetail (contentViewName della colonna)', vn === 'articoliVariantiDetail', `viewName ${vn}`);
    await check('clic: a video l\'articolo 0011', (await page.locator('input').evaluateAll((els) => els.some((e) => /^0011$/.test(e.value.trim()))).catch(() => false))
      || (await page.getByText('0011', { exact: false }).count()) > 0);
    const back = await withRequest('BackTo', () => crumbLink(/Fatture - Dettaglio/).click()).catch((e) => ({ err: e }));
    await check('ritorno: la briciola «Fatture - Dettaglio» manda BackTo', !back.err, back.err?.message);
    await sleep(500);
    await check('ritorno: nessuna domanda', !(await anyModal().isVisible().catch(() => false)));
    await check('ritorno: catenella come prima del clic', JSON.stringify(await crumbsText()) === JSON.stringify(crumbsBefore),
      `${JSON.stringify(await crumbsText())} vs ${JSON.stringify(crumbsBefore)}`);
    await check('ritorno: di nuovo la fattura n. 29', (await page.locator('td.content-cell[id^="numDoc"] input').first().inputValue({ timeout: 5000 }).catch(() => ''))
      .trim() === FT_NUM);
    if (sotto) await checkOneLine(String(sotto.control.displayValue));
  }],

  ['D bersaglio nullo: Note proforma «Sel. per riga» (docRigheCliNpfSelList), righi senza articolo', async () => {
    const DESC = '{#articoloVariante.codiceEsterno##br#}#descrizioneArticoloStampa#';
    // il nome della colonna nel JSON e' il tag del ViewItem ("desc")
    const descIdx = (list) => { const i = colIndex(list, 'desc'); return i >= 0 ? i : colIndex(list, DESC); };
    const withArt = (v) => /<br\s*\/?>/i.test(String(v ?? ''));

    // 1) righi SENZA articolo, con testo: nessuna catenella
    const l1 = await openNpfRighe('876', '01/08/2018');
    if (await check('876: lista Sel. per riga nella risposta', !!l1)) {
      const i = descIdx(l1);
      await check('876: colonna Descrizione/articolo di tipo "html" (TextFormat)', l1.columns[i]?.control?.type === 'html', JSON.stringify(l1.columns[i]?.control));
      const rows = primaryCells(l1, i);
      const noArt = rows.filter((r) => nonEmpty(ctlValue(r.cell)) && !withArt(ctlValue(r.cell)));
      info(`876: ${rows.length} righi; senza articolo e con testo: ${noArt.map((r) => `«${asText(ctlValue(r.cell)).slice(0, 45)}»`).join(', ')}`);
      await check('876: ci sono i righi NPF senza articolo con testo (Rimborso spese condominiali ...)',
        noArt.length >= 3 && noArt.every((r) => /Rimborso spese condominiali/.test(asText(ctlValue(r.cell)))),
        rows.map((r) => asText(ctlValue(r.cell))).join(' | '));
      const wrong = noArt.filter((r) => r.cell?.control?.navigateView);
      await check('876: testo non vuoto ma articoloVariante nullo -> NESSUNA navigateView', noArt.length > 0 && wrong.length === 0,
        wrong.map((r) => `${r.path} ${fmtNav(r.cell.control.navigateView)}`).join('; '));
      const colId = `col_${i}`;
      const cells = await cellsInfo(colId);
      const shown = cells.filter((c) => /Rimborso spese condominiali/.test(c.text));
      await check('876: a video i righi senza articolo senza catenella', shown.length >= 1 && shown.every((c) => !c.nav),
        JSON.stringify(cells.map((c) => [c.text.slice(0, 30), c.nav])));
      const missing = noArt.map((r) => asText(ctlValue(r.cell))).filter((t) => !cells.some((c) => c.text === t));
      await check('876: a video il testo dei righi senza articolo e\' quello del server', missing.length === 0,
        `mancano ${JSON.stringify(missing)}; a video ${JSON.stringify(cells.map((c) => c.text.slice(0, 40)))}`);
    }
    await cleanup();

    // 2) rigo CON articolo: catenella
    const l2 = await openNpfRighe('493', '06/11/2020');
    if (await check('493: lista Sel. per riga nella risposta', !!l2)) {
      const i = descIdx(l2);
      const rows = primaryCells(l2, i);
      const art = rows.filter((r) => withArt(ctlValue(r.cell)));
      info(`493: ${rows.length} righi; con articolo: ${art.map((r) => `«${asText(ctlValue(r.cell)).slice(0, 45)}»`).join(', ')}`);
      await check('493: c\'e\' il rigo con articolo (CONFAVP)', art.some((r) => /CONFAVP/.test(String(ctlValue(r.cell)))),
        rows.map((r) => ctlValue(r.cell)).join(' | '));
      const bad = art.filter((r) => !navOk(r.cell?.control?.navigateView, r.path));
      await check('493: articoloVariante presente -> navigateView {command, navpath del rigo, controlName}', art.length > 0 && bad.length === 0,
        bad.map((r) => `${r.path} ${fmtNav(r.cell?.control?.navigateView)}`).join('; '));
      const cells = await cellsInfo(`col_${i}`);
      const c = cells.find((x) => /CONFAVP/.test(x.text));
      await check('493: a video la catenella sul rigo con articolo', !!c?.nav, JSON.stringify(cells.map((x) => [x.text.slice(0, 30), x.nav])));
    }
  }],

  ['C Ordini Clienti 24/00001, «Righe» = ordiniClientiRigheList: contentClass della TextFormat', async () => {
    await menuClick('Ordini Clienti', 'menu.ven.ordiniClientiQuery');
    // l'interrogazione vuota trova il solo ordine dell'azienda e apre il dettaglio
    await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
    if (!(await page.locator('.ant-tabs-tab').filter({ hasText: /^\s*Righe\s*$/ }).count())) {
      const row = page.locator('.ag-center-cols-container .ag-row').filter({ hasText: ORDINE }).first();
      await withRequest('NavigateDetail', () => row.click());
    }
    await changeTab('Righe');
    const list = lastList('ordiniClientiRigheList');
    if (!(await check('lista Righe dell\'ordine nella risposta', !!list))) return;
    const dIdx = colIndex(list, 'desc');
    const iIdx = colIndex(list, 'importoRiga');
    const qIdx = colIndex(list, 'qtaVenditaFormattata');
    await check('colonna Articolo/Descrizione: tipo "html" (TextFormat)', list.columns[dIdx]?.control?.type === 'html',
      JSON.stringify(list.columns[dIdx]?.control));
    const recs = primaryCells(list, dIdx).map((r) => ({
      path: r.path, desc: r.cell?.control, imp: r.row.cells?.[iIdx]?.control, qta: r.row.cells?.[qIdx]?.control,
    }));
    // il rigo capitolo (tipo C) e' quello con «Importo» in grassetto e senza quantita'
    const cap = recs.filter((r) => /\bbold\b/.test(r.imp?.cls || ''));
    const art = recs.filter((r) => !/\bbold\b/.test(r.imp?.cls || ''));
    info(`righi: ${recs.length}; capitoli (Importo bold) ${cap.length}; articoli ${art.length}`);
    await check('riferimento: «Importo» (ExtMoney, contentClass ?stileCapitolo) ha cls "bold" sul rigo capitolo', cap.length === 1,
      JSON.stringify(recs.map((r) => r.imp?.cls)));
    const st = art.map((r) => r.qta?.style).filter(Boolean);
    await check('riferimento: «Quantità» (Text, contentStyle) ha control.style', st.length > 0 && st.every((s) => /text-align:\s*right/.test(s)),
      JSON.stringify(art.map((r) => r.qta?.style)));
    await check('Articolo/Descrizione (TextFormat): sul rigo capitolo control.cls contiene "bold" (contentClass ?stileCapitolo)',
      cap.length > 0 && cap.every((r) => /\bbold\b/.test(r.desc?.cls || '')), JSON.stringify(cap.map((r) => r.desc)));
    await check('Articolo/Descrizione (TextFormat): sui righi articolo nessun "bold" in control.cls',
      art.length > 0 && art.every((r) => !/\bbold\b/.test(r.desc?.cls || '')), JSON.stringify(art.map((r) => r.desc?.cls ?? null)));
    await check('Articolo/Descrizione: testo invariato (capitolo «KIT DIGITALIZZAZIONE», righi «0513<br />APERTURA AREA RISERVATA ...»)',
      cap[0]?.desc?.value === 'KIT DIGITALIZZAZIONE' && art.some((r) => r.desc?.value === '0513<br />APERTURA AREA RISERVATA MINIMI E FORFAIT'),
      JSON.stringify(recs.map((r) => r.desc?.value)));
    // senza contentViewName: nessuna catenella
    await check('Articolo/Descrizione (senza contentViewName): nessuna navigateView', recs.every((r) => !r.desc?.navigateView),
      JSON.stringify(recs.map((r) => r.desc?.navigateView ?? null)));
    // a video: la classe arriva alla cella come per «Importo»
    const dCells = await cellsInfo(`col_${dIdx}`);
    const iCells = await cellsInfo(`col_${iIdx}`);
    const capRow = iCells.find((c) => /\bbold\b/.test(c.cls));
    await check('riferimento a video: la cella «Importo» del capitolo ha la classe bold', !!capRow, JSON.stringify(iCells.map((c) => c.cls)));
    const dCap = capRow ? dCells.find((c) => c.rowIndex === capRow.rowIndex) : null;
    await check('a video: la cella «Articolo/Descrizione» del capitolo ha la classe bold', /\bbold\b/.test(dCap?.cls || ''),
      `${dCap?.text}: ${dCap?.cls}`);
    await check('a video: il testo del capitolo resta «KIT DIGITALIZZAZIONE»', dCap?.text === 'KIT DIGITALIZZAZIONE', dCap?.text);
    note('contentStyle su una TextFormat di lista: nessuna view di lista raggiungibile lo dichiara (cercato in tutte le list XML): non esercitato dal vivo');
  }],
];

// ─────────────────────────────────────────────────────────────────── main

let browser;
try {
  browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  page = await ctx.newPage();
  track(page);
  try {
    await page.goto(await loginLink(), { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  } catch (e) {
    console.error('FAIL  accesso: ' + e.message);
    await browser.close();
    process.exit(2);
  }
  info(`entrato: ${new URL(page.url()).host}`);
  await ensureSede();
  for (const [name, fn] of cases) {
    if (ONLY && !ONLY.includes(name[0])) continue;
    current = name;
    console.log(`\n${current}`);
    try { await fn(); } catch (e) { await check('eccezione', false, e.message.split('\n')[0]); }
    await cleanup();
  }
} catch (e) {
  FAILED.push(`${current} · eccezione: ${e.message}`);
  console.log(`  FAIL eccezione: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

console.log(`\n${nPass} PASS, ${FAILED.length} FAIL — ${LOG.length} richieste in tutto`);
for (const f of FAILED) console.log('  - ' + f);
if (NOTES.length) { console.log('Note (non contano):'); for (const n of NOTES) console.log('  * ' + n); }
process.exit(FAILED.length ? 1 : 0);
