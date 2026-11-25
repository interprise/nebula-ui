// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Menu } from 'antd';
import type { MenuItem } from '../types/ui';
import { buildMenuItems, sidebarMenuBehaviour } from './sidebarMenu';

// SXADV-6277 — menu laterale COLLASSATO (colonna di sole icone): al passaggio
// del puntatore su un modulo deve comparire il tooltip col nome del modulo,
// senza cliccare e senza aprire il popup (che dal 6264/6270 si apre col CLIC).
// Il tooltip compare anche col fuoco da tastiera, sparisce uscendo / perdendo
// il fuoco, non resta sopra al popup aperto. Menu espanso: niente tooltip.

const LUNGO = 'Magazzino Conto Terzi - Gestione depositi esterni';

const TREE: MenuItem[] = [
  {
    id: 'menu.cfg',
    description: 'Configurazioni',
    children: [
      { id: 'parametriGen', description: 'Parametri generali', leaf: true },
      {
        id: 'tabelle',
        description: 'Tabelle',
        children: [{ id: 'festivita', description: 'Festività', leaf: true }],
      },
    ],
  },
  {
    id: 'menu.contabilita',
    description: 'Contabilità',
    children: [{ id: 'primaNota', description: 'Prima nota', leaf: true }],
  },
  {
    id: 'menu.magct',
    description: LUNGO,
    children: [{ id: 'depositi', description: 'Depositi', leaf: true }],
  },
];

const MODULI = TREE.map((m) => m.description!);

let root: Root | null = null;
let box: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  box?.remove();
  box = null;
  document.body.innerHTML = '';
});

const attendi = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const pausa = async (ms = 400) => { await act(async () => { await attendi(ms); }); };

function monta(collapsed = true) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(
      collapsed ? (
        <Menu
          mode="inline"
          inlineCollapsed
          {...sidebarMenuBehaviour(true)}
          items={buildMenuItems(TREE, 0, true) as never}
        />
      ) : (
        <Menu
          mode="inline"
          {...sidebarMenuBehaviour(false)}
          items={buildMenuItems(TREE, 0, false) as never}
        />
      ),
    );
  });
}

/** Titolo del modulo di primo livello nella barra. */
function moduleTitle(idx: number): HTMLElement {
  const titles = Array.from(box!.querySelectorAll<HTMLElement>(':scope > ul > li.ant-menu-submenu > .ant-menu-submenu-title'));
  expect(titles.length, 'moduli nella barra').toBeGreaterThan(idx);
  return titles[idx];
}

const moduleLi = (idx: number) => moduleTitle(idx).closest<HTMLElement>('li.ant-menu-submenu')!;
const isOpen = (li: HTMLElement | null | undefined) => !!li && li.classList.contains('ant-menu-submenu-open');

function visiblePopups(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-menu-submenu-popup'))
    .filter((p) => !/-hidden\b/.test(p.className) && p.style.display !== 'none');
}

/** Tooltip antd presenti e non nascosti (nessuna classe -hidden, non in uscita). */
function visibleTooltips(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-tooltip'))
    .filter((t) => !t.classList.contains('ant-tooltip-hidden')
      && !/-leave\b/.test(t.className)
      && t.style.display !== 'none');
}

const tooltipText = (t: HTMLElement) =>
  (t.querySelector('.ant-tooltip-inner, .ant-tooltip-container')?.textContent ?? t.textContent ?? '').trim();

/** Testi dei tooltip visibili. */
const tooltipTexts = () => visibleTooltips().map(tooltipText);

function entra(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: document.body }));
  });
}

function esci(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }));
  });
}

function clic(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Fuoco come lo da' il browser (focus+focusin), sul titolo e sul li. */
function fuoco(el: HTMLElement) {
  act(() => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
  });
}

function sfuoca(el: HTMLElement) {
  act(() => {
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false, relatedTarget: document.body }));
  });
}

