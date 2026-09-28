/**
 * SXADV-5960 — ri-disegno di una mappa di interrogazione con i filtri compilati.
 * Prova LIVE, indipendente dall'implementazione: parla col Tomcat vero come fa il
 * client React (stesso protocollo: form-urlencoded su /entrasp/controller, sid
 * proprio, hasTemplate=1 + templateKey, TUTTI i valori di form a ogni azione,
 * Post immediato per i campi con reload, idratazione del template con il VERO
 * src/services/hydrate.ts del client).
 *
 * Contratto provato (Contabilita' > Fatt. attiva > Fatture = docCliQuery, che
 * incorpora documentiHeaderQuery), per OGNI filtro di tipo lookup / tendina /
 * WorkflowStatus / MultiSelect / CheckFilter / data:
 *   1. aperta la mappa da menu (ExecuteMenuItem: history azzerata), compilato il
 *      filtro con un valore preso dalle opzioni che il server stesso manda;
 *   2. se il campo ha reload, il Post che il client manda subito non da' ERROR
 *      e ridisegna la mappa col valore;
 *   3. Esegui (ExecuteQuery) non da' ERROR;
 *   4. se si e' arrivati altrove (lista/dettaglio), la briciola BackTo torna
 *      alla mappa senza ERROR;
 *   5. sulla mappa ridisegnata il controllo di quel filtro porta ancora il
 *      valore spedito.
 * Piu' i casi del collaudo (5960.1 Sede 008 + Stato Confermato; 5960.2 Stato
 * Confermato -> Esegui -> indietro; Pulisci dopo) e una ricerca a zero righe
 * con lo Stato impostato (resta sulla mappa: e' anch'essa un ridisegno).
 * SXADV-6005: i casi "Non Valorizzato" (voce NULL della tendina) verificano
 * anche il TESTO ridisegnato (displayText/displayValue = l'etichetta della voce
 * NULL fra le opzioni del server), e lo scenario del collaudo Sede = Non
 * Valorizzato -> Esegui: a zero righe si resta sulla mappa senza ERROR, con
 * l'avviso NO_DATA_FOUND, e la Sede resta NULL / "Non Valorizzato".
 * Solo questi: --only 'non valorizzato'
 *
 * SOLA LETTURA: solo ExecuteMenuItem, ListUIControlList, MultiSelectList, Post
 * dei filtri di una mappa di query, ExecuteQuery, BackTo, ClearQuery. Mai
 * Salva/Nuovo/Elimina.
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <app>` stampa un link
 * monouso che imposta il cookie di sessione; qui lo si segue senza redirect e
 * si tiene il JSESSIONID. Nessuna password passa di qui.
 *
 * Uso (da entrasp-ui/, Node >= 22.6 per importare il .ts del client):
 *   node e2e/sxadv5960-query-rerender.live.mjs [--only <sottostringa>] [--list] [--verbose] [--extended]
 *   BASE=http://localhost:9080/entrasp  USER_LOGIN=44AMM  SID=S7  (default)
 *   ENTRASP_WS=ui-new                                     (workspace per entrasp-sql)
 * --extended aggiunge tutti gli altri filtri a tendina della mappa (non solo
 * quelli elencati dal ticket).
 * Esce con codice 1 se almeno un caso fallisce, 2 se non riesce ad entrare.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hydrate } = await import(path.join(here, '../src/services/hydrate.ts'));

const BASE = (process.env.BASE || 'http://localhost:9080/entrasp').replace(/\/$/, '');
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SID = process.env.SID || 'S7';
const MENU_ID = 'menu.documenti.FA'; // Contabilita' > Fatt. attiva > Fatture
const QUERY_VIEW = 'docCliQuery';
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const LIST_ONLY = argv.includes('--list');
const VERBOSE = argv.includes('--verbose');
const EXTENDED = argv.includes('--extended');

// ---------------------------------------------------------------- trasporto

let cookie = '';

function login() {
  const r = spawnSync('entrasp-sql', ['--login-session', USER, '--to', BASE + '/app/'], {
    encoding: 'utf8',
    env: { ...process.env, ENTRASP_WS: process.env.ENTRASP_WS || 'ui-new' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/https?:\/\/localhost:\d+\/[0-9a-f]{32}/);
  if (!m) {
    // Il messaggio di entrasp-sql non contiene segreti (solo esito/istruzioni).
    throw new Error('login-session non riuscito: ' + out.replace(/[0-9a-f]{32}/g, '<token>').trim());
  }
  return m[0];
}

async function openSession() {
  const link = login();
  const resp = await fetch(link, { redirect: 'manual' });
  const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie') || ''];
  const js = sc.map((c) => c.match(/JSESSIONID=([^;]+)/)).find(Boolean);
  if (!js) throw new Error('il link monouso non ha impostato JSESSIONID (status ' + resp.status + ')');
  cookie = 'JSESSIONID=' + js[1];
}

function relaxedToJson(text) {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  let out = t.replace(/'([^']*)'/g, (_m, s) => JSON.stringify(s));
  out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  return out;
}

let requestCount = 0;
async function post(endpoint, params, formValues) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  if (formValues) {
    for (const [k, v] of Object.entries(formValues)) {
      if (Array.isArray(v)) for (const x of v) body.append(k, x);
      else body.append(k, v);
    }
  }
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
  try {
    return JSON.parse(text);
  } catch {
    const relaxed = relaxedToJson(text);
    if (relaxed) try { return JSON.parse(relaxed); } catch { /* sotto */ }
    return { __unparsable: text.slice(0, 500) };
  }
}

