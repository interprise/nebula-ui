import { describe, it, expect } from 'vitest';
import type { UIControl, UIRow, UITree } from '../types/ui';
import { extractFormValues, applyPendingValues } from './pendingEdits';
import { negationFieldName } from '../controls/helpers';

// SXADV-5989 — cambio di sessione applicativa (scheda S1 -> S2 -> S1): i valori
// scritti e non salvati devono tornare a vedersi.
//
// Chi prova non e' chi implementa: queste prove esprimono il CONTRATTO di
// `pendingEdits.ts` (extractFormValues spostata tale e quale da Shell, e
// applyPendingValues che rimette nei controlli i valori in sospeso della
// scheda), non il codice che lo realizza.

// ─────────────────────────────────────────────────────────── costruttori
const VS = 'S1-0';
const w = (n: string) => `${n}.${VS}`;

function ctl(name: string, extra: Partial<UIControl> = {}): UIControl {
  return { type: 'text', name: w(name), id: name, editable: true, ...extra } as UIControl;
}

function row(id: string, ...controls: UIControl[]): UIRow {
  return {
    id,
    cells: controls.flatMap((c) => [
      { elementType: 0, prompt: `${c.id}:` },
      { elementType: 1, control: c },
    ]),
  };
}

function tree(...rows: UIRow[]): UITree {
  return { rows, pageType: 2, viewName: 'prova', path: VS } as UITree;
}

/** Tutti i controlli dell'albero (anche dentro contentRows e cell.rows), in ordine. */
function allControls(ui: UITree): UIControl[] {
  const out: UIControl[] = [];
  const walk = (rows: UIRow[] | undefined) => {
    for (const r of rows ?? []) {
      for (const c of r.cells) {
        if (c.control) {
          out.push(c.control);
          walk(c.control.contentRows);
        }
        walk(c.rows);
      }
    }
  };
  walk(ui.rows);
  return out;
}

/** Il controllo di nome `name` (wire) — il primo che si incontra. */
function find(ui: UITree, name: string): UIControl {
  const c = allControls(ui).find((x) => (x.name || x.id) === name);
  if (!c) throw new Error(`controllo ${name} non trovato`);
  return c;
}

/** Simula la scheda: formValues = baseline del server + modifiche dell'utente. */
function edits(ui: UITree, changes: Record<string, string | string[]>): Record<string, string | string[]> {
  return { ...extractFormValues(ui), ...changes };
}

