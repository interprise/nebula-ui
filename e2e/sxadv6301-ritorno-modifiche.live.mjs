/**
 * SXADV-6301 — ritorno dalla catenella (BackTo) con modifiche non salvate.
 *
 * Il difetto (Elena): Prima nota > documento > tab «Reg. contabili» > «Nuovo»
 * (pannello «Gestione riga», il micro-detail) > scelto un Sottoconto > clic su
 * «Prima nota - Lista» nella catenella: si torna alla lista SENZA domanda, e
 * riaprendo il documento il rigo non salvato e' ancora li'.
 *
 * Il contratto (comando CORE BackTo, navpath = viewstate di destinazione,
 * option1 = tipo pagina 0 query / 1 lista / 2 dettaglio):
 *   1. transazione sporca + destinazione lista o interrogazione -> CONFIRMATION
 *      SAVE_BEFORE_NEW («Ci sono modifiche non salvate. Si desidera vengano
 *      annullate TUTTE le modifiche?»), nessuno spostamento;
 *   2. OK = la stessa BackTo rigiocata con messages=SAVE_BEFORE_NEW, -> modifiche
 *      scartate (anche i righi nuovi), si arriva; riaperto il documento: valori
 *      del DB e «Annulla» in alto spento;
 *   3. Annulla alla domanda: nessuna richiesta, catenella, pannello e valori
 *      restano;
 *   4. ritorno verso un DETTAGLIO (dal dettaglio del rigo al documento): nessuna
 *      domanda, le modifiche restano;
 *   5. sessione pulita: nessuna domanda;
 *   vale anche col pannello chiuso («Chiudi») e con la sola testata cambiata.
 *   Cambio tab interno, frecce su/giu' e «Chiudi» del pannello: nessuna domanda.
 *
 * Casi (PN 26 del 19/11/2026, «test», provvisorio — MAI il 27, e' di Elena):
 *   A ticket: Nuovo + Sottoconto + «Prima nota - Lista» -> domanda; Annulla ->
 *     resta tutto; di nuovo -> domanda; OK -> lista; riaperto: niente rigo nuovo,
 *     «Annulla» spento.
 *   B rigo ESISTENTE modificato (Descrizione nel pannello) + ritorno alla Lista.
 *   C Nuovo + Sottoconto + «Chiudi» del pannello + ritorno alla Lista.
 *   D sola testata (Descrizione del documento) + ritorno alla Lista.
 *   E Nuovo + Sottoconto + ritorno all'«Interrogazione» (option1=0).
 *   F sessione pulita + ritorno alla Lista: nessuna domanda.
 *   G azioni che non escono dal documento: tab Reg. extra-contabili e ritorno,
 *     freccia su/giu' del pannello, «Chiudi»: nessuna domanda.
 *   H ritorno verso un dettaglio: Nuovo + Sottoconto + «Dettaglio» del pannello,
 *     poi la briciola del documento: nessuna domanda, rigo nuovo ancora li'.
 *   L seconda struttura di M-D (tipologia 2, lista in un tab): Listini generali
 *     > «1 Listino Vendita» > tab «Ricarichi per categoria» > Nuovo + Ricarico +
 *     «Listini generali - Lista» -> domanda; Annulla -> resta; OK -> lista;
 *     riaperto: niente rigo nuovo, «Annulla» spento.
 *   M dettaglio della stessa transazione PRIMA della destinazione: Listini
 *     generali > «1 Listino Vendita» > Descrizione di testata cambiata > link-
 *     azione «Prezzi Sede» (lista figlia, senza dettaglio per riga) > briciola
 *     del listino -> nessuna domanda, «Annulla» resta acceso, Descrizione ancora
 *     cambiata. Contro-prova: di nuovo «Prezzi Sede» > «Listini generali - Lista»
 *     -> domanda; Annulla -> resta; OK -> lista; riaperto: Descrizione del DB.
 *
 * SOLA PROVA sul DB di collaudo ALFA condiviso con la tester: mai Salva, Salva+,
 * Conferma, Cancella. Dopo ogni caso la sessione si lascia pulita: OK alla
 * domanda, «Annulla» in alto, o — se qualcosa e' andato storto — il clic sulla
 * voce di menu con OK alla domanda «modifiche non salvate» (che scarta tutto).
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <APP>` (link monouso).
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv6301-ritorno-modifiche.live.mjs [--headed] [--only <lettera>]
 *   APP=http://localhost:9080/entrasp/app/  USER_LOGIN=44AMM  (default)
 *   SHOTS=<cartella screenshot dei fallimenti>
 *   PLAYWRIGHT_DIR=<node_modules con playwright>  (default: la cache di npx)
 * Esce con 1 se almeno una verifica fallisce, 2 se non riesce a entrare.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function playwrightDir() {
  if (process.env.PLAYWRIGHT_DIR) return process.env.PLAYWRIGHT_DIR;
  const base = path.join(os.homedir(), '.npm/_npx');
  for (const d of existsSync(base) ? readdirSync(base) : []) {
    const nm = path.join(base, d, 'node_modules');
    if (existsSync(path.join(nm, 'playwright'))) return nm;
  }
  throw new Error('playwright non trovato: impostare PLAYWRIGHT_DIR');
}
const require = createRequire(playwrightDir().replace(/\/?$/, '/'));
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:9080/entrasp/app/';
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'sxadv6301');
const SEDE = '000 - PROVINCIALE';
const DOC_DATA = '19/11/2026'; // PN 26 «test»: l'unico del 19/11
const DOC_NUM = '26';
const MSG = 'Ci sono modifiche non salvate. Si desidera vengano annullate TUTTE le modifiche?';
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
const actionsOf = (reqs) => reqs.map((r) => r.action + (r.body.get('messages') ? `[messages=${r.body.get('messages')}]` : '')).join(',');

/** Aspetta che non partano richieste per `ms` (tetto 10 s). */
async function quiet(ms = 1500) {
  const t0 = Date.now();
  let lastLen = LOG.length;
  let lastChange = Date.now();
  while (Date.now() - t0 < 10000) {
    await sleep(150);
    if (LOG.length !== lastLen) { lastLen = LOG.length; lastChange = Date.now(); }
    if (Date.now() - lastChange >= ms) break;
  }
}

