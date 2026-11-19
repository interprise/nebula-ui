// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from 'antd';
import type { UITree, ListHeader } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';
import { registerBuiltinControls } from '../controls/builtins';
import EditPanel from './EditPanel';

// SXADV-6263: nel pannello a forma di griglia (formShape=false) un controllo
// link-azione non editabile si rende come nella griglia, col suo controllo, non come
// testo vuoto. I tipi sono quelli registrati con registerCellRenderable
// (workflowStatus, attachments, action, navigateView).

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  registerBuiltinControls();
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** La cella reale della risposta del server (Prezzi Sede, colonna "Espandi..."). */
const ESPANDI = {
  colspan: 3,
  elementType: 1,
  control: {
    controlName: 'detail',
    action: 'NavigateView',
    type: 'navigateView',
    prompt: 'Espandi...',
    navpath: 'S1-2.56',
    targetViewName: 'prezziVenditaDetail',
  },
};

const textCell = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  elementType: ELTYPE_CONTENT,
  colspan: 1,
  control: { name: `${name}.S1-2`, id: name, type: 'text', editable: false, value, ...extra },
});

function renderPanel(cells: unknown[], onAction = vi.fn()) {
  const panel = { rows: [{ id: 'r0', cells }], path: 'S1-2.56', pageType: 1 } as unknown as UITree;
  const headers: ListHeader[] = cells.map((_, i) => ({ text: `Col ${i}`, colspan: 1 }));
  const listUi = { rows: [], headers, path: 'S1-2', pageType: 1 } as unknown as UITree;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <App>
        <EditPanel panel={panel} listUi={listUi} rowPath="S1-2.56" formShape={false}
          onAction={onAction} onClose={() => {}} />
      </App>,
    ),
  );
  return { host: host!, onAction };
}

/** L'elemento cliccabile piu' interno col testo dato. */
function byText(el: HTMLElement, text: string): HTMLElement | null {
  const all = Array.from(el.querySelectorAll<HTMLElement>('a, button, span, div'));
  const hits = all.filter((e) => e.textContent?.trim() === text);
  return hits.find((e) => e.tagName === 'A' || e.tagName === 'BUTTON') ?? hits[hits.length - 1] ?? null;
}

describe('EditPanel a griglia: link-azione non editabile (SXADV-6263)', () => {
  it('compare il link "Espandi..."', () => {
    const { host } = renderPanel([textCell('articolo', 'ART01'), ESPANDI]);
    expect(host.textContent).toContain('Espandi...');
  });

  it('cliccare "Espandi..." chiama onAction con NavigateView', () => {
    const { host, onAction } = renderPanel([textCell('articolo', 'ART01'), ESPANDI]);
    const link = byText(host, 'Espandi...');
    expect(link).not.toBeNull();
    act(() => link!.click());
    expect(onAction).toHaveBeenCalled();
    expect(onAction.mock.calls[0][0]).toBe('NavigateView');
  });

  it('il campo testo non editabile resta testo semplice (niente input)', () => {
    const { host } = renderPanel([textCell('articolo', 'ART01'), ESPANDI]);
    expect(host.textContent).toContain('ART01');
    const inputs = Array.from(host.querySelectorAll('input, textarea'))
      .filter((i) => (i as HTMLInputElement).value === 'ART01');
    expect(inputs).toHaveLength(0);
  });

  it('una cella con visible:false resta vuota, anche se e\' un link-azione', () => {
    const nascosto = { ...ESPANDI, control: { ...ESPANDI.control, visible: false } };
    const { host } = renderPanel([textCell('articolo', 'ART01'), nascosto]);
    expect(host.textContent).not.toContain('Espandi...');
  });

  it('un campo testo con visible:false resta vuoto', () => {
    const { host } = renderPanel([textCell('articolo', 'ART01', { visible: false }), ESPANDI]);
    expect(host.textContent).not.toContain('ART01');
  });

  it('anche il tipo action non editabile si rende col suo controllo', () => {
    const azione = {
      colspan: 1, elementType: 1,
      control: { controlName: 'calcola', action: 'Ricalcola', type: 'action', prompt: 'Ricalcola', navpath: 'S1-2.56' },
    };
    const { host } = renderPanel([textCell('articolo', 'ART01'), azione]);
    expect(host.textContent).toContain('Ricalcola');
  });
});
