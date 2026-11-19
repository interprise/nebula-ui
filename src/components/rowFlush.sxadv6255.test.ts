import { describe, it, expect } from 'vitest';
import { endsRowScope, rowFlushNeeded } from './rowFlush';

// SXADV-6255 / SXADV-6256: prima di un'azione che non e' per la riga aperta nel
// pannello (o che la chiude), il digitato della riga parte con un Post.

const ROW = 'S1-5.0,S1-6.6';
const DOC = 'S1-5.0';

const ENDING = [
  'NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'GotoPage',
  'SortColumn', 'Refresh', 'DetailPage', 'LocateRow', 'FilterRows',
];
const NEVER = ['Post', 'Cancel', 'CancelRow', 'Delete', 'SetPageSize', 'NavigateHelp'];

function base(over: Partial<Parameters<typeof rowFlushNeeded>[0]> = {}) {
  return { action: 'SaveAndNew', rowTarget: DOC, openRow: ROW, openRowDirty: true, afterFlush: false, ...over };
}

describe('endsRowScope', () => {
  for (const a of ENDING) {
    it(`${a} chiude la riga`, () => expect(endsRowScope(a)).toBe(true));
  }
  for (const a of ['Save', 'SaveAndNew', 'Add', 'Post', 'Cancel', 'Delete', 'NavigateView', 'ExecuteQuery', '']) {
    it(`${a || '(vuota)'} non chiude la riga`, () => expect(endsRowScope(a)).toBe(false));
  }
  it('il nome e\' esatto (maiuscole contano)', () => {
    expect(endsRowScope('nextpage')).toBe(false);
  });
});

describe('rowFlushNeeded: casi reali', () => {
  it('SaveAndNew del documento con riga aperta sporca -> vero', () => {
    expect(rowFlushNeeded(base())).toBe(true);
  });

  it('SaveAndNew del pannello stesso (rowTarget = openRow) -> falso', () => {
    expect(rowFlushNeeded(base({ rowTarget: ROW }))).toBe(false);
  });

  it('Save senza navpath (rowTarget undefined) con riga sporca -> vero', () => {
    expect(rowFlushNeeded(base({ action: 'Save', rowTarget: undefined }))).toBe(true);
  });

  it('Save con rowTarget null con riga sporca -> vero', () => {
    expect(rowFlushNeeded(base({ action: 'Save', rowTarget: null }))).toBe(true);
  });
});

describe('rowFlushNeeded: condizioni necessarie', () => {
  it('nessuna riga aperta -> falso', () => {
    expect(rowFlushNeeded(base({ openRow: null }))).toBe(false);
    expect(rowFlushNeeded(base({ openRow: undefined }))).toBe(false);
  });

  it('riga aperta ma pulita -> falso', () => {
    expect(rowFlushNeeded(base({ openRowDirty: false }))).toBe(false);
  });

  it('richiesta che segue lo svuotamento -> falso', () => {
    expect(rowFlushNeeded(base({ afterFlush: true }))).toBe(false);
  });

  for (const a of NEVER) {
    it(`${a} non svuota mai, nemmeno per un'altra riga`, () => {
      expect(rowFlushNeeded(base({ action: a }))).toBe(false);
      expect(rowFlushNeeded(base({ action: a, rowTarget: undefined }))).toBe(false);
      expect(rowFlushNeeded(base({ action: a, rowTarget: ROW }))).toBe(false);
    });
  }

  it('un\'azione qualunque per un\'altra riga della stessa lista -> vero', () => {
    expect(rowFlushNeeded(base({ action: 'NavigateView', rowTarget: 'S1-5.0,S1-6.7' }))).toBe(true);
  });

  it('azione qualunque per la stessa riga -> falso', () => {
    expect(rowFlushNeeded(base({ action: 'NavigateView', rowTarget: ROW }))).toBe(false);
  });
});

describe('rowFlushNeeded: azioni che chiudono la riga', () => {
  for (const a of ENDING) {
    it(`${a} svuota anche con rowTarget = openRow`, () => {
      expect(rowFlushNeeded(base({ action: a, rowTarget: ROW }))).toBe(true);
    });
    it(`${a} non svuota se la riga e' pulita o gia' svuotata`, () => {
      expect(rowFlushNeeded(base({ action: a, rowTarget: ROW, openRowDirty: false }))).toBe(false);
      expect(rowFlushNeeded(base({ action: a, rowTarget: ROW, afterFlush: true }))).toBe(false);
      expect(rowFlushNeeded(base({ action: a, rowTarget: ROW, openRow: null }))).toBe(false);
    });
  }
});
