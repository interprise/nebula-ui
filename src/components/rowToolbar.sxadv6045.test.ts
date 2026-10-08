import { describe, it, expect } from 'vitest';
import { pathAfterRemoval, rowToolbarActions } from './rowToolbar';
import type { RowToolbarAction, RowToolbarInput } from './rowToolbar';

// SXADV-6045: il pannello "Gestione riga" aggiunge l'Annulla di riga (CancelRow) alla
// toolbar di riga, e dopo Cancella / Annulla di una riga nuova sceglie la riga successiva
// con `pathAfterRemoval`.
// Contratto: docs/features/20261008_SXADV-6045_gestione_riga.md
// (CORE: CORE/docs/20261008_SXADV-6045_annulla_di_riga.md)

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
const NR_VALID = {
  id: 'newRecordS1-0',
  text: 'Nuovo',
  icon: 'add.png',
  handler: "doAction2.createCallback('Add', 'S1-0')",
  disabled: false,
};
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
const EXPECT_CANCEL: RowToolbarAction = {
  key: 'cancel',
  label: 'Annulla',
  icon: 'undo',
  action: 'CancelRow',
  params: { navpath: ROW },
  disabled: false,
};

// ======================================================================================

describe('rowToolbarActions — Annulla di riga: caso reale (Prima Nota)', () => {
  it('toolbar PN + addCommand: Salva, Salva+, Annulla, Nuovo in questo ordine', () => {
    const r = run({ addCommand: 'Add', listPath: LIST });
    expect(r).toEqual([
      EXPECT_SAVE,
      EXPECT_SAVE_NEW,
      EXPECT_CANCEL,
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false },
    ]);
  });

  it('toolbar PN senza addCommand: Salva e Annulla (niente Salva+ ne Nuovo)', () => {
    expect(run({})).toEqual([EXPECT_SAVE, EXPECT_CANCEL]);
  });

  it('toolbar PN, lista incorporata senza addCommand: Salva e Annulla', () => {
    expect(run({ embedded: true })).toEqual([EXPECT_SAVE, EXPECT_CANCEL]);
  });

  it('il Cancella della pagina non diventa una voce di riga (resta del pannello)', () => {
    const r = run({ addCommand: 'Add', listPath: LIST });
    expect(keys(r)).toEqual(['save', 'saveNew', 'cancel', 'new']);
  });
});

// ======================================================================================

describe('rowToolbarActions — Annulla di riga: forma della voce', () => {
  it("label 'Annulla', icon 'undo', action 'CancelRow', navpath = riga", () => {
    const c = byKey(run({ pageToolbar: [SAVE, CANCEL] }), 'cancel');
    expect(c).toEqual(EXPECT_CANCEL);
  });

  it('il comando NON viene dall handler della voce cancel della pagina (Cancel, CustomCancel...)', () => {
    const cancel = { ...CANCEL, handler: "doAction.createCallback('AnnullaDocumentoPN')" };
    const c = byKey(run({ pageToolbar: [SAVE, cancel] }), 'cancel');
    expect(c?.action).toBe('CancelRow');
  });

  it('il navpath NON viene dall handler della voce cancel (doAction2 col percorso del documento)', () => {
    const cancel = { ...CANCEL, handler: "doAction2.createCallback('Cancel', 'S1-0.0')" };
    const c = byKey(run({ pageToolbar: [SAVE, cancel] }), 'cancel');
    expect(c?.params).toEqual({ navpath: ROW });
  });

  it('label e icona del contratto, non quelle della voce della pagina', () => {
    const cancel = { ...CANCEL, text: 'Abbandona', icon: 'thumb_down.png' };
    const c = byKey(run({ pageToolbar: [SAVE, cancel] }), 'cancel');
    expect(c?.label).toBe('Annulla');
    expect(c?.icon).toBe('undo');
  });

  it('params ha solo navpath', () => {
    const c = byKey(run({ pageToolbar: [SAVE, CANCEL], addCommand: 'Add', listPath: LIST }), 'cancel');
    expect(Object.keys(c?.params ?? {})).toEqual(['navpath']);
  });

  it('navpath = rowPath esatto anche su piu livelli (con virgole)', () => {
    const deep = 'S1-0.0,S1-9.3,S1-14.2';
    const r = rowToolbarActions({ pageToolbar: [SAVE, CANCEL], rowPath: deep, addCommand: 'Add', listPath: 'S1-14' });
    expect(byKey(r, 'cancel')?.params).toEqual({ navpath: deep });
  });

  it('navpath segue rowPath: righe diverse danno navpath diversi', () => {
    const a = rowToolbarActions({ pageToolbar: [SAVE, CANCEL], rowPath: 'S1-0.0,S1-9.1' });
    const b = rowToolbarActions({ pageToolbar: [SAVE, CANCEL], rowPath: 'S1-0.0,S1-9.2' });
    expect(byKey(a, 'cancel')?.params.navpath).toBe('S1-0.0,S1-9.1');
    expect(byKey(b, 'cancel')?.params.navpath).toBe('S1-0.0,S1-9.2');
  });
});

