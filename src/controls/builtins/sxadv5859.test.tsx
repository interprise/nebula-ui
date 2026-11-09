import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl } from '../../types/ui';

// SXADV-5859.c e .g.
//
// Niente DOM: si rende lato server e si chiamano a mano i gestori. Drawer e
// Input.TextArea sono finti che si annotano le props; MultiSelectControl invece
// e' quello VERO, cosi' la conferma passa dal bottone Conferma del pannello.

const captured = vi.hoisted(() => ({
  drawer: [] as Array<Record<string, unknown>>,
  textArea: [] as Array<Record<string, unknown>>,
  synced: [] as unknown[],
}));

vi.mock('antd', async (importOriginal) => {
  const real = await importOriginal<typeof import('antd')>();
  const Drawer = (props: Record<string, unknown>) => {
    captured.drawer.push(props);
    return null;
  };
  const TextArea = (props: Record<string, unknown>) => {
    captured.textArea.push(props);
    return null;
  };
  return { ...real, Drawer, Input: Object.assign(() => null, real.Input, { TextArea }) };
});

vi.mock('../helpers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../helpers')>();
  return {
    ...real,
    useSyncedValue: (v: unknown) => {
      captured.synced.push(v);
      return real.useSyncedValue(v);
    },
  };
});

const { default: MultiSelectBuiltin } = await import('./MultiSelectBuiltin');
const { default: TextAreaControl } = await import('./TextAreaControl');
const { textareaFitRows } = await import('./textareaFitRows');

type Calls = Array<[string, ...unknown[]]>;

function harness() {
  const calls: Calls = [];
  const onChange = vi.fn((...a: unknown[]) => { calls.push(['change', ...a]); });
  const onAction = vi.fn((...a: unknown[]) => { calls.push(['action', ...a]); });
  return { calls, onChange, onAction };
}

// ---------------------------------------------------------------- MultiSelect

const MS_BASE = {
  type: 'multiselect', id: 'righe', name: 'righe.S1-0', controlName: 'righe',
  navpath: 'S1-0.3', value: 'A,B', editable: true,
};

function renderMulti(control: Record<string, unknown>, pageType: number | undefined) {
  const h = harness();
  captured.drawer.length = 0;
  const c = { ...MS_BASE, ...control } as unknown as UIControl;
  renderToStaticMarkup(
    <MultiSelectBuiltin control={c} pageType={pageType} onAction={h.onAction} onChange={h.onChange as never} />,
  );
  const drawer = captured.drawer.at(-1);
  if (!drawer) throw new Error('il pannello non e\' stato reso');
  // Per tipo e non per posizione: l'ordine dei pulsanti segue SXADV-5779 (Annulla a destra).
  const pulsanti = (drawer.extra as ReactElement<{ children: Array<ReactElement<{ onClick: () => void; type?: string }>> }>).props.children;
  const conferma = pulsanti.find((p) => p.props.type === 'primary');
  const annulla = pulsanti.find((p) => p.props.type !== 'primary');
  if (!conferma || !annulla) throw new Error('Conferma o Annulla non trovati nel pannello');
  return { ...h, control: c, conferma: conferma.props.onClick, annulla: annulla.props.onClick };
}

