import { describe, it, expect } from 'vitest';
import {
  buildColumnFieldName,
  resolveListBasePath,
  resolveReloadNavpath,
} from './listEditPosting';

// Regressione SXADV-5995/5996: una lista multiEdit posta la colonna di spunta
// come array sotto `controlName + "." + <id nudo del viewstate>` (CORE cerca
// `controlName + "." + pVS.getId()`). L'id nudo arrivava SOLO dalla colonna
// selettore (`col.selector.basePath`): una lista dichiarata `selector="false"`
// non ha quella colonna, il client usava '' e postava `selected.` — CORE non
// vedeva nessuna riga selezionata. Caso reale: anagraficheListSelCmp
// (listEdit+multiEdit, selector="false"), "Crea Campagna"/"Aggancia Campagna"
// -> campagna senza eventi / NullPointerException.
//
// Percorsi CORE (ToolViewState.getPath): `[parentPath,]id.pos`, es. lista
// radice `S1-11.0`, lista incorporata `S1-3.0,S1-7.2`. L'id nudo e' il
// segmento dopo l'ultima virgola, prima del suo ultimo punto.

describe('resolveListBasePath', () => {
  describe('con la colonna selettore (comportamento esistente, non deve cambiare)', () => {
    it('restituisce selectorBasePath invariato', () => {
      expect(resolveListBasePath({ selectorBasePath: 'S1-11' })).toBe('S1-11');
    });

    it('selectorBasePath vince anche se uiPath e i percorsi di riga dicono altro', () => {
      expect(
        resolveListBasePath({
          selectorBasePath: 'S1-11',
          uiPath: 'S1-99.0',
          rowPaths: ['S1-42.0', 'S1-42.1'],
        }),
      ).toBe('S1-11');
    });

    it('non rielabora selectorBasePath (nessun taglio di punti o virgole)', () => {
      // Il valore del selettore e' gia' l'id che il server vuole: va restituito
      // tale e quale, non ripassato per viewstateIdOf.
      expect(resolveListBasePath({ selectorBasePath: 'S1-3.0,S1-7' })).toBe('S1-3.0,S1-7');
    });
  });

  describe('senza colonna selettore (selector="false")', () => {
    it('usa l\'id nudo di uiPath per una lista radice', () => {
      expect(resolveListBasePath({ uiPath: 'S1-11.0' })).toBe('S1-11');
    });

    it('usa l\'id nudo di uiPath per una lista incorporata', () => {
      expect(resolveListBasePath({ uiPath: 'S1-3.0,S1-7.2' })).toBe('S1-7');
    });

    it('tratta selectorBasePath vuoto come assente', () => {
      expect(resolveListBasePath({ selectorBasePath: '', uiPath: 'S1-11.0' })).toBe('S1-11');
    });

    it('tratta selectorBasePath undefined come assente', () => {
      expect(resolveListBasePath({ selectorBasePath: undefined, uiPath: 'S1-11.0' })).toBe('S1-11');
    });

    it('uiPath vince sui percorsi di riga', () => {
      expect(
        resolveListBasePath({ uiPath: 'S1-11.0', rowPaths: ['S1-99.0'] }),
      ).toBe('S1-11');
    });

    it('il risultato non porta mai il suffisso di posizione', () => {
      const id = resolveListBasePath({ uiPath: 'S1-11.7' });
      expect(id).toBe('S1-11');
      expect(id).not.toMatch(/\.\d+$/);
    });
  });

  describe('senza selettore e senza uiPath: ripiego sulle righe', () => {
    it('usa l\'id nudo del primo percorso di riga', () => {
      expect(resolveListBasePath({ rowPaths: ['S1-11.0', 'S1-11.1'] })).toBe('S1-11');
    });

    it('uiPath vuoto ricade sulle righe', () => {
      expect(resolveListBasePath({ uiPath: '', rowPaths: ['S1-11.3'] })).toBe('S1-11');
    });

    it('salta i percorsi di riga undefined o vuoti e prende il primo valido', () => {
      expect(
        resolveListBasePath({ rowPaths: [undefined, '', 'S1-3.0,S1-7.4', 'S1-8.0'] }),
      ).toBe('S1-7');
    });

    it('lista incorporata: id nudo dall\'ultimo segmento del percorso di riga', () => {
      expect(resolveListBasePath({ rowPaths: ['S1-3.0,S1-7.2'] })).toBe('S1-7');
    });
  });

  describe('niente da cui ricavarlo', () => {
    it('restituisce stringa vuota senza argomenti utili', () => {
      expect(resolveListBasePath({})).toBe('');
    });

    it('restituisce stringa vuota con tutto vuoto', () => {
      expect(
        resolveListBasePath({ selectorBasePath: '', uiPath: '', rowPaths: [] }),
      ).toBe('');
    });

    it('restituisce stringa vuota se le righe non hanno percorso', () => {
      expect(resolveListBasePath({ rowPaths: [undefined, ''] })).toBe('');
    });
  });
});

describe('effetto sul filo (SXADV-5995)', () => {
  it('lista selector="false": la spunta parte come selected.<id>, mai selected.', () => {
    const field = buildColumnFieldName('selected', resolveListBasePath({ uiPath: 'S1-11.0' }));
    expect(field).toBe('selected.S1-11');
    expect(field).not.toBe('selected.');
  });

  it('lista selector="false" senza uiPath: il nome si ricava dalle righe', () => {
    const field = buildColumnFieldName(
      'selected',
      resolveListBasePath({ rowPaths: ['S1-11.0', 'S1-11.1'] }),
    );
    expect(field).toBe('selected.S1-11');
  });

  it('lista con selettore: il nome di campo non cambia', () => {
    const field = buildColumnFieldName(
      'selected',
      resolveListBasePath({ selectorBasePath: 'S1-11', uiPath: 'S1-11.0' }),
    );
    expect(field).toBe('selected.S1-11');
  });

  it('il navpath del reload multiEdit resta page-wide su una lista incorporata senza selettore', () => {
    const navpath = resolveReloadNavpath({
      isMultiEdit: true,
      selectorBasePath: resolveListBasePath({ uiPath: 'S1-3.0,S1-7.2' }),
    });
    expect(navpath).toBe('S1-7');
  });

  it('il navpath del reload multiEdit non e\' undefined per una lista radice senza selettore', () => {
    const navpath = resolveReloadNavpath({
      isMultiEdit: true,
      selectorBasePath: resolveListBasePath({ uiPath: 'S1-11.0' }),
      uiPath: 'S1-11.0',
    });
    expect(navpath).toBe('S1-11');
  });
});
