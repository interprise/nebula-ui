import { describe, it, expect, beforeEach } from 'vitest';
import { armReturn, armedReturn, disarmReturn, disarmAllReturns } from './rowReturn';
import { listOwnerOf } from '../components/rowSelectionMemory';

// SXADV-5957.2B: il ritorno armato e' indicizzato da sid|vista, ma la pagina di
// dettaglio di un rigo puo' contenere una griglia della STESSA vista (tab
// "Componenti" sotto il rigo di docRigheCliList): stessa chiave, e se lo
// chiede lei se lo prende al posto della lista vera. Per questo il ritorno
// porta anche un proprietario, il padre del percorso della lista
// (listOwnerOf): lo vede solo chi chiede con lo stesso proprietario. Armato
// senza proprietario resta visibile a tutti, come prima. Chiederlo non lo
// disarma mai: lo disarma la lista che l'ha applicato.

const CHIAVE = 'S1|docRigheCliList';

/** ui.path della lista Righe da cui l'utente clicca il rigo. */
const LISTA = 'S1-0.0,S1-11.0,S1-14.0';
/** Il rigo cliccato: posizione 126 della lista sopra. */
const RIGO = 'S1-0.0,S1-11.0,S1-14.126';
/** ui.path della griglia Componenti nel dettaglio del rigo (stessa vista). */
const COMPONENTI = 'S1-14.126,S1-15.0';
/** ui.path della lista Righe ricreata al ritorno: viewstate nuovo, stesso padre. */
const RICREATA = 'S1-0.0,S1-11.0,S1-16.0';

describe('rowReturn con proprietario: il caso di Elena', () => {
  beforeEach(() => disarmAllReturns());

  it('clic sul rigo, Componenti chiede (niente), la lista ricreata chiede (row)', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(LISTA));
    // La griglia annidata ha un altro padre: il ritorno non e' suo.
    expect(armedReturn(CHIAVE, listOwnerOf(COMPONENTI))).toBeUndefined();
    // ...e chiedere non l'ha disarmato: la lista vera lo trova ancora.
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
  });

  it('il proprietario si puo\' prendere anche dal percorso del rigo cliccato', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(RIGO));
    expect(armedReturn(CHIAVE, listOwnerOf(COMPONENTI))).toBeUndefined();
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
  });

  it('Componenti chiede piu\' volte (ridisegni): il ritorno resta armato', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(LISTA));
    for (let i = 0; i < 5; i++) {
      expect(armedReturn(CHIAVE, listOwnerOf(COMPONENTI))).toBeUndefined();
    }
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
  });

  it('chiedere non disarma: anche il proprietario giusto lo ritrova finche\' non si disarma', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(LISTA));
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
    disarmReturn(CHIAVE);
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBeUndefined();
  });

  it('modo new (Nuovo della griglia): stessa regola', () => {
    armReturn(CHIAVE, 'new', listOwnerOf(LISTA));
    expect(armedReturn(CHIAVE, listOwnerOf(COMPONENTI))).toBeUndefined();
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('new');
  });

  it('chi chiede senza proprietario non vede un ritorno che ne ha uno', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(LISTA));
    expect(armedReturn(CHIAVE)).toBeUndefined();
    expect(armedReturn(CHIAVE, undefined)).toBeUndefined();
    expect(armedReturn(CHIAVE, null)).toBeUndefined();
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
  });

  it('documento diverso (padre diverso) non vede il ritorno', () => {
    armReturn(CHIAVE, 'row', listOwnerOf(LISTA));
    expect(armedReturn(CHIAVE, listOwnerOf('S1-0.0,S1-12.0,S1-16.0'))).toBeUndefined();
    expect(armedReturn(CHIAVE, listOwnerOf('S1-0.1,S1-11.0,S1-16.0'))).toBeUndefined();
  });

  it('il confronto e\' sulla stringa identica, non su un prefisso', () => {
    armReturn(CHIAVE, 'row', 'S1-0.7,');
    expect(armedReturn(CHIAVE, 'S1-0.70,')).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-0.7,S1-9.0,')).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-0.')).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-0.7,')).toBe('row');
  });
});

