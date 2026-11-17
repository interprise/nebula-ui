// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from 'antd';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';
import { registerBuiltinControls } from '../controls/builtins/index';

// '?' di aiuto sul campo fuori da Redigi — CONTRATTO-aiuto-campo.md, parte Client.
//
// Scritto da chi NON implementa: prova quello che il contratto promette, non come
// e' fatto. DOM vero (jsdom), antd vero, ViewRenderer e controlli veri; il server e'
// `postAction2` di `../services/api`, sostituito qui e pilotato per caso.
//
// Due famiglie di controlli: quelli che passano da `withPostDecorations` (testo:
// la '?' sta in `.post-decorations`, per ultima) e quelli che non ci passano
// (htmlFormat: la '?' sta in `span.help-icon-outside`, dalla cella). In entrambi i
// casi ne deve essere VISIBILE una sola. jsdom non fa layout: "nascosta" =
// `display:none` in linea su se' o su un antenato, come dice il contratto.
//
// Cosa NON si prova: l'aspetto a schermo, la posizione del popover, il giro col
// server (CORE: entrasp/test/aiuto-campo-harness.sh).

registerBuiltinControls();

const server = vi.hoisted(() => ({
  calls: [] as { action: string; params: Record<string, string> }[],
  /** cosa risponde la prossima postAction2: un valore, una Promise o un errore */
  reply: (() => Promise.resolve({})) as () => Promise<unknown>,
  other: [] as string[],
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  postAction2: async (action: string, params: Record<string, string> = {}) => {
    server.calls.push({ action, params: { ...params } });
    return server.reply();
  },
  postAction: async (action: string) => {
    server.other.push(action);
    return {};
  },
  subscribeInFlight: () => () => {},
}));

const { default: ViewRenderer } = await import('./ViewRenderer');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  class FakeRO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const NO_HELP = 'Nessun aiuto disponibile per questo campo.';
const HELP = { viewName: 'rootDetail', itemId: 'embedView+data', rev: 0 };

/** Un controllo che passa da withPostDecorations. */
const DECORATO = { type: 'text', editable: true, value: 'x' };
/** Un controllo che non ci passa (sola lettura HTML). */
const NUDO = { type: 'htmlFormat', editable: false, value: '<b>valore</b>' };

function pagina(control: Record<string, unknown>): UITree {
  return {
    pageType: 2,
    viewName: 'rootDetail',
    path: 'S1-0',
    rows: [
      {
        id: 'r0',
        cells: [{
          elementType: ELTYPE_CONTENT,
          colspan: 1,
          control: { name: 'data', id: 'data', ...DECORATO, ...control },
        }],
      },
    ],
  } as unknown as UITree;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  server.calls = [];
  server.other = [];
  server.reply = () => Promise.resolve({});
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  // i popover di antd vanno in un portale su body
  document.body.innerHTML = '';
});

function monta(control: Record<string, unknown>) {
  const onAction = vi.fn();
  const onChange = vi.fn();
  const parentClick = vi.fn();
  const parentMouseDown = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const disegna = (c: Record<string, unknown>) => act(() => {
    root!.render(
      <App>
        <div data-testid="parent" onClick={parentClick} onMouseDown={parentMouseDown}>
          <ViewRenderer ui={pagina(c)} onAction={onAction} onChange={onChange} />
        </div>
      </App>,
    );
  });
  disegna(control);
  return { onAction, onChange, parentClick, parentMouseDown, ridisegna: disegna };
}

const flush = async () => {
  // risoluzione della richiesta + aggiornamenti di stato + animazioni di rc-motion
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

function nascosto(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== host; n = n.parentElement) {
    if (n.style.display === 'none' || n.hidden) return true;
  }
  return false;
}
/** Le '?' visibili nella pagina (non in un antenato con display:none). */
const visibili = () => Array.from(host!.querySelectorAll<HTMLElement>('.help-icon')).filter((e) => !nascosto(e));
const icona = () => visibili()[0] ?? null;
const iconaObbligatoria = () => {
  const el = icona();
  if (!el) throw new Error(`manca una .help-icon visibile: ${host!.innerHTML}`);
  return el;
};

function clic(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Il popover aperto (portale su body), o null. */
function popover(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('.ant-popover'));
  return all.find((p) => !p.classList.contains('ant-popover-hidden')) ?? null;
}
const testoPopover = () => popover()?.textContent ?? '';
const spinner = () => popover()?.querySelector('.ant-spin, [aria-busy="true"]') ?? null;

