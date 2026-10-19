import { describe, it, expect } from 'vitest';
import {
  comboFromToolbarKeys,
  comboLabel,
  keyNameFromKeyCode,
  toolbarTooltip,
} from './toolbarKeys';

// SXADV-5749: il tooltip di un bottone di toolbar porta il suo acceleratore
// fra parentesi ("Salva (F9)"), come lo dichiara il server con keys/shift.
// I keyCode sono quelli di Toolbar.KEY_* in CORE: 113 F2 Nuovo, 116 F5
// Ricarica dati, 119 F8 Esegui, 120 F9 Salva, 121 F10 Salva e Nuovo.

describe('toolbarTooltip — i tasti del contratto', () => {
  it.each([
    ['Salva', [120], 'Salva (F9)'],
    ['Salva e Nuovo', [121], 'Salva e Nuovo (F10)'],
    ['Ricarica dati', [116], 'Ricarica dati (F5)'],
    ['Nuovo', [113], 'Nuovo (F2)'],
    ['Esegui', [119], 'Esegui (F8)'],
  ])('%s con %j → %s', (tooltip, keys, expected) => {
    expect(toolbarTooltip(tooltip, keys)).toBe(expected);
    expect(toolbarTooltip(tooltip, keys, false)).toBe(expected);
    expect(toolbarTooltip(tooltip, keys, false, false)).toBe(expected);
  });

  it('Salva e Nuovo non mostra più Shift+F9 quando il server manda F10 senza shift', () => {
    const t = toolbarTooltip('Salva e Nuovo', [121], false);
    expect(t).not.toMatch(/Shift/);
    expect(t).toBe('Salva e Nuovo (F10)');
  });
});

describe('toolbarTooltip — forme di keys', () => {
  it('accetta il keyCode come numero nudo', () => {
    expect(toolbarTooltip('Salva', 120)).toBe('Salva (F9)');
  });

  it('accetta il keyCode come stringa', () => {
    expect(toolbarTooltip('Salva', '120')).toBe('Salva (F9)');
  });

  it('accetta un array con il keyCode come stringa', () => {
    expect(toolbarTooltip('Salva e Nuovo', ['121'])).toBe('Salva e Nuovo (F10)');
  });

  it('usa il primo keyCode di un array', () => {
    expect(toolbarTooltip('Nuovo', [113, 120])).toBe('Nuovo (F2)');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['array vuoto', []],
    ['stringa non numerica', 'abc'],
    ['keyCode sconosciuto', [999]],
    ['NaN', [Number.NaN]],
  ])('senza un tasto utilizzabile (%s) resta il tooltip nudo', (_label, keys) => {
    expect(toolbarTooltip('Salva', keys)).toBe('Salva');
  });
});

describe('toolbarTooltip — shift, disabled, tooltip mancante', () => {
  it('con shift mostra la combo con il modificatore', () => {
    expect(toolbarTooltip('Salva', [120], true)).toBe('Salva (Shift+F9)');
  });

  it('un bottone disabilitato non annuncia un tasto che non fa nulla', () => {
    expect(toolbarTooltip('Salva', [120], false, true)).toBe('Salva');
    expect(toolbarTooltip('Salva e Nuovo', [121], true, true)).toBe('Salva e Nuovo');
  });

  it('disabled=false esplicito equivale ad assente', () => {
    expect(toolbarTooltip('Esegui', [119], undefined, false)).toBe('Esegui (F8)');
  });

  it('tooltip undefined resta undefined, anche con un tasto', () => {
    expect(toolbarTooltip(undefined, [120])).toBeUndefined();
    expect(toolbarTooltip(undefined, undefined)).toBeUndefined();
    expect(toolbarTooltip(undefined, [120], true, false)).toBeUndefined();
  });

  it('non mette mai il keyCode grezzo nel tooltip', () => {
    for (const code of [113, 116, 119, 120, 121]) {
      expect(toolbarTooltip('X', [code])).not.toContain(String(code));
    }
  });
});

describe('export esistenti di toolbarKeys (non regrediscono)', () => {
  it('keyNameFromKeyCode traduce i tasti funzione', () => {
    expect(keyNameFromKeyCode(112)).toBe('F1');
    expect(keyNameFromKeyCode(113)).toBe('F2');
    expect(keyNameFromKeyCode(116)).toBe('F5');
    expect(keyNameFromKeyCode(119)).toBe('F8');
    expect(keyNameFromKeyCode(120)).toBe('F9');
    expect(keyNameFromKeyCode(121)).toBe('F10');
    expect(keyNameFromKeyCode(123)).toBe('F12');
  });

  it('keyNameFromKeyCode: nomi, cifre, lettere, sconosciuti', () => {
    expect(keyNameFromKeyCode(13)).toBe('Enter');
    expect(keyNameFromKeyCode(27)).toBe('Escape');
    expect(keyNameFromKeyCode(48)).toBe('0');
    expect(keyNameFromKeyCode(97)).toBe('1');
    expect(keyNameFromKeyCode(65)).toBe('A');
    expect(keyNameFromKeyCode(999)).toBeNull();
  });

  it('comboFromToolbarKeys: le forme di keys e lo shift', () => {
    expect(comboFromToolbarKeys([120])).toBe('F9');
    expect(comboFromToolbarKeys([120], true)).toBe('Shift+F9');
    expect(comboFromToolbarKeys([121], false)).toBe('F10');
    expect(comboFromToolbarKeys(116)).toBe('F5');
    expect(comboFromToolbarKeys('113')).toBe('F2');
    expect(comboFromToolbarKeys(['119'])).toBe('F8');
    expect(comboFromToolbarKeys(null)).toBeNull();
    expect(comboFromToolbarKeys([])).toBeNull();
    expect(comboFromToolbarKeys([999])).toBeNull();
  });

  it('comboLabel: Spazio ha un nome, il resto passa uguale', () => {
    expect(comboLabel('F9')).toBe('F9');
    expect(comboLabel('Shift+F9')).toBe('Shift+F9');
    expect(comboLabel(' ')).toBe('Spazio');
  });
});