/**
 * Esegue `act`, aspetta la risposta della richiesta `action`, poi la quiete.
 * Ritorna le richieste partite nella finestra, il corpo della richiesta attesa
 * e gli errori/messaggi della sua risposta.
 */
async function withRequest(actionName, act, pred = () => true) {
  const from = LOG.length;
  const respP = page.waitForResponse((r) => {
    if (!/\/controller2?$/.test(new URL(r.url()).pathname)) return false;
    const b = new URLSearchParams(r.request().postData() || '');
    return b.get('action') === actionName && pred(b);
  }, { timeout: 30000 });
  respP.catch(() => {});
  await act();
  const resp = await respP;
  const text = await resp.text().catch(() => '');
  await quiet();
  let errors = [];
  try { errors = JSON.parse(text)?.errors ?? []; } catch { /* risposta non JSON */ }
  return { reqs: LOG.slice(from), body: new URLSearchParams(resp.request().postData() || ''), errors };
}

/** Le richieste partite durante `act` (nessuna attesa di una in particolare). */
async function requestsDuring(act, ms = 1500) {
  const from = LOG.length;
  await act();
  await quiet(ms);
  return LOG.slice(from);
}

const asks = (errors) => errors.some((e) => e.type === 'CONFIRMATION' && e.mnemonic === 'SAVE_BEFORE_NEW');
const errStr = (errors) => errors.map((e) => `${e.type}:${e.mnemonic || ''}`).join(',') || 'nessun messaggio';

// ───────────────────────────────────────────────────── letture della pagina

const crumbsText = async () =>
  (await page.locator('.ant-breadcrumb a, .ant-breadcrumb span[title]').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
const crumbLink = (re) => page.locator('.ant-breadcrumb a').filter({ hasText: re }).first();
const topButton = (label) => page.locator('button').filter({ hasText: new RegExp(`^${label}$`) }).first();
const confirmModal = () => page.locator('.ant-modal:visible').filter({ hasText: 'Si desidera vengano annullate' }).last();
const anyModal = () => page.locator('.ant-modal:visible').last();
const panel = () => page.locator('.edit-panel');
const gridRows = async () => {
  await page.locator('.split-tab-panel .ag-header').first().waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(300);
  return (await page.locator('.split-tab-panel .ag-center-cols-container .ag-row').allInnerTexts())
    .map((s) => s.replace(/\s+/g, ' ').trim());
};
const panelVisible = () => panel().isVisible().catch(() => false);

/** La cella del pannello sotto l'intestazione `title`. */
async function panelCell(title) {
  const ths = await panel().locator('thead th').allInnerTexts();
  const i = ths.findIndex((t) => t.trim() === title);
  if (i < 0) throw new Error(`colonna "${title}" non trovata nel pannello (${ths.join(', ')})`);
  return panel().locator('tbody tr').first().locator('td').nth(i);
}
async function panelInputValue(title) {
  const c = await panelCell(title);
  const inp = c.locator('input').first();
  if (await inp.count()) return inp.inputValue();
  return (await c.innerText()).trim();
}
/** Il testo mostrato da una combo del pannello (valore scelto). */
async function panelSelectText(title) {
  const c = await panelCell(title);
  return (await c.locator('.ant-select').first().innerText().catch(() => '')).trim();
}
const annullaEnabled = () => topButton('Annulla').isEnabled().catch(() => false);
const headerDescrizione = () => page.locator('td.content-cell[id^="descrizione."] input').first();

// ───────────────────────────────────────────────────────────────── percorso

async function ensureSede() {
  const sel = page.locator('.header-select').nth(1);
  const now = (await sel.innerText()).trim();
  if (now.includes(SEDE)) { info(`sede gia' ${SEDE}`); return; }
  info(`sede ${now} -> ${SEDE}`);
  await sel.click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: SEDE }).first().click();
  await quiet(2500);
  await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  const after = (await page.locator('.header-select').nth(1).innerText()).trim();
  if (!after.includes(SEDE)) throw new Error(`cambio sede non riuscito: ${after}`);
}

