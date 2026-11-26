/**
 * SXADV-6300 — dettaglio con piu' liste incorporate impilate (nessun tab).
 *
 * Il difetto (Elena): Fatture > Ft. ven. 29 > Reg. contabili > rigo > dettaglio >
 * catenella del Sottoconto 205.04.01 (oppure Contabilita' > Configurazioni >
 * Sottoconti, Codice 205.04.01, Esegui). Sotto la testata ci sono 5 liste
 * (Versioni, Riclass. per esercizio, Sottolivello sottoconti, Sedi con
 * visibilita' globale, Riclassificazioni). In React stanno tutte in un'area
 * inferiore separata dalla testata da un divisore trascinabile, bassa (a
 * 1366x768 circa 266px) e con una sola barra di scorrimento: se ne vedono 3. Nel
 * legacy la pagina e' un unico flusso (testata, poi le liste) e si vedono tutte.
 *
 * Il contratto (scelta di progetto):
 *   1. dettaglio di primo livello con DUE O PIU' sezioni-lista impilate sotto la
 *      testata (liste incorporate, nessun tab): niente divisore trascinabile
 *      (.view-split-resizer), una sola area che scorre e contiene testata e
 *      sezioni in sequenza; scorrendola si arriva all'ultima sezione; l'area delle
 *      sezioni non ha una sua barra verticale (scrollHeight == clientHeight, o non
 *      e' un contenitore a scorrimento). Toolbar della pagina (Salva/Annulla/
 *      Nuovo...) e catenella restano ferme in alto.
 *   2. ogni lista di sezione: fino a N record (N = 20, --max-records) alta
 *      quanto il contenuto (nessuna barra interna, tutte le righe visibili
 *      scorrendo la pagina); oltre N record altezza limitata a circa N righe (fra
 *      N-1,5 e N+1,5) e barra verticale propria, intestazione delle colonne
 *      sempre visibile. (Il limite era 10 nella prima stesura del contratto:
 *      portato a 20 dal coordinatore, come per le griglie annidate.)
 *   3. invariato: dettagli con tab sotto la testata (una fattura) e dettagli con
 *      UNA sola sezione-lista restano divisi in due aree col divisore.
 *   4. ingrandimento (pulsante «Ingrandisce sezione» in alto a destra della
 *      sezione): solo quella lista, a tutta area; Esc o il pulsante tornano alla
 *      pagina intera.
 *   5. «Nuovo» in una sezione o clic su un rigo di una sezione: il pannello di
 *      riga / dettaglio si apre e resta visibile (non nascosto sotto l'area).
 *
 * Le sezioni si riconoscono dal TITOLO (testo a video) e dalla griglia AG Grid
 * che le segue, non da classi dell'implementazione: la sezione e' il piu' piccolo
 * antenato del titolo che contiene una griglia.
 *
 * Casi (azienda 02409720 C.N.A. SERVIZI MODENA, sede 000 - PROVINCIALE, utente 44AMM):
 *   A Sottoconto 205.04.01 (caso della tester), per ogni viewport (default
 *     1366x768 e 1920x950): punti 1, 2 (liste da 0-1 righe), 4 (zoom su
 *     Versioni: Esc e pulsante), 5 («Nuovo» in Riclassificazioni, l'ultima
 *     sezione; uscita con «Annulla» in alto).
 *   B Sottoconto 015.01.90.01.50 CLIENTI C/FATTURE DA EMETTERE: «Sottolivello
 *     sottoconti» ha 16 righe (sottoconti figli dell'azienda 02409720 su ALFA):
 *     punti 1, 2 (con N=20 e' SOTTO il limite: tutte e 16 visibili, nessuna barra
 *     interna; con --max-records 10 diventa il caso oltre il limite), 5 (clic
 *     sull'ultimo rigo, 015.01.90.01.50.22 -> pannello di riga).
 *   E Conto 015.01.90.01 (contiDetail: sezioni «Conti» e «Sottoconti», nessun
 *     tab), raggiunto dalla catenella del campo Conto del sottoconto
 *     015.01.90.01.50: «Sottoconti» ha piu' di 20 record su ALFA (47 di primo
 *     livello, 64 contando i sottolivelli, 54 visibili all'azienda; letto con
 *     entrasp-sql): punti 1 e 2 oltre il limite (altezza ~N righe, barra propria,
 *     intestazione ferma, si arriva all'ultima riga).
 *   C Fattura Ft. ven. 29 del 23/10/2026 (dettaglio con tab): divisore presente.
 *   D Modelli fiscali > «Contabilita' Ordinaria» (templateFiscaliDetail, una sola
 *     lista incorporata, «Piani dei conti»): divisore presente.
 *
 * SOLA LETTURA sul DB di collaudo ALFA: mai Salva, Conferma, Cancella. «Nuovo» e
 * il clic sul rigo si chiudono con «Annulla» in alto (Cancel, niente sul DB).
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv6300-sezioni-impilate.live.mjs [<link-monouso | host>] [--headed]
 *        [--only A|B|C|D|E] [--viewport 1366x768,1920x950] [--all-viewports]
 *        [--max-records N]   (soglia del punto 2, default 20)
 *   - host (default 127.0.0.47): lo script fa da se' login e inoltro;
 *   - --viewport: elenco WxH; il caso A gira su tutti, B/C/D sul primo (con
 *     --all-viewports tutti su tutti); B/C/D/E sul primo.
 *   SHOTS=<cartella screenshot>  PLAYWRIGHT_DIR=<node_modules con playwright>
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
const ALL_VP = argv.includes('--all-viewports');
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const ONLY = opt('--only')?.toUpperCase() ?? null;
const VIEWPORTS = (opt('--viewport') || '1366x768,1920x950').split(',').map((s) => {
  const [w, h] = s.toLowerCase().split('x').map(Number);
  if (!w || !h) throw new Error(`viewport non valido: ${s}`);
  return { width: w, height: h };
});
const MAX = Number(opt('--max-records') || 20);
if (!(MAX > 0)) throw new Error(`--max-records non valido: ${opt('--max-records')}`);
const POS = argv.filter((a, i) => !a.startsWith('--') && !['--only', '--viewport', '--max-records'].includes(argv[i - 1]));
const TARGET = POS[0] || '127.0.0.47';
const USER = process.env.USER_LOGIN || '44AMM';
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'sxadv6300');
const SEDE = '000 - PROVINCIALE';
mkdirSync(SHOTS, { recursive: true });

/** Le 5 sezioni del Sottoconto: titolo a video e vista della lista nel JSON. */
const SEZIONI = [
  ['Versioni', 'sottocontiVrList'],
  ['Riclass. per esercizio', 'sottocontiRaList'],
  ['Sottolivello sottoconti', 'sottocontiList'],
  ['Sedi con visibilità globale', 'sottocontiSediList'],
  ['Riclassificazioni', 'riclassSottocontiSocoList'],
];
const TITLES = SEZIONI.map(([t]) => t);

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
const px = (n) => (n == null ? 'n/d' : Math.round(n * 10) / 10);

