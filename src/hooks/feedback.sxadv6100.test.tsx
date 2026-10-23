import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// SXADV-6100.2 — la nuova API `feedback.confirm(question, text, onOk, onCancel?)` di
// useFeedback: la finestra di conferma standard (antd `modal.confirm`, classe
// `app-message-dialog`), la domanda come titolo, il testo come corpo, pulsanti OK poi
// Annulla come nel legacy. Le CONFIRMATION del server escono come prima (titolo «Richiesta
// di conferma», OK/Annulla).
// Oracolo: docs/sxadv-62-prove/SXADV6100_contratto.md, 6100.2. Chi prova non e' chi implementa.
//
// Niente DOM: `App.useApp()` di antd e' sostituito da un `modal` finto che registra le
// opzioni; il footer si disegna (render lato server) con due pulsanti finti per leggere
// l'ordine.

const reg = vi.hoisted(() => ({ confirm: [] as Array<Record<string, unknown>>, altri: [] as string[] }));
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const modal = {
    confirm: (o: Record<string, unknown>) => {
      reg.confirm.push(o);
      return { destroy: () => {}, update: () => {} };
    },
    error: () => { reg.altri.push('error'); return { destroy: () => {} }; },
    warning: () => { reg.altri.push('warning'); return { destroy: () => {} }; },
    info: () => { reg.altri.push('info'); return { destroy: () => {} }; },
    success: () => { reg.altri.push('success'); return { destroy: () => {} }; },
  };
  const notification = { info: () => { reg.altri.push('notification'); }, open: () => {} };
  const App = Object.assign(() => null, { useApp: () => ({ modal, notification, message: {} }) });
  return { ...actual, App };
});

// Piu' CONFIRMATION si uniscono con <br />, e il filtro dei messaggi vuole DOMParser: qui
// un finto che lascia il testo com'e' (il filtro ha le sue prove, SXADV-5814).
vi.mock('../services/serverHtml', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/serverHtml')>()),
  sanitizeMessageHtml: (h: string) => h.replace(/<script\b[\s\S]*?<\/script>/gi, ''),
}));

const { useFeedback } = await import('./feedback');
type Fb = ReturnType<typeof useFeedback>;

function prendiFeedback(): Fb {
  const presi: Fb[] = [];
  const Sonda = ({ prendi }: { prendi: (f: Fb) => void }) => {
    prendi(useFeedback());
    return null;
  };
  renderToStaticMarkup(<Sonda prendi={(f) => presi.push(f)} />);
  if (!presi[0]) throw new Error('useFeedback non letto');
  return presi[0];
}

const markup = (n: unknown) => renderToStaticMarkup(<>{n as React.ReactNode}</>);

/** L'ordine dei pulsanti del footer: lo si disegna con due pulsanti riconoscibili. */
function ordinePulsanti(o: Record<string, unknown>): string[] {
  const f = o.footer;
  if (typeof f !== 'function') return ['(footer predefinito di antd: Annulla poi OK)'];
  const OkBtn = () => <i data-p="OK" />;
  const CancelBtn = () => <i data-p="ANNULLA" />;
  const html = markup((f as (a: unknown, b: unknown) => unknown)(null, { OkBtn, CancelBtn }));
  return [...html.matchAll(/data-p="([A-Z]+)"/g)].map((m) => m[1]);
}

beforeEach(() => {
  reg.confirm.length = 0;
  reg.altri.length = 0;
});