describe('rowReturn: compatibilita\' all\'indietro (armato senza proprietario)', () => {
  beforeEach(() => disarmAllReturns());

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('armato con proprietario %s: lo vede chiunque', (_nome, owner) => {
    armReturn(CHIAVE, 'row', owner);
    expect(armedReturn(CHIAVE)).toBe('row');
    expect(armedReturn(CHIAVE, null)).toBe('row');
    expect(armedReturn(CHIAVE, listOwnerOf(COMPONENTI))).toBe('row');
    expect(armedReturn(CHIAVE, listOwnerOf(RICREATA))).toBe('row');
  });

  it('armReturn a due argomenti (chiamanti vecchi): lo vede chiunque', () => {
    armReturn(CHIAVE, 'new');
    expect(armedReturn(CHIAVE)).toBe('new');
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBe('new');
  });

  it('lista di primo livello (listOwnerOf -> null): lo vede chiunque', () => {
    armReturn('S1|fattureList', 'row', listOwnerOf('S1-3.0'));
    expect(armedReturn('S1|fattureList')).toBe('row');
    expect(armedReturn('S1|fattureList', listOwnerOf('S1-4.0'))).toBe('row');
  });
});

describe('rowReturn: riarmo e isolamento fra chiavi', () => {
  beforeEach(() => disarmAllReturns());

  it('riarmare la stessa chiave sostituisce modo e proprietario', () => {
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    armReturn(CHIAVE, 'new', 'S1-14.126,');
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-14.126,')).toBe('new');
  });

  it('riarmare senza proprietario toglie il proprietario di prima', () => {
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    armReturn(CHIAVE, 'row');
    expect(armedReturn(CHIAVE)).toBe('row');
    expect(armedReturn(CHIAVE, 'S1-14.126,')).toBe('row');
  });

  it('riarmare con proprietario dopo un armo senza lo restringe', () => {
    armReturn(CHIAVE, 'new');
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    expect(armedReturn(CHIAVE)).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-14.126,')).toBeUndefined();
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBe('row');
  });

  it('chiavi diverse non si vedono, anche con lo stesso proprietario', () => {
    const padre = 'S1-0.0,S1-11.0,';
    armReturn(CHIAVE, 'row', padre);
    armReturn('S2|docRigheCliList', 'new', padre);
    expect(armedReturn(CHIAVE, padre)).toBe('row');
    expect(armedReturn('S2|docRigheCliList', padre)).toBe('new');
    expect(armedReturn('S1|altraList', padre)).toBeUndefined();
    disarmReturn(CHIAVE);
    expect(armedReturn(CHIAVE, padre)).toBeUndefined();
    expect(armedReturn('S2|docRigheCliList', padre)).toBe('new');
  });

  it('disarmReturn toglie anche un ritorno con proprietario', () => {
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    disarmReturn(CHIAVE);
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBeUndefined();
    expect(armedReturn(CHIAVE)).toBeUndefined();
  });

  it('disarmAllReturns toglie anche i ritorni con proprietario', () => {
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    armReturn('S1|fattureList', 'new');
    disarmAllReturns();
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBeUndefined();
    expect(armedReturn('S1|fattureList')).toBeUndefined();
  });

  it('dopo il disarmo si riarma con un altro proprietario', () => {
    armReturn(CHIAVE, 'row', 'S1-0.0,S1-11.0,');
    disarmReturn(CHIAVE);
    armReturn(CHIAVE, 'row', 'S1-14.126,');
    expect(armedReturn(CHIAVE, 'S1-14.126,')).toBe('row');
    expect(armedReturn(CHIAVE, 'S1-0.0,S1-11.0,')).toBeUndefined();
  });
});
