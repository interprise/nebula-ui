import { describe, it, expect } from 'vitest';
import { solvePromptBand, type LeadingPrompt } from './promptBand';

// SXADV-5969.3: la banda delle etichette sono le colonne iniziali che TUTTE le
// etichette di inizio riga condividono (la colspan PIU' PICCOLA), non la piu'
// larga. Un'etichetta piu' larga della banda si prende le colonne in piu' dal
// contenuto, e la banda deve bastare a cio' che quelle colonne non coprono.
//
// La promessa che si controlla ovunque: con la banda restituita e la colonna
// di contenuto che ne deriva, OGNI etichetta sta su una riga.

/** Spazio che un'etichetta ha davvero con la banda data. */
function spazio(p: LeadingPrompt, cols: number, bandWidth: number, contentCol: number): number {
  return bandWidth + (p.span - cols) * contentCol;
}

function ciStannoTutte(
  prompts: LeadingPrompt[],
  band: { cols: number; width: number },
  contentCol: number,
): void {
  for (const p of prompts) {
    // 1px di tolleranza per l'arrotondamento.
    expect(spazio(p, band.cols, band.width, contentCol) + 1).toBeGreaterThanOrEqual(p.width);
  }
}

const costante = (c: number) => () => c;

describe('solvePromptBand: casi di base', () => {
  it('nessuna etichetta: banda vuota', () => {
    expect(solvePromptBand([], costante(50), 20)).toEqual({ cols: 0, width: 0 });
  });

  it('una sola etichetta: la banda e\' la sua colspan e la sua larghezza', () => {
    expect(solvePromptBand([{ span: 3, width: 120 }], costante(50), 20)).toEqual({ cols: 3, width: 120 });
  });

  it('le colonne della banda sono la colspan PIU\' PICCOLA, non la piu\' larga', () => {
    const prompts = [
      { span: 4, width: 100 },
      { span: 7, width: 150 },
      { span: 5, width: 110 },
    ];
    expect(solvePromptBand(prompts, costante(50), 20).cols).toBe(4);
  });

  it('un\'etichetta vuota (larghezza 0) conta per le colonne ma non pretende niente', () => {
    const prompts = [
      { span: 2, width: 0 },
      { span: 4, width: 90 },
    ];
    const band = solvePromptBand(prompts, costante(50), 20);
    expect(band.cols).toBe(2);
    // L'etichetta da 4 colonne ha 2 colonne di contenuto (100px): basta da
    // sola, la banda non deve allargarsi per lei.
    expect(band.width).toBe(0);
  });

  it('solo etichette vuote: banda di larghezza zero', () => {
    const band = solvePromptBand([{ span: 3, width: 0 }, { span: 5, width: 0 }], costante(50), 20);
    expect(band).toEqual({ cols: 3, width: 0 });
  });

  it('la larghezza e\' un intero (arrotondata per eccesso)', () => {
    const band = solvePromptBand([{ span: 3, width: 100.2 }], costante(50), 20);
    expect(Number.isInteger(band.width)).toBe(true);
    expect(band.width).toBe(101);
  });
});