describe('SXADV-6277 — collassato: tooltip col nome del modulo al passaggio del puntatore', () => {
  it.each(MODULI.map((n, i) => [n, i] as const))(
    'puntatore sul modulo «%s»: compare un tooltip col nome esatto, senza aprire il popup',
    async (nome, idx) => {
      monta(true);
      entra(moduleTitle(idx));
      await pausa(400);
      expect(tooltipTexts(), 'tooltip visibili').toContain(nome);
      expect(isOpen(moduleLi(idx)), 'il popup non si apre al passaggio').toBe(false);
      expect(visiblePopups().length, 'nessun popup di sottomenu').toBe(0);
    },
  );

  it('il nome lungo compare intero nel tooltip, non troncato', async () => {
    monta(true);
    entra(moduleTitle(2));
    await pausa(400);
    const t = visibleTooltips().find((el) => tooltipText(el).includes('Magazzino'));
    expect(t, 'tooltip del modulo lungo').toBeDefined();
    expect(tooltipText(t!)).toBe(LUNGO);
    expect(tooltipText(t!)).not.toMatch(/(\.\.\.|…)$/);
  });

  it('un solo tooltip di modulo per volta: passando al modulo successivo si vede il suo nome, non il precedente', async () => {
    monta(true);
    entra(moduleTitle(0));
    await pausa(400);
    esci(moduleTitle(0));
    entra(moduleTitle(1));
    await pausa(400);
    const testi = tooltipTexts();
    expect(testi).toContain('Contabilità');
    expect(testi).not.toContain('Configurazioni');
  });

  it('uscendo col puntatore il tooltip sparisce', async () => {
    monta(true);
    entra(moduleTitle(0));
    await pausa(400);
    expect(tooltipTexts()).toContain('Configurazioni');
    esci(moduleTitle(0));
    esci(moduleLi(0));
    await pausa(600);
    expect(tooltipTexts()).not.toContain('Configurazioni');
  });
});

describe('SXADV-6277 — collassato: tooltip col fuoco da tastiera', () => {
  it('il fuoco sul titolo (o sul li) del modulo mostra il tooltip col nome; perso il fuoco sparisce', async () => {
    monta(true);
    const t = moduleTitle(0);
    fuoco(t);
    fuoco(moduleLi(0));
    await pausa(400);
    expect(tooltipTexts(), 'tooltip col fuoco').toContain('Configurazioni');
    expect(isOpen(moduleLi(0)), 'il fuoco non apre il popup').toBe(false);
    sfuoca(moduleLi(0));
    sfuoca(t);
    await pausa(600);
    expect(tooltipTexts(), 'tooltip dopo il blur').not.toContain('Configurazioni');
  });
});

describe('SXADV-6277 — collassato: il tooltip non copre il popup', () => {
  it('clic sul modulo (col puntatore sopra): il popup si apre e nessun tooltip col nome resta visibile', async () => {
    monta(true);
    const t = moduleTitle(0);
    entra(t);
    await pausa(400);
    clic(t);
    await pausa(400);
    expect(isOpen(moduleLi(0)), 'popup aperto dal clic').toBe(true);
    expect(tooltipTexts()).not.toContain('Configurazioni');
  });

  it('col popup del modulo aperto, ripassare sull\'icona non fa ricomparire il tooltip', async () => {
    monta(true);
    const t = moduleTitle(0);
    clic(t);
    await pausa(200);
    expect(isOpen(moduleLi(0))).toBe(true);
    esci(t);
    await pausa(200);
    entra(t);
    await pausa(400);
    expect(isOpen(moduleLi(0)), 'popup ancora aperto').toBe(true);
    expect(tooltipTexts()).not.toContain('Configurazioni');
  });
});

describe('SXADV-6277 — espanso e voci interne', () => {
  it('menu espanso: il nome del modulo e\' scritto nella riga e nessun tooltip compare al passaggio', async () => {
    monta(false);
    const t = moduleTitle(0);
    expect((t.textContent ?? '').trim()).toContain('Configurazioni');
    entra(t);
    await pausa(400);
    expect(tooltipTexts()).not.toContain('Configurazioni');
    expect(visibleTooltips().length).toBe(0);
  });

  it('le voci dentro il popup (sottomenu e funzioni) non ricevono il tooltip di modulo', async () => {
    monta(true);
    clic(moduleTitle(0));
    await pausa(200);
    const pop = visiblePopups()[0];
    expect(pop, 'popup del modulo').toBeDefined();
    const interne = Array.from(pop.querySelectorAll<HTMLElement>('.ant-menu-submenu-title, li.ant-menu-item'));
    expect(interne.length).toBeGreaterThan(0);
    for (const el of interne) {
      entra(el);
      await pausa(300);
      const testi = tooltipTexts();
      expect(testi, `tooltip su «${el.textContent}»`).not.toContain('Configurazioni');
      esci(el);
      await pausa(300);
    }
  });
});

describe('SXADV-6277 — non regressioni', () => {
  it('collassato: il nome del modulo resta nel testo del li/titolo (accessibile)', () => {
    monta(true);
    MODULI.forEach((nome, i) => {
      expect((moduleLi(i).textContent ?? '')).toContain(nome);
    });
  });

  it('collassato: il popup aperto ha ancora in testa il gruppo col nome del modulo (6270)', async () => {
    monta(true);
    clic(moduleTitle(0));
    await pausa(200);
    const pop = visiblePopups()[0];
    expect(pop, 'popup del modulo').toBeDefined();
    const group = pop.querySelector<HTMLElement>('.ant-menu-item-group-title');
    expect(group, 'gruppo del modulo').not.toBeNull();
    expect((group!.textContent ?? '').trim()).toContain('Configurazioni');
  });
});