// ------------------------------------------------------- stato del "client"

const templates = new Map(); // templateKey -> template (cache del client)

/** Il tab: quello che Shell tiene per un sid. */
function newTab() {
  return { ui: null, templateKey: null, bindings: {}, scopePaths: {}, formValues: {}, breadcrumbs: '' };
}

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

/** Copia di Shell.extractFormValues: solo controlli modificabili, valori scalari. */
function extractFormValues(ui) {
  const values = {};
  walkControls(ui.rows, (ctrl) => {
    if (ctrl.editable && !ctrl.noPost && !ctrl.disabled) {
      const name = ctrl.name || ctrl.id;
      if (name && ctrl.value != null && typeof ctrl.value !== 'object') values[name] = String(ctrl.value);
      if (name && ctrl.negation && ctrl.negationValue) {
        const i = name.lastIndexOf('.');
        values[i >= 0 ? name.slice(0, i) + '$not' + name.slice(i) : name + '$not'] = '1';
      }
    }
  });
  return values;
}

/** I rami di Shell.processResponseInner che toccano ui/formValues. */
function applyResponse(tab, resp) {
  if (resp.breadcrumbs !== undefined) tab.breadcrumbs = resp.breadcrumbs;
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
    if (resp.ui.breadcrumbs !== undefined) tab.breadcrumbs = resp.ui.breadcrumbs;
    return 'FULL';
  }
  return 'NONE';
}

function viewNameOf(tab) {
  return tab.ui?.viewName || (tab.templateKey || '').split(':')[0];
}

function findControl(tab, controlName) {
  let found = null;
  if (tab.ui) walkControls(tab.ui.rows, (c) => { if (!found && c.controlName === controlName && c.type) found = c; });
  return found;
}

/** Errori da mostrare all'utente come errore: tipo ERROR, o risposta non JSON/HTTP != 200. */
function errorsOf(resp) {
  if (resp.__http) return [`HTTP ${resp.__http}: ${resp.__text}`];
  if (resp.__unparsable) return [`risposta non JSON: ${resp.__unparsable}`];
  if (resp.noSession) return ['noSession (Sessione non valida)'];
  if (resp.notLoggedIn) return ['notLoggedIn'];
  return (resp.errors || []).filter((e) => e.type === 'ERROR').map((e) => e.message || e.mnemonic || JSON.stringify(e));
}

async function action(tab, name, params = {}, { noFormValues = false } = {}) {
  const p = { action: name, sid: SID, ...params, hasTemplate: '1' };
  if (tab.templateKey) p.templateKey = tab.templateKey;
  const resp = await post('controller', p, noFormValues ? undefined : { ...tab.formValues });
  const mode = applyResponse(tab, resp);
  return { resp, mode, errors: errorsOf(resp) };
}

