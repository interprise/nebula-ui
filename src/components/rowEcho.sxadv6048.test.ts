import { describe, it, expect } from 'vitest';
import { applyRowEcho, bareFieldName, echoText, pruneEcho } from './rowEcho';
import type { EchoEntry, RowEcho } from './rowEcho';
import type { ListColumn } from '../types/ui';
import type { FieldCaption } from '../controls/types';

// SXADV-6048: eco in tempo reale nella riga della griglia di quello che si scrive nel
// pannello "Gestione riga".
// Contratto: docs/features/20261008_SXADV-6048_riga_attiva.md

const VS = 'S1-9';

/** Le colonne reali di una riga di Prima Nota (PN). */
const PN_COLUMNS = [
  { elementType: 5 },
  { elementType: 1, control: { name: 'periodoComp', type: 'html' } },
  { elementType: 1, control: { name: 'descrizione', type: 'text' } },
  { elementType: 1, control: { name: 'sottoconto', type: 'combo' } },
  { elementType: 1, control: { name: 'dare', type: 'money' } },
  { elementType: 1, control: { name: 'avere', type: 'money' } },
] as unknown as ListColumn[];

function pnRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _selectorPath: 'S1-0.0,S1-9.0',
    col_1: '10/2026',
    col_2: 'Fattura 12',
    col_3: '0101 Cassa',
    col_4: '8,49 €',
    col_5: '',
    ...extra,
  };
}

