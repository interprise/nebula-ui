import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl } from '../../types/ui';

// SXADV-5989 — il combo con elenco remoto (lookup) deve consegnare a Shell,
// insieme al codice scelto, la DIDASCALIA: tornando sulla scheda il campo si
// rimonta da control.value + displayText, e senza didascalia mostrerebbe il
// codice (o, peggio, la didascalia del valore di prima).
// Contratto: onChange(name, value, displayText?) — terzo argomento opzionale.
//
// Niente DOM: il Select di antd e' sostituito da un finto che si annota le
// props, e il gestore onChange che ComboControl gli passa si chiama a mano.

const captured: Array<Record<string, unknown>> = [];
vi.mock('antd', async (importOriginal) => {
  const real = await importOriginal<typeof import('antd')>();
  const Select = (props: Record<string, unknown>) => {
    captured.push(props);
    return null;
  };
  return { ...real, Select };
});

// Per l'Esc serve una scelta locale DIVERSA dal valore del server (l'undo
// scatta solo allora), e senza DOM lo stato locale non si cambia: si forza il
// valore iniziale di useSyncedState. Spento (`active: false`) e' quello vero.
const forced: { active: boolean; value: unknown } = { active: false, value: undefined };
vi.mock('../helpers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../helpers')>();
  return {
    ...real,
    useSyncedState: <T,>(v: T) => {
      const [local, set] = real.useSyncedState(v);
      return [forced.active ? (forced.value as T) : local, set] as [T, (x: T) => void];
    },
  };
});

const { default: ComboControl } = await import('./ComboControl');

const NAME = 'cliente.S1-0';

function renderRemote(control: Partial<UIControl>, onChange: (...args: unknown[]) => void) {
  captured.length = 0;
  const c = {
    type: 'combo', name: NAME, id: 'cliente', editable: true, remote: true, controlName: 'cliente',
    navpath: 'S1-0', ...control,
  } as UIControl;
  renderToStaticMarkup(<ComboControl control={c} pageType={2} onAction={() => {}} onChange={onChange as never} />);
  const props = captured.at(-1);
  if (!props) throw new Error('il Select non e\' stato reso');
  return props;
}

beforeEach(() => {
  captured.length = 0;
  forced.active = false;
  forced.value = undefined;
});

function esc(props: Record<string, unknown>) {
  (props.onKeyDown as (e: unknown) => void)({
    key: 'Escape', code: 'Escape', ctrlKey: false, shiftKey: false,
    preventDefault: () => {}, stopPropagation: () => {}, target: { value: '' },
  });
}

describe('ComboControl remoto: la didascalia arriva a Shell (SXADV-5989)', () => {
  it('scelta di una voce: onChange(name, codice, didascalia)', () => {
    const onChange = vi.fn();
    const props = renderRemote({ value: 'C01', displayText: 'ROSSI MARIO' }, onChange);
    // La voce scelta e' fra le opzioni che il controllo conosce (quella del
    // server): la sua didascalia e' 'ROSSI MARIO'. Si passa anche l'opzione
    // come fa antd.
    (props.onChange as (v: unknown, o: unknown) => void)('C01', { value: 'C01', label: 'ROSSI MARIO' });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)!;
    expect(last[0]).toBe(NAME);
    expect(last[1]).toBe('C01');
    expect(last[2]).toBe('ROSSI MARIO');
  });

  it('svuotato: didascalia vuota, cosi\' al ritorno non ricompare quella di prima', () => {
    // Col valore vuoto e il displayText del server rimasto, RemoteCombo
    // calcola label = displayText e al fuoco la rimette nell'input
    // (useComboTextField.onFocus): l'utente rivedrebbe "ROSSI MARIO" in un
    // campo che ha svuotato.
    const onChange = vi.fn();
    const props = renderRemote({ value: 'C01', displayText: 'ROSSI MARIO' }, onChange);
    (props.onChange as (v: unknown, o: unknown) => void)(undefined, undefined);
    const last = onChange.mock.calls.at(-1)!;
    expect(last[0]).toBe(NAME);
    expect(last[1] ?? '').toBe('');
    expect(last[2]).toBe('');
  });
});

describe('ComboControl remoto: Esc (annulla) consegna la didascalia (SXADV-5989)', () => {
  it('Esc torna al valore del server: onChange(name, codice, didascalia del server)', () => {
    const onChange = vi.fn();
    forced.active = true;
    forced.value = 'C02'; // scelta locale non ancora confermata dal server
    const props = renderRemote({ value: 'C01', displayText: 'ROSSI MARIO' }, onChange);
    esc(props);
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)!;
    expect(last[0]).toBe(NAME);
    expect(last[1]).toBe('C01');
    expect(last[2]).toBe('ROSSI MARIO');
  });

  it('Esc torna a vuoto (record nuovo): didascalia vuota', () => {
    const onChange = vi.fn();
    forced.active = true;
    forced.value = 'C02';
    const props = renderRemote({ value: null, displayText: undefined }, onChange);
    esc(props);
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)!;
    expect(last[0]).toBe(NAME);
    expect(last[1]).toBe('');
    expect(last[2]).toBe('');
  });

  it('Esc senza niente da annullare non scrive nulla', () => {
    const onChange = vi.fn();
    const props = renderRemote({ value: 'C01', displayText: 'ROSSI MARIO' }, onChange);
    esc(props);
    expect(onChange).not.toHaveBeenCalled();
  });
});
