import { describe, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// SXADV-6105 — il componente DateDellaRicerca (le date della ricerca di un widget).
// Oracolo: ~/ui-new-6105/CONTRATTO-6105.md, punto 7, con i testi di R1 (revisione del 23/10). Chi prova non e' chi implementa.
//
// Impianto: niente DOM. Il componente si chiama come funzione dentro un motore di hook
// finto (lo stesso schema di addWidgetModal.sxadv6100.test.tsx, ridotto): si guarda
// l'albero di elementi che restituisce — le Select con le loro `options`, gli InputNumber
// con le loro prop, i testi. I componenti locali (funzioni non di antd) si espandono, cosi'
// la prova non dipende da come l'implementazione spezza il disegno.
//
// Letture della prova (dichiarate):
// - la voce «oggi meno N giorni» puo' mostrare la N letterale o il numero scelto;
// - i testi con l'accento si confrontano normalizzando «a'»/«à», «i'»/«ì» (il contratto
//   scrive con l'apostrofo, come il resto del progetto);
// - la riga di aiuto di oggiMenoGiorni si calcola da `oggiVale.oggiIso`, e la data si
//   scrive gg/mm/aaaa anche se il campo ha un formato suo.

const rt = vi.hoisted(() => ({
  active: false,
  i: 0,
  slots: [] as { v: unknown; set?: unknown }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyFn = (...a: never[]) => unknown;
  const slot = (init: () => unknown) => {
    const i = rt.i++;
    if (!rt.slots[i]) rt.slots[i] = { v: init() };
    return rt.slots[i];
  };
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useState: on(actual.useState as AnyFn, ((init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      s.set ??= (nv: unknown) => {
        s.v = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv;
      };
      return [s.v, s.set];
    }) as AnyFn),
    useRef: on(actual.useRef as AnyFn, ((init: unknown) => slot(() => ({ current: init })).v) as AnyFn),
    useCallback: on(actual.useCallback as AnyFn, ((fn: AnyFn) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useEffect: on(actual.useEffect as AnyFn, (() => {}) as AnyFn),
    useLayoutEffect: on(actual.useLayoutEffect as AnyFn, (() => {}) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
    useId: on(actual.useId as AnyFn, (() => ':t:') as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

const { default: DateDellaRicerca } = await import('./DateDellaRicerca');
const { Select, InputNumber } = await import('antd');

type El = ReactElement<Record<string, unknown>>;
type Scelta = { modo: string; giorni: number };
type Criterio = {
  chiave: string;
  campo?: string;
  etichetta: string;
  valore: string;
  modoProposto?: string;
  oggiVale?: Record<string, string>;
};

const MEMO = Symbol.for('react.memo');

/** Gli elementi raggiungibili; le funzioni-componente locali si espandono (non quelle di antd). */
function elements(node: unknown, out: El[] = [], seen = new Set<unknown>()): El[] {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out, seen);
    return out;
  }
  const el = node as El;
  if ((el as unknown as { $$typeof?: unknown }).$$typeof !== undefined && el.props) {
    out.push(el);
    const { children, ...rest } = el.props;
    for (const v of Object.values(rest)) if (v && typeof v === 'object') elements(v, out, seen);
    elements(children, out, seen);
    let tipo = el.type as unknown;
    if (tipo && typeof tipo === 'object' && (tipo as { $$typeof?: unknown }).$$typeof === MEMO)
      tipo = (tipo as { type: unknown }).type;
    if (typeof tipo === 'function' && !Object.values(antd).includes(tipo as never) && !(tipo as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) {
      elements((tipo as (p: unknown) => unknown)(el.props), out, seen);
    }
    return out;
  }
  return out;
}
const antd = await import('antd');

function testoDi(n: unknown): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  const e = n as El;
  if (e.props) {
    let tipo = e.type as unknown;
    if (tipo && typeof tipo === 'object' && (tipo as { $$typeof?: unknown }).$$typeof === MEMO)
      tipo = (tipo as { type: unknown }).type;
    if (typeof tipo === 'function' && !Object.values(antd).includes(tipo as never) && e.props.children === undefined)
      return testoDi((tipo as (p: unknown) => unknown)(e.props));
    return testoDi(e.props.children);
  }
  return '';
}

const norm = (s: string) =>
  s.replace(/à/g, "a'").replace(/ì/g, "i'").replace(/è|é/g, "e'").replace(/ò/g, "o'").replace(/ù/g, "u'").replace(/\s+/g, ' ').trim();

let tree: unknown = null;
const chiamate: Array<{ chiave: string; scelta: Scelta }> = [];

function disegna(criteri: Criterio[], scelte: Record<string, Scelta>, disabled?: boolean) {
  chiamate.length = 0;
  rt.slots = [];
  rt.i = 0;
  rt.active = true;
  try {
    tree = (DateDellaRicerca as unknown as (p: unknown) => unknown)({
      criteri,
      scelte,
      onChange: (chiave: string, scelta: Scelta) => chiamate.push({ chiave, scelta }),
      disabled,
    });
    // l'espansione dei componenti locali avviene qui, ancora col motore acceso
    tutti = elements(tree);
  } finally {
    rt.active = false;
  }
}
let tutti: El[] = [];

const selects = () => tutti.filter((e) => e.type === Select);
const numeri = () => tutti.filter((e) => e.type === InputNumber);
/** Il testo di ogni elemento (concatenato coi discendenti), normalizzato. */
const testi = () => tutti.map((e) => norm(testoDi(e)));
const haTesto = (t: string) => testi().some((x) => x === norm(t));
const contieneTesto = (t: string) => testi().some((x) => x.includes(norm(t)));
const opzioni = (s: El) =>
  (s.props.options as Array<{ value: string; label: ReactNode }>).map((o) => ({
    value: o.value,
    label: norm(testoDi(o.label)),
  }));

const OGGI_VALE = {
  oggi: '23/10/2026',
  ieri: '22/10/2026',
  inizioMese: '01/10/2026',
  fineMesePrecedente: '30/09/2026',
  inizioAnno: '01/01/2026',
  oggiIso: '2026-10-23',
};

const crit = (p: Partial<Criterio> = {}): Criterio => ({
  chiave: 'data.S1-2',
  campo: 'data',
  etichetta: 'Alla data',
  valore: '18/09/2026',
  modoProposto: 'fissa',
  oggiVale: OGGI_VALE,
  ...p,
});

const ORDINE = ['fissa', 'oggi', 'ieri', 'inizioMese', 'fineMesePrecedente', 'inizioAnno', 'oggiMenoGiorni'];

describe('SXADV-6105 DateDellaRicerca: etichette e testo della sezione', () => {
  it('etichetta del campo e «nella ricerca: <valore>»', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    expect(contieneTesto('Alla data')).toBe(true);
    expect(contieneTesto('nella ricerca: 18/09/2026')).toBe(true);
  });

  it('il testo che spiega la sezione', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    expect(
      contieneTesto(
        "Il widget rifa' questa ricerca a ogni aggiornamento, e anche quando dal widget si apre la lista completa. " +
          "Per ogni data scegli se resta quella della ricerca o se si sposta col calendario."
      )
    ).toBe(true);
  });
});

describe('SXADV-6105 DateDellaRicerca: la Select', () => {
  it('una Select per criterio, con aria-label «<etichetta>: come si muove»', () => {
    disegna(
      [crit(), crit({ chiave: 'indipendente.nascitaData.S1-0', campo: 'indipendente.nascitaData', etichetta: 'Nato il', valore: '01/05/1980' })],
      {}
    );
    const s = selects();
    expect(s.length).toBe(2);
    expect(s.map((x) => x.props['aria-label'])).toEqual(['Alla data: come si muove', 'Nato il: come si muove']);
  });

  it('le voci nell\'ordine del contratto', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    expect(opzioni(selects()[0]).map((o) => o.value)).toEqual(ORDINE);
  });

  it('i testi delle voci; fissa = «sempre il <valore>»', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    const o = opzioni(selects()[0]);
    expect(o[0].label).toBe('sempre il 18/09/2026');
    expect(o[1].label).toBe('oggi');
    expect(o[2].label).toBe('ieri');
    expect(o[3].label).toBe('il primo del mese in corso');
    expect(o[4].label).toBe("l'ultimo giorno del mese scorso");
    expect(o[5].label).toBe("il primo gennaio dell'anno in corso");
    expect(o[6].label).toMatch(/^oggi meno (N|\d+) giorn[oi]$/);
  });

  it('il valore della Select e\' il modo scelto', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'inizioAnno', giorni: 30 } });
    expect(selects()[0].props.value).toBe('inizioAnno');
  });

  it('un modo sconosciuto compare come «<modo> (non riconosciuto)», e le voci note restano', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'settimanaScorsa', giorni: 30 } });
    const o = opzioni(selects()[0]);
    expect(selects()[0].props.value).toBe('settimanaScorsa');
    expect(o.find((x) => x.value === 'settimanaScorsa')?.label).toBe('settimanaScorsa (non riconosciuto)');
    expect(o.filter((x) => x.value !== 'settimanaScorsa').map((x) => x.value)).toEqual(ORDINE);
  });

  it('con un modo noto non c\'e\' nessuna voce «non riconosciuto»', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'oggi', giorni: 30 } });
    expect(opzioni(selects()[0]).some((x) => /non riconosciuto/.test(x.label))).toBe(false);
  });

  it('cambiare voce chiama onChange(chiave, {modo, giorni})', () => {
    disegna([crit({ chiave: 'indipendente.nascitaData.S1-0' })], {
      'indipendente.nascitaData.S1-0': { modo: 'fissa', giorni: 30 },
    });
    (selects()[0].props.onChange as (v: string) => void)('ieri');
    expect(chiamate.length).toBe(1);
    expect(chiamate[0].chiave).toBe('indipendente.nascitaData.S1-0');
    expect(chiamate[0].scelta.modo).toBe('ieri');
    expect(typeof chiamate[0].scelta.giorni).toBe('number');
  });

  it('passando a oggiMenoGiorni i giorni restano quelli della scelta', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    (selects()[0].props.onChange as (v: string) => void)('oggiMenoGiorni');
    expect(chiamate[0].scelta).toEqual({ modo: 'oggiMenoGiorni', giorni: 30 });
  });

  it('disabled spegne la Select', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'oggi', giorni: 30 } }, true);
    expect(selects()[0].props.disabled).toBe(true);
  });
});

