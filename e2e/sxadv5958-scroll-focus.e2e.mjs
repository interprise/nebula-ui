/**
 * SXADV-5958 — mappa Fatture attive, filtro "Stato SDI" (MultiSelect con
 * reload): la Conferma del pannello e la X di una pastiglia non devono
 * riportare la mappa in cima ne' mandare il cursore su "ID DOC".
 *
 * Prova nel browser VERO, contro il client dal dev server Vite e il Tomcat vero
 * (nessun server simulato), con clic veri del mouse (locator.click /
 * page.mouse), non element.click() dentro evaluate.
 *
 * Casi:
 *   0. (guardia SXADV-5803) aperta la mappa dal menu, il cursore va sul primo
 *      campo modificabile;
 *   1. (5958.1) mappa scorsa fino a Stato SDI, fuoco su <body>: clic sulla banda
 *      "Clicca per selezionare", due voci spuntate, "Conferma" -> dopo la
 *      risposta del Post lo scorrimento di .view-body e' lo stesso (±5 px) e il
 *      fuoco NON e' su ID DOC ma dentro il controllo Stato SDI (bottone);
 *   2. (5958.2) X su una pastiglia -> stesse verifiche, resta una pastiglia;
 *   3. X sull'ultima pastiglia -> dopo la risposta non resta nessuna pastiglia
 *      (il CORE rimandava la selezione di prima), e stesse verifiche.
 *
 * Accesso: `entrasp-sql --login-session <utente> --to <APP>` (link monouso che
 * imposta il cookie e rimanda all'app; nessuna password passa di qui).
 *
 * Uso (da entrasp-ui/):
 *   node e2e/sxadv5958-scroll-focus.e2e.mjs [--headed] [--only <sottostringa>]
 *   APP=http://localhost:5176/entrasp/app/  USER_LOGIN=44AMM  (default)
 *   PLAYWRIGHT_DIR=<node_modules con playwright>  (default: la cache di npx)
 * Il dev server: npx vite --config vite.config.poll.mts --port 5176 --strictPort
 * Esce con 1 se almeno una verifica fallisce, 2 se non riesce a entrare.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(
  (process.env.PLAYWRIGHT_DIR || '/home/luca/.npm/_npx/e41f203b7505f1fb/node_modules').replace(/\/?$/, '/'),
);
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:5176/entrasp/app/';
const USER = process.env.USER_LOGIN || process.env.ENTRASP_USER || '44AMM';
const MENU_ID = 'menu.documenti.FA';
const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

// ─────────────────────────────────────────────────────────────────── esiti
const FAILED = [];
let nPass = 0;
let current = '';
function check(what, ok, why = '') {
  if (ok) { nPass += 1; console.log(`  PASS ${what}`); } else {
    FAILED.push(`${current} · ${what}${why ? ' — ' + why : ''}`);
    console.log(`  FAIL ${what}${why ? ': ' + why : ''}`);
  }
  return ok;
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

// ───────────────────────────────────────────────────── letture della pagina

/** Marca il controllo Stato SDI (data-e2e="stsdi") e il suo .view-body
 *  (data-e2e="body"): dall'etichetta "Stato SDI" si risale al primo antenato
 *  che contiene un .multiselect-container. Da rifare dopo ogni ridisegno. */