async function openQuery() {
  const tab = newTab();
  const resp = await post('controller', { action: 'ExecuteMenuItem', menuId: MENU_ID, sid: SID, hasTemplate: '1' });
  const mode = applyResponse(tab, resp);
  const errors = errorsOf(resp);
  if (errors.length) throw new Error('apertura della mappa: ' + errors.join(' | '));
  if (viewNameOf(tab) !== QUERY_VIEW) throw new Error(`apertura: attesa ${QUERY_VIEW}, arrivata ${viewNameOf(tab)} (${mode})`);
  return tab;
}

/** Imposta un campo come fa il controllo: formValues[name] = String(v); se il
 *  campo ha reload, parte subito il comando (Post) con navpath/option1. */
async function setField(tab, controlName, value, steps) {
  const ctrl = findControl(tab, controlName);
  if (!ctrl) throw new Error(`controllo ${controlName} non trovato sulla mappa`);
  const name = ctrl.name || ctrl.id;
  tab.formValues[name] = value == null ? '' : String(value);
  if (ctrl.reload && ctrl.reload !== 'false') {
    const r = await action(tab, ctrl.command || 'Post', { navpath: ctrl.navpath || '', option1: ctrl.option1 || '' });
    steps.push({ step: `reload(${controlName})`, ...r });
  }
}