/** Clic sulla voce di menu; se chiede «modifiche non salvate», OK (scarta). */
async function menuClick(query, textRe) {
  const search = page.getByPlaceholder('Cerca nel menu...');
  await search.click();
  await search.fill(query);
  const item = page.locator('li[data-menu-id]').filter({ hasText: textRe }).first();
  await item.waitFor({ timeout: 10000 });
  const r = await withRequest('ExecuteMenuItem', () => item.click());
  if (r.errors.some((e) => e.type === 'CONFIRMATION')) {
    info(`menu: la voce chiede conferma (${errStr(r.errors)}), OK per scartare`);
    await withRequest('ExecuteMenuItem', () => page.locator('.ant-modal:visible button').filter({ hasText: /^OK$/ }).last().click(),
      (b) => !!b.get('messages'));
  }
}

/** Prima nota (la prima delle due omonime) > Esegui > PN 26 del 19/11. */
async function openPN() {
  await menuClick('Prima nota', /^\s*Prima nota\s*$/i);
  await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
  await openDocFromList();
}
async function openDocFromList() {
  const row = page.locator('.ag-row').filter({ hasText: DOC_DATA }).first();
  await row.waitFor({ timeout: 20000 });
  await withRequest('NavigateDetail', () => row.click());
  await page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. contabili' }).first().waitFor({ timeout: 20000 });
  const num = await page.locator('td.content-cell[id^="numeroDocumento."] input, td.content-cell[id^="numDoc"] input').first()
    .inputValue({ timeout: 2000 }).catch(() => null);
  const dataOk = await page.locator('input').evaluateAll((els, d) => els.some((e) => e.value === d), DOC_DATA);
  if (!dataOk) throw new Error(`il documento aperto non e' quello del ${DOC_DATA}`);
  if (num !== null && num.trim() !== DOC_NUM) throw new Error(`documento aperto n. ${num}, atteso ${DOC_NUM}`);
}

/** Apre il documento ripartendo dal menu e controlla che sia pulito. Ritorna i righi. */
async function freshDoc() {
  await openPN();
  if (await annullaEnabled()) {
    info('il documento apre gia\' sporco: Annulla in alto');
    await withRequest('Cancel', () => topButton('Annulla').click());
  }
  await check('il documento parte pulito («Annulla» in alto spento)', !(await annullaEnabled()));
  const rows = await gridRows();
  info(`righi Reg. contabili: ${rows.length} ${JSON.stringify(rows)}`);
  return rows;
}

/** «Nuovo» della lista Reg. contabili (l'ultimo «Nuovo» visibile, non quello in alto). */
async function nuovoRigo() {
  const btn = page.locator('.split-tab-panel button:visible').filter({ hasText: /^Nuovo$/ }).first();
  const r = await withRequest('Add', () => btn.click());
  await panel().waitFor({ timeout: 15000 });
  return r;
}

/** Sceglie un Sottoconto nella combo del pannello (prima voce per "005.01"). */
async function scegliSottoconto() {
  const c = await panelCell('Sottoconto');
  await c.locator('.ant-select').first().click();
  await page.keyboard.type('005.01', { delay: 40 });
  const opt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first();
  await opt.waitFor({ timeout: 15000 });
  const label = (await opt.innerText()).trim();
  const r = await withRequest('Post', () => opt.click());
  info(`Sottoconto scelto: ${label} · richieste [${actionsOf(r.reqs)}]`);
  return label;
}

/** Clic su una briciola; ritorna la richiesta BackTo e i suoi messaggi. */
async function clickCrumb(re) {
  const r = await withRequest('BackTo', () => crumbLink(re).click());
  info(`BackTo navpath=${r.body.get('navpath')} option1=${r.body.get('option1')} postPath=${r.body.get('postPath') ?? '-'} -> ${errStr(r.errors)} · richieste [${actionsOf(r.reqs)}]`);
  return r;
}

/** La domanda: messaggio nella risposta E finestra a video col testo giusto. */
async function expectQuestion(r, label) {
  const okResp = await check(`${label}: il server chiede conferma (CONFIRMATION SAVE_BEFORE_NEW)`, asks(r.errors),
    `risposta: ${errStr(r.errors)}`);
  const m = confirmModal();
  const shown = await m.isVisible().catch(() => false);
  const txt = shown ? (await m.innerText()).replace(/\s+/g, ' ') : '';
  await check(`${label}: a video la domanda «${MSG}»`, shown && txt.includes(MSG), shown ? txt : 'nessuna finestra');
  return okResp && shown;
}

/** «Annulla» sulla domanda: nessuna richiesta, la pagina resta. */
async function answerCancel() {
  const reqs = await requestsDuring(() => confirmModal().locator('button').filter({ hasText: /^Annulla$/ }).click());
  await check('Annulla alla domanda: nessuna richiesta al server', reqs.length === 0, `[${actionsOf(reqs)}]`);
  await check('Annulla alla domanda: la finestra si chiude', !(await confirmModal().isVisible().catch(() => false)));
}

