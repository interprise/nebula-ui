import { describe, it, expect } from 'vitest';
import { comboFromEvent, isBrowserReservedCombo, normalizeCombo } from './hotkeys';

// SXADV-5749: F5 smette di essere riservato al browser — diventa
// l'acceleratore di "Ricarica dati". F1 (aiuto) resta del browser.

describe('isBrowserReservedCombo', () => {
  it('F1 resta riservato al browser', () => {
    expect(isBrowserReservedCombo('F1')).toBe(true);
  });

  it('F5 non è più riservato (è Ricarica dati)', () => {
    expect(isBrowserReservedCombo('F5')).toBe(false);
  });

  it.each(['F2', 'F8', 'F9', 'F10'])('%s non è riservato', (combo) => {
    expect(isBrowserReservedCombo(combo)).toBe(false);
  });

  it('normalizza la grafia prima di decidere', () => {
    expect(isBrowserReservedCombo('f1')).toBe(true);
    expect(isBrowserReservedCombo(' f1 ')).toBe(true);
    expect(isBrowserReservedCombo('f5')).toBe(false);
    expect(isBrowserReservedCombo('f9')).toBe(false);
  });

  it('le combo con modificatori di F9/F10 non sono riservate', () => {
    expect(isBrowserReservedCombo('Shift+F9')).toBe(false);
    expect(isBrowserReservedCombo('shift+f10')).toBe(false);
  });
});

describe('normalizeCombo (non regredisce)', () => {
  it('maiuscole canoniche per i tasti funzione', () => {
    expect(normalizeCombo('f5')).toBe('F5');
    expect(normalizeCombo('shift+f9')).toBe('Shift+F9');
    expect(normalizeCombo('F10')).toBe('F10');
  });

  it('ordine canonico dei modificatori, qualunque sia l\'ordine scritto', () => {
    expect(normalizeCombo('shift+ctrl+a')).toBe('Ctrl+Shift+A');
    expect(normalizeCombo('Meta+Alt+Ctrl+x')).toBe('Ctrl+Alt+Meta+X');
    expect(normalizeCombo('control+option+cmd+k')).toBe('Ctrl+Alt+Meta+K');
  });

  it('nomi lunghi come li scrive il DOM', () => {
    expect(normalizeCombo('escape')).toBe('Escape');
    expect(normalizeCombo('Escape')).toBe('Escape');
  });
});

describe('comboFromEvent (non regredisce)', () => {
  const ev = (init: Partial<KeyboardEvent>) =>
    ({ ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...init }) as KeyboardEvent;

  it('F5 nudo', () => {
    expect(comboFromEvent(ev({ key: 'F5' }))).toBe('F5');
  });

  it('Shift+F9 compone come normalizeCombo', () => {
    expect(comboFromEvent(ev({ key: 'F9', shiftKey: true }))).toBe(normalizeCombo('shift+f9'));
  });

  it('lettera minuscola e maiuscola sono la stessa combo', () => {
    expect(comboFromEvent(ev({ key: 'a', ctrlKey: true }))).toBe('Ctrl+A');
    expect(comboFromEvent(ev({ key: 'A', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+A');
  });

  it('una combo da evento F5 non è riservata, F1 sì', () => {
    expect(isBrowserReservedCombo(comboFromEvent(ev({ key: 'F5' })))).toBe(false);
    expect(isBrowserReservedCombo(comboFromEvent(ev({ key: 'F1' })))).toBe(true);
  });
});
