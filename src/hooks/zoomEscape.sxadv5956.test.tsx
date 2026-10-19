import { describe, it, expect } from 'vitest';
import * as uiMode from './uiMode';
import { isTypingTarget } from './hotkeys';

// SXADV-5956 — sezione ingrandita (zoom d'AREA, PANEL_ZOOM_ID) col fuoco in un
// campo di testo: Esc non faceva niente, mentre il tooltip promette
// "Riduce sezione (Esc)". La correzione fa partire l'uscita anche mentre si
// digita, tranne dove Esc appartiene a qualcun altro: l'editor di cella AG
// Grid (annulla la modifica) e la composizione IME (chiude il suggeritore).
//
// Qui si prova la parte pura, `sectionZoomEscapeApplies`. Il percorso completo
// (pulsante "Ingrandisce sezione" → Esc → testata di nuovo a schermo) sta in
// src/components/sectionZoomEscape.sxadv5956.test.tsx.
//
// Niente DOM nei test del progetto: gli elementi sono finti, con il minimo che
// le guardie leggono (tagName, isContentEditable, closest).

type Fake = { tagName: string; isContentEditable: boolean; closest: (sel: string) => unknown };

/** Elemento finto; `dentro` = selettori degli antenati (o di se stesso). */
function elemento(tagName: string, dentro: string[] = [], editabile = false): Fake {
  return {
    tagName,
    isContentEditable: editabile,
    closest: (sel: string) =>
      sel.split(',').map((s) => s.trim()).some((s) => dentro.includes(s)) ? {} : null,
  };
}

const applica = (target: unknown, isComposing?: boolean) =>
  uiMode.sectionZoomEscapeApplies({ target: target as EventTarget | null, isComposing });

describe('sectionZoomEscapeApplies (SXADV-5956)', () => {
  it('è esportata da uiMode.ts', () => {
    expect(typeof uiMode.sectionZoomEscapeApplies).toBe('function');
  });

  it('vale in un <input> di testo: è proprio il caso del ticket', () => {
    expect(applica(elemento('INPUT'))).toBe(true);
  });

  it('vale in una <textarea>', () => {
    expect(applica(elemento('TEXTAREA'))).toBe(true);
  });

  it('vale in un campo contentEditable (editor di testo ricco)', () => {
    expect(applica(elemento('DIV', [], true))).toBe(true);
  });

  it('vale su un bottone e su una riga di griglia (fuoco non di digitazione)', () => {
    expect(applica(elemento('BUTTON'))).toBe(true);
    expect(applica(elemento('DIV', ['.ag-row']))).toBe(true);
  });

  it('vale con target null', () => {
    expect(applica(null)).toBe(true);
  });

  it('non vale dentro l\'editor di cella in linea di AG Grid: Esc annulla la modifica', () => {
    expect(applica(elemento('INPUT', ['.ag-cell-inline-editing']))).toBe(false);
    // anche su un nodo non input annidato nell'editor (es. il contenitore)
    expect(applica(elemento('DIV', ['.ag-cell-inline-editing']))).toBe(false);
  });

  it('non vale dentro l\'editor a popup di AG Grid', () => {
    expect(applica(elemento('TEXTAREA', ['.ag-popup-editor']))).toBe(false);
  });

  it('non vale durante una composizione IME, in qualunque campo', () => {
    expect(applica(elemento('INPUT'), true)).toBe(false);
    expect(applica(elemento('BUTTON'), true)).toBe(false);
    expect(applica(null, true)).toBe(false);
  });

  it('isComposing assente o false = nessuna composizione', () => {
    expect(applica(elemento('INPUT'), false)).toBe(true);
    expect(applica(elemento('INPUT'), undefined)).toBe(true);
  });
});

describe('guardia di digitazione del dispatcher (non regredisce)', () => {
  // Il dispatcher continua a considerare "digitazione" input e textarea: è
  // per questo che lo zoom d'area deve dichiararsi allowWhileTyping, e che lo
  // zoom griglia — che non lo dichiara — resta con la guardia.
  it('input, textarea e editor di cella restano bersagli di digitazione', () => {
    expect(isTypingTarget(elemento('INPUT') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(elemento('TEXTAREA') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(elemento('DIV', ['.ag-cell-inline-editing']) as unknown as EventTarget)).toBe(true);
  });

  it('bottone e riga di griglia non lo sono', () => {
    expect(isTypingTarget(elemento('BUTTON') as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(elemento('DIV', ['.ag-row']) as unknown as EventTarget)).toBe(false);
  });
});
