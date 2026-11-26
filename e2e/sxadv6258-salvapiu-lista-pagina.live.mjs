/**
 * SXADV-6258.1 — Salva+ su un rigo di una lista che e' la PAGINA STESSA
 * (Commerciale > Listini generali > Listino Vendita > link-azione «Prezzi Sede»,
 * vista prezziVenditaListSede, view state S1-2, listEdit col pannello di riga).
 *
 * Contratto: CORE/docs/20261007_SXADV-6010_salva_piu_di_riga.md, caso "riga di
 * una lista che e' la pagina stessa": se il salvataggio fallisce con un errore
 * bloccante, SaveAndNew NON aggiunge il rigo nuovo. Quindi:
 *   - il recordCount della lista non cresce e nessun rigo vuoto compare;
 *   - la lista resta sul rigo sbagliato (header.position);
 *   - un secondo SaveAndNew sullo stesso rigo (ancora sbagliato) riporta solo
 *     l'errore del rigo vero, MAI MANDATORY_ATTRIBUTE su idArticolo/codiceUm
 *     (i campi di un rigo vuoto aggiunto dal Salva+ precedente).
 * Controprova di sensibilita': un Add normale fa crescere il recordCount di 1.
 *
 * Due modi di far fallire il salvataggio, pensati per non scrivere nulla:
 *   A. rigo senza prezzo con tipoScaglione N  -> obbligatorio su prezzo;
 *   B. rigo con la stessa PK di un prezzo gia' presente nella prima pagina
 *      della lista -> CONSTRAINT_VIOLATED PRVE_PK. La PK e' CODICE_AZIENDA,
 *      ID_ARTICOLO, CODICE_VARIANTE, RIFERIMENTO (segue la sede), ID_VALUTA,
 *      VALIDO_DAL, CODICE_UM: si ricopia solo un prezzo con la STESSA sede e
 *      la stessa validoDal con cui nasce il rigo nuovo (sede dell'utente, oggi),
 *      spedendo solo l'articolo, e si salva solo se dopo il Post articolo,
 *      sede, validoDal, U.M. (e valuta, se la vista la mostra) coincidono.
 *      La guardia legge la lista, non il DB: se un salvataggio riuscisse lo
 *      stesso lo si stampa in fondo (articolo, sede, data) ed esce con 3.
 *      Senza un prezzo cosi' B non si esegue: lo dice ("B non eseguibile")
 *      e non conta ne' come superato ne' come fallito.
 * Ogni caso finisce con Cancel; in fondo si riapre la lista e si confronta il
 * recordCount con quello di partenza.
 *
 * HTTP puro (nessun browser), come il client: POST form-urlencoded su
 * /entrasp/controller, sid proprio.
 * Accesso: `entrasp-sql --login-session <utente> --to <app>` (link monouso che
 * imposta JSESSIONID; nessuna password passa di qui).
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv6258-salvapiu-lista-pagina.live.mjs [--only A|B] [--verbose]
 *   BASE=http://localhost:9080/entrasp  USER_LOGIN=44AMM  SID=S1  (default)
 * Esce con 1 se almeno una verifica fallisce, 2 se non riesce a entrare,
 * 3 se qualcosa e' stato salvato sul DB.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || 'http://localhost:9080/entrasp').replace(/\/$/, '');
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const SID = process.env.SID || 'S1';
const MENU_ID = 'menu.ven.listiniGeneraliList';
const LIST_VIEW = 'prezziVenditaListSede';
// view state della lista Prezzi Sede: S1-2 alla prima apertura; riaprendo il menu
// nella stessa Session gli id crescono, quindi si legge dalla risposta
let VS = `${SID}-2`;
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const VERBOSE = argv.includes('--verbose');

// ---------------------------------------------------------------- esiti

const FAILED = [];
const SAVED = []; // salvataggi riusciti per sbaglio
const SKIPPED = []; // casi non eseguibili: ne' superati ne' falliti
let nPass = 0;
let current = '';
function check(what, ok, why = '') {
  if (ok) { nPass++; console.log(`  PASS ${what}`); return true; }
  FAILED.push(`${current} · ${what}${why ? ' — ' + why : ''}`);
  console.log(`  FAIL ${what}${why ? ': ' + why : ''}`);
  return false;
}
const info = (t) => console.log(`  ..   ${t}`);

// ---------------------------------------------------------------- trasporto

let cookie = '';

function loginLink() {
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
  const resp = await fetch(loginLink(), { redirect: 'manual' });
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

const COUNT = { total: 0, byAction: {} };
async function req(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) body.append(k, v);
  COUNT.total++;
  COUNT.byAction[params.action] = (COUNT.byAction[params.action] || 0) + 1;
  const t0 = Date.now();
  const resp = await fetch(BASE + '/controller', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
  });
  const text = await resp.text();
  if (VERBOSE) console.log(`    -> ${params.action} ${params.navpath || ''} ${resp.status} ${text.length}B ${Date.now() - t0}ms`);
  if (!resp.ok) return { __http: resp.status, __text: text.slice(0, 500) };
  try { return JSON.parse(text); } catch {
    const relaxed = relaxedToJson(text);
    if (relaxed) try { return JSON.parse(relaxed); } catch { /* sotto */ }
    return { __unparsable: text.slice(0, 500) };
  }
}

