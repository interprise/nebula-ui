/**
 * SXADV-5958 — filtro "Stato SDI" (MultiSelect con reload) sulla mappa Fatture
 * attive: prova LIVE a livello di protocollo, indipendente dall'implementazione.
 * Parla col Tomcat vero come il client React (form-urlencoded su
 * /entrasp/controller, sid proprio, hasTemplate=1 + templateKey, TUTTI i valori
 * di form a ogni azione, idratazione col VERO src/services/hydrate.ts).
 *
 * Contratto provato (Contabilita' > Fatt. attiva > Fatture = docCliQuery):
 *   1. Post di stSdi con due chiavi (prese dalle opzioni del server) -> la mappa
 *      ridisegnata porta tutte e due in selectedItems/value;
 *   2. Post con una chiave -> una sola;
 *   3. Post col valore VUOTO (tolta l'ultima pastiglia) -> selezione vuota: il
 *      filtro e' tolto. Il CORE rispondeva con la selezione di prima;
 *   4. Post di un altro campo SENZA il parametro stSdi -> selezione invariata;
 *   5. Post con "$$DUMMY" -> selezione invariata;
 *   6. le risposte di questi ricaricamenti portano `templateKey` alla radice:
 *      e' per questo che il client non puo' usarlo per riconoscere una pagina
 *      nuova (il cursore finiva su "ID DOC" e la mappa tornava in cima).
 *
 * SOLA LETTURA: ExecuteMenuItem, MultiSelectList, Post dei filtri, ClearQuery.
 * Mai Salva/Nuovo/Elimina.
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <app>` (link monouso,
 * cookie di sessione; nessuna password passa di qui).
 *
 * Uso (da entrasp-ui/, Node >= 22.6 per importare il .ts del client):
 *   node e2e/sxadv5958-multiselect.live.mjs [--only <sottostringa>] [--list] [--verbose]
 *   BASE=http://localhost:9080/entrasp  USER_LOGIN=44AMM  SID=S8  (default)
 * Esce con 1 se almeno un caso fallisce, 2 se non riesce a entrare.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hydrate } = await import(path.join(here, '../src/services/hydrate.ts'));

const BASE = (process.env.BASE || 'http://localhost:9080/entrasp').replace(/\/$/, '');
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SID = process.env.SID || 'S8';
const MENU_ID = 'menu.documenti.FA';
const QUERY_VIEW = 'docCliQuery';
const CN = 'stSdi';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const LIST_ONLY = argv.includes('--list');
const VERBOSE = argv.includes('--verbose');

// ---------------------------------------------------------------- trasporto

let cookie = '';

function login() {
  const r = spawnSync('entrasp-sql', ['--login-session', USER, '--to', BASE + '/app/'], {
    encoding: 'utf8',
    env: { ...process.env, ENTRASP_WS: process.env.ENTRASP_WS || 'ui-new' },
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
const newTab = () => ({ ui: null, templateKey: null, bindings: {}, scopePaths: {}, formValues: {} });

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

async function action(tab, name, params = {}, formValues = tab.formValues) {
  const p = { action: name, sid: SID, ...params, hasTemplate: '1' };
  if (tab.templateKey) p.templateKey = tab.templateKey;
  const resp = await post('controller', p, { ...formValues });
  const mode = applyResponse(tab, resp);
  return { resp, mode, errors: errorsOf(resp) };
}

async function openQuery() {
  const tab = newTab();
  const resp = await post('controller', { action: 'ExecuteMenuItem', menuId: MENU_ID, sid: SID, hasTemplate: '1' });
  applyResponse(tab, resp);
  const errors = errorsOf(resp);
  if (errors.length) throw new Error('apertura della mappa: ' + errors.join(' | '));
  if (viewNameOf(tab) !== QUERY_VIEW) throw new Error(`apertura: attesa ${QUERY_VIEW}, arrivata ${viewNameOf(tab)}`);
  // Parte pulita: una selezione rimasta da un giro precedente non deve contare.
  await action(tab, 'ClearQuery');
  return tab;
}

function stSdi(tab) {
  const c = findControl(tab, CN);
  if (!c) throw new Error(`controllo ${CN} non trovato sulla mappa`);
  return c;
}

/** La selezione che il server ha ridisegnato: chiavi da selectedItems e da value. */
function shownSelection(tab) {
  const c = stSdi(tab);
  const fromItems = Array.isArray(c.selectedItems) ? c.selectedItems.map((i) => String(i.value)) : [];
  const fromValue = c.value == null || c.value === '' ? [] : String(c.value).split(',').map((s) => s.trim()).filter(Boolean);
  return { items: fromItems.sort(), value: fromValue.sort() };
}

async function options(tab) {
  const c = stSdi(tab);
  if (Array.isArray(c.options) && c.options.length) return c.options;
  const resp = await post('controller2', {
    action: 'MultiSelectList', sid: SID, navpath: c.navpath || '', option1: c.controlName || c.name, query: '',
  });
  const errs = errorsOf(resp);
  if (errs.length) throw new Error(`MultiSelectList: ${errs.join(' | ')}`);
  return resp.rows || [];
}
const realKeys = (opts) => opts
  .map((o) => o.value).filter((v) => v != null && String(v).trim() !== '' && v !== 'NULL').map(String);

