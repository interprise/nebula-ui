/**
 * SXADV-5773 / 5774 / 5776 — le tre azioni di documentazione della testata
 * (Redigi, Scarica, Apri la finestra di aiuto): prova LIVE a livello di
 * protocollo, indipendente dall'implementazione. Parla col Tomcat vero come il
 * client React (form-urlencoded, sid proprio, hasTemplate=1 + templateKey,
 * idratazione col VERO src/services/hydrate.ts).
 *
 * Contratto provato, sul dettaglio Anagrafica Unica (anagraficheUnDetail):
 *   1. la barra offre i tre pulsanti, con gli handler che il client sa leggere;
 *   2. GetViewHelp risponde con `items` (array), non `{}`: `{}` e' la risposta
 *      di CORE quando nessun HelpSupplier e' configurato;
 *   3. GetViewHelp su una vista che non esiste non e' un errore;
 *   4. HelpDownload non da' errori e offre un file che LoadFile consegna, un
 *      .xlsx vero e con le righe della vista;
 *   5. dopo HelpDownload la scheda e' ancora utilizzabile: la pagina resta il
 *      dettaglio;
 *   6. ToggleDoc emette docIcon sui campi e il template :doc; ToggleDoc di nuovo
 *      lo toglie; il terzo, col template gia' in mano al client, lo rimette;
 *   7. la ? di un campo (NavigateHelp) apre helpDetail. Si esce con Cancel.
 *
 * SOLA LETTURA: ExecuteMenuItem, ExecuteQuery, apertura del dettaglio,
 * GetViewHelp, HelpDownload + LoadFile, ToggleDoc (proprieta' del viewstate),
 * NavigateHelp + Cancel. Mai Save, Delete, ToggleItem. Il testo di HELP non si
 * tocca: con la tabella vuota `items` e' legittimamente [].
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <app>` (link monouso,
 * cookie di sessione; nessuna password passa di qui). In un worktree si usa il
 * bin/entrasp-sql che gli sta accanto, con ENTRASP_WS_ROOT sul worktree.
 *
 * Uso (da entrasp-ui/, Node >= 22.6 per importare il .ts del client):
 *   BASE=http://localhost:9380/entrasp node e2e/sxadv5776-aiuto.live.mjs [--only <sottostringa>] [--list] [--verbose]
 *   BASE=http://localhost:9080/entrasp  USER_LOGIN=44AMM  SID=S8  CODICE=P2155977  (default)
 * Esce con 1 se almeno un caso fallisce, 2 se non riesce a entrare.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hydrate } = await import(path.join(here, '../src/services/hydrate.ts'));

const BASE = (process.env.BASE || 'http://localhost:9080/entrasp').replace(/\/$/, '');
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SID = process.env.SID || 'S8';
const CODICE = process.env.CODICE || 'P2155977';
const MENU_ID = 'menu.anag.menuAnaUni.anagraficheUnQuery';
const QUERY_VIEW = 'anagraficheUnQuery';
const DETAIL_VIEW = 'anagraficheUnDetail';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const LIST_ONLY = argv.includes('--list');
const VERBOSE = argv.includes('--verbose');

// ---------------------------------------------------------------- trasporto

let cookie = '';

function login() {
  const wsRoot = path.join(here, '../..');
  const local = path.join(wsRoot, 'bin/entrasp-sql');
  const inWorktree = existsSync(local);
  const r = spawnSync(inWorktree ? local : 'entrasp-sql', ['--login-session', USER, '--to', BASE + '/app/'], {
    encoding: 'utf8',
    env: inWorktree
      ? { ...process.env, ENTRASP_WS_ROOT: process.env.ENTRASP_WS_ROOT || wsRoot }
      : { ...process.env, ENTRASP_WS: process.env.ENTRASP_WS || 'ui-new' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/https?:\/\/localhost:\d+\/[0-9a-f]{32}/);
  if (!m) throw new Error('login-session non riuscito: ' + out.replace(/[0-9a-f]{32}/g, '<token>').trim());
  return m[0];
}

async function openSession() {
  const resp = await fetch(login(), { redirect: 'manual' });
  const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie') || ''];
  const js = sc.map((c) => c.match(/JSESSIONID=([^;]+)/)).find(Boolean);
  if (!js) throw new Error('il link monouso non ha impostato JSESSIONID (status ' + resp.status + ')');
  cookie = 'JSESSIONID=' + js[1];
}

function relaxedToJson(text) {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  return t.replace(/'([^']*)'/g, (_m, s) => JSON.stringify(s))
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
}

let requestCount = 0;
async function post(endpoint, params, formValues) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  for (const [k, v] of Object.entries(formValues || {})) body.append(k, v);
  requestCount++;
  const t0 = Date.now();
  const resp = await fetch(BASE + '/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
  });
  const text = await resp.text();
  if (VERBOSE) console.log(`    -> ${params.action} ${resp.status} ${text.length}B ${Date.now() - t0}ms`);
  if (!resp.ok) return { __http: resp.status, __text: text.slice(0, 500) };
  try { return JSON.parse(text); } catch {
    const relaxed = relaxedToJson(text);
    if (relaxed) try { return JSON.parse(relaxed); } catch { /* sotto */ }
    return { __unparsable: text.slice(0, 500) };
  }
}