async function apri() {
  clic(iconaObbligatoria());
  await flush();
}

async function esc() {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  });
  await flush();
}

describe('aiuto sul campo: harness', () => {
  // Verifica della messa in piedi: comportamento GIA' esistente (Redigi).
  it('docIcon (Redigi) si disegna e il clic manda NavigateHelp', () => {
    const { onAction } = monta({ docIcon: { hasHelp: true, viewName: HELP.viewName, itemId: HELP.itemId } });
    const doc = host!.querySelector('.doc-icon');
    expect(doc).not.toBeNull();
    clic(doc!);
    expect(onAction).toHaveBeenCalledWith('NavigateHelp', { navpath: 'rootDetail|embedView+data' });
  });

  it('il testo passa dalle decorazioni, htmlFormat no (premessa dei casi sotto)', () => {
    monta({ mandatory: true });
    expect(host!.querySelector('.post-decorations input')).not.toBeNull();
    act(() => root!.unmount());
    host!.remove();
    monta({ ...NUDO, mandatory: true });
    expect(host!.querySelector('.post-decorations')).toBeNull();
    expect(host!.textContent).toContain('valore');
  });
});

describe('aiuto sul campo: dove sta la ?', () => {
  it('controllo decorato: una sola ? visibile, dentro .post-decorations', () => {
    monta({ helpIcon: HELP });
    const v = visibili();
    expect(v).toHaveLength(1);
    expect(v[0].closest('.post-decorations')).not.toBeNull();
  });

  it('controllo decorato: la ? e\' l\'ultima decorazione, dopo stella, lente, +', () => {
    monta({
      helpIcon: HELP,
      value: '',
      mandatory: true,
      lookupViewName: 'lk',
      navigateLookupCommand: 'NavigateLookup',
      navigateAdd: { command: 'NavigateAdd', navpath: 'S1-0', controlName: 'data' },
    });
    const v = visibili();
    expect(v).toHaveLength(1);
    const deco = v[0].closest('.post-decorations')!;
    expect(deco).not.toBeNull();
    expect(deco.querySelector('.mandatory-icon')).not.toBeNull();
    expect(deco.querySelector('.lookup-icon')).not.toBeNull();
    expect(deco.querySelector('.add-icon')).not.toBeNull();
    // l'ultimo figlio di .post-decorations contiene la ?
    const ultimo = deco.lastElementChild as HTMLElement;
    expect(ultimo === v[0] || ultimo.contains(v[0])).toBe(true);
  });

  it('controllo non decorato: una sola ? visibile, in span.help-icon-outside', () => {
    monta({ ...NUDO, helpIcon: HELP });
    const v = visibili();
    expect(v).toHaveLength(1);
    expect(v[0].closest('.help-icon-outside')).not.toBeNull();
    expect(v[0].closest('.post-decorations')).toBeNull();
  });

  it('controllo decorato: l\'eventuale ? della cella e\' nascosta con display:none E hidden', () => {
    monta({ helpIcon: HELP });
    const fuori = host!.querySelector<HTMLElement>('span.help-icon-outside');
    if (fuori) {
      expect(fuori.style.display).toBe('none');
      expect(fuori.hasAttribute('hidden')).toBe(true);
    }
    expect(visibili()).toHaveLength(1);
  });

  it('controllo non decorato: la span.help-icon-outside visibile non ha ne\' display:none ne\' hidden', () => {
    monta({ ...NUDO, helpIcon: HELP });
    const fuori = host!.querySelectorAll<HTMLElement>('span.help-icon-outside');
    expect(fuori).toHaveLength(1);
    expect(fuori[0].style.display).not.toBe('none');
    expect(fuori[0].hasAttribute('hidden')).toBe(false);
  });

  it('dopo un ridisegno (stesso campo, valore diverso) la ? ridondante resta display:none E hidden', () => {
    const { ridisegna } = monta({ helpIcon: HELP });
    ridisegna({ helpIcon: HELP, value: 'altro' });
    const fuori = host!.querySelector<HTMLElement>('span.help-icon-outside');
    if (fuori) {
      expect(fuori.style.display).toBe('none');
      expect(fuori.hasAttribute('hidden')).toBe(true);
    }
    expect(visibili()).toHaveLength(1);
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])(
    '%s: il contenitore del controllo ha cell-help-wrap e nessuno stile in linea',
    (_l, tipo) => {
      monta({ ...tipo, helpIcon: HELP });
      const td = iconaObbligatoria().closest('td')!;
      const wrap = td.querySelector<HTMLElement>('.cell-help-wrap');
      expect(wrap).not.toBeNull();
      expect(wrap!.getAttribute('style') ?? '').toBe('');
      // e' il contenitore del controllo: la ? visibile ci sta dentro
      expect(wrap!.contains(iconaObbligatoria())).toBe(true);
    },
  );

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: icona con classe, aria-label e role', (_l, tipo) => {
    monta({ ...tipo, helpIcon: HELP });
    const el = iconaObbligatoria();
    expect(el.classList.contains('help-icon')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Aiuto');
    expect(el.getAttribute('role')).toBe('button');
  });

  // La ? non cambia la disposizione della cella fuori dalle modalita' admin.
  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: la sola helpIcon NON mette has-side-icons', (_l, tipo) => {
    monta({ ...tipo, helpIcon: HELP });
    const td = iconaObbligatoria().closest('td');
    expect(td).not.toBeNull();
    expect(td!.classList.contains('has-side-icons')).toBe(false);
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: docIcon mette ancora has-side-icons', (_l, tipo) => {
    monta({ ...tipo, docIcon: { hasHelp: true, viewName: HELP.viewName, itemId: HELP.itemId } });
    expect(host!.querySelector('td.has-side-icons')).not.toBeNull();
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: configureIcon mette ancora has-side-icons', (_l, tipo) => {
    monta({ ...tipo, configureIcon: { included: true, itemId: 'embedView.data' } });
    expect(host!.querySelector('td.has-side-icons')).not.toBeNull();
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: senza helpIcon nessuna ?, niente has-side-icons', (_l, tipo) => {
    monta({ ...tipo });
    expect(host!.querySelectorAll('.help-icon')).toHaveLength(0);
    expect(host!.querySelector('td.has-side-icons')).toBeNull();
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])('%s: con docIcon resta l\'icona di Redigi', (_l, tipo) => {
    monta({ ...tipo, docIcon: { hasHelp: false, viewName: HELP.viewName, itemId: HELP.itemId } });
    expect(host!.querySelector('.doc-icon')).not.toBeNull();
    expect(visibili()).toHaveLength(0);
  });

  // "visibile ce n'e' sempre UNA sola" anche quando lo stesso campo (stessa
  // vista/item/rev, quindi stessa key) cambia controllo fra un disegno e l'altro.
  it('lo stesso campo che passa da decorato a non decorato tiene una ? visibile', () => {
    const { ridisegna } = monta({ helpIcon: HELP });
    expect(visibili()).toHaveLength(1);
    ridisegna({ ...NUDO, helpIcon: HELP });
    expect(visibili()).toHaveLength(1);
  });

  it('lo stesso campo che passa da non decorato a decorato tiene una ? visibile', () => {
    const { ridisegna } = monta({ ...NUDO, helpIcon: HELP });
    expect(visibili()).toHaveLength(1);
    ridisegna({ ...DECORATO, helpIcon: HELP });
    expect(visibili()).toHaveLength(1);
  });

  it('disegnare l\'icona non chiede niente al server', () => {
    monta({ helpIcon: HELP });
    expect(server.calls).toEqual([]);
  });
});

