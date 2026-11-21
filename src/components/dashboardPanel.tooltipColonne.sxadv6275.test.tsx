// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// SXADV-6275 — testata di un widget a tabella della dashboard, bottone «Colonne»
// (icona dentro un Tooltip, dentro un Popover a clic). Il difetto: mouse su «Colonne»
// (tooltip), clic (popover «Colonne da mostrare»), chiusura del popover, mouse su
// un'altra icona («Modifica»): il tooltip «Colonne» ricompariva e restava a schermo
// sovrapposto a quello dell'icona puntata.
// Atteso:
//   - mentre il popover e' aperto, il tooltip «Colonne» non c'e';
//   - dopo l'apertura del popover il tooltip «Colonne» non ricompare finche' il mouse
//     non torna sopra il bottone;
//   - a popover chiuso, il passaggio del mouse lo mostra come sempre.
// DashboardPanel montato davvero (React + antd in jsdom), col server finto.

const server = vi.hoisted(() => ({
  widget: [] as unknown[],
  chiamate: [] as { action: string; params: Record<string, string> }[],
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string>) => {
    server.chiamate.push({ action, params: { ...(params || {}) } });
    switch (action) {
      case 'dashboard.Get': return { widget: server.widget };
      case 'dashboard.SegnaViste': return { segnate: [] };
      default: return {};
    }
  },
  subscribeInFlight: () => () => {},
}));
vi.mock('../hooks/feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/feedback')>()),
  useFeedback: () => ({
    showServerMessages: () => {}, error: () => {}, warning: () => {}, info: () => {}, failure: () => {},
  }),
}));
vi.mock('./BannerCard', () => ({ default: () => null }));

const { default: DashboardPanel } = await import('./DashboardPanel');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function widgetTabella(id: number, titolo: string) {
  return {
    idWidget: id,
    titolo,
    modificabile: true,
    dettaglio: 'documentiDetail',
    colonne: [
      { item: 'numero', etichetta: 'Numero' },
      { item: 'cliente', etichetta: 'Cliente' },
    ],
    fotografia: {
      stato: 'OK',
      ts: '2026-11-20T08:00:00',
      totaleRighe: 2,
      righeInFotografia: 2,
      righe: [
        { k: 'K1', c: [{ t: 'N1' }, { t: 'Rossi' }] },
        { k: 'K2', c: [{ t: 'N2' }, { t: 'Bianchi' }] },
      ],
    },
  };
}

let host: HTMLDivElement;
let root: Root;

/** Lascia passare `ms` coi timer finti, dentro act. */
async function passa(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function monta(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<DashboardPanel />);
  });
  await passa(200);
}

const bottone = (nome: string): HTMLElement => {
  const b = host.querySelector<HTMLElement>(`button[aria-label="${nome}"]`);
  expect(b, `il bottone «${nome}»`).not.toBeNull();
  return b!;
};

// Come un mouse vero: React ricava mouseenter/mouseleave (e pointerenter/leave) da
// mouseover/mouseout col relatedTarget.
async function entra(el: HTMLElement, da: Element = document.body): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: da }));
    if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: da }));
  });
  await passa(300);
}
async function esce(el: HTMLElement, verso: Element = document.body): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: verso }));
    if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: verso }));
  });
  await passa(300);
}
async function clic(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await passa(300);
}
/** Un clic su un punto qualunque fuori dal popover e dal bottone. */
async function clicFuori(): Promise<void> {
  const fuori = document.createElement('div');
  document.body.appendChild(fuori);
  await clic(fuori);
}

/** I tooltip a schermo (non nascosti) col testo esatto `testo`. */
const tooltipVisibili = (testo: string): Element[] =>
  [...document.querySelectorAll('.ant-tooltip')].filter((t) => {
    if (t.classList.contains('ant-tooltip-hidden')) return false;
    if ((t as HTMLElement).style.display === 'none') return false;
    const inner = t.querySelector('.ant-tooltip-inner, .ant-tooltip-container') ?? t;
    return (inner.textContent || '').trim() === testo;
  });