const act = (action, extra = {}) => req({ action, sid: SID, ...extra, hasTemplate: '1' });

// ---------------------------------------------------------------- letture

const errorsOf = (r) => (Array.isArray(r?.errors) ? r.errors : []);
const blocking = (r) => errorsOf(r).filter((e) => ['ERROR', 'CONFIRMATION', 'YESNOCANCEL'].includes(e.type));
const fmtErr = (r) => {
  if (r?.__http) return `HTTP ${r.__http}`;
  if (r?.__unparsable) return 'risposta non JSON';
  const e = errorsOf(r);
  return e.length ? e.map((x) => `${x.type}:${x.mnemonic || ''}:${(x.message || '').slice(0, 90)}`).join(' | ') : '(nessun errore)';
};
const transportProblem = (r) => r?.__http || r?.__unparsable || r?.noSession || r?.notLoggedIn;

/** recordCount della lista: ui.header.recordCount (risposta di pagina intera). */
const recordCountOf = (r) => {
  const h = r?.ui?.header;
  if (h && typeof h.recordCount === 'number') return h.recordCount;
  const m = JSON.stringify(r || {}).match(/"recordCount":(\d+)/);
  return m ? Number(m[1]) : null;
};
const positionOf = (r) => (typeof r?.ui?.header?.position === 'number' ? r.ui.header.position : null);

/** Righi primari della risposta: path + valori del pannello. */
function rowsOf(r) {
  return (r?.ui?.rows || [])
    .filter((x) => x?.props?.path)
    .map((x) => ({ path: x.props.path, v: x.editData?.values || {} }));
}
const scalar = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
const posOfPath = (p) => Number(String(p).split('.').pop());

/** MANDATORY_ATTRIBUTE (o messaggio di obbligatorio) che nomina idArticolo / codiceUm. */
function emptyRowMandatory(r) {
  return errorsOf(r).filter((e) => {
    const s = `${e.mnemonic || ''} ${e.message || ''}`;
    return /MANDATORY/i.test(e.mnemonic || '') && /idArticolo|codiceUm/i.test(s)
      || /(idArticolo|codiceUm)/i.test(s) && /obbligatori/i.test(s);
  });
}

// ---------------------------------------------------------------- percorso

/** Menu -> Listino Vendita (riga 0) -> Prezzi Sede. Ritorna la risposta della lista. */
async function openPrezziSede() {
  const m = await act('ExecuteMenuItem', { menuId: MENU_ID });
  if (transportProblem(m)) throw new Error('ExecuteMenuItem: ' + fmtErr(m));
  const menuVs = String(m?.ui?.path || `${SID}-0.0`).split('.')[0];
  const d = await act('NavigateDetail', { navpath: `${menuVs}.0` });
  if (transportProblem(d)) throw new Error('NavigateDetail: ' + fmtErr(d) + JSON.stringify(d).slice(0, 80));
  const detPath = d?.path || d?.ui?.path || `${menuVs}.0`;
  const l = await act('NavigateView', { navpath: detPath, option1: 'prezS' });
  if (transportProblem(l)) throw new Error('NavigateView prezS: ' + fmtErr(l));
  if (l?.ui?.path) VS = String(l.ui.path).split('.')[0];
  info(`Listino Vendita = riga ${menuVs}.0, Prezzi Sede su ${VS}`);
  return l;
}

/** Add sul view state della lista: ritorna { resp, path } del rigo nuovo. */
async function addRow(navpath) {
  const resp = await act('Add', { navpath });
  const p = resp?.ui?.path || (positionOf(resp) != null ? `${VS}.${positionOf(resp)}` : null);
  return { resp, path: p };
}