describe.each([['decorato', DECORATO], ['non decorato', NUDO]])('aiuto sul campo (%s): clic e popover', (_l, tipo) => {
  it('il clic chiede GetItemHelp con viewName e itemId e mostra il testo', async () => {
    server.reply = () => Promise.resolve({ help: '<b>Il campo</b> data' });
    monta({ ...tipo, helpIcon: HELP });
    await apri();
    expect(server.calls).toEqual([{ action: 'GetItemHelp', params: { viewName: 'rootDetail', itemId: 'embedView+data' } }]);
    const p = popover();
    expect(p).not.toBeNull();
    expect(p!.querySelector('b')?.textContent).toBe('Il campo');
    expect(testoPopover()).toContain('Il campo data');
    expect(testoPopover()).not.toContain(NO_HELP);
  });

  it('il clic non chiama onAction ne\' postAction', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    const { onAction } = monta({ ...tipo, helpIcon: HELP });
    await apri();
    expect(onAction).not.toHaveBeenCalled();
    expect(server.other).toEqual([]);
  });

  it('il clic non si propaga al campo/riga', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    const { parentClick, parentMouseDown, onChange } = monta({ ...tipo, helpIcon: HELP });
    const docClick = vi.fn();
    document.addEventListener('click', docClick);
    try {
      await apri();
    } finally {
      document.removeEventListener('click', docClick);
    }
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentMouseDown).not.toHaveBeenCalled();
    expect(docClick).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mentre carica c\'e\' un indicatore di caricamento', async () => {
    let resolve: (v: unknown) => void = () => {};
    server.reply = () => new Promise((r) => { resolve = r; });
    monta({ ...tipo, helpIcon: HELP });
    await apri();
    expect(popover()).not.toBeNull();
    expect(spinner()).not.toBeNull();
    expect(testoPopover()).not.toContain(NO_HELP);
    await act(async () => { resolve({ help: 'arrivato' }); });
    await flush();
    expect(testoPopover()).toContain('arrivato');
    expect(spinner()).toBeNull();
  });

  it.each([
    ['risposta senza help', () => Promise.resolve({})],
    ['help vuoto', () => Promise.resolve({ help: '' })],
    ['help di soli spazi', () => Promise.resolve({ help: '   \n ' })],
    ['help null', () => Promise.resolve({ help: null })],
    ['help che dopo il filtro resta vuoto', () => Promise.resolve({ help: '<script>alert(1)</script>' })],
    ['errore di rete', () => Promise.reject(new Error('rete giu\''))],
  ])('%s -> "Nessun aiuto disponibile per questo campo."', async (_label, reply) => {
    server.reply = reply as () => Promise<unknown>;
    monta({ ...tipo, helpIcon: HELP });
    await apri();
    expect(popover()).not.toBeNull();
    expect(testoPopover()).toContain(NO_HELP);
    expect(spinner()).toBeNull();
  });
});