const tooltip = (testo: string) => tooltipVisibili(testo).length > 0;

/** Il popover «Colonne da mostrare» a schermo. */
const popoverAperto = (): boolean =>
  [...document.querySelectorAll('.ant-popover')].some(
    (p) => !p.classList.contains('ant-popover-hidden') && (p as HTMLElement).style.display !== 'none'
      && /Colonne da mostrare/.test(p.textContent || ''),
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  server.chiamate = [];
  server.widget = [widgetTabella(7, 'Fatture da incassare')];
  try { localStorage.clear(); } catch { /* niente */ }
  await monta();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('SXADV-6275 tooltip «Colonne» e popover «Colonne da mostrare»', () => {
  it('impianto: il widget a tabella ha i bottoni «Colonne» e «Modifica»', () => {
    bottone('Colonne');
    bottone('Modifica');
  });

  it('a popover chiuso il tooltip «Colonne» compare al passaggio del mouse e se ne va all\'uscita', async () => {
    const b = bottone('Colonne');
    await entra(b);
    expect(tooltip('Colonne'), 'mouse sopra: tooltip').toBe(true);
    await esce(b);
    expect(tooltip('Colonne'), 'mouse fuori: niente tooltip').toBe(false);
  });

  it('mentre il popover e\' aperto il tooltip «Colonne» non c\'e\'', async () => {
    const b = bottone('Colonne');
    await entra(b);
    expect(tooltip('Colonne')).toBe(true);
    await clic(b);
    expect(popoverAperto(), 'il popover si apre').toBe(true);
    expect(tooltip('Colonne'), 'col popover aperto, niente tooltip').toBe(false);
  });

  it('scenario del ticket: chiuso il popover con un clic fuori, sull\'icona «Modifica» si vede solo il suo tooltip', async () => {
    const b = bottone('Colonne');
    const m = bottone('Modifica');
    await entra(b);
    await clic(b);
    expect(popoverAperto()).toBe(true);
    await esce(b, document.body);
    await clicFuori();
    expect(popoverAperto(), 'il popover si e\' chiuso').toBe(false);
    expect(tooltip('Colonne'), 'chiuso il popover, «Colonne» non ricompare').toBe(false);
    await entra(m);
    expect(tooltip('Modifica'), 'il tooltip dell\'icona puntata').toBe(true);
    expect(tooltip('Colonne'), '«Colonne» non resta sovrapposto').toBe(false);
  });

  it('scenario del ticket: chiuso il popover col secondo clic sul bottone, poi su «Modifica»: niente «Colonne»', async () => {
    const b = bottone('Colonne');
    const m = bottone('Modifica');
    await entra(b);
    await clic(b);
    expect(popoverAperto()).toBe(true);
    await clic(b);
    expect(popoverAperto(), 'il secondo clic chiude').toBe(false);
    expect(tooltip('Colonne'), 'appena chiuso, col mouse ancora sopra: il tooltip non ricompare').toBe(false);
    await esce(b, m);
    await entra(m, b);
    expect(tooltip('Modifica')).toBe(true);
    expect(tooltip('Colonne'), '«Colonne» non resta sovrapposto').toBe(false);
  });

  it('dopo la chiusura il tooltip resta via anche col tempo che passa, finche\' il mouse non torna', async () => {
    const b = bottone('Colonne');
    await entra(b);
    await clic(b);
    await esce(b);
    await clicFuori();
    await passa(3000);
    expect(tooltip('Colonne')).toBe(false);
  });

  it('il mouse che torna sopra «Colonne» a popover chiuso lo rimostra normalmente', async () => {
    const b = bottone('Colonne');
    const m = bottone('Modifica');
    await entra(b);
    await clic(b);
    await esce(b);
    await clicFuori();
    await entra(m);
    await esce(m);
    expect(tooltip('Colonne')).toBe(false);
    await entra(b);
    expect(tooltip('Colonne'), 'mouse di nuovo sopra: il tooltip c\'e\'').toBe(true);
    await esce(b);
    expect(tooltip('Colonne')).toBe(false);
  });
});
