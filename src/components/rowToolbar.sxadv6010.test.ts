import { describe, it, expect } from 'vitest';
import { rowToolbarActions } from './rowToolbar';
import type { RowToolbarAction, RowToolbarInput } from './rowToolbar';

// SXADV-6010: il pannello di riga replica Salva / Salva+ / Nuovo della toolbar della
// pagina, centrati sulla riga. `rowToolbarActions` e' la funzione pura che li decide.
// Contratto: docs/features/20261007_SXADV-6010_toolbar_di_riga.md

const ROW = 'S1-0.0,S1-9.0';
const LIST = 'S1-9';

// --- voci della toolbar come le manda il server ---------------------------------------

const SAVE = {
  id: 'saveS1-0',
  text: 'Salva',
  icon: 'database_save.png',
  handler: "doAction.createCallback('Save')",
  disabled: false,
  keys: [120],
};
const SAVE_NEW = {
  id: 'saveNewS1-0',
  text: 'Salva+',
  icon: 'database_add.png',
  handler: "doAction2.createCallback('SaveAndNew',  'S1-0.0')",
  disabled: false,
};
const CANCEL = {
  id: 'cancelS1-0',
  text: 'Annulla',
  icon: 'thumb_down.png',
  handler: "doAction.createCallback('Cancel')",
  disabled: false,
};
const NEW_RECORD_DISABLED = { id: 'newRecordS1-0', text: 'Nuovo', icon: 'add.png', disabled: true };
const DELETE = {
  id: 'deleteS1-0',
  text: 'Cancella',
  icon: 'delete.png',
  handler: "confirmDelete.createCallback('S1-0.0', 'Delete', '91700018|281634')",
  disabled: false,
};

/** La toolbar reale del documento Prima Nota (PN). */
const PN_TOOLBAR: unknown[] = [
  '<div class="x-toolbar-title">Prima nota</div>',
  '->',
  SAVE,
  SAVE_NEW,
  CANCEL,
  NEW_RECORD_DISABLED,
  DELETE,
];

function run(over: Partial<RowToolbarInput>): RowToolbarAction[] {
  return rowToolbarActions({ pageToolbar: PN_TOOLBAR, rowPath: ROW, ...over });
}

function keys(r: RowToolbarAction[]): string[] {
  return r.map((a) => a.key);
}

function byKey(r: RowToolbarAction[], k: RowToolbarAction['key']): RowToolbarAction | undefined {
  return r.find((a) => a.key === k);
}

const EXPECT_SAVE: RowToolbarAction = {
  key: 'save',
  label: 'Salva',
  icon: 'database_save.png',
  action: 'Save',
  params: { navpath: ROW },
  disabled: false,
};
const EXPECT_SAVE_NEW: RowToolbarAction = {
  key: 'saveNew',
  label: 'Salva+',
  icon: 'database_add.png',
  action: 'SaveAndNew',
  params: { navpath: ROW },
  disabled: false,
};

// ======================================================================================

describe('rowToolbarActions — caso reale (Prima Nota, Reg. contabili)', () => {
  it('toolbar PN + addCommand della lista: Salva, Salva+, Nuovo in questo ordine', () => {
    const r = run({ addCommand: 'Add', listPath: LIST });
    expect(r).toEqual([
      EXPECT_SAVE,
      EXPECT_SAVE_NEW,
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false },
    ]);
  });

  it('Salva NON prende il comando ne il navpath della voce saveNew (SaveAndNew, S1-0.0)', () => {
    const save = byKey(run({ addCommand: 'Add', listPath: LIST }), 'save');
    expect(save?.action).toBe('Save');
    expect(save?.params).toEqual({ navpath: ROW });
  });

  it('Salva+ ha navpath = riga, non il navpath del documento scritto nell handler della pagina', () => {
    const sn = byKey(run({ addCommand: 'Add', listPath: LIST }), 'saveNew');
    expect(sn?.params).toEqual({ navpath: ROW });
    expect(sn?.params.navpath).not.toBe('S1-0.0');
  });

  it('nessuna voce Annulla ne Cancella nel risultato', () => {
    const r = run({ addCommand: 'Add', listPath: LIST });
    expect(keys(r).every((k) => k === 'save' || k === 'saveNew' || k === 'new')).toBe(true);
    expect(r).toHaveLength(3);
  });

  it('toolbar PN senza addCommand: newRecord disabilitato e senza handler -> solo Salva', () => {
    expect(run({})).toEqual([EXPECT_SAVE]);
  });
});

