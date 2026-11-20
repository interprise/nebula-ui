// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Menu } from 'antd';
import type { MenuItem } from '../types/ui';
import { buildMenuItems, sidebarMenuBehaviour, SIDEBAR_POPUP_CLASS } from './sidebarMenu';

// SXADV-6264 / 6270 / 6271 — menu laterale sinistro COLLASSATO.
//  6270.1: uscendo col puntatore dal popup prima di cliccare il menu si
//          richiudeva: collassato i sottomenu si aprono col CLIC e non si
//          chiudono quando il puntatore esce.
//  6270.2: i popup hanno lo stesso fondo dell'area funzioni del menu espanso:
//          ogni voce con figli porta popupClassName con SIDEBAR_POPUP_CLASS.
//  6271:   nessun popup figlio resta aperto col genitore chiuso; un clic fuori
//          o la scelta di una funzione chiudono tutto.
//  6264:   i popup restano dentro la finestra in verticale (rc-trigger
//          builtinPlacements con overflow.shiftY sui piazzamenti dei sottomenu
//          verticali). jsdom non fa layout: si prova il contratto.
//  Espanso: antd di default (nessun triggerSubMenuAction 'click').

const TREE: MenuItem[] = [
  {
    id: 'menu.contabilita',
    description: 'Contabilità',
    children: [
      { id: 'primaNota', description: 'Prima nota', leaf: true },
      {
        id: 'fattAttiva',
        description: 'Fatt. attiva',
        children: [
          { id: 'fatture', description: 'Fatture', leaf: true },
          { id: 'riepilogoDoc', description: 'Riepilogo documenti', leaf: true },
        ],
      },
    ],
  },
  {
    id: 'menu.utilita',
    description: 'Utilità',
    children: [
      { id: 'parametri', description: 'Parametri', leaf: true },
      {
        id: 'strumenti',
        description: 'Strumenti',
        children: [
          {
            id: 'strumentiAvanzati',
            description: 'Avanzati',
            children: [{ id: 'ricalcolo', description: 'Ricalcolo', leaf: true }],
          },
        ],
      },
    ],
  },
];

type AnyItem = Record<string, unknown> & { children?: AnyItem[] };

/** Ogni voce dell'albero items di antd, con la profondita'. */
function walk(items: unknown, out: AnyItem[] = []): AnyItem[] {
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    out.push(it as AnyItem);
    walk((it as AnyItem).children, out);
  }
  return out;
}

const keyOf = (i: AnyItem) => String(i.key ?? '');

describe('SXADV-6270.2 — buildMenuItems: popupClassName su ogni voce con figli', () => {
  it('SIDEBAR_POPUP_CLASS e\' una classe CSS non vuota', () => {
    expect(typeof SIDEBAR_POPUP_CLASS).toBe('string');
    expect(SIDEBAR_POPUP_CLASS.trim()).not.toBe('');
    expect(SIDEBAR_POPUP_CLASS).not.toMatch(/\s/);
  });

  it.each([
    ['collassato', true],
    ['espanso', false],
  ])('%s: ogni sottomenu (a qualsiasi livello) ha popupClassName con SIDEBAR_POPUP_CLASS', (_n, collapsed) => {
    const items = walk(buildMenuItems(TREE, 0, collapsed));
    const submenus = items.filter((i) => Array.isArray(i.children) && i.children.length > 0 && i.type !== 'group');
    // modulo Contabilita', Fatt. attiva, modulo Utilita', Strumenti, Avanzati
    expect(submenus.length).toBeGreaterThanOrEqual(5);
    for (const s of submenus) {
      const cls = String(s.popupClassName ?? '').split(/\s+/);
      expect(cls, `popupClassName di ${keyOf(s)}`).toContain(SIDEBAR_POPUP_CLASS);
    }
  });

  it('collassato: anche i sottomenu di terzo livello (Strumenti > Avanzati) portano la classe', () => {
    const items = walk(buildMenuItems(TREE, 0, true));
    const deep = items.find((i) => keyOf(i).includes('strumentiAvanzati') && i.type !== 'group');
    expect(deep, 'voce Avanzati').toBeDefined();
    expect(String(deep!.popupClassName ?? '')).toContain(SIDEBAR_POPUP_CLASS);
  });

  it('le foglie non sono sottomenu (niente children)', () => {
    const items = walk(buildMenuItems(TREE, 0, true));
    const leaf = items.find((i) => keyOf(i).includes('riepilogoDoc'));
    expect(leaf).toBeDefined();
    expect(leaf!.children).toBeUndefined();
  });

  it('collassato: il modulo radice incapsula le funzioni in un gruppo titolato col nome del modulo (come prima)', () => {
    const top = buildMenuItems(TREE, 0, true) as unknown as AnyItem[];
    const cont = top.find((i) => keyOf(i).includes('contabilita'));
    expect(cont).toBeDefined();
    const group = cont!.children?.find((c) => c.type === 'group');
    expect(group, 'gruppo del modulo').toBeDefined();
    const label = group!.label;
    const text = typeof label === 'string' ? label : JSON.stringify(label);
    expect(text).toContain('Contabilità');
  });
});

