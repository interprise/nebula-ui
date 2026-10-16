import { describe, it, expect } from 'vitest';
import type { UICell, UIControl, UIRow, UITree } from '../types/ui';
import { extractFormValues, applyPendingValues } from './pendingEdits';
import { negationFieldName } from '../controls/helpers';
import { hydrate } from '../services/hydrate';

// SXADV-5989.Z — i formValues di una scheda si RICOSTRUISCONO a ogni risposta
// con extractFormValues(vistaIdratata). Un campo che non finisce li' non parte
// con la richiesta successiva (il secondo "Esegui" della ricerca Fatture attive
// perdeva la Sede della testata incorporata content="this", e il server con lei
// il filtro Stato).
//
// Chi prova non e' chi implementa: queste prove esprimono il CONTRATTO
// (scratchpad/contratto.md), non il codice che lo realizza.

// ─────────────────────────────────────────────────────────── costruttori
const VS = 'S1-5';
const IN = 'S1-6';
const w = (n: string, vs = VS) => `${n}.${vs}`;

function ctl(name: string, extra: Partial<UIControl> = {}, vs = VS): UIControl {
  return { type: 'text', name: w(name, vs), id: name, editable: true, ...extra } as UIControl;
}

/** Riga etichetta+controllo per ogni controllo. */
function row(id: string, ...controls: UIControl[]): UIRow {
  return {
    id,
    cells: controls.flatMap((c) => [
      { elementType: 0, prompt: `${c.id}:` },
      { elementType: 1, control: c },
    ]),
  } as UIRow;
}

/** Riga con celle arbitrarie. */
function rowOf(id: string, ...cells: UICell[]): UIRow {
  return { id, cells } as UIRow;
}

/** Cella contenitore senza controllo (content="this"): solo righe. */
function box(rows: UIRow[], extra: Partial<UICell> = {}): UICell {
  return { elementType: 2, rows, ...extra } as UICell;
}

/** Controllo con le righe in `control.rows` (vista embedded/detail). */
function withRows(id: string, rows: UIRow[], extra: Partial<UIControl> = {}): UIControl {
  return { type: 'embeddedView', id, editable: false, ...extra, rows } as unknown as UIControl;
}

function tree(...rows: UIRow[]): UITree {
  return { rows, pageType: 0, viewName: 'documentiQuery', path: VS } as UITree;
}

/** Un controllo per famiglia, col valore nella forma in cui arriva. */
function famiglie(vs: string, prefix = ''): UIControl[] {
  const p = (n: string) => prefix + n;
  return [
    ctl(p('descrizione'), { type: 'text', value: 'Fattura' }, vs),
    ctl(p('importo'), { type: 'number', value: 1220.5 }, vs),
    ctl(p('dataDocumento'), { type: 'date', value: '01/02/2026' }, vs),
    ctl(p('sedeEmissione'), { type: 'combo', remote: true, value: '44|008', displayText: '008 - CASTELVETRO' } as Partial<UIControl>, vs),
    ctl(p('esportato'), { type: 'boolean', value: false }, vs),
    ctl(p('tipi'), { type: 'multiselect', value: 'a,b' }, vs),
    ctl(p('stato'), { type: 'workflowStatus', value: 'C' }, vs),
    ctl(p('causale'), { type: 'text', value: 'VEN', negation: true, negationValue: true }, vs),
  ];
}

function attese(vs: string, prefix = ''): Record<string, string> {
  const p = (n: string) => prefix + n;
  return {
    [w(p('descrizione'), vs)]: 'Fattura',
    [w(p('importo'), vs)]: '1220.5',
    [w(p('dataDocumento'), vs)]: '01/02/2026',
    [w(p('sedeEmissione'), vs)]: '44|008',
    [w(p('esportato'), vs)]: 'false',
    [w(p('tipi'), vs)]: 'a,b',
    [w(p('stato'), vs)]: 'C',
    [w(p('causale'), vs)]: 'VEN',
    [negationFieldName(w(p('causale'), vs))]: '1',
  };
}