// ======================================================================================

describe('rowToolbarActions — scelta della voce Salva per prefisso dell id', () => {
  it('saveNew elencato PRIMA di save: Salva resta la voce save', () => {
    const r = run({ pageToolbar: [SAVE_NEW, SAVE], addCommand: 'Add' });
    expect(byKey(r, 'save')?.action).toBe('Save');
  });

  it('piu voci save*: vince la prima (decisione 07/10)', () => {
    const first = { ...SAVE, id: 'saveS1-0', handler: "doAction.createCallback('Primo')" };
    const second = { ...SAVE, id: 'saveS1-9', handler: "doAction.createCallback('Secondo')", disabled: true };
    const s = byKey(run({ pageToolbar: [SAVE_NEW, first, second] }), 'save');
    expect(s?.action).toBe('Primo');
    expect(s?.disabled).toBe(false);
  });

  it('solo la voce saveNew, senza save: niente Salva ne Salva+', () => {
    const r = run({ pageToolbar: [SAVE_NEW, CANCEL], addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['new']);
  });

  it('id con un altro view state (saveS2-17) e riconosciuto', () => {
    const save = { ...SAVE, id: 'saveS2-17', handler: "doAction.createCallback('Save')" };
    const r = run({ pageToolbar: [save] });
    expect(r).toEqual([EXPECT_SAVE]);
  });

  it('id saveNew con un altro view state (saveNewS2-17) non e preso per Salva', () => {
    const sn = { ...SAVE_NEW, id: 'saveNewS2-17', handler: "doAction2.createCallback('SaveAndNew', 'S2-17.0')" };
    const r = run({ pageToolbar: [sn], addCommand: 'Add' });
    expect(keys(r)).toEqual(['new']);
  });

  it('id che contiene save ma non comincia con save (autosaveS1-0) non e Salva', () => {
    const other = { ...SAVE, id: 'autosaveS1-0' };
    expect(run({ pageToolbar: [other] })).toEqual([]);
  });

  it('id Salva con view state a piu cifre e Salva+ a fianco', () => {
    const save = { ...SAVE, id: 'saveS12-345' };
    const sn = { ...SAVE_NEW, id: 'saveNewS12-345' };
    const r = run({ pageToolbar: [sn, save], addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['save', 'saveNew', 'new']);
  });
});

// ======================================================================================

describe('rowToolbarActions — comando di Salva dall handler', () => {
  it("doAction.createCallback('Save') -> Save", () => {
    expect(byKey(run({ pageToolbar: [SAVE] }), 'save')?.action).toBe('Save');
  });

  it("customSaveCommand: doAction.createCallback('SalvaDocumentoPN') -> SalvaDocumentoPN", () => {
    const save = { ...SAVE, handler: "doAction.createCallback('SalvaDocumentoPN')" };
    expect(byKey(run({ pageToolbar: [save] }), 'save')?.action).toBe('SalvaDocumentoPN');
  });

  it("customSaveCommand modulare con il punto: doAction.createCallback('pn.SalvaPN') -> pn.SalvaPN", () => {
    const save = { ...SAVE, handler: "doAction.createCallback('pn.SalvaPN')" };
    expect(byKey(run({ pageToolbar: [save] }), 'save')?.action).toBe('pn.SalvaPN');
  });

  it("doAction2.createCallback('MySave', 'S1-0.0') -> MySave, navpath = riga", () => {
    const save = { ...SAVE, handler: "doAction2.createCallback('MySave', 'S1-0.0')" };
    const s = byKey(run({ pageToolbar: [save] }), 'save');
    expect(s?.action).toBe('MySave');
    expect(s?.params).toEqual({ navpath: ROW });
  });

  it("doAction2 senza spazio dopo la virgola: createCallback('MySave','S1-0.0') -> MySave", () => {
    const save = { ...SAVE, handler: "doAction2.createCallback('MySave','S1-0.0')" };
    expect(byKey(run({ pageToolbar: [save] }), 'save')?.action).toBe('MySave');
  });

  it("doAction2 con due spazi dopo la virgola (come il server): createCallback('MySave',  'S1-0.0') -> MySave", () => {
    const save = { ...SAVE, handler: "doAction2.createCallback('MySave',  'S1-0.0')" };
    expect(byKey(run({ pageToolbar: [save] }), 'save')?.action).toBe('MySave');
  });

  it("spazio dopo la parentesi: doAction.createCallback( 'Save' ) -> Save", () => {
    const save = { ...SAVE, handler: "doAction.createCallback( 'Save' )" };
    expect(byKey(run({ pageToolbar: [save] }), 'save')?.action).toBe('Save');
  });

  it("salvataggio non permesso: doAction.createCallback('') -> niente Salva ne Salva+", () => {
    const save = { ...SAVE, handler: "doAction.createCallback('')" };
    const r = run({ pageToolbar: [save, SAVE_NEW], addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['new']);
  });

  it("salvataggio non permesso via doAction2: createCallback('', 'S1-0.0') -> niente Salva ne Salva+", () => {
    const save = { ...SAVE, handler: "doAction2.createCallback('', 'S1-0.0')" };
    const r = run({ pageToolbar: [save], addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['new']);
  });

  it('voce save senza handler -> niente Salva ne Salva+', () => {
    const { handler: _h, ...noHandler } = SAVE;
    void _h;
    const r = run({ pageToolbar: [noHandler, SAVE_NEW], addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['new']);
  });

  it('voce save con handler undefined esplicito -> niente Salva', () => {
    const save = { ...SAVE, handler: undefined };
    expect(run({ pageToolbar: [save] })).toEqual([]);
  });

  it('il comando del Salva+ e sempre SaveAndNew, anche con customSaveCommand', () => {
    const save = { ...SAVE, handler: "doAction.createCallback('SalvaDocumentoPN')" };
    const sn = byKey(run({ pageToolbar: [save], addCommand: 'Add' }), 'saveNew');
    expect(sn?.action).toBe('SaveAndNew');
    expect(sn?.params).toEqual({ navpath: ROW });
  });
});

// ======================================================================================

describe('rowToolbarActions — voci che non sono oggetti e toolbar assente', () => {
  it("stringhe '->' e HTML si ignorano, gli oggetti dopo restano validi", () => {
    const r = run({ pageToolbar: ['->', '<b>x</b>', SAVE, '->'], addCommand: 'Add' });
    expect(keys(r)).toEqual(['save', 'saveNew', 'new']);
  });

  it('valori non oggetto vari (null, numeri, booleani, undefined) non fanno esplodere', () => {
    const r = run({ pageToolbar: [null, undefined, 0, 42, true, false, '', SAVE] });
    expect(r).toEqual([EXPECT_SAVE]);
  });

  it("una stringa che contiene 'save' non e una voce", () => {
    const r = run({ pageToolbar: ["saveS1-0 doAction.createCallback('Save')"] });
    expect(r).toEqual([]);
  });

  it('toolbar solo di stringhe: niente Salva; Nuovo da addCommand resta', () => {
    const r = run({ pageToolbar: ['->', '<div/>'], addCommand: 'Add', listPath: LIST });
    expect(r).toEqual([
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false },
    ]);
  });

  it('toolbar undefined e niente addCommand -> []', () => {
    expect(rowToolbarActions({ pageToolbar: undefined, rowPath: ROW })).toEqual([]);
  });

  it('toolbar undefined con addCommand -> solo Nuovo (niente Salva, quindi niente Salva+)', () => {
    const r = rowToolbarActions({ pageToolbar: undefined, rowPath: ROW, addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['new']);
  });

  it('toolbar vuota -> []', () => {
    expect(rowToolbarActions({ pageToolbar: [], rowPath: ROW })).toEqual([]);
  });

  it('voce oggetto senza id si ignora', () => {
    const { id: _i, ...noId } = SAVE;
    void _i;
    expect(run({ pageToolbar: [noId] })).toEqual([]);
  });
});

// ======================================================================================

describe('rowToolbarActions — disabled', () => {
  it('Salva disabilitato nella pagina -> Salva e Salva+ disabilitati, Nuovo da addCommand no', () => {
    const save = { ...SAVE, disabled: true };
    const r = run({ pageToolbar: [save, SAVE_NEW], addCommand: 'Add', listPath: LIST });
    expect(byKey(r, 'save')?.disabled).toBe(true);
    expect(byKey(r, 'saveNew')?.disabled).toBe(true);
    expect(byKey(r, 'new')?.disabled).toBe(false);
  });

  it('Salva+ segue il disabled di Salva, NON quello della voce saveNew della pagina', () => {
    const sn = { ...SAVE_NEW, disabled: true };
    const r = run({ pageToolbar: [SAVE, sn], addCommand: 'Add' });
    expect(byKey(r, 'saveNew')?.disabled).toBe(false);

    const save = { ...SAVE, disabled: true };
    const sn2 = { ...SAVE_NEW, disabled: false };
    const r2 = run({ pageToolbar: [save, sn2], addCommand: 'Add' });
    expect(byKey(r2, 'saveNew')?.disabled).toBe(true);
  });

  it('voce save senza campo disabled -> disabled false (e sempre un booleano)', () => {
    const { disabled: _d, ...noDisabled } = SAVE;
    void _d;
    const r = run({ pageToolbar: [noDisabled], addCommand: 'Add' });
    expect(byKey(r, 'save')?.disabled).toBe(false);
    expect(byKey(r, 'saveNew')?.disabled).toBe(false);
  });

  it('il newRecord disabilitato della pagina non disabilita il Nuovo da addCommand', () => {
    const r = run({ addCommand: 'Add', listPath: LIST });
    expect(byKey(r, 'new')?.disabled).toBe(false);
  });
});

// ======================================================================================

describe('rowToolbarActions — presenza del Salva+', () => {
  it('Salva + addCommand -> Salva+', () => {
    expect(keys(run({ pageToolbar: [SAVE], addCommand: 'Add' }))).toEqual(['save', 'saveNew', 'new']);
  });

  it('Salva senza alcun comando di inserimento -> niente Salva+ (anche se la pagina ha saveNew)', () => {
    expect(keys(run({ pageToolbar: [SAVE, SAVE_NEW] }))).toEqual(['save']);
  });

  it('Salva + newRecord valido della pagina (fallback) -> Salva+', () => {
    const nr = { id: 'newRecordS1-9', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('Add', 'S1-9')", disabled: false };
    expect(keys(run({ pageToolbar: [SAVE, nr] }))).toEqual(['save', 'saveNew', 'new']);
  });

  it('Salva+ non dipende dalla presenza della voce saveNew nella pagina', () => {
    const r = run({ pageToolbar: [SAVE], addCommand: 'Add' });
    expect(byKey(r, 'saveNew')).toEqual(EXPECT_SAVE_NEW);
  });

  it('niente Salva ma addCommand -> niente Salva+', () => {
    expect(keys(run({ pageToolbar: [CANCEL], addCommand: 'Add' }))).toEqual(['new']);
  });
});

// ======================================================================================

describe('rowToolbarActions — Nuovo da addCommand', () => {
  it('addCommand con listPath -> params { navpath: listPath }', () => {
    const n = byKey(run({ addCommand: 'Add', listPath: LIST }), 'new');
    expect(n).toEqual({ key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false });
  });

  it('addCommand senza listPath -> params {} (niente chiave navpath)', () => {
    const n = byKey(run({ addCommand: 'Add' }), 'new');
    expect(n?.params).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(n?.params ?? {}, 'navpath')).toBe(false);
  });

  it('customAddCommand della lista: il comando e quello', () => {
    const n = byKey(run({ addCommand: 'AggiungiRigaPN', listPath: LIST }), 'new');
    expect(n?.action).toBe('AggiungiRigaPN');
  });

  it('il navpath del Nuovo e la lista, non la riga', () => {
    const n = byKey(run({ addCommand: 'Add', listPath: LIST }), 'new');
    expect(n?.params.navpath).toBe(LIST);
    expect(n?.params.navpath).not.toBe(ROW);
  });

  it("addCommand vuoto ('') vale come non dato: niente Nuovo e niente Salva+", () => {
    expect(keys(run({ pageToolbar: [SAVE], addCommand: '', listPath: LIST }))).toEqual(['save']);
  });

  it("addCommand vuoto ('') vale come non dato: si usa il newRecord valido della pagina", () => {
    const nr = { id: 'newRecordS1-9', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('Add', 'S1-9')", disabled: false };
    const n = byKey(run({ pageToolbar: [SAVE, nr], addCommand: '', listPath: LIST }), 'new');
    expect(n?.action).toBe('Add');
    expect(n?.params).toEqual({ navpath: 'S1-9' });
  });

  it('addCommand vince sul newRecord valido della pagina', () => {
    const nr = { id: 'newRecordS1-0', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('AddDoc', 'S1-0')", disabled: false };
    const n = byKey(run({ pageToolbar: [SAVE, nr], addCommand: 'Add', listPath: LIST }), 'new');
    expect(n?.action).toBe('Add');
    expect(n?.params).toEqual({ navpath: LIST });
  });

  it('addCommand senza listPath vince comunque sul newRecord della pagina (params {})', () => {
    const nr = { id: 'newRecordS1-0', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('AddDoc', 'S1-0')", disabled: false };
    const n = byKey(run({ pageToolbar: [nr], addCommand: 'Add' }), 'new');
    expect(n?.action).toBe('Add');
    expect(n?.params).toEqual({});
  });
});

// ======================================================================================

describe('rowToolbarActions — Nuovo dalla voce newRecord della pagina (fallback)', () => {
  const NR_OK = {
    id: 'newRecordS1-9',
    text: 'Nuovo',
    icon: 'add.png',
    handler: "doAction2.createCallback('Add', 'S1-9')",
    disabled: false,
  };

  it("newRecord abilitato con doAction2.createCallback('Add', 'S1-9') -> Nuovo Add, navpath S1-9", () => {
    const r = run({ pageToolbar: [NR_OK] });
    expect(r).toEqual([
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: 'S1-9' }, disabled: false },
    ]);
  });

  it('il navpath del fallback viene dall handler, non da listPath', () => {
    const n = byKey(run({ pageToolbar: [NR_OK], listPath: 'S1-77' }), 'new');
    expect(n?.params).toEqual({ navpath: 'S1-9' });
  });

  it('due spazi dopo la virgola, come scrive il server', () => {
    const nr = { ...NR_OK, handler: "doAction2.createCallback('AggiungiRiga',  'S1-0.0,S1-9')" };
    const n = byKey(run({ pageToolbar: [nr] }), 'new');
    expect(n?.action).toBe('AggiungiRiga');
    expect(n?.params).toEqual({ navpath: 'S1-0.0,S1-9' });
  });

  it('nessuno spazio dopo la virgola', () => {
    const nr = { ...NR_OK, handler: "doAction2.createCallback('Add','S1-9')" };
    const n = byKey(run({ pageToolbar: [nr] }), 'new');
    expect(n?.action).toBe('Add');
    expect(n?.params).toEqual({ navpath: 'S1-9' });
  });

  it('newRecord disabilitato (anche con handler valido) -> niente Nuovo', () => {
    const nr = { ...NR_OK, disabled: true };
    expect(run({ pageToolbar: [nr] })).toEqual([]);
  });

  it('newRecord disabilitato -> niente Nuovo e quindi niente Salva+', () => {
    const nr = { ...NR_OK, disabled: true };
    expect(keys(run({ pageToolbar: [SAVE, nr] }))).toEqual(['save']);
  });

  it('newRecord senza handler -> niente Nuovo', () => {
    const { handler: _h, ...nr } = NR_OK;
    void _h;
    expect(run({ pageToolbar: [nr] })).toEqual([]);
  });

  it("newRecord con handler a un solo argomento doAction.createCallback('Add') (senza percorso) -> niente Nuovo", () => {
    const nr = { ...NR_OK, handler: "doAction.createCallback('Add')" };
    expect(run({ pageToolbar: [nr] })).toEqual([]);
  });

  it('id che non comincia con newRecord (addS1-9) non e un fallback', () => {
    const nr = { ...NR_OK, id: 'addS1-9' };
    expect(run({ pageToolbar: [nr] })).toEqual([]);
  });

  it('newRecord con un altro view state (newRecordS3-12) e riconosciuto', () => {
    const nr = { ...NR_OK, id: 'newRecordS3-12', handler: "doAction2.createCallback('Add', 'S3-12')" };
    const n = byKey(run({ pageToolbar: [nr] }), 'new');
    expect(n?.params).toEqual({ navpath: 'S3-12' });
  });

  it('il disabled del Nuovo dal fallback e false', () => {
    expect(byKey(run({ pageToolbar: [NR_OK] }), 'new')?.disabled).toBe(false);
  });

  it('voce newRecord della pagina come stringa si ignora', () => {
    expect(run({ pageToolbar: ["newRecordS1-9 doAction2.createCallback('Add', 'S1-9')"] })).toEqual([]);
  });
});

// ======================================================================================

describe('rowToolbarActions — ordine, etichette, icone, purezza', () => {
  it('ordine Salva, Salva+, Nuovo qualunque sia l ordine nella toolbar della pagina', () => {
    const nr = { id: 'newRecordS1-9', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('Add', 'S1-9')", disabled: false };
    const r = run({ pageToolbar: [nr, DELETE, SAVE_NEW, CANCEL, SAVE] });
    expect(keys(r)).toEqual(['save', 'saveNew', 'new']);
  });

  it('etichette e icone del contratto, non quelle delle voci della pagina', () => {
    const save = { ...SAVE, text: 'Registra', icon: 'disk.png' };
    const nr = { id: 'newRecordS1-9', text: 'Aggiungi', icon: 'plus.png', handler: "doAction2.createCallback('Add', 'S1-9')", disabled: false };
    const r = run({ pageToolbar: [save, nr] });
    expect(r.map((a) => [a.key, a.label, a.icon])).toEqual([
      ['save', 'Salva', 'database_save.png'],
      ['saveNew', 'Salva+', 'database_add.png'],
      ['new', 'Nuovo', 'add.png'],
    ]);
  });

  it('il navpath di Salva e Salva+ e esattamente rowPath (anche con piu livelli)', () => {
    const deep = 'S1-0.0,S1-9.3,S1-14.2';
    const r = rowToolbarActions({ pageToolbar: [SAVE], rowPath: deep, addCommand: 'Add', listPath: 'S1-14' });
    expect(byKey(r, 'save')?.params).toEqual({ navpath: deep });
    expect(byKey(r, 'saveNew')?.params).toEqual({ navpath: deep });
  });

  it('non modifica la toolbar d ingresso', () => {
    const tb = JSON.parse(JSON.stringify(PN_TOOLBAR)) as unknown[];
    const before = JSON.stringify(tb);
    rowToolbarActions({ pageToolbar: tb, rowPath: ROW, addCommand: 'Add', listPath: LIST });
    expect(JSON.stringify(tb)).toBe(before);
  });

  it('chiamate ripetute danno lo stesso risultato', () => {
    const a = run({ addCommand: 'Add', listPath: LIST });
    const b = run({ addCommand: 'Add', listPath: LIST });
    expect(a).toEqual(b);
  });
});

// ======================================================================================

describe('rowToolbarActions — lista incorporata (embedded)', () => {
  const NR_VALID = {
    id: 'newRecordS1-0',
    text: 'Nuovo',
    icon: 'add.png',
    handler: "doAction2.createCallback('Add', 'S1-0')",
    disabled: false,
  };

  it('embedded=true + newRecord valido della pagina, senza addCommand -> niente Nuovo ne Salva+', () => {
    expect(run({ pageToolbar: [SAVE, SAVE_NEW, NR_VALID], embedded: true, listPath: LIST })).toEqual([EXPECT_SAVE]);
  });

  it("embedded=true + newRecord valido, addCommand vuoto ('') -> niente Nuovo ne Salva+", () => {
    expect(keys(run({ pageToolbar: [SAVE, NR_VALID], embedded: true, addCommand: '', listPath: LIST }))).toEqual(['save']);
  });

  it('embedded=true + newRecord valido, senza Salva -> []', () => {
    expect(run({ pageToolbar: [NR_VALID], embedded: true })).toEqual([]);
  });

  it('embedded=true + addCommand -> Salva, Salva+, Nuovo come sempre (navpath della lista)', () => {
    const r = run({ pageToolbar: [SAVE, NR_VALID], embedded: true, addCommand: 'Add', listPath: LIST });
    expect(r).toEqual([
      EXPECT_SAVE,
      EXPECT_SAVE_NEW,
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false },
    ]);
  });

  it('embedded=true + addCommand senza listPath -> Nuovo con params {}', () => {
    const n = byKey(run({ pageToolbar: [SAVE], embedded: true, addCommand: 'AggiungiRigaPN' }), 'new');
    expect(n).toEqual({ key: 'new', label: 'Nuovo', icon: 'add.png', action: 'AggiungiRigaPN', params: {}, disabled: false });
  });

  it('embedded=true non cambia Salva (comando, navpath, disabled)', () => {
    const save = { ...SAVE, handler: "doAction.createCallback('SalvaDocumentoPN')", disabled: true };
    const s = byKey(run({ pageToolbar: [save], embedded: true }), 'save');
    expect(s).toEqual({ ...EXPECT_SAVE, action: 'SalvaDocumentoPN', disabled: true });
  });

  it('embedded=false + newRecord valido, senza addCommand -> fallback come prima', () => {
    const r = run({ pageToolbar: [SAVE, NR_VALID], embedded: false, listPath: LIST });
    expect(keys(r)).toEqual(['save', 'saveNew', 'new']);
    expect(byKey(r, 'new')).toEqual({
      key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: 'S1-0' }, disabled: false,
    });
  });

  it('embedded assente (undefined) + newRecord valido -> fallback come prima', () => {
    const r = run({ pageToolbar: [SAVE, NR_VALID], embedded: undefined });
    expect(keys(r)).toEqual(['save', 'saveNew', 'new']);
    expect(byKey(r, 'new')?.params).toEqual({ navpath: 'S1-0' });
  });

  it("embedded=false + addCommand vuoto ('') + newRecord valido -> fallback", () => {
    const n = byKey(run({ pageToolbar: [NR_VALID], embedded: false, addCommand: '' }), 'new');
    expect(n?.action).toBe('Add');
    expect(n?.params).toEqual({ navpath: 'S1-0' });
  });

  it('embedded=true sulla toolbar reale PN senza addCommand -> solo Salva', () => {
    expect(run({ embedded: true })).toEqual([EXPECT_SAVE]);
  });
});
