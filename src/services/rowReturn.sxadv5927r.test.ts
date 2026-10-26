import { describe, it, expect, beforeEach } from 'vitest';
import {
  newListMount,
  registerListMount,
  armReturn,
  armedReturn,
  armedBySameMount,
  disarmReturn,
  disarmAllReturns,
  notePageChange,
  settleReturns,
} from './rowReturn';

// SXADV-5927, contratto P7 (26/10). Un ritorno armato vale solo per un
// montaggio NUOVO della lista. Se la risposta resta sulla pagina (Nuovo o
// Salva+ respinto dal server, conferma annullata) la lista che l'ha armato
// riceve righe nuove senza essere rimontata: non deve "tornare" su se stessa
// (scorrere in fondo, evidenziare l'ultima riga, prendersi il fuoco).
//
//   newListMount()                 -> identita' di un montaggio
//   registerListMount(key, mount)  -> il montaggio e' vivo sotto key; torna il rilascio
//   armReturn(key, mode, owner?)   -> registra anche il montaggio vivo sotto key
//   armedReturn(key, owner, mount) -> undefined se `mount` e' quello che l'ha armato
//   armedBySameMount(key, mount)   -> vero se l'ha armato proprio `mount`

const K = 'S1|vociClassificazioneArtList';
const K2 = 'S1|docRigheCliList';

describe('newListMount', () => {
  it('ogni montaggio ha un\'identita\' diversa', () => {
    const visti = new Set<number>();
    for (let i = 0; i < 50; i++) visti.add(newListMount());
    expect(visti.size).toBe(50);
  });
});