// ─────────────────────────────────────────────────────────────────── accesso

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

/** Numero di record (righe primarie) dell'ultima resa della lista `view` nelle risposte. */
function jsonRecordCount(view) {
  const found = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.viewName === view && Array.isArray(o.rows)) found.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  for (let i = LOG.length - 1; i >= 0; i--) {
    found.length = 0;
    walk(LOG[i].json);
    if (found.length) {
      const l = found[found.length - 1];
      return l.rows.filter((r) => r?.props?.path && r.cls !== 'breakRow').length;
    }
  }
  return null;
}

// ─────────────────────────────────────────── misure nella pagina (in-page)

/**
 * Installato prima del caricamento: window.__t6300 con le misure. Tutto per
 * testo a video e per geometria, niente classi dell'implementazione salvo quelle
 * nominate dal contratto (.view-split-resizer) e quelle di AG Grid.
 */
const PROBE = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }; };
  const desc = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className).trim().split(/\s+/).slice(0, 3).join('.')}` : 'nessuno');
  const isScrollBox = (el) => { const oy = getComputedStyle(el).overflowY; return oy === 'auto' || oy === 'scroll' || oy === 'overlay'; };
  const scrolls = (el) => isScrollBox(el) && el.scrollHeight > el.clientHeight + 1;
  const hitInside = (el, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
  const centerHit = (el) => { const r = el.getBoundingClientRect(); return hitInside(el, r.left + Math.min(r.width / 2, 40), r.top + r.height / 2); };

  /**
   * Sezione col titolo t: elemento visibile col testo t (fuori da griglie, menu,
   * catenella e barre dei tab) il cui piu' piccolo antenato con una griglia ne
   * contiene UNA sola. Cosi' la voce di menu «Sottoconti» o una briciola non
   * passano per il titolo di una sezione.
   */
  function section(t) {
    for (const e of document.querySelectorAll('body *')) {
      if (e.closest('.ag-root-wrapper, .ant-menu, .ant-breadcrumb, .ant-tabs-nav, .ant-select')) continue;
      if (!vis(e)) continue;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.replace(/\s+/g, ' ').trim() === t)) continue;
      let sec = e.parentElement;
      while (sec && !sec.querySelector('.ag-root-wrapper')) sec = sec.parentElement;
      if (!sec) continue;
      const grids = [...sec.querySelectorAll('.ag-root-wrapper')].filter((g) => !g.parentElement.closest('.ag-root-wrapper'));
      if (grids.length !== 1) continue;
      return { title: e, sec, grid: grids[0] };
    }
    return null;
  }
  const titleEl = (t) => section(t)?.title ?? null;
  /** Campo della testata: la cella del contenuto (td[id^="<nome>."]). */
  const testataEl = (name) => [...document.querySelectorAll(`td[id^="${name}."]`)].find(vis) || null;
  const resizers = () => [...document.querySelectorAll('.view-split-resizer')].filter(vis);
  /** La toolbar della pagina: il pulsante «Salva» fuori da sezioni e pannelli di riga. */
  function pageSalva() {
    return [...document.querySelectorAll('button')].find((b) => vis(b) && /^\s*Salva\s*$/.test(b.innerText)
      && !b.closest('.ag-root-wrapper') && !b.closest('[class*="edit-panel"]')) || null;
  }
  const crumb = () => [...document.querySelectorAll('.ant-breadcrumb')].find(vis) || null;

  /** Il piu' vicino antenato contenitore a scorrimento (overflow-y auto/scroll) di el che contiene anche other. */
  function commonScroll(el, other) {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (isScrollBox(a) && a.contains(other)) return a;
    }
    return document.scrollingElement;
  }
  /** Antenati di el (esclusi) fino ad `upTo` (escluso) che hanno una barra verticale attiva. */
  function innerScrollers(el, upTo) {
    const out = [];
    for (let a = el.parentElement; a && a !== upTo && a !== document.documentElement; a = a.parentElement) {
      if (scrolls(a)) out.push(`${desc(a)} sh=${a.scrollHeight} ch=${a.clientHeight}`);
    }
    return out;
  }

  /** Metriche della griglia di una sezione. */
  function gridMetrics(grid) {
    const bv = grid.querySelector('.ag-body-viewport');
    const vsv = grid.querySelector('.ag-body-vertical-scroll-viewport');
    const header = grid.querySelector('.ag-header');
    const rows = [...grid.querySelectorAll('.ag-center-cols-container .ag-row')].filter(vis);
    const hs = rows.map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
    const rh = hs.length ? hs[Math.floor(hs.length / 2)] : null;
    const bvb = box(bv);
    const ownScroll = (!!bv && scrolls(bv)) || (!!vsv && vis(vsv) && vsv.scrollHeight > vsv.clientHeight + 1);
    const rowsInside = rows.filter((r) => { const b = r.getBoundingClientRect(); return bvb && b.top >= bvb.top - 1 && b.bottom <= bvb.bottom + 1; }).length;
    const sumRows = rows.reduce((s, r) => s + r.getBoundingClientRect().height, 0);
    return {
      bvH: bv?.clientHeight ?? null, bvSH: bv?.scrollHeight ?? null, ownScroll, rh, rendered: rows.length, rowsInside, sumRows,
      header: box(header), maxRowIndex: Math.max(-1, ...rows.map((r) => +r.getAttribute('row-index'))),
    };
  }

  window.__t6300 = {
    /** Fotografia di struttura della pagina coi titoli dati e il campo di testata. */
    structure(titles, testataName) {
      const secs = titles.map((t) => ({ t, s: section(t) }));
      const testata = testataEl(testataName);
      const found = secs.filter((x) => x.s);
      const res = {
        missing: secs.filter((x) => !x.s).map((x) => x.t),
        resizers: resizers().map(desc),
        testata: !!testata,
      };
      if (!found.length || !testata) return res;
      const first = found[0].s.sec;
      const area = commonScroll(first, testata);
      res.area = desc(area);
      res.areaScrolls = scrolls(area) || area === document.scrollingElement;
      // ogni sezione: nessun antenato fra lei e l'area con una barra attiva
      res.sectionInner = found.map((x) => ({ t: x.t, inner: innerScrollers(x.s.sec, area), sameArea: commonScroll(x.s.sec, testata) === area }));
      res.testataInner = innerScrollers(testata, area);
      res.testataAbove = testata.getBoundingClientRect().top < first.getBoundingClientRect().top;
      res.orderOk = found.every((x, i) => i === 0 || found[i - 1].s.sec.getBoundingClientRect().top < x.s.sec.getBoundingClientRect().top);
      return res;
    },
    /** Scorre SOLO l'area comune (testata+sezioni) per portare il titolo t vicino all'alto; dice se si vede. */
    reach(t, testataName) {
      const s = section(t);
      const testata = testataEl(testataName);
      if (!s || !testata) return { err: !s ? 'sezione non trovata' : 'testata non trovata' };
      const area = commonScroll(s.sec, testata);
      const ab = area === document.scrollingElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
      area.scrollTop += s.title.getBoundingClientRect().top - ab.top - 40;
      const tb = s.title.getBoundingClientRect();
      const lo = Math.max(ab.top, 0);
      const hi = Math.min(ab.bottom, innerHeight);
      return { inView: tb.top >= lo - 1 && tb.bottom <= hi + 1, hit: centerHit(s.title), title: box(s.title), area: { top: ab.top, bottom: ab.bottom } };
    },
    /** Area comune in fondo: l'ultima sezione sta tutta nella parte visibile. */
    toBottom(t, testataName) {
      const s = section(t);
      const testata = testataEl(testataName);
      if (!s || !testata) return { err: 'sezione o testata non trovata' };
      const area = commonScroll(s.sec, testata);
      area.scrollTop = area.scrollHeight;
      const ab = area === document.scrollingElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
      const sb = s.sec.getBoundingClientRect();
      const hi = Math.min(ab.bottom, innerHeight);
      return { sec: box(s.sec), hi, whole: sb.bottom <= hi + 1 && sb.top >= Math.max(ab.top, 0) - 1, hit: centerHit(s.title) };
    },
    resetScroll(testataName) {
      const testata = testataEl(testataName);
      for (let a = testata?.parentElement; a; a = a.parentElement) if (isScrollBox(a)) a.scrollTop = 0;
      document.scrollingElement.scrollTop = 0;
    },
    fixed() {
      const s = pageSalva();
      const c = crumb();
      return { salva: box(s), salvaHit: s ? centerHit(s) : false, crumb: box(c), crumbHit: c ? centerHit(c) : false };
    },
    grid(t) { const s = section(t); return s ? gridMetrics(s.grid) : null; },
    /** Porta la griglia della sezione t in vista (scorrendo gli antenati) e scorre il corpo della griglia in fondo. */
    gridToBottom(t) {
      const s = section(t);
      if (!s) return null;
      s.title.scrollIntoView({ block: 'start' });
      const before = gridMetrics(s.grid);
      const bv = s.grid.querySelector('.ag-body-viewport');
      const vsv = s.grid.querySelector('.ag-body-vertical-scroll-viewport');
      if (bv) bv.scrollTop = bv.scrollHeight;
      if (vsv) vsv.scrollTop = vsv.scrollHeight;
      return { before, scrollTop: bv?.scrollTop ?? null };
    },
    headerVisible(t) {
      const s = section(t);
      const h = s?.grid.querySelector('.ag-header');
      if (!h) return null;
      const b = h.getBoundingClientRect();
      return { header: box(h), inView: b.top >= 0 && b.bottom <= innerHeight, hit: hitInside(h, b.left + 30, b.top + b.height / 2) };
    },
    titlesShown(titles) { return titles.filter((t) => { const e = titleEl(t); return e && vis(e); }); },
    sectionBox(t) { const s = section(t); return s ? { sec: box(s.sec), grid: box(s.grid) } : null; },
    /** Coordinate (gia' portate in vista) del centro della cella con quel testo nella sezione t. */
    cellPoint(t, text) {
      const s = section(t);
      if (!s) return null;
      const cell = [...s.grid.querySelectorAll('.ag-center-cols-container .ag-cell')].find((c) => c.innerText.trim() === text);
      if (!cell) return null;
      cell.scrollIntoView({ block: 'center' });
      const r = cell.getBoundingClientRect();
      return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2, hit: hitInside(cell, r.left + Math.min(r.width / 2, 40), r.top + r.height / 2) };
    },
    /** Il pannello di riga aperto (edit-panel) e quanto se ne vede. */
    panel() {
      const p = [...document.querySelectorAll('[class*="edit-panel"]')].filter((e) => vis(e) && !e.parentElement.closest('[class*="edit-panel"]'))[0];
      if (!p) return null;
      const b = p.getBoundingClientRect();
      const ins = [...p.querySelectorAll('input')].map((i) => i.value);
      return {
        box: box(p), viewportH: innerHeight,
        whole: b.top >= 0 && b.bottom <= innerHeight + 1,
        headHit: hitInside(p, b.left + 20, b.top + Math.min(12, b.height / 2)),
        centerHit: hitInside(p, b.left + b.width / 2, b.top + b.height / 2),
        bottomHit: hitInside(p, b.left + 20, b.bottom - 4),
        text: p.innerText.replace(/\s+/g, ' ').slice(0, 200), inputs: ins,
      };
    },
  };
};

// ───────────────────────────────────────────────────────────── navigazione

const topButton = (label) => page.locator('button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
const annullaEnabled = () => topButton('Annulla').isEnabled().catch(() => false);
const anyModal = () => page.locator('.ant-modal:visible').last();
const T = (fn, ...args) => page.evaluate(([f, a]) => window.__t6300[f](...a), [fn, args]);

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

/** Contabilita' > Configurazioni > Sottoconti, Codice = code, Esegui; se arriva la lista, il rigo con `desc`. */
async function openSottoconto(code, desc) {
  await menuClick('Sottoconti', 'menu.ctb.cfgCtb.sottocontiQuery');
  const cod = page.locator('td[id^="codice."] input').first();
  await cod.waitFor({ timeout: 20000 });
  await cod.fill(code);
  await cod.press('Tab');
  await quiet(800);
  await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
  await sleep(500);
  if (!(await page.getByText('Versioni', { exact: true }).count())) {
    const cell = page.locator('.ag-center-cols-container .ag-row .ag-cell').filter({ hasText: new RegExp(`^\\s*${desc.replace(/[./]/g, '\\$&')}\\s*$`) }).first();
    await cell.waitFor({ timeout: 20000 });
    await withRequest('NavigateDetail', () => cell.click());
  }
  await page.getByText('Versioni', { exact: true }).first().waitFor({ timeout: 20000 });
  await sleep(800);
  const ok = await page.locator('input').evaluateAll((els, c) => els.some((e) => e.value.trim() === c), code).catch(() => false);
  if (!ok) throw new Error(`il dettaglio aperto non e' il sottoconto ${code}`);
  info(`aperto il sottoconto ${code} (${desc})`);
}

