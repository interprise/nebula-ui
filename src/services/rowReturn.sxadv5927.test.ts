import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  armReturn,
  armedReturn,
  disarmReturn,
  disarmAllReturns,
  ROW_RETURN_ATTR,
  type ReturnMode,
} from './rowReturn';
import * as memoria from '../components/rowSelectionMemory';
import { executeMenuItem, postAction } from './api';

// SXADV-5927: il ritorno armato (uscita da una lista verso un dettaglio) vive
// in rowReturn. Vale un ritorno solo: la lista lo disarma quando l'ha
// applicato, e un ingresso di primo livello li disarma TUTTI, perche' da li'
// non si torna piu' alla lista: una voce di menu (executeMenuItem) o un
// postAction con newTask=1 (SXADV-5783). Un Post qualunque o una navigazione
// con navpath invece li lascia armati: e' proprio la strada verso il dettaglio
// e di ritorno alla lista.

describe('rowReturn: stato dei ritorni armati', () => {
  beforeEach(() => {
    disarmAllReturns();
    memoria.forgetAllRows();
  });

  it('disarmAllReturns toglie ogni chiave armata', () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S2:righeFatturaList', 'row');
    armReturn('S1:fattureList', 'row');
    disarmAllReturns();
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S2:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S1:fattureList')).toBeUndefined();
  });

  it('disarmAllReturns lascia stare le righe ricordate (5957)', () => {
    memoria.rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-21.3');
    memoria.rememberRow('S1:fattureList', 'S1-0.7');
    armReturn('S1:righeFatturaList', 'row');
    disarmAllReturns();
    expect(memoria.recallRow('S1:righeFatturaList')).toBe('S1-0.7,S1-9.0,S1-21.3');
    expect(memoria.recallRow('S1:fattureList')).toBe('S1-0.7');
  });

  it('disarmAllReturns senza niente di armato non esplode', () => {
    expect(() => disarmAllReturns()).not.toThrow();
    expect(() => disarmAllReturns()).not.toThrow();
  });

  it('dopo disarmAllReturns si puo\' riarmare', () => {
    armReturn('S1:righeFatturaList', 'row');
    disarmAllReturns();
    armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it('forgetAllRows (rowSelectionMemory) disarma tutti i ritorni', () => {
    armReturn('S1:righeFatturaList', 'new');
    memoria.forgetAllRows();
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it('rowSelectionMemory riesporta le stesse funzioni: stato unico', () => {
    // Armato da una parte, si legge dall'altra (e viceversa).
    memoria.armReturn('S1:righeFatturaList', 'new');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
    armReturn('S2:fattureList', 'row');
    expect(memoria.armedReturn('S2:fattureList')).toBe('row');
    memoria.disarmReturn('S2:fattureList');
    expect(armedReturn('S2:fattureList')).toBeUndefined();
    disarmReturn('S1:righeFatturaList');
    expect(memoria.armedReturn('S1:righeFatturaList')).toBeUndefined();
    expect(memoria.ROW_RETURN_ATTR).toBe(ROW_RETURN_ATTR);
    expect(ROW_RETURN_ATTR).toBe('data-row-return');
  });

  it('ReturnMode ammette i due modi', () => {
    const modi: ReturnMode[] = ['row', 'new'];
    modi.forEach((m) => { armReturn('k', m); expect(armedReturn('k')).toBe(m); });
  });
});

describe('api: gli ingressi di primo livello disarmano i ritorni', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Lo stato dei ritorni visto dal server, cioe' al momento della fetch. */
  let armatoAllaFetch: (ReturnMode | undefined)[];

  beforeEach(() => {
    disarmAllReturns();
    memoria.forgetAllRows();
    armatoAllaFetch = [];
    fetchMock = vi.fn(async () => {
      armatoAllaFetch.push(armedReturn('S1:righeFatturaList'));
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executeMenuItem disarma tutto PRIMA di spedire', async () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S2:fattureList', 'row');
    await executeMenuItem('42', 'S1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(armatoAllaFetch).toEqual([undefined]);
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
    expect(armedReturn('S2:fattureList')).toBeUndefined();
  });

  it('executeMenuItem disarma anche se la richiesta fallisce', async () => {
    fetchMock.mockImplementation(async () => {
      armatoAllaFetch.push(armedReturn('S1:righeFatturaList'));
      throw new TypeError('rete giu\'');
    });
    armReturn('S1:righeFatturaList', 'row');
    await executeMenuItem('42', 'S1').catch(() => undefined);
    expect(armatoAllaFetch).toEqual([undefined]);
    expect(armedReturn('S1:righeFatturaList')).toBeUndefined();
  });

  it('executeMenuItem non tocca le righe ricordate', async () => {
    memoria.rememberRow('S1:righeFatturaList', 'S1-0.7,S1-9.0,S1-21.3');
    armReturn('S1:righeFatturaList', 'row');
    await executeMenuItem('42', 'S1');
    expect(memoria.recallRow('S1:righeFatturaList')).toBe('S1-0.7,S1-9.0,S1-21.3');
  });

  it('postAction con newTask=1 disarma tutto PRIMA di spedire', async () => {
    armReturn('S1:righeFatturaList', 'new');
    armReturn('S2:fattureList', 'row');
    await postAction('ViewByKey', { newTask: '1' }, undefined, 'S1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(armatoAllaFetch).toEqual([undefined]);
    expect(armedReturn('S2:fattureList')).toBeUndefined();
  });

  it('postAction senza newTask (Post normale) lascia i ritorni armati', async () => {
    armReturn('S1:righeFatturaList', 'new');
    await postAction('Post', {}, { 'descrizione.S1-21': 'x' }, 'S1');
    expect(armatoAllaFetch).toEqual(['new']);
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });

  it('postAction di navigazione con navpath (verso il dettaglio o il ritorno) li lascia armati', async () => {
    armReturn('S1:righeFatturaList', 'row');
    await postAction('Detail', { navpath: 'S1-0.7,S1-9.0,S1-21.3' }, undefined, 'S1');
    await postAction('Back', {}, undefined, 'S1');
    expect(armatoAllaFetch).toEqual(['row', 'row']);
    expect(armedReturn('S1:righeFatturaList')).toBe('row');
  });

  it.each([['0'], [''], ['true'], ['1 ']])('postAction con newTask=%j non e\' un ingresso di primo livello', async (v) => {
    armReturn('S1:righeFatturaList', 'new');
    await postAction('Post', { newTask: v }, undefined, 'S1');
    expect(armedReturn('S1:righeFatturaList')).toBe('new');
  });
});
