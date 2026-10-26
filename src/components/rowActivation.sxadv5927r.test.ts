import { describe, it, expect } from 'vitest';
import { addOpensDetail, detailOpensPage } from './rowActivation';

// SXADV-5927, contratto P1 — «Regola COME IL LEGACY» (Luca, 26/10 notte, dopo la
// prova a schermo sul legacy): sulle liste multiEdit + in linea + detail il
// legacy col «Nuovo» aggiunge SEMPRE il rigo in griglia, mai il dettaglio. CORE
// resta com'era (AddCommand: !isInlineEdited() -> pagina).
//
// `addOpensDetail` dice se il «Nuovo» della lista apre una pagina di dettaglio a
// se' (e quindi va armato il ritorno 'new'):
//   non listEdit -> true;  listEdit -> inlineEdit === false && hasDetailView.
// multiEdit non conta piu' (non e' nemmeno un parametro).

type Lista = Parameters<typeof addOpensDetail>[0];

describe('addOpensDetail — P1', () => {
  it('lista non listEdit: il Nuovo apre il dettaglio (come oggi)', () => {
    expect(addOpensDetail({ isListEdit: false })).toBe(true);
  });

  it('listEdit con inlineEdit=false e vista di dettaglio (Voci): apre il dettaglio', () => {
    expect(addOpensDetail({ isListEdit: true, inlineEdit: false, hasDetailView: true })).toBe(true);
  });

  it('listEdit in linea con vista di dettaglio (Righe fattura FP, sequenzeList): si aggiunge nel pannello', () => {
    expect(addOpensDetail({ isListEdit: true, inlineEdit: true, hasDetailView: true })).toBe(false);
  });

  it('listEdit con inlineEdit=false ma senza vista di dettaglio: non c\'e\' dove andare', () => {
    expect(addOpensDetail({ isListEdit: true, inlineEdit: false, hasDetailView: false })).toBe(false);
    expect(addOpensDetail({ isListEdit: true, inlineEdit: false })).toBe(false);
  });

  it('listEdit con inlineEdit assente o null: default CORE per listEdit = in linea', () => {
    expect(addOpensDetail({ isListEdit: true, hasDetailView: true })).toBe(false);
    expect(addOpensDetail({ isListEdit: true, inlineEdit: undefined, hasDetailView: true })).toBe(false);
    expect(addOpensDetail({ isListEdit: true, inlineEdit: null as unknown as boolean, hasDetailView: true })).toBe(false);
  });

  it('lista non listEdit: inlineEdit e hasDetailView non contano', () => {
    for (const inlineEdit of [undefined, true, false])
      for (const hasDetailView of [undefined, true, false]) {
        const c: Lista = { isListEdit: false, inlineEdit, hasDetailView };
        expect(addOpensDetail(c), JSON.stringify(c)).toBe(true);
      }
  });

  it('la tabella completa, sempre un booleano', () => {
    for (const isListEdit of [true, false])
      for (const inlineEdit of [undefined, true, false])
        for (const hasDetailView of [undefined, true, false]) {
          const c = { isListEdit, inlineEdit, hasDetailView };
          const atteso = !isListEdit || (inlineEdit === false && hasDetailView === true);
          const r = addOpensDetail(c);
          expect(typeof r, JSON.stringify(c)).toBe('boolean');
          expect(r, JSON.stringify(c)).toBe(atteso);
        }
  });

  it('non tocca l\'oggetto che riceve', () => {
    const c = Object.freeze({ isListEdit: true, inlineEdit: false, hasDetailView: true });
    expect(() => addOpensDetail(c)).not.toThrow();
    expect(c).toEqual({ isListEdit: true, inlineEdit: false, hasDetailView: true });
  });
});

// ─── P6 (contratto del 26/10): detailOpensPage ───────────────────────────────
//
// Il «>» (o il clic che naviga) apre davvero una pagina solo se CORE
// (NavigateDetailCommand) la apre: lista non listEdit sempre; listEdit solo con
// inlineEdit === false o multiEdit. Su un micro-detail puro (listEdit, in
// linea, non multiEdit) il «>» resta sulla pagina: armare il ritorno 'row'
// lascerebbe in giro un ritorno che ruba il fuoco al giro dopo.


type ListaP6 = Parameters<typeof detailOpensPage>[0];

describe('detailOpensPage — P6', () => {
  it('lista non listEdit: apre una pagina, qualunque siano multiEdit e inlineEdit', () => {
    for (const isMultiEdit of [true, false])
      for (const inlineEdit of [undefined, true, false]) {
        const c = { isListEdit: false, isMultiEdit, inlineEdit };
        expect(detailOpensPage(c), JSON.stringify(c)).toBe(true);
      }
  });

  it('listEdit con inlineEdit=false (vociClassificazioneArtList): apre una pagina', () => {
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: false })).toBe(true);
  });

  it('listEdit multiEdit (docRigheForList, in linea): il «>» naviga', () => {
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: true, inlineEdit: true })).toBe(true);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: true })).toBe(true);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: true, inlineEdit: false })).toBe(true);
  });

  it('micro-detail puro (listEdit, in linea, non multiEdit): nessuna pagina', () => {
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: true })).toBe(false);
  });

  it('listEdit non multiEdit con inlineEdit assente o null = in linea: nessuna pagina', () => {
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false })).toBe(false);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: undefined })).toBe(false);
    const nullo = { isListEdit: true, isMultiEdit: false, inlineEdit: null as unknown as boolean };
    expect(detailOpensPage(nullo)).toBe(false);
  });

  it('la tabella completa, e sempre un booleano', () => {
    for (const isListEdit of [true, false])
      for (const isMultiEdit of [true, false])
        for (const inlineEdit of [undefined, true, false]) {
          const c: ListaP6 = { isListEdit, isMultiEdit, inlineEdit };
          const atteso = !isListEdit || inlineEdit === false || isMultiEdit;
          const r = detailOpensPage(c);
          expect(typeof r, JSON.stringify(c)).toBe('boolean');
          expect(r, JSON.stringify(c)).toBe(atteso);
        }
  });

  it('dove il «Nuovo» apre il dettaglio (addOpensDetail), anche il «>» apre una pagina', () => {
    for (const isListEdit of [true, false])
      for (const isMultiEdit of [true, false])
        for (const inlineEdit of [undefined, true, false])
          for (const hasDetailView of [true, false]) {
            if (!addOpensDetail({ isListEdit, inlineEdit, hasDetailView })) continue;
            const c = { isListEdit, isMultiEdit, inlineEdit };
            expect(detailOpensPage(c), JSON.stringify(c)).toBe(true);
          }
  });

  it('micro-detail vero (in linea, non multiEdit, con detail view): ne\' Nuovo ne\' «>» aprono una pagina', () => {
    expect(addOpensDetail({ isListEdit: true, inlineEdit: true, hasDetailView: true })).toBe(false);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: false, inlineEdit: true })).toBe(false);
  });

  it('multiEdit in linea con detail view (Righe fattura FP): il Nuovo resta nel pannello, il «>» apre la pagina', () => {
    // Come il legacy: Nuovo in griglia, ma la freccia del selettore naviga.
    expect(addOpensDetail({ isListEdit: true, inlineEdit: true, hasDetailView: true })).toBe(false);
    expect(detailOpensPage({ isListEdit: true, isMultiEdit: true, inlineEdit: true })).toBe(true);
  });
});