describe('P7: il montaggio che arma non vede il proprio ritorno', () => {
  beforeEach(() => disarmAllReturns());

  it("armato da A (vivo): A non lo vede, armedBySameMount(A) e' vero", () => {
    const A = newListMount();
    const rilascia = registerListMount(K, A);
    armReturn(K, 'new');
    expect(armedReturn(K, undefined, A)).toBeUndefined();
    expect(armedBySameMount(K, A)).toBe(true);
    rilascia();
  });

  it('vale anche col modo row e con un proprietario', () => {
    const A = newListMount();
    const rilascia = registerListMount(K, A);
    armReturn(K, 'row', 'S1-0.0');
    expect(armedReturn(K, 'S1-0.0', A)).toBeUndefined();
    expect(armedBySameMount(K, A)).toBe(true);
    rilascia();
  });

  it('il montaggio NUOVO (dopo il rilascio di A) lo vede', () => {
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    armReturn(K, 'new');
    rilasciaA();
    const B = newListMount();
    const rilasciaB = registerListMount(K, B);
    expect(armedReturn(K, undefined, B)).toBe('new');
    expect(armedBySameMount(K, B)).toBe(false);
    rilasciaB();
  });

  it('chiedere da A non disarma: B lo trova lo stesso', () => {
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    armReturn(K, 'row');
    for (let i = 0; i < 3; i++) expect(armedReturn(K, undefined, A)).toBeUndefined();
    rilasciaA();
    const B = newListMount();
    registerListMount(K, B);
    expect(armedReturn(K, undefined, B)).toBe('row');
  });

  it('senza montaggio nella domanda resta la regola di prima (si vede)', () => {
    const A = newListMount();
    registerListMount(K, A);
    armReturn(K, 'new');
    expect(armedReturn(K)).toBe('new');
    expect(armedReturn(K, undefined)).toBe('new');
  });

  it('armato senza nessun montaggio vivo: lo vede chiunque, nessuno e\' "lo stesso"', () => {
    armReturn(K, 'new');
    const X = newListMount();
    expect(armedReturn(K, undefined, X)).toBe('new');
    expect(armedBySameMount(K, X)).toBe(false);
  });

  it('il montaggio vivo e\' quello del momento dell\'armo, non uno registrato dopo', () => {
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    armReturn(K, 'new');
    rilasciaA();
    const B = newListMount();
    registerListMount(K, B);
    // B si e' montato DOPO l'armo: il ritorno e' per lui.
    expect(armedBySameMount(K, B)).toBe(false);
    expect(armedBySameMount(K, A)).toBe(true);
    expect(armedReturn(K, undefined, B)).toBe('new');
  });

  it('riarmare da B: ora e\' B a non vederlo, e A (vecchio) si', () => {
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    armReturn(K, 'new');
    rilasciaA();
    const B = newListMount();
    registerListMount(K, B);
    armReturn(K, 'row');
    expect(armedReturn(K, undefined, B)).toBeUndefined();
    expect(armedBySameMount(K, B)).toBe(true);
    expect(armedReturn(K, undefined, A)).toBe('row');
    expect(armedBySameMount(K, A)).toBe(false);
  });

  it('un rilascio tardivo di A non toglie B, montato nel frattempo', () => {
    // Rimontaggio con la pulizia del vecchio DOPO la registrazione del nuovo.
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    const B = newListMount();
    registerListMount(K, B);
    rilasciaA();
    armReturn(K, 'new');
    expect(armedBySameMount(K, B)).toBe(true);
    expect(armedReturn(K, undefined, B)).toBeUndefined();
  });

  it('il proprietario conta ancora: montaggio nuovo ma proprietario diverso = niente', () => {
    const A = newListMount();
    const rilasciaA = registerListMount(K, A);
    armReturn(K, 'row', 'S1-0.0');
    rilasciaA();
    const B = newListMount();
    registerListMount(K, B);
    expect(armedReturn(K, 'S1-14.126', B)).toBeUndefined();
    expect(armedReturn(K, 'S1-0.0', B)).toBe('row');
  });

  it('non armato o disarmato: armedBySameMount falso, armedReturn undefined', () => {
    const A = newListMount();
    registerListMount(K, A);
    expect(armedBySameMount(K, A)).toBe(false);
    expect(armedReturn(K, undefined, A)).toBeUndefined();
    armReturn(K, 'new');
    disarmReturn(K);
    expect(armedBySameMount(K, A)).toBe(false);
    expect(armedReturn(K, undefined, A)).toBeUndefined();
  });

  it('le chiavi sono separate: A vivo sotto K non e\' l\'armatore di K2', () => {
    const A = newListMount();
    registerListMount(K, A);
    armReturn(K2, 'new');
    expect(armedBySameMount(K2, A)).toBe(false);
    expect(armedReturn(K2, undefined, A)).toBe('new');
    // ...e armare K2 non tocca K.
    expect(armedReturn(K, undefined, A)).toBeUndefined();
  });

  it('disarmAllReturns toglie anche l\'armatore', () => {
    const A = newListMount();
    registerListMount(K, A);
    armReturn(K, 'new');
    disarmAllReturns();
    expect(armedBySameMount(K, A)).toBe(false);
  });
});

// ─── P7'' («Regola FINALE», 26/10 notte) ─────────────────────────────────────
//
// I ritorni armati li chiude Shell guardando le RISPOSTE, non le righe:
//   notePageChange(sid)  una risposta ha portato una pagina diversa nella sessione;
//   settleReturns(sid)   una risposta finale e' rimasta sulla pagina (Nuovo o
//                        Salva+ respinto, conferma annullata, richiesta fallita):
//                        i ritorni armati su QUESTA pagina della sessione non si
//                        useranno piu' e vanno tolti; quelli armati prima di un
//                        cambio di pagina (in attesa del rientro) restano.
// La chiave di lista e' `sid|vista[@padre]`.