describe('SXADV-6270.1 / 6264 — sidebarMenuBehaviour', () => {
  it('collassato: i sottomenu si aprono col clic', () => {
    expect(sidebarMenuBehaviour(true).triggerSubMenuAction).toBe('click');
  });

  it('espanso: nessun triggerSubMenuAction \'click\' imposto (default antd)', () => {
    expect(sidebarMenuBehaviour(false).triggerSubMenuAction).not.toBe('click');
  });

  it('collassato: rightTop (piazzamento dei sottomenu verticali) scorre in verticale per restare nella finestra', () => {
    const p = sidebarMenuBehaviour(true).builtinPlacements as Record<string, { points?: string[]; overflow?: Record<string, unknown> }> | undefined;
    expect(p, 'builtinPlacements').toBeDefined();
    const rt = p!.rightTop;
    expect(rt, 'rightTop').toBeDefined();
    // Stessi punti di aggancio di rc-menu: il popup parte accanto alla voce.
    expect(rt.points).toEqual(['tl', 'tr']);
    expect(rt.overflow?.shiftY).toBeTruthy();
    expect(rt.overflow?.adjustX).toBeTruthy();
    expect(rt.overflow?.adjustY).toBeTruthy();
  });

  it('collassato: anche leftTop (vertical-right / RTL) scorre in verticale', () => {
    const p = sidebarMenuBehaviour(true).builtinPlacements as Record<string, { overflow?: Record<string, unknown> }> | undefined;
    expect(p?.leftTop?.overflow?.shiftY).toBeTruthy();
    expect(p?.leftTop?.overflow?.adjustY).toBeTruthy();
  });
});

// ---------------------------------------------------------------- DOM antd

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

function monta(onClick = vi.fn()) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => {
    root!.render(
      <Menu
        mode="inline"
        inlineCollapsed
        {...sidebarMenuBehaviour(true)}
        items={buildMenuItems(TREE, 0, true) as never}
        onClick={onClick}
      />,
    );
  });
  return onClick;
}

/** Il <li> del sottomenu con quel testo (nella barra o in un popup). */
function submenuLi(text: string): HTMLElement | undefined {
  const titles = Array.from(document.querySelectorAll<HTMLElement>('.ant-menu-submenu-title'));
  const t = titles.find((el) => (el.textContent ?? '').trim().includes(text));
  return t?.closest<HTMLElement>('li.ant-menu-submenu') ?? undefined;
}

/** Il titolo del modulo radice (nella barra collassata): il primo sottomenu di primo livello. */
function moduleTitle(idx: number): HTMLElement {
  const titles = Array.from(box!.querySelectorAll<HTMLElement>(':scope > ul > li.ant-menu-submenu > .ant-menu-submenu-title'));
  expect(titles.length, 'moduli nella barra').toBeGreaterThan(idx);
  return titles[idx];
}

function titleOf(text: string): HTMLElement {
  const li = submenuLi(text);
  expect(li, `sottomenu «${text}»`).toBeDefined();
  return li!.querySelector<HTMLElement>(':scope > .ant-menu-submenu-title')!;
}

const isOpen = (li: HTMLElement | null | undefined) => !!li && li.classList.contains('ant-menu-submenu-open');

/** I popup di sottomenu presenti e non nascosti. */
function visiblePopups(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-menu-submenu-popup'))
    .filter((p) => !/-hidden\b/.test(p.className) && p.style.display !== 'none');
}

function leaf(text: string): HTMLElement {
  const items = Array.from(document.querySelectorAll<HTMLElement>('li.ant-menu-item'));
  const it = items.find((el) => (el.textContent ?? '').trim().includes(text));
  expect(it, `voce «${text}»`).toBeDefined();
  return it!;
}