// ═══════════════════════════════════════════════ promessa 1-2: le famiglie
describe('promesse 1-2: ogni famiglia di controllo, al primo livello', () => {
  it('testo, numero, data, combo remoto, casella, multiselect, stato workflow, flag "non"', () => {
    const ui = tree(row('r0', ...famiglie(VS)));
    expect(extractFormValues(ui)).toEqual(attese(VS));
  });

  it('il flag "non" usa negationFieldName (prima del suffisso del viewstate)', () => {
    const ui = tree(row('r0', ctl('causale', { value: 'X', negation: true, negationValue: true })));
    expect(extractFormValues(ui)[`causale$not.${VS}`]).toBe('1');
  });

  it('flag "non" spento: nessuna chiave $not', () => {
    const ui = tree(row('r0', ctl('causale', { value: 'X', negation: true, negationValue: false })));
    expect(Object.keys(extractFormValues(ui))).toEqual([w('causale')]);
  });
});

// ═══════════════════════════════════════ promessa 3a: contentRows (come oggi)
describe('promessa 3a: contentRows a qualunque profondita\'', () => {
  it('tutte le famiglie dentro un tab', () => {
    const ui = tree(row('r0', { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', ...famiglie(IN))] } as UIControl));
    expect(extractFormValues(ui)).toEqual(attese(IN));
  });

  it('contentRows annidate su tre livelli', () => {
    const deep = ctl('profondo', { value: 'p' }, IN);
    const l3 = { type: 'embeddedView', id: 'l3', editable: false, contentRows: [row('c', deep)] } as UIControl;
    const l2 = { type: 'embeddedView', id: 'l2', editable: false, contentRows: [row('b', l3)] } as UIControl;
    const l1 = { type: 'tab', id: 'l1', editable: false, contentRows: [row('a', l2)] } as UIControl;
    expect(extractFormValues(tree(row('r0', l1)))).toEqual({ [w('profondo', IN)]: 'p' });
  });

  it('comportamento esistente invariato: si scende anche nelle contentRows di una lista', () => {
    // Promessa 4: "il comportamento esistente su contentRows resta com'e'".
    const lista = { type: 'embeddedView', id: 'righe', editable: false, listEdit: true, layoutType: 'horizontal',
      contentRows: [row('l0', ctl('qta', { value: '3' }, IN))] } as UIControl;
    expect(extractFormValues(tree(row('r0', lista)))).toEqual({ [w('qta', IN)]: '3' });
  });
});

// ═══════════════════════════════════════════ promessa 3b: cell.rows (NUOVO)
describe('promessa 3b: celle contenitore (content="this") — cell.rows', () => {
  it('tutte le famiglie dentro una cella contenitore', () => {
    const ui = tree(
      row('r0', ctl('numero', { value: '12' })),
      rowOf('r1', box([row('h0', ...famiglie(IN))], { bind: 'this@documentiHeaderQuery' } as Partial<UICell>)),
    );
    expect(extractFormValues(ui)).toEqual({ [w('numero')]: '12', ...attese(IN) });
  });

  it('cell.rows dentro cell.rows', () => {
    const ui = tree(rowOf('r0', box([rowOf('h0', box([row('hh0', ctl('sede', { value: '44|008' }, IN))]))])));
    expect(extractFormValues(ui)).toEqual({ [w('sede', IN)]: '44|008' });
  });

  it('cell.rows dentro contentRows', () => {
    const tab = { type: 'tab', id: 'tabs', editable: false,
      contentRows: [rowOf('t0', box([row('h0', ctl('sede', { value: '44|008' }, IN))]))] } as UIControl;
    expect(extractFormValues(tree(row('r0', tab)))).toEqual({ [w('sede', IN)]: '44|008' });
  });

  it('contentRows dentro cell.rows', () => {
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [row('t0', ctl('ufficio', { value: 'U1' }, IN))] } as UIControl;
    const ui = tree(rowOf('r0', box([row('h0', tab)])));
    expect(extractFormValues(ui)).toEqual({ [w('ufficio', IN)]: 'U1' });
  });

  it('alternanza cell.rows / contentRows / cell.rows', () => {
    const tab = { type: 'tab', id: 'tabs', editable: false,
      contentRows: [rowOf('t0', box([row('x0', ctl('esercizio', { value: '2026' }, IN))]))] } as UIControl;
    const ui = tree(rowOf('r0', box([row('h0', tab)])));
    expect(extractFormValues(ui)).toEqual({ [w('esercizio', IN)]: '2026' });
  });

  it('una cella che ha SIA un controllo SIA righe: entrambi raccolti', () => {
    const cell = { elementType: 1, control: ctl('numero', { value: '7' }), rows: [row('h0', ctl('sede', { value: '44|008' }, IN))] } as UICell;
    expect(extractFormValues(tree(rowOf('r0', cell)))).toEqual({ [w('numero')]: '7', [w('sede', IN)]: '44|008' });
  });

  it('cella con controllo non spedito e righe: le righe si raccolgono lo stesso', () => {
    const cell = { elementType: 1, control: ctl('ro', { value: 'x', editable: false }), rows: [row('h0', ctl('sede', { value: '44|008' }, IN))] } as UICell;
    expect(extractFormValues(tree(rowOf('r0', cell)))).toEqual({ [w('sede', IN)]: '44|008' });
  });

  it('flag "non" dentro cell.rows', () => {
    const ui = tree(rowOf('r0', box([row('h0', ctl('causale', { value: 'VEN', negation: true, negationValue: true }, IN))])));
    expect(extractFormValues(ui)).toEqual({ [w('causale', IN)]: 'VEN', [`causale$not.${IN}`]: '1' });
  });

  it('cella contenitore vuota (rows: []) non rompe niente', () => {
    expect(extractFormValues(tree(rowOf('r0', box([]))))).toEqual({});
  });
});

// ════════════════════════════════════ promessa 3c: control.rows array (NUOVO)
describe('promessa 3c: control.rows quando e\' un array di righe', () => {
  it('tutte le famiglie dentro una vista embedded con le righe in control.rows', () => {
    const ui = tree(row('r0', withRows('dettaglio', [row('d0', ...famiglie(IN))])));
    expect(extractFormValues(ui)).toEqual(attese(IN));
  });

  it('control.rows numero (textarea): ignorato, il valore della textarea entra', () => {
    const ui = tree(row('r0', ctl('note', { type: 'textarea', rows: 4, value: 'riga1\nriga2' })));
    expect(extractFormValues(ui)).toEqual({ [w('note')]: 'riga1\nriga2' });
  });

  it('control.rows dentro cell.rows dentro contentRows', () => {
    const emb = withRows('dettaglio', [row('d0', ctl('provenienza', { value: 'P' }, IN))]);
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [rowOf('t0', box([row('h0', emb)]))] } as UIControl;
    expect(extractFormValues(tree(row('r0', tab)))).toEqual({ [w('provenienza', IN)]: 'P' });
  });

  it('control.rows con dentro una cella contenitore', () => {
    const emb = withRows('dettaglio', [rowOf('d0', box([row('h0', ctl('numeratore', { value: 'N1' }, IN))]))]);
    expect(extractFormValues(tree(row('r0', emb)))).toEqual({ [w('numeratore', IN)]: 'N1' });
  });

  it('il contenitore stesso, se spedito, entra col suo valore oltre ai figli', () => {
    const emb = withRows('dettaglio', [row('d0', ctl('figlio', { value: 'f' }, IN))], { name: w('dettaglio'), editable: true, value: 'v' });
    expect(extractFormValues(tree(row('r0', emb)))).toEqual({ [w('dettaglio')]: 'v', [w('figlio', IN)]: 'f' });
  });
});

// ═════════════════════════════════════ promessa 4: le liste nei percorsi nuovi
describe('promessa 4: le liste non si attraversano sui percorsi nuovi', () => {
  it.each([
    ['pageType 1', { pageType: 1 }],
    ['layoutType horizontal', { layoutType: 'horizontal' }],
    ['listEdit', { listEdit: true }],
  ])('control.rows di una lista (%s): figli fuori', (_n, flags) => {
    const lista = withRows('righe', [row('l0', ctl('qta', { value: '3' }, IN))], flags as Partial<UIControl>);
    const ui = tree(row('r0', ctl('numero', { value: '12' }), lista));
    expect(extractFormValues(ui)).toEqual({ [w('numero')]: '12' });
  });

  it('una lista dentro una cella contenitore: la testata si raccoglie, le righe della lista no', () => {
    const lista = withRows('righe', [row('l0', ctl('qta', { value: '3' }, IN))], { listEdit: true });
    const ui = tree(rowOf('r0', box([row('h0', ctl('sede', { value: '44|008' }, IN), lista)])));
    expect(extractFormValues(ui)).toEqual({ [w('sede', IN)]: '44|008' });
  });

  it('una vista embedded NON lista (pageType 2, verticale) si attraversa', () => {
    const emb = withRows('dettaglio', [row('d0', ctl('x', { value: 'y' }, IN))], { pageType: 2, layoutType: 'vertical' } as Partial<UIControl>);
    expect(extractFormValues(tree(row('r0', emb)))).toEqual({ [w('x', IN)]: 'y' });
  });
});

// ═══════════════════════════════════ promessa 1: i non spediti, ovunque
describe('promessa 1: controlli non spediti e valori non scalari restano fuori, a ogni profondita\'', () => {
  const esclusi = (vs: string) => [
    ctl('ro', { value: 'x', editable: false }, vs),
    ctl('np', { value: 'x', noPost: true }, vs),
    ctl('dis', { value: 'x', disabled: true }, vs),
    ctl('noflag', { value: 'x', editable: undefined }, vs),
    ctl('nul', { value: null }, vs),
    ctl('und', {}, vs),
    ctl('obj', { value: { a: 1 } }, vs),
    ctl('arr', { value: ['a', 'b'] }, vs),
    ctl('negRo', { value: 'x', editable: false, negation: true, negationValue: true }, vs),
  ];

  it('al primo livello', () => {
    expect(extractFormValues(tree(row('r0', ...esclusi(VS))))).toEqual({});
  });
  it('in contentRows', () => {
    const tab = { type: 'tab', id: 't', editable: false, contentRows: [row('t0', ...esclusi(IN))] } as UIControl;
    expect(extractFormValues(tree(row('r0', tab)))).toEqual({});
  });
  it('in cell.rows', () => {
    expect(extractFormValues(tree(rowOf('r0', box([row('h0', ...esclusi(IN))]))))).toEqual({});
  });
  it('in control.rows', () => {
    expect(extractFormValues(tree(row('r0', withRows('e', [row('d0', ...esclusi(IN))]))))).toEqual({});
  });

  it('nome mancante (ne\' name ne\' id): fuori', () => {
    const anon = { type: 'text', editable: true, value: 'x' } as UIControl;
    expect(extractFormValues(tree(rowOf('r0', box([row('h0', anon)]))))).toEqual({});
  });

  it('solo id dentro una cella contenitore: entra con l\'id', () => {
    const c = { type: 'text', id: 'soloId', editable: true, value: 'v' } as UIControl;
    expect(extractFormValues(tree(rowOf('r0', box([row('h0', c)]))))).toEqual({ soloId: 'v' });
  });
});

// ═══════════════════════════════════════ promessa 5: idempotenza col ridisegno
describe('promessa 5: applyPendingValues(V, extractFormValues(V)) === V', () => {
  /** Albero misto: tutte le famiglie a ogni profondita' (nomi distinti per profondita'). */
  function misto(): UITree {
    const lista = withRows('righe', [row('l0', ctl('qta', { value: '3' }, 'S1-9'))], { listEdit: true });
    const emb = withRows('dettaglio', [row('d0', ...famiglie('S1-8', 'emb_')), rowOf('d1', box([row('db', ...famiglie('S1-8', 'embBox_'))]))]);
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [
      row('t0', ...famiglie('S1-7', 'tab_')),
      rowOf('t1', box([row('tb', ...famiglie('S1-7', 'tabBox_'), emb)])),
    ] } as UIControl;
    const mixedCell = { elementType: 1, control: ctl('numero', { value: '7' }),
      rows: [row('mc', ...famiglie(IN, 'mixed_'))] } as UICell;
    return tree(
      row('r0', ...famiglie(VS)),
      rowOf('r1', box([row('h0', ...famiglie(IN, 'head_')), rowOf('h1', box([row('hh', ...famiglie(IN, 'deep_'))]))],
        { bind: 'this@documentiHeaderQuery' } as Partial<UICell>)),
      row('r2', tab, lista),
      rowOf('r3', mixedCell),
      row('r4', ctl('note', { type: 'textarea', rows: 4, value: 'n' })),
    );
  }

  it('albero misto: stesso riferimento', () => {
    const V = misto();
    const F = extractFormValues(V);
    expect(applyPendingValues(V, F)).toBe(V);
  });

  it('albero misto: extract raccoglie ogni famiglia a ogni profondita\' (fuori la lista)', () => {
    const F = extractFormValues(misto());
    expect(F).toMatchObject({
      ...attese(VS), ...attese(IN, 'head_'), ...attese(IN, 'deep_'), ...attese(IN, 'mixed_'),
      ...attese('S1-7', 'tab_'), ...attese('S1-7', 'tabBox_'), ...attese('S1-8', 'emb_'), ...attese('S1-8', 'embBox_'),
      [w('numero')]: '7', [w('note')]: 'n',
    });
    expect(F[w('qta', 'S1-9')]).toBeUndefined();
  });

  it('idempotenza anche con una modifica successiva tornata indietro (round trip)', () => {
    const V = misto();
    const F = { ...extractFormValues(V), [w('head_sedeEmissione', IN)]: '44|009' };
    const patched = applyPendingValues(V, F);
    expect(patched).not.toBe(V);
    // La vista ridisegnata, riletta, e' di nuovo stabile.
    expect(applyPendingValues(patched, extractFormValues(patched))).toBe(patched);
  });

  it('cio\' che extract raccoglie dentro la cella contenitore non risulta in sospeso', () => {
    // Controprova mirata del difetto: se extract non vede la Sede, la scheda la
    // considera "da non spedire"; se la vede, applyPendingValues non la tocca.
    const V = tree(rowOf('r0', box([row('h0', ctl('sedeEmissione', { type: 'combo', value: '44|008' }, IN))])));
    const F = extractFormValues(V);
    expect(F[w('sedeEmissione', IN)]).toBe('44|008');
    expect(applyPendingValues(V, F)).toBe(V);
  });
});

