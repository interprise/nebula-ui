import { describe, it, expect } from 'vitest';
import { welcomeName, welcomeText } from './homeWelcome';

// SXADV-5475: il saluto della Home usa il Nome dell'utente quando c'e',
// altrimenti il login; e dice "Benvenuta/o", non piu' "Benvenuto".

describe('welcomeName', () => {
  it('usa il nome quando c\'e\'', () => {
    expect(welcomeName({ login: '44AMM', name: 'Maria' })).toBe('Maria');
  });

  it('senza nome ricade sul login', () => {
    expect(welcomeName({ login: '44AMM' })).toBe('44AMM');
    expect(welcomeName({ login: '44AMM', name: undefined })).toBe('44AMM');
  });

  it('nome null ricade sul login', () => {
    expect(welcomeName({ login: '44AMM', name: null })).toBe('44AMM');
  });

  it('nome vuoto ricade sul login', () => {
    expect(welcomeName({ login: '44AMM', name: '' })).toBe('44AMM');
  });

  it('nome di soli spazi (CHAR del DB) ricade sul login', () => {
    expect(welcomeName({ login: '44AMM', name: '     ' })).toBe('44AMM');
    expect(welcomeName({ login: '44AMM', name: '\t' })).toBe('44AMM');
    expect(welcomeName({ login: '44AMM', name: ' \n\r\t ' })).toBe('44AMM');
  });

  it('toglie gli spazi intorno al nome', () => {
    expect(welcomeName({ login: '44AMM', name: '  Maria   ' })).toBe('Maria');
    expect(welcomeName({ login: '44AMM', name: 'Maria\n' })).toBe('Maria');
  });

  it('conserva gli spazi interni', () => {
    expect(welcomeName({ login: '44AMM', name: 'Maria Grazia' })).toBe('Maria Grazia');
    expect(welcomeName({ login: '44AMM', name: ' Maria Grazia  ' })).toBe('Maria Grazia');
  });

  it('con un nome il login non compare', () => {
    expect(welcomeName({ login: '44AMM', name: 'Maria' })).not.toContain('44AMM');
  });

  it('accetta caratteri accentati', () => {
    expect(welcomeName({ login: 'nico', name: 'Nicolò' })).toBe('Nicolò');
    expect(welcomeName({ login: 'x', name: ' Érica D\'Àngelo ' })).toBe('Érica D\'Àngelo');
  });

  it('nome uguale al login: lo mostra una volta sola', () => {
    expect(welcomeName({ login: 'mario', name: 'mario' })).toBe('mario');
  });

  it('un nome di un solo carattere vale come nome', () => {
    expect(welcomeName({ login: '44AMM', name: 'A' })).toBe('A');
  });

  it('il login e\' mostrato cosi\' com\'e\'', () => {
    expect(welcomeName({ login: 'Mario.Rossi', name: null })).toBe('Mario.Rossi');
  });
});

describe('welcomeText', () => {
  it('saluta col nome', () => {
    expect(welcomeText({ login: '44AMM', name: 'Maria' })).toBe('Benvenuta/o, Maria');
  });

  it('saluta col login quando il nome manca o e\' vuoto', () => {
    expect(welcomeText({ login: '44AMM' })).toBe('Benvenuta/o, 44AMM');
    expect(welcomeText({ login: '44AMM', name: null })).toBe('Benvenuta/o, 44AMM');
    expect(welcomeText({ login: '44AMM', name: '   ' })).toBe('Benvenuta/o, 44AMM');
  });

  it('usa il nome ripulito dagli spazi', () => {
    expect(welcomeText({ login: '44AMM', name: '  Maria Grazia ' })).toBe('Benvenuta/o, Maria Grazia');
  });

  it('non dice piu\' "Benvenuto"', () => {
    expect(welcomeText({ login: '44AMM', name: 'Maria' })).not.toMatch(/Benvenuto/);
    expect(welcomeText({ login: '44AMM' }).startsWith('Benvenuta/o, ')).toBe(true);
  });
});