describe('SXADV-6100.2 feedback.confirm', () => {
  it('esiste ed e\' una funzione', () => {
    expect(typeof (prendiFeedback() as unknown as { confirm?: unknown }).confirm).toBe('function');
  });

  it('apre UNA finestra modal.confirm, nient\'altro', () => {
    prendiFeedback().confirm('Eliminare dalla dashboard questo widget?', "La dashboard non lo mostrera' piu'.", () => {});
    expect(reg.confirm.length).toBe(1);
    expect(reg.altri).toEqual([]);
  });

  it('la domanda e\' il titolo, il testo e\' il corpo', () => {
    prendiFeedback().confirm('Eliminare dalla dashboard questo widget?', "La dashboard non lo mostrera' piu'.", () => {});
    const o = reg.confirm[0];
    expect(markup(o.title)).toBe('Eliminare dalla dashboard questo widget?');
    expect(markup(o.content)).toContain('La dashboard non lo mostrera&#x27; piu&#x27;.');
  });

  it('classe app-message-dialog (la finestra dei messaggi dell\'applicazione)', () => {
    prendiFeedback().confirm('D?', 'T', () => {});
    expect(String(reg.confirm[0].className || '')).toMatch(/\bapp-message-dialog\b/);
  });

  it('pulsanti «OK» e «Annulla»', () => {
    prendiFeedback().confirm('D?', 'T', () => {});
    expect(reg.confirm[0].okText).toBe('OK');
    expect(reg.confirm[0].cancelText).toBe('Annulla');
  });

  it('ordine del legacy: OK poi Annulla', () => {
    prendiFeedback().confirm('D?', 'T', () => {});
    expect(ordinePulsanti(reg.confirm[0])).toEqual(['OK', 'ANNULLA']);
  });

  it('OK chiama onOk (una volta), non onCancel', () => {
    const ok = vi.fn();
    const no = vi.fn();
    prendiFeedback().confirm('D?', 'T', ok, no);
    (reg.confirm[0].onOk as () => unknown)();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(no).not.toHaveBeenCalled();
  });

  it('Annulla/Esc chiama onCancel, non onOk', () => {
    const ok = vi.fn();
    const no = vi.fn();
    prendiFeedback().confirm('D?', 'T', ok, no);
    (reg.confirm[0].onCancel as (() => unknown) | undefined)?.();
    expect(no).toHaveBeenCalledTimes(1);
    expect(ok).not.toHaveBeenCalled();
  });

  it('senza onCancel: Annulla non esplode e non chiama onOk', () => {
    const ok = vi.fn();
    prendiFeedback().confirm('D?', 'T', ok);
    expect(() => (reg.confirm[0].onCancel as (() => unknown) | undefined)?.()).not.toThrow();
    expect(ok).not.toHaveBeenCalled();
  });

  it('il testo e\' testo: un <b> nel testo non diventa markup', () => {
    prendiFeedback().confirm('D?', 'uno <b>due</b>', () => {});
    const c = markup(reg.confirm[0].content);
    expect(c).not.toContain('<b>');
    expect(c).toContain('&lt;b&gt;');
  });
});

describe('SXADV-6100.2 le CONFIRMATION del server restano come prima', () => {
  const CONF = [{ type: 'CONFIRMATION', message: 'Confermi la cancellazione?', mnemonic: 'DEL1' }];

  it('titolo «Richiesta di conferma», corpo = il messaggio del server', () => {
    prendiFeedback().showServerMessages(CONF as never, {});
    expect(reg.confirm.length).toBe(1);
    expect(markup(reg.confirm[0].title)).toBe('Richiesta di conferma');
    expect(markup(reg.confirm[0].content)).toContain('Confermi la cancellazione?');
  });

  it('OK / Annulla, in quest\'ordine, classe app-message-dialog', () => {
    prendiFeedback().showServerMessages(CONF as never, {});
    const o = reg.confirm[0];
    expect(o.okText).toBe('OK');
    expect(o.cancelText).toBe('Annulla');
    expect(String(o.className || '')).toMatch(/\bapp-message-dialog\b/);
    expect(ordinePulsanti(o)).toEqual(['OK', 'ANNULLA']);
  });

  it('OK risponde «yes» alla CONFIRMATION (l\'ultima), Annulla chiama onCancel', () => {
    const onAnswer = vi.fn();
    const onCancel = vi.fn();
    const due = [
      { type: 'CONFIRMATION', message: 'Prima?', mnemonic: 'A' },
      { type: 'CONFIRMATION', message: 'Seconda?', mnemonic: 'B' },
    ];
    prendiFeedback().showServerMessages(due as never, { onAnswer, onCancel });
    (reg.confirm[0].onOk as () => unknown)();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toMatchObject({ mnemonic: 'B' });
    expect(onAnswer.mock.calls[0][1]).toBe('yes');
    (reg.confirm[0].onCancel as () => unknown)();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('le due CONFIRMATION nello stesso corpo', () => {
    const due = [
      { type: 'CONFIRMATION', message: 'Prima?', mnemonic: 'A' },
      { type: 'CONFIRMATION', message: 'Seconda?', mnemonic: 'B' },
    ];
    prendiFeedback().showServerMessages(due as never, {});
    const c = markup(reg.confirm[0].content);
    expect(c).toContain('Prima?');
    expect(c).toContain('Seconda?');
  });
});