// ------------------------------------------------------- stato del "client"

const templates = new Map();
const newTab = () => ({ ui: null, templateKey: null, toolbar: [], bindings: {}, scopePaths: {}, formValues: {} });

function walkControls(rows, fn) {
  for (const row of rows || []) {
    for (const cell of row.cells || []) {
      if (cell.control) {
        fn(cell.control);
        if (cell.control.contentRows) walkControls(cell.control.contentRows, fn);
      }
      if (cell.rows) walkControls(cell.rows, fn);
    }
  }
}

/** Come Shell.extractFormValues: controlli modificabili, valori scalari. */
function extractFormValues(ui) {
  const values = {};
  walkControls(ui.rows, (ctrl) => {
    if (ctrl.editable && !ctrl.noPost && !ctrl.disabled) {
      const name = ctrl.name || ctrl.id;
      if (name && ctrl.value != null && typeof ctrl.value !== 'object') values[name] = String(ctrl.value);
    }
  });
  return values;
}

function applyResponse(tab, resp) {
  if (resp.toolbar) tab.toolbar = resp.toolbar;
  const metaTemplate = resp.templateKey ? resp.template ?? templates.get(resp.templateKey) : undefined;
  if (resp.templateKey && metaTemplate) {
    if (resp.template) templates.set(resp.templateKey, resp.template);
    tab.bindings = resp.bindings ?? {};
    tab.scopePaths = resp.scopePaths ?? {};
    tab.ui = hydrate(metaTemplate, resp.values, resp.dynProps, tab.bindings, tab.scopePaths);
    tab.templateKey = resp.templateKey;
    tab.formValues = extractFormValues(tab.ui);
    return 'METADATA';
  }
  if (resp.templateKey && !metaTemplate) return 'TEMPLATE-MISS';
  if (resp.ui?.dataOnly && resp.ui.templateKey) {
    const tpl = templates.get(resp.ui.templateKey);
    if (!tpl) return 'TEMPLATE-MISS';
    tab.bindings = resp.bindings ?? tab.bindings;
    tab.scopePaths = resp.scopePaths ?? tab.scopePaths;
    tab.ui = hydrate(tpl, resp.ui.values, resp.ui.dynProps, tab.bindings, tab.scopePaths);
    tab.templateKey = resp.ui.templateKey;
    tab.formValues = extractFormValues(tab.ui);
    return 'DATA';
  }
  if (resp.ui && !(resp.ui.rowUpdate || resp.ui.pageOnly || resp.ui.detailPageOnly)) {
    tab.ui = resp.ui;
    tab.templateKey = resp.ui.templateKey ?? null;
    tab.formValues = extractFormValues(resp.ui);
    return 'FULL';
  }
  return 'NONE';
}

const viewNameOf = (tab) => tab.ui?.viewName || (tab.templateKey || '').split(':')[0];

function findControl(tab, controlName) {
  let found = null;
  if (tab.ui) walkControls(tab.ui.rows, (c) => { if (!found && c.controlName === controlName && c.type) found = c; });
  return found;
}

function errorsOf(resp) {
  if (resp.__http) return [`HTTP ${resp.__http}: ${resp.__text}`];
  if (resp.__unparsable) return [`risposta non JSON: ${resp.__unparsable}`];
  if (resp.noSession) return ['noSession (Sessione non valida)'];
  if (resp.notLoggedIn) return ['notLoggedIn'];
  return (resp.errors || []).filter((e) => e.type === 'ERROR').map((e) => e.message || e.mnemonic || JSON.stringify(e));
}

