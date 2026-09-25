import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl, UITree } from '../types/ui';
import { extractFormValues, applyPendingValues } from './pendingEdits';
import { registerBuiltinControls } from '../controls/builtins/index';
import { controls } from '../controls/registry';
import type { ControlComponent } from '../controls/types';

// SXADV-5989 — andata e ritorno per ogni tipo di controllo registrato:
//   1. il controllo si rende dal `control` del server;
//   2. l'utente modifica: in formValues finisce quello che il controllo scrive
//      con onChange (qui riprodotto a mano, stesso formato: vedi i commenti);
//   3. cambio scheda e ritorno: il controllo si rimonta da
//      applyPendingValues(ui, formValues, labels) — e il markup deve mostrare
//      il valore modificato, non quello del server.
// Niente DOM: il markup si legge col render lato server, come negli altri test
// dei controlli (MapControl.sxadv5969.test.tsx).

registerBuiltinControls();

const VS = 'S1-0';
const NAME = `campo.${VS}`;

function uiOf(control: Partial<UIControl>, pageType = 2): UITree {
  const c = { name: NAME, id: 'campo', editable: true, ...control } as UIControl;
  return { rows: [{ id: 'r0', cells: [{ elementType: 1, control: c }] }], pageType, path: VS } as UITree;
}

function controlOf(ui: UITree): UIControl {
  return ui.rows[0].cells[0].control!;
}

function render(ui: UITree): string {
  const control = controlOf(ui);
  const C = controls[control.type] as ControlComponent | undefined;
  if (!C) throw new Error(`tipo ${control.type} non registrato`);
  return renderToStaticMarkup(
    <C control={control} pageType={ui.pageType} onAction={() => {}} onChange={() => {}} />,
  );
}

/** Rende prima e dopo il ritorno sulla scheda. `edited` e' la stringa che il
 *  controllo scrive in formValues (Shell.handleFieldChange la converte con
 *  String(), null -> ''). */
function roundTrip(
  control: Partial<UIControl>,
  edited: string,
  opts: { labels?: Record<string, string>; pageType?: number } = {},
): { before: string; after: string; ui: UITree } {
  const ui = uiOf(control, opts.pageType);
  const before = render(ui);
  const formValues = { ...extractFormValues(ui), [NAME]: edited };
  const back = applyPendingValues(ui, formValues, opts.labels);
  return { before, after: render(back), ui: back };
}

const inputValue = (html: string): string | undefined => html.match(/<input[^>]*\svalue="([^"]*)"/)?.[1];

// ─────────────────────────────────────────────────────── campi di testo
describe('andata e ritorno: campi di testo', () => {
  it.each(['text', 'alternateKey', 'colorPalette'])('%s', (type) => {
    const { before, after } = roundTrip({ type, value: 'server' }, 'scritto a mano');
    expect(inputValue(before)).toBe('server');
    expect(inputValue(after)).toBe('scritto a mano');
  });

  it('text su record nuovo (valore null)', () => {
    const { after } = roundTrip({ type: 'text', value: null }, 'nuovo');
    expect(inputValue(after)).toBe('nuovo');
  });

  it('text svuotato: vuoto, non il valore del server', () => {
    const { after } = roundTrip({ type: 'text', value: 'server' }, '');
    expect(inputValue(after)).toBe('');
  });

  it('text maiuscolo: TextControl memorizza il maiuscolo', () => {
    const { after } = roundTrip({ type: 'text', value: null, uppercase: true }, 'ABC12');
    expect(inputValue(after)).toBe('ABC12');
  });

  it('password', () => {
    const { before, after } = roundTrip({ type: 'password', value: '' }, 'segreto');
    expect(inputValue(before)).toBe('');
    expect(after).toMatch(/type="password"[^>]*value="segreto"/);
  });

  it('textarea (piu\' righe)', () => {
    const { before, after } = roundTrip({ type: 'textarea', value: 'prima' }, 'riga uno\nriga due');
    expect(before).toContain('>prima</textarea>');
    expect(after).toContain('>riga uno\nriga due</textarea>');
  });

  it('durata', () => {
    const { after } = roundTrip({ type: 'durata', value: '1:00' }, '2:30');
    expect(inputValue(after)).toBe('2:30');
  });

  it('expbuilder', () => {
    const { before, after } = roundTrip({ type: 'expbuilder', value: 'a.b' }, 'a.b + c.d');
    expect(before).toContain('>a.b</textarea>');
    expect(after).toContain('>a.b + c.d</textarea>');
  });
});