async function postField(rowPath, field, value) {
  return act('Post', { navpath: rowPath, postPath: rowPath, option1: field, [`${field}.${VS}`]: value });
}

function saveAndNew(rowPath, fields = {}) {
  const extra = { navpath: rowPath, postPath: rowPath };
  for (const [k, v] of Object.entries(fields)) extra[`${k}.${VS}`] = v;
  return act('SaveAndNew', extra);
}

/**
 * Le verifiche comuni dopo un SaveAndNew respinto. `before` e' il recordCount
 * con il solo rigo nuovo (base+1), `rowPath` il rigo sbagliato.
 */
function checkRejected(label, r, before, rowPath, legitimate) {
  const rc = recordCountOf(r);
  check(`${label}: una risposta leggibile`, !transportProblem(r), fmtErr(r));
  check(`${label}: il salvataggio e' respinto con un errore bloccante`, blocking(r).length > 0, fmtErr(r));
  if (legitimate) check(`${label}: c'e' l'errore del rigo vero (${legitimate})`,
    errorsOf(r).some((e) => new RegExp(legitimate, 'i').test(`${e.mnemonic || ''} ${e.message || ''}`)), fmtErr(r));
  check(`${label}: il recordCount NON cresce (atteso ${before})`, rc === before, `recordCount ${rc}`);
  const extraRows = rowsOf(r).filter((x) => posOfPath(x.path) > posOfPath(rowPath));
  check(`${label}: nessun rigo nuovo dopo ${rowPath}`, extraRows.length === 0,
    extraRows.map((x) => `${x.path} art=${scalar(x.v.articoloVariante)}`).join(', '));
  const blank = rowsOf(r).filter((x) => x.path !== rowPath && scalar(x.v.articoloVariante) == null);
  check(`${label}: nessun rigo vuoto (senza articolo) oltre a quello in prova`, blank.length === 0,
    blank.map((x) => x.path).join(', '));
  const pos = positionOf(r);
  if (pos != null) check(`${label}: la lista resta sul rigo sbagliato (${rowPath})`, pos === posOfPath(rowPath), `position ${pos}`);
  const bad = emptyRowMandatory(r);
  check(`${label}: nessun obbligatorio su idArticolo/codiceUm`, bad.length === 0, bad.map((e) => e.message || e.mnemonic).join(' | '));
}

/** Se un SaveAndNew non ha errori bloccanti, potrebbe aver salvato: lo si registra. */
function noteIfSaved(label, r, row) {
  if (!transportProblem(r) && blocking(r).length === 0) {
    SAVED.push(`${label}: articolo ${row.articolo}, sede ${row.sede}, validoDal ${row.validoDal}, U.M. ${row.um}`);
    console.log(`  !!!  ${label}: SaveAndNew SENZA errori bloccanti: forse SALVATO (${SAVED[SAVED.length - 1]})`);
  }
}

// ---------------------------------------------------------------- casi

/** Controprova di sensibilita': Add normale = recordCount + 1. Ritorna base, rigo nuovo. */
async function sensitivity(list, done = null) {
  const base = recordCountOf(list);
  check('lista Prezzi Sede aperta', list?.ui?.viewName === LIST_VIEW, `viewName ${list?.ui?.viewName}`);
  check('recordCount di partenza leggibile', typeof base === 'number', String(base));
  const { resp, path: rowPath } = done || await addRow(`${VS}.0`);
  check('controprova: Add normale porta recordCount a base+1', recordCountOf(resp) === base + 1,
    `base ${base}, dopo Add ${recordCountOf(resp)}`);
  check('Add: il rigo nuovo ha un path del view state della lista', rowPath && rowPath.startsWith(VS + '.'), String(rowPath));
  const row = rowsOf(resp).find((x) => x.path === rowPath);
  check('Add: il rigo nuovo e\' nella risposta, senza articolo', row && scalar(row.v.articoloVariante) == null,
    row ? `art=${scalar(row.v.articoloVariante)}` : 'assente');
  return { base, rowPath, newRow: row };
}