describe('SXADV-6105 DateDellaRicerca: «oggi meno N giorni»', () => {
  it('InputNumber senza frecce, fra 1 e 3650, col numero della scelta', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'oggiMenoGiorni', giorni: 30 } });
    const n = numeri();
    expect(n.length).toBe(1);
    expect(n[0].props.controls).toBe(false);
    expect(n[0].props.min).toBe(1);
    expect(n[0].props.max).toBe(3650);
    expect(n[0].props.value).toBe(30);
  });

  it('con gli altri modi il campo numerico non c\'e\'', () => {
    for (const modo of ['fissa', 'oggi', 'ieri', 'inizioMese', 'fineMesePrecedente', 'inizioAnno', 'boh']) {
      disegna([crit()], { 'data.S1-2': { modo, giorni: 30 } });
      expect(numeri().length, modo).toBe(0);
    }
  });

  it('cambiare il numero chiama onChange con modo oggiMenoGiorni e i giorni nuovi', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'oggiMenoGiorni', giorni: 30 } });
    (numeri()[0].props.onChange as (v: number) => void)(45);
    expect(chiamate.length).toBe(1);
    expect(chiamate[0]).toEqual({ chiave: 'data.S1-2', scelta: { modo: 'oggiMenoGiorni', giorni: 45 } });
  });

  it('disabled spegne anche il numero', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'oggiMenoGiorni', giorni: 30 } }, true);
    expect(numeri()[0].props.disabled).toBe(true);
  });
});

