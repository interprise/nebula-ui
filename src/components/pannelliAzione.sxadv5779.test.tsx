import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// SXADV-5779 — nei pannelli di azione Annulla sta all'estrema destra, dopo l'azione
// dominante, come nel legacy: e' la prima cosa che il puntatore incontra. L'ordine
// vale nel DOM, quindi Annulla e' l'ULTIMO pulsante del gruppo e il Tab segue l'occhio.
//
// Niente DOM nel progetto (ne' jsdom ne' testing-library). Quello che si prova e' pero'
// il componente vero e antd vero, resi con renderToStaticMarkup:
//  - <Modal> e modal.confirm passano dal pannello "puro" di antd
//    (Modal._InternalPanelDoNotUseOrYouWillBeFired), lo stesso che disegna i pulsanti
//    delle finestre senza il portale: l'ordine letto e' quello che antd produce, footer
//    predefinito compreso;
//  - Modal, Drawer, Button, Form, Input sono involucri che registrano le props e
//    delegano: "premere" un pulsante = chiamarne l'onClick vero.
// React resta quello vero; gli stati si leggono dalle chiamate ai setter, perche' nel
// render lato server un setState non ridisegna.

type Props = Record<string, unknown>;
type AnyFn = (...a: unknown[]) => unknown;

const cap = vi.hoisted(() => ({
  conferme: [] as Array<Record<string, unknown>>,
  dialogo: { destroy: vi.fn(), update: vi.fn() },
  modali: [] as Array<Record<string, unknown>>,
  drawer: [] as Array<Record<string, unknown>>,
  bottoni: [] as Array<Record<string, unknown>>,
  form: [] as Array<Record<string, unknown>>,
  input: [] as Array<Record<string, unknown>>,
  istanze: [] as Array<Record<string, unknown>>,
  // React, solo per i sorgenti del progetto (antd e' esterno e non passa di qui).
  callback: [] as AnyFn[],
  setter: [] as Array<{ iniziale: unknown; valore: unknown }>,
  statoNull: undefined as unknown,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useCallback = (fn: AnyFn, deps: unknown[]) => {
    cap.callback.push(fn);
    return actual.useCallback(fn, deps);
  };
  const useState = (iniziale: unknown) => {
    // Lo stato che nasce dopo un effetto (la bozza) non arriverebbe mai in questo render.
    let partenza = iniziale;
    if (iniziale === null && cap.statoNull !== undefined) {
      partenza = cap.statoNull;
      cap.statoNull = undefined;
    }
    const [v, set] = actual.useState(partenza);
    return [
      v,
      (x: unknown) => {
        cap.setter.push({ iniziale, valore: x });
        set(x as never);
      },
    ];
  };
  const over = { useCallback, useState };
  return { ...actual, ...over, default: { ...actual, ...over } };
});

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const R = await import('react');
  const registra = (dove: Array<Record<string, unknown>>, Vero: React.ElementType) =>
    Object.assign(
      (p: Record<string, unknown>) => {
        dove.push(p);
        return R.createElement(Vero, p);
      },
      Vero,
    );
  const Pannello = (actual.Modal as unknown as { _InternalPanelDoNotUseOrYouWillBeFired: React.ElementType })
    ._InternalPanelDoNotUseOrYouWillBeFired;
  const Modal = Object.assign((p: Record<string, unknown>) => {
    cap.modali.push(p);
    const { title, footer, okText, cancelText, okButtonProps, onOk, onCancel, children } = p;
    return R.createElement(Pannello, { title, footer, okText, cancelText, okButtonProps, onOk, onCancel }, children as React.ReactNode);
  }, actual.Modal);
  const Drawer = Object.assign((p: Record<string, unknown>) => {
    cap.drawer.push(p);
    return null;
  }, actual.Drawer);
  const Form = Object.assign(
    (p: Record<string, unknown>) => {
      cap.form.push(p);
      return R.createElement(actual.Form as React.ElementType, p);
    },
    actual.Form,
    {
      useForm: (...a: unknown[]) => {
        const r = (actual.Form.useForm as AnyFn)(...a) as [Record<string, unknown>];
        r[0].submit = vi.fn();
        cap.istanze.push(r[0]);
        return r;
      },
    },
  );
  const Input = Object.assign(registra(cap.input, actual.Input as React.ElementType), {
    Password: registra(cap.input, actual.Input.Password as React.ElementType),
    Search: actual.Input.Search,
    TextArea: actual.Input.TextArea,
    Group: actual.Input.Group,
    OTP: actual.Input.OTP,
  });
  const modal = {
    confirm: (o: Record<string, unknown>) => {
      cap.conferme.push(o);
      return cap.dialogo;
    },
    error: () => cap.dialogo,
    warning: () => cap.dialogo,
    info: () => cap.dialogo,
    success: () => cap.dialogo,
  };
  const App = Object.assign(() => null, {
    useApp: () => ({ modal, notification: { info: () => {} }, message: {} }),
  });
  return {
    ...actual,
    App,
    Modal,
    Drawer,
    Form,
    Input,
    Button: registra(cap.bottoni, actual.Button as React.ElementType),
  };
});