async function caseA(existing) {
  current = 'A. rigo senza prezzo (tipoScaglione N)';
  console.log(`\n${current}`);
  const list = await openPrezziSede();
  const { base, rowPath, newRow } = await sensitivity(list);
  if (!rowPath) return;
  // un articolo della lista e nessun prezzo: il controllo dell'obbligatorio ferma il
  // salvataggio prima del DB, qualunque sia la chiave
  const art = existing[0].articolo;
  const p1 = await postField(rowPath, 'articoloVariante', art);
  check(`Post articoloVariante=${art} senza errori`, blocking(p1).length === 0, fmtErr(p1));
  const p2 = await postField(rowPath, 'tipoScaglione', 'N');
  check('Post tipoScaglione=N senza errori', blocking(p2).length === 0, fmtErr(p2));
  const row = { articolo: art, sede: scalar(newRow?.v?.sedeAzienda), validoDal: newRow?.v?.validoDal, um: '?' };

  const s1 = await saveAndNew(rowPath, { tipoScaglione: 'N', prezzo: '' });
  noteIfSaved('A primo Salva+', s1, row);
  info(`primo Salva+: ${fmtErr(s1)} · recordCount ${recordCountOf(s1)}`);
  checkRejected('A primo Salva+', s1, base + 1, rowPath, 'prezzo');

  const s2 = await saveAndNew(rowPath, { tipoScaglione: 'N', prezzo: '' });
  noteIfSaved('A secondo Salva+', s2, row);
  info(`secondo Salva+: ${fmtErr(s2)} · recordCount ${recordCountOf(s2)}`);
  checkRejected('A secondo Salva+', s2, base + 1, rowPath, 'prezzo');

  const c = await act('Cancel', { navpath: rowPath });
  check('Cancel riporta il recordCount di partenza', recordCountOf(c) === base, `recordCount ${recordCountOf(c)}, base ${base}`);
}

/** Le colonne della PK di prezziVendita che si leggono dal rigo della lista. */
const PK_FIELDS = ['articolo', 'sede', 'validoDal', 'um', 'valuta'];
const keyOf = (v) => ({
  articolo: scalar(v.articoloVariante),
  sede: scalar(v.sedeAzienda),
  validoDal: v.validoDal,
  um: scalar(v.unitaMisura),
  valuta: scalar(v.valuta) ?? null,
});
const fmtKey = (k) => PK_FIELDS.map((f) => `${f}=${k?.[f]}`).join(' ');
const sameKey = (a, b) => !!a && !!b && PK_FIELDS.every((f) => a[f] === b[f]);

async function caseB() {
  current = 'B. chiave doppia (CONSTRAINT_VIOLATED PRVE_PK)';
  console.log(`\n${current}`);
  // PK = CODICE_AZIENDA, ID_ARTICOLO, CODICE_VARIANTE, RIFERIMENTO, ID_VALUTA, VALIDO_DAL,
  // CODICE_UM; RIFERIMENTO segue la sede (G1-<sede>). Dal rigo della lista si leggono
  // articolo (= articolo + variante), sede (-> riferimento), validoDal, U.M. e, se la
  // vista la mostra, la valuta. Il rigo nuovo nasce con la sede dell'utente e validoDal =
  // oggi: si ricopia SOLO un prezzo esistente con la stessa sede e la stessa data del
  // rigo nuovo, cosi' non si spedisce nessun campo della chiave oltre all'articolo; e si
  // salva solo se dopo il Post la chiave intera del rigo nuovo coincide con quella del
  // prezzo esistente. Altrimenti: "B non eseguibile", niente salvataggio, niente conteggio.
  const list = await openPrezziSede();
  const existing = rowsOf(list).map((x) => ({ path: x.path, key: keyOf(x.v), tipo: scalar(x.v.tipoScaglione) }))
    .filter((x) => x.key.articolo && x.key.sede && x.key.validoDal && x.key.um);
  const add = await addRow(`${VS}.0`);
  const newRow = rowsOf(add.resp).find((x) => x.path === add.path);
  const nk = newRow ? keyOf(newRow.v) : null;
  const notRunnable = async (why) => {
    console.log(`  SKIP B non eseguibile: ${why}`);
    SKIPPED.push(`B non eseguibile: ${why}`);
    if (add.path) {
      const c = await act('Cancel', { navpath: add.path });
      if (recordCountOf(c) !== recordCountOf(list)) console.log(`  !!!  Cancel non ha riportato il recordCount (${recordCountOf(c)})`);
    }
  };
  if (!add.path || !nk) return notRunnable('Add senza rigo nuovo leggibile');
  info(`rigo nuovo ${add.path}: sede ${nk.sede}, validoDal ${nk.validoDal}`);
  const target = existing.find((x) => x.key.sede === nk.sede && x.key.validoDal === nk.validoDal);
  if (!target) {
    return notRunnable(`nella pagina della lista nessun prezzo con sede ${nk.sede} e validoDal ${nk.validoDal}`
      + ` (i ${existing.length} prezzi letti hanno sedi ${[...new Set(existing.map((x) => x.key.sede))].join(', ')})`);
  }
  const p1 = await postField(add.path, 'articoloVariante', target.key.articolo);
  const after = rowsOf(p1).find((x) => x.path === add.path);
  const ak = after ? keyOf(after.v) : null;
  info(`prezzo esistente ${target.path}: ${fmtKey(target.key)}; rigo nuovo dopo il Post: ${fmtKey(ak)}`);
  if (blocking(p1).length) return notRunnable(`il Post dell'articolo ${target.key.articolo} da' errori: ${fmtErr(p1)}`);
  if (!sameKey(ak, target.key)) return notRunnable('la chiave del rigo nuovo non coincide per intero con quella del prezzo esistente');

  // da qui la chiave doppia e' certa: il caso conta
  const { base, rowPath } = await sensitivity(list, add);
  const row = { articolo: ak.articolo, sede: ak.sede, validoDal: ak.validoDal, um: ak.um };

  const s1 = await saveAndNew(rowPath, { tipoScaglione: 'N', prezzo: '1,23' });
  noteIfSaved('B primo Salva+', s1, row);
  info(`primo Salva+: ${fmtErr(s1)} · recordCount ${recordCountOf(s1)}`);
  checkRejected('B primo Salva+', s1, base + 1, rowPath, 'CONSTRAINT|PRVE_PK|chiave|duplicat');

  if (SAVED.length === 0) {
    const s2 = await saveAndNew(rowPath, { tipoScaglione: 'N', prezzo: '1,23' });
    noteIfSaved('B secondo Salva+', s2, row);
    info(`secondo Salva+: ${fmtErr(s2)} · recordCount ${recordCountOf(s2)}`);
    checkRejected('B secondo Salva+', s2, base + 1, rowPath, 'CONSTRAINT|PRVE_PK|chiave|duplicat');
  } else {
    info('primo Salva+ forse riuscito: il secondo non parte');
  }

  const c = await act('Cancel', { navpath: rowPath });
  check('Cancel riporta il recordCount di partenza', recordCountOf(c) === base, `recordCount ${recordCountOf(c)}, base ${base}`);
}

