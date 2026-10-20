import { describe, it, expect } from 'vitest';
import {
  decidePageSize,
  newAdaptiveMemory,
  MIN_ADAPTIVE_PAGE_SIZE,
  MAX_ADAPTIVE_PAGE_SIZE,
  ADAPTIVE_PAGE_SIZE_HYSTERESIS,
  type AdaptiveMemory,
} from './adaptivePageSize';

// SXADV-5982: la memoria delle taglie gia' chieste sopravviveva al rientro nella
// funzione (viewstate nuovo, server di nuovo a 20) e la pagina restava a 20; e il
// pannello di riga, aprendosi e chiudendosi, faceva ricalcolare la pagina (22, 27...).

type Input = Parameters<typeof decidePageSize>[1];

const PITCH = 25;

function input(over: Partial<Input> = {}): Input {
  return { listId: 'S1-1', avail: 550, pitch: PITCH, current: 20, panelShown: false, ...over };
}

function snapshot(mem: AdaptiveMemory) {
  return {
    listId: mem.listId,
    avail: mem.avail,
    lastAsked: mem.lastAsked,
    sizes: [...mem.sizes].sort((a, b) => a - b),
  };
}

describe('costanti', () => {
  it('hanno i valori del contratto', () => {
    expect(MIN_ADAPTIVE_PAGE_SIZE).toBe(20);
    expect(MAX_ADAPTIVE_PAGE_SIZE).toBe(100);
    expect(ADAPTIVE_PAGE_SIZE_HYSTERESIS).toBe(3);
  });
});

describe('newAdaptiveMemory', () => {
  it('parte vuota', () => {
    const mem = newAdaptiveMemory();
    expect(mem.listId).toBeNull();
    expect(mem.avail).toBe(0);
    expect(mem.sizes.size).toBe(0);
    expect(mem.lastAsked).toBeNull();
    expect(mem.afterPanel).toBe(false);
  });

  it('restituisce ogni volta un oggetto nuovo, con un Set suo', () => {
    const a = newAdaptiveMemory();
    const b = newAdaptiveMemory();
    expect(a).not.toBe(b);
    expect(a.sizes).not.toBe(b.sizes);
  });
});

describe('decidePageSize — prima misura', () => {
  it('chiede 22 con current 20: l\'isteresi non vale per la prima misura', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input())).toBe(22);
    expect(mem.listId).toBe('S1-1');
    expect(mem.avail).toBe(550);
    expect(mem.lastAsked).toBe(22);
    expect(mem.sizes.has(22)).toBe(true);
  });

  it('non chiede niente se la taglia voluta e\' gia\' quella del server', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ current: 22 }))).toBeNull();
    expect(mem.lastAsked).toBeNull();
    expect(mem.sizes.size).toBe(0);
  });
});

describe('decidePageSize — (A) rientro nella funzione', () => {
  it('lista nuova con server di nuovo a 20 e stesso spazio: richiede 22', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ listId: 'S1-1' }))).toBe(22);
    // Il server ha risposto: la lista S1-1 ora e' a 22, nessuna nuova richiesta.
    expect(decidePageSize(mem, input({ listId: 'S1-1', current: 22 }))).toBeNull();
    // Rientro: viewstate nuovo, il server riparte da 20.
    expect(decidePageSize(mem, input({ listId: 'S1-2', current: 20 }))).toBe(22);
    expect(mem.listId).toBe('S1-2');
    expect(mem.lastAsked).toBe(22);
    expect(snapshot(mem).sizes).toEqual([22]);
  });

  it('il cambio di lista azzera tutta la memoria, anche lastAsked e avail', () => {
    const mem = newAdaptiveMemory();
    decidePageSize(mem, input({ listId: 'S1-1', avail: 1000 })); // chiede 40
    expect(mem.lastAsked).toBe(40);
    // Lista nuova, server gia' a 40 => nessuna richiesta, ma memoria azzerata.
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 1000, current: 40 }))).toBeNull();
    expect(mem.listId).toBe('S1-2');
    expect(mem.lastAsked).toBeNull();
    expect(mem.sizes.size).toBe(0);
    expect(mem.avail).toBe(1000);
  });

  it('dopo il rientro l\'isteresi non si applica alla prima misura', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ listId: 'S1-1', avail: 550 }))).toBe(22);
    // Lista nuova, spazio di poco diverso: 23 differisce da 22 meno di 3,
    // ma lastAsked e' stato azzerato e la richiesta parte.
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 575, current: 20 }))).toBe(23);
  });
});

