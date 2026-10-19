import { describe, it, expect } from 'vitest';
import { resolveHotkey } from './hotkeys';

// SXADV-5749: risoluzione pura di una pressione — quale registrazione parte
// (`best`) e se il tasto va comunque tolto al browser (`claimed`).

interface Reg {
  name: string;
  combo: string;
  priority: number;
  allowWhileTyping: boolean;
  allowRepeat: boolean;
  claim: boolean;
}
const reg = (name: string, combo: string, priority: number, o: Partial<Reg> = {}): Reg => ({
  name, combo, priority, allowWhileTyping: false, allowRepeat: false, claim: false, ...o,
});
const CTX = { overlay: false, typing: false, repeat: false };

describe('resolveHotkey — regole generali', () => {
  it('considera solo le registrazioni con la stessa combo', () => {
    const regs = [reg('a', 'F9', 50), reg('b', 'F5', 1)];
    expect(resolveHotkey(regs, 'F5', CTX).best?.name).toBe('b');
    expect(resolveHotkey(regs, 'F2', CTX)).toEqual({ best: null, claimed: false });
  });

  it('claim di una combo diversa non conta', () => {
    const regs = [reg('a', 'F9', 0, { claim: true })];
    expect(resolveHotkey(regs, 'F5', CTX).claimed).toBe(false);
  });

  it('vince la priorità più alta, a prescindere dall\'ordine', () => {
    const regs = [reg('low', 'F5', 1), reg('high', 'F5', 30), reg('mid', 'F5', 10)];
    expect(resolveHotkey(regs, 'F5', CTX).best?.name).toBe('high');
  });

  it('a parità di priorità vince la prima in ordine di iterazione', () => {
    const regs = [reg('first', 'F5', 10), reg('second', 'F5', 10)];
    expect(resolveHotkey(regs, 'F5', CTX).best?.name).toBe('first');
    expect(resolveHotkey(new Set(regs), 'F5', CTX).best?.name).toBe('first');
  });

  it('accetta qualunque iterabile (Set, generatore)', () => {
    function* gen() { yield reg('g', 'F5', 3); }
    expect(resolveHotkey(gen(), 'F5', CTX).best?.name).toBe('g');
  });

  it('con un overlay aperto best è sempre null, claimed resta calcolato', () => {
    const ctx = { ...CTX, overlay: true };
    const all = { allowWhileTyping: true, allowRepeat: true };
    expect(resolveHotkey([reg('a', 'F5', 99, all)], 'F5', ctx)).toEqual({ best: null, claimed: false });
    expect(resolveHotkey([reg('a', 'F5', 99, { ...all, claim: true })], 'F5', ctx)).toEqual({ best: null, claimed: true });
  });

  it('mentre si digita salta chi non ha allowWhileTyping', () => {
    const regs = [reg('hi', 'F5', 50), reg('lo', 'F5', 1, { allowWhileTyping: true })];
    expect(resolveHotkey(regs, 'F5', { ...CTX, typing: true }).best?.name).toBe('lo');
    expect(resolveHotkey([reg('hi', 'F5', 50)], 'F5', { ...CTX, typing: true }).best).toBeNull();
  });

  it('sull\'auto-ripetizione salta chi non ha allowRepeat', () => {
    const regs = [reg('hi', 'F5', 50), reg('lo', 'F5', 1, { allowRepeat: true })];
    expect(resolveHotkey(regs, 'F5', { ...CTX, repeat: true }).best?.name).toBe('lo');
    expect(resolveHotkey([reg('hi', 'F5', 50)], 'F5', { ...CTX, repeat: true }).best).toBeNull();
  });

  it('claimed è vero se una registrazione che combacia reclama, anche se esclusa dal contesto', () => {
    const regs = [reg('noop', 'F5', 0, { claim: true })]; // né typing né repeat ammessi
    for (const ctx of [CTX, { ...CTX, typing: true }, { ...CTX, repeat: true }, { ...CTX, overlay: true }]) {
      expect(resolveHotkey(regs, 'F5', ctx).claimed).toBe(true);
    }
    expect(resolveHotkey(regs, 'F5', { ...CTX, typing: true }).best).toBeNull();
  });

  it('claimed è falso se nessuna reclama, anche quando una parte', () => {
    const r = resolveHotkey([reg('a', 'F5', 10)], 'F5', CTX);
    expect(r.best?.name).toBe('a');
    expect(r.claimed).toBe(false);
  });

  it('restituisce l\'oggetto registrato stesso', () => {
    const a = reg('a', 'F5', 1);
    expect(resolveHotkey([a], 'F5', CTX).best).toBe(a);
  });
});

describe('resolveHotkey — F5 della toolbar (scenario SXADV-5749)', () => {
  const refresh = reg('ricarica', 'F5', 10, { allowWhileTyping: true });
  const noop = reg('noop', 'F5', 0, { allowWhileTyping: true, allowRepeat: true, claim: true });
  const withRefresh = [refresh, noop];
  const noopFirst = [noop, refresh];

  it('pressione normale → Ricarica dati', () => {
    expect(resolveHotkey(withRefresh, 'F5', CTX)).toEqual({ best: refresh, claimed: true });
    expect(resolveHotkey(noopFirst, 'F5', CTX).best).toBe(refresh);
  });

  it('pressione normale mentre si digita → ancora Ricarica dati', () => {
    expect(resolveHotkey(withRefresh, 'F5', { ...CTX, typing: true }).best).toBe(refresh);
  });

  it('auto-ripetizione → il no-op (non ricarica a raffica, non va al browser)', () => {
    expect(resolveHotkey(withRefresh, 'F5', { ...CTX, repeat: true })).toEqual({ best: noop, claimed: true });
  });

  it('overlay aperto → niente parte, ma il tasto resta sottratto al browser', () => {
    expect(resolveHotkey(withRefresh, 'F5', { ...CTX, overlay: true })).toEqual({ best: null, claimed: true });
  });

  it('pagina senza bottone Ricarica dati → il no-op', () => {
    expect(resolveHotkey([noop], 'F5', CTX)).toEqual({ best: noop, claimed: true });
  });

  it('nessuna registrazione (Home, niente toolbar) → il browser ricarica', () => {
    expect(resolveHotkey([], 'F5', CTX)).toEqual({ best: null, claimed: false });
  });

  it('le altre combo non sono toccate dal no-op di F5', () => {
    expect(resolveHotkey(withRefresh, 'Ctrl+F5', CTX)).toEqual({ best: null, claimed: false });
    expect(resolveHotkey(withRefresh, 'F1', CTX)).toEqual({ best: null, claimed: false });
  });
});