describe('SXADV-6105 DateDellaRicerca: la riga di aiuto', () => {
  it('fissa: «Resta sempre il <valore>.»', () => {
    disegna([crit()], { 'data.S1-2': { modo: 'fissa', giorni: 30 } });
    expect(haTesto('Resta sempre il 18/09/2026.')).toBe(true);
    expect(contieneTesto('Si sposta col calendario')).toBe(false);
  });

  it.each([
    ['oggi', '23/10/2026'],
    ['ieri', '22/10/2026'],
    ['inizioMese', '01/10/2026'],
    ['fineMesePrecedente', '30/09/2026'],
    ['inizioAnno', '01/01/2026'],
  ])('%s: «Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il %s.» da oggiVale', (modo, data) => {
    disegna([crit()], { 'data.S1-2': { modo, giorni: 30 } });
    expect(haTesto(`Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il ${data}.`)).toBe(true);
    expect(contieneTesto('Resta sempre il')).toBe(false);
  });

  it('la data viene da oggiVale anche se ha un formato suo (non si riformatta)', () => {
    disegna([crit({ oggiVale: { ...OGGI_VALE, oggi: '2026-10-23' } })], { 'data.S1-2': { modo: 'oggi', giorni: 30 } });
    expect(haTesto('Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il 2026-10-23.')).toBe(true);
  });

  it.each([
    ['2026-10-23', 30, '23/09/2026'],
    ['2026-10-23', 1, '22/10/2026'],
    ['2026-03-01', 1, '28/02/2026'],
    ['2024-03-01', 1, '29/02/2024'],
    ['2026-01-01', 1, '31/12/2025'],
    ['2026-01-01', 365, '01/01/2025'],
    ['2026-12-31', 30, '01/12/2026'],
    ['2026-12-31', 1, '30/12/2026'],
    // a cavallo dei cambi d'ora (Europa): un calcolo in millisecondi sbaglierebbe il giorno
    ['2026-10-26', 1, '25/10/2026'],
    ['2026-03-30', 1, '29/03/2026'],
    ['2026-10-23', 3650, '25/10/2016'],
  ])('oggiMenoGiorni: oggiIso %s meno %i = %s', (iso, giorni, atteso) => {
    disegna([crit({ oggiVale: { ...OGGI_VALE, oggiIso: iso } })], { 'data.S1-2': { modo: 'oggiMenoGiorni', giorni } });
    expect(haTesto(`Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il ${atteso}.`)).toBe(true);
  });

  it('oggiMenoGiorni: gg/mm/aaaa anche se gli altri valori hanno un altro formato', () => {
    disegna(
      [crit({ oggiVale: { oggi: '2026-10-23', ieri: '2026-10-22', oggiIso: '2026-10-23' } })],
      { 'data.S1-2': { modo: 'oggiMenoGiorni', giorni: 30 } }
    );
    expect(haTesto('Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il 23/09/2026.')).toBe(true);
  });

  it('senza oggiVale: «Si sposta col calendario.» soltanto', () => {
    for (const modo of ['oggi', 'ieri', 'inizioMese', 'fineMesePrecedente', 'inizioAnno', 'oggiMenoGiorni']) {
      disegna([crit({ oggiVale: undefined })], { 'data.S1-2': { modo, giorni: 30 } });
      expect(haTesto('Si sposta col calendario.'), modo).toBe(true);
      expect(contieneTesto('se il widget si aggiornasse adesso'), modo).toBe(false);
    }
  });

  it('una riga di aiuto per criterio, ognuna col suo modo', () => {
    disegna(
      [crit(), crit({ chiave: 'dataA.S1-0', campo: 'dataA', etichetta: 'Al', valore: '31/12/2026' })],
      { 'data.S1-2': { modo: 'ieri', giorni: 30 }, 'dataA.S1-0': { modo: 'fissa', giorni: 30 } }
    );
    expect(haTesto('Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il 22/10/2026.')).toBe(true);
    expect(haTesto('Resta sempre il 31/12/2026.')).toBe(true);
  });
});