async function cleanup() {
  try {
    for (let k = 0; k < 3 && await anyModal().isVisible().catch(() => false); k++) {
      info(`pulizia: finestra «${squash(await anyModal().innerText()).slice(0, 80)}», Annulla/OK`);
      await anyModal().locator('button').filter({ hasText: /^(Annulla|OK)$/ }).first().click().catch(() => {});
      await quiet(1000);
    }
    await page.keyboard.press('Escape').catch(() => {});
    if (await annullaEnabled()) {
      info('pulizia: sessione sporca, «Annulla» in alto');
      await withRequest('Cancel', () => topButton('Annulla').click()).catch(() => {});
    }
  } catch (e) { info(`pulizia non riuscita: ${e.message.split('\n')[0]}`); }
}

// ────────────────────────────────────────────────────── verifiche riusabili

/** Punto 1: un'area sola, niente divisore, sezioni raggiungibili, toolbar ferma. */
async function checkSinglePage(label, titles, testataName) {
  await T('resetScroll', testataName);
  await sleep(300);
  const st = await T('structure', titles, testataName);
  info(`${label}: area comune ${st.area}; divisori ${JSON.stringify(st.resizers)}`);
  if (!(await check(`${label}: le ${titles.length} sezioni e la testata sono nella pagina`, !st.missing.length && st.testata,
    `mancano ${JSON.stringify(st.missing)}${st.testata ? '' : ', testata'}`))) return;
  await check(`${label}: nessun divisore trascinabile (.view-split-resizer)`, st.resizers.length === 0, JSON.stringify(st.resizers));
  const withInner = st.sectionInner.filter((x) => x.inner.length || !x.sameArea);
  await check(`${label}: testata e sezioni nella STESSA area che scorre; le sezioni non hanno un'area con barra propria`,
    withInner.length === 0 && st.testataInner.length === 0,
    `${withInner.map((x) => `«${x.t}» dentro ${x.inner.join(' > ') || 'altra area'}`).join('; ')}${st.testataInner.length ? `; testata dentro ${st.testataInner.join(' > ')}` : ''}`);
  await check(`${label}: la testata sta sopra le sezioni, le sezioni in sequenza`, st.testataAbove && st.orderOk);

  const fixed0 = await T('fixed');
  for (const t of titles) {
    const r = await T('reach', t, testataName);
    await check(`${label}: scorrendo l'area si arriva a «${t}» (titolo visibile)`, !r.err && r.inView && r.hit,
      r.err || `titolo ${px(r.title?.top)}-${px(r.title?.bottom)}, area ${px(r.area?.top)}-${px(r.area?.bottom)}, coperto=${!r.hit}`);
  }
  const last = titles[titles.length - 1];
  const b = await T('toBottom', last, testataName);
  await check(`${label}: area in fondo -> l'ultima sezione «${last}» si vede tutta`, !b.err && b.whole && b.hit,
    b.err || `sezione ${px(b.sec?.top)}-${px(b.sec?.bottom)}, limite visibile ${px(b.hi)}`);
  const fixed1 = await T('fixed');
  await check(`${label}: dopo lo scorrimento la toolbar della pagina («Salva») e' ferma e visibile`,
    !!fixed0.salva && !!fixed1.salva && Math.abs(fixed0.salva.top - fixed1.salva.top) <= 1 && fixed1.salvaHit,
    `Salva top ${px(fixed0.salva?.top)} -> ${px(fixed1.salva?.top)}, visibile=${fixed1.salvaHit}`);
  await check(`${label}: dopo lo scorrimento la catenella e' ferma e visibile`,
    !!fixed0.crumb && !!fixed1.crumb && Math.abs(fixed0.crumb.top - fixed1.crumb.top) <= 1 && fixed1.crumbHit,
    `catenella top ${px(fixed0.crumb?.top)} -> ${px(fixed1.crumb?.top)}, visibile=${fixed1.crumbHit}`);
  await T('resetScroll', testataName);
}

