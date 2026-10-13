import { describe, it, expect } from 'vitest';
import type { UITree } from '../types/ui';
import { paneDetail, paneReentersEdit } from './treeDetailRouting';

// SXADV-6052.0/.2: albero+dettaglio (Anagrafiche > Tabelle > Categorie
// Statistiche > tab Figlie > Nuovo). La risposta instradata nel pannello di
// destra viaggia dentro la UI della scheda albero come `_detailResponse`. Dopo
// un Add/Salva+ andato a buon fine il pannello NON deve rinavigare con un
// LocateAndNavigate (ridisegno doppio, view state nuovi, currField orfano):
// lo dice `_detailKeepsEdit: true`, presente solo in quel caso. Ogni altra
// risposta (il Salva in testa) rientra in modifica come prima.

function ui(p: Record<string, unknown>): UITree {
  return p as unknown as UITree;
}

const treeTab = ui({
  viewName: 'anagraficheStatisticheTree',
  viewType: 'tree',
  navigateView: 'anagraficheStatisticheDetail',
});
const detailResp = ui({ viewName: 'anagraficheStatisticheDetail', viewType: 'detail', currField: 'codiceStatistico.S1-4.1' });

describe('paneDetail: la scheda albero col dettaglio allegato', () => {
  it('keepsEdit true: tutte le chiavi della scheda + _detailResponse + _detailKeepsEdit true', () => {
    const r = paneDetail(treeTab, detailResp, true) as unknown as Record<string, unknown>;
    expect(r).toEqual({ ...treeTab, _detailResponse: detailResp, _detailKeepsEdit: true });
  });

  it('il dettaglio allegato e\' lo stesso oggetto, non una copia', () => {
    const r = paneDetail(treeTab, detailResp, true) as unknown as Record<string, unknown>;
    expect(r._detailResponse).toBe(detailResp);
  });

  it('keepsEdit false: _detailKeepsEdit assente (non false, non undefined come chiave)', () => {
    const r = paneDetail(treeTab, detailResp, false) as unknown as Record<string, unknown>;
    expect(r).toEqual({ ...treeTab, _detailResponse: detailResp });
    expect('_detailKeepsEdit' in r).toBe(false);
    expect(Object.keys(r)).not.toContain('_detailKeepsEdit');
  });

  it('restituisce un oggetto nuovo: la scheda di partenza non e\' toccata', () => {
    const tree = ui({ ...treeTab });
    const prima = JSON.stringify(tree);
    const r = paneDetail(tree, detailResp, true);
    expect(r).not.toBe(tree);
    expect(JSON.stringify(tree)).toBe(prima);
    expect('_detailResponse' in (tree as unknown as object)).toBe(false);
    expect('_detailKeepsEdit' in (tree as unknown as object)).toBe(false);
  });

  it('il dettaglio non e\' toccato', () => {
    const det = ui({ viewName: 'anagraficheStatisticheDetail', viewType: 'detail' });
    const prima = JSON.stringify(det);
    paneDetail(treeTab, det, true);
    paneDetail(treeTab, det, false);
    expect(JSON.stringify(det)).toBe(prima);
  });

  it('una scheda che portava gia\' _detailKeepsEdit (risposta precedente) lo perde se keepsEdit e\' false', () => {
    // La UI della scheda puo' essere quella col dettaglio di un Nuovo prima:
    // il flag non deve sopravvivere a una risposta successiva (es. il Salva),
    // altrimenti quella non rientra in modifica.
    const vecchia = ui({ ...treeTab, _detailResponse: detailResp, _detailKeepsEdit: true });
    const nuovoDet = ui({ viewName: 'anagraficheStatisticheDetail', viewType: 'detail' });
    const r = paneDetail(vecchia, nuovoDet, false) as unknown as Record<string, unknown>;
    expect(r._detailResponse).toBe(nuovoDet);
    expect('_detailKeepsEdit' in r).toBe(false);
    expect(paneReentersEdit(r as unknown as UITree)).toBe(true);
  });
});

describe('paneReentersEdit: il pannello rientra in modifica salvo _detailKeepsEdit === true', () => {
  it('ui senza flag -> true (Salva e ogni altra risposta come prima)', () => {
    expect(paneReentersEdit(paneDetail(treeTab, detailResp, false))).toBe(true);
    expect(paneReentersEdit(ui({ ...treeTab, _detailResponse: detailResp }))).toBe(true);
  });

  it('_detailKeepsEdit false -> true', () => {
    expect(paneReentersEdit(ui({ ...treeTab, _detailResponse: detailResp, _detailKeepsEdit: false }))).toBe(true);
  });

  it('_detailKeepsEdit true -> false (Nuovo di riga: niente LocateAndNavigate)', () => {
    expect(paneReentersEdit(paneDetail(treeTab, detailResp, true))).toBe(false);
    expect(paneReentersEdit(ui({ ...treeTab, _detailResponse: detailResp, _detailKeepsEdit: true }))).toBe(false);
  });

  it.each([
    ['stringa "true"', 'true'],
    ['numero 1', 1],
    ['oggetto', {}],
    ['null', null],
  ])('_detailKeepsEdit non booleano (%s) -> true: solo === true lo spegne', (_nome, valore) => {
    expect(paneReentersEdit(ui({ ...treeTab, _detailResponse: detailResp, _detailKeepsEdit: valore }))).toBe(true);
  });
});