vi.mock('../services/api');
vi.mock('../services/serverHtml', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/serverHtml')>()),
  // Il filtro vuole DOMParser, e ha le sue prove (SXADV-5814).
  sanitizeMessageHtml: (h: string) => h,
}));
vi.mock('./dashboard/ordineColonne', () => ({
  leggiOrdineColonne: () => null,
  leggiOrdinamentoLocale: () => null,
}));

const api = await import('../services/api');
const antd = await import('antd');
const { useFeedback } = await import('../hooks/feedback');
const { default: ChangePasswordModal } = await import('./ChangePasswordModal');
const { default: ImpersonateModal } = await import('./ImpersonateModal');
const { default: AddWidgetModal } = await import('./AddWidgetModal');
const { default: Toolbar } = await import('./Toolbar');
const { default: EditPanel } = await import('./EditPanel');
const { default: AttachmentsDrawer } = await import('./AttachmentsDrawer');
const { default: CdmsTree } = await import('./CdmsTree');
const { default: MultiSelectControl } = await import('../controls/MultiSelectControl');
const { default: ModificaWidget } = await import('./dashboard/ModificaWidget');

// Props ridotte al necessario: qui non si prova la forma dei dati.
const AttachmentsDrawerLibero = AttachmentsDrawer as React.ElementType;
const CdmsTreeLibero = CdmsTree as React.ElementType;
const ModificaWidgetLibero = ModificaWidget as React.ElementType;

const postAction2 = api.postAction2 as unknown as ReturnType<typeof vi.fn>;
const postAction = api.postAction as unknown as ReturnType<typeof vi.fn>;
const cdmsExec = api.cdmsExec as unknown as ReturnType<typeof vi.fn>;

/* ── Lettura ──────────────────────────────────────────────────────────── */

interface Pulsante {
  testo: string;
  classi: string;
  tipo: string;
}

/** I <button> dell'html, nell'ordine del DOM. */
function pulsanti(html: string): Pulsante[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    testo: m[2].replace(/<[^>]+>/g, '').trim(),
    classi: /class="([^"]*)"/.exec(m[1])?.[1] ?? '',
    tipo: /\btype="([^"]*)"/.exec(m[1])?.[1] ?? '',
  }));
}

/** La zona dei pulsanti di una finestra (la X di chiusura ne resta fuori). */
function delFooter(html: string): Pulsante[] {
  const i = html.search(/class="[^"]*ant-modal-(footer|confirm-btns)/);
  expect(i, 'la finestra non ha la zona dei pulsanti').toBeGreaterThanOrEqual(0);
  return pulsanti(html.slice(i));
}

const nomi = (p: Pulsante[]) => p.map((x) => x.testo);
const primario = (p: Pulsante) => /\bant-btn-(primary|color-primary)\b/.test(p.classi);
const pericolo = (p: Pulsante) => /\bant-btn-(dangerous|color-dangerous)\b/.test(p.classi);