/** Il Post che il controllo manda alla Conferma / alla X: formValues con stSdi = value. */
async function postStSdi(tab, value) {
  const c = stSdi(tab);
  const name = c.name || c.id;
  const fv = { ...tab.formValues, [name]: value };
  return action(tab, c.command || 'Post', { navpath: c.navpath || '', option1: c.option1 || '' }, fv);
}

// ------------------------------------------------------------------- casi

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function expectSelection(tab, r, expected, label) {
  const problems = [];
  if (r.errors.length) problems.push(`${label}: ERROR ${r.errors.join(' | ').slice(0, 300)}`);
  if (r.mode === 'TEMPLATE-MISS') problems.push(`${label}: template mancante`);
  if (problems.length) return problems;
  if (viewNameOf(tab) !== QUERY_VIEW) problems.push(`${label}: attesa ${QUERY_VIEW}, siamo su ${viewNameOf(tab)}`);
  const s = shownSelection(tab);
  if (!same(s.items, expected)) problems.push(`${label}: selectedItems ${JSON.stringify(s.items)}, atteso ${JSON.stringify(expected)}`);
  if (!same(s.value, expected)) problems.push(`${label}: value ${JSON.stringify(s.value)}, atteso ${JSON.stringify(expected)}`);
  return problems;
}

/** Apre la mappa e sceglie due chiavi vere dalle opzioni del server. */
async function setup() {
  const tab = await openQuery();
  const keys = realKeys(await options(tab));
  if (keys.length < 2) return { skip: `servono almeno 2 opzioni di Stato SDI, trovate ${keys.length}` };
  return { tab, k1: keys[0], k2: keys[1] };
}

const cases = [
  {
    name: '5958.1 Conferma con due voci: il ridisegno le porta tutte e due',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r = await postStSdi(s.tab, `${s.k1},${s.k2}`);
      return { problems: expectSelection(s.tab, r, [s.k1, s.k2], 'Post 2 voci'), info: `${s.k1},${s.k2} (${r.mode})` };
    },
  },
  {
    name: '5958.2 X su una pastiglia: resta una voce',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r1 = await postStSdi(s.tab, `${s.k1},${s.k2}`);
      const p = expectSelection(s.tab, r1, [s.k1, s.k2], 'Post 2 voci');
      if (p.length) return { problems: p };
      const r2 = await postStSdi(s.tab, s.k2);
      return { problems: expectSelection(s.tab, r2, [s.k2], 'Post 1 voce') };
    },
  },
  {
    name: 'X sull\'ultima pastiglia: valore VUOTO -> filtro tolto (difetto CORE parseValue)',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r1 = await postStSdi(s.tab, s.k1);
      const p = expectSelection(s.tab, r1, [s.k1], 'Post 1 voce');
      if (p.length) return { problems: p };
      const r2 = await postStSdi(s.tab, '');
      return { problems: expectSelection(s.tab, r2, [], 'Post vuoto') };
    },
  },
  {
    name: 'Conferma con tutto deselezionato dal pannello: valore VUOTO -> filtro tolto',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r1 = await postStSdi(s.tab, `${s.k1},${s.k2}`);
      const p = expectSelection(s.tab, r1, [s.k1, s.k2], 'Post 2 voci');
      if (p.length) return { problems: p };
      const r2 = await postStSdi(s.tab, '');
      return { problems: expectSelection(s.tab, r2, [], 'Post vuoto') };
    },
  },
  {
    name: 'Post di un altro campo SENZA il parametro stSdi: selezione invariata',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r1 = await postStSdi(s.tab, `${s.k1},${s.k2}`);
      const p = expectSelection(s.tab, r1, [s.k1, s.k2], 'Post 2 voci');
      if (p.length) return { problems: p };
      const name = stSdi(s.tab).name || stSdi(s.tab).id;
      const fv = { ...s.tab.formValues };
      delete fv[name];
      const num = findControl(s.tab, 'numDocDa');
      if (num) fv[num.name || num.id] = '1';
      const r2 = await action(s.tab, 'Post', {}, fv);
      return { problems: expectSelection(s.tab, r2, [s.k1, s.k2], 'Post senza stSdi') };
    },
  },
  {
    name: 'Post con "$$DUMMY": selezione invariata',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r1 = await postStSdi(s.tab, s.k1);
      const p = expectSelection(s.tab, r1, [s.k1], 'Post 1 voce');
      if (p.length) return { problems: p };
      const r2 = await postStSdi(s.tab, '$$DUMMY');
      return { problems: expectSelection(s.tab, r2, [s.k1], 'Post $$DUMMY') };
    },
  },
  {
    name: 'Il ricaricamento di stSdi porta templateKey alla radice (non distingue una pagina nuova)',
    run: async () => {
      const s = await setup(); if (s.skip) return s;
      const r = await postStSdi(s.tab, s.k1);
      const problems = [];
      if (r.errors.length) problems.push('ERROR ' + r.errors.join(' | '));
      else if (!r.resp.templateKey) {
        problems.push(`nessun templateKey alla radice (modo ${r.mode}): il presupposto del ticket non vale piu'`);
      }
      return { problems, info: `templateKey=${r.resp.templateKey} modo=${r.mode}` };
    },
  },
];

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
// Lascia la mappa pulita per chi viene dopo sullo stesso sid.
try { await post('controller', { action: 'ClearQuery', sid: SID, hasTemplate: '1' }); } catch { /* niente */ }
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS, ${failed} FAIL — ${requestCount} richieste, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
