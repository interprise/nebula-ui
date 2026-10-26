import { describe, it, expect } from 'vitest';
import { rowToolbarActions } from './rowToolbar';
import { addOpensDetail, detailOpensPage } from './rowActivation';
import type { RowToolbarAction, RowToolbarInput } from './rowToolbar';

// SXADV-5927, contratti P9 e P10 («Regola COME IL LEGACY» di Luca, 26/10 notte;
// P9 dalla regola precedente). `rowToolbarActions` prende `addInDetail`: vero quando il «Nuovo» della
// lista apre la pagina di dettaglio (ListView gli passa addOpensDetail(...), cioe'
// listEdit con inlineEdit="false" e una detailViewName). Allora nel pannello
// «Gestione riga» «Nuovo» e «Salva+» CI SONO ma sono SPENTI: i righi nuovi nascono
// nella pagina di dettaglio. «Salva+» resta spento anche se e' gia' spento.
// Altrimenti come prima: su una lista in linea (inlineEdit="true", anche multiEdit e con
// una detail view) il «Nuovo» del pannello resta ACCESO e aggiunge nel pannello.
// Salva e Annulla non cambiano mai.

const ROW = 'S1-0.0,S1-9.0';
const LIST = 'S1-9';

// Voci della toolbar della pagina, nella forma che manda il server.
const SAVE = { id: 'saveS1-0', text: 'Salva', icon: 'database_save.png', handler: "doAction.createCallback('Save')", disabled: false };
const SAVE_NEW = { id: 'saveNewS1-0', text: 'Salva+', icon: 'database_add.png', handler: "doAction2.createCallback('SaveAndNew',  'S1-0.0')", disabled: false };
// Salva spento dalla pagina: per SXADV-6010 Salva+ del pannello segue il Salva della
// pagina (non la voce saveNew), quindi e' cosi' che Salva+ e' "gia' spento".
const SAVE_OFF = { ...SAVE, disabled: true };
const CANCEL = { id: 'cancelS1-0', text: 'Annulla', icon: 'thumb_down.png', handler: "doAction.createCallback('Cancel')", disabled: false };
const NEW_RECORD = { id: 'newRecordS1-0', text: 'Nuovo', icon: 'add.png', handler: "doAction2.createCallback('Add', 'S1-0')", disabled: false };

const PAGINA = [SAVE, SAVE_NEW, CANCEL, NEW_RECORD];
const PAGINA_SALVAPIU_SPENTO = [SAVE_OFF, SAVE_NEW, CANCEL, NEW_RECORD];

function base(over: Partial<RowToolbarInput> = {}): RowToolbarInput {
  return { pageToolbar: PAGINA, addCommand: 'Add', embedded: true, listPath: LIST, rowPath: ROW, ...over };
}
const per = (a: RowToolbarAction[], k: RowToolbarAction['key']) => a.find((x) => x.key === k);
/** L'azione senza `disabled`: quello che non deve cambiare. */
const senzaStato = (a: RowToolbarAction | undefined) => (a ? { ...a, disabled: null } : a);

describe('P9: senza addInDetail nulla cambia', () => {
  it('addInDetail assente o false danno le stesse azioni', () => {
    expect(rowToolbarActions(base({ addInDetail: false }))).toEqual(rowToolbarActions(base()));
  });

  it('senza addInDetail il Nuovo del pannello c\'e\' ed e\' acceso', () => {
    const n = per(rowToolbarActions(base()), 'new');
    expect(n).toBeDefined();
    expect(n!.disabled).toBe(false);
  });

  it('senza addInDetail Salva+ segue il Salva della pagina (acceso / spento)', () => {
    expect(per(rowToolbarActions(base()), 'saveNew')?.disabled).toBe(false);
    expect(per(rowToolbarActions(base({ pageToolbar: PAGINA_SALVAPIU_SPENTO })), 'saveNew')?.disabled).toBe(true);
  });
});