describe('solvePromptBand: l\'etichetta larga', () => {
  it('se le colonne di contenuto le bastano, la banda resta quella delle etichette corte', () => {
    const prompts = [
      { span: 4, width: 163 },
      { span: 4, width: 150 },
      { span: 7, width: 285 },
    ];
    // 163 + 3*80 = 403 >= 285: l'etichetta larga ci sta gia'.
    const band = solvePromptBand(prompts, costante(80), 20);
    expect(band).toEqual({ cols: 4, width: 163 });
    ciStannoTutte(prompts, band, 80);
  });

  it('se le colonne di contenuto non bastano, la banda cresce quanto serve e non di piu\'', () => {
    const prompts = [
      { span: 2, width: 60 },
      { span: 4, width: 300 },
    ];
    // Contenuto fisso a 50: all'etichetta larga mancano 300 - 2*50 = 200px.
    const band = solvePromptBand(prompts, costante(50), 20);
    expect(band.cols).toBe(2);
    expect(band.width).toBe(200);
    ciStannoTutte(prompts, band, 50);
  });

  it('contenuto che cala mentre la banda cresce: ogni etichetta ci sta col contenuto risultante', () => {
    const host = 1000;
    const totale = 20;
    const colFor = (bw: number) => (host - bw) / (totale - 2);
    const prompts = [
      { span: 2, width: 80 },
      { span: 3, width: 70 },
      { span: 6, width: 400 },
    ];
    const band = solvePromptBand(prompts, colFor, 10);
    expect(band.cols).toBe(2);
    expect(Number.isInteger(band.width)).toBe(true);
    ciStannoTutte(prompts, band, colFor(band.width));
  });

  it('iterazioni che convergono: ci stanno col contenuto risultante', () => {
    const minCol = 5;
    const colFor = (bw: number) => Math.max(minCol, 100 - 3 * bw);
    const prompts = [
      { span: 1, width: 10 },
      { span: 10, width: 500 },
    ];
    const band = solvePromptBand(prompts, colFor, minCol);
    expect(band.cols).toBe(1);
    expect(Number.isInteger(band.width)).toBe(true);
    ciStannoTutte(prompts, band, colFor(band.width));
  });

  it('funzione che non converge: si ripiega sul limite col pavimento del contenuto', () => {
    // Ogni pixel di banda ne toglie uno alla colonna di contenuto: a ogni giro
    // all'etichetta larga manca sempre lo stesso tanto, e le iterazioni non si
    // fermano prima del loro tetto.
    const minCol = 5;
    let chiamate = 0;
    const colFor = (bw: number) => { chiamate++; return Math.max(minCol, 1900 - bw); };
    const prompts = [
      { span: 1, width: 10 },
      { span: 2, width: 2000 },
    ];
    const band = solvePromptBand(prompts, colFor, minCol);
    expect(chiamate).toBeGreaterThan(1);
    expect(band.cols).toBe(1);
    expect(Number.isInteger(band.width)).toBe(true);
    // Anche col contenuto sceso al pavimento, ogni etichetta ci sta.
    ciStannoTutte(prompts, band, minCol);
    ciStannoTutte(prompts, band, colFor(band.width));
  });

  it('contenuto che scende sotto zero: nessuna eccezione, nessun NaN, e ci stanno comunque', () => {
    const colFor = (bw: number) => 50 - bw;
    const prompts = [
      { span: 1, width: 20 },
      { span: 5, width: 300 },
    ];
    const band = solvePromptBand(prompts, colFor, 0);
    expect(Number.isFinite(band.width)).toBe(true);
    ciStannoTutte(prompts, band, 0);
  });
});

describe('solvePromptBand: Tessere - Interrogazione (SXADV-5969.3)', () => {
  // 21 colonne del server; quasi tutte le etichette occupano 4 colonne e
  // chiedono ~163px, "Ultima Rata Pagata" ne occupa 7 e chiede ~285px.
  const HOST = 1574;
  const TOTALE = 21;
  const GUTTER = 2;
  const colFor = (bw: number) => (HOST - bw - GUTTER) / (TOTALE - 4);
  const prompts: LeadingPrompt[] = [
    { span: 4, width: 163 }, // Iscritto
    { span: 4, width: 120 }, // Anno
    { span: 4, width: 158 }, // Data Iscrizione da
    { span: 4, width: 140 }, // Categoria
    { span: 7, width: 285 }, // Ultima Rata Pagata
  ];

  it('la banda e\' di 4 colonne: dalla 5a comincia il campo anche nelle righe corte', () => {
    expect(solvePromptBand(prompts, colFor, 19).cols).toBe(4);
  });

  it('la banda basta alle etichette da 4 colonne e non si allarga per "Ultima Rata Pagata"', () => {
    const band = solvePromptBand(prompts, colFor, 19);
    // Contenuto ~83px: 163 + 3*83 >> 285, l'etichetta larga ci sta gia'.
    expect(band.width).toBe(163);
    ciStannoTutte(prompts, band, colFor(band.width));
  });

  it('su uno schermo stretto la banda cresce quel che serve a "Ultima Rata Pagata"', () => {
    const stretto = (bw: number) => (500 - bw - GUTTER) / (TOTALE - 4);
    const band = solvePromptBand(prompts, stretto, 19);
    expect(band.cols).toBe(4);
    ciStannoTutte(prompts, band, stretto(band.width));
  });
});