/** «OK» sulla domanda: la stessa BackTo rigiocata con messages=SAVE_BEFORE_NEW,. */
async function answerOk(first) {
  const r = await withRequest('BackTo', () => confirmModal().locator('button').filter({ hasText: /^OK$/ }).click());
  const msgs = r.body.get('messages') || '';
  info(`OK -> BackTo messages=${msgs} -> ${errStr(r.errors)} · richieste [${actionsOf(r.reqs)}]`);
  await check('OK: la BackTo rigiocata porta messages con SAVE_BEFORE_NEW,', msgs.includes('SAVE_BEFORE_NEW,'), msgs);
  for (const k of ['navpath', 'option1']) {
    await check(`OK: la BackTo rigiocata ha lo stesso ${k}`, r.body.get(k) === first.body.get(k),
      `${r.body.get(k)} vs ${first.body.get(k)}`);
  }
  await check('OK: una sola BackTo nel rigioco', r.reqs.filter((x) => x.action === 'BackTo').length === 1, `[${actionsOf(r.reqs)}]`);
  await check('OK: la risposta non ha errori ne\' altre domande', !r.errors.some((e) => ['ERROR', 'CONFIRMATION', 'YESNOCANCEL'].includes(e.type)),
    errStr(r.errors));
  return r;
}

/** Siamo sulla lista Prima nota (catenella = solo Interrogazione, righe con i documenti). */
async function expectOnPNList(label) {
  const cr = await crumbsText();
  await check(`${label}: catenella della lista («Prima nota - Interrogazione»)`,
    cr.length === 1 && /Interrogazione/.test(cr[0]), JSON.stringify(cr));
  const rows = await page.locator('.ag-row').filter({ hasText: DOC_DATA }).count();
  await check(`${label}: a video la lista dei documenti`, rows > 0);
}

/** Riapre il documento dalla lista e controlla valori del DB + sessione pulita. */
async function reopenAndCheckClean(label, origRows) {
  await openDocFromList();
  const rows = await gridRows();
  await check(`${label}: riaperto, i righi sono quelli del DB`, JSON.stringify(rows) === JSON.stringify(origRows),
    `visti ${JSON.stringify(rows)}, attesi ${JSON.stringify(origRows)}`);
  await check(`${label}: riaperto, «Annulla» in alto spento (sessione pulita)`, !(await annullaEnabled()));
}

/** Pulizia di fine caso: domanda aperta -> OK; poi menu con OK (scarta tutto). */
async function pulisci(query = 'Prima nota', re = /^\s*Prima nota\s*$/i) {
  try {
    for (let k = 0; k < 3 && await anyModal().isVisible().catch(() => false); k++) {
      info(`pulizia: finestra ancora aperta («${(await anyModal().innerText()).replace(/\s+/g, ' ').slice(0, 80)}»), OK`);
      await requestsDuring(() => anyModal().locator('button').filter({ hasText: /^OK$/ }).first().click(), 2000);
    }
    await menuClick(query, re);
  } catch (e) {
    info(`pulizia non riuscita: ${e.message.split('\n')[0]}`);
  }
}

// ─────────────────────────────────────────────────────────────────── casi

let ORIG = null; // righi Reg. contabili del documento 26 come stanno nel DB