async function mark(page) {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.tab-content *'))
      .filter((el) => el.children.length === 0 && /^\s*Stato SDI\s*:?\s*$/i.test(el.textContent || ''))
      .filter((el) => el.getClientRects().length > 0);
    for (const l of labels) {
      for (let a = l.parentElement; a; a = a.parentElement) {
        const ms = a.querySelector('.multiselect-container');
        if (ms) {
          document.querySelectorAll('[data-e2e]').forEach((x) => x.removeAttribute('data-e2e'));
          ms.setAttribute('data-e2e', 'stsdi');
          const body = ms.closest('.view-body');
          if (body) body.setAttribute('data-e2e', 'body');
          return true;
        }
      }
    }
    return false;
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-e2e="body"]');
    const ms = document.querySelector('[data-e2e="stsdi"]');
    const a = document.activeElement;
    return {
      scrollTop: body ? body.scrollTop : null,
      active: a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.className && typeof a.className === 'string' ? '.' + a.className.split(/\s+/).slice(0, 2).join('.') : ''}` : null,
      activeIsBody: a === document.body,
      activeIsIdDoc: !!(a && a.id && /^idDocumento\b/.test(a.id)),
      activeInStSdi: !!(ms && a && ms.contains(a)),
      activeIsPicker: !!(a && a.closest && a.closest('.multiselect-picker-btn')),
      chips: ms ? ms.querySelectorAll('.multiselect-chip').length : -1,
    };
  });
}

/** Aspetta la risposta del Post partito dall'azione, poi 1 s di assestamento. */
async function withPost(page, act) {
  const resp = page.waitForResponse((r) => {
    if (!new URL(r.url()).pathname.endsWith('/controller')) return false;
    const pd = r.request().postData() || '';
    return /(^|&)action=Post(&|$)/.test(pd);
  }, { timeout: 20000 });
  await act();
  const r = await resp;
  const pd = r.request().postData() || '';
  const sent = new URLSearchParams(pd);
  const stSdiKey = [...sent.keys()].find((k) => /^stSdi\./.test(k));
  info(`Post -> ${r.status()} ${stSdiKey ? `${stSdiKey}=${JSON.stringify(sent.get(stSdiKey))}` : '(stSdi non spedito)'}`);
  await sleep(1000);
  await mark(page);
}

function assertKept(before, after) {
  info(`scrollTop ${before.scrollTop} -> ${after.scrollTop}; fuoco ${after.active}`);
  check('lo scorrimento della mappa resta (±5 px)',
    before.scrollTop != null && after.scrollTop != null && Math.abs(after.scrollTop - before.scrollTop) <= 5,
    `prima ${before.scrollTop}, dopo ${after.scrollTop}`);
  check('il fuoco NON e\' su ID DOC', !after.activeIsIdDoc, after.active);
  check('il fuoco e\' dentro il controllo Stato SDI', after.activeInStSdi, after.active);
  if (after.activeInStSdi && !after.activeIsPicker) info('(fuoco nel controllo ma non sul bottone .multiselect-picker-btn)');
}

// ───────────────────────────────────────────────────────────────── percorso

async function openFromMenu(page) {
  const search = page.getByPlaceholder('Cerca nel menu...');
  await search.click();
  await search.fill('Fatture');
  let item = page.locator(`li[data-menu-id$="-${MENU_ID}"]`).first();
  if (!(await item.count())) {
    // Ripiego: la voce per testo sotto "Fatt. attiva".
    const sub = page.locator('.ant-menu-submenu').filter({ hasText: 'Fatt. attiva' }).last();
    item = sub.locator('.ant-menu-item').filter({ hasText: /^Fatture( attive)?$/ }).first();
  }
  const opened = page.waitForResponse((r) => (r.request().postData() || '').includes('action=ExecuteMenuItem'), { timeout: 30000 });
  await item.click();
  await opened;
  await page.waitForSelector('.multiselect-container', { timeout: 30000 });
  await sleep(800);
  if (!(await mark(page))) throw new Error('controllo "Stato SDI" non trovato sulla mappa');
}

async function centerStSdiAndBlur(page) {
  await page.evaluate(() => {
    const ms = document.querySelector('[data-e2e="stsdi"]');
    const body = document.querySelector('[data-e2e="body"]');
    if (ms && body) {
      const r = ms.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      body.scrollTop += (r.top + r.height / 2) - (b.top + b.height / 2);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await sleep(300);
}

const stsdi = (page) => page.locator('[data-e2e="stsdi"]');

// ─────────────────────────────────────────────────────────────────── main

let browser;
try {
  browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 850 } });
  const page = await ctx.newPage();
  try {
    await page.goto(loginLink(), { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Cerca nel menu...').waitFor({ timeout: 30000 });
  } catch (e) {
    console.error('FAIL  accesso: ' + e.message);
    await browser.close();
    process.exit(2);
  }

  const run = (name) => !ONLY || name.toLowerCase().includes(ONLY.toLowerCase());

  current = '0 apertura dal menu (SXADV-5803)';
  console.log(`\n${current}`);
  await openFromMenu(page);
  await sleep(500);
  {
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      const view = document.querySelector('.tab-content .view-container');
      return { tag: a?.tagName, id: a?.id || '', inView: !!(view && a && view.contains(a)) };
    });
    info(`fuoco su ${f.tag}#${f.id}`);
    check('il cursore e\' su un campo della mappa', f.inView && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tag || ''), JSON.stringify(f));
    check('ed e\' ID DOC (primo campo modificabile)', /^idDocumento\b/.test(f.id), f.id);
  }

  if (run('5958.1')) {
    current = '5958.1 banda -> due voci -> Conferma';
    console.log(`\n${current}`);
    await centerStSdiAndBlur(page);
    const before = await snapshot(page);
    info(`prima: scrollTop ${before.scrollTop}, pastiglie ${before.chips}`);
    check('la mappa e\' scorsa (il caso ha senso)', (before.scrollTop ?? 0) > 50, `scrollTop ${before.scrollTop}`);
    const band = stsdi(page).locator('.multiselect-chips');
    const hint = band.getByText('Clicca per selezionare');
    await ((await hint.count()) ? hint : band).click();
    await page.locator('.ant-drawer .multiselect-option').first().waitFor({ timeout: 20000 });
    const deselect = page.locator('.ant-drawer button').filter({ hasText: 'Deseleziona tutto' });
    if (await deselect.isEnabled().catch(() => false)) await deselect.click();
    const opts = page.locator('.ant-drawer .multiselect-option').filter({ hasNotText: /Non Valorizzato/i });
    await opts.nth(0).click();
    await opts.nth(1).click();
    await withPost(page, () => page.locator('.ant-drawer button').filter({ hasText: /^Conferma/ }).click());
    const after = await snapshot(page);
    assertKept(before, after);
    check('due pastiglie dopo la Conferma', after.chips === 2, `pastiglie ${after.chips}`);
  }

  if (run('5958.2')) {
    current = '5958.2 X su una pastiglia';
    console.log(`\n${current}`);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const before = await snapshot(page);
    if (before.chips < 2) info(`attese 2 pastiglie per partire, ce ne sono ${before.chips}`);
    if (before.chips >= 1) {
      await withPost(page, () => stsdi(page).locator('.multiselect-chip .anticon-close').first().click());
      const after = await snapshot(page);
      assertKept(before, after);
      check('una pastiglia in meno', after.chips === before.chips - 1, `prima ${before.chips}, dopo ${after.chips}`);
    } else check('c\'e\' una pastiglia da togliere', false, 'nessuna pastiglia');
  }

  if (run('ultima')) {
    current = 'X sull\'ultima pastiglia: filtro tolto';
    console.log(`\n${current}`);
    let s = await snapshot(page);
    // Toglie tutte le pastiglie tranne l'ultima, senza verifiche.
    while (s.chips > 1) {
      await withPost(page, () => stsdi(page).locator('.multiselect-chip .anticon-close').first().click());
      s = await snapshot(page);
    }
    if (s.chips === 1) {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      const before = await snapshot(page);
      await withPost(page, () => stsdi(page).locator('.multiselect-chip .anticon-close').first().click());
      const after = await snapshot(page);
      check('dopo la risposta non resta nessuna pastiglia', after.chips === 0, `pastiglie ${after.chips} (il server ha rimandato la selezione?)`);
      assertKept(before, after);
    } else check('c\'e\' un\'ultima pastiglia da togliere', false, `pastiglie ${s.chips}`);
  }
} catch (e) {
  FAILED.push(`${current} · eccezione: ${e.message}`);
  console.log(`  FAIL eccezione: ${e.message}`);
} finally {
  if (browser) await browser.close();
}

console.log(`\n${nPass} PASS, ${FAILED.length} FAIL`);
for (const f of FAILED) console.log('  - ' + f);
process.exit(FAILED.length ? 1 : 0);