const Pannello = (antd.Modal as unknown as { _InternalPanelDoNotUseOrYouWillBeFired: React.ElementType })
  ._InternalPanelDoNotUseOrYouWillBeFired;

/** Disegna una configurazione di modal.confirm con il contenuto vero di antd. */
function conferma(cfg: Props): Pulsante[] {
  const { content, ...resto } = cfg;
  const html = renderToStaticMarkup(
    <Pannello type="confirm" {...resto}>
      {content as React.ReactNode}
    </Pannello>,
  );
  return delFooter(html);
}

const testoDi = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(testoDi).join('');
  return testoDi((n as { props?: Props }).props?.children);
};

/** I <Button> di un albero di elementi non ancora reso, in ordine. */
function bottoniDi(n: unknown): Props[] {
  if (n == null || typeof n !== 'object') return [];
  if (Array.isArray(n)) return n.flatMap(bottoniDi);
  const el = n as { type?: unknown; props?: Props };
  if (el.type === antd.Button) return [el.props as Props];
  return bottoniDi(el.props?.children);
}

const bottoneDi = (albero: unknown, testo: string) => {
  const b = bottoniDi(albero).find((x) => testoDi(x.children).trim().startsWith(testo));
  if (!b) throw new Error(`pulsante "${testo}" non trovato`);
  return b;
};

