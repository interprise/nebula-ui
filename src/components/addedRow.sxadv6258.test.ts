import { describe, it, expect } from 'vitest';
import { addedRowPath } from './addedRow';

// SXADV-6258: il numero in coda al currField della risposta a "Nuovo" conta i
// record dalla cima della PAGINA (CORE RenderItemState.getCurrRec, che conta
// anche i record scartati da un filtro di riga): la posizione del rigo nel
// percorso e' inizio pagina + n.
// Scritti da un agente indipendente sul contratto "ordinale fra i righi resi";
// la revisione indipendente ha mostrato che con i filtri di riga quel contratto
// sbaglia (bolleRigheScaricoSplitted), e i casi sono stati riscritti con
// l'inizio pagina, conservando gli esempi reali.

/** `S1-2.<from>` .. `S1-2.<to>` compresi. */
function range(vs: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${vs}.${i}`);
  return out;
}

describe('addedRowPath: inizio pagina + n', () => {
  it('pagina 3 da 20 (S1-2.40..S1-2.57), currField articoloVariante.S1-2.17 -> S1-2.57', () => {
    const rows = range('S1-2', 40, 57);
    expect(addedRowPath(rows, 'articoloVariante.S1-2.17', null, 40)).toBe('S1-2.57');
  });

  it('17 righi S1-2.40..S1-2.56, currField articoloVariante.S1-2.16 -> S1-2.56', () => {
    expect(addedRowPath(range('S1-2', 40, 56), 'articoloVariante.S1-2.16', null, 40)).toBe('S1-2.56');
  });

  it('n = 0 a pagina 3: il primo rigo della pagina, non il rigo in posizione 0', () => {
    expect(addedRowPath(range('S1-2', 40, 57), 'articoloVariante.S1-2.0', null, 40)).toBe('S1-2.40');
  });

  it('senza inizio pagina vale la posizione (prima pagina, lista annidata)', () => {
    const rows = ['S1-0.0,S1-9.0', 'S1-0.0,S1-9.1'];
    expect(addedRowPath(rows, 'descrizione.S1-9.1', null)).toBe('S1-0.0,S1-9.1');
  });

  it('pagina 2 da 20 con 21 righi: x.S1-2.20 -> S1-2.40, non S1-2.20', () => {
    expect(addedRowPath(range('S1-2', 20, 40), 'x.S1-2.20', null, 20)).toBe('S1-2.40');
  });

  it('filtro di riga: record scartati contano nel currField (P0 S1 P2, nuovo S3 nel tab dei S)', () => {
    // Righi resi del tab "Secondarie": posizioni 1 e 3; currField .3 -> il rigo in posizione 3.
    expect(addedRowPath(['S1-5.1', 'S1-5.3'], 'x.S1-5.3', 'S1-5.1', 0)).toBe('S1-5.3');
  });
});

describe('addedRowPath: solo i righi dello stesso viewstate contano', () => {
  it('righi di un altro viewstate in mezzo non si confondono', () => {
    const rows = ['S1-0.0,S1-7.0', 'S1-0.0,S1-9.10', 'S1-0.0,S1-7.1', 'S1-0.0,S1-9.11'];
    expect(addedRowPath(rows, 'descrizione.S1-9.1', null, 10)).toBe('S1-0.0,S1-9.11');
    expect(addedRowPath(rows, 'descrizione.S1-9.0', null, 10)).toBe('S1-0.0,S1-9.10');
  });

  it('viewstate con prefisso comune (S1-9 vs S1-90) non si confondono', () => {
    const rows = ['S1-90.0', 'S1-9.5', 'S1-90.1', 'S1-9.6'];
    expect(addedRowPath(rows, 'x.S1-9.6', null)).toBe('S1-9.6');
    expect(addedRowPath(rows, 'x.S1-90.1', null)).toBe('S1-90.1');
  });
});

describe('addedRowPath: ripiego', () => {
  const rows = range('S1-2', 40, 45);
  it('currField null/undefined/vuoto -> fallback', () => {
    expect(addedRowPath(rows, null, 'S1-2.41', 40)).toBe('S1-2.41');
    expect(addedRowPath(rows, undefined, 'S1-2.41', 40)).toBe('S1-2.41');
    expect(addedRowPath(rows, '', 'S1-2.41', 40)).toBe('S1-2.41');
  });

  it('posizione oltre i righi della pagina -> fallback', () => {
    expect(addedRowPath(rows, 'x.S1-2.6', 'F', 40)).toBe('F');
  });

  it('a pagina 3, n uguale alla posizione di un rigo non nomina quel rigo', () => {
    expect(addedRowPath(rows, 'x.S1-2.40', 'F', 40)).toBe('F');
  });

  it('viewstate che non c\'e\' nella lista -> fallback', () => {
    expect(addedRowPath(rows, 'x.S1-3.0', 'F', 40)).toBe('F');
  });

  it('currField senza numero (campo della testata) -> fallback', () => {
    expect(addedRowPath(rows, 'descrizione.S1-2', 'F', 40)).toBe('F');
    expect(addedRowPath(rows, 'descrizione', 'F', 40)).toBe('F');
  });

  it('lista vuota -> fallback', () => {
    expect(addedRowPath([], 'x.S1-2.0', 'F')).toBe('F');
  });

  it('non modifica l\'array dei percorsi', () => {
    const r = Object.freeze([...rows]);
    expect(addedRowPath(r, 'x.S1-2.1', null, 40)).toBe('S1-2.41');
  });
});