async function action(tab, name, params = {}, formValues = tab.formValues, sid = SID) {
  const p = { action: name, sid, ...params, hasTemplate: '1' };
  if (tab.templateKey) p.templateKey = tab.templateKey;
  const resp = await post('controller', p, { ...formValues });
  const mode = applyResponse(tab, resp);
  return { resp, mode, errors: errorsOf(resp) };
}

/** Tutti gli oggetti dell'albero che portano la chiave data. */
function deepFind(node, key, out = []) {
  if (Array.isArray(node)) { for (const n of node) deepFind(n, key, out); return out; }
  if (node && typeof node === 'object') {
    if (key in node) out.push(node);
    for (const v of Object.values(node)) deepFind(v, key, out);
  }
  return out;
}

const docIcons = (tab) => deepFind(tab.ui, 'docIcon').map((o) => o.docIcon).filter(Boolean);

/** Un bottone della barra, anche dentro un menu a tendina. Il server accoda al
 *  nome il percorso del viewstate (docS8-0, docxlsS8-0): si riconosce col sid. */
const toolbarButton = (tab, id) => deepFind(tab.toolbar, 'handler')
  .find((b) => new RegExp(`^${id}S\\d+-`).test(b.id || ''));

/** Mappa, ricerca sul codice, primo rigo: il dettaglio vero, come il clic. */
async function openDetail(sid = SID) {
  const tab = newTab();
  const opened = await post('controller', { action: 'ExecuteMenuItem', menuId: MENU_ID, sid, hasTemplate: '1' });
  applyResponse(tab, opened);
  const oe = errorsOf(opened);
  if (oe.length) throw new Error('apertura della mappa: ' + oe.join(' | '));
  if (viewNameOf(tab) !== QUERY_VIEW) throw new Error(`apertura: attesa ${QUERY_VIEW}, arrivata ${viewNameOf(tab)}`);

  const ctl = findControl(tab, 'codice');
  const fv = { ...tab.formValues };
  if (ctl) fv[ctl.name || ctl.id] = CODICE;
  let r = await action(tab, 'ExecuteQuery', {}, fv, sid);
  if (r.errors.length) throw new Error('ricerca: ' + r.errors.join(' | '));

  if (viewNameOf(tab) !== DETAIL_VIEW) {
    const row = deepFind(r.resp, '_selectorCommand').concat(deepFind(tab.ui, '_selectorCommand'))
      .find((o) => o._selectorCommand);
    if (!row) throw new Error(`nessun rigo per il codice ${CODICE} (vista ${viewNameOf(tab)})`);
    const navpath = row.props?.path || row._path || row.path;
    if (!navpath) throw new Error('rigo senza percorso: ' + Object.keys(row).join(','));
    r = await action(tab, row._selectorCommand, { navpath }, tab.formValues, sid);
    if (r.errors.length) throw new Error('apertura del rigo: ' + r.errors.join(' | '));
  }
  if (viewNameOf(tab) !== DETAIL_VIEW) throw new Error(`atteso ${DETAIL_VIEW}, siamo su ${viewNameOf(tab)}`);
  return tab;
}

/** Il file che il client scarica con LoadFile dopo il callback di HelpDownload. */
async function fetchOfferedFile(resp, sid = SID) {
  const cb = resp.uiData?.callback;
  const m = cb && cb.match(/fileName:\s*"([^"]+)".*?type:\s*"([^"]+)".*?index:\s*"([^"]*)"/);
  if (!m) return { error: `nessun file offerto (uiData.callback = ${JSON.stringify(cb)})` };
  const [, fileName, type, index] = m;
  const body = new URLSearchParams({
    action: 'LoadFile', sid, fileName: decodeURIComponent(fileName), type, index: decodeURIComponent(index),
  });
  requestCount++;
  const f = await fetch(BASE + '/controller2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
  });
  const bytes = Buffer.from(await f.arrayBuffer());
  return { status: f.status, type, index: decodeURIComponent(index), bytes };
}