function crumbs(html) {
  const out = [];
  const re = /onclick\s*=\s*["']?[^"'>]*?doAction[23]?\(\s*'([^']+)'(?:\s*,\s*'([^']*)')?(?:\s*,\s*'([^']*)')?\s*\)/gi;
  let m;
  while ((m = re.exec(html || ''))) out.push({ action: m[1], navpath: m[2], option1: m[3] });
  return out;
}

/** Torna alla mappa con la briciola, come il clic sulla prima briciola BackTo. */
async function backToQuery(tab, steps) {
  if (viewNameOf(tab) === QUERY_VIEW) return; // Esegui e' rimasto sulla mappa
  const back = crumbs(tab.breadcrumbs).find((c) => c.action === 'BackTo');
  if (!back) throw new Error(`nessuna briciola BackTo su ${viewNameOf(tab)}: ${String(tab.breadcrumbs).slice(0, 200)}`);
  const params = {};
  if (back.navpath) params.navpath = back.navpath;
  if (back.option1) params.option1 = back.option1;
  const r = await action(tab, 'BackTo', params);
  steps.push({ step: 'BackTo', ...r });
}

// ------------------------------------------------------------ valori validi

async function comboOptions(tab, controlName) {
  const ctrl = findControl(tab, controlName);
  if (!ctrl) throw new Error(`controllo ${controlName} non trovato`);
  if (Array.isArray(ctrl.options) && ctrl.options.length) return ctrl.options;
  const resp = await post('controller', {
    action: 'ListUIControlList', sid: SID, navpath: ctrl.navpath || '', option1: ctrl.controlName || ctrl.name,
    query: '', limit: '100', start: '0',
  });
  const errs = errorsOf(resp);
  if (errs.length) throw new Error(`ListUIControlList ${controlName}: ${errs.join(' | ')}`);
  return resp.rows || [];
}

async function multiSelectOptions(tab, controlName) {
  const ctrl = findControl(tab, controlName);
  if (!ctrl) throw new Error(`controllo ${controlName} non trovato`);
  if (Array.isArray(ctrl.options) && ctrl.options.length) return ctrl.options;
  const resp = await post('controller2', {
    action: 'MultiSelectList', sid: SID, navpath: ctrl.navpath || '', option1: ctrl.controlName || ctrl.name, query: '',
  });
  const errs = errorsOf(resp);
  if (errs.length) throw new Error(`MultiSelectList ${controlName}: ${errs.join(' | ')}`);
  return resp.rows || [];
}

// Su una mappa di query il server antepone "Non Valorizzato" (value NULL) alle
// voci vere: i casi principali scelgono una voce vera, NULL ha casi a parte.
const nonEmpty = (o) => o && o.value != null && String(o.value).trim() !== '' && o.value !== 'NULL';

/** Primo valore non vuoto; `prefer(text)` per sceglierne uno preciso se c'e'. */
function pick(options, prefer) {
  const valid = options.filter(nonEmpty);
  if (!valid.length) return null;
  return (prefer && valid.find((o) => prefer(String(o.text ?? ''), String(o.value)))) || valid[0];
}

// --------------------------------------------------------- confronto valori

function norm(v) {
  if (v === true || v === 'true' || v === '1' || v === 1) return 'true';
  if (v === false || v === 'false' || v === '0' || v === 0) return 'false';
  if (v == null) return '';
  return String(v).trim();
}

function shownValue(ctrl) {
  if (!ctrl) return undefined;
  return ctrl.value;
}

function sameValue(posted, shown, type) {
  if (type === 'multiselect') {
    const a = norm(posted).split(',').map((s) => s.trim()).filter(Boolean).sort().join(',');
    const b = (Array.isArray(shown) ? shown.join(',') : norm(shown)).split(',').map((s) => s.trim()).filter(Boolean).sort().join(',');
    return a === b;
  }
  if (type === 'number') return Number(String(posted).replace(',', '.')) === Number(String(shown).replace(',', '.'));
  return norm(posted) === norm(shown);
}

// ------------------------------------------------------------------- casi

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

/** Verifica generica: tutti i passi senza ERROR, si e' sulla mappa, e ogni filtro porta il valore. */
function verify(tab, steps, expected) {
  const problems = [];
  for (const s of steps) {
    if (s.errors.length) problems.push(`${s.step}: ERROR ${s.errors.join(' | ').slice(0, 300)}`);
    if (s.mode === 'TEMPLATE-MISS') problems.push(`${s.step}: il server ha omesso un template che il client non ha`);
  }
  if (!problems.length) {
    if (viewNameOf(tab) !== QUERY_VIEW) problems.push(`atteso ritorno su ${QUERY_VIEW}, siamo su ${viewNameOf(tab)}`);
    for (const [controlName, posted] of Object.entries(expected)) {
      const ctrl = findControl(tab, controlName);
      if (!ctrl) { problems.push(`${controlName}: controllo assente dopo il ridisegno`); continue; }
      const shown = shownValue(ctrl);
      if (!sameValue(posted, shown, ctrl.type)) {
        problems.push(`${controlName}: spedito ${JSON.stringify(posted)}, ridisegnato ${JSON.stringify(shown)}`);
      }
    }
  }
  return problems;
}

/** Testo mostrato da una tendina: il ramo di dettaglio manda `displayText`,
 *  quello di lista `displayValue` (ComboControl accetta entrambi). */
function shownText(ctrl) {
  if (!ctrl) return undefined;
  return ctrl.displayText ?? ctrl.displayValue;
}

/** SXADV-6005: oltre al valore, la tendina ridisegnata deve MOSTRARE il testo
 *  atteso (per "Non Valorizzato": l'etichetta della voce NULL delle opzioni). */
function verifyText(tab, expectedText) {
  const problems = [];
  for (const [controlName, text] of Object.entries(expectedText || {})) {
    const ctrl = findControl(tab, controlName);
    if (!ctrl) { problems.push(`${controlName}: controllo assente dopo il ridisegno`); continue; }
    const shown = shownText(ctrl);
    if (norm(shown) !== norm(text)) {
      problems.push(`${controlName}: testo atteso ${JSON.stringify(text)}, ridisegnato ${JSON.stringify(shown)} (value ${JSON.stringify(ctrl.value)})`);
    }
  }
  return problems;
}

/** Un filtro: apri, compila, (reload), Esegui, indietro, verifica.
 *  `chooser` torna il valore, oppure `{ value, text }` quando anche il testo
 *  mostrato dalla tendina ridisegnata va verificato. */
function filterCase(label, controlName, chooser) {
  return {
    name: `filtro ${label} [${controlName}]`,
    run: async () => {
      const tab = await openQuery();
      const chosen = await chooser(tab);
      const value = chosen != null && typeof chosen === 'object' ? chosen.value : chosen;
      const text = chosen != null && typeof chosen === 'object' ? chosen.text : undefined;
      if (value == null) return { skip: 'nessun valore disponibile fra le opzioni del server' };
      const expectedText = text != null ? { [controlName]: text } : {};
      const steps = [];
      await setField(tab, controlName, value, steps);
      const afterReload = steps.length
        ? [...verify(tab, steps, { [controlName]: value }), ...verifyText(tab, expectedText)]
        : [];
      const eq = await action(tab, 'ExecuteQuery');
      steps.push({ step: 'ExecuteQuery', ...eq });
      const landed = viewNameOf(tab);
      const eqMode = eq.mode;
      const msgs = (eq.resp.errors || []).map((e) => `${e.type}:${(e.message || '').slice(0, 60)}`).join(' / ');
      if (!eq.errors.length) await backToQuery(tab, steps);
      const problems = [...afterReload.map((p) => 'dopo il reload: ' + p), ...verify(tab, steps, { [controlName]: value })];
      if (!problems.length) problems.push(...verifyText(tab, expectedText));
      const via = landed === QUERY_VIEW ? `Esegui resta sulla mappa (${eqMode})` : `Esegui -> ${landed} -> BackTo (${steps[steps.length - 1].mode})`;
      return { problems: [...new Set(problems)], info: `valore ${JSON.stringify(value)}; ${via}${msgs ? ' [' + msgs + ']' : ''}` };
    },
  };
}

const firstOf = (controlName, prefer) => async (tab) => pick(await comboOptions(tab, controlName), prefer)?.value ?? null;
const statoConfermato = async (tab) => pick(await comboOptions(tab, 'stato'), (t, v) => /confermat/i.test(t) || v === 'C')?.value ?? null;
/** La voce "Non Valorizzato" come la manda il server fra le opzioni della
 *  tendina (value NULL, testo = MISSING_VALUE localizzato): valore e testo. */
const nonValorizzato = (controlName) => async (tab) => {
  const o = (await comboOptions(tab, controlName)).find((x) => x && x.value === 'NULL');
  return o ? { value: 'NULL', text: String(o.text ?? '') } : null;
};
const sede008 = async (tab) => pick(await comboOptions(tab, 'sedeEmissione'), (t, v) => /^\s*008\b/.test(t) || /(^|\|)008$/.test(v))?.value ?? null;

const cases = [
  // Filtri a tendina / lookup richiesti dal ticket
  filterCase('Sede', 'sedeEmissione', sede008),
  filterCase('Stato (WorkflowStatus)', 'stato', statoConfermato),
  filterCase('(Registrazione) Esercizio', 'esercizioReg', firstOf('esercizioReg', (t) => t.trim() === String(new Date().getFullYear()))),
  filterCase('(Protocollo) Numeratore', 'docCfg.numeratore', firstOf('docCfg.numeratore')),
  filterCase('Provenienza (code table)', 'provenienza', firstOf('provenienza')),
  filterCase('Causale Documento', 'causaleDocumento', firstOf('causaleDocumento')),
  filterCase('Condizione di pagamento (reload)', 'condizionePagamento', firstOf('condizionePagamento')),
  filterCase('Valuta', 'valuta', firstOf('valuta')),
  filterCase('Raggruppamento (reload)', 'raggruppamentoFatture', firstOf('raggruppamentoFatture')),
  filterCase('Flag Gestione', 'tabGestione', firstOf('tabGestione')),
  filterCase('Stato SDI (MultiSelect, reload)', 'stSdi', async (tab) => pick(await multiSelectOptions(tab, 'stSdi'))?.value ?? null),
  // "Non Valorizzato": una voce che l'utente sceglie dalla tendina come le altre.
  // SXADV-6005: valore NULL E testo "Non Valorizzato" (preso dalle opzioni del server).
  filterCase('Valuta = Non Valorizzato', 'valuta', nonValorizzato('valuta')),
  filterCase('Flag Gestione = Non Valorizzato', 'tabGestione', nonValorizzato('tabGestione')),
  filterCase('Sede = Non Valorizzato', 'sedeEmissione', nonValorizzato('sedeEmissione')),
  filterCase('Accompagnatorie (CheckFilter)', 'acc', async () => 'true'),
  filterCase('Data reg. da (data)', 'dataRegDa', async () => '01/01/2024'),
];

if (EXTENDED) {
  for (const [label, cn] of [
    ['(Competenza) Esercizio', 'esercizioComp'],
    ['Centro gestionale', 'centroGestionale'],
    ['Tipo bollo (code table)', 'tipoBollo'],
    ['Tipo pagamento (code table)', 'tipoPagamento'],
    ['Tipo pagamento escluso (code table)', 'noTipoPagamento'],
    ['Esenzione IVA', 'aliquotaEsenzioneIva'],
    ['Aliquota IVA', 'regIva.aliquotaIva'],
    ['Ns Conto Corrente', 'contoCorrenteAzienda'],
    ['Sottoconto ricavo', 'righeDocumento.sottoconto'],
    ['Sottoconto reg. contabili', 'regContabili.sottoconto'],
    ['Centro di costo (reload)', 'regAnaliticaTutte.centroCosto'],
    ['Soggetto (code table, reload)', 'anagrafica.anagraficaId.tipoSoggetto'],
  ]) cases.push(filterCase(label, cn, firstOf(cn)));
  cases.push(filterCase('Non impostato bollo (CheckFilter)', 'tipoBolloNull', async () => 'true'));
  cases.push(filterCase('No Stato SDI (CheckFilter)', 'noStato', async () => 'true'));
  cases.push(filterCase('Numero protocollo (numero)', 'numProtDa', async () => '1'));
}

cases.push({
  name: 'QA 5960.1: Sede 008 + Stato Confermato -> Esegui (e indietro)',
  run: async () => {
    const tab = await openQuery();
    const sede = await sede008(tab);
    const stato = await statoConfermato(tab);
    if (sede == null || stato == null) return { skip: `valori non disponibili (sede=${sede}, stato=${stato})` };
    const steps = [];
    await setField(tab, 'sedeEmissione', sede, steps);
    await setField(tab, 'stato', stato, steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    if (!eq.errors.length) await backToQuery(tab, steps);
    return { problems: verify(tab, steps, { sedeEmissione: sede, stato }), info: `sede=${sede} stato=${stato}` };
  },
});

cases.push({
  name: 'QA 5960.2: Stato Confermato -> Esegui -> indietro -> Pulisci',
  run: async () => {
    const tab = await openQuery();
    const stato = await statoConfermato(tab);
    if (stato == null) return { skip: 'Confermato non fra le opzioni' };
    const steps = [];
    await setField(tab, 'stato', stato, steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    const problems = [];
    if (!eq.errors.length) {
      await backToQuery(tab, steps);
      problems.push(...verify(tab, steps, { stato }));
    } else problems.push(...verify(tab, steps, {}));
    // Pulisci: dalla mappa (o da dove si e' rimasti) la mappa torna vuota, senza errori.
    const cl = await action(tab, 'ClearQuery');
    const clSteps = [{ step: 'ClearQuery', ...cl }];
    problems.push(...verify(tab, clSteps, {}).map((p) => 'Pulisci: ' + p));
    if (!cl.errors.length) {
      const st = findControl(tab, 'stato');
      if (st && norm(st.value) !== '') problems.push(`Pulisci: lo Stato resta ${JSON.stringify(st.value)}`);
    }
    return { problems: [...new Set(problems)] };
  },
});

cases.push({
  name: 'Zero righe con Stato impostato (resta sulla mappa)',
  run: async () => {
    const tab = await openQuery();
    const stato = await statoConfermato(tab);
    if (stato == null) return { skip: 'Confermato non fra le opzioni' };
    const steps = [];
    await setField(tab, 'stato', stato, steps);
    const impossible = 'SXADV5960-NESSUNO-' + Date.now();
    await setField(tab, 'numDocDa', impossible, steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    const problems = verify(tab, steps, { stato, numDocDa: impossible });
    return { problems, info: `esito: ${viewNameOf(tab)}` };
  },
});

cases.push({
  name: 'Zero righe con Stato + ID DOC inesistente (resta sulla mappa)',
  run: async () => {
    const tab = await openQuery();
    const stato = await statoConfermato(tab);
    if (stato == null) return { skip: 'Confermato non fra le opzioni' };
    if (!findControl(tab, 'idDocumento')) return { skip: 'ID DOC non visibile a questo utente' };
    const steps = [];
    await setField(tab, 'stato', stato, steps);
    await setField(tab, 'idDocumento', '-5960', steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    return { problems: verify(tab, steps, { stato, idDocumento: '-5960' }), info: `esito: ${viewNameOf(tab)}` };
  },
});

/** SXADV-6005, scenario del collaudo: Sede = Non Valorizzato -> Esegui. Se la
 *  ricerca resta sulla mappa (zero righe): nessun ERROR, l'avviso NO_DATA_FOUND
 *  ("L'interrogazione non ha restituito alcun risultato.") c'e' fra gli errors[]
 *  non bloccanti, e la Sede ridisegnata porta ancora NULL / "Non Valorizzato".
 *  Se invece arrivano righe (dati locali diversi da quelli di Elena), si torna
 *  con BackTo e si verifica lo stesso il ridisegno. */
function noDataProblems(eq) {
  const errs = eq.resp.errors || [];
  const noData = errs.find((e) => e.mnemonic === 'NO_DATA_FOUND')
    || errs.find((e) => e.type !== 'ERROR' && /non ha restituito alcun risultato/i.test(e.message || ''));
  if (!noData) return [`manca l'avviso di zero righe (NO_DATA_FOUND); errors[] = ${JSON.stringify(errs).slice(0, 300)}`];
  if (noData.type === 'ERROR') return [`l'avviso di zero righe arriva come ERROR: ${noData.message}`];
  return [];
}

cases.push({
  name: 'QA 6005: Sede = Non Valorizzato -> Esegui (resta Non Valorizzato)',
  run: async () => {
    const tab = await openQuery();
    const nv = await nonValorizzato('sedeEmissione')(tab);
    if (!nv) return { skip: 'la voce NULL non e\' fra le opzioni della Sede' };
    const steps = [];
    await setField(tab, 'sedeEmissione', nv.value, steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    const problems = [];
    const stayed = viewNameOf(tab) === QUERY_VIEW;
    if (stayed && !eq.errors.length) problems.push(...noDataProblems(eq));
    if (!eq.errors.length) await backToQuery(tab, steps);
    problems.push(...verify(tab, steps, { sedeEmissione: nv.value }));
    if (!eq.errors.length) problems.push(...verifyText(tab, { sedeEmissione: nv.text }));
    const msgs = (eq.resp.errors || []).map((e) => `${e.type}:${e.mnemonic}`).join(' / ');
    return {
      problems: [...new Set(problems)],
      info: `${stayed ? 'zero righe, resta sulla mappa' : 'righe trovate -> BackTo'} (${eq.mode}) [${msgs}] testo=${JSON.stringify(nv.text)}`,
    };
  },
});

cases.push({
  name: 'QA 6005: Sede = Non Valorizzato + N. doc inesistente -> zero righe sulla mappa',
  run: async () => {
    // Stesso scenario reso deterministico: zero righe comunque siano i dati locali.
    const tab = await openQuery();
    const nv = await nonValorizzato('sedeEmissione')(tab);
    if (!nv) return { skip: 'la voce NULL non e\' fra le opzioni della Sede' };
    const steps = [];
    await setField(tab, 'sedeEmissione', nv.value, steps);
    const impossible = 'SXADV6005-NESSUNO-' + Date.now();
    await setField(tab, 'numDocDa', impossible, steps);
    const eq = await action(tab, 'ExecuteQuery');
    steps.push({ step: 'ExecuteQuery', ...eq });
    const problems = verify(tab, steps, { sedeEmissione: nv.value, numDocDa: impossible });
    if (!eq.errors.length && viewNameOf(tab) === QUERY_VIEW) {
      problems.push(...noDataProblems(eq));
      problems.push(...verifyText(tab, { sedeEmissione: nv.text }));
    }
    return { problems: [...new Set(problems)], info: `esito: ${viewNameOf(tab)} (${eq.mode})` };
  },
});

// ------------------------------------------------------------------- main

const selected = cases.filter((c) => !ONLY || c.name.toLowerCase().includes(ONLY.toLowerCase()));
if (LIST_ONLY) {
  for (const c of selected) console.log(c.name);
  process.exit(0);
}

try {
  await openSession();
} catch (e) {
  console.error('FAIL  accesso: ' + e.message);
  process.exit(2);
}

const t0 = Date.now();
for (const c of selected) {
  const tc = Date.now();
  try {
    const r = await c.run();
    if (r.skip) { console.log(`SKIP  ${c.name}  -- ${r.skip}`); continue; }
    const secs = ((Date.now() - tc) / 1000).toFixed(1);
    const info = VERBOSE && r.info ? ` {${r.info}, ${secs}s}` : '';
    record(c.name, r.problems.length === 0, (r.problems.length ? r.problems.join(' ; ') : '') + info);
  } catch (e) {
    record(c.name, false, 'eccezione nella prova: ' + e.message);
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS, ${failed} FAIL — ${requestCount} richieste, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