describe('MultiSelectBuiltin: dettaglio senza pastiglie (5859.c)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Conferma aggiorna il valore e lancia Post con navpath e option1 = controlName', () => {
    const r = renderMulti({ maxItemsShown: 0 }, 2);
    r.conferma();
    expect(r.onChange).toHaveBeenCalledTimes(1);
    expect(r.onChange.mock.calls[0].slice(0, 2)).toEqual(['righe.S1-0', 'A,B']);
    expect(r.onAction).toHaveBeenCalledTimes(1);
    expect(r.onAction).toHaveBeenCalledWith('Post', { navpath: 'S1-0.3', option1: 'righe' });
  });

  it('il valore si registra PRIMA del Post, altrimenti il Post non lo porta', () => {
    const r = renderMulti({ maxItemsShown: 0 }, 2);
    r.conferma();
    expect(r.calls.map((c) => c[0])).toEqual(['change', 'action']);
  });

  it('una selezione svuotata si conferma e ricarica uguale', () => {
    const r = renderMulti({ maxItemsShown: 0, value: '' }, 2);
    r.conferma();
    expect(r.onChange.mock.calls[0].slice(0, 2)).toEqual(['righe.S1-0', '']);
    expect(r.onAction).toHaveBeenCalledWith('Post', { navpath: 'S1-0.3', option1: 'righe' });
  });

  it('option1 vuoto dal server: ripiega su controlName', () => {
    const r = renderMulti({ maxItemsShown: 0, option1: '' }, 2);
    r.conferma();
    expect(r.onAction).toHaveBeenCalledWith('Post', { navpath: 'S1-0.3', option1: 'righe' });
  });

  it('Annulla nel pannello non aggiorna e non ricarica', () => {
    const r = renderMulti({ maxItemsShown: 0 }, 2);
    r.annulla();
    expect(r.onChange).not.toHaveBeenCalled();
    expect(r.onAction).not.toHaveBeenCalled();
  });

  it('il ricaricamento forzato non tocca il control del server', () => {
    const r = renderMulti({ maxItemsShown: 0 }, 2);
    r.conferma();
    expect(r.control.reload).toBeUndefined();
    expect(r.control.option1).toBeUndefined();
  });
});

describe('MultiSelectBuiltin: reload proprio del server', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dettaglio senza pastiglie: restano command e option1 del server', () => {
    const r = renderMulti({ maxItemsShown: 0, reload: true, command: 'RicaricaRighe', option1: 'altro' }, 2);
    r.conferma();
    expect(r.onAction).toHaveBeenCalledTimes(1);
    expect(r.onAction).toHaveBeenCalledWith('RicaricaRighe', { navpath: 'S1-0.3', option1: 'altro' });
  });

  it('dettaglio con le pastiglie: restano command e option1 del server', () => {
    const r = renderMulti({ maxItemsShown: 5, reload: true, command: 'RicaricaRighe', option1: 'altro' }, 2);
    r.conferma();
    expect(r.onAction).toHaveBeenCalledWith('RicaricaRighe', { navpath: 'S1-0.3', option1: 'altro' });
  });

  it('mappa con maxItemsShown 0: resta il reload del server, senza option1 inventato', () => {
    const r = renderMulti({ maxItemsShown: 0, reload: true }, 0);
    r.conferma();
    expect(r.onAction).toHaveBeenCalledWith('Post', { navpath: 'S1-0.3', option1: '' });
  });

  it('command del server senza reload, senza pastiglie in dettaglio: vince il command', () => {
    const r = renderMulti({ maxItemsShown: 0, command: 'RicaricaRighe' }, 2);
    r.conferma();
    expect(r.onAction).toHaveBeenCalledWith('RicaricaRighe', { navpath: 'S1-0.3', option1: 'righe' });
  });
});