/** Punto 2 per una sezione con n record (n<=MAX): alta quanto il contenuto, niente barra, righe tutte visibili. */
async function checkSmallList(label, t, n) {
  const g = await T('grid', t);
  if (!(await check(`${label}: «${t}» ha la sua griglia`, !!g))) return;
  info(`${label}: «${t}» ${n} record; corpo ${g.bvH}px (contenuto ${g.bvSH}), righe a video ${g.rendered}, alt. riga ${g.rh}`);
  await check(`${label}: «${t}» (${n} righe, limite ${MAX}) senza barra verticale interna`, !g.ownScroll, `scrollHeight ${g.bvSH} > clientHeight ${g.bvH}`);
  if (n > 0) {
    await check(`${label}: «${t}» mostra tutte le ${n} righe, nessuna tagliata`, g.rendered >= n && g.rowsInside >= n,
      `a video ${g.rendered}, intere ${g.rowsInside}`);
    await check(`${label}: «${t}» alta quanto il contenuto (nessuno spazio vuoto oltre una riga)`, g.bvH <= g.sumRows + (g.rh || 22) + 2,
      `corpo ${g.bvH}px, righe ${px(g.sumRows)}px`);
  }
}

/** Punto 2 per una sezione con n>MAX record: ~MAX righe, barra propria, intestazione ferma. */
async function checkBigList(label, t, n) {
  const g = await T('grid', t);
  if (!(await check(`${label}: «${t}» ha la sua griglia`, !!g))) return;
  const rh = g.rh || 22;
  info(`${label}: «${t}» ${n} record; corpo ${g.bvH}px (contenuto ${g.bvSH}), alt. riga ${rh} -> ${px(g.bvH / rh)} righe visibili`);
  await check(`${label}: «${t}» (${n} righe, limite ${MAX}) ha altezza limitata a circa ${MAX} righe`, g.bvH >= (MAX - 1.5) * rh && g.bvH <= (MAX + 1.5) * rh,
    `${px(g.bvH / rh)} righe (${g.bvH}px, riga ${rh}px)`);
  await check(`${label}: «${t}» ha una barra di scorrimento verticale propria`, g.ownScroll,
    `scrollHeight ${g.bvSH}, clientHeight ${g.bvH}`);
  const s = await T('gridToBottom', t);
  await sleep(500);
  const h1 = await T('headerVisible', t);
  const g1 = await T('grid', t);
  await check(`${label}: «${t}» scorsa in fondo, l'intestazione delle colonne resta visibile al suo posto`,
    !!h1 && h1.inView && h1.hit && Math.abs(h1.header.top - s.before.header.top) <= 1,
    `intestazione ${px(s.before.header?.top)} -> ${px(h1?.header?.top)}, visibile=${h1?.hit}`);
  await check(`${label}: «${t}» scorsa in fondo, si vede l'ultima riga (row-index ${n - 1})`, g1.maxRowIndex === n - 1 && g1.rowsInside > 0,
    `ultima riga a video ${g1.maxRowIndex}`);
}

