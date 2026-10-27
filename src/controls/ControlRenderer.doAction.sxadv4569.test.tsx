import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { UIControl } from '../types/ui';

// SXADV-4569 (revisione) — ControlRenderer avvolge onAction in doAction (aggiunge
// il navpath della vista). La risposta del server deve tornare a chi chiama:
// una lista sotto un controllo riceve cosi' la risposta di LocateRow, che il
// «Cerca» legge (located).
//
// Niente DOM: un motore di hook minimo (useContext/useCallback/...) e l'elemento
// restituito da ControlRenderer si legge come dato: il suo onAction e' doAction.

type AnyFn = (...a: never[]) => unknown;

const rt = vi.hoisted(() => ({ active: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const on = <F extends AnyFn>(real: F, fake: AnyFn): F =>
    ((...a: never[]) => (rt.active ? fake(...a) : real(...a))) as unknown as F;
  const over = {
    useCallback: on(actual.useCallback as AnyFn, ((fn: unknown) => fn) as AnyFn),
    useMemo: on(actual.useMemo as AnyFn, ((f: () => unknown) => f()) as AnyFn),
    useContext: on(actual.useContext as AnyFn, ((c: { _currentValue: unknown }) => c._currentValue) as AnyFn),
  };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

const { default: ControlRenderer } = await import('./ControlRenderer');
const { PathContext } = await import('../components/ViewRenderer');

type Act = (action: string, params?: Record<string, string>) => unknown;

function doActionOf(onAction: Act, viewPath?: string): Act {
  const ctx = PathContext as unknown as { _currentValue: unknown };
  const saved = ctx._currentValue;
  ctx._currentValue = viewPath;
  rt.active = true;
  try {
    const control = { type: 'text', name: 'x.S1-3', id: 'x', editable: true } as UIControl;
    const el = (ControlRenderer as unknown as (p: unknown) => ReactElement<{ onAction: Act }>)(
      { control, onAction, onChange: vi.fn() },
    );
    return el.props.onAction;
  } finally {
    rt.active = false;
    ctx._currentValue = saved;
  }
}

describe('ControlRenderer doAction restituisce la risposta (SXADV-4569)', () => {
  it('Promise: la risposta di LocateRow torna a chi chiama', async () => {
    const resp = { located: { found: true, more: false, position: 3, scanned: 4 } };
    const onAction = vi.fn(async () => resp);
    const doAction = doActionOf(onAction, 'S1-3');
    await expect(doAction('LocateRow', { navpath: 'S1-0.2,S1-3', option1: 'x' })).resolves.toBe(resp);
  });

  it('valore sincrono: torna uguale', () => {
    const resp = { located: { found: false, more: false, position: -1, scanned: 2 } };
    expect(doActionOf(() => resp, 'S1-3')('LocateRow', { navpath: 'S1-3' })).toBe(resp);
  });

  it('il navpath della vista si aggiunge solo se manca (invariato)', () => {
    const onAction = vi.fn(() => undefined);
    const doAction = doActionOf(onAction, 'S1-5');
    doAction('LocateRow', { option1: 'x' });
    doAction('LocateRow', { navpath: 'S1-0.2,S1-3', option1: 'x' });
    expect(onAction.mock.calls[0]).toEqual(['LocateRow', { option1: 'x', navpath: 'S1-5' }]);
    expect(onAction.mock.calls[1]).toEqual(['LocateRow', { navpath: 'S1-0.2,S1-3', option1: 'x' }]);
  });
});