describe('P9: con addInDetail Nuovo e Salva+ ci sono ma spenti', () => {
  it("le stesse chiavi di prima, nello stesso ordine: nessun bottone sparisce", () => {
    const prima = rowToolbarActions(base()).map((a) => a.key);
    const dopo = rowToolbarActions(base({ addInDetail: true })).map((a) => a.key);
    expect(dopo).toEqual(prima);
    expect(dopo).toContain('new');
    expect(dopo).toContain('saveNew');
  });

  it('Nuovo spento', () => {
    expect(per(rowToolbarActions(base({ addInDetail: true })), 'new')?.disabled).toBe(true);
  });

  it('Salva+ spento', () => {
    expect(per(rowToolbarActions(base({ addInDetail: true })), 'saveNew')?.disabled).toBe(true);
  });

  it('Salva+ gia\' spento dalla toolbar resta spento', () => {
    expect(per(rowToolbarActions(base({ addInDetail: true, pageToolbar: PAGINA_SALVAPIU_SPENTO })), 'saveNew')?.disabled).toBe(true);
  });

  it('Salva e Annulla restano come senza addInDetail', () => {
    for (const pagina of [PAGINA, PAGINA_SALVAPIU_SPENTO]) {
      const senza = rowToolbarActions(base({ pageToolbar: pagina }));
      const con = rowToolbarActions(base({ pageToolbar: pagina, addInDetail: true }));
      expect(per(con, 'save')).toEqual(per(senza, 'save'));
      expect(per(con, 'cancel')).toEqual(per(senza, 'cancel'));
    }
  });

  it('Nuovo e Salva+ spenti tengono etichetta, icona, comando e parametri', () => {
    const senza = rowToolbarActions(base());
    const con = rowToolbarActions(base({ addInDetail: true }));
    expect(senzaStato(per(con, 'new'))).toEqual(senzaStato(per(senza, 'new')));
    expect(senzaStato(per(con, 'saveNew'))).toEqual(senzaStato(per(senza, 'saveNew')));
  });

  it('vale anche per una lista che e\' la pagina stessa (non incorporata)', () => {
    const senza = rowToolbarActions(base({ embedded: false, addCommand: undefined }));
    const con = rowToolbarActions(base({ embedded: false, addCommand: undefined, addInDetail: true }));
    expect(con.map((a) => a.key)).toEqual(senza.map((a) => a.key));
    for (const k of ['new', 'saveNew'] as const) {
      if (per(senza, k)) expect(per(con, k)!.disabled, k).toBe(true);
    }
  });

  it('non inventa un Nuovo dove non si puo\' inserire (lista incorporata senza addCommand)', () => {
    const senza = rowToolbarActions(base({ addCommand: undefined }));
    const con = rowToolbarActions(base({ addCommand: undefined, addInDetail: true }));
    expect(con.map((a) => a.key)).toEqual(senza.map((a) => a.key));
  });
});

describe('P9 con le liste vere («Regola COME IL LEGACY»): addInDetail = addOpensDetail(...)', () => {
  const azioni = (lista: Parameters<typeof addOpensDetail>[0]) =>
    rowToolbarActions(base({ addInDetail: addOpensDetail(lista) }));

  it('Voci (listEdit, inlineEdit="false", detail view): Nuovo e Salva+ spenti', () => {
    const a = azioni({ isListEdit: true, inlineEdit: false, hasDetailView: true });
    expect(per(a, 'new')?.disabled).toBe(true);
    expect(per(a, 'saveNew')?.disabled).toBe(true);
  });

  it('Righe fattura FP (listEdit, multiEdit, inlineEdit="true", detail view): Nuovo e Salva+ ACCESI, come il legacy', () => {
    const a = azioni({ isListEdit: true, inlineEdit: true, hasDetailView: true });
    expect(per(a, 'new')?.disabled).toBe(false);
    expect(per(a, 'saveNew')?.disabled).toBe(false);
    expect(a).toEqual(rowToolbarActions(base()));
  });

  it('listEdit con inlineEdit assente (= in linea) e detail view: Nuovo acceso', () => {
    expect(per(azioni({ isListEdit: true, hasDetailView: true }), 'new')?.disabled).toBe(false);
  });

  it('senza detail view il Nuovo resta acceso anche con inlineEdit="false"', () => {
    expect(per(azioni({ isListEdit: true, inlineEdit: false, hasDetailView: false }), 'new')?.disabled).toBe(false);
  });
});