// ─────────────────────────────────────────────────────────────────── casi

let VP = VIEWPORTS[0];
const vpName = () => `${VP.width}x${VP.height}`;

async function caseA() {
  await openSottoconto('205.04.01', 'RICAVI LIBRI PAGA');
  const L = `205.04.01 @${vpName()}`;
  await checkSinglePage(L, TITLES, 'codice');

  // punto 2: tutte sotto il limite
  for (const [t, view] of SEZIONI) {
    const n = jsonRecordCount(view);
    if (n === null) { note(`«${t}»: lista ${view} non trovata nelle risposte, righe contate a video`); }
    const g = await T('grid', t);
    const count = n ?? g?.rendered ?? 0;
    if (count > MAX) { note(`«${t}» ha ${count} righe su 205.04.01: dati cambiati?`); await checkBigList(L, t, count); } else await checkSmallList(L, t, count);
  }

  // punto 4: ingrandimento su Versioni
  const zoom = async (t) => {
    const s = await T('sectionBox', t);
    // il pulsante della sezione: quello piu' vicino (stessa fascia verticale) al titolo
    const btns = await page.locator('button[aria-label^="Ingrandisce sezione"]:visible').evaluateAll((els) => els.map((b) => b.getBoundingClientRect().top));
    const idx = btns.findIndex((top) => s && top >= s.sec.top - 2 && top <= s.grid.top);
    return page.locator('button[aria-label^="Ingrandisce sezione"]:visible').nth(Math.max(idx, 0));
  };
  await T('resetScroll', 'codice');
  const zb = await zoom('Versioni');
  if (await check(`${L}: «Versioni» ha il pulsante «Ingrandisce sezione»`, (await zb.count()) > 0)) {
    for (const exit of ['Esc', 'pulsante']) {
      await (await zoom('Versioni')).click();
      await sleep(900);
      const shown = await T('titlesShown', TITLES);
      const sb = await T('sectionBox', 'Versioni');
      const vh = VP.height;
      info(`${L}: ingrandita, titoli a video ${JSON.stringify(shown)}, sezione ${px(sb?.sec.top)}-${px(sb?.sec.bottom)}`);
      await check(`${L}: ingrandimento (${exit}) -> si vede solo «Versioni»`, shown.length === 1 && shown[0] === 'Versioni', JSON.stringify(shown));
      await check(`${L}: ingrandimento (${exit}) -> «Versioni» occupa l'area fino in fondo alla finestra`,
        !!sb && sb.sec.bottom >= vh - 60 && sb.grid.height >= 0.4 * vh, `sezione fino a ${px(sb?.sec.bottom)} su ${vh}, griglia ${px(sb?.grid.height)}px`);
      if (exit === 'Esc') await page.keyboard.press('Escape');
      else {
        const back = page.locator('button[aria-label^="Riduce sezione"]:visible').first();
        if (!(await check(`${L}: ingrandita, c'e' il pulsante per tornare («Riduce sezione»)`, (await back.count()) > 0))) { await page.keyboard.press('Escape'); }
        else await back.click();
      }
      await sleep(900);
      const again = await T('titlesShown', TITLES);
      await check(`${L}: dopo ${exit} di nuovo tutte le sezioni`, again.length === TITLES.length, JSON.stringify(again));
    }
    const st = await T('structure', TITLES, 'codice');
    await check(`${L}: dopo l'ingrandimento nessun divisore`, st.resizers?.length === 0, JSON.stringify(st.resizers));
  }

  // punto 5: Nuovo nell'ultima sezione
  await T('resetScroll', 'codice');
  const nRicl = jsonRecordCount('riclassSottocontiSocoList');
  const sb = await T('sectionBox', 'Riclassificazioni');
  const nuovi = await page.locator('button:visible').filter({ hasText: /^\s*Nuovo\s*$/ })
    .evaluateAll((els) => els.map((b) => b.getBoundingClientRect().top));
  const ni = nuovi.findIndex((top) => sb && top >= sb.sec.top - 2 && top <= sb.grid.top);
  if (!(await check(`${L}: «Riclassificazioni» ha il suo «Nuovo»`, ni >= 0, `Nuovo a ${JSON.stringify(nuovi.map(px))}, sezione ${px(sb?.sec.top)}`))) return;
  const add = await withRequest('Add', () => page.locator('button:visible').filter({ hasText: /^\s*Nuovo\s*$/ }).nth(ni).click()).catch((e) => ({ err: e }));
  if (!(await check(`${L}: «Nuovo» di Riclassificazioni manda Add`, !add.err, add.err?.message.split('\n')[0]))) return;
  await sleep(800);
  const p = await T('panel');
  info(`${L}: pannello ${p ? `${px(p.box.top)}-${px(p.box.bottom)} su ${p.viewportH}` : 'assente'}`);
  if (await check(`${L}: «Nuovo» apre il pannello di riga`, !!p)) {
    await check(`${L}: il pannello di riga e' tutto dentro la finestra`, p.whole, `${px(p.box.top)}-${px(p.box.bottom)} su ${p.viewportH}`);
    await check(`${L}: il pannello di riga si vede (testa, centro e fondo non coperti)`, p.headHit && p.centerHit && p.bottomHit,
      `testa ${p.headHit}, centro ${p.centerHit}, fondo ${p.bottomHit}`);
  }
  const fx = await T('fixed');
  await check(`${L}: col pannello aperto la toolbar della pagina resta visibile`, fx.salvaHit);
  const c = await withRequest('Cancel', () => topButton('Annulla').click()).catch((e) => ({ err: e }));
  await check(`${L}: «Annulla» in alto scarta il rigo nuovo (Cancel)`, !c.err, c.err?.message.split('\n')[0]);
  await sleep(600);
  await check(`${L}: dopo Annulla «Annulla» e' spento`, !(await annullaEnabled()));
  const after = jsonRecordCount('riclassSottocontiSocoList');
  if (nRicl !== null && after !== null) await check(`${L}: dopo Annulla «Riclassificazioni» ha di nuovo ${nRicl} righe`, after === nRicl, `${after}`);
}

