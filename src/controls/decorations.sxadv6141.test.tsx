// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UIControl } from '../types/ui';
import { withPostDecorations } from './decorations';

// SXADV-6141 — l'icona Nuovo (+) accanto a un campo, descritta da
// control.navigateAdd. Contratto:
//   - withValue:true (tendine List): il server ha gia' deciso con la regola del
//     legacy «record nuovo o campo vuoto», quindi il + compare anche con un valore;
//   - senza withValue (campi Text): il + compare solo a campo vuoto;
//   - il clic chiama onAction(command, { navpath, option1: controlName });
//   - l'icona link (navigateView) resta solo con un valore e convive col +;
//   - nessun descrittore, nessuna icona.
//
// Cosa NON si prova qui: la regola «record nuovo o campo vuoto» (e' del server)
// e la resa a schermo dell'icona accanto alla tendina.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ADD = { command: 'NavigateAdd', navpath: 'S1-0.2,S1-3', controlName: 'cliente' };
const NAV = { command: 'NavigateView', navpath: 'S1-0.2,S1-4', controlName: 'cliente' };

const roots: Root[] = [];

function mount(over: Partial<UIControl>) {
  const onAction = vi.fn();
  const control = { id: 'cliente', name: 'cliente.S1-3', type: 'list', editable: true, ...over } as UIControl;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<>{withPostDecorations(<input data-testid="campo" />, control, 2, onAction)}</>);
  });
  return {
    host,
    onAction,
    add: () => host.querySelector<HTMLElement>('.add-icon'),
    nav: () => host.querySelector<HTMLElement>('.nav-icon'),
  };
}

const click = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = '';
});

describe('SXADV-6141: icona Nuovo col descrittore navigateAdd', () => {
  describe('withValue:true (tendina List)', () => {
    it('compare con un valore nel campo', () => {
      expect(mount({ value: '42', navigateAdd: { ...ADD, withValue: true } }).add()).not.toBeNull();
    });

    it('compare anche a campo vuoto', () => {
      expect(mount({ value: '', navigateAdd: { ...ADD, withValue: true } }).add()).not.toBeNull();
    });

    it('il valore 0 e\' un valore: il + resta', () => {
      expect(mount({ value: 0 as unknown as string, navigateAdd: { ...ADD, withValue: true } }).add()).not.toBeNull();
    });
  });

  describe('senza withValue (campo Text)', () => {
    it.each([
      ['stringa vuota', ''],
      ['null', null],
      ['assente', undefined],
    ])('compare a campo vuoto: %s', (_n, value) => {
      expect(mount({ value: value as unknown as string, navigateAdd: ADD }).add()).not.toBeNull();
    });

    it('non compare con un valore', () => {
      expect(mount({ value: 'ROSSI', navigateAdd: ADD }).add()).toBeNull();
    });

    it('il valore 0 conta come valore: niente +', () => {
      expect(mount({ value: 0 as unknown as string, navigateAdd: ADD }).add()).toBeNull();
    });

    it('withValue:false vale come assente', () => {
      expect(mount({ value: 'ROSSI', navigateAdd: { ...ADD, withValue: false } }).add()).toBeNull();
    });
  });

  describe('il clic', () => {
    it('con withValue chiama onAction con command, navpath e option1 = controlName', () => {
      const m = mount({ value: '42', navigateAdd: { ...ADD, withValue: true } });
      click(m.add()!);
      expect(m.onAction).toHaveBeenCalledTimes(1);
      expect(m.onAction).toHaveBeenCalledWith('NavigateAdd', { navpath: 'S1-0.2,S1-3', option1: 'cliente' });
    });

    it('a campo vuoto senza withValue fa la stessa chiamata', () => {
      const m = mount({ value: '', navigateAdd: ADD });
      click(m.add()!);
      expect(m.onAction).toHaveBeenCalledTimes(1);
      expect(m.onAction).toHaveBeenCalledWith('NavigateAdd', { navpath: 'S1-0.2,S1-3', option1: 'cliente' });
    });

    it('option1 e\' il controlName del descrittore, non il nome col viewstate del controllo', () => {
      const m = mount({ name: 'altro.S1-9', value: '42', navigateAdd: { ...ADD, withValue: true } });
      click(m.add()!);
      expect(m.onAction.mock.calls[0][1].option1).toBe('cliente');
    });
  });

  describe('convivenza con l\'icona link', () => {
    it('con un valore e withValue ci sono entrambe, e ognuna manda il suo comando', () => {
      const m = mount({ value: '42', navigateView: NAV, navigateAdd: { ...ADD, withValue: true } });
      expect(m.nav()).not.toBeNull();
      expect(m.add()).not.toBeNull();

      click(m.nav()!);
      expect(m.onAction).toHaveBeenLastCalledWith('NavigateView', { navpath: 'S1-0.2,S1-4', option1: 'cliente' });
      click(m.add()!);
      expect(m.onAction).toHaveBeenLastCalledWith('NavigateAdd', { navpath: 'S1-0.2,S1-3', option1: 'cliente' });
      expect(m.onAction).toHaveBeenCalledTimes(2);
    });

    it('a campo vuoto con withValue il link sparisce e il + resta', () => {
      const m = mount({ value: '', navigateView: NAV, navigateAdd: { ...ADD, withValue: true } });
      expect(m.nav()).toBeNull();
      expect(m.add()).not.toBeNull();
    });

    it('con un valore e senza withValue resta solo il link', () => {
      const m = mount({ value: 'ROSSI', navigateView: NAV, navigateAdd: ADD });
      expect(m.nav()).not.toBeNull();
      expect(m.add()).toBeNull();
    });

    it('il link non dipende da navigateAdd', () => {
      expect(mount({ value: '42', navigateView: NAV }).nav()).not.toBeNull();
      expect(mount({ value: '', navigateView: NAV }).nav()).toBeNull();
    });
  });

  describe('nessun descrittore', () => {
    it.each([
      ['con un valore', '42'],
      ['a campo vuoto', ''],
    ])('nessuna icona %s, e il controllo non viene avvolto', (_n, value) => {
      const m = mount({ value });
      expect(m.add()).toBeNull();
      expect(m.nav()).toBeNull();
      expect(m.host.querySelector('.post-decorations')).toBeNull();
      expect(m.host.querySelector('[data-testid="campo"]')).not.toBeNull();
    });
  });
});