/** Il testo dei fogli dell'.xlsx (null se `unzip` non c'e' sulla macchina). */
function xlsxText(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sxadv5776-'));
  try {
    const f = path.join(dir, 'f.xlsx');
    writeFileSync(f, bytes);
    const r = spawnSync('unzip', ['-p', f, 'xl/sharedStrings.xml', 'xl/worksheets/*.xml'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return r.error ? null : r.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------- casi

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const cases = [
  {
    name: 'La barra del dettaglio offre Redigi, Scarica e Aiuto',
    run: async () => {
      const tab = await openDetail();
      const problems = [];
      const expect = {
        doc: /^doAction\.createCallback\('ToggleDoc'\)$/,
        docxls: new RegExp(`^doAction2\\.createCallback\\('HelpDownload', '${DETAIL_VIEW}'\\)$`),
        help: new RegExp(`^EntrAsp\\.UI\\.Shell\\.showInWindow\\.createCallback\\('GetViewHelp', '${DETAIL_VIEW}'\\)$`),
      };
      for (const [id, re] of Object.entries(expect)) {
        const b = toolbarButton(tab, id);
        if (!b) problems.push(`pulsante "${id}" assente`);
        else if (!re.test(b.handler)) problems.push(`pulsante "${id}": handler ${b.handler}`);
      }
      return { problems };
    },
  },
  {
    name: '5776 GetViewHelp risponde con items, non {}',
    run: async () => {
      await openDetail();
      const resp = await post('controller2', { action: 'GetViewHelp', sid: SID, viewName: DETAIL_VIEW });
      const problems = errorsOf(resp);
      if (!problems.length && !Array.isArray(resp.items)) {
        problems.push(`items assente: ${JSON.stringify(resp).slice(0, 200)} (nessun HelpSupplier configurato?)`);
      }
      return { problems, info: `${resp.items?.length} voci` };
    },
  },
  {
    name: 'GetViewHelp su una vista inesistente: items vuoto, nessun errore',
    run: async () => {
      const resp = await post('controller2', { action: 'GetViewHelp', sid: SID, viewName: 'vistaCheNonEsiste' });
      const problems = errorsOf(resp);
      if (!problems.length && !(Array.isArray(resp.items) && resp.items.length === 0)) {
        problems.push(`atteso items=[], arrivato ${JSON.stringify(resp).slice(0, 200)}`);
      }
      return { problems };
    },
  },
  {
    name: '5774 HelpDownload su anagraficheUnDetail: nessun errore e un .xlsx con le righe della vista',
    run: async () => {
      const tab = await openDetail();
      const r = await action(tab, 'HelpDownload', { navpath: DETAIL_VIEW });
      if (r.errors.length) return { problems: r.errors };
      const f = await fetchOfferedFile(r.resp);
      if (f.error) return { problems: [f.error] };
      const problems = [];
      if (f.status !== 200) problems.push(`LoadFile HTTP ${f.status}`);
      if (!f.type.includes('spreadsheetml')) problems.push(`tipo ${f.type}`);
      if (f.bytes.subarray(0, 2).toString() !== 'PK') problems.push(`non e' uno zip: ${f.bytes.subarray(0, 40).toString()}`);
      const text = xlsxText(f.bytes);
      if (text != null && !text.includes(DETAIL_VIEW)) problems.push(`il foglio non nomina ${DETAIL_VIEW}`);
      // Le viste incorporate vengono percorse: "testa" e' dentro il dettaglio.
      if (text != null && !text.includes('anagraficheUnTestaDetail+')) problems.push('il foglio non ha i campi della vista incorporata anagraficheUnTestaDetail');
      return { problems, info: `${f.index} ${f.bytes.length}B` };
    },
  },
  {
    name: '5774 Dopo HelpDownload la scheda e\' ancora sul dettaglio',
    run: async () => {
      const tab = await openDetail();
      const r = await action(tab, 'HelpDownload', { navpath: DETAIL_VIEW });
      if (r.errors.length) return { problems: r.errors };
      if (viewNameOf(tab) !== DETAIL_VIEW) return { problems: [`dopo il download la scheda e' su ${viewNameOf(tab)}`] };
      const f = await fetchOfferedFile(r.resp);
      if (f.error) return { problems: [f.error] };
      const after = await action(tab, 'Refresh', { full: '1' });
      const problems = [...after.errors];
      if (viewNameOf(tab) !== DETAIL_VIEW) problems.push(`dopo Refresh la scheda e' su ${viewNameOf(tab)} (modo ${after.mode})`);
      if (!docIconFree(tab)) problems.push('docIcon senza modalita\' documentazione');
      return { problems };
    },
  },
  {
    name: '5773 ToggleDoc avanti e indietro: docIcon compare e sparisce, col template giusto',
    run: async () => {
      const tab = await openDetail();
      const problems = [];
      if (docIcons(tab).length) problems.push(`prima di ToggleDoc ci sono gia' ${docIcons(tab).length} docIcon`);
      const plainKey = tab.templateKey;

      const on = await action(tab, 'ToggleDoc');
      problems.push(...on.errors.map((e) => `on: ${e}`));
      if (on.mode === 'TEMPLATE-MISS') problems.push('on: template mancante');
      const nOn = docIcons(tab).length;
      if (!nOn) problems.push(`on: nessun docIcon (modo ${on.mode}, chiave ${tab.templateKey})`);
      if (!/:doc$/.test(tab.templateKey || '')) problems.push(`on: chiave ${tab.templateKey}, attesa :doc`);
      if (toolbarButton(tab, 'doc')?.pressed !== true) problems.push('on: pulsante non premuto');
      for (const d of docIcons(tab)) {
        if (d.viewName !== DETAIL_VIEW) { problems.push(`on: docIcon.viewName ${d.viewName}, atteso il dettaglio radice`); break; }
        if (!/^\w+\+.+$/.test(d.itemId || '')) { problems.push(`on: docIcon.itemId ${d.itemId}`); break; }
      }

      const off = await action(tab, 'ToggleDoc');
      problems.push(...off.errors.map((e) => `off: ${e}`));
      if (off.mode === 'TEMPLATE-MISS') problems.push('off: template mancante');
      if (docIcons(tab).length) problems.push(`off: restano ${docIcons(tab).length} docIcon (modo ${off.mode}, chiave ${tab.templateKey})`);
      if (/:doc$/.test(tab.templateKey || '')) problems.push(`off: chiave ${tab.templateKey}`);
      if (plainKey && tab.templateKey !== plainKey) problems.push(`off: chiave ${tab.templateKey}, attesa ${plainKey}`);
      if (toolbarButton(tab, 'doc')?.pressed) problems.push('off: pulsante ancora premuto');

      // Il client ha ormai in mano il template :doc: rientrare non deve perderlo.
      const again = await action(tab, 'ToggleDoc');
      problems.push(...again.errors.map((e) => `di nuovo on: ${e}`));
      if (again.mode === 'TEMPLATE-MISS') problems.push('di nuovo on: template mancante');
      if (docIcons(tab).length !== nOn) problems.push(`di nuovo on: ${docIcons(tab).length} docIcon, prima erano ${nOn}`);
      await action(tab, 'ToggleDoc');
      return { problems, info: `${nOn} docIcon` };
    },
  },
  {
    name: '5773 La ? di un campo apre helpDetail (poi Cancel, nessun salvataggio)',
    run: async () => {
      const tab = await openDetail();
      const on = await action(tab, 'ToggleDoc');
      if (on.errors.length) return { problems: on.errors };
      const d = docIcons(tab)[0];
      if (!d) return { problems: ['nessun docIcon da cliccare'] };
      const r = await action(tab, 'NavigateHelp', { navpath: `${d.viewName}|${d.itemId}` });
      const problems = [...r.errors];
      if (!problems.length && viewNameOf(tab) !== 'helpDetail') problems.push(`atteso helpDetail, siamo su ${viewNameOf(tab)}`);
      await action(tab, 'Cancel');
      return { problems, info: d.itemId };
    },
  },
];

function docIconFree(tab) { return docIcons(tab).length === 0; }

// ------------------------------------------------------------------- main

const selected = cases.filter((c) => !ONLY || c.name.toLowerCase().includes(ONLY.toLowerCase()));
if (LIST_ONLY) { for (const c of selected) console.log(c.name); process.exit(0); }

try { await openSession(); } catch (e) {
  console.error('FAIL  accesso: ' + e.message);
  process.exit(2);
}

const t0 = Date.now();
for (const c of selected) {
  try {
    const r = await c.run();
    if (r.skip) { console.log(`SKIP  ${c.name}  -- ${r.skip}`); continue; }
    const info = VERBOSE && r.info ? ` {${r.info}}` : '';
    record(c.name, r.problems.length === 0, r.problems.join(' ; ') + info);
  } catch (e) {
    record(c.name, false, 'eccezione nella prova: ' + e.message);
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS, ${failed} FAIL — ${requestCount} richieste, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
