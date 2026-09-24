import { describe, it, expect, vi } from 'vitest';
import { selectAllOnMouseFocus } from './helpers';

// SXADV-5932: nei campi numerici/importo il clic che PORTA il fuoco nel campo
// deve selezionare tutto il contenuto (come il TAB), cosi' si riscrive subito;
// un secondo clic, a fuoco gia' dentro, posiziona il cursore normalmente.
//
// Niente DOM: l'involucro, il riquadro e l'input sono oggetti semplici che
// registrano l'ordine delle chiamate.

type Evento = Parameters<typeof selectAllOnMouseFocus>[0];

interface Scena {
  log: string[];
  input: HTMLInputElement;
  box: { contains: (n: unknown) => boolean };
  dentro: object; // un nodo figlio del riquadro (es. lo span interno di antd)
  fuori: object; // un nodo nell'involucro ma fuori dal riquadro (il simbolo "€")
  evento: (over?: Partial<Evento>) => Evento & { preventDefault: ReturnType<typeof vi.fn> };
  querySelector: ReturnType<typeof vi.fn>;
}

function scena(opts: {
  disabled?: boolean;
  readOnly?: boolean;
  attivo?: boolean; // l'input e' gia' l'elemento attivo
  altroAttivo?: object; // un altro elemento ha il fuoco
  senzaRiquadro?: boolean; // parentElement null
  senzaInput?: boolean;
} = {}): Scena {
  const log: string[] = [];
  const dentro = { nome: 'span-interno' };
  const fuori = { nome: 'simbolo-euro' };
  const doc: { activeElement: unknown } = { activeElement: opts.altroAttivo ?? null };

  // eslint-disable-next-line prefer-const
  let input: Record<string, unknown>;
  const box = {
    contains: vi.fn((n: unknown) => n === box || n === input || n === dentro),
  };
  input = {
    disabled: !!opts.disabled,
    readOnly: !!opts.readOnly,
    ownerDocument: doc,
    parentElement: opts.senzaRiquadro ? null : box,
    focus: vi.fn(() => {
      log.push('focus');
      doc.activeElement = input;
    }),
    select: vi.fn(() => log.push('select')),
  };
  if (opts.attivo) doc.activeElement = input;

  const querySelector = vi.fn((sel: string) =>
    opts.senzaInput ? null : sel === 'input' ? (input as unknown as HTMLInputElement) : null,
  );

  const evento = (over: Partial<Evento> = {}) => {
    const preventDefault = vi.fn(() => log.push('preventDefault'));
    return {
      button: 0,
      target: input as unknown as EventTarget,
      currentTarget: { querySelector },
      preventDefault,
      ...over,
    } as Evento & { preventDefault: ReturnType<typeof vi.fn> };
  };

  return {
    log,
    input: input as unknown as HTMLInputElement,
    box,
    dentro,
    fuori,
    evento,
    querySelector,
  };
}

function nienteFatto(s: Scena, e: { preventDefault: ReturnType<typeof vi.fn> }) {
  expect(e.preventDefault).not.toHaveBeenCalled();
  expect(s.input.focus).not.toHaveBeenCalled();
  expect(s.input.select).not.toHaveBeenCalled();
  expect(s.log).toEqual([]);
}