describe('decidePageSize — (B) pannello di riga', () => {
  function adaptedTo27(): AdaptiveMemory {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 675 }))).toBe(27);
    return mem;
  }

  it('pannello aperto con spazio ridotto: null, cambia solo afterPanel', () => {
    const mem = adaptedTo27();
    expect(mem.afterPanel).toBe(false);
    const before = snapshot(mem);
    expect(
      decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 27, panelShown: true })),
    ).toBeNull();
    expect(snapshot(mem)).toEqual(before);
    expect(mem.afterPanel).toBe(true);
  });

  it('pannello aperto: listId, avail, sizes e lastAsked intatti anche se cambia listId', () => {
    const mem = adaptedTo27();
    const before = snapshot(mem);
    expect(
      decidePageSize(mem, input({ listId: 'S1-9', avail: 400, current: 20, panelShown: true })),
    ).toBeNull();
    expect(snapshot(mem)).toEqual(before);
    expect(mem.afterPanel).toBe(true);
  });

  it('pannello chiuso, spazio come prima e server a 27: null', () => {
    const mem = adaptedTo27();
    decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 27, panelShown: true }));
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 675, current: 27 }))).toBeNull();
    expect(mem.lastAsked).toBe(27);
    expect(mem.avail).toBe(675);
    expect(mem.afterPanel).toBe(false);
  });

  it('ciclo apri/chiudi ripetuto: mai nessuna richiesta', () => {
    const mem = adaptedTo27();
    for (let i = 0; i < 5; i++) {
      expect(
        decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 27, panelShown: true })),
      ).toBeNull();
      expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 675, current: 27 }))).toBeNull();
    }
  });
});

describe('decidePageSize — prima misura dopo la chiusura del pannello', () => {
  function adaptedTo22(listId = 'S1-2'): AdaptiveMemory {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ listId, avail: 550, pitch: 25 }))).toBe(22);
    return mem;
  }

  it('(a) chiuso con lo stesso spazio e un pitch che darebbe 27: null, afterPanel torna false', () => {
    const mem = adaptedTo22();
    decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 22, panelShown: true }));
    expect(mem.afterPanel).toBe(true);
    // 550 / 20 = 27.5 -> 27: diverso da 22 di 5, ma e' la prima misura dopo il pannello
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 20, current: 22 }))).toBeNull();
    expect(mem.afterPanel).toBe(false);
    expect(mem.lastAsked).toBe(22);
    expect(snapshot(mem).sizes).toEqual([22]);
  });

  it('(b) la seconda misura con lo stesso spazio e pitch da 27 chiede 27', () => {
    const mem = adaptedTo22();
    decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 22, panelShown: true }));
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 20, current: 22 }))).toBeNull();
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 20, current: 22 }))).toBe(27);
    expect(mem.lastAsked).toBe(27);
  });

  it('chiuso con spazio variato di 8 px (non > 8): ancora saltata', () => {
    const mem = adaptedTo22();
    decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 22, panelShown: true }));
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 558, pitch: 20, current: 22 }))).toBeNull();
    expect(mem.afterPanel).toBe(false);
  });

  it('piu\' misure a pannello aperto: resta saltata solo la prima dopo la chiusura', () => {
    const mem = adaptedTo22();
    for (let i = 0; i < 3; i++) {
      decidePageSize(mem, input({ listId: 'S1-2', avail: 400 - i * 10, current: 22, panelShown: true }));
    }
    expect(mem.afterPanel).toBe(true);
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 20, current: 22 }))).toBeNull();
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 20, current: 22 }))).toBe(27);
  });

  it('(c) finestra ingrandita a pannello aperto (avail +100): alla chiusura ricalcola e chiede', () => {
    const mem = adaptedTo22();
    decidePageSize(mem, input({ listId: 'S1-2', avail: 400, current: 22, panelShown: true }));
    // 650 / 25 = 26, |26 - 22| = 4
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 650, pitch: 25, current: 22 }))).toBe(26);
    expect(mem.afterPanel).toBe(false);
    expect(mem.avail).toBe(650);
    expect(mem.lastAsked).toBe(26);
  });

  it('(d) pannello aperto e poi lista nuova: afterPanel azzerato, vale la prima misura', () => {
    const mem = adaptedTo22('S1-1');
    decidePageSize(mem, input({ listId: 'S1-1', avail: 400, current: 22, panelShown: true }));
    expect(mem.afterPanel).toBe(true);
    // rientro: viewstate nuovo, server a 20, stesso spazio
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 550, pitch: 25, current: 20 }))).toBe(22);
    expect(mem.afterPanel).toBe(false);
    expect(mem.listId).toBe('S1-2');
  });
});