// ═════════════════════════════════════ promessa 6: scenario 5989.Z con hydrate
describe('promessa 6: ricerca Fatture attive, template + hydrate', () => {
  /** Template come lo manda il server: nomi nudi, editable come segnaposto,
   *  la testata incorporata content="this" come cella con `bind` e `rows`,
   *  senza `scope`. */
  function template(): UITree {
    return {
      viewName: 'documentiQuery',
      pageType: 0,
      path: '',
      rows: [
        rowOf('r0',
          { elementType: 0, prompt: 'Stato:' } as UICell,
          { elementType: 1, control: { type: 'combo', name: 'stato', id: 'stato', editable: '?i0' } as unknown as UIControl } as UICell,
        ),
        rowOf('r1', {
          elementType: 2,
          bind: 'this@documentiHeaderQuery',
          rows: [
            rowOf('h0',
              { elementType: 0, prompt: 'Sede:' } as UICell,
              { elementType: 1, control: { type: 'combo', name: 'sedeEmissione', id: 'sedeEmissione', remote: true, editable: '?i1' } as unknown as UIControl } as UICell,
              { elementType: 0, prompt: 'Numero:' } as UICell,
              { elementType: 1, control: { type: 'text', name: 'numero', id: 'numero', editable: '?i1' } as unknown as UIControl } as UICell,
            ),
          ],
        } as unknown as UICell),
      ],
    } as UITree;
  }

  const bindings = { '': 'S1-5', 'this@documentiHeaderQuery': 'S1-6' };
  const dynProps = { i0: true, i1: true };

  it('stato.S1-5 = C e sedeEmissione.S1-6 = 44|008', () => {
    const values = {
      stato: { value: 'C', displayText: 'Contabilizzato' },
      sedeEmissione: { value: '44|008', displayText: '008 - CASTELVETRO' },
    };
    const V = hydrate(template(), values, dynProps, bindings, {});
    const F = extractFormValues(V);
    expect(F['stato.S1-5']).toBe('C');
    expect(F['sedeEmissione.S1-6']).toBe('44|008');
  });

  it('valore "non valorizzato" (codice speciale non vuoto): stessa regola', () => {
    const values = {
      stato: { value: 'C', displayText: 'Contabilizzato' },
      sedeEmissione: { value: '#NULL#', displayText: '(non valorizzato)' },
    };
    const F = extractFormValues(hydrate(template(), values, dynProps, bindings, {}));
    expect(F['sedeEmissione.S1-6']).toBe('#NULL#');
  });

  it('valore scalare (non descrittore) dentro la testata: entra lo stesso', () => {
    const values = { stato: 'C', numero: '123' };
    const F = extractFormValues(hydrate(template(), values, dynProps, bindings, {}));
    expect(F).toMatchObject({ 'stato.S1-5': 'C', 'numero.S1-6': '123' });
  });

  it('segnaposto editable risolto a false: la Sede resta fuori (non spedita)', () => {
    const values = { stato: 'C', sedeEmissione: { value: '44|008' } };
    const F = extractFormValues(hydrate(template(), values, { i0: true, i1: false }, bindings, {}));
    expect(F).toEqual({ 'stato.S1-5': 'C' });
  });

  it('la vista idratata e i suoi formValues sono stabili (promessa 5 sul caso reale)', () => {
    const values = { stato: { value: 'C' }, sedeEmissione: { value: '44|008' }, numero: '7' };
    const V = hydrate(template(), values, dynProps, bindings, {});
    expect(applyPendingValues(V, extractFormValues(V))).toBe(V);
  });
});