// ======================================================================================

describe('rowToolbarActions — Annulla di riga: disabled sempre false', () => {
  it('voce cancel della pagina disabilitata (Session senza modifiche) -> Annulla di riga attivo', () => {
    const cancel = { ...CANCEL, disabled: true };
    const c = byKey(run({ pageToolbar: [SAVE, cancel] }), 'cancel');
    expect(c).toBeDefined();
    expect(c?.disabled).toBe(false);
  });

  it('Salva disabilitato -> Salva/Salva+ disabilitati, Annulla no', () => {
    const save = { ...SAVE, disabled: true };
    const r = run({ pageToolbar: [save, CANCEL], addCommand: 'Add', listPath: LIST });
    expect(byKey(r, 'save')?.disabled).toBe(true);
    expect(byKey(r, 'saveNew')?.disabled).toBe(true);
    expect(byKey(r, 'cancel')?.disabled).toBe(false);
  });

  it('voce cancel senza campo disabled -> disabled false (booleano)', () => {
    const { disabled: _d, ...cancel } = CANCEL;
    void _d;
    expect(byKey(run({ pageToolbar: [SAVE, cancel] }), 'cancel')?.disabled).toBe(false);
  });
});

// ======================================================================================

describe('rowToolbarActions — Annulla di riga: presenza', () => {
  it('Salva senza voce cancel nella pagina -> niente Annulla', () => {
    expect(keys(run({ pageToolbar: [SAVE, SAVE_NEW, DELETE], addCommand: 'Add' }))).toEqual(['save', 'saveNew', 'new']);
  });

  it('voce cancel senza Salva -> niente Annulla', () => {
    expect(run({ pageToolbar: [CANCEL] })).toEqual([]);
    expect(keys(run({ pageToolbar: [CANCEL], addCommand: 'Add' }))).toEqual(['new']);
  });

  it('voce cancel + solo saveNew (niente save) -> niente Annulla', () => {
    expect(keys(run({ pageToolbar: [SAVE_NEW, CANCEL], addCommand: 'Add', listPath: LIST }))).toEqual(['new']);
  });

  it("Salva non permesso (doAction.createCallback('')) -> niente Annulla", () => {
    const save = { ...SAVE, handler: "doAction.createCallback('')" };
    expect(run({ pageToolbar: [save, CANCEL] })).toEqual([]);
  });

  it('voce save senza handler -> niente Annulla', () => {
    const { handler: _h, ...save } = SAVE;
    void _h;
    expect(run({ pageToolbar: [save, CANCEL] })).toEqual([]);
  });

  it('Annulla non dipende dal comando di inserimento (con o senza addCommand / newRecord)', () => {
    expect(keys(run({ pageToolbar: [SAVE, CANCEL] }))).toEqual(['save', 'cancel']);
    expect(keys(run({ pageToolbar: [SAVE, CANCEL], addCommand: 'Add' }))).toEqual(['save', 'saveNew', 'cancel', 'new']);
    expect(keys(run({ pageToolbar: [SAVE, CANCEL, NR_VALID] }))).toEqual(['save', 'saveNew', 'cancel', 'new']);
    expect(keys(run({ pageToolbar: [SAVE, CANCEL, NR_VALID], embedded: true }))).toEqual(['save', 'cancel']);
    expect(keys(run({ pageToolbar: [SAVE, CANCEL], addCommand: '' }))).toEqual(['save', 'cancel']);
  });

  it('voce cancel senza handler conta lo stesso (la regola e solo sull id)', () => {
    const { handler: _h, ...cancel } = CANCEL;
    void _h;
    expect(keys(run({ pageToolbar: [SAVE, cancel] }))).toEqual(['save', 'cancel']);
  });

  it('id cancel con un altro view state (cancelS12-345) e riconosciuto', () => {
    const cancel = { ...CANCEL, id: 'cancelS12-345' };
    expect(keys(run({ pageToolbar: [SAVE, cancel] }))).toEqual(['save', 'cancel']);
  });

  it('id che contiene cancel ma non comincia con cancel (xcancelS1-0, rowCancelS1-0) -> niente Annulla', () => {
    expect(keys(run({ pageToolbar: [SAVE, { ...CANCEL, id: 'xcancelS1-0' }] }))).toEqual(['save']);
    expect(keys(run({ pageToolbar: [SAVE, { ...CANCEL, id: 'rowCancelS1-0' }] }))).toEqual(['save']);
  });

  it('id con maiuscola (CancelS1-0) non comincia per cancel -> niente Annulla', () => {
    expect(keys(run({ pageToolbar: [SAVE, { ...CANCEL, id: 'CancelS1-0' }] }))).toEqual(['save']);
  });

  it("una stringa che contiene 'cancel' non e una voce", () => {
    expect(keys(run({ pageToolbar: [SAVE, "cancelS1-0 doAction.createCallback('Cancel')"] }))).toEqual(['save']);
  });

  it('voce cancel senza id, o con id non stringa, si ignora', () => {
    const { id: _i, ...noId } = CANCEL;
    void _i;
    expect(keys(run({ pageToolbar: [SAVE, noId] }))).toEqual(['save']);
    expect(keys(run({ pageToolbar: [SAVE, { ...CANCEL, id: 42 }] }))).toEqual(['save']);
  });

  it('piu voci cancel* -> un solo Annulla', () => {
    const r = run({ pageToolbar: [SAVE, CANCEL, { ...CANCEL, id: 'cancelS1-9' }] });
    expect(keys(r)).toEqual(['save', 'cancel']);
  });

  it('toolbar undefined o vuota -> niente Annulla', () => {
    expect(run({ pageToolbar: undefined })).toEqual([]);
    expect(run({ pageToolbar: [] })).toEqual([]);
  });

  it('valori non oggetto in toolbar non fanno esplodere e non impediscono l Annulla', () => {
    const r = run({ pageToolbar: [null, undefined, 0, true, '', '->', SAVE, CANCEL] });
    expect(r).toEqual([EXPECT_SAVE, EXPECT_CANCEL]);
  });
});