function entry(name: string, text: string): EchoEntry {
  return { wire: `${name}.${VS}`, text };
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// --- bareFieldName --------------------------------------------------------------------

describe('bareFieldName', () => {
  it('toglie il suffisso .<vsId>', () => {
    expect(bareFieldName('descrizione.S1-9', VS)).toBe('descrizione');
  });

  it('restituisce il nome intero se non finisce con .<vsId>', () => {
    expect(bareFieldName('descrizione.S1-8', VS)).toBe('descrizione.S1-8');
    expect(bareFieldName('descrizione', VS)).toBe('descrizione');
  });

  it('vsId vuoto: nome intero', () => {
    expect(bareFieldName('descrizione.S1-9', '')).toBe('descrizione.S1-9');
    expect(bareFieldName('descrizione.', '')).toBe('descrizione.');
  });

  it('suffisso uguale al vsId ma NON preceduto da un punto: nome intero', () => {
    expect(bareFieldName('xS1-9', VS)).toBe('xS1-9');
    expect(bareFieldName('descrizioneS1-9', VS)).toBe('descrizioneS1-9');
  });

  it('nome che e\' esattamente il vsId: intero', () => {
    expect(bareFieldName('S1-9', VS)).toBe('S1-9');
  });

  it('nome con piu\' punti: toglie solo l\'ultimo .<vsId>', () => {
    expect(bareFieldName('conto.codice.S1-9', VS)).toBe('conto.codice');
  });

  it('vsId che compare in mezzo ma non in fondo: intero', () => {
    expect(bareFieldName('a.S1-9.b', VS)).toBe('a.S1-9.b');
  });

  it('il vsId non e\' un\'espressione regolare (S1-9 non combacia con S1x9)', () => {
    expect(bareFieldName('descrizione.S1x9', VS)).toBe('descrizione.S1x9');
  });

  it('solo ".<vsId>": parte prima vuota', () => {
    expect(bareFieldName('.S1-9', VS)).toBe('');
  });
});

// --- echoText -------------------------------------------------------------------------

describe('echoText', () => {
  describe('booleani: non si riflettono', () => {
    for (const type of ['checkbox', 'boolean', 'bool', 'CheckBox', 'BOOLEAN', 'Bool']) {
      it(`tipo ${type} -> undefined`, () => {
        expect(echoText({ type }, true)).toBeUndefined();
        expect(echoText({ type }, 'S')).toBeUndefined();
        expect(echoText({ type }, '')).toBeUndefined();
      });
    }

    it('booleano con caption: resta undefined', () => {
      expect(echoText({ type: 'checkbox' }, 'S', 'Si')).toBeUndefined();
    });
  });

  describe('caption stringa', () => {
    it('combo: l\'etichetta, non il codice', () => {
      expect(echoText({ type: 'combo' }, '0101', '0101 Cassa')).toBe('0101 Cassa');
    });

    it('prevale sul formato money', () => {
      expect(echoText({ type: 'money', currencySymbol: '€' }, '10,00', 'dieci')).toBe('dieci');
    });

    it('prevale su un valore vuoto', () => {
      expect(echoText({ type: 'combo' }, '', 'Nessuno')).toBe('Nessuno');
    });

    it('caption stringa vuota e\' pur sempre una stringa', () => {
      expect(echoText({ type: 'combo' }, '0101', '')).toBe('');
    });
  });

  describe('caption array (selezione multipla)', () => {
    it('listText quando c\'e\', altrimenti text, uniti da ", "', () => {
      const caption: FieldCaption = [
        { value: 'A', text: 'Alfa', listText: 'A - Alfa' },
        { value: 'B', text: 'Beta' },
        { value: 'C', text: 'Gamma', listText: 'C - Gamma' },
      ];
      expect(echoText({ type: 'multiselect' }, ['A', 'B', 'C'], caption)).toBe(
        'A - Alfa, Beta, C - Gamma',
      );
    });

    it('un solo elemento', () => {
      expect(echoText({ type: 'combo' }, 'B', [{ value: 'B', text: 'Beta' }])).toBe('Beta');
    });

    it('listText stringa vuota: usa quella (?? non ||)', () => {
      expect(
        echoText({ type: 'combo' }, 'B', [{ value: 'B', text: 'Beta', listText: '' }]),
      ).toBe('');
    });

    it('array vuoto: stringa vuota', () => {
      expect(echoText({ type: 'combo' }, [], [])).toBe('');
    });
  });

  describe('valore vuoto', () => {
    for (const v of [null, undefined, '']) {
      it(`${JSON.stringify(v) ?? 'undefined'} -> ''`, () => {
        expect(echoText({ type: 'text' }, v)).toBe('');
      });
    }

    it('money vuoto: \'\' senza simbolo', () => {
      expect(echoText({ type: 'money', currencySymbol: '&#x20AC;' }, '')).toBe('');
      expect(echoText({ type: 'money' }, null)).toBe('');
      expect(echoText({ type: 'money' }, undefined)).toBe('');
    });
  });

  describe('valore array', () => {
    it('elementi uniti da ", "', () => {
      expect(echoText({ type: 'text' }, ['a', 'b', 'c'])).toBe('a, b, c');
    });

    it('array vuoto -> \'\'', () => {
      expect(echoText({ type: 'text' }, [])).toBe('');
    });
  });

  describe('money', () => {
    it('&#x20AC; decodificato in €', () => {
      expect(echoText({ type: 'money', currencySymbol: '&#x20AC;' }, '10.000,00')).toBe(
        '10.000,00 €',
      );
    });

    it('&euro; decodificato in €', () => {
      expect(echoText({ type: 'money', currencySymbol: '&euro;' }, '8,49')).toBe('8,49 €');
    });

    it('simbolo gia\' in chiaro', () => {
      expect(echoText({ type: 'money', currencySymbol: '€' }, '8,49')).toBe('8,49 €');
      expect(echoText({ type: 'money', currencySymbol: '$' }, '8,49')).toBe('8,49 $');
    });

    it('simbolo assente: €', () => {
      expect(echoText({ type: 'money' }, '8,49')).toBe('8,49 €');
    });

    it('simbolo vuoto: €', () => {
      expect(echoText({ type: 'money', currencySymbol: '' }, '8,49')).toBe('8,49 €');
    });

    it('valore numerico', () => {
      expect(echoText({ type: 'money' }, 12)).toBe('12 €');
    });

    it('il valore resta quello del campo, non riformattato', () => {
      expect(echoText({ type: 'money' }, '0,5')).toBe('0,5 €');
    });
  });

  describe('altrimenti String(value)', () => {
    it('testo', () => {
      expect(echoText({ type: 'text' }, 'Fattura 13')).toBe('Fattura 13');
    });

    it('numero', () => {
      expect(echoText({ type: 'number' }, 42)).toBe('42');
      expect(echoText({ type: 'number' }, 0)).toBe('0');
    });

    it('controllo undefined', () => {
      expect(echoText(undefined, 'abc')).toBe('abc');
      expect(echoText(undefined, 7)).toBe('7');
      expect(echoText(undefined, '')).toBe('');
    });

    it('controllo senza tipo', () => {
      expect(echoText({}, 'abc')).toBe('abc');
    });


    it('il testo non e\' tagliato', () => {
      expect(echoText({ type: 'text' }, '  spazi  ')).toBe('  spazi  ');
    });
  });
});

// --- applyRowEcho ---------------------------------------------------------------------

describe('applyRowEcho', () => {
  it('scrive col_<i> per la colonna del controllo con quel nome', () => {
    const data = pnRow();
    const out = applyRowEcho(data, { descrizione: entry('descrizione', 'Fattura 13') }, PN_COLUMNS);
    expect(out).not.toBe(data);
    expect(out.col_2).toBe('Fattura 13');
    // il resto resta
    expect(out.col_1).toBe('10/2026');
    expect(out.col_3).toBe('0101 Cassa');
    expect(out.col_4).toBe('8,49 €');
    expect(out._selectorPath).toBe('S1-0.0,S1-9.0');
  });

  it('piu\' voci in una volta', () => {
    const data = pnRow();
    const out = applyRowEcho(
      data,
      { dare: entry('dare', '10,00 €'), avere: entry('avere', '1,00 €') },
      PN_COLUMNS,
    );
    expect(out.col_4).toBe('10,00 €');
    expect(out.col_5).toBe('1,00 €');
  });

  it('non modifica mai data sul posto', () => {
    const data = pnRow({ _display_3: '0101 Cassa' });
    const before = deepCopy(data);
    applyRowEcho(
      data,
      { descrizione: entry('descrizione', 'X'), sottoconto: entry('sottoconto', 'Y') },
      PN_COLUMNS,
    );
    expect(data).toEqual(before);
  });

  it('non modifica echo ne\' columns', () => {
    const echo: RowEcho = { descrizione: entry('descrizione', 'X') };
    const echoBefore = deepCopy(echo);
    const colsBefore = deepCopy(PN_COLUMNS);
    applyRowEcho(pnRow(), echo, PN_COLUMNS);
    expect(echo).toEqual(echoBefore);
    expect(PN_COLUMNS).toEqual(colsBefore);
  });

  describe('_display_<i>', () => {
    it('aggiornata se la chiave c\'e\' gia\'', () => {
      const data = pnRow({ _display_3: '0101 Cassa' });
      const out = applyRowEcho(data, { sottoconto: entry('sottoconto', '0202 Banca') }, PN_COLUMNS);
      expect(out.col_3).toBe('0202 Banca');
      expect(out._display_3).toBe('0202 Banca');
    });

    it('NON aggiunta se la chiave non c\'e\'', () => {
      const data = pnRow();
      const out = applyRowEcho(data, { sottoconto: entry('sottoconto', '0202 Banca') }, PN_COLUMNS);
      expect(out.col_3).toBe('0202 Banca');
      expect(Object.prototype.hasOwnProperty.call(out, '_display_3')).toBe(false);
    });

    it('chiave presente con valore undefined: conta come presente', () => {
      const data = pnRow({ _display_3: undefined });
      const out = applyRowEcho(data, { sottoconto: entry('sottoconto', '0202 Banca') }, PN_COLUMNS);
      expect(out._display_3).toBe('0202 Banca');
    });

    it('_display di un\'altra colonna non viene toccata', () => {
      const data = pnRow({ _display_3: '0101 Cassa' });
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out._display_3).toBe('0101 Cassa');
      expect(Object.prototype.hasOwnProperty.call(out, '_display_2')).toBe(false);
    });

    it('col_<i> gia\' uguale ma _display_<i> diverso: oggetto nuovo', () => {
      const data = pnRow({ col_3: '0202 Banca', _display_3: '0101 Cassa' });
      const out = applyRowEcho(data, { sottoconto: entry('sottoconto', '0202 Banca') }, PN_COLUMNS);
      expect(out).not.toBe(data);
      expect(out._display_3).toBe('0202 Banca');
    });
  });

  describe('identita\'', () => {
    it('stesso data se l\'eco coincide gia\' coi valori', () => {
      const data = pnRow();
      expect(applyRowEcho(data, { descrizione: entry('descrizione', 'Fattura 12') }, PN_COLUMNS)).toBe(
        data,
      );
    });

    it('stesso data se coincide anche _display_<i>', () => {
      const data = pnRow({ _display_3: '0101 Cassa' });
      expect(applyRowEcho(data, { sottoconto: entry('sottoconto', '0101 Cassa') }, PN_COLUMNS)).toBe(
        data,
      );
    });

    it('echo vuoto: stesso data', () => {
      const data = pnRow();
      expect(applyRowEcho(data, {}, PN_COLUMNS)).toBe(data);
    });

    it('columns assente: stesso data', () => {
      const data = pnRow();
      const echo = { descrizione: entry('descrizione', 'X') };
      expect(applyRowEcho(data, echo, undefined as unknown as ListColumn[])).toBe(data);
    });

    it('columns vuoto: stesso data', () => {
      const data = pnRow();
      expect(applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, [])).toBe(data);
    });

    it('nomi dell\'eco che non corrispondono a nessuna colonna: stesso data', () => {
      const data = pnRow();
      const echo = { saldoContabile: entry('saldoContabile', '99 €'), 'descrizione.S1-9': entry('descrizione', 'X') };
      expect(applyRowEcho(data, echo, PN_COLUMNS)).toBe(data);
    });

    it('il nome si confronta col nome NUDO del controllo (non col wire)', () => {
      const data = pnRow();
      // la voce ha la chiave nuda giusta: si applica anche se wire e' diverso
      const out = applyRowEcho(data, { descrizione: { wire: 'qualsiasi', text: 'X' } }, PN_COLUMNS);
      expect(out.col_2).toBe('X');
    });

    it('il risultato di una seconda applicazione identica e\' lo stesso oggetto', () => {
      const echo = { descrizione: entry('descrizione', 'X') };
      const once = applyRowEcho(pnRow(), echo, PN_COLUMNS);
      expect(applyRowEcho(once, echo, PN_COLUMNS)).toBe(once);
    });
  });

  describe('colonne senza controllo o senza nome', () => {
    it('colonna del selettore (elementType 5, niente control) ignorata', () => {
      const data = pnRow({ col_0: 'sel' });
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out.col_0).toBe('sel');
    });

    it('control senza name ignorato, anche con voce "undefined" o ""', () => {
      const cols = [
        { elementType: 1, control: { type: 'text' } },
        { elementType: 1, control: { name: '', type: 'text' } },
        { elementType: 1, control: { name: 'descrizione', type: 'text' } },
      ] as unknown as ListColumn[];
      const data = { col_0: 'a', col_1: 'b', col_2: 'c' };
      const echo: RowEcho = {
        undefined: entry('undefined', 'U'),
        '': { wire: '', text: 'E' },
        descrizione: entry('descrizione', 'D'),
      };
      const out = applyRowEcho(data, echo, cols);
      expect(out.col_0).toBe('a');
      expect(out.col_1).toBe('b');
      expect(out.col_2).toBe('D');
    });

    it('buchi nell\'array delle colonne non rompono', () => {
      const cols = [undefined, { elementType: 1, control: { name: 'descrizione' } }] as unknown as ListColumn[];
      const data = { col_0: 'a', col_1: 'b' };
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'D') }, cols);
      expect(out.col_1).toBe('D');
      expect(out.col_0).toBe('a');
    });

    it('stesso nome su due colonne: entrambe aggiornate', () => {
      const cols = [
        { elementType: 1, control: { name: 'descrizione' } },
        { elementType: 1, control: { name: 'descrizione' } },
      ] as unknown as ListColumn[];
      const out = applyRowEcho({ col_0: 'a', col_1: 'b' }, { descrizione: entry('descrizione', 'D') }, cols);
      expect(out.col_0).toBe('D');
      expect(out.col_1).toBe('D');
    });

    it('col_<i> assente nei dati: viene scritta', () => {
      const data: Record<string, unknown> = { _selectorPath: 'p' };
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out).not.toBe(data);
      expect(out.col_2).toBe('X');
    });

    it('testo vuoto sovrascrive un valore', () => {
      const data = pnRow();
      const out = applyRowEcho(data, { dare: entry('dare', '') }, PN_COLUMNS);
      expect(out).not.toBe(data);
      expect(out.col_4).toBe('');
    });
  });

  describe('righe di continuazione e di rottura', () => {
    it('continuazione: stesso data, niente scritto', () => {
      const data = pnRow({ _isContinuationRow: true });
      const before = deepCopy(data);
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out).toBe(data);
      expect(data).toEqual(before);
    });

    it('rottura: stesso data, niente scritto', () => {
      const data = pnRow({ _isBreakRow: true });
      const before = deepCopy(data);
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out).toBe(data);
      expect(data).toEqual(before);
    });

    it('flag a false: la riga si aggiorna', () => {
      const data = pnRow({ _isContinuationRow: false, _isBreakRow: false });
      const out = applyRowEcho(data, { descrizione: entry('descrizione', 'X') }, PN_COLUMNS);
      expect(out.col_2).toBe('X');
      expect(out._isContinuationRow).toBe(false);
    });
  });
});

