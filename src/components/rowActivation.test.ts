import { describe, it, expect } from 'vitest';
import { oncePerEvent } from './rowActivation';

// SXADV-5920: un clic su una banda di continuazione arrivava sia a onRowClicked
// di AG Grid sia a handleGridClick del contenitore, e partivano due
// NavigateDetail: il secondo tornava "Sessione non valida".

describe('oncePerEvent', () => {
  it('lascia passare il primo gestore e ferma il secondo sullo stesso evento', () => {
    const first = oncePerEvent();
    const click = new Event('click');
    expect(first(click)).toBe(true);
    expect(first(click)).toBe(false);
  });

  it('un clic nuovo attiva di nuovo', () => {
    const first = oncePerEvent();
    expect(first(new Event('click'))).toBe(true);
    expect(first(new Event('click'))).toBe(true);
  });

  it('senza evento (tastiera, codice) attiva sempre', () => {
    const first = oncePerEvent();
    expect(first(undefined)).toBe(true);
    expect(first(undefined)).toBe(true);
  });

  it('ogni lista ha il suo cancello', () => {
    const a = oncePerEvent();
    const b = oncePerEvent();
    const click = new Event('click');
    expect(a(click)).toBe(true);
    expect(b(click)).toBe(true);
  });
});