// ======================================================================================

describe('rowToolbarActions — ordine con l Annulla', () => {
  it('save, saveNew, cancel, new qualunque sia l ordine nella toolbar della pagina', () => {
    const nr = { ...NR_VALID, id: 'newRecordS1-9', handler: "doAction2.createCallback('Add', 'S1-9')" };
    expect(keys(run({ pageToolbar: [CANCEL, nr, DELETE, SAVE_NEW, SAVE] }))).toEqual(['save', 'saveNew', 'cancel', 'new']);
    expect(keys(run({ pageToolbar: [nr, SAVE, CANCEL] }))).toEqual(['save', 'saveNew', 'cancel', 'new']);
  });

  it('cancel prima della voce save nella pagina -> Annulla comunque dopo Salva', () => {
    expect(keys(run({ pageToolbar: [CANCEL, SAVE] }))).toEqual(['save', 'cancel']);
  });

  it('con addCommand ma Salva disabilitato: ordine invariato', () => {
    const save = { ...SAVE, disabled: true };
    expect(keys(run({ pageToolbar: [CANCEL, save], addCommand: 'Add', listPath: LIST }))).toEqual([
      'save', 'saveNew', 'cancel', 'new',
    ]);
  });

  it('embedded + addCommand: Salva, Salva+, Annulla, Nuovo (navpath della lista sul Nuovo)', () => {
    const r = run({ pageToolbar: [SAVE, CANCEL, NR_VALID], embedded: true, addCommand: 'Add', listPath: LIST });
    expect(r).toEqual([
      EXPECT_SAVE,
      EXPECT_SAVE_NEW,
      EXPECT_CANCEL,
      { key: 'new', label: 'Nuovo', icon: 'add.png', action: 'Add', params: { navpath: LIST }, disabled: false },
    ]);
  });

  it('non modifica la toolbar d ingresso; chiamate ripetute uguali', () => {
    const tb = JSON.parse(JSON.stringify(PN_TOOLBAR)) as unknown[];
    const before = JSON.stringify(tb);
    const a = rowToolbarActions({ pageToolbar: tb, rowPath: ROW, addCommand: 'Add', listPath: LIST });
    const b = rowToolbarActions({ pageToolbar: tb, rowPath: ROW, addCommand: 'Add', listPath: LIST });
    expect(JSON.stringify(tb)).toBe(before);
    expect(a).toEqual(b);
  });
});