// ═══════════════════ emendamento: control.rows solo per embeddedView/detailView
describe('emendamento: control.rows si attraversa solo per embeddedView e detailView', () => {
  /** CdmsClass (cdmsRisorseDetail): `rows` e' un array SENZA `cells`. */
  function cdms(vs: string, extra: Partial<UIControl> = {}): UIControl {
    return {
      type: 'CdmsClass', name: w('classi', vs), id: 'classi', editable: true, value: 'K1',
      rows: [
        { containerId: 'c1', containerDescription: 'Contratti', selectedKey: 'K1', options: [{ key: 'K1', text: 'Uno' }] },
        { containerId: 'c2', containerDescription: 'Fatture', selectedKey: null, options: [] },
      ],
      ...extra,
    } as unknown as UIControl;
  }

  it('detailView con righe in control.rows: si attraversa (come embeddedView)', () => {
    const det = withRows('dettaglio', [row('d0', ctl('x', { value: 'y' }, IN))], { type: 'detailView' } as Partial<UIControl>);
    expect(extractFormValues(tree(row('r0', det)))).toEqual({ [w('x', IN)]: 'y' });
  });

  it.each(['tab', 'text', 'combo', 'CdmsClass', 'actionBar'])(
    'control.rows con righe vere su un controllo di tipo %s: ignorato da extract', (type) => {
      const c = withRows('altro', [row('d0', ctl('x', { value: 'y' }, IN))], { type } as Partial<UIControl>);
      expect(extractFormValues(tree(row('r0', c)))).toEqual({});
    });

  it.each(['tab', 'text', 'combo', 'CdmsClass', 'actionBar'])(
    'control.rows con righe vere su un controllo di tipo %s: ignorato da applyPendingValues', (type) => {
      const c = withRows('altro', [row('d0', ctl('x', { value: 'y' }, IN))], { type } as Partial<UIControl>);
      const V = tree(row('r0', c));
      expect(applyPendingValues(V, { [w('x', IN)]: 'cambiato' })).toBe(V);
    });

  it('CdmsClass al primo livello, extract: nessun errore, il suo valore entra', () => {
    const ui = tree(row('r0', cdms(VS), ctl('numero', { value: '1' })));
    expect(() => extractFormValues(ui)).not.toThrow();
    expect(extractFormValues(ui)).toEqual({ [w('classi')]: 'K1', [w('numero')]: '1' });
  });

  it('CdmsClass dentro una cella contenitore, extract: nessun errore, il suo valore entra', () => {
    const ui = tree(rowOf('r0', box([row('h0', cdms(IN), ctl('sede', { value: '44|008' }, IN))])));
    expect(() => extractFormValues(ui)).not.toThrow();
    expect(extractFormValues(ui)).toEqual({ [w('classi', IN)]: 'K1', [w('sede', IN)]: '44|008' });
  });

  it('CdmsClass al primo livello, apply: nessun errore; niente in sospeso = stesso albero', () => {
    const V = tree(row('r0', cdms(VS)));
    expect(() => applyPendingValues(V, extractFormValues(V))).not.toThrow();
    expect(applyPendingValues(V, extractFormValues(V))).toBe(V);
  });

  it('CdmsClass dentro una cella contenitore, apply: nessun errore; niente in sospeso = stesso albero', () => {
    const V = tree(rowOf('r0', box([row('h0', cdms(IN))])));
    expect(() => applyPendingValues(V, extractFormValues(V))).not.toThrow();
    expect(applyPendingValues(V, extractFormValues(V))).toBe(V);
  });

  it('CdmsClass in sospeso: apply cambia il valore e lascia le sue rows intatte', () => {
    const c = cdms(IN);
    const V = tree(rowOf('r0', box([row('h0', c)])));
    const out = applyPendingValues(V, { [w('classi', IN)]: 'K2' });
    const patched = out.rows[0].cells[0].rows![0].cells[1].control!;
    expect(patched.value).toBe('K2');
    expect(patched.rows).toBe(c.rows);
  });

  it('textarea (rows numero) dentro una cella contenitore: extract e apply invariati', () => {
    const V = tree(rowOf('r0', box([row('h0', ctl('note', { type: 'textarea', rows: 4, value: 'n' }, IN))])));
    expect(extractFormValues(V)).toEqual({ [w('note', IN)]: 'n' });
    expect(applyPendingValues(V, extractFormValues(V))).toBe(V);
    const out = applyPendingValues(V, { [w('note', IN)]: 'm' });
    expect(out.rows[0].cells[0].rows![0].cells[1].control!.rows).toBe(4);
  });
});

describe('emendamento: una cella contenitore non e\' mai una lista', () => {
  it.each([
    ['pageType 1', { pageType: 1 }],
    ['layoutType horizontal', { layoutType: 'horizontal' }],
    ['listEdit', { listEdit: true }],
  ])('cella con %s: le sue righe si raccolgono e si ridisegnano', (_n, flags) => {
    const V = tree(rowOf('r0', box([row('h0', ctl('sede', { value: '44|008' }, IN))], flags as Partial<UICell>)));
    expect(extractFormValues(V)).toEqual({ [w('sede', IN)]: '44|008' });
    expect(applyPendingValues(V, extractFormValues(V))).toBe(V);
    const out = applyPendingValues(V, { [w('sede', IN)]: '44|009' });
    expect(out.rows[0].cells[0].rows![0].cells[1].control!.value).toBe('44|009');
  });
});
