import { describe, it, expect } from 'vitest';
import type { UICell, UIControl, UIRow, UITree } from '../types/ui';
import { extractFormValues } from './pendingEdits';
import { negationFieldName } from '../controls/helpers';

// SXADV-5983 — Ricerca Allegati. CORE costruisce i criteri dai PARAMETRI di
// ExecuteQuery, non dalla mappa della query lato server. Il controllo cdmsClass
// spedisce due array allineati (`<nome>` e `<nome>_2`, uno per riga di
// classificazione); tornando dai risultati alla pagina di ricerca i formValues
// si ricostruiscono con extractFormValues e quegli array sparivano: il secondo
// Esegui perdeva il filtro di classificazione.
//
// Contratto: un controllo puo' portare `postValues: Record<string, string[]>`,
// gli array che vuole rispediti col form cosi' come li ha disegnati il server.
// extractFormValues li copia (chiave = chiave del record, null/undefined -> '')
// solo per i controlli spediti (modificabile, non noPost, non disabled).
//
// Chi prova non e' chi implementa: queste prove esprimono il CONTRATTO.

// ─────────────────────────────────────────────────────────── costruttori
const VS = 'S1-5';
const IN = 'S1-6';
const w = (n: string, vs = VS) => `${n}.${vs}`;

// `postValues` puo' non essere ancora nel tipo: si passa per un cast.
type ConPostValues = Partial<UIControl> & { postValues?: unknown };

function ctl(name: string, extra: ConPostValues = {}, vs = VS): UIControl {
  return { type: 'text', name: w(name, vs), id: name, editable: true, ...extra } as unknown as UIControl;
}

/** Controllo cdmsClass come arriva: `rows` e' un elenco di contenitori senza celle. */
function cdms(name: string, postValues: unknown, extra: ConPostValues = {}, vs = VS): UIControl {
  return ctl(name, {
    type: 'cdmsClass',
    rows: [{ classe: 'C1' }, { classe: 'C2' }] as unknown as number,
    postValues: postValues as Record<string, string[]> | undefined,
    ...extra,
  }, vs);
}

function row(id: string, ...controls: UIControl[]): UIRow {
  return {
    id,
    cells: controls.flatMap((c) => [
      { elementType: 0, prompt: `${c.id}:` },
      { elementType: 1, control: c },
    ]),
  } as UIRow;
}

function rowOf(id: string, ...cells: UICell[]): UIRow {
  return { id, cells } as UIRow;
}

/** Cella contenitore senza controllo (content="this"): solo righe. */
function box(rows: UIRow[]): UICell {
  return { elementType: 2, rows } as UICell;
}

function tree(...rows: UIRow[]): UITree {
  return { rows, pageType: 0, viewName: 'cdmsRisorseQuery', path: VS } as UITree;
}

const N = w('classificazione');
const N2 = `${N}_2`;
const pv = (vs = VS) => ({
  [w('classificazione', vs)]: ['C1', 'C2'],
  [`${w('classificazione', vs)}_2`]: ['v1', 'v2'],
});