describe('selectAllOnMouseFocus (SXADV-5932)', () => {
  describe('il clic che porta il fuoco seleziona tutto', () => {
    it("clic sinistro sull'input non attivo: preventDefault, focus, select in quest'ordine", () => {
      const s = scena();
      const e = s.evento();
      selectAllOnMouseFocus(e);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(s.input.focus).toHaveBeenCalledTimes(1);
      expect(s.input.select).toHaveBeenCalledTimes(1);
    });

    it("l'input si cerca nell'involucro con querySelector('input')", () => {
      const s = scena();
      selectAllOnMouseFocus(s.evento());
      expect(s.querySelector).toHaveBeenCalledWith('input');
    });

    it('clic su un nodo interno al riquadro (non l\'input stesso): seleziona tutto', () => {
      const s = scena();
      const e = s.evento({ target: s.dentro as unknown as EventTarget });
      selectAllOnMouseFocus(e);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
    });

    it('clic sul riquadro stesso (bordo/padding del campo): seleziona tutto', () => {
      const s = scena();
      const e = s.evento({ target: s.box as unknown as EventTarget });
      selectAllOnMouseFocus(e);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
    });

    it('il fuoco sta in un ALTRO campo: il clic lo porta qui e seleziona tutto', () => {
      const s = scena({ altroAttivo: { nome: 'altro-campo' } });
      const e = s.evento();
      selectAllOnMouseFocus(e);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
    });

    it('la select arriva DOPO la focus (una select prima del fuoco verrebbe persa)', () => {
      const s = scena();
      selectAllOnMouseFocus(s.evento());
      const focusOrd = (s.input.focus as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const selectOrd = (s.input.select as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(focusOrd).toBeLessThan(selectOrd);
    });
  });

  describe('secondo clic: il cursore lo mette il browser', () => {
    it("input gia' attivo: niente preventDefault, niente focus, niente select", () => {
      const s = scena({ attivo: true });
      const e = s.evento();
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('primo clic seleziona, il secondo sullo stesso campo non fa niente', () => {
      const s = scena();
      const e1 = s.evento();
      selectAllOnMouseFocus(e1);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
      // dopo la focus l'input e' l'elemento attivo
      const e2 = s.evento();
      selectAllOnMouseFocus(e2);
      expect(e2.preventDefault).not.toHaveBeenCalled();
      expect(s.input.focus).toHaveBeenCalledTimes(1);
      expect(s.input.select).toHaveBeenCalledTimes(1);
      expect(s.log).toEqual(['preventDefault', 'focus', 'select']);
    });
  });

  describe('tasti diversi dal sinistro', () => {
    it.each([
      [1, 'centrale'],
      [2, 'destro (menu contestuale)'],
      [3, 'indietro'],
      [4, 'avanti'],
    ])('button=%i (%s): non fa niente', (button) => {
      const s = scena();
      const e = s.evento({ button });
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });
  });

  describe('campo non modificabile', () => {
    it('input disabled: non fa niente', () => {
      const s = scena({ disabled: true });
      const e = s.evento();
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('input readOnly: non fa niente', () => {
      const s = scena({ readOnly: true });
      const e = s.evento();
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('disabled e readOnly insieme: non fa niente', () => {
      const s = scena({ disabled: true, readOnly: true });
      const e = s.evento();
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });
  });

  describe("involucro senza input", () => {
    it('querySelector torna null: non fa niente e non lancia', () => {
      const s = scena({ senzaInput: true });
      const e = s.evento({ target: s.dentro as unknown as EventTarget });
      expect(() => selectAllOnMouseFocus(e)).not.toThrow();
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(s.log).toEqual([]);
    });
  });

  describe('clic fuori dal riquadro del campo', () => {
    it('target = simbolo "€" nell\'involucro ma fuori dal riquadro: non fa niente', () => {
      const s = scena();
      const e = s.evento({ target: s.fuori as unknown as EventTarget });
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('target null: non fa niente e non lancia', () => {
      const s = scena();
      const e = s.evento({ target: null });
      expect(() => selectAllOnMouseFocus(e)).not.toThrow();
      nienteFatto(s, e);
    });

    it('il controllo di appartenenza si fa sul riquadro (parentElement), non sull\'input', () => {
      const s = scena();
      selectAllOnMouseFocus(s.evento({ target: s.dentro as unknown as EventTarget }));
      expect(s.box.contains).toHaveBeenCalledWith(s.dentro);
    });
  });

  describe('input senza riquadro', () => {
    it('parentElement null: non lancia e non fa niente', () => {
      const s = scena({ senzaRiquadro: true });
      const e = s.evento();
      expect(() => selectAllOnMouseFocus(e)).not.toThrow();
      nienteFatto(s, e);
    });
  });

  describe('i controlli non cortocircuitano male', () => {
    it("tasto destro su input gia' attivo: non fa niente", () => {
      const s = scena({ attivo: true });
      const e = s.evento({ button: 2 });
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('readOnly con target fuori dal riquadro: non fa niente', () => {
      const s = scena({ readOnly: true });
      const e = s.evento({ target: s.fuori as unknown as EventTarget });
      selectAllOnMouseFocus(e);
      nienteFatto(s, e);
    });

    it('la funzione non restituisce nulla', () => {
      const s = scena();
      expect(selectAllOnMouseFocus(s.evento())).toBeUndefined();
    });
  });
});
