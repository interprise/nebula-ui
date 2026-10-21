import { describe, it, expect } from 'vitest';
import { rowActivatableClass, rowClickOutcome, ROW_ACTIVATABLE_CLASS } from './rowActivation';

// SXADV-5921: sulle righe di lista non si capiva se il clic facesse qualcosa. La
// classe ROW_ACTIVATABLE_CLASS (cursore a mano) va solo sui righi il cui clic agisce,
// e la decide la stessa regola del clic, `rowClickOutcome`: il cursore non deve
// promettere un clic che non fa niente, ne' nasconderne uno che agisce.

type List = Omit<Parameters<typeof rowClickOutcome>[0], 'command'>;

// Lista semplice che naviga al dettaglio: punto di partenza da cui ogni caso si scosta.
const base: List = {
  isListEdit: false,
  isMultiEdit: false,
  hasGridCheckbox: false,
  hasPanelTemplate: false,
  canEdit: true,
  canUpdate: true,
};
// Riga primaria con percorso e comando, come la costruisce ListRenderer.
const row: Record<string, unknown> = {
  _selectorPath: 'S1-0.3',
  _selectorCommand: 'NavigateDetail',
};
const cls = (data: Record<string, unknown> | undefined, l: Partial<List> = {}) =>
  rowActivatableClass(data, { ...base, ...l });

describe('rowActivatableClass — costante', () => {
  it('la classe si chiama row-activatable', () => {
    expect(ROW_ACTIVATABLE_CLASS).toBe('row-activatable');
  });
});

describe('rowActivatableClass — righe senza clic possibile', () => {
  it('senza dati: nessuna classe', () => {
    expect(cls(undefined)).toBeUndefined();
  });

  it('riga di rottura: nessuna classe, anche con percorso e comando', () => {
    expect(cls({ ...row, _isBreakRow: true })).toBeUndefined();
  });

  it('riga di rottura anche su una lista col pannello: nessuna classe', () => {
    expect(
      cls({ ...row, _isBreakRow: true }, { isListEdit: true, hasPanelTemplate: true }),
    ).toBeUndefined();
  });

  it('senza percorso il clic si ferma: nessuna classe, anche con comando', () => {
    expect(cls({ _selectorCommand: 'NavigateDetail' })).toBeUndefined();
  });

  it('percorso vuoto vale come assente', () => {
    expect(cls({ ...row, _selectorPath: '' })).toBeUndefined();
  });

  it('senza percorso nemmeno il pannello di riga accende il cursore', () => {
    expect(cls({}, { isListEdit: true, hasPanelTemplate: true })).toBeUndefined();
  });
});