// ═══════════════════════════════════════════ extractFormValues (spostata)
describe('extractFormValues: stessa semantica che aveva in Shell', () => {
  it('legge solo i controlli modificabili, postabili e abilitati', () => {
    const ui = tree(row('r0',
      ctl('a', { value: 'uno' }),
      ctl('ro', { value: 'x', editable: false }),
      ctl('np', { value: 'x', noPost: true }),
      ctl('dis', { value: 'x', disabled: true }),
      ctl('noflag', { value: 'x', editable: undefined }),
    ));
    expect(extractFormValues(ui)).toEqual({ [w('a')]: 'uno' });
  });

  it('nome = name, altrimenti id', () => {
    const ui = tree(row('r0', { type: 'text', id: 'soloId', editable: true, value: 'v' } as UIControl));
    expect(extractFormValues(ui)).toEqual({ soloId: 'v' });
  });

  it('null/undefined esclusi, oggetti esclusi, il resto come String', () => {
    const ui = tree(row('r0',
      ctl('nul', { value: null }),
      ctl('und'),
      ctl('obj', { value: { a: 1 } }),
      ctl('arr', { value: ['a', 'b'] }),
      ctl('num', { value: 5 }),
      ctl('bool', { type: 'boolean', value: false }),
      ctl('vuoto', { value: '' }),
    ));
    expect(extractFormValues(ui)).toEqual({ [w('num')]: '5', [w('bool')]: 'false', [w('vuoto')]: '' });
  });

  it('flag di negazione ($not) prima del suffisso del viewstate, solo se attivo', () => {
    const ui = tree(row('r0',
      ctl('neg', { value: 'x', negation: true, negationValue: true }),
      ctl('negOff', { value: 'y', negation: true, negationValue: false }),
    ));
    expect(extractFormValues(ui)).toEqual({
      [w('neg')]: 'x',
      [`neg$not.${VS}`]: '1',
      [w('negOff')]: 'y',
    });
  });

  it('scende nelle contentRows (tab, viste incorporate), anche da un contenitore non modificabile', () => {
    const inner = ctl('dentro', { value: 'd' });
    const ui = tree(row('r0', { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', inner)] } as UIControl));
    expect(extractFormValues(ui)).toEqual({ [w('dentro')]: 'd' });
  });

  it('albero senza righe: oggetto vuoto', () => {
    expect(extractFormValues({ rows: [] } as unknown as UITree)).toEqual({});
  });
});

// ═══════════════════════════════════════════════════ applyPendingValues
describe('applyPendingValues: niente in sospeso = stesso albero', () => {
  it('formValues uguale alla baseline: restituisce lo STESSO oggetto ui', () => {
    const ui = tree(row('r0', ctl('a', { value: 'uno' }), ctl('b', { type: 'boolean', value: true })));
    expect(applyPendingValues(ui, extractFormValues(ui))).toBe(ui);
    expect(applyPendingValues(ui, extractFormValues(ui), {})).toBe(ui);
  });

  it('formValues vuoto: stesso oggetto', () => {
    const ui = tree(row('r0', ctl('a', { value: 'uno' })));
    expect(applyPendingValues(ui, {})).toBe(ui);
  });

  it('valore numerico del server e stringa uguale in formValues: non e\' in sospeso', () => {
    const ui = tree(row('r0', ctl('n', { type: 'number', value: 5 })));
    expect(applyPendingValues(ui, { [w('n')]: '5' })).toBe(ui);
  });

  it('una didascalia senza valore cambiato non basta a toccare il controllo', () => {
    const c = ctl('cli', { type: 'combo', remote: true, value: 'C01', displayText: 'ROSSI MARIO' });
    const ui = tree(row('r0', c));
    const out = applyPendingValues(ui, edits(ui, {}), { [w('cli')]: 'ROSSI MARIO' });
    expect(out).toBe(ui);
  });
});

describe('applyPendingValues: i valori in sospeso tornano nei controlli', () => {
  it('testo: il valore scritto', () => {
    const ui = tree(row('r0', ctl('descr', { value: null })));
    const out = applyPendingValues(ui, edits(ui, { [w('descr')]: 'Sequenza fatture 2026' }));
    expect(find(out, w('descr')).value).toBe('Sequenza fatture 2026');
  });

  it('svuotare un campo che aveva un valore: torna vuoto, non il valore del server', () => {
    const ui = tree(row('r0', ctl('descr', { value: 'vecchio' })));
    const out = applyPendingValues(ui, edits(ui, { [w('descr')]: '' }));
    expect(find(out, w('descr')).value).toBe('');
  });

  it('casella false -> true', () => {
    const ui = tree(row('r0', ctl('attivo', { type: 'boolean', value: false })));
    const out = applyPendingValues(ui, edits(ui, { [w('attivo')]: 'true' }));
    expect(find(out, w('attivo')).value).toBe('true');
  });

  it('casella true -> false', () => {
    const ui = tree(row('r0', ctl('attivo', { type: 'checkbox', value: true })));
    const out = applyPendingValues(ui, edits(ui, { [w('attivo')]: 'false' }));
    expect(find(out, w('attivo')).value).toBe('false');
  });

  it('casella null (nuovo record) -> true', () => {
    const ui = tree(row('r0', ctl('attivo', { type: 'boolean', value: null })));
    const out = applyPendingValues(ui, edits(ui, { [w('attivo')]: 'true' }));
    expect(find(out, w('attivo')).value).toBe('true');
  });

  it('casella a tre stati di una ricerca: true -> false (non torna indeterminata)', () => {
    const ui = { ...tree(row('r0', ctl('flag', { type: 'boolean', value: 'true' }))), pageType: 0 } as UITree;
    const out = applyPendingValues(ui, edits(ui, { [w('flag')]: 'false' }));
    expect(find(out, w('flag')).value).toBe('false');
  });

  it('campo maiuscolo: resta il valore maiuscolo memorizzato', () => {
    const ui = tree(row('r0', ctl('codice', { value: null, uppercase: true })));
    const out = applyPendingValues(ui, edits(ui, { [w('codice')]: 'ABC12' }));
    expect(find(out, w('codice')).value).toBe('ABC12');
  });

  it('importo in formato italiano, con migliaia e decimali', () => {
    const ui = tree(row('r0', ctl('importo', { type: 'money', value: '1.234,50', decimals: 2 })));
    const out = applyPendingValues(ui, edits(ui, { [w('importo')]: '12.345,67' }));
    expect(find(out, w('importo')).value).toBe('12.345,67');
  });

  it('data, ora, data/ora', () => {
    const ui = tree(row('r0',
      ctl('data', { type: 'date', value: '05/07/2026', format: 'dd/MM/yyyy' }),
      ctl('ora', { type: 'time', value: null }),
      ctl('ts', { type: 'timestamp', value: null, format: 'dd/MM/yyyy HH:mm' }),
    ));
    const out = applyPendingValues(ui, edits(ui, {
      [w('data')]: '31/12/2026', [w('ora')]: '10:30', [w('ts')]: '01/01/2027 08:15',
    }));
    expect(find(out, w('data')).value).toBe('31/12/2026');
    expect(find(out, w('ora')).value).toBe('10:30');
    expect(find(out, w('ts')).value).toBe('01/01/2027 08:15');
  });

  it('controllo che ha solo l\'id (niente name)', () => {
    const c = { type: 'text', id: 'soloId', editable: true, value: 'a' } as UIControl;
    const ui = tree(row('r0', c));
    const out = applyPendingValues(ui, { soloId: 'b' });
    expect(find(out, 'soloId').value).toBe('b');
  });

  it('combo remoto: codice E didascalia scelti', () => {
    const ui = tree(row('r0', ctl('cli', { type: 'combo', remote: true, controlName: 'cli', value: 'C01', displayText: 'ROSSI MARIO' })));
    const out = applyPendingValues(ui, edits(ui, { [w('cli')]: 'C02' }), { [w('cli')]: 'BIANCHI LUCA' });
    const c = find(out, w('cli'));
    expect(c.value).toBe('C02');
    expect(c.displayText).toBe('BIANCHI LUCA');
  });

  it('combo remoto svuotato con didascalia vuota: niente piu\' la didascalia del server', () => {
    const ui = tree(row('r0', ctl('cli', { type: 'combo', remote: true, controlName: 'cli', value: 'C01', displayText: 'ROSSI MARIO' })));
    const out = applyPendingValues(ui, edits(ui, { [w('cli')]: '' }), { [w('cli')]: '' });
    const c = find(out, w('cli'));
    expect(c.value).toBe('');
    expect(c.displayText).toBe('');
  });

  it('multiselect: l\'elenco di chiavi separate da virgola', () => {
    const ui = tree(row('r0', ctl('stati', { type: 'multiselect', value: 'A' })));
    const out = applyPendingValues(ui, edits(ui, { [w('stati')]: 'A,C' }));
    expect(find(out, w('stati')).value).toBe('A,C');
  });

  it('area HTML: il markup scritto', () => {
    const ui = tree(row('r0', ctl('testo', { type: 'htmlarea', value: '<p>prima</p>' })));
    const out = applyPendingValues(ui, edits(ui, { [w('testo')]: '<p>dopo</p>' }));
    expect(find(out, w('testo')).value).toBe('<p>dopo</p>');
  });

  it('senza labels (terzo argomento assente) funziona e non inventa displayText', () => {
    const ui = tree(row('r0', ctl('a', { value: 'x' })));
    const out = applyPendingValues(ui, { [w('a')]: 'y' });
    expect(find(out, w('a')).value).toBe('y');
    expect(find(out, w('a')).displayText).toBeUndefined();
  });
});

describe('applyPendingValues: cosa NON deve toccare', () => {
  it('controlli in sola lettura, noPost, disabilitati: mai, anche con una stringa in formValues', () => {
    const ro = ctl('ro', { value: 'server', editable: false });
    const np = ctl('np', { value: 'server', noPost: true });
    const dis = ctl('dis', { value: 'server', disabled: true });
    const ui = tree(row('r0', ro, np, dis));
    const fv = { [w('ro')]: 'X', [w('np')]: 'X', [w('dis')]: 'X' };
    const out = applyPendingValues(ui, fv, { [w('ro')]: 'L' });
    expect(out).toBe(ui);
    expect(find(out, w('ro'))).toBe(ro);
    expect(ro.value).toBe('server');
  });

  it('un array in formValues (colonna di griglia) non finisce in un controllo scalare', () => {
    const c = ctl('qta', { value: '1' });
    const ui = tree(row('r0', c));
    const out = applyPendingValues(ui, { [w('qta')]: ['3', '4'] });
    expect(out).toBe(ui);
    expect(find(out, w('qta')).value).toBe('1');
  });

  it('il flag di negazione in formValues non diventa il valore di nessun controllo', () => {
    const c = ctl('cod', { value: 'x', negation: true, negationValue: false });
    const ui = { ...tree(row('r0', c)), pageType: 0 } as UITree;
    const out = applyPendingValues(ui, edits(ui, { [negationFieldName(w('cod'))]: '1' }));
    expect(find(out, w('cod')).value).toBe('x');
  });

  it('non modifica l\'albero ricevuto', () => {
    const inner = ctl('dentro', { value: 'd' });
    const ui = tree(
      row('r0', ctl('a', { value: 'uno' }), ctl('b', { type: 'boolean', value: false })),
      row('r1', { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', inner)] } as UIControl),
    );
    const snapshot = JSON.parse(JSON.stringify(ui));
    const fv = edits(ui, { [w('a')]: 'due', [w('b')]: 'true', [w('dentro')]: 'D' });
    const fvSnapshot = JSON.parse(JSON.stringify(fv));
    const labels = { [w('a')]: 'L' };
    applyPendingValues(ui, fv, labels);
    expect(JSON.parse(JSON.stringify(ui))).toEqual(snapshot);
    expect(fv).toEqual(fvSnapshot);
    expect(labels).toEqual({ [w('a')]: 'L' });
  });

  it('i controlli non in sospeso restano gli stessi oggetti', () => {
    const a = ctl('a', { value: 'uno' });
    const b = ctl('b', { value: 'due' });
    const ro = ctl('ro', { value: 'r', editable: false });
    const ui = tree(row('r0', a, b), row('r1', ro));
    const out = applyPendingValues(ui, edits(ui, { [w('a')]: 'UNO' }));
    expect(out).not.toBe(ui);
    expect(find(out, w('a'))).not.toBe(a);
    expect(find(out, w('b'))).toBe(b);
    expect(find(out, w('ro'))).toBe(ro);
  });
});

describe('applyPendingValues: viste incorporate (contentRows)', () => {
  it('scende nelle contentRows di un tab', () => {
    const inner = ctl('dentro', { value: null });
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', inner)] } as UIControl;
    const ui = tree(row('r0', tab));
    const out = applyPendingValues(ui, edits(ui, { [w('dentro')]: 'scritto' }));
    expect(find(out, w('dentro')).value).toBe('scritto');
    expect(inner.value).toBeNull();
  });

  it('due controlli con lo stesso nome (testata e vista incorporata): entrambi aggiornati', () => {
    const top = ctl('descr', { value: 'server' });
    const inner = ctl('descr', { value: 'server' });
    const embed = { type: 'embeddedView', id: 'emb', editable: false, contentRows: [row('i0', inner)] } as UIControl;
    const ui = tree(row('r0', top), row('r1', embed));
    const out = applyPendingValues(ui, edits(ui, { [w('descr')]: 'nuovo' }));
    const found = allControls(out).filter((c) => c.name === w('descr'));
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.value)).toEqual(['nuovo', 'nuovo']);
  });

  it('contentRows annidate su due livelli', () => {
    const deep = ctl('profondo', { value: 'a' });
    const lvl2 = { type: 'embeddedView', id: 'e2', editable: false, contentRows: [row('j0', deep)] } as UIControl;
    const lvl1 = { type: 'tab', id: 'e1', editable: false, contentRows: [row('i0', lvl2)] } as UIControl;
    const ui = tree(row('r0', lvl1));
    const out = applyPendingValues(ui, edits(ui, { [w('profondo')]: 'b' }));
    expect(find(out, w('profondo')).value).toBe('b');
  });

  it('un tab senza nulla in sospeso dentro resta lo stesso oggetto', () => {
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', ctl('dentro', { value: 'd' }))] } as UIControl;
    const ui = tree(row('r0', ctl('a', { value: 'x' })), row('r1', tab));
    const out = applyPendingValues(ui, edits(ui, { [w('a')]: 'y' }));
    expect(find(out, 'tabs')).toBe(tab);
  });
});

// ═════════════════════════════════════════ oltre la lettera del contratto
// Casi che il contratto scritto non nomina ma che la richiesta ("OGNI campo
// modificabile torna col valore che aveva") copre. Falliscono se
// applyPendingValues ricalca extractFormValues alla lettera.
describe('SXADV-5989 oltre il contratto: quello che l\'utente vede e perderebbe', () => {
  // Le viste incorporate "in linea" (content="this", la testata intera di
  // anagraficheUnDetail; gli indirizzi di documentiDetail) arrivano come
  // cella-contenitore con `cell.rows`, non come control.contentRows: hydrate
  // le riempie (hydrate.ts, ramo `cell.rows`) e ViewRenderer le appiattisce e
  // le rende (flattenInlineEmbeds, SXADV-5487). extractFormValues non ci
  // scende, quindi un applyPendingValues che la ricalca lascerebbe quei campi
  // al valore del server.
  it('campo dentro una vista incorporata in linea (cell.rows) torna col valore scritto', () => {
    const inner = ctl('ragSoc', { value: null });
    const ui = tree({
      id: 'r0',
      cells: [{ elementType: 5, scope: 'testata', bind: 'testata', rows: [row('i0', inner)] }],
    } as UIRow);
    const out = applyPendingValues(ui, { [w('ragSoc')]: 'ACME SPA' });
    expect(find(out, w('ragSoc')).value).toBe('ACME SPA');
  });

  // La casella "not" di un campo di ricerca tiene lo stato in locale
  // (decorations.tsx, NegationCheckbox: useSyncedState(!!control.negationValue))
  // e lo scrive in formValues sotto negationFieldName(name) come '1' / ''.
  // Tornando sulla scheda si rimonta da control.negationValue: perde la spunta.
  it('casella "not" spuntata e non ancora spedita: negationValue torna true', () => {
    const c = ctl('cod', { value: 'x', negation: true, negationValue: false });
    const ui = { ...tree(row('r0', c)), pageType: 0 } as UITree;
    const out = applyPendingValues(ui, edits(ui, { [negationFieldName(w('cod'))]: '1' }));
    expect(find(out, w('cod')).negationValue).toBe(true);
  });

  it('casella "not" tolta e non ancora spedita: negationValue torna false', () => {
    const c = ctl('cod', { value: 'x', negation: true, negationValue: true });
    const ui = { ...tree(row('r0', c)), pageType: 0 } as UITree;
    const out = applyPendingValues(ui, edits(ui, { [negationFieldName(w('cod'))]: '' }));
    expect(find(out, w('cod')).negationValue).toBe(false);
  });
});

// ═══════════════════════════════════ contenuto a lista: non si ridisegna
// Le righe di una lista listEdit hanno gli stessi nomi di campo qualunque sia
// la riga in modifica (SXADV-5735), e le risposte rowUpdate/pageOnly non
// azzerano i formValues: ridisegnare da li' metterebbe un valore digitato (o
// annullato) sulla riga sbagliata, o sopra quello del server.
describe('applyPendingValues: le liste restano come le ha mandate il server', () => {
  it('pagina lista (pageType 1): stesso ui, anche con valori in sospeso', () => {
    const c = ctl('qta', { value: '1' });
    const ui = { ...tree(row('r0', c), row('r1', ctl('qta', { value: '2' }))), pageType: 1 } as UITree;
    const out = applyPendingValues(ui, { [w('qta')]: '9' });
    expect(out).toBe(ui);
    expect(find(out, w('qta'))).toBe(c);
  });

  it('pagina listEdit (ui.listEdit) anche con pageType 2: stesso ui', () => {
    const ui = { ...tree(row('r0', ctl('qta', { value: '1' }))), pageType: 2, listEdit: true } as UITree;
    expect(applyPendingValues(ui, { [w('qta')]: '9' })).toBe(ui);
  });

  it.each([
    ['pageType 1', { pageType: 1 }],
    ['layoutType horizontal', { layoutType: 'horizontal' }],
    ['listEdit', { listEdit: true }],
  ])('lista incorporata (%s): non ci si scende, contentRows e rows restano gli stessi', (_n, flags) => {
    const innerA = ctl('qta', { value: '1' });
    const innerB = ctl('qta', { value: '1' });
    const contentRows = [row('i0', innerA)];
    const rows = [row('j0', innerB)];
    const embed = { type: 'embeddedView', id: 'righe', editable: false, contentRows, rows, ...flags } as unknown as UIControl;
    const top = ctl('descr', { value: 'x' });
    const ui = tree(row('r0', top), row('r1', embed));
    const out = applyPendingValues(ui, edits(ui, { [w('qta')]: '9', [w('descr')]: 'y' }));
    // la testata si', la lista no
    expect(find(out, w('descr')).value).toBe('y');
    const e = find(out, 'righe');
    expect(e.contentRows).toBe(contentRows);
    expect(e.rows as unknown).toBe(rows);
    expect(innerA.value).toBe('1');
    expect(innerB.value).toBe('1');
  });

  it('solo lista incorporata in sospeso: ui intero resta lo stesso oggetto', () => {
    const embed = { type: 'embeddedView', id: 'righe', editable: false, pageType: 1, contentRows: [row('i0', ctl('qta', { value: '1' }))] } as UIControl;
    const ui = tree(row('r0', embed));
    expect(applyPendingValues(ui, { [w('qta')]: '9' })).toBe(ui);
  });

  it('vista incorporata NON lista (embeddedView verticale, pageType 2): si ridisegna', () => {
    const inner = ctl('ind', { value: null });
    const embed = { type: 'embeddedView', id: 'indirizzo', editable: false, layoutType: 'vertical', pageType: 2, contentRows: [row('i0', inner)] } as unknown as UIControl;
    const ui = tree(row('r0', embed));
    const out = applyPendingValues(ui, { [w('ind')]: 'VIA ROMA 1' });
    expect(find(out, w('ind')).value).toBe('VIA ROMA 1');
  });

  it('vista incorporata non lista con le righe in control.rows: si ridisegna', () => {
    const inner = ctl('ind', { value: null });
    const embed = { type: 'detailView', id: 'indirizzo', editable: false, pageType: 2, rows: [row('i0', inner)] } as unknown as UIControl;
    const ui = tree(row('r0', embed));
    const out = applyPendingValues(ui, { [w('ind')]: 'VIA ROMA 1' });
    const e = find(out, 'indirizzo');
    const got = (e.rows as unknown as UIRow[])[0].cells[1].control!;
    expect(got.value).toBe('VIA ROMA 1');
    expect(inner.value).toBeNull();
  });

  it('tab e vista in linea (cell.rows) di un dettaglio restano ridisegnati', () => {
    const inTab = ctl('t', { value: null });
    const inLine = ctl('l', { value: null });
    const tab = { type: 'tab', id: 'tabs', editable: false, contentRows: [row('i0', inTab)] } as UIControl;
    const ui = tree(row('r0', tab), { id: 'r1', cells: [{ elementType: 5, rows: [row('j0', inLine)] }] } as UIRow);
    const out = applyPendingValues(ui, { [w('t')]: 'T', [w('l')]: 'L' });
    expect(find(out, w('t')).value).toBe('T');
    expect(find(out, w('l')).value).toBe('L');
  });
});