function clic(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function esci(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }));
  });
}

async function apriContabilita() {
  clic(moduleTitle(0));
  await act(async () => { await attendi(50); });
  expect(isOpen(moduleTitle(0).closest('li')), 'Contabilità aperto dal clic').toBe(true);
}

async function apriFattAttiva() {
  await apriContabilita();
  clic(titleOf('Fatt. attiva'));
  await act(async () => { await attendi(50); });
  expect(isOpen(submenuLi('Fatt. attiva')), 'Fatt. attiva aperto dal clic').toBe(true);
}

describe('SXADV-6270.1 / 6271 — antd <Menu> collassato con sidebarMenuBehaviour', () => {
  it('il popup porta la classe SIDEBAR_POPUP_CLASS (fondo come l\'area funzioni)', async () => {
    monta();
    await apriContabilita();
    const pops = visiblePopups();
    expect(pops.length).toBeGreaterThan(0);
    expect(pops.some((p) => p.classList.contains(SIDEBAR_POPUP_CLASS))).toBe(true);
  });

  it('il passaggio del mouse sul modulo NON apre il popup (si apre col clic)', async () => {
    monta();
    const t = moduleTitle(0);
    act(() => {
      t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    await act(async () => { await attendi(400); });
    expect(isOpen(t.closest('li'))).toBe(false);
  });

  it('clic sul modulo apre il popup; uscire col puntatore e aspettare non lo chiude', async () => {
    monta();
    await apriContabilita();
    const li = moduleTitle(0).closest('li')!;
    esci(li);
    for (const p of visiblePopups()) esci(p);
    await act(async () => { await attendi(400); });
    expect(isOpen(li)).toBe(true);
  });

  it('clic su un sottomenu nel popup apre il figlio; uscire dai popup non chiude ne\' figlio ne\' genitore', async () => {
    monta();
    await apriFattAttiva();
    const child = submenuLi('Fatt. attiva')!;
    esci(child);
    for (const p of visiblePopups()) esci(p);
    esci(moduleTitle(0).closest('li')!);
    await act(async () => { await attendi(400); });
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(true);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(true);
    // «Riepilogo documenti» resta raggiungibile.
    expect(leaf('Riepilogo documenti')).toBeTruthy();
  });

  it('clic su una foglia chiama onClick con la sua chiave e chiude tutto', async () => {
    const onClick = monta();
    await apriFattAttiva();
    clic(leaf('Riepilogo documenti'));
    await act(async () => { await attendi(400); });
    expect(onClick).toHaveBeenCalledTimes(1);
    const arg = onClick.mock.calls[0][0] as { key: string };
    expect(String(arg.key)).toContain('riepilogoDoc');
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(false);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(false);
    expect(document.querySelectorAll('.ant-menu-submenu-open').length).toBe(0);
  });

  it('clic fuori dal menu chiude genitore e figlio insieme', async () => {
    monta();
    await apriFattAttiva();
    const fuori = document.createElement('button');
    document.body.appendChild(fuori);
    clic(fuori);
    await act(async () => { await attendi(400); });
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(false);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(false);
    expect(document.querySelectorAll('.ant-menu-submenu-open').length).toBe(0);
    expect(visiblePopups().length, 'popup ancora visibili').toBe(0);
  });

  it('dopo un clic fuori, riaprendo il modulo il figlio NON e\' gia\' aperto (6271)', async () => {
    monta();
    await apriFattAttiva();
    const fuori = document.createElement('button');
    document.body.appendChild(fuori);
    clic(fuori);
    await act(async () => { await attendi(400); });
    clic(moduleTitle(0));
    await act(async () => { await attendi(50); });
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(true);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(false);
  });

  it('chiudendo il genitore col clic sul suo titolo, il figlio non resta aperto', async () => {
    monta();
    await apriFattAttiva();
    clic(moduleTitle(0));
    await act(async () => { await attendi(400); });
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(false);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(false);
  });

  it('aprendo un altro modulo, il primo e i suoi figli si chiudono', async () => {
    monta();
    await apriFattAttiva();
    clic(moduleTitle(1));
    await act(async () => { await attendi(400); });
    expect(isOpen(moduleTitle(1).closest('li'))).toBe(true);
    expect(isOpen(moduleTitle(0).closest('li'))).toBe(false);
    expect(isOpen(submenuLi('Fatt. attiva'))).toBe(false);
  });
});