const reso = (b: Props) => (b.onClick as AnyFn)({});
const dormi = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  cap.conferme.length = 0;
  cap.modali.length = 0;
  cap.drawer.length = 0;
  cap.bottoni.length = 0;
  cap.form.length = 0;
  cap.input.length = 0;
  cap.istanze.length = 0;
  cap.callback.length = 0;
  cap.setter.length = 0;
  cap.statoNull = undefined;
  cap.dialogo.destroy.mockClear();
  vi.clearAllMocks();
  postAction2.mockResolvedValue({ errors: [] });
  postAction.mockResolvedValue({});
  cdmsExec.mockResolvedValue({});
  (api.cdmsGetChildren as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

/* ── Invio nel form ───────────────────────────────────────────────────── */

/**
 * Il browser invia con Invio un <form> se ha un pulsante submit, o se ha un solo campo
 * che blocca l'invio implicito (HTML, "implicit submission"); altrimenti Invio non fa
 * niente, a meno che un campo non lo gestisca da se' con onPressEnter.
 */
function invioInvia(html: string, submit: ReturnType<typeof vi.fn>): boolean {
  const form = /<form\b[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
  expect(form, 'form non reso').not.toBe('');
  if (pulsanti(form).some((p) => p.tipo === 'submit')) return true;
  const bloccanti = [...form.matchAll(/<input\b([^>]*)>/g)].filter((m) => {
    const t = /\btype="([^"]*)"/.exec(m[1])?.[1] ?? 'text';
    return !['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(t);
  });
  if (bloccanti.length === 1) return true;
  for (const i of cap.input) (i.onPressEnter as AnyFn | undefined)?.({ preventDefault() {} });
  return submit.mock.calls.length > 0;
}

/* ── Finestre ─────────────────────────────────────────────────────────── */

describe('SXADV-5779 ChangePasswordModal', () => {
  const rendi = () => {
    const onClose = vi.fn();
    const onServerErrors = vi.fn();
    const html = renderToStaticMarkup(<ChangePasswordModal open onClose={onClose} onServerErrors={onServerErrors} />);
    const footer = cap.modali[0].footer;
    const form = cap.form[0];
    return { html, footer, onClose, onServerErrors, form, istanza: cap.istanze[0] };
  };

  it('Cambia Password, poi Annulla ultimo nel DOM', () => {
    expect(nomi(delFooter(rendi().html))).toEqual(['Cambia Password', 'Annulla']);
  });

  it('il dominante resta primario, Annulla no', () => {
    const [ok, no] = delFooter(rendi().html);
    expect(primario(ok)).toBe(true);
    expect(primario(no)).toBe(false);
  });

  it('Annulla non e\' un submit: il form non puo\' partire da li\'', () => {
    expect(delFooter(rendi().html)[1].tipo).toBe('button');
  });

  it('Annulla chiude senza inviare', () => {
    const r = rendi();
    reso(bottoneDi(r.footer, 'Annulla'));
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(r.istanza.submit).not.toHaveBeenCalled();
    expect(postAction2).not.toHaveBeenCalled();
  });

  it('la X della finestra fa come Annulla', () => {
    const r = rendi();
    (cap.modali[0].onCancel as AnyFn)();
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(postAction2).not.toHaveBeenCalled();
  });

  it('Cambia Password invia il form e non chiude da sola', () => {
    const r = rendi();
    reso(bottoneDi(r.footer, 'Cambia Password'));
    expect(r.istanza.submit).toHaveBeenCalledTimes(1);
    expect(r.onClose).not.toHaveBeenCalled();
  });

  it('il form validato manda ChangePassword2 e chiude', async () => {
    const r = rendi();
    await (r.form.onFinish as AnyFn)({ oldpwd: 'a', newpwd: 'b', newpwd2: 'b' });
    expect(postAction2).toHaveBeenCalledWith('ChangePassword2', { oldpwd: 'a', newpwd: 'b', newpwd2: 'b' });
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });

  it('un errore del server lascia la finestra aperta', async () => {
    postAction2.mockResolvedValue({ errors: [{ type: 'ERROR', message: 'no' }] });
    const r = rendi();
    await (r.form.onFinish as AnyFn)({ oldpwd: 'a', newpwd: 'b', newpwd2: 'b' });
    expect(r.onServerErrors).toHaveBeenCalledTimes(1);
    expect(r.onClose).not.toHaveBeenCalled();
  });

  // Fuori da SXADV-5779: Invio non invia, difetto preesistente, sulla lavagna (azioni-invio-form).
  it.skip('Invio in un campo invia il form', () => {
    const r = rendi();
    expect(invioInvia(r.html, r.istanza.submit as ReturnType<typeof vi.fn>)).toBe(true);
  });
});

describe('SXADV-5779 ImpersonateModal', () => {
  const rendi = () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const html = renderToStaticMarkup(<ImpersonateModal open onClose={onClose} onSuccess={onSuccess} />);
    return { html, footer: cap.modali[0].footer, onClose, onSuccess, form: cap.form[0], istanza: cap.istanze[0] };
  };

  it('Impersona, poi Annulla ultimo nel DOM', () => {
    expect(nomi(delFooter(rendi().html))).toEqual(['Impersona', 'Annulla']);
  });

  it('il dominante resta primario, Annulla no e non e\' un submit', () => {
    const [ok, no] = delFooter(rendi().html);
    expect(primario(ok)).toBe(true);
    expect(primario(no)).toBe(false);
    expect(no.tipo).toBe('button');
  });

  it('Annulla chiude senza inviare e senza impersonare', () => {
    const r = rendi();
    reso(bottoneDi(r.footer, 'Annulla'));
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(r.onSuccess).not.toHaveBeenCalled();
    expect(r.istanza.submit).not.toHaveBeenCalled();
    expect(postAction2).not.toHaveBeenCalled();
  });

  it('Impersona invia il form', () => {
    const r = rendi();
    reso(bottoneDi(r.footer, 'Impersona'));
    expect(r.istanza.submit).toHaveBeenCalledTimes(1);
    expect(r.onClose).not.toHaveBeenCalled();
  });

  it('il form validato manda Impersonate e chiude', async () => {
    const r = rendi();
    await (r.form.onFinish as AnyFn)({ username: ' mario ' });
    expect(postAction2).toHaveBeenCalledWith('Impersonate', { username: 'mario' });
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(r.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('Invio nel campo invia il form (promesso dal commento del componente)', () => {
    const r = rendi();
    expect(invioInvia(r.html, r.istanza.submit as ReturnType<typeof vi.fn>)).toBe(true);
  });
});

describe('SXADV-5779 AddWidgetModal', () => {
  const BOZZA = { widget: { titolo: 'W', intervalloMin: 60 }, sorgente: { filtri: [], colonne: [] } };
  const rendi = (bozza?: unknown) => {
    cap.statoNull = bozza;
    const onClose = vi.fn();
    const onAggiunto = vi.fn();
    const html = renderToStaticMarkup(<AddWidgetModal open sid="S1" onClose={onClose} onAggiunto={onAggiunto} />);
    return { html, onClose, onAggiunto, m: cap.modali[0], istanza: cap.istanze[0] };
  };

  it('Aggiungi, poi Annulla ultimo nel DOM (a bozza caricata e no)', () => {
    expect(nomi(delFooter(rendi().html))).toEqual(['Aggiungi', 'Annulla']);
    cap.modali.length = 0;
    expect(nomi(delFooter(rendi(BOZZA).html))).toEqual(['Aggiungi', 'Annulla']);
  });

  it('il dominante resta primario, Annulla no', () => {
    const [ok, no] = delFooter(rendi(BOZZA).html);
    expect(primario(ok)).toBe(true);
    expect(primario(no)).toBe(false);
    expect(no.tipo).toBe('button');
  });

  it('Annulla chiude senza salvare', () => {
    const r = rendi(BOZZA);
    (r.m.onCancel as AnyFn)();
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(r.onAggiunto).not.toHaveBeenCalled();
    expect(postAction2).not.toHaveBeenCalled();
  });

  it('Aggiungi invia il form; validato salva e chiude', async () => {
    postAction2.mockResolvedValue({ esito: 'ok', widget: { idWidget: 1 } });
    const r = rendi(BOZZA);
    (r.m.onOk as AnyFn)();
    expect(r.istanza.submit).toHaveBeenCalledTimes(1);
    await (cap.form[0].onFinish as AnyFn)({ titolo: ' Nome ', intervallo: 30 });
    expect(postAction2).toHaveBeenCalledTimes(1);
    expect(postAction2.mock.calls[0][0]).toBe('dashboard.AddWidget');
    expect(postAction2.mock.calls[0][1]).toMatchObject({ sid: 'S1', titolo: 'Nome', intervallo: '30' });
    expect(postAction2.mock.calls[0][1]).not.toHaveProperty('anteprima');
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(r.onAggiunto).toHaveBeenCalledTimes(1);
  });

  // Fuori da SXADV-5779: Invio non invia, difetto preesistente, sulla lavagna (azioni-invio-form).
  it.skip('Invio nel nome del widget invia il form', () => {
    const r = rendi(BOZZA);
    expect(invioInvia(r.html, r.istanza.submit as ReturnType<typeof vi.fn>)).toBe(true);
  });
});

/* ── Conferme ─────────────────────────────────────────────────────────── */

describe('SXADV-5779 antd da solo mette Annulla prima (per questo serve il footer)', () => {
  it('modal.confirm senza footer: Annulla, poi OK', () => {
    expect(nomi(conferma({ okText: 'OK', cancelText: 'Annulla', title: 't' }))).toEqual(['Annulla', 'OK']);
  });
});

describe('SXADV-5779 Toolbar: conferma di cancellazione', () => {
  const apri = () => {
    const onAction = vi.fn();
    const items = [{ id: 'd', text: 'Cancella', handler: "confirmDelete.createCallback('S1-0.1','Delete','K9')" }];
    renderToStaticMarkup(<Toolbar items={items as never} onAction={onAction} />);
    reso(cap.bottoni.find((b) => testoDi(b.children).trim() === 'Cancella') as Props);
    return { onAction, cfg: cap.conferme[0] };
  };

  it('OK, poi Annulla ultimo; OK primario', () => {
    const p = conferma(apri().cfg);
    expect(nomi(p)).toEqual(['OK', 'Annulla']);
    expect(primario(p[0])).toBe(true);
    expect(primario(p[1])).toBe(false);
  });

  it('OK manda il comando, Annulla no', () => {
    const { onAction, cfg } = apri();
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(onAction).not.toHaveBeenCalled();
    (cfg.onOk as AnyFn)();
    expect(onAction).toHaveBeenCalledWith('Delete', { navpath: 'S1-0.1', option1: 'K9' });
  });
});

describe('SXADV-5779 EditPanel: Cancellare la riga?', () => {
  const apri = () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderToStaticMarkup(
      <EditPanel
        panel={{ rows: [] } as never}
        listUi={{} as never}
        rowPath="S1-0.3"
        canDelete
        formShape={false}
        onAction={onAction}
        onClose={onClose}
      />,
    );
    reso(cap.bottoni.find((b) => testoDi(b.children).trim() === 'Cancella') as Props);
    return { onAction, onClose, cfg: cap.conferme[0] };
  };

  it('Cancella, poi Annulla ultimo; Cancella resta pericoloso', () => {
    const p = conferma(apri().cfg);
    expect(nomi(p)).toEqual(['Cancella', 'Annulla']);
    expect(pericolo(p[0])).toBe(true);
    expect(pericolo(p[1])).toBe(false);
  });

  it('Annulla non manda niente e il pannello resta', () => {
    const { onAction, onClose, cfg } = apri();
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(onAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancella manda il Delete sul navpath della riga', () => {
    const { onAction, cfg } = apri();
    (cfg.onOk as AnyFn)();
    expect(onAction.mock.calls[0][0]).toBe('Delete');
    expect(onAction.mock.calls[0][1]).toMatchObject({ navpath: 'S1-0.3', option1: 'null' });
  });
});

describe('SXADV-5779 AttachmentsDrawer: Eliminare allegato?', () => {
  const apri = () => {
    const onRefresh = vi.fn();
    renderToStaticMarkup(
      <AttachmentsDrawerLibero open sid="S1" info={{ allowList: false }} onClose={() => {}} onRefresh={onRefresh} />,
    );
    const elimina = cap.callback.find((f) => String(f).includes('Eliminare allegato?')) as AnyFn;
    elimina({ key: 'K1', fileName: 'a.pdf' });
    return { onRefresh, cfg: cap.conferme[0] };
  };

  it('Elimina, poi Annulla ultimo; Elimina resta pericoloso', () => {
    const p = conferma(apri().cfg);
    expect(nomi(p)).toEqual(['Elimina', 'Annulla']);
    expect(pericolo(p[0])).toBe(true);
    expect(pericolo(p[1])).toBe(false);
  });

  it('Annulla non cancella, Elimina si\'', async () => {
    const { cfg } = apri();
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(postAction).not.toHaveBeenCalled();
    await (cfg.onOk as AnyFn)();
    expect(postAction).toHaveBeenCalledWith('CdmsDelete', { key: 'K1' }, undefined, 'S1');
  });
});

describe('SXADV-5779 CdmsTree', () => {
  const apri = (sorgente: string, nodo: Props) => {
    renderToStaticMarkup(<CdmsTreeLibero collapsed={false} onFolderClick={() => {}} />);
    const h = cap.callback.find((f) => String(f).includes(sorgente)) as AnyFn;
    h(nodo);
    return cap.conferme[0];
  };
  const NODO = { key: 'N1', title: 'Vecchio' };

  it.each([
    ['Nuova cartella', 'Crea'],
    ['Rinomina cartella', 'Rinomina'],
  ])('%s: %s, poi Annulla ultimo; primario', (titolo, azione) => {
    const p = conferma(apri(titolo, NODO));
    expect(nomi(p)).toEqual([azione, 'Annulla']);
    expect(primario(p[0])).toBe(true);
    expect(primario(p[1])).toBe(false);
  });

  it('Elimina cartella: Elimina, poi Annulla ultimo; pericoloso', () => {
    const p = conferma(apri('Elimina cartella', NODO));
    expect(nomi(p)).toEqual(['Elimina', 'Annulla']);
    expect(pericolo(p[0])).toBe(true);
  });

  it('Nuova cartella: Annulla non crea, Crea si\'', async () => {
    const cfg = apri('Nuova cartella', NODO);
    const campo = cfg.content as { props: Props };
    (campo.props.onChange as AnyFn)({ target: { value: ' Fatture ' } });
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(cdmsExec).not.toHaveBeenCalled();
    await (cfg.onOk as AnyFn)();
    expect(cdmsExec).toHaveBeenCalledWith('newdir', { path: 'N1', text: 'Fatture' });
  });

  it('Rinomina: Annulla non rinomina, Rinomina si\'', async () => {
    const cfg = apri('Rinomina cartella', NODO);
    const campo = cfg.content as { props: Props };
    (campo.props.onChange as AnyFn)({ target: { value: 'Nuovo' } });
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(cdmsExec).not.toHaveBeenCalled();
    await (cfg.onOk as AnyFn)();
    expect(cdmsExec).toHaveBeenCalledWith('rename', { path: 'N1', newname: 'Nuovo' });
  });

  it('Elimina cartella: Annulla non cancella, Elimina si\'', async () => {
    const cfg = apri('Elimina cartella', NODO);
    (cfg.onCancel as AnyFn | undefined)?.();
    expect(cdmsExec).not.toHaveBeenCalled();
    await (cfg.onOk as AnyFn)();
    expect(cdmsExec).toHaveBeenCalledWith('delete', { path: 'N1' });
  });

  // Fuori da SXADV-5779: Invio chiude e perde il nome, difetto preesistente, sulla lavagna (azioni-invio-form).
  it.skip.each([
    ['Nuova cartella', 'newdir'],
    ['Rinomina cartella', 'rename'],
  ])('Invio nel campo di %s fa quello che fa il pulsante, non butta il testo', async (titolo, comando) => {
    const cfg = apri(titolo, NODO);
    const campo = cfg.content as { props: Props };
    (campo.props.onChange as AnyFn)({ target: { value: 'Testo' } });
    (campo.props.onPressEnter as AnyFn)({});
    await dormi();
    expect(cdmsExec.mock.calls.map((c) => c[0])).toEqual([comando]);
  });
});

describe('SXADV-5779 feedback', () => {
  const prendi = () => {
    const presi: Array<ReturnType<typeof useFeedback>> = [];
    const Sonda = ({ prendi }: { prendi: (f: ReturnType<typeof useFeedback>) => void }) => {
      prendi(useFeedback());
      return null;
    };
    renderToStaticMarkup(<Sonda prendi={(f) => presi.push(f)} />);
    return presi[0];
  };

  it('feedback.confirm: OK, poi Annulla ultimo; OK primario', () => {
    prendi().confirm('D?', 'T', () => {});
    const p = conferma(cap.conferme[0]);
    expect(nomi(p)).toEqual(['OK', 'Annulla']);
    expect(primario(p[0])).toBe(true);
  });

  it('CONFIRMATION del server: OK, poi Annulla ultimo', () => {
    prendi().showServerMessages([{ type: 'CONFIRMATION', message: 'Sicuro?', mnemonic: 'M' }] as never, {});
    expect(nomi(conferma(cap.conferme[0]))).toEqual(['OK', 'Annulla']);
  });

  it('YESNOCANCEL del server: Sì, No, Annulla ultimo; Sì primario', () => {
    prendi().showServerMessages([{ type: 'YESNOCANCEL', message: 'Sicuro?', mnemonic: 'M' }] as never, {});
    const p = conferma(cap.conferme[0]);
    expect(nomi(p)).toEqual(['Sì', 'No', 'Annulla']);
    expect(primario(p[0])).toBe(true);
    expect(primario(p[1])).toBe(false);
    expect(primario(p[2])).toBe(false);
  });

  it('i pulsanti rispondono: OK = yes, Annulla = onCancel', () => {
    const onAnswer = vi.fn();
    const onCancel = vi.fn();
    prendi().showServerMessages([{ type: 'CONFIRMATION', message: 'S?', mnemonic: 'M' }] as never, { onAnswer, onCancel });
    (cap.conferme[0].onCancel as AnyFn)();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
    (cap.conferme[0].onOk as AnyFn)();
    expect(onAnswer.mock.calls[0][1]).toBe('yes');
  });
});

/* ── Drawer ───────────────────────────────────────────────────────────── */

describe('SXADV-5779 MultiSelectControl: pannello di selezione', () => {
  const rendi = () => {
    const onChange = vi.fn();
    const control = { name: 'c', controlName: 'c', prompt: 'Scelta', options: [] };
    renderToStaticMarkup(
      <MultiSelectControl control={control as never} editable value="a,b" onChange={onChange} onAction={() => {}} />,
    );
    return { onChange, extra: cap.drawer[0].extra };
  };

  it('Conferma, poi Annulla ultimo nel DOM; Conferma primario', () => {
    const p = pulsanti(renderToStaticMarkup(<>{rendi().extra as React.ReactNode}</>));
    expect(nomi(p).map((n) => n.replace(/\s*\(.*/, ''))).toEqual(['Conferma', 'Annulla']);
    expect(primario(p[0])).toBe(true);
    expect(primario(p[1])).toBe(false);
  });

  it('Annulla chiude il pannello e la selezione non cambia', () => {
    const r = rendi();
    cap.setter.length = 0;
    reso(bottoneDi(r.extra, 'Annulla'));
    expect(cap.setter.map((s) => s.valore)).toEqual([false]);
    expect(r.onChange).not.toHaveBeenCalled();
  });

  it('Conferma applica la selezione e chiude', () => {
    const r = rendi();
    cap.setter.length = 0;
    reso(bottoneDi(r.extra, 'Conferma'));
    expect(r.onChange).toHaveBeenCalledTimes(1);
    expect(r.onChange.mock.calls[0][0]).toContain('a,b');
    expect(cap.setter.some((s) => s.iniziale === false && s.valore === false)).toBe(true);
  });
});

describe('SXADV-5779 ModificaWidget', () => {
  const WIDGET = { idWidget: 7, titolo: 'T', forma: 'list', sorgente: { colonne: [] } };
  const BOZZA = {
    titolo: ' Titolo ', forma: 'list', gruppo: null, agg: 'count', col: null, conFiltro: false, op: '>', valore: 0,
    outAgg: 'count', topN: 10, resto: 'altri', sale: 'neutro', scende: 'neutro', escludi: [], vistaDettaglio: '',
    ambito: 'corrente', aziendeScelte: [], intervallo: 60, condivisione: 'privato', mandato: false,
    colonneDettaglio: [], date: {},
  };
  const rendi = (bozza?: unknown) => {
    cap.statoNull = bozza;
    const onClose = vi.fn();
    const onSalvato = vi.fn();
    renderToStaticMarkup(<ModificaWidgetLibero widget={WIDGET} sid="S1" onClose={onClose} onSalvato={onSalvato} />);
    return { onClose, onSalvato, footer: cap.drawer[0].footer };
  };

  it('Salva, poi Annulla ultimo nel DOM; Salva primario', () => {
    const p = pulsanti(renderToStaticMarkup(<>{rendi().footer as React.ReactNode}</>));
    expect(nomi(p)).toEqual(['Salva', 'Annulla']);
    expect(primario(p[0])).toBe(true);
    expect(primario(p[1])).toBe(false);
  });

  it('Annulla chiude senza salvare', () => {
    const r = rendi();
    reso(bottoneDi(r.footer, 'Annulla'));
    expect(r.onClose).toHaveBeenCalledTimes(1);
    expect(postAction2).not.toHaveBeenCalled();
  });

  it('Salva manda dashboard.Save e avvisa chi ha aperto', async () => {
    postAction2.mockResolvedValue({ esito: 'ok' });
    const r = rendi(BOZZA);
    reso(bottoneDi(r.footer, 'Salva'));
    await dormi();
    expect(postAction2.mock.calls.map((c) => c[0])).toEqual(['dashboard.Save']);
    expect(postAction2.mock.calls[0][1]).toMatchObject({ sid: 'S1', idWidget: '7', titolo: 'Titolo' });
    expect(r.onSalvato).toHaveBeenCalledWith(7, 'Titolo');
  });
});