async function caseB() {
  await openSottoconto('015.01.90.01.50', 'CLIENTI C/FATTURE DA EMETTERE');
  const L = `015.01.90.01.50 @${vpName()}`;
  await checkSinglePage(L, TITLES, 'codice');
  let nSotto = null;
  for (const [t, view] of SEZIONI) {
    const n = jsonRecordCount(view) ?? (await T('grid', t))?.rendered ?? 0;
    if (t === 'Sottolivello sottoconti') nSotto = n;
    if (n > MAX) await checkBigList(L, t, n); else await checkSmallList(L, t, n);
  }
  if (!(await check(`${L}: dati: «Sottolivello sottoconti» ha piu' di 10 record (16 su ALFA)`, nSotto > 10, `${nSotto}`))) return;
  info(`${L}: «Sottolivello sottoconti» ${nSotto} record con limite ${MAX}: ${nSotto > MAX ? 'oltre il limite' : 'sotto il limite'}`);

  // punto 5: clic sull'ultimo rigo del Sottolivello
  await T('resetScroll', 'codice');
  const LAST = '015.01.90.01.50.22';
  const pt = await T('cellPoint', 'Sottolivello sottoconti', LAST);
  if (!(await check(`${L}: il rigo ${LAST} si porta a video ed e' cliccabile`, !!pt && pt.hit, JSON.stringify(pt)))) return;
  const from = LOG.length;
  await page.mouse.click(pt.x, pt.y);
  await quiet(1500);
  info(`${L}: clic sul rigo -> [${actionsOf(LOG.slice(from))}]`);
  const p = await T('panel');
  info(`${L}: pannello ${p ? `${px(p.box.top)}-${px(p.box.bottom)} su ${p.viewportH}: ${p.text.slice(0, 80)}` : 'assente'}`);
  if (await check(`${L}: il clic sul rigo apre il pannello di riga`, !!p)) {
    await check(`${L}: il pannello e' del rigo cliccato (${LAST})`, p.inputs.some((v) => v.trim() === LAST) || p.text.includes(LAST), JSON.stringify(p.inputs.slice(0, 4)));
    await check(`${L}: il pannello di riga e' tutto dentro la finestra`, p.whole, `${px(p.box.top)}-${px(p.box.bottom)} su ${p.viewportH}`);
    await check(`${L}: il pannello di riga si vede (testa, centro e fondo non coperti)`, p.headHit && p.centerHit && p.bottomHit,
      `testa ${p.headHit}, centro ${p.centerHit}, fondo ${p.bottomHit}`);
  }
  if (await annullaEnabled()) {
    note('il clic sul rigo ha sporcato la sessione: «Annulla»');
    await withRequest('Cancel', () => topButton('Annulla').click()).catch(() => {});
  }
}