// --- pruneEcho ------------------------------------------------------------------------

describe('pruneEcho', () => {
  const DESC = entry('descrizione', 'X');
  const DARE = entry('dare', '10,00 €');

  it('tutte ancora non spedite: lo STESSO oggetto', () => {
    const echo: RowEcho = { descrizione: DESC, dare: DARE };
    expect(pruneEcho(echo, () => true)).toBe(echo);
  });

  it('nessuna ancora non spedita: null', () => {
    expect(pruneEcho({ descrizione: DESC, dare: DARE }, () => false)).toBeNull();
  });

  it('echo vuoto: null', () => {
    expect(pruneEcho({}, () => true)).toBeNull();
  });

  it('alcune: oggetto ridotto, nuovo, input intatto', () => {
    const echo: RowEcho = { descrizione: DESC, dare: DARE };
    const before = deepCopy(echo);
    const out = pruneEcho(echo, (wire) => wire === `dare.${VS}`);
    expect(out).not.toBe(echo);
    expect(out).toEqual({ dare: DARE });
    expect(echo).toEqual(before);
  });

  it('isDirty si interroga col wire, non col nome nudo', () => {
    const seen: string[] = [];
    pruneEcho({ descrizione: DESC }, (wire) => {
      seen.push(wire);
      return true;
    });
    expect(seen).toEqual([`descrizione.${VS}`]);
  });

  it('solo === true conta come non spedito', () => {
    const echo: RowEcho = { descrizione: DESC, dare: DARE };
    const isDirty = ((wire: string) => (wire.startsWith('dare') ? true : 1)) as unknown as (
      w: string,
    ) => boolean;
    expect(pruneEcho(echo, isDirty)).toEqual({ dare: DARE });
  });

  it('le voci tenute sono le stesse (non copiate)', () => {
    const echo: RowEcho = { descrizione: DESC, dare: DARE };
    const out = pruneEcho(echo, (w) => w.startsWith('dare'));
    expect(out?.dare).toBe(DARE);
  });
});