// ======================================================================================

describe('pathAfterRemoval — la riga tolta e ancora nella lista', () => {
  it('la successiva e scivolata nella stessa posizione -> stesso percorso', () => {
    expect(pathAfterRemoval('S1-9.2', ['S1-9.0', 'S1-9.1', 'S1-9.2', 'S1-9.3'])).toBe('S1-9.2');
  });

  it('riga non tolta (errore, o Annulla di una riga esistente) -> stesso percorso', () => {
    expect(pathAfterRemoval('S1-9.0', ['S1-9.0'])).toBe('S1-9.0');
  });

  it('navpath a piu segmenti con virgole', () => {
    const p = 'S1-0.0,S1-9.3';
    expect(pathAfterRemoval(p, ['S1-0.0,S1-9.0', 'S1-0.0,S1-9.3'])).toBe(p);
  });

  it('presente vince sulla precedente', () => {
    expect(pathAfterRemoval('S1-9.5', ['S1-9.4', 'S1-9.5'])).toBe('S1-9.5');
  });

  it('presente anche fuori ordine', () => {
    expect(pathAfterRemoval('S1-9.1', ['S1-9.3', 'S1-9.1', 'S1-9.0'])).toBe('S1-9.1');
  });
});

describe('pathAfterRemoval — era l ultima: la precedente', () => {
  it('ultima riga tolta -> la precedente', () => {
    expect(pathAfterRemoval('S1-9.3', ['S1-9.0', 'S1-9.1', 'S1-9.2'])).toBe('S1-9.2');
  });

  it('una sola riga rimasta (indice 0) -> quella', () => {
    expect(pathAfterRemoval('S1-9.1', ['S1-9.0'])).toBe('S1-9.0');
  });

  it('buchi: la piu alta minore di quella tolta', () => {
    expect(pathAfterRemoval('S1-9.5', ['S1-9.0', 'S1-9.1', 'S1-9.3', 'S1-9.7'])).toBe('S1-9.3');
  });

  it('indici confrontati come numeri, non come stringhe (9 < 10)', () => {
    expect(pathAfterRemoval('S1-9.10', ['S1-9.2', 'S1-9.9'])).toBe('S1-9.9');
    expect(pathAfterRemoval('S1-9.12', ['S1-9.9', 'S1-9.10', 'S1-9.11'])).toBe('S1-9.11');
    expect(pathAfterRemoval('S1-9.3', ['S1-9.2', 'S1-9.10', 'S1-9.20'])).toBe('S1-9.2');
  });

  it('ordine dei paths indifferente', () => {
    expect(pathAfterRemoval('S1-9.6', ['S1-9.4', 'S1-9.0', 'S1-9.5', 'S1-9.2'])).toBe('S1-9.5');
  });

  it('navpath a piu segmenti: S1-0.0,S1-9.3 tolta -> S1-0.0,S1-9.2', () => {
    expect(pathAfterRemoval('S1-0.0,S1-9.3', ['S1-0.0,S1-9.0', 'S1-0.0,S1-9.1', 'S1-0.0,S1-9.2'])).toBe(
      'S1-0.0,S1-9.2',
    );
  });

  it('tre livelli', () => {
    expect(pathAfterRemoval('S1-0.0,S1-9.3,S1-14.4', ['S1-0.0,S1-9.3,S1-14.0', 'S1-0.0,S1-9.3,S1-14.3'])).toBe(
      'S1-0.0,S1-9.3,S1-14.3',
    );
  });

  it('il risultato e uno dei paths', () => {
    const paths = ['S1-9.0', 'S1-9.1'];
    const r = pathAfterRemoval('S1-9.4', paths);
    expect(paths).toContain(r);
  });
});

