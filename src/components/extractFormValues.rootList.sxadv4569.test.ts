import { describe, it, expect } from 'vitest';
import type { UIControl, UIRow, UITree } from '../types/ui';
import { extractFormValues } from './pendingEdits';

// SXADV-4569 (difetto visto a schermo) — extractFormValues non raccoglie i
// valori delle righe di una lista, ne' incorporata ne' alla RADICE.
//
// Su una pagina lista listEdit il server mette la riga 0 "in edit path" e ne
// manda i controlli con nome e valore (cap.S1-1 = 35031, descrizione.S1-1 =
// Abano Terme). Finiti nei formValues della scheda, ogni Post successivo (il
// flush del pannello prima di NextPage / DetailPage / LocateRow) li rimanda e
// scrive la descrizione della riga 0 sopra un'altra riga.
//
// Contratto: le righe di lista non danno valori, alla radice come annidate
// (la stessa regola di isList). Le radici che non sono liste (dettaglio,
// ricerca) raccolgono i propri campi come oggi, e non quelli di una lista
// incorporata.

const LIST_VS = 'S1-1';
const DET_VS = 'S1-5';
const EMB_VS = 'S1-6';

function ctl(name: string, value: unknown, vs: string, extra: Partial<UIControl> = {}): UIControl {
  return { type: 'text', name: `${name}.${vs}`, id: name, editable: true, value, ...extra } as UIControl;
}

/** Riga di lista: una cella per controllo, il percorso della riga nelle props. */
function listRow(pos: number, vs: string, controls: UIControl[]): UIRow {
  return {
    id: `r${pos}`,
    props: { path: `${vs}.${pos}` },
    cells: controls.map((c) => ({ elementType: 1, colspan: 1, control: c })),
  } as unknown as UIRow;
}

/** Le righe di una lista come le manda il server: riga 0 in edit path (controlli
 *  con nome e valore), le altre in sola lettura col solo testo. */
function listRows(vs: string): UIRow[] {
  return [
    listRow(0, vs, [ctl('cap', '35031', vs), ctl('descrizione', 'Abano Terme', vs)]),
    {
      id: 'r1',
      props: { path: `${vs}.1` },
      cells: [
        { elementType: 1, colspan: 1, text: '35020' },
        { elementType: 1, colspan: 1, text: 'Albignasego' },
      ],
    } as unknown as UIRow,
    {
      id: 'r2',
      props: { path: `${vs}.2` },
      cells: [
        { elementType: 1, colspan: 1, text: '35010' },
        { elementType: 1, colspan: 1, text: 'Borgoricco' },
      ],
    } as unknown as UIRow,
  ];
}

/** Riga etichetta + controllo di una pagina di dettaglio. */
function formRow(id: string, ...controls: UIControl[]): UIRow {
  return {
    id,
    cells: controls.flatMap((c) => [
      { elementType: 0, prompt: `${c.id}:` },
      { elementType: 1, control: c },
    ]),
  } as unknown as UIRow;
}

describe('extractFormValues: liste alla radice (SXADV-4569)', () => {
  it('pagina lista listEdit (pageType 1 + listEdit): nessun valore dalle righe', () => {
    const ui = { pageType: 1, listEdit: true, viewName: 'comuniList', path: LIST_VS, rows: listRows(LIST_VS) } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({});
  });

  it('pagina lista non listEdit (pageType 1): nessun valore dalle righe', () => {
    const ui = { pageType: 1, viewName: 'comuniList', path: LIST_VS, rows: listRows(LIST_VS) } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({});
  });

  it('radice listEdit senza pageType: e\' comunque una lista', () => {
    const ui = { listEdit: true, viewName: 'comuniList', path: LIST_VS, rows: listRows(LIST_VS) } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({});
  });

  it('in particolare la descrizione della riga 0 non entra nei valori', () => {
    const ui = { pageType: 1, listEdit: true, viewName: 'comuniList', path: LIST_VS, rows: listRows(LIST_VS) } as unknown as UITree;
    const v = extractFormValues(ui);
    expect(v[`descrizione.${LIST_VS}`]).toBeUndefined();
    expect(v[`cap.${LIST_VS}`]).toBeUndefined();
  });
});

describe('extractFormValues: radici che non sono liste (invariato)', () => {
  it('dettaglio con i suoi campi: raccolti', () => {
    const ui = {
      pageType: 2,
      viewName: 'comuniDetail',
      path: DET_VS,
      rows: [
        formRow('f0', ctl('cap', '35031', DET_VS)),
        formRow('f1', ctl('descrizione', 'Abano Terme', DET_VS)),
      ],
    } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({
      [`cap.${DET_VS}`]: '35031',
      [`descrizione.${DET_VS}`]: 'Abano Terme',
    });
  });

  it('ricerca (pageType 0) con i suoi campi: raccolti', () => {
    const ui = {
      pageType: 0,
      viewName: 'comuniQuery',
      path: DET_VS,
      rows: [formRow('q0', ctl('descrizione', 'Aban', DET_VS))],
    } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({ [`descrizione.${DET_VS}`]: 'Aban' });
  });

  it('dettaglio con una lista incorporata: solo i campi del dettaglio', () => {
    const embedded = {
      type: 'embeddedView',
      id: 'comuni',
      editable: false,
      pageType: 1,
      listEdit: true,
      rows: listRows(EMB_VS),
    } as unknown as UIControl;
    const ui = {
      pageType: 2,
      viewName: 'provinciaDetail',
      path: DET_VS,
      rows: [
        formRow('f0', ctl('sigla', 'PD', DET_VS)),
        { id: 'f1', cells: [{ elementType: 1, control: embedded }] } as unknown as UIRow,
        formRow('f2', ctl('descrizione', 'Padova', DET_VS)),
      ],
    } as unknown as UITree;
    expect(extractFormValues(ui)).toEqual({
      [`sigla.${DET_VS}`]: 'PD',
      [`descrizione.${DET_VS}`]: 'Padova',
    });
  });
});