// Aggiunto dall'implementazione dopo il controllo a schermo (separatore delle
// migliaia: il campo scrive `1234,5`, la lista `1.234,50 €`).
describe('echoText: scelta da elenco senza caption', () => {
  for (const type of ['combo', 'Combo', 'COMBO', 'lookup', 'Lookup', 'select', 'multiselect', 'MultiSelect', 'comboLookup', 'dblookup']) {
    it(`tipo ${type} con valore e senza caption -> undefined (non il codice)`, () => {
      expect(echoText({ type }, '0101')).toBeUndefined();
    });
  }

  it('valore numerico senza caption -> undefined', () => {
    expect(echoText({ type: 'combo' }, 101)).toBeUndefined();
  });

  it('valore array non vuoto senza caption -> undefined', () => {
    expect(echoText({ type: 'multiselect' }, ['A', 'B'])).toBeUndefined();
  });

  it('valore vuoto senza caption: resta \'\'', () => {
    expect(echoText({ type: 'combo' }, '')).toBe('');
    expect(echoText({ type: 'lookup' }, null)).toBe('');
    expect(echoText({ type: 'select' }, undefined)).toBe('');
  });

  it('caption stringa vince sempre', () => {
    expect(echoText({ type: 'lookup' }, '0101', '0101 Cassa')).toBe('0101 Cassa');
    expect(echoText({ type: 'select' }, 'X', 'Voce X')).toBe('Voce X');
  });

  it('caption array vince sempre', () => {
    expect(
      echoText({ type: 'multiselect' }, ['A'], [{ value: 'A', text: 'Alfa', listText: 'A - Alfa' }]),
    ).toBe('A - Alfa');
  });

  it('i tipi non di scelta restano String(value)', () => {
    expect(echoText({ type: 'text' }, '0101')).toBe('0101');
    expect(echoText({ type: 'html' }, '0101')).toBe('0101');
    expect(echoText(undefined, '0101')).toBe('0101');
  });

  it('i booleani restano undefined anche col valore vuoto (vince il tipo booleano)', () => {
    expect(echoText({ type: 'checkbox' }, '')).toBeUndefined();
  });
});