const cases = [
  ['A ticket: Nuovo + Sottoconto + «Prima nota - Lista»', async () => {
    ORIG = await freshDoc();
    await nuovoRigo();
    const descr = await panelInputValue('Descrizione');
    await check('Nuovo: il pannello propone la Descrizione', descr.trim() !== '', JSON.stringify(descr));
    const sc = await scegliSottoconto();
    const rowsDirty = await gridRows();
    await check('Nuovo: il rigo nuovo e\' in lista', rowsDirty.length === ORIG.length + 1, JSON.stringify(rowsDirty));
    await check('dopo il Sottoconto «Annulla» in alto e\' acceso', await annullaEnabled());
    const crumbsBefore = await crumbsText();

    const r1 = await clickCrumb(/^Prima nota - Lista$/);
    await check('BackTo verso la lista (option1=1)', r1.body.get('option1') === '1', r1.body.get('option1'));
    const asked = await expectQuestion(r1, 'briciola Lista');
    if (!asked) {
      // Il difetto: si e' gia' tornati. Si guarda cosa e' rimasto, poi si pulisce.
      const cr = await crumbsText();
      info(`nessuna domanda: catenella ora ${JSON.stringify(cr)}`);
      try {
        await openDocFromList();
        const rows = await gridRows();
        await check('(difetto) riaperto il documento, il rigo non salvato non deve esserci',
          JSON.stringify(rows) === JSON.stringify(ORIG), JSON.stringify(rows));
        await check('(difetto) riaperto il documento, «Annulla» in alto spento', !(await annullaEnabled()));
      } catch (e) { info(`riapertura: ${e.message.split('\n')[0]}`); }
      return;
    }
    // Annulla: si resta dove si era.
    await answerCancel();
    await check('Annulla: la catenella resta quella di prima', JSON.stringify(await crumbsText()) === JSON.stringify(crumbsBefore),
      JSON.stringify(await crumbsText()));
    await check('Annulla: il pannello resta aperto', await panelVisible());
    const scNow = await panelSelectText('Sottoconto').catch(() => '');
    await check('Annulla: il Sottoconto scelto resta', scNow.includes(sc.split(' - ')[0]), `"${scNow}" vs "${sc}"`);
    await check('Annulla: il rigo nuovo resta in lista', (await gridRows()).length === ORIG.length + 1);
    await check('Annulla: «Annulla» in alto ancora acceso', await annullaEnabled());

    // Di nuovo, e OK.
    const r2 = await clickCrumb(/^Prima nota - Lista$/);
    if (!(await expectQuestion(r2, 'seconda volta'))) return;
    await answerOk(r2);
    await expectOnPNList('OK');
    await reopenAndCheckClean('OK', ORIG);
  }],

  ['B rigo ESISTENTE modificato nel pannello + «Prima nota - Lista»', async () => {
    const orig = await freshDoc();
    ORIG ??= orig;
    const first = page.locator('.split-tab-panel .ag-center-cols-container .ag-row').first();
    await requestsDuring(() => first.click());
    await panel().waitFor({ timeout: 15000 });
    const c = await panelCell('Descrizione');
    const inp = c.locator('input').first();
    const before = await inp.inputValue();
    await inp.fill(`${before} prova 6301`);
    const r = await requestsDuring(() => inp.press('Tab'));
    info(`Descrizione del rigo cambiata · richieste [${actionsOf(r)}]`);
    const rb = await clickCrumb(/^Prima nota - Lista$/);
    if (!(await expectQuestion(rb, 'rigo esistente'))) {
      try { await openDocFromList(); } catch { /* sotto */ }
      await check('(difetto) riaperto, il rigo ha la Descrizione del DB', JSON.stringify(await gridRows()) === JSON.stringify(orig),
        JSON.stringify(await gridRows()));
      return;
    }
    await answerOk(rb);
    await expectOnPNList('rigo esistente, OK');
    await reopenAndCheckClean('rigo esistente, OK', orig);
  }],

  ['C Nuovo + Sottoconto + «Chiudi» del pannello + «Prima nota - Lista»', async () => {
    const orig = await freshDoc();
    await nuovoRigo();
    await scegliSottoconto();
    const rc = await requestsDuring(() => panel().locator('button').filter({ hasText: /^Chiudi$/ }).click());
    await check('Chiudi: nessuna domanda', !(await confirmModal().isVisible().catch(() => false)), `[${actionsOf(rc)}]`);
    await check('Chiudi: il pannello si chiude', !(await panelVisible()));
    await check('Chiudi: le modifiche restano in sospeso («Annulla» acceso)', await annullaEnabled());
    const r = await clickCrumb(/^Prima nota - Lista$/);
    if (!(await expectQuestion(r, 'pannello chiuso'))) {
      try { await openDocFromList(); } catch { /* sotto */ }
      await check('(difetto) riaperto, il rigo non salvato non deve esserci', JSON.stringify(await gridRows()) === JSON.stringify(orig),
        JSON.stringify(await gridRows()));
      return;
    }
    await answerOk(r);
    await expectOnPNList('pannello chiuso, OK');
    await reopenAndCheckClean('pannello chiuso, OK', orig);
  }],

  ['D sola testata (Descrizione del documento) + «Prima nota - Lista»', async () => {
    const orig = await freshDoc();
    const inp = headerDescrizione();
    const before = await inp.inputValue();
    await inp.fill(`${before} prova 6301`);
    const r0 = await requestsDuring(() => inp.press('Tab'));
    info(`Descrizione di testata cambiata · richieste [${actionsOf(r0)}] · «Annulla» acceso: ${await annullaEnabled()}`);
    const r = await clickCrumb(/^Prima nota - Lista$/);
    const sentDescr = [...r.body.keys()].find((k) => /^descrizione\.S1-/.test(k));
    info(`la BackTo porta ${sentDescr ? `${sentDescr}=${JSON.stringify(r.body.get(sentDescr))}` : 'nessuna descrizione di testata'}`);
    if (!(await expectQuestion(r, 'sola testata'))) {
      try {
        await openDocFromList();
        const now = await headerDescrizione().inputValue();
        await check('(difetto) riaperto, la Descrizione e\' quella del DB', now === before, `"${now}" vs "${before}"`);
        await check('(difetto) riaperto, «Annulla» spento', !(await annullaEnabled()));
      } catch (e) { info(`riapertura: ${e.message.split('\n')[0]}`); }
      return;
    }
    await answerOk(r);
    await expectOnPNList('sola testata, OK');
    await reopenAndCheckClean('sola testata, OK', orig);
    const now = await headerDescrizione().inputValue();
    await check('sola testata, OK: riaperto, la Descrizione e\' quella del DB', now === before, `"${now}" vs "${before}"`);
  }],

  ['E Nuovo + Sottoconto + «Prima nota - Interrogazione»', async () => {
    const orig = await freshDoc();
    await nuovoRigo();
    await scegliSottoconto();
    const r = await clickCrumb(/Interrogazione/);
    await check('BackTo verso l\'interrogazione (option1=0)', r.body.get('option1') === '0', r.body.get('option1'));
    if (!(await expectQuestion(r, 'Interrogazione'))) {
      if (await anyModal().isVisible().catch(() => false)) {
        info(`a video invece: «${(await anyModal().innerText()).replace(/\s+/g, ' ')}»`);
        await requestsDuring(() => anyModal().locator('button').filter({ hasText: /^OK$/ }).first().click());
      }
      const esegui = await page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().isVisible().catch(() => false);
      info(`dopo la risposta: ${esegui ? 'sulla maschera di interrogazione' : `ancora sul documento (catenella ${JSON.stringify(await crumbsText())})`}`);
      if (esegui) {
        try {
          await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
          await openDocFromList();
          await check('(difetto) riaperto, il rigo non salvato non deve esserci', JSON.stringify(await gridRows()) === JSON.stringify(orig),
            JSON.stringify(await gridRows()));
        } catch (e) { info(`riapertura: ${e.message.split('\n')[0]}`); }
      }
      return;
    }
    await answerCancel();
    await check('Annulla: il pannello resta aperto', await panelVisible());
    const r2 = await clickCrumb(/Interrogazione/);
    if (!(await expectQuestion(r2, 'Interrogazione, seconda volta'))) return;
    await answerOk(r2);
    await check('OK: a video la maschera di interrogazione (Esegui)',
      await page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().isVisible().catch(() => false));
    await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
    await reopenAndCheckClean('Interrogazione, OK', orig);
  }],

  ['F sessione pulita + «Prima nota - Lista»: nessuna domanda', async () => {
    await freshDoc();
    const r = await clickCrumb(/^Prima nota - Lista$/);
    await check('sessione pulita: nessuna domanda', !r.errors.some((e) => e.type === 'CONFIRMATION' || e.type === 'ERROR'), errStr(r.errors));
    await check('sessione pulita: nessuna finestra', !(await confirmModal().isVisible().catch(() => false)));
    await check('sessione pulita: una sola BackTo', r.reqs.filter((x) => x.action === 'BackTo').length === 1, `[${actionsOf(r.reqs)}]`);
    await expectOnPNList('sessione pulita');
  }],

  ['G azioni dentro il documento: tab, frecce, Chiudi senza domanda', async () => {
    const orig = await freshDoc();
    await nuovoRigo();
    await scegliSottoconto();
    // tab interno al documento
    const rt1 = await requestsDuring(() => page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. extra-contabili' }).click(), 2000);
    info(`tab Reg. extra-contabili · richieste [${actionsOf(rt1)}]`);
    await check('tab Reg. extra-contabili: nessuna domanda', !(await confirmModal().isVisible().catch(() => false)));
    const rt2 = await requestsDuring(() => page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. contabili' }).first().click(), 2000);
    info(`tab Reg. contabili · richieste [${actionsOf(rt2)}]`);
    await check('ritorno al tab Reg. contabili: nessuna domanda', !(await confirmModal().isVisible().catch(() => false)));
    await check('tab: il rigo nuovo e\' ancora in lista', (await gridRows()).length === orig.length + 1, JSON.stringify(await gridRows()));
    // frecce del pannello (se il pannello e' aperto dopo il cambio tab)
    if (!(await panelVisible())) {
      info('pannello chiuso dopo il cambio tab: si riapre sul rigo nuovo');
      await requestsDuring(() => page.locator('.split-tab-panel .ag-center-cols-container .ag-row').last().click());
    }
    for (const lbl of ['Record precedente', 'Record successivo']) {
      const b = panel().locator(`button[aria-label="${lbl}"]`);
      if (!(await b.count()) || !(await b.isEnabled())) { info(`${lbl}: spento, salto`); continue; }
      const rr = await requestsDuring(() => b.click(), 2000);
      info(`${lbl} · richieste [${actionsOf(rr)}]`);
      await check(`${lbl}: nessuna domanda`, !(await confirmModal().isVisible().catch(() => false)));
    }
    if (await panelVisible()) {
      await requestsDuring(() => panel().locator('button').filter({ hasText: /^Chiudi$/ }).click());
      await check('Chiudi: nessuna domanda', !(await confirmModal().isVisible().catch(() => false)));
    }
    await check('dopo tab/frecce/Chiudi le modifiche restano («Annulla» acceso)', await annullaEnabled());
    // pulizia: Annulla in alto
    await withRequest('Cancel', () => topButton('Annulla').click());
    await check('Annulla in alto: righi del DB', JSON.stringify(await gridRows()) === JSON.stringify(orig), JSON.stringify(await gridRows()));
    await check('Annulla in alto: «Annulla» spento', !(await annullaEnabled()));
  }],

  ['H ritorno verso un DETTAGLIO (dal dettaglio del rigo al documento): nessuna domanda', async () => {
    const orig = await freshDoc();
    await nuovoRigo();
    await scegliSottoconto();
    await withRequest('NavigateDetail', () => panel().locator('button').filter({ hasText: /Dettaglio/ }).click());
    const cr = await crumbsText();
    info(`dettaglio del rigo, catenella ${JSON.stringify(cr)}`);
    const docCrumb = /Prima nota - Dettaglio/;
    if (!(await crumbLink(docCrumb).count())) { await check('la catenella ha la briciola del documento', false, JSON.stringify(cr)); return; }
    const r = await clickCrumb(docCrumb);
    await check('BackTo verso il dettaglio (option1=2)', r.body.get('option1') === '2', r.body.get('option1'));
    await check('ritorno al documento: nessuna domanda', !r.errors.some((e) => e.type === 'CONFIRMATION' || e.type === 'ERROR'), errStr(r.errors));
    await check('ritorno al documento: nessuna finestra', !(await confirmModal().isVisible().catch(() => false)));
    await page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. contabili' }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await check('ritorno al documento: il rigo nuovo e\' ancora li\'', (await gridRows()).length === orig.length + 1, JSON.stringify(await gridRows()));
    await check('ritorno al documento: «Annulla» acceso (modifiche in sospeso)', await annullaEnabled());
    info(`pannello visibile al ritorno: ${await panelVisible()} (non previsto dal contratto, solo informativo)`);
    await withRequest('Cancel', () => topButton('Annulla').click());
    await check('Annulla in alto: righi del DB', JSON.stringify(await gridRows()) === JSON.stringify(orig), JSON.stringify(await gridRows()));
  }],

  ['L seconda struttura: Listini generali > Ricarichi per categoria > Nuovo + Ricarico + «Listini generali - Lista»', async () => {
    const open = async () => {
      await menuClick('Listini generali', /^\s*Listini generali\s*$/i);
      const row = page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).first();
      await row.waitFor({ timeout: 20000 });
      await withRequest('NavigateDetail', () => row.click());
      const tab = page.locator('.ant-tabs-tab').filter({ hasText: 'Ricarichi per categoria' }).first();
      await tab.waitFor({ timeout: 15000 });
      await requestsDuring(() => tab.click(), 2000);
    };
    await open();
    if (await annullaEnabled()) await withRequest('Cancel', () => topButton('Annulla').click());
    await check('il listino parte pulito', !(await annullaEnabled()));
    const orig = await gridRows();
    info(`righi Ricarichi: ${JSON.stringify(orig)}`);
    await withRequest('Add', () => page.locator('.split-tab-panel button:visible').filter({ hasText: /^Nuovo$/ }).first().click());
    await panel().waitFor({ timeout: 15000 });
    const c = await panelCell('Ricarico');
    const inp = c.locator('input').first();
    await inp.click();
    await inp.fill('5');
    const rp = await requestsDuring(() => inp.press('Tab'));
    info(`Ricarico 5 · richieste [${actionsOf(rp)}]`);
    await check('il rigo nuovo e\' in lista', (await gridRows()).length === orig.length + 1, JSON.stringify(await gridRows()));
    const crumbsBefore = await crumbsText();
    const r = await clickCrumb(/^Listini generali - Lista$/);
    if (!(await expectQuestion(r, 'listino'))) {
      try {
        const row = page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).first();
        await withRequest('NavigateDetail', () => row.click());
        await requestsDuring(() => page.locator('.ant-tabs-tab').filter({ hasText: 'Ricarichi per categoria' }).first().click(), 2000);
        await check('(difetto) riaperto il listino, il rigo non salvato non deve esserci',
          JSON.stringify(await gridRows()) === JSON.stringify(orig), JSON.stringify(await gridRows()));
        await check('(difetto) riaperto il listino, «Annulla» spento', !(await annullaEnabled()));
      } catch (e) { info(`riapertura: ${e.message.split('\n')[0]}`); }
      return;
    }
    await answerCancel();
    await check('Annulla: la catenella resta', JSON.stringify(await crumbsText()) === JSON.stringify(crumbsBefore));
    await check('Annulla: il pannello resta aperto', await panelVisible());
    const v = await (await panelCell('Ricarico')).locator('input').first().inputValue().catch(() => '');
    await check('Annulla: il Ricarico digitato resta', /^5([,.]0*)?$/.test(v.trim()), JSON.stringify(v));
    const r2 = await clickCrumb(/^Listini generali - Lista$/);
    if (!(await expectQuestion(r2, 'listino, seconda volta'))) return;
    await answerOk(r2);
    const cr = await crumbsText();
    await check('OK: si e\' sulla lista dei listini', !cr.some((c) => /Lista/.test(c))
      && (await page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).count()) > 0, JSON.stringify(cr));
    const row = page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).first();
    await withRequest('NavigateDetail', () => row.click());
    await requestsDuring(() => page.locator('.ant-tabs-tab').filter({ hasText: 'Ricarichi per categoria' }).first().click(), 2000);
    await check('OK: riaperto, i Ricarichi sono quelli del DB', JSON.stringify(await gridRows()) === JSON.stringify(orig),
      JSON.stringify(await gridRows()));
    await check('OK: riaperto, «Annulla» spento', !(await annullaEnabled()));
  }],
  ['M dettaglio PRIMA della destinazione: Listino (testata cambiata) > «Prezzi Sede» > briciola del listino senza domanda; «Listini generali - Lista» con domanda', async () => {
    const LISTINO = /^Listini generali - Dettaglio/;
    await menuClick('Listini generali', /^\s*Listini generali\s*$/i);
    const row = page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).first();
    await row.waitFor({ timeout: 20000 });
    await withRequest('NavigateDetail', () => row.click());
    if (await annullaEnabled()) await withRequest('Cancel', () => topButton('Annulla').click());
    await check('il listino parte pulito', !(await annullaEnabled()));
    const inp = headerDescrizione();
    const before = await inp.inputValue();
    await inp.fill(`${before} prova 6301`);
    await requestsDuring(() => inp.press('Tab'));
    const apriPrezziSede = async () => {
      const rq = await requestsDuring(() => page.getByText('Prezzi Sede', { exact: true }).first().click(), 2000);
      info(`link-azione «Prezzi Sede» · richieste [${actionsOf(rq)}] · catenella ${JSON.stringify(await crumbsText())}`);
      await check('«Prezzi Sede»: nessuna domanda', !(await confirmModal().isVisible().catch(() => false)));
      await check('«Prezzi Sede»: la catenella ha la lista e il dettaglio del listino',
        !!(await crumbLink(/^Listini generali - Lista$/).count()) && !!(await crumbLink(LISTINO).count()), JSON.stringify(await crumbsText()));
      await check('«Prezzi Sede»: le modifiche restano in sospeso («Annulla» acceso)', await annullaEnabled());
    };
    await apriPrezziSede();
    // La lista figlia non ha un dettaglio per riga (nessun ">"): si torna al listino.
    const r = await clickCrumb(LISTINO);
    await check('briciola del listino: BackTo verso un dettaglio (option1=2)', r.body.get('option1') === '2', r.body.get('option1'));
    await check('briciola del listino: nessuna domanda', !r.errors.some((e) => e.type === 'CONFIRMATION' || e.type === 'ERROR'), errStr(r.errors));
    await check('briciola del listino: nessuna finestra', !(await confirmModal().isVisible().catch(() => false)));
    await check('briciola del listino: «Annulla» in alto resta acceso', await annullaEnabled());
    const now = await headerDescrizione().inputValue().catch(() => '');
    await check('briciola del listino: la Descrizione cambiata e\' ancora li\'', now === `${before} prova 6301`, `"${now}"`);
    // Contro-prova: dalla lista figlia la briciola PRIMA del dettaglio chiede.
    await apriPrezziSede();
    const r2 = await clickCrumb(/^Listini generali - Lista$/);
    await check('briciola «Listini generali - Lista»: BackTo verso la lista (option1=1)', r2.body.get('option1') === '1', r2.body.get('option1'));
    if (!(await expectQuestion(r2, 'contro-prova Listini generali - Lista'))) return;
    await answerCancel();
    await check('Annulla: si resta sulla lista figlia', !!(await crumbLink(LISTINO).count()), JSON.stringify(await crumbsText()));
    const r3 = await clickCrumb(/^Listini generali - Lista$/);
    if (!(await expectQuestion(r3, 'contro-prova, seconda volta'))) return;
    await answerOk(r3);
    await check('OK: si e\' sulla lista dei listini', !(await crumbLink(LISTINO).count())
      && (await page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).count()) > 0, JSON.stringify(await crumbsText()));
    await withRequest('NavigateDetail', () => page.locator('.ag-row').filter({ hasText: 'Listino Vendita' }).first().click());
    const db = await headerDescrizione().inputValue().catch(() => '');
    await check('OK: riaperto, la Descrizione e\' quella del DB', db === before, `"${db}" vs "${before}"`);
    await check('OK: riaperto, «Annulla» spento', !(await annullaEnabled()));
  }],
];