// ═════════════════════════════════════════════ raccolta dei postValues
describe('SXADV-5983: postValues di un controllo spedito entrano nei formValues', () => {
  it('al primo livello: i due array allineati del cdmsClass', () => {
    const ui = tree(row('r0', cdms('classificazione', pv())));
    expect(extractFormValues(ui)).toEqual({ [N]: ['C1', 'C2'], [N2]: ['v1', 'v2'] });
  });

  it('gli elementi null/undefined diventano stringa vuota, l\'allineamento resta', () => {
    const ui = tree(row('r0', cdms('classificazione', { [N]: ['C1', null, 'C3'], [N2]: [undefined, 'v2', null] })));
    expect(extractFormValues(ui)).toEqual({ [N]: ['C1', '', 'C3'], [N2]: ['', 'v2', ''] });
  });

  it('gli elementi non stringa diventano stringhe', () => {
    const ui = tree(row('r0', cdms('classificazione', { [N]: [1, true] })));
    expect(extractFormValues(ui)).toEqual({ [N]: ['1', 'true'] });
  });

  it('un array vuoto resta un array vuoto', () => {
    const ui = tree(row('r0', cdms('classificazione', { [N]: [] })));
    expect(extractFormValues(ui)).toEqual({ [N]: [] });
  });

  it('valore scalare e postValues insieme: entrano tutti e due', () => {
    // chiavi diverse: convivono (la collisione sul nome non e' nel contratto)
    const ui = tree(row('r0', cdms('classificazione', { [`${N}_righe`]: ['a'] }, { value: 'X' })));
    expect(extractFormValues(ui)).toEqual({ [N]: 'X', [`${N}_righe`]: ['a'] });
  });

  it('accanto agli altri campi della ricerca, che restano come prima', () => {
    const ui = tree(row('r0',
      ctl('descrizione', { value: 'contratto' }),
      ctl('causale', { value: 'VEN', negation: true, negationValue: true }),
      cdms('classificazione', pv()),
    ));
    expect(extractFormValues(ui)).toEqual({
      [w('descrizione')]: 'contratto',
      [w('causale')]: 'VEN',
      [negationFieldName(w('causale'))]: '1',
      [N]: ['C1', 'C2'],
      [N2]: ['v1', 'v2'],
    });
  });

  it('dentro un tab (contentRows)', () => {
    const tab = { type: 'tab', id: 't', editable: false, contentRows: [row('t0', cdms('classificazione', pv(IN), {}, IN))] } as unknown as UIControl;
    expect(extractFormValues(tree(row('r0', tab)))).toEqual(pv(IN));
  });

  it('dentro una vista incorporata in linea (cell.rows)', () => {
    const ui = tree(rowOf('r0', box([row('h0', cdms('classificazione', pv(IN), {}, IN))])));
    expect(extractFormValues(ui)).toEqual(pv(IN));
  });

  it('dentro una vista embedded/detail (control.rows)', () => {
    const emb = { type: 'embeddedView', id: 'e', editable: false, rows: [row('d0', cdms('classificazione', pv(IN), {}, IN))] } as unknown as UIControl;
    expect(extractFormValues(tree(row('r0', emb)))).toEqual(pv(IN));
  });

  it('i formValues non condividono l\'array del server', () => {
    const src = { [N]: ['C1'] };
    const out = extractFormValues(tree(row('r0', cdms('classificazione', src))));
    (out[N] as string[]).push('altro');
    expect(src[N]).toEqual(['C1']);
  });
});

// ═══════════════════════════════════════════════════ guardie
describe('SXADV-5983: guardie (comportamento invariato)', () => {
  it('controllo non spedito: postValues fuori (sola lettura, noPost, disabled, editable mancante)', () => {
    const ui = tree(row('r0',
      cdms('ro', { ro: ['a'] }, { editable: false }),
      cdms('np', { np: ['a'] }, { noPost: true }),
      cdms('dis', { dis: ['a'] }, { disabled: true }),
      cdms('noflag', { noflag: ['a'] }, { editable: undefined }),
    ));
    expect(extractFormValues(ui)).toEqual({});
  });

  it('non spedito anche in profondita\' (cell.rows, contentRows)', () => {
    const ro = cdms('classificazione', pv(IN), { editable: false }, IN);
    const tab = { type: 'tab', id: 't', editable: false, contentRows: [row('t0', ro)] } as unknown as UIControl;
    expect(extractFormValues(tree(row('r0', tab)))).toEqual({});
    expect(extractFormValues(tree(rowOf('r0', box([row('h0', ro)]))))).toEqual({});
  });

  it('voci il cui valore non e\' un array: ignorate', () => {
    const ui = tree(row('r0', cdms('classificazione', {
      [N]: 'C1',
      [N2]: null,
      [`${N}_3`]: { a: 1 },
      [`${N}_4`]: 7,
      [`${N}_ok`]: ['x'],
    })));
    expect(extractFormValues(ui)).toEqual({ [`${N}_ok`]: ['x'] });
  });

  it('postValues non oggetto (null, stringa, array): nessun effetto', () => {
    for (const bad of [null, undefined, 'C1', ['C1', 'C2']]) {
      const ui = tree(row('r0', cdms('classificazione', bad)));
      expect(extractFormValues(ui)).toEqual({});
    }
  });

  it('senza postValues: lo scalare entra come sempre', () => {
    const ui = tree(row('r0', ctl('descrizione', { value: 'contratto' }), ctl('importo', { type: 'number', value: 12 })));
    expect(extractFormValues(ui)).toEqual({ [w('descrizione')]: 'contratto', [w('importo')]: '12' });
  });

  it('senza postValues: un `value` array resta FUORI (non e\' un campo singolo)', () => {
    const ui = tree(row('r0', ctl('arr', { value: ['a', 'b'] }), cdms('classificazione', undefined, { value: ['C1'] as unknown as string })));
    expect(extractFormValues(ui)).toEqual({});
  });

  it('un cdmsClass senza postValues non produce niente (rows non e\' una vista)', () => {
    expect(extractFormValues(tree(row('r0', cdms('classificazione', undefined))))).toEqual({});
  });

  it('dentro una lista nessuna raccolta, nemmeno dei postValues', () => {
    const lista = { rows: [row('r0', cdms('classificazione', pv()))], pageType: 1, viewName: 'l', path: VS } as UITree;
    expect(extractFormValues(lista)).toEqual({});
  });
});