describe('applyRowEcho: colonne html', () => {
  const HTML_COLS = [
    { elementType: 1, control: { name: 'note', type: 'html' } },
    { elementType: 1, control: { name: 'descrizione', type: 'text' } },
    { elementType: 1, control: { name: 'nota2', type: 'HTML' } },
  ] as unknown as ListColumn[];

  it('& < > escapati nella colonna html', () => {
    const out = applyRowEcho({ col_0: '' }, { note: entry('note', 'a < b & c > d') }, HTML_COLS);
    expect(out.col_0).toBe('a &lt; b &amp; c &gt; d');
  });

  it('tipo HTML in maiuscolo: escapato', () => {
    const out = applyRowEcho({ col_2: '' }, { nota2: entry('nota2', '<b>') }, HTML_COLS);
    expect(out.col_2).toBe('&lt;b&gt;');
  });

  it('ordine: & per primo, "&lt;" digitato diventa "&amp;lt;"', () => {
    const out = applyRowEcho({ col_0: '' }, { note: entry('note', '&lt;') }, HTML_COLS);
    expect(out.col_0).toBe('&amp;lt;');
  });

  it('colonne non html: testo invariato', () => {
    const out = applyRowEcho({ col_1: '' }, { descrizione: entry('descrizione', 'a < b & c > d') }, HTML_COLS);
    expect(out.col_1).toBe('a < b & c > d');
  });

  it('anche _display_<i> escapato nella colonna html', () => {
    const out = applyRowEcho(
      { col_0: '', _display_0: '' },
      { note: entry('note', 'x & y') },
      HTML_COLS,
    );
    expect(out.col_0).toBe('x &amp; y');
    expect(out._display_0).toBe('x &amp; y');
  });

  it('virgolette e apostrofi non toccati', () => {
    const out = applyRowEcho({ col_0: '' }, { note: entry('note', `l'"a"`) }, HTML_COLS);
    expect(out.col_0).toBe(`l'"a"`);
  });

  it('identita\': testo gia\' escapato uguale -> stesso data', () => {
    const data = { col_0: 'a &amp; b', _display_0: 'a &amp; b' };
    expect(applyRowEcho(data, { note: entry('note', 'a & b') }, HTML_COLS)).toBe(data);
  });

  it('periodoComp nella riga PN (colonna html)', () => {
    const data = pnRow();
    const out = applyRowEcho(data, { periodoComp: entry('periodoComp', '10/2026 <x>') }, PN_COLUMNS);
    expect(out.col_1).toBe('10/2026 &lt;x&gt;');
    expect(data.col_1).toBe('10/2026');
  });
});