// ─────────────────────────────────────────────────────────────────── main

let browser;
// --only A (una lettera, o piu' lettere: --only ABF) oppure una sottostringa del nome (>= 4 caratteri).
const run = (name) => !ONLY
  || (ONLY.length < 4 ? ONLY.toUpperCase().includes(name.split(' ')[0].toUpperCase()) : name.toLowerCase().includes(ONLY.toLowerCase()));
try {
  browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
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
  await ensureSede();

  for (const [name, fn] of cases) {
    if (!run(name)) continue;
    current = name;
    console.log(`\n${current}`);
    try { await fn(); } catch (e) {
      await check('eccezione', false, e.message.split('\n')[0]);
    }
    // Sessione pulita per il caso dopo (e per chi viene dopo): OK alle domande
    // rimaste, poi la voce di menu con OK a «modifiche non salvate».
    if (name.startsWith('L ') || name.startsWith('M ')) await pulisci('Listini generali', /^\s*Listini generali\s*$/i);
    else await pulisci();
  }
  // Controllo finale: il documento 26 riaperto e' come nel DB e la sessione pulita.
  if (ORIG && run('finale')) {
    current = 'Z controllo finale';
    console.log(`\n${current}`);
    try {
      await openPN();
      await check('finale: righi del documento 26 come nel DB', JSON.stringify(await gridRows()) === JSON.stringify(ORIG),
        JSON.stringify(await gridRows()));
      await check('finale: «Annulla» in alto spento', !(await annullaEnabled()));
      if (await annullaEnabled()) await withRequest('Cancel', () => topButton('Annulla').click());
    } catch (e) { await check('eccezione', false, e.message.split('\n')[0]); }
  }
} catch (e) {
  FAILED.push(`${current} · eccezione: ${e.message}`);
  console.log(`  FAIL eccezione: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

console.log(`\n${nPass} PASS, ${FAILED.length} FAIL — ${LOG.length} richieste in tutto`);
for (const f of FAILED) console.log('  - ' + f);
process.exit(FAILED.length ? 1 : 0);
