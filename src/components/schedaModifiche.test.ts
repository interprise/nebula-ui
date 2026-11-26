import { describe, it, expect } from 'vitest';
import type { ToolbarItem } from '../types/ui';
import { schedaConModifiche } from './schedaModifiche';

// Una scheda ha modifiche non salvate quando la toolbar che il server le ha
// mandato contiene il pulsante «Annulla» ABILITATO: CORE lo emette con handler
// doAction.createCallback('Cancel') e disabled = !session.isDirty().

const voce = (handler: string | undefined, disabled?: boolean, extra: Partial<ToolbarItem> = {}): ToolbarItem =>
  ({ id: `b${Math.random()}`, text: 'x', handler, ...(disabled === undefined ? {} : { disabled }), ...extra }) as ToolbarItem;

const ANNULLA = "doAction.createCallback('Cancel')";

/** La toolbar vera del server mescola pulsanti, stringhe e oggetti senza handler. */
const contorno = (): ToolbarItem[] =>
  [
    'pag:',
    { tag: 'input', value: '1' },
    { html: '<span>di 3</span>' },
    '-',
    voce("doAction.createCallback('Save')", false),
    voce("doAction.createCallback('Add')"),
  ] as unknown as ToolbarItem[];

describe('schedaConModifiche', () => {
  it('toolbar assente: niente modifiche', () => {
    expect(schedaConModifiche(undefined)).toBe(false);
  });

  it('toolbar vuota: niente modifiche', () => {
    expect(schedaConModifiche([])).toBe(false);
  });

  it("Annulla abilitato (disabled: false): ci sono modifiche", () => {
    expect(schedaConModifiche([voce(ANNULLA, false)])).toBe(true);
  });

  it('Annulla senza il campo disabled: ci sono modifiche', () => {
    expect(schedaConModifiche([voce(ANNULLA)])).toBe(true);
  });

  it('Annulla disabilitato: niente modifiche', () => {
    expect(schedaConModifiche([voce(ANNULLA, true)])).toBe(false);
  });

  it('Annulla abilitato in mezzo al contorno vero del server', () => {
    const tb = contorno();
    tb.splice(3, 0, voce(ANNULLA, false));
    expect(schedaConModifiche(tb)).toBe(true);
  });

  it('solo contorno, senza Annulla: niente modifiche', () => {
    expect(schedaConModifiche(contorno())).toBe(false);
  });

  it('Annulla disabilitato in mezzo ad altri pulsanti abilitati: niente modifiche', () => {
    expect(schedaConModifiche([...contorno(), voce(ANNULLA, true)])).toBe(false);
  });

  it('virgolette doppie', () => {
    expect(schedaConModifiche([voce('doAction.createCallback("Cancel")', false)])).toBe(true);
  });

  it('spazi dentro le parentesi', () => {
    expect(schedaConModifiche([voce("doAction.createCallback( 'Cancel' )", false)])).toBe(true);
  });

  it('spazi attorno alla callback', () => {
    expect(schedaConModifiche([voce("  doAction.createCallback('Cancel')  ", false)])).toBe(true);
  });

  it('spazio fra createCallback e la parentesi', () => {
    expect(schedaConModifiche([voce("doAction.createCallback ('Cancel')", false)])).toBe(true);
  });

  it.each([
    "doAction.createCallback('CancelRow')",
    "doAction.createCallback('CancelJob')",
    "doAction.createCallback('PostCancel')",
    'doAction.createCallback("CancelRow")',
    "doAction.createCallback( 'CancelJob' )",
  ])('azione diversa da Cancel (%s): niente modifiche', (h) => {
    expect(schedaConModifiche([voce(h, false)])).toBe(false);
  });

  it('pulsante senza handler: niente modifiche', () => {
    expect(schedaConModifiche([voce(undefined, false)])).toBe(false);
  });

  it('elementi non oggetto o vuoti non fanno saltare la funzione', () => {
    const tb = [null, undefined, 0, 42, true, 'pag:', "doAction.createCallback('Cancel')"] as unknown as ToolbarItem[];
    expect(() => schedaConModifiche(tb)).not.toThrow();
    expect(schedaConModifiche(tb)).toBe(false);
  });

  it('handler non stringa non fa saltare la funzione', () => {
    const tb = [{ id: 'a', text: 'a', handler: 12 }, { id: 'b', text: 'b', handler: { x: 1 } }] as unknown as ToolbarItem[];
    expect(() => schedaConModifiche(tb)).not.toThrow();
    expect(schedaConModifiche(tb)).toBe(false);
  });

  it('due Annulla, uno disabilitato e uno abilitato: ci sono modifiche', () => {
    expect(schedaConModifiche([voce(ANNULLA, true), voce(ANNULLA, false)])).toBe(true);
  });

  it('una stringa che contiene la callback non conta come pulsante', () => {
    expect(schedaConModifiche([ANNULLA] as unknown as ToolbarItem[])).toBe(false);
  });

  it('oggetti {tag} / {html} che citano Cancel nel testo non contano', () => {
    const tb = [{ tag: 'input', value: ANNULLA }, { html: ANNULLA }] as unknown as ToolbarItem[];
    expect(schedaConModifiche(tb)).toBe(false);
  });
});
