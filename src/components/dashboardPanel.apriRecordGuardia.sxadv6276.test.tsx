// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// SXADV-6276, lato dashboard: il clic su una riga di un widget, dalla Home, segue la
// stessa regola di «Apri la lista completa» (SXADV-6125): se la scheda di lavoro e' in
// uso il dettaglio va in una scheda nuova, e al limite delle sessioni avviso e nessuna
// apertura, SENZA nemmeno chiamare dashboard.ApriRecord.
// La Shell offre alla dashboard due domande: `puoAprire` (la scheda di lavoro e' libera?)
// e `puoNavigare` (si puo' aprire la lista in una scheda sua? con il limite delle
// sessioni). Al limite la Shell risponde puoAprire=si' (la scheda di lavoro non sta
// lavorando) e puoNavigare=no: la riga deve fermarsi come la lista completa.
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
      case 'dashboard.ApriRecord': return { esito: 'ok', viewName: 'documentiDetail' };
      case 'dashboard.PreparaNaviga': return { esito: 'ok' };
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

const widget = {
  idWidget: 7,
  titolo: 'Fatture da incassare',
  dettaglio: 'documentiDetail',
  colonne: [{ item: 'numero', etichetta: 'Numero' }],
  fotografia: {
    stato: 'OK',
    ts: '2026-11-20T08:00:00',
    totaleRighe: 1,
    righeInFotografia: 1,
    righe: [{ k: 'K7', c: [{ t: 'N7' }] }],
  },
};

let host: HTMLDivElement;
let root: Root;

async function passa(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function monta(props: Record<string, unknown>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<DashboardPanel {...props} />); });
  await passa(200);
}

async function clicRiga(): Promise<void> {
  const tr = host.querySelector<HTMLElement>('tr[title="Apri il dettaglio"]');
  expect(tr, 'la riga apribile del widget').not.toBeNull();
  await act(async () => { tr!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await passa(100);
}

const apriRecord = () => server.chiamate.filter((c) => c.action === 'dashboard.ApriRecord');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  server.chiamate = [];
  server.widget = [widget];
  try { localStorage.clear(); } catch { /* niente */ }
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('SXADV-6276 riga di un widget: la stessa guardia della lista completa', () => {
  it('limite delle sessioni (puoNavigare no, puoAprire si\'): nessuna ApriRecord, nessuna apertura', async () => {
    const onApriDettaglio = vi.fn(() => true);
    const puoNavigare = vi.fn(() => false);
    const puoAprire = vi.fn(() => true);
    await monta({ onApriDettaglio, puoNavigare, puoAprire, onNaviga: () => true });
    await clicRiga();
    expect(puoNavigare, 'la dashboard chiede se si puo\' aprire una scheda sua').toHaveBeenCalled();
    expect(apriRecord(), 'nessuna dashboard.ApriRecord').toEqual([]);
    expect(onApriDettaglio).not.toHaveBeenCalled();
  });

  it('puoNavigare si\': ApriRecord parte e il dettaglio si apre', async () => {
    const onApriDettaglio = vi.fn(() => true);
    await monta({ onApriDettaglio, puoNavigare: () => true, puoAprire: () => true, onNaviga: () => true });
    await clicRiga();
    expect(apriRecord()).toHaveLength(1);
    expect(apriRecord()[0].params).toMatchObject({ idWidget: '7', k: 'K7' });
    expect(onApriDettaglio).toHaveBeenCalledTimes(1);
    expect(onApriDettaglio.mock.calls[0]).toEqual(['Fatture da incassare', 'documentiDetail', 'K7', 7]);
  });

  it('solo puoAprire, e dice no (scheda di lavoro che sta lavorando): nessuna ApriRecord', async () => {
    const onApriDettaglio = vi.fn(() => true);
    await monta({ onApriDettaglio, puoAprire: () => false });
    await clicRiga();
    expect(apriRecord()).toEqual([]);
    expect(onApriDettaglio).not.toHaveBeenCalled();
  });
});