describe('rowActivatableClass — lista che naviga', () => {
  it('con percorso e comando: cursore a mano', () => {
    expect(cls(row)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('senza comando (selector="false"): nessuna classe', () => {
    expect(cls({ _selectorPath: 'S1-0.3' })).toBeUndefined();
  });

  it('comando vuoto vale come assente', () => {
    expect(cls({ ...row, _selectorCommand: '' })).toBeUndefined();
  });

  it('i permessi non contano per la navigazione', () => {
    expect(cls(row, { canEdit: false, canUpdate: false })).toBe(ROW_ACTIVATABLE_CLASS);
  });
});

describe('rowActivatableClass — listEdit col pannello', () => {
  const panel = { isListEdit: true, hasPanelTemplate: true };

  it('modificabile: cursore a mano', () => {
    expect(cls(row, panel)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('modificabile anche senza comando: cursore a mano (apre il pannello)', () => {
    expect(cls({ _selectorPath: 'S1-0.3' }, panel)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('canUpdate false: nessuna classe, anche col comando', () => {
    expect(cls(row, { ...panel, canUpdate: false })).toBeUndefined();
  });

  it('canEdit false: nessuna classe, anche col comando', () => {
    expect(cls(row, { ...panel, canEdit: false })).toBeUndefined();
  });
});

describe('rowActivatableClass — multiEdit', () => {
  it('lista di selezione (Dettagli Fatturabili, serviziFatturazioneListEmbD): niente cursore anche con NavigateDetail', () => {
    expect(cls(row, { isMultiEdit: true, hasGridCheckbox: true })).toBeUndefined();
    expect(cls(row, { isMultiEdit: true, hasGridCheckbox: true, isListEdit: true })).toBeUndefined();
  });

  it('selezione con pannello modificabile: vince il pannello, cursore a mano', () => {
    expect(
      cls(row, { isMultiEdit: true, hasGridCheckbox: true, isListEdit: true, hasPanelTemplate: true }),
    ).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('multiEdit senza casella (docLottiList) con comando: cursore a mano', () => {
    expect(cls(row, { isMultiEdit: true })).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('multiEdit senza casella e senza comando: nessuna classe', () => {
    expect(cls({ _selectorPath: 'S1-0.3' }, { isMultiEdit: true })).toBeUndefined();
  });
});

describe('rowActivatableClass — bande di continuazione', () => {
  // Portano percorso e comando della riga principale: stessa regola.
  const cont = { ...row, _isContinuationRow: true };

  it('su una lista che naviga: cursore a mano come la riga principale', () => {
    expect(cls(cont)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('su una lista di selezione: niente cursore come la riga principale', () => {
    expect(cls(cont, { isMultiEdit: true, hasGridCheckbox: true })).toBeUndefined();
  });

  it('su una lista col pannello non modificabile: niente cursore', () => {
    expect(cls(cont, { isListEdit: true, hasPanelTemplate: true, canUpdate: false })).toBeUndefined();
  });

  it('senza percorso (riga principale senza selector): nessuna classe', () => {
    expect(cls({ _isContinuationRow: true })).toBeUndefined();
  });
});

describe('rowActivatableClass — coerente con rowClickOutcome', () => {
  // Ogni combinazione: la classe c'e' esattamente quando il clic fa qualcosa.
  const bools = [false, true];
  const commands = [undefined, '', 'NavigateDetail'];
  const cases: { list: List; command: string | undefined }[] = [];
  for (const isListEdit of bools)
    for (const isMultiEdit of bools)
      for (const hasGridCheckbox of bools)
        for (const hasPanelTemplate of bools)
          for (const canEdit of bools)
            for (const canUpdate of bools)
              for (const command of commands)
                cases.push({
                  list: { isListEdit, isMultiEdit, hasGridCheckbox, hasPanelTemplate, canEdit, canUpdate },
                  command,
                });

  it(`su ${cases.length} combinazioni, riga principale e banda di continuazione`, () => {
    for (const { list, command } of cases) {
      const expected = rowClickOutcome({ ...list, command }) !== 'none' ? ROW_ACTIVATABLE_CLASS : undefined;
      const data: Record<string, unknown> = { _selectorPath: 'S1-0.1' };
      if (command !== undefined) data._selectorCommand = command;
      const label = JSON.stringify({ ...list, command });
      expect(rowActivatableClass(data, list), label).toBe(expected);
      expect(rowActivatableClass({ ...data, _isContinuationRow: true }, list), `cont ${label}`).toBe(
        expected,
      );
      expect(rowActivatableClass({ ...data, _isBreakRow: true }, list), `break ${label}`).toBeUndefined();
      expect(rowActivatableClass({ ...data, _selectorPath: undefined }, list), `nopath ${label}`).toBeUndefined();
    }
  });

  it('non tocca gli oggetti passati', () => {
    const data = { ...row };
    const list = { ...base };
    rowActivatableClass(data, list);
    expect(data).toEqual(row);
    expect(list).toEqual(base);
  });
});

// Il pannello si apre solo se, idratato coi dati del rigo, ha un controllo
// scrivibile (ListView.panelIsEditable). Dettagli Fatturabili su una fattura
// provvisoria: CORE manda il pannello, ma le dynProps di ogni rigo bloccano ogni
// controllo, e il clic non apre niente. `panelOpensOn` dice su quali righi si apre.
describe('rowActivatableClass — panelOpensOn', () => {
  const panel = { isListEdit: true, hasPanelTemplate: true };
  const never = () => false;
  const always = () => true;

  it('pannello che non si apre sul rigo: nessuna classe', () => {
    expect(rowActivatableClass(row, { ...base, ...panel }, never)).toBeUndefined();
  });

  it('pannello che non si apre, anche senza comando: nessuna classe', () => {
    expect(rowActivatableClass({ _selectorPath: 'S1-0.3' }, { ...base, ...panel }, never)).toBeUndefined();
  });

  it('pannello che si apre sul rigo: cursore a mano', () => {
    expect(rowActivatableClass(row, { ...base, ...panel }, always)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('il predicato riceve il percorso del rigo', () => {
    const seen: string[] = [];
    const only = (p: string) => (seen.push(p), p === 'S1-0.3');
    expect(rowActivatableClass(row, { ...base, ...panel }, only)).toBe(ROW_ACTIVATABLE_CLASS);
    expect(rowActivatableClass({ ...row, _selectorPath: 'S1-0.4' }, { ...base, ...panel }, only)).toBeUndefined();
    expect(seen).toEqual(['S1-0.3', 'S1-0.4']);
  });

  it('decide per rigo: un rigo aperto e uno bloccato nella stessa lista', () => {
    const open = new Set(['S1-0.1']);
    const has = (p: string) => open.has(p);
    const l = { ...base, ...panel };
    expect(rowActivatableClass({ ...row, _selectorPath: 'S1-0.1' }, l, has)).toBe(ROW_ACTIVATABLE_CLASS);
    expect(rowActivatableClass({ ...row, _selectorPath: 'S1-0.2' }, l, has)).toBeUndefined();
  });

  it('banda di continuazione: segue il predicato sul percorso della riga principale', () => {
    const cont = { ...row, _isContinuationRow: true };
    expect(rowActivatableClass(cont, { ...base, ...panel }, never)).toBeUndefined();
    expect(rowActivatableClass(cont, { ...base, ...panel }, always)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('ignorato quando il clic naviga: cursore a mano anche se direbbe false', () => {
    expect(rowActivatableClass(row, base, never)).toBe(ROW_ACTIVATABLE_CLASS);
    expect(rowActivatableClass(row, { ...base, isMultiEdit: true }, never)).toBe(ROW_ACTIVATABLE_CLASS);
    // hasPanelTemplate senza listEdit non e' pannello: naviga
    expect(rowActivatableClass(row, { ...base, hasPanelTemplate: true }, never)).toBe(ROW_ACTIVATABLE_CLASS);
  });

  it('non accende cio\' che la regola del clic spegne', () => {
    expect(rowActivatableClass(row, { ...base, ...panel, canUpdate: false }, always)).toBeUndefined();
    expect(rowActivatableClass(row, { ...base, isMultiEdit: true, hasGridCheckbox: true }, always)).toBeUndefined();
    expect(rowActivatableClass({ _selectorPath: 'S1-0.3' }, base, always)).toBeUndefined();
  });

  it('non chiamato su righe di rottura o senza percorso', () => {
    let calls = 0;
    const spy = () => (calls++, true);
    const l = { ...base, ...panel };
    expect(rowActivatableClass({ ...row, _isBreakRow: true }, l, spy)).toBeUndefined();
    expect(rowActivatableClass({ _selectorCommand: 'NavigateDetail' }, l, spy)).toBeUndefined();
    expect(rowActivatableClass(undefined, l, spy)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('assente: comportamento di prima (pannello modificabile = cursore a mano)', () => {
    expect(rowActivatableClass(row, { ...base, ...panel }, undefined)).toBe(ROW_ACTIVATABLE_CLASS);
  });
});

describe('rowActivatableClass — coerente con rowClickOutcome, col predicato', () => {
  // Con un predicato: classe sse outcome == 'navigate' || (outcome == 'panel' && predicato(percorso)).
  const bools = [false, true];
  const commands = [undefined, '', 'NavigateDetail'];
  const paths = ['S1-0.1', 'S1-0.2'];
  const opens = (p: string) => p === 'S1-0.1';

  it('su ogni combinazione e su un rigo che apre e uno che no', () => {
    let n = 0;
    for (const isListEdit of bools)
      for (const isMultiEdit of bools)
        for (const hasGridCheckbox of bools)
          for (const hasPanelTemplate of bools)
            for (const canEdit of bools)
              for (const canUpdate of bools)
                for (const command of commands)
                  for (const path of paths)
                    for (const cont of bools) {
                      const list = { isListEdit, isMultiEdit, hasGridCheckbox, hasPanelTemplate, canEdit, canUpdate };
                      const outcome = rowClickOutcome({ ...list, command });
                      const expected =
                        outcome === 'navigate' || (outcome === 'panel' && opens(path))
                          ? ROW_ACTIVATABLE_CLASS
                          : undefined;
                      const data: Record<string, unknown> = { _selectorPath: path };
                      if (command !== undefined) data._selectorCommand = command;
                      if (cont) data._isContinuationRow = true;
                      expect(rowActivatableClass(data, list, opens), JSON.stringify({ ...list, command, path, cont })).toBe(
                        expected,
                      );
                      n++;
                    }
    expect(n).toBe(768);
  });
});
