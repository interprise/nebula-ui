import { describe, it, expect } from 'vitest';
import { rowClickOutcome } from './rowActivation';

// SXADV-6014: nelle liste di sola selezione (multiEdit, una spunta in griglia e azioni
// di lista come "Crea Campagna") un clic sulla riga apriva il pannello di riga con la
// sola spunta. Il server non manda piu' il pannello: `rowClickOutcome` decide il clic.
// Selezione = multiEdit con almeno una casella spuntabile in griglia (hasGridCheckbox);
// una multiEdit senza caselle (docLottiList) naviga come le altre liste.

type Input = Parameters<typeof rowClickOutcome>[0];

// Lista semplice che naviga al dettaglio: punto di partenza da cui ogni caso si scosta.
const base: Input = {
  isListEdit: false,
  isMultiEdit: false,
  hasGridCheckbox: false,
  hasPanelTemplate: false,
  command: 'NavigateDetail',
  canEdit: true,
  canUpdate: true,
};
const out = (o: Partial<Input>) => rowClickOutcome({ ...base, ...o });

describe('rowClickOutcome — lista normale', () => {
  it('con un command naviga', () => {
    expect(out({})).toBe('navigate');
  });

  it('senza command non fa niente (selector="false")', () => {
    expect(out({ command: undefined })).toBe('none');
  });

  it('un command vuoto vale come assente', () => {
    expect(out({ command: '' })).toBe('none');
  });

  it('i permessi non contano per la navigazione', () => {
    expect(out({ canEdit: false, canUpdate: false })).toBe('navigate');
  });

  it('hasPanelTemplate senza listEdit non conta come pannello: naviga', () => {
    expect(out({ hasPanelTemplate: true })).toBe('navigate');
    expect(out({ hasPanelTemplate: true, command: undefined })).toBe('none');
  });
});

describe('rowClickOutcome — listEdit col pannello', () => {
  const panel = { isListEdit: true, hasPanelTemplate: true };

  it('modificabile e aggiornabile apre il pannello', () => {
    expect(out(panel)).toBe('panel');
  });

  it('apre il pannello anche senza command', () => {
    expect(out({ ...panel, command: undefined })).toBe('panel');
  });

  it('canUpdate false: riga solo evidenziata, nessuna navigazione', () => {
    expect(out({ ...panel, canUpdate: false })).toBe('none');
  });

  it('canEdit false: riga solo evidenziata, nessuna navigazione', () => {
    expect(out({ ...panel, canEdit: false })).toBe('none');
  });

  it('entrambi false con command: non naviga lo stesso', () => {
    expect(out({ ...panel, canEdit: false, canUpdate: false })).toBe('none');
  });
});

describe('rowClickOutcome — listEdit senza pannello', () => {
  const plain = { isListEdit: true, hasPanelTemplate: false };

  it('con command naviga', () => {
    expect(out(plain)).toBe('navigate');
  });

  it('senza command non fa niente', () => {
    expect(out({ ...plain, command: undefined })).toBe('none');
    expect(out({ ...plain, command: '' })).toBe('none');
  });
});

describe('rowClickOutcome — multiEdit con casella (lista di selezione)', () => {
  const sel = { isMultiEdit: true, hasGridCheckbox: true };

  it('senza pannello il clic non naviga mai, anche con un command', () => {
    expect(out(sel)).toBe('none');
    expect(out({ ...sel, isListEdit: true })).toBe('none');
  });

  it('senza pannello e senza command: niente', () => {
    expect(out({ ...sel, command: undefined })).toBe('none');
  });

  it('hasPanelTemplate senza listEdit non conta come pannello: resta selezione', () => {
    expect(out({ ...sel, hasPanelTemplate: true })).toBe('none');
  });

  it('con pannello vince la regola del pannello', () => {
    const multiPanel = { ...sel, isListEdit: true, hasPanelTemplate: true };
    expect(out(multiPanel)).toBe('panel');
    expect(out({ ...multiPanel, command: undefined })).toBe('panel');
  });

  it('con pannello ma canUpdate false: none, non navigate', () => {
    expect(out({ ...sel, isListEdit: true, hasPanelTemplate: true, canUpdate: false })).toBe(
      'none',
    );
  });
});

describe('rowClickOutcome — multiEdit senza casella (docLottiList)', () => {
  const lotti = { isMultiEdit: true, hasGridCheckbox: false };

  it('con command naviga al dettaglio come una lista normale', () => {
    expect(out(lotti)).toBe('navigate');
    expect(out({ ...lotti, isListEdit: true })).toBe('navigate');
  });

  it('senza command (o con command vuoto) non fa niente', () => {
    expect(out({ ...lotti, command: undefined })).toBe('none');
    expect(out({ ...lotti, command: '' })).toBe('none');
  });

  it('con pannello si comporta come ogni lista col pannello', () => {
    const multiPanel = { ...lotti, isListEdit: true, hasPanelTemplate: true };
    expect(out(multiPanel)).toBe('panel');
    expect(out({ ...multiPanel, canUpdate: false })).toBe('none');
  });
});

describe('rowClickOutcome — hasGridCheckbox fuori dalla multiEdit', () => {
  it('listEdit non multiEdit con casella e command: naviga come prima', () => {
    expect(out({ isListEdit: true, hasGridCheckbox: true })).toBe('navigate');
  });

  it('lista normale con casella e command: naviga', () => {
    expect(out({ hasGridCheckbox: true })).toBe('navigate');
  });

  it('listEdit con casella e pannello: panel', () => {
    expect(out({ isListEdit: true, hasGridCheckbox: true, hasPanelTemplate: true })).toBe('panel');
  });
});