describe('decidePageSize — ridimensionamento vero', () => {
  function adaptedTo27(): AdaptiveMemory {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 675 }))).toBe(27);
    return mem;
  }

  it('spazio cambiato di piu\' di 8 px e differenza >= 3: chiede', () => {
    const mem = adaptedTo27();
    // 750 / 25 = 30, |30 - 27| = 3
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 750, current: 27 }))).toBe(30);
    expect(mem.avail).toBe(750);
    expect(mem.lastAsked).toBe(30);
    expect(snapshot(mem).sizes).toEqual([30]);
  });

  it('spazio cambiato di piu\' di 8 px ma differenza < 3: null, sizes svuotato, lastAsked resta', () => {
    const mem = adaptedTo27();
    // 725 / 25 = 29, |29 - 27| = 2
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 725, current: 27 }))).toBeNull();
    expect(mem.avail).toBe(725);
    expect(mem.lastAsked).toBe(27);
    expect(mem.sizes.size).toBe(0);
  });

  it('isteresi anche verso il basso: differenza < 3 non chiede', () => {
    const mem = adaptedTo27();
    // 625 / 25 = 25, |25 - 27| = 2
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 625, current: 27 }))).toBeNull();
    // 600 / 25 = 24, |24 - 27| = 3
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 600, current: 27 }))).toBe(24);
  });

  it('variazioni fino a 8 px non toccano avail ne\' sizes', () => {
    const mem = adaptedTo27();
    const before = snapshot(mem);
    expect(decidePageSize(mem, input({ listId: 'S1-2', avail: 683, current: 27 }))).toBeNull();
    expect(snapshot(mem)).toEqual(before);
  });
});

describe('decidePageSize — limiti', () => {
  it('clamp al minimo: poche righe => 20', () => {
    const mem = newAdaptiveMemory();
    // 250 / 25 = 10 -> 20; il server e' a 30
    expect(decidePageSize(mem, input({ avail: 250, current: 30 }))).toBe(MIN_ADAPTIVE_PAGE_SIZE);
  });

  it('clamp al minimo con server gia\' a 20: null', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ avail: 250, current: 20 }))).toBeNull();
  });

  it('clamp al massimo: tante righe => 100', () => {
    const mem = newAdaptiveMemory();
    // 5000 / 25 = 200 -> 100
    expect(decidePageSize(mem, input({ avail: 5000, current: 20 }))).toBe(MAX_ADAPTIVE_PAGE_SIZE);
  });

  it('usa floor, non round', () => {
    const mem = newAdaptiveMemory();
    // 599 / 25 = 23.96 -> 23
    expect(decidePageSize(mem, input({ avail: 599, current: 20 }))).toBe(23);
  });

  it('pitch null: null', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ pitch: null }))).toBeNull();
    expect(mem.lastAsked).toBeNull();
    expect(mem.sizes.size).toBe(0);
  });

  it('pitch 0: null', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ pitch: 0 }))).toBeNull();
    expect(mem.lastAsked).toBeNull();
  });

  it('spazio minore di un record: null', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ avail: 10, pitch: 25 }))).toBeNull();
    expect(mem.lastAsked).toBeNull();
  });

  it('pitch nullo aggiorna comunque listId e avail (passi 2-3 prima del 4)', () => {
    const mem = newAdaptiveMemory();
    decidePageSize(mem, input({ listId: 'S1-3', avail: 700, pitch: null }));
    expect(mem.listId).toBe('S1-3');
    expect(mem.avail).toBe(700);
  });
});

describe('decidePageSize — niente richieste ripetute', () => {
  it('stessa taglia per lo stesso spazio, server non ancora allineato: null', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input())).toBe(22);
    expect(decidePageSize(mem, input())).toBeNull();
    expect(decidePageSize(mem, input())).toBeNull();
  });

  it('oscillazione 40 -> 30 -> 40 con stesso spazio: il secondo 40 non si richiede', () => {
    const mem = newAdaptiveMemory();
    // 1000 / 25 = 40
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 25, current: 20 }))).toBe(40);
    // 1000 / 33.3 = 30.03 -> 30
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 33.3, current: 40 }))).toBe(30);
    // di nuovo 40: lastAsked e' 30, ma 40 e' gia' stato chiesto per questo spazio
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 25, current: 30 }))).toBeNull();
    expect(mem.lastAsked).toBe(30);
  });

  it('oscillazione con spazio variato di 8 px (non > 8): sizes resta, il 40 non si richiede', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 25, current: 20 }))).toBe(40);
    expect(decidePageSize(mem, input({ avail: 1008, pitch: 33.3, current: 40 }))).toBe(30);
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 25, current: 30 }))).toBeNull();
  });

  it('dopo un ridimensionamento vero la stessa taglia si puo\' richiedere di nuovo', () => {
    const mem = newAdaptiveMemory();
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 25, current: 20 }))).toBe(40);
    expect(decidePageSize(mem, input({ avail: 1000, pitch: 33.3, current: 40 }))).toBe(30);
    // spazio nuovo (> 8 px): sizes svuotato; 1100 / 27.5 = 40
    expect(decidePageSize(mem, input({ avail: 1100, pitch: 27.5, current: 30 }))).toBe(40);
  });
});