describe('pathAfterRemoval — solo lo stesso prefisso', () => {
  it('S1-19 non e S1-9 (prefissi che condividono cifre)', () => {
    expect(pathAfterRemoval('S1-9.3', ['S1-19.0', 'S1-19.1', 'S1-19.2'])).toBeNull();
    expect(pathAfterRemoval('S1-9.3', ['S1-19.2', 'S1-9.1'])).toBe('S1-9.1');
    expect(pathAfterRemoval('S1-19.3', ['S1-9.2', 'S1-19.0'])).toBe('S1-19.0');
  });

  it('S1-9 non e S1-91 ne S11-9', () => {
    expect(pathAfterRemoval('S1-9.3', ['S1-91.2', 'S11-9.2'])).toBeNull();
  });

  it('padre diverso nel segmento precedente: S1-0.1,S1-9 non e S1-0.0,S1-9', () => {
    expect(pathAfterRemoval('S1-0.0,S1-9.3', ['S1-0.1,S1-9.2', 'S1-0.1,S1-9.0'])).toBeNull();
    expect(pathAfterRemoval('S1-0.0,S1-9.3', ['S1-0.1,S1-9.2', 'S1-0.0,S1-9.0'])).toBe('S1-0.0,S1-9.0');
  });

  it('il padre stesso o il solo segmento finale non sono righe della lista', () => {
    expect(pathAfterRemoval('S1-0.0,S1-9.3', ['S1-0.0', 'S1-9.2'])).toBeNull();
  });

  it('una riga di una lista annidata sotto una riga sorella non conta', () => {
    expect(pathAfterRemoval('S1-0.0,S1-9.3', ['S1-0.0,S1-9.2,S1-14.0'])).toBeNull();
  });

  it('suffisso non numerico si ignora', () => {
    expect(pathAfterRemoval('S1-9.3', ['S1-9.x', 'S1-9.', 'S1-9.1a'])).toBeNull();
  });

  it('suffisso non numerico accanto a uno valido: vince il valido', () => {
    expect(pathAfterRemoval('S1-9.3', ['S1-9.x', 'S1-9.1'])).toBe('S1-9.1');
  });
});

describe('pathAfterRemoval — null: il pannello si chiude', () => {
  it('lista vuota', () => {
    expect(pathAfterRemoval('S1-9.0', [])).toBeNull();
    expect(pathAfterRemoval('S1-0.0,S1-9.2', [])).toBeNull();
  });

  it('nessuna riga con indice minore (solo maggiori: per contratto null)', () => {
    expect(pathAfterRemoval('S1-9.0', ['S1-9.1', 'S1-9.2'])).toBeNull();
    expect(pathAfterRemoval('S1-9.2', ['S1-9.3'])).toBeNull();
  });

  it('percorso senza indice (la lista stessa)', () => {
    expect(pathAfterRemoval('S1-9', ['S1-9.0', 'S1-9.1'])).toBeNull();
  });

  it('ultimo segmento senza indice anche se un segmento prima ha il punto', () => {
    // 'S1-0.5,S1-9': l'ultimo punto sta nel PRIMO segmento. Chi taglia all'ultimo punto
    // della stringa trova prefisso 'S1-0' e "indice" '5,S1-9' e sceglierebbe S1-0.3.
    expect(pathAfterRemoval('S1-0.5,S1-9', ['S1-0.3', 'S1-0.4'])).toBeNull();
  });

  it('percorso vuoto', () => {
    expect(pathAfterRemoval('', ['S1-9.0'])).toBeNull();
  });

  it('indice non numerico nel percorso tolto', () => {
    expect(pathAfterRemoval('S1-9.x', ['S1-9.0'])).toBeNull();
  });
});

describe('pathAfterRemoval — purezza', () => {
  it('non modifica paths', () => {
    const paths = ['S1-9.2', 'S1-9.0', 'S1-9.1'];
    const copy = [...paths];
    pathAfterRemoval('S1-9.3', paths);
    expect(paths).toEqual(copy);
  });

  it('accetta un array readonly congelato', () => {
    const paths = Object.freeze(['S1-9.0', 'S1-9.1']);
    expect(pathAfterRemoval('S1-9.2', paths)).toBe('S1-9.1');
  });
});