describe('echoText money: separatore delle migliaia', () => {
  it('raggruppa la parte intera senza toccare i decimali', () => {
    expect(echoText({ type: 'money' }, '1234,5')).toBe('1.234,5 €');
    expect(echoText({ type: 'money' }, '-1234567,00')).toBe('-1.234.567,00 €');
    expect(echoText({ type: 'money' }, '123,45')).toBe('123,45 €');
    expect(echoText({ type: 'money' }, '10.000,00')).toBe('10.000,00 €');
  });
  it('casi limite del raggruppamento', () => {
    expect(echoText({ type: 'money' }, '1234')).toBe('1.234 €');
    expect(echoText({ type: 'money' }, '12345,67')).toBe('12.345,67 €');
    expect(echoText({ type: 'money' }, '999,99')).toBe('999,99 €');
    expect(echoText({ type: 'money' }, '1000')).toBe('1.000 €');
    expect(echoText({ type: 'money' }, '-123,4')).toBe('-123,4 €');
    // i decimali restano quelli scritti, anche se lunghi
    expect(echoText({ type: 'money' }, '1234,56789')).toBe('1.234,56789 €');
    // un valore che ha gia' dei punti non si tocca
    expect(echoText({ type: 'money' }, '1.234,5')).toBe('1.234,5 €');
  });
  it('valore numerico con piu\' di tre cifre intere', () => {
    expect(echoText({ type: 'money' }, 1234)).toBe('1.234 €');
  });
  it('col simbolo decodificato', () => {
    expect(echoText({ type: 'money', currencySymbol: '$' }, '1234,5')).toBe('1.234,5 $');
  });
  it('non tocca i numeri che non sono importi', () => {
    expect(echoText({ type: 'number' }, '1234')).toBe('1234');
  });
});