// ────────────────────────────────────────────────────── date, ore, numeri
describe('andata e ritorno: date, ore, numeri', () => {
  it('date (il DatePicker scrive la stringa formattata)', () => {
    const { before, after } = roundTrip({ type: 'date', value: '05/07/2026', format: 'dd/MM/yyyy' }, '31/12/2026');
    expect(inputValue(before)).toBe('05/07/2026');
    expect(inputValue(after)).toBe('31/12/2026');
  });

  it('date su record nuovo', () => {
    const { after } = roundTrip({ type: 'date', value: null, format: 'dd/MM/yyyy' }, '01/02/2026');
    expect(inputValue(after)).toBe('01/02/2026');
  });

  it('time', () => {
    const { after } = roundTrip({ type: 'time', value: null }, '10:30');
    expect(inputValue(after)).toBe('10:30');
  });

  it('timestamp', () => {
    const { after } = roundTrip({ type: 'timestamp', value: '05/07/2026 10:30', format: 'dd/MM/yyyy HH:mm' }, '06/07/2026 08:15');
    expect(inputValue(after)).toBe('06/07/2026 08:15');
  });

  it('number (formato italiano con migliaia)', () => {
    const { before, after } = roundTrip({ type: 'number', value: '12', decimals: 0 }, '1.234');
    expect(inputValue(before)).toBe('12');
    expect(after).toMatch(/aria-valuenow="1234"/);
  });

  it('money: "1.234,50" scritto dal controllo torna come 1234,50', () => {
    const { before, after } = roundTrip(
      { type: 'money', value: '10,00', decimals: 2, format: '#,##0.00', currencySymbol: '€' },
      '1.234,50',
    );
    expect(inputValue(before)).toBe('10,00');
    expect(after).toMatch(/aria-valuenow="1234.5"/);
    expect(inputValue(after)).toBe('1234,50');
  });

  it('money svuotato (store(null) -> \'\'): campo vuoto', () => {
    const { after } = roundTrip({ type: 'money', value: '10,00', decimals: 2, format: '#,##0.00' }, '');
    expect(inputValue(after)).toBe('');
  });
});

// ───────────────────────────────────────────────────────── caselle
const checked = (html: string) => /<input[^>]*type="checkbox"[^>]*checked=""/.test(html);
const indeterminate = (html: string) => html.includes('ant-checkbox-indeterminate');