/** Conto 015.01.90.01 (contiDetail), dalla catenella del campo Conto del sottoconto 015.01.90.01.50. */
async function caseE() {
  await openSottoconto('015.01.90.01.50', 'CLIENTI C/FATTURE DA EMETTERE');
  const icon = page.locator('td[id^="contoAK."] .nav-icon, td[id^="contoLL."] .nav-icon, td[id^="conto."] .nav-icon').first();
  if (!(await check('il campo Conto del sottoconto ha la catenella', (await icon.count()) > 0))) return;
  const from = LOG.length;
  await icon.click();
  await quiet(2000, 30000);
  info(`catenella del Conto -> [${actionsOf(LOG.slice(from))}]`);
  const CONTI = [['Conti', 'contiList'], ['Sottoconti', 'sottocontiList']];
  await page.waitForFunction(() => window.__t6300.titlesShown(['Sottoconti']).length === 1, null, { timeout: 20000 }).catch(() => {});
  const isConto = await page.locator('input').evaluateAll((els) => els.some((e) => e.value.trim() === '015.01.90.01')).catch(() => false);
  if (!(await check('la catenella apre il Conto 015.01.90.01', isConto, JSON.stringify(await page.locator('.ant-breadcrumb').allInnerTexts())))) return;
  const L = `Conto 015.01.90.01 @${vpName()}`;
  await checkSinglePage(L, CONTI.map(([t]) => t), 'codice');
  let nSc = null;
  for (const [t, view] of CONTI) {
    const n = jsonRecordCount(view) ?? (await T('grid', t))?.rendered ?? 0;
    if (t === 'Sottoconti') nSc = n;
    if (n > MAX) await checkBigList(L, t, n); else await checkSmallList(L, t, n);
  }
  await check(`${L}: dati: «Sottoconti» oltre il limite di ${MAX} record (47+ su ALFA)`, nSc > MAX, `${nSc}`);
}