// ---------------------------------------------------------------- main

try {
  await openSession();
} catch (e) {
  console.error('LOGIN: ' + e.message);
  process.exit(2);
}

let base0 = null;
let existing = [];
try {
  current = 'preparazione';
  const list = await openPrezziSede();
  base0 = recordCountOf(list);
  existing = rowsOf(list)
    .map((x) => ({
      path: x.path,
      articolo: scalar(x.v.articoloVariante),
      sede: scalar(x.v.sedeAzienda),
      validoDal: x.v.validoDal,
      um: scalar(x.v.unitaMisura),
      tipo: scalar(x.v.tipoScaglione),
    }))
    .filter((x) => x.articolo && x.validoDal && x.um && x.tipo === 'N');
  info(`lista ${list?.ui?.viewName}, recordCount ${base0}, prezzi utilizzabili nella prima pagina ${existing.length}`);
  if (!existing.length) throw new Error('nessun prezzo esistente con articolo/validoDal/U.M. nella prima pagina');

  if (!ONLY || ONLY === 'A') await caseA(existing);
  if (!ONLY || ONLY === 'B') await caseB();

  current = 'chiusura';
  console.log(`\n${current}`);
  const again = await openPrezziSede();
  check('riaperta la lista, il recordCount e\' quello di partenza (niente salvato)', recordCountOf(again) === base0,
    `partenza ${base0}, ora ${recordCountOf(again)}`);
  if (recordCountOf(again) !== base0) SAVED.push(`recordCount della lista passato da ${base0} a ${recordCountOf(again)}`);
} catch (e) {
  check('eseguita senza eccezioni', false, e.stack || e.message);
}

console.log(`\nRichieste al server: ${COUNT.total} (${Object.entries(COUNT.byAction).map(([k, v]) => `${k}=${v}`).join(', ')})`);
console.log(`Verifiche: ${nPass} superate, ${FAILED.length} fallite${SKIPPED.length ? `, ${SKIPPED.length} casi non eseguibili` : ''}`);
for (const k of SKIPPED) console.log('  ~ ' + k);
for (const f of FAILED) console.log('  - ' + f);
if (SAVED.length) {
  console.log('\n!!! ATTENZIONE: possibile salvataggio sul DB:');
  for (const s of SAVED) console.log('  * ' + s);
  process.exit(3);
}
process.exit(FAILED.length ? 1 : 0);