describe('andata e ritorno: caselle di spunta', () => {
  it.each(['boolean', 'checkbox', 'toggleVisibilityFilter', 'visibilityFilter'])('%s false -> true', (type) => {
    const { before, after } = roundTrip({ type, value: false }, 'true');
    expect(checked(before)).toBe(false);
    expect(checked(after)).toBe(true);
  });

  it('boolean true -> false', () => {
    const { before, after } = roundTrip({ type: 'boolean', value: true }, 'false');
    expect(checked(before)).toBe(true);
    expect(checked(after)).toBe(false);
  });

  it('boolean null (record nuovo) -> true', () => {
    const { after } = roundTrip({ type: 'boolean', value: null }, 'true');
    expect(checked(after)).toBe(true);
  });

  it('ricerca, tre stati: vuota -> true', () => {
    const { before, after } = roundTrip({ type: 'boolean', value: null }, 'true', { pageType: 0 });
    expect(indeterminate(before)).toBe(true);
    expect(checked(after)).toBe(true);
    expect(indeterminate(after)).toBe(false);
  });

  it('ricerca, tre stati: true -> false (spenta, non indeterminata)', () => {
    const { after } = roundTrip({ type: 'boolean', value: 'true' }, 'false', { pageType: 0 });
    expect(checked(after)).toBe(false);
    expect(indeterminate(after)).toBe(false);
  });

  it('ricerca, tre stati: false -> vuota (null scritto come \'\')', () => {
    const { after } = roundTrip({ type: 'boolean', value: 'false' }, '', { pageType: 0 });
    expect(indeterminate(after)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────── combo
/** Il testo mostrato come valore scelto di un Select antd. */
const shownCaption = (html: string) => html.match(/ant-select-content-has-value" title="([^"]*)"/)?.[1];

describe('andata e ritorno: combo', () => {
  const OPTIONS = [{ value: 'A', text: 'Alfa' }, { value: 'B', text: 'Beta' }, { value: 'C', text: 'Gamma' }];

  it('combo locale: mostra la didascalia della voce scelta', () => {
    const { before, after } = roundTrip({ type: 'combo', value: 'A', options: OPTIONS }, 'C');
    expect(shownCaption(before)).toBe('Alfa');
    expect(shownCaption(after)).toBe('Gamma');
  });

  it('combo locale su record nuovo', () => {
    const { after } = roundTrip({ type: 'combo', value: null, options: OPTIONS }, 'B');
    expect(shownCaption(after)).toBe('Beta');
  });

  it('combo locale svuotato: nessuna voce mostrata', () => {
    const { after } = roundTrip({ type: 'combo', value: 'A', options: OPTIONS }, '');
    expect(shownCaption(after)).toBeUndefined();
    expect(after).not.toContain('Alfa');
  });

  const REMOTE = { type: 'combo', remote: true, controlName: 'cliente', value: 'C01', displayText: 'ROSSI MARIO' };

  it('combo remoto (lookup): la DIDASCALIA della voce scelta, non il codice', () => {
    const { before, after } = roundTrip(REMOTE, 'C02', { labels: { [NAME]: 'BIANCHI LUCA' } });
    expect(shownCaption(before)).toBe('ROSSI MARIO');
    expect(shownCaption(after)).toBe('BIANCHI LUCA');
    expect(after).not.toContain('ROSSI MARIO');
  });

  it('combo remoto su record nuovo', () => {
    const { after } = roundTrip({ ...REMOTE, value: null, displayText: undefined }, 'C02', { labels: { [NAME]: 'BIANCHI LUCA' } });
    expect(shownCaption(after)).toBe('BIANCHI LUCA');
  });

  it('combo remoto svuotato (didascalia vuota): non ricompare la didascalia del server', () => {
    const { after } = roundTrip(REMOTE, '', { labels: { [NAME]: '' } });
    expect(shownCaption(after)).toBeUndefined();
    expect(after).not.toContain('ROSSI MARIO');
  });
});

// ─────────────────────────────────────────────────────── multiselect
const chips = (html: string) => [...html.matchAll(/multiselect-chip [^>]*>([^<]*)</g)].map((m) => m[1]);

describe('andata e ritorno: multiselect', () => {
  const OPTIONS = [{ value: 'A', text: 'Alfa' }, { value: 'B', text: 'Beta' }, { value: 'C', text: 'Gamma' }];

  it('elenco a codici (opzioni statiche): le pastiglie della selezione nuova', () => {
    const { before, after } = roundTrip({ type: 'multiselect', value: 'A', options: OPTIONS }, 'B,C');
    expect(chips(before)).toEqual(['Alfa']);
    expect(chips(after)).toEqual(['Beta', 'Gamma']);
  });

  it('selezione svuotata: nessuna pastiglia', () => {
    const { after } = roundTrip({ type: 'multiselect', value: 'A,B', options: OPTIONS }, '');
    expect(chips(after)).toEqual([]);
    expect(after).toContain('Clicca per selezionare');
  });
});

// ──────────────────────────────────────────────────────── area HTML
describe('andata e ritorno: htmlarea', () => {
  // TipTap non crea l'editor nel render lato server (resta un <div> vuoto),
  // quindi qui si prova solo che il controllo rimontato riceva il markup
  // scritto: HtmlAreaControl parte da `content: control.value` e lo
  // riallinea quando control.value cambia.
  it('il controllo rimontato riceve il markup scritto', () => {
    const { ui } = roundTrip({ type: 'htmlarea', value: '<p>prima</p>' }, '<p>dopo</p>');
    expect(controlOf(ui).value).toBe('<p>dopo</p>');
  });
});

// ─────────────────────────────── controlli non modificabili: nulla cambia
describe('andata e ritorno: sola lettura', () => {
  it('un campo di sola lettura resta col valore del server anche se in formValues c\'e\' altro', () => {
    const ui = uiOf({ type: 'text', value: 'server', editable: false });
    const back = applyPendingValues(ui, { [NAME]: 'altro' });
    expect(back).toBe(ui);
  });
});