/** Fatture > Numero 29 > Esegui > Ft. ven. 29 del 23/10/2026 > dettaglio (dettaglio con tab). */
async function caseC() {
  const FT_NUM = '29';
  const FT_DATA = '23/10/2026';
  await menuClick('Fatture', 'menu.documenti.FA');
  const num = page.locator('td[id^="numDocDa."] input').first();
  await num.waitFor({ timeout: 20000 });
  await num.fill(FT_NUM);
  await num.press('Tab');
  await quiet(800);
  await withRequest('ExecuteQuery', () => page.locator('button:visible').filter({ hasText: /^Esegui$/ }).first().click());
  const dated = page.locator('.ag-center-cols-container .ag-row').filter({ hasText: FT_DATA });
  await dated.first().waitFor({ timeout: 20000 });
  let rowIdx = null;
  for (const idx of await dated.evaluateAll((els) => els.map((e) => e.getAttribute('row-index')))) {
    const left = squash(await page.locator(`.ag-pinned-left-cols-container .ag-row[row-index="${idx}"]`).first().innerText().catch(() => ''));
    const mid = squash(await page.locator(`.ag-center-cols-container .ag-row[row-index="${idx}"]`).first().innerText().catch(() => ''));
    if (/Ft\. ven\./.test(left + ' ' + mid) && new RegExp(`(^|\\s)${FT_NUM}(\\s|$)`).test(`${left} ${mid}`)) { rowIdx = idx; break; }
  }
  if (rowIdx === null) throw new Error(`nella lista nessuna Ft. ven. ${FT_NUM} del ${FT_DATA}`);
  await withRequest('NavigateDetail', () => page.locator(`.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`).first().click());
  await page.locator('.ant-tabs-tab').filter({ hasText: 'Reg. contabili' }).first().waitFor({ timeout: 20000 });
  await sleep(800);
  const L = `Fattura 29 @${vpName()}`;
  const st = await page.evaluate(() => ({
    resizers: [...document.querySelectorAll('.view-split-resizer')].filter((e) => e.getBoundingClientRect().height > 0).length,
    tabs: [...document.querySelectorAll('.ant-tabs-tab')].map((e) => e.innerText.trim()),
  }));
  info(`${L}: tab ${JSON.stringify(st.tabs.slice(0, 6))}`);
  await check(`${L}: dettaglio con tab -> il divisore trascinabile c'e' ancora (invariato)`, st.resizers === 1, `${st.resizers} divisori`);
}

/** Modelli fiscali > Contabilita' Ordinaria: una sola lista incorporata. */
async function caseD() {
  await menuClick('Modelli fiscali', 'menu.ctb.cfgCtb.templateFiscali');
  const cell = page.locator('.ag-center-cols-container .ag-row .ag-cell').filter({ hasText: /^\s*Contabilità Ordinaria\s*$/ }).first();
  await cell.waitFor({ timeout: 20000 });
  await withRequest('NavigateDetail', () => cell.click());
  await sleep(800);
  const L = `Modelli fiscali @${vpName()}`;
  const st = await page.evaluate(() => ({
    resizers: [...document.querySelectorAll('.view-split-resizer')].filter((e) => e.getBoundingClientRect().height > 0).length,
    grids: [...document.querySelectorAll('.ag-root-wrapper')].filter((e) => e.getBoundingClientRect().height > 0).length,
    crumbs: [...document.querySelectorAll('.ant-breadcrumb')].map((b) => b.innerText.replace(/\s+/g, ' ')).join(' / '),
  }));
  info(`${L}: ${st.crumbs}; griglie ${st.grids}`);
  await check(`${L}: e' il dettaglio con una sola lista`, st.grids === 1 && /Dettaglio/.test(st.crumbs), `${st.grids} griglie, ${st.crumbs}`);
  await check(`${L}: dettaglio con UNA sola sezione-lista -> il divisore trascinabile c'e' ancora (invariato)`, st.resizers === 1, `${st.resizers} divisori`);
}

const CASES = [
  ['A Sottoconto 205.04.01 (5 sezioni, 0-1 righe): pagina unica, zoom, Nuovo', caseA, true],
  ['B Sottoconto 015.01.90.01.50 (Sottolivello 16 righe): lista sotto/oltre il limite, clic sul rigo', caseB, false],
  ['E Conto 015.01.90.01 (Sottoconti >20 record): lista oltre il limite', caseE, false],
  ['C Fattura 29 (tab): divisore invariato', caseC, false],
  ['D Modelli fiscali (una lista): divisore invariato', caseD, false],
];

// ─────────────────────────────────────────────────────────────────── main

async function launch() {
  for (let k = 1; ; k++) {
    try {
      const b = await chromium.launch({ headless: !HEADED });
      const ctx = await b.newContext({ viewport: VIEWPORTS[0] });
      const p = await ctx.newPage();
      return { b, p };
    } catch (e) {
      if (k >= 3) throw e;
      info(`avvio del browser non riuscito (${e.message.split('\n')[0]}), riprovo`);
      await sleep(2000);
    }
  }
}

let browser;
try {
  const l = await launch();
  browser = l.b;
  page = l.p;
  page.setDefaultTimeout(20000);
  await page.addInitScript(PROBE);
  track(page);
  try {
    await page.goto(await loginLink(), { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  } catch (e) {
    console.error('FAIL  accesso: ' + e.message);
    await browser.close();
    process.exit(2);
  }
  info(`entrato: ${new URL(page.url()).host}; limite del punto 2: ${MAX} record`);
  await ensureSede();
  for (const [i, vp] of VIEWPORTS.entries()) {
    VP = vp;
    await page.setViewportSize(vp);
    await sleep(500);
    for (const [name, fn, everyVp] of CASES) {
      if (ONLY && !ONLY.includes(name[0])) continue;
      if (i > 0 && !everyVp && !ALL_VP) continue;
      current = `${name} @${vpName()}`;
      console.log(`\n${current}`);
      try { await fn(); } catch (e) { await check('eccezione', false, e.message.split('\n')[0]); }
      await cleanup();
    }
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