// ─── P10: il bottone «Dettaglio» del pannello ───────────────────────────────
//
// `detailCommand` (il comando del «>» del rigo, ListRecord.detailCommand): se c'e',
// in coda alle azioni si aggiunge { key 'detail', label 'Dettaglio', action =
// detailCommand, params { navpath: rowPath } }, sempre acceso. ListView lo passa
// solo se la lista ha una detail view e il «>» cambia pagina (detailOpensPage):
// su un micro-detail in linea non multiEdit (sequenzeList) non c'e'.

const NAV = 'NavigateDetail';

describe('P10: «Dettaglio» nel pannello', () => {
  it('senza detailCommand nessuna azione detail (e niente cambia)', () => {
    const a = rowToolbarActions(base());
    expect(per(a, 'detail')).toBeUndefined();
    expect(rowToolbarActions(base({ detailCommand: undefined }))).toEqual(a);
  });

  it('detailCommand vuoto: nessun «Dettaglio»', () => {
    expect(per(rowToolbarActions(base({ detailCommand: '' })), 'detail')).toBeUndefined();
  });

  it('con detailCommand: azione detail IN CODA, etichetta Dettaglio, comando del rigo, navpath = riga, accesa', () => {
    const a = rowToolbarActions(base({ detailCommand: NAV }));
    const d = a[a.length - 1];
    expect(d.key).toBe('detail');
    expect(d.label).toBe('Dettaglio');
    expect(d.action).toBe(NAV);
    expect(d.params).toEqual({ navpath: ROW });
    expect(d.disabled).toBe(false);
    expect(a.filter((x) => x.key === 'detail')).toHaveLength(1);
  });

  it('le altre azioni restano quelle di prima, nello stesso ordine', () => {
    const senza = rowToolbarActions(base());
    const con = rowToolbarActions(base({ detailCommand: NAV }));
    expect(con.slice(0, -1)).toEqual(senza);
  });

  it('il navpath e\' quello della riga del pannello, non della lista', () => {
    const r = 'S1-0.0,S1-9.7';
    const d = per(rowToolbarActions(base({ rowPath: r, detailCommand: NAV })), 'detail');
    expect(d?.params).toEqual({ navpath: r });
    expect(d?.params.navpath).not.toBe(LIST);
  });

  it('il comando e\' preso cosi\' com\'e\' (quello del «>» del rigo)', () => {
    const cmd = 'NavigateDetail2';
    expect(per(rowToolbarActions(base({ detailCommand: cmd })), 'detail')?.action).toBe(cmd);
  });

  it('sempre acceso: anche con addInDetail (Nuovo spento) e con il Salva della pagina spento', () => {
    const a = rowToolbarActions(base({ detailCommand: NAV, addInDetail: true, pageToolbar: PAGINA_SALVAPIU_SPENTO }));
    expect(per(a, 'detail')?.disabled).toBe(false);
    expect(per(a, 'new')?.disabled).toBe(true);
  });

  it('c\'e\' anche senza Nuovo (lista incorporata senza addCommand) e senza toolbar di pagina', () => {
    expect(per(rowToolbarActions(base({ addCommand: undefined, detailCommand: NAV })), 'detail')?.disabled).toBe(false);
    expect(per(rowToolbarActions(base({ pageToolbar: undefined, detailCommand: NAV })), 'detail')?.action).toBe(NAV);
  });

  it('sequenzeList (micro-detail in linea, non multiEdit): il «>» non cambia pagina, quindi niente «Dettaglio»', () => {
    // La regola con cui ListView decide se passare detailCommand.
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: true })).toBe(false);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: true, inlineEdit: true })).toBe(true);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: false })).toBe(true);
  });
});