describe('MultiSelectBuiltin: comportamento di prima', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['dettaglio, maxItemsShown assente', {}, 2],
    ['dettaglio, maxItemsShown 5', { maxItemsShown: 5 }, 2],
    ['dettaglio, maxItemsShown 1', { maxItemsShown: 1 }, 2],
    ['mappa, maxItemsShown 0', { maxItemsShown: 0 }, 0],
    ['mappa, maxItemsShown assente', {}, 0],
    ['lista, maxItemsShown 0', { maxItemsShown: 0 }, 1],
    ['pageType assente, maxItemsShown 0', { maxItemsShown: 0 }, undefined],
  ] as Array<[string, Record<string, unknown>, number | undefined]>)('%s: aggiorna e non ricarica', (_n, control, pageType) => {
    const r = renderMulti(control, pageType);
    r.conferma();
    expect(r.onChange).toHaveBeenCalledTimes(1);
    expect(r.onChange.mock.calls[0].slice(0, 2)).toEqual(['righe.S1-0', 'A,B']);
    expect(r.onAction).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------- TextArea

const TA_BASE = { type: 'textarea', id: 'testo', name: 'testo.S1-0', navpath: 'S1-0', value: 'ciao', editable: true };

function renderText(control: Record<string, unknown> = {}) {
  const h = harness();
  captured.textArea.length = 0;
  captured.synced.length = 0;
  renderToStaticMarkup(
    <TextAreaControl control={{ ...TA_BASE, ...control } as unknown as UIControl} pageType={2} onAction={h.onAction} onChange={h.onChange as never} />,
  );
  const props = captured.textArea.at(-1) as {
    autoSize: unknown; rows?: number; value: string; style: Record<string, unknown>; disabled?: boolean;
    onChange: (e: { target: { value: string } }) => void; onBlur: () => void;
  } | undefined;
  if (!props) throw new Error('la textarea non e\' stata resa');
  return { ...h, props };
}

// La misura (fittedRows) gira in useLayoutEffect e qui non scatta: senza DOM il
// valore e' sempre 0, quindi questi test provano solo il ramo storico.
describe('TextAreaControl: altezza (5859.g)', () => {
  it.each([
    ['rows dichiarato', { rows: 8 }, 8],
    ['rows assente', {}, 3],
    ['rows 0', { rows: 0 }, 3],
    ['rows dichiarato oltre il tetto del testo', { rows: 40 }, 40],
    ['rows dichiarato vince su poche righe di testo', { rows: 8, value: 'a\nb\nc' }, 8],
    ['valore vuoto', { value: '' }, 3],
    ['valore null', { value: null }, 3],
  ] as Array<[string, Record<string, unknown>, number]>)('%s: minimo giusto', (_n, control, rows) => {
    expect(renderText(control).props.rows).toBe(rows);
  });

  it.each([
    ['3 righe: la riga in piu non supera il minimo', 3, 4],
    ['4 righe: una in piu del testo', 4, 5],
    ['28 righe', 28, 29],
    ['29 righe: si arriva al tetto', 29, 30],
    ['30 righe: fermo al tetto', 30, 30],
    ['101 righe: fermo al tetto', 101, 30],
  ] as Array<[string, number, number]>)('%s', (_n, righe, rows) => {
    expect(renderText({ value: Array(righe).fill('a').join('\n') }).props.rows).toBe(rows);
  });

  it('una riga lunga senza ritorni, fuori dalla misura, resta alle righe storiche', () => {
    expect(renderText({ value: 'SELECT '.repeat(200), rows: 3 }).props.rows).toBe(3);
  });

  it.each([
    ['senza rows', {}],
    ['con rows', { rows: 8 }],
    ['testo lungo', { value: 'a\n'.repeat(100) }],
  ] as Array<[string, Record<string, unknown>]>)('niente autoSize: %s', (_n, control) => {
    expect(renderText(control).props).not.toHaveProperty('autoSize');
  });

  it('il campo resta figlio diretto delle decorazioni, senza contenitori: serve alla misura', () => {
    const h = harness();
    const html = renderToStaticMarkup(
      <TextAreaControl control={TA_BASE as unknown as UIControl} pageType={2} onAction={h.onAction} onChange={h.onChange as never} />,
    );
    expect(html).not.toContain('display:contents'); // le regole di .post-decorations > * vanno al campo
  });
});

describe('textareaFitRows', () => {
  it.each([
    ['multiplo esatto', 100, 20, 0, 5],
    ['un pixel oltre: una riga in piu', 101, 20, 0, 6],
    ['frazione minima oltre', 100.01, 20, 0, 6],
    ['interlinea frazionaria', 66, 22.5, 0, 3],
    ['il padding non conta come testo', 108, 20, 8, 5],
    ['padding che lascia un pixel', 109, 20, 8, 6],
    ['una riga sola', 28, 20, 8, 1],
  ] as Array<[string, number, number, number, number]>)('%s', (_n, scrollHeight, lineHeight, padding, atteso) => {
    expect(textareaFitRows(scrollHeight, lineHeight, padding)).toBe(atteso);
  });

  it.each([
    ['esattamente 30', 600, 30],
    ['appena oltre', 601, 30],
    ['molto oltre', 100000, 30],
  ] as Array<[string, number, number]>)('tetto a 30: %s', (_n, scrollHeight, atteso) => {
    expect(textareaFitRows(scrollHeight, 20, 0)).toBe(atteso);
  });

  it('29 righe e qualcosa restano sotto il tetto', () => {
    expect(textareaFitRows(561, 20, 0)).toBe(29);
  });

  it.each([
    ['padding maggiore', 10, 20],
    ['padding uguale', 20, 20],
    ['altezza zero', 0, 8],
  ] as Array<[string, number, number]>)('niente testo da contenere: %s => 0', (_n, scrollHeight, padding) => {
    expect(textareaFitRows(scrollHeight, 20, padding)).toBe(0);
  });

  it.each([
    ['zero', 0],
    ['NaN (line-height: normal)', NaN],
    ['negativa', -20],
  ] as Array<[string, number]>)('interlinea %s => 0', (_n, lineHeight) => {
    expect(textareaFitRows(100, lineHeight, 8)).toBe(0);
  });
});

describe('TextAreaControl: valore', () => {
  it.each([
    ['testo', 'abc', 'abc'],
    ['null', null, ''],
    ['assente', undefined, ''],
    ['numero', 12, '12'],
  ] as Array<[string, unknown, string]>)('%s: arriva alla textarea come stringa', (_n, value, atteso) => {
    expect(renderText({ value }).props.value).toBe(atteso);
  });

  it('il valore passa da useSyncedValue, che lo ri-sincronizza dal server', () => {
    renderText({ value: 'dal server' });
    expect(captured.synced).toEqual(['dal server']);
  });
});

describe('TextAreaControl: commit al blur invariato', () => {
  it('la battuta registra il valore e non ricarica', () => {
    const r = renderText({ reload: true, option1: 'testo' });
    r.props.onChange({ target: { value: 'nuovo' } });
    expect(r.onChange).toHaveBeenCalledTimes(1);
    expect(r.onChange.mock.calls[0].slice(0, 2)).toEqual(['testo.S1-0', 'nuovo']);
    expect(r.onAction).not.toHaveBeenCalled();
  });

  it('blur dopo una modifica: un solo ricaricamento col command del server', () => {
    const r = renderText({ reload: true, command: 'Ricalcola', option1: 'testo' });
    r.props.onChange({ target: { value: 'nuovo' } });
    r.props.onBlur();
    r.props.onBlur();
    expect(r.onAction).toHaveBeenCalledTimes(1);
    expect(r.onAction).toHaveBeenCalledWith('Ricalcola', { navpath: 'S1-0', option1: 'testo' });
  });

  it('blur senza modifiche: nessun ricaricamento', () => {
    const r = renderText({ reload: true });
    r.props.onBlur();
    expect(r.onAction).not.toHaveBeenCalled();
  });

  it('blur senza reload: nessun ricaricamento', () => {
    const r = renderText();
    r.props.onChange({ target: { value: 'nuovo' } });
    r.props.onBlur();
    expect(r.onAction).not.toHaveBeenCalled();
  });
});

describe('TextAreaControl: stile passato ad antd', () => {
  it('cap 50vh e resize verticale presenti nelle props', () => {
    const { style } = renderText().props;
    expect(style.maxHeight).toBe('50vh');
    expect(style.resize).toBe('vertical');
    expect(style.width).toBe('100%');
  });

  it('lo stile della view si fonde per ultimo', () => {
    expect(renderText({ style: 'text-align:right' }).props.style.textAlign).toBe('right');
  });
});

// La ragione per cui autoSize e' stato scartato: la textarea vera, con autoSize,
// fonde sopra lo stile `resize: none` e un maxHeight in px. Qui le props calcolate
// dal controllo passano alla TextArea VERA di antd, e si legge il markup che esce.
// Limite: quel calcolo gira in un effetto, quindi lato server non si vedrebbe. A
// fermare un ritorno di autoSize sono i test «niente autoSize» qui sopra.
describe('TextAreaControl: stile effettivo sulla textarea vera', () => {
  async function effective(control: Record<string, unknown> = {}) {
    const { props } = renderText(control);
    const { Input } = await vi.importActual<typeof import('antd')>('antd');
    const html = renderToStaticMarkup(<Input.TextArea {...(props as object)} />);
    const tag = /<textarea[^>]*>/.exec(html)?.[0];
    if (!tag) throw new Error('nessuna <textarea> nel markup: ' + html);
    return tag;
  }

  it('il resize verticale sopravvive alla textarea vera', async () => {
    const tag = await effective();
    expect(tag).toContain('resize:vertical');
    expect(tag).not.toContain('resize:none');
  });

  it('il cap di 50vh sopravvive alla textarea vera', async () => {
    expect(await effective()).toContain('max-height:50vh');
  });

  it('le righe calcolate arrivano alla textarea vera', async () => {
    expect(await effective({ value: 'a\nb\nc\nd' })).toContain('rows="5"');
  });
});