describe("P7'': notePageChange / settleReturns per sid", () => {
  beforeEach(() => disarmAllReturns());

  it('armato e la risposta resta sulla pagina: settleReturns lo toglie', () => {
    armReturn('S1|vociClassificazioneArtList', 'new');
    settleReturns('S1');
    expect(armedReturn('S1|vociClassificazioneArtList')).toBeUndefined();
  });

  it('armato e poi la pagina cambia (si va al dettaglio): sopravvive a settleReturns', () => {
    armReturn('S1|vociClassificazioneArtList', 'new');
    notePageChange('S1');
    settleReturns('S1'); // p.es. un Salva respinto nella pagina di dettaglio
    expect(armedReturn('S1|vociClassificazioneArtList')).toBe('new');
  });

  it('vale anche per il modo row e con un proprietario nella chiave', () => {
    armReturn('S1|docRigheCliList@S1-0.0', 'row', 'S1-0.0');
    settleReturns('S1');
    expect(armedReturn('S1|docRigheCliList@S1-0.0', 'S1-0.0')).toBeUndefined();

    armReturn('S1|docRigheCliList@S1-0.0', 'row', 'S1-0.0');
    notePageChange('S1');
    settleReturns('S1');
    expect(armedReturn('S1|docRigheCliList@S1-0.0', 'S1-0.0')).toBe('row');
  });

  it('le sessioni sono separate: settleReturns di S2 non tocca S1', () => {
    armReturn('S1|v', 'new');
    settleReturns('S2');
    expect(armedReturn('S1|v')).toBe('new');
  });

  it('un cambio di pagina in S2 non protegge un ritorno di S1', () => {
    armReturn('S1|v', 'new');
    notePageChange('S2');
    settleReturns('S1');
    expect(armedReturn('S1|v')).toBeUndefined();
  });

  it('S1 non e\' un prefisso di S10: settleReturns(S1) lascia S10, e viceversa', () => {
    armReturn('S10|v', 'new');
    armReturn('S1|v', 'row');
    settleReturns('S1');
    expect(armedReturn('S10|v')).toBe('new');
    expect(armedReturn('S1|v')).toBeUndefined();
    armReturn('S1|v', 'row');
    settleReturns('S10');
    expect(armedReturn('S1|v')).toBe('row');
    expect(armedReturn('S10|v')).toBeUndefined();
  });

  it('due ritorni: quello armato prima del cambio di pagina resta, quello armato dopo se ne va', () => {
    armReturn('S1|a', 'new');
    notePageChange('S1');
    armReturn('S1|b', 'row');
    settleReturns('S1');
    expect(armedReturn('S1|a')).toBe('new');
    expect(armedReturn('S1|b')).toBeUndefined();
  });

  it('riarmare la stessa chiave dopo il cambio di pagina: conta il nuovo armo', () => {
    armReturn('S1|v', 'new');
    notePageChange('S1');
    armReturn('S1|v', 'row'); // un'altra uscita armata sulla pagina nuova
    settleReturns('S1');
    expect(armedReturn('S1|v')).toBeUndefined();
  });

  it('piu\' cambi di pagina di fila non fanno danni: il ritorno resta', () => {
    armReturn('S1|v', 'new');
    notePageChange('S1');
    notePageChange('S1');
    settleReturns('S1');
    settleReturns('S1');
    expect(armedReturn('S1|v')).toBe('new');
  });

  it('settleReturns senza niente armato non alza e non arma niente', () => {
    expect(() => settleReturns('S1')).not.toThrow();
    expect(() => notePageChange('S1')).not.toThrow();
    expect(armedReturn('S1|v')).toBeUndefined();
  });

  it('settleReturns non rimette un ritorno gia\' disarmato', () => {
    armReturn('S1|v', 'new');
    notePageChange('S1');
    disarmReturn('S1|v');
    settleReturns('S1');
    expect(armedReturn('S1|v')).toBeUndefined();
  });

  it('la lettura col montaggio resta quella di prima dopo un settle che non toglie', () => {
    const A = newListMount();
    const rilasciaA = registerListMount('S1|v', A);
    armReturn('S1|v', 'new');
    notePageChange('S1');
    settleReturns('S1');
    expect(armedReturn('S1|v', undefined, A)).toBeUndefined(); // stesso montaggio
    rilasciaA();
    const B = newListMount();
    registerListMount('S1|v', B);
    expect(armedReturn('S1|v', undefined, B)).toBe('new');
  });
});