describe('aiuto sul campo: HTML filtrato', () => {
  it('niente script ne\' handler inline, il markup innocuo resta', async () => {
    (window as unknown as Record<string, unknown>).__xss = undefined;
    server.reply = () => Promise.resolve({
      help: '<p>Prima <i>riga</i></p><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
        + '<a href="javascript:window.__xss=3" onclick="window.__xss=4">link</a><div onmouseover="window.__xss=5">dopo</div>',
    });
    monta({ helpIcon: HELP });
    await apri();
    const p = popover();
    expect(p).not.toBeNull();
    expect(p!.querySelector('script')).toBeNull();
    expect(p!.querySelector('[onerror]')).toBeNull();
    expect(p!.querySelector('[onclick]')).toBeNull();
    expect(p!.querySelector('[onmouseover]')).toBeNull();
    const a = p!.querySelector('a');
    if (a) expect((a.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript:');
    expect(p!.innerHTML).not.toMatch(/\son\w+\s*=/i);
    expect(p!.querySelector('i')?.textContent).toBe('riga');
    expect(testoPopover()).toContain('dopo');
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });

  it('<img src=x onerror=alert(1)> senza virgolette: niente handler', async () => {
    const alert = vi.fn();
    window.alert = alert;
    server.reply = () => Promise.resolve({ help: 'testo <img src=x onerror=alert(1)>' });
    monta({ helpIcon: HELP });
    await apri();
    const p = popover();
    expect(p).not.toBeNull();
    expect(p!.querySelector('[onerror]')).toBeNull();
    expect(testoPopover()).toContain('testo');
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('aiuto sul campo: chiusura', () => {
  it('Esc chiude il popover', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    monta({ helpIcon: HELP });
    await apri();
    expect(popover()).not.toBeNull();
    await esc();
    expect(popover()).toBeNull();
  });

  it('Esc che chiude il popover non diventa un\'azione della vista', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    const { onAction } = monta({ helpIcon: HELP });
    await apri();
    await esc();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('il pulsante di chiusura chiude il popover', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    monta({ helpIcon: HELP });
    await apri();
    const p = popover();
    expect(p).not.toBeNull();
    const close = p!.querySelector('button, [role="button"]');
    expect(close).not.toBeNull();
    clic(close!);
    await flush();
    expect(popover()).toBeNull();
  });

  it('clic fuori chiude il popover', async () => {
    server.reply = () => Promise.resolve({ help: 'testo' });
    monta({ helpIcon: HELP });
    await apri();
    expect(popover()).not.toBeNull();
    const fuori = document.createElement('div');
    document.body.appendChild(fuori);
    clic(fuori);
    await flush();
    expect(popover()).toBeNull();
  });
});

describe('aiuto sul campo: quando si richiede il testo', () => {
  it('riaprire non rifa\' la richiesta e mostra lo stesso testo', async () => {
    server.reply = () => Promise.resolve({ help: 'testo unico' });
    monta({ helpIcon: HELP });
    await apri();
    expect(testoPopover()).toContain('testo unico');
    await esc();
    expect(popover()).toBeNull();
    await apri();
    expect(popover()).not.toBeNull();
    expect(testoPopover()).toContain('testo unico');
    expect(server.calls).toHaveLength(1);
  });

  it('riaprire dopo una risposta senza testo non rifa\' la richiesta', async () => {
    server.reply = () => Promise.resolve({});
    monta({ helpIcon: HELP });
    await apri();
    await esc();
    await apri();
    expect(testoPopover()).toContain(NO_HELP);
    expect(server.calls).toHaveLength(1);
  });

  it('ridisegnare lo stesso campo con la stessa rev non rifa\' la richiesta', async () => {
    server.reply = () => Promise.resolve({ help: 'testo unico' });
    const { ridisegna } = monta({ helpIcon: HELP });
    await apri();
    await esc();
    ridisegna({ helpIcon: { ...HELP }, value: 'altro valore' });
    await flush();
    await apri();
    expect(testoPopover()).toContain('testo unico');
    expect(server.calls).toHaveLength(1);
  });

  it('dopo un errore di rete la riapertura mostra di nuovo il caricamento e riprova', async () => {
    server.reply = () => Promise.reject(new Error('rete giu\''));
    monta({ helpIcon: HELP });
    await apri();
    expect(testoPopover()).toContain(NO_HELP);
    await esc();
    let resolve: (v: unknown) => void = () => {};
    server.reply = () => new Promise((r) => { resolve = r; });
    await apri();
    expect(server.calls).toHaveLength(2);
    expect(spinner()).not.toBeNull();
    expect(testoPopover()).not.toContain(NO_HELP);
    await act(async () => { resolve({ help: 'finalmente' }); });
    await flush();
    expect(testoPopover()).toContain('finalmente');
  });

  it.each([['decorato', DECORATO], ['non decorato', NUDO]])(
    '%s: una rev diversa sullo stesso campo richiede di nuovo il testo, senza mostrare quello vecchio',
    async (_l, tipo) => {
      server.reply = () => Promise.resolve({ help: 'testo vecchio' });
      const { ridisegna } = monta({ ...tipo, helpIcon: { ...HELP, rev: 1 } });
      await apri();
      expect(testoPopover()).toContain('testo vecchio');
      await esc();
      let resolve: (v: unknown) => void = () => {};
      server.reply = () => new Promise((r) => { resolve = r; });
      ridisegna({ ...tipo, helpIcon: { ...HELP, rev: 2 } });
      await flush();
      expect(visibili()).toHaveLength(1);
      await apri();
      expect(server.calls).toHaveLength(2);
      expect(testoPopover()).not.toContain('testo vecchio');
      expect(spinner()).not.toBeNull();
      await act(async () => { resolve({ help: 'testo nuovo' }); });
      await flush();
      expect(testoPopover()).toContain('testo nuovo');
    },
  );

  it('un altro item nello stesso posto richiede il suo testo', async () => {
    server.reply = () => Promise.resolve({ help: 'testo A' });
    const { ridisegna } = monta({ helpIcon: HELP });
    await apri();
    await esc();
    server.reply = () => Promise.resolve({ help: 'testo B' });
    ridisegna({ helpIcon: { ...HELP, itemId: 'embedView+altro' } });
    await flush();
    await apri();
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toEqual({ action: 'GetItemHelp', params: { viewName: 'rootDetail', itemId: 'embedView+altro' } });
    expect(testoPopover()).toContain('testo B');
    expect(testoPopover()).not.toContain('testo A');
  });

  it('un\'altra vista radice nello stesso posto richiede il suo testo', async () => {
    server.reply = () => Promise.resolve({ help: 'testo A' });
    const { ridisegna } = monta({ helpIcon: HELP });
    await apri();
    await esc();
    server.reply = () => Promise.resolve({ help: 'testo R2' });
    ridisegna({ helpIcon: { ...HELP, viewName: 'altraRadice' } });
    await flush();
    await apri();
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].params.viewName).toBe('altraRadice');
    expect(testoPopover()).toContain('testo R2');
  });
});
