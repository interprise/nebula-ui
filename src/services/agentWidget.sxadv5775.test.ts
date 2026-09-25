import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AGENT_WIDGET_ID,
  AGENT_WIDGET_SCRIPT_ID,
  AGENT_WIDGET_SCRIPT_SRC,
  syncAgentWidget,
} from './agentWidget';

// SXADV-5775: il server manda `loginfo.bot` (booleano, chiave di configurazione
// `utilita.bot`). Il client ExtJS (entrasp/WebContent/script/ui.js, ~r. 2673)
// quando e' true monta il web component dell'agente AI di InfoCert:
// un <agent-widget id="widget-pandora"> con agent/tenant/settings e lo script
// https://widget-agent-trusty.infocert.it/widget.js che definisce l'elemento.
// Il client React non lo faceva mai. Contratto di syncAgentWidget(info, doc):
//   - bot === true (strettamente) e login non vuoto => un solo widget nel body,
//     settings uguali al legacy con username = login; un solo script;
//   - idempotente: stessa login => stesso elemento (rimontarlo chiuderebbe la
//     chat aperta), nessuno script in piu';
//   - login diversa => il vecchio widget se ne va, ne nasce uno col nuovo utente;
//   - bot spento / info assente / login vuota => nessun widget (e quello
//     esistente si toglie); lo script NON si toglie mai (una custom element
//     definita non si puo' de-registrare) e non si aggiunge se bot e' spento.
//
// Ambiente node, niente DOM: un DOM finto con quello che il modulo tocca
// (getElementById, createElement, body/head.appendChild, remove, setAttribute,
// assegnazione di proprieta').

const LEGACY_AGENT = '01KEEWR0BXBKNVHAVQM27X1PYK';
const LEGACY_TENANT = '01JRHZPXHJ1YCFK2ZJCNSPF0C5';

/** L'oggetto settings del legacy, con username = login. */
function settingsLegacy(login: string) {
  return {
    username: login,
    api: 'api-trusty-hub.infocert.it',
    backend: 'api-trusty.infocert.it',
    lang: 'it',
    mode: 'widget',
    history: true,
    secure: true,
    upload: false,
    voice: false,
    prefix: 'Pandora',
    width: 600,
    height: 600,
    finalFeedback: true,
    bubbleAlign: 'opposite',
    chip: {
      enabled: true,
      color: '#00C040',
      text: '?',
    },
  };
}

class FintoElemento {
  tagName: string;
  parent: FintoContenitore | null = null;
  attributi: Record<string, string> = {};
  private _id = '';
  [prop: string]: unknown;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get id(): string { return this._id; }
  set id(v: string) { this._id = String(v); this.attributi.id = String(v); }
  setAttribute(name: string, value: string) {
    this.attributi[name] = String(value);
    if (name === 'id') this._id = String(value);
  }
  getAttribute(name: string) { return this.attributi[name] ?? null; }
  remove() {
    if (this.parent) {
      const p = this.parent;
      p.children = p.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
}

class FintoContenitore {
  children: FintoElemento[] = [];
  appendChild(el: FintoElemento) {
    el.remove();
    el.parent = this;
    this.children.push(el);
    return el;
  }
}

let body: FintoContenitore;
let head: FintoContenitore;
let doc: Document;

function nuovoDoc() {
  body = new FintoContenitore();
  head = new FintoContenitore();
  const d = {
    body,
    head,
    createElement: (tag: string) => new FintoElemento(tag),
    getElementById: (id: string) =>
      [...head.children, ...body.children].find((c) => c.id === id) ?? null,
  };
  doc = d as unknown as Document;
}

const tutti = () => [...head.children, ...body.children];
const widgets = () => tutti().filter((e) => e.tagName === 'AGENT-WIDGET');
const scripts = () => tutti().filter((e) => e.tagName === 'SCRIPT');

beforeEach(() => nuovoDoc());

describe('SXADV-5775 costanti', () => {
  it('id e src come il legacy', () => {
    expect(AGENT_WIDGET_ID).toBe('widget-pandora');
    expect(AGENT_WIDGET_SCRIPT_ID).toBe('agent-widget-script');
    expect(AGENT_WIDGET_SCRIPT_SRC).toBe('https://widget-agent-trusty.infocert.it/widget.js');
  });
});

describe('SXADV-5775 montaggio con bot acceso', () => {
  it('bot true + login => un agent-widget nel body con agent, tenant e settings del legacy', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(widgets()).toHaveLength(1);
    const w = widgets()[0];
    expect(body.children).toContain(w);
    expect(w.id).toBe(AGENT_WIDGET_ID);
    expect(w.agent).toBe(LEGACY_AGENT);
    expect(w.tenant).toBe(LEGACY_TENANT);
    expect(w.settings).toEqual(settingsLegacy('MARIO'));
  });

  it('getElementById trova il widget con l\'id del legacy', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(doc.getElementById('widget-pandora')).toBe(widgets()[0]);
  });

  it('bot true + login => un solo script, con id, src e async', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(scripts()).toHaveLength(1);
    const s = scripts()[0];
    expect(s.id).toBe(AGENT_WIDGET_SCRIPT_ID);
    expect(s.src).toBe(AGENT_WIDGET_SCRIPT_SRC);
    expect(s.async).toBe(true);
  });
});

describe('SXADV-5775 idempotenza', () => {
  it('stessa info due volte => stesso elemento, niente rimontaggio, uno script', () => {
    const info = { bot: true, login: 'MARIO' };
    syncAgentWidget(info, doc);
    const primo = widgets()[0];
    syncAgentWidget(info, doc);
    expect(widgets()).toHaveLength(1);
    expect(widgets()[0]).toBe(primo);
    expect(primo.parent).toBe(body);
    expect(scripts()).toHaveLength(1);
  });

  it('info nuova con stessa login e bot ma altri campi cambiati => stesso elemento', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    const primo = widgets()[0];
    const settingsPrima = primo.settings;
    syncAgentWidget(
      { bot: true, login: 'MARIO', banners: ['avviso'], profile: 'X' } as unknown as { bot: boolean; login: string },
      doc,
    );
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(widgets()).toHaveLength(1);
    expect(widgets()[0]).toBe(primo);
    expect(primo.settings).toEqual(settingsPrima);
    expect(scripts()).toHaveLength(1);
  });
});

describe('SXADV-5775 cambio utente senza ricaricare la pagina', () => {
  it('login diversa => il vecchio widget e\' tolto, il nuovo porta il nuovo username', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    const vecchio = widgets()[0];
    syncAgentWidget({ bot: true, login: 'LUIGI' }, doc);
    expect(widgets()).toHaveLength(1);
    const nuovo = widgets()[0];
    expect(nuovo).not.toBe(vecchio);
    expect(vecchio.parent).toBeNull();
    expect(nuovo.id).toBe(AGENT_WIDGET_ID);
    expect((nuovo.settings as { username: string }).username).toBe('LUIGI');
    expect(nuovo.settings).toEqual(settingsLegacy('LUIGI'));
    expect(nuovo.agent).toBe(LEGACY_AGENT);
    expect(nuovo.tenant).toBe(LEGACY_TENANT);
    expect(scripts()).toHaveLength(1);
  });
});

describe('SXADV-5775 bot spento o non strettamente true', () => {
  const spenti: Array<[string, unknown]> = [
    ['false', false],
    ['assente', undefined],
    ['stringa "1"', '1'],
    ['numero 1', 1],
    ['stringa "true"', 'true'],
  ];

  for (const [nome, bot] of spenti) {
    it(`bot ${nome} => nessun widget e nessuno script`, () => {
      const info = (bot === undefined ? { login: 'MARIO' } : { bot, login: 'MARIO' }) as { bot?: boolean; login: string };
      syncAgentWidget(info, doc);
      expect(widgets()).toHaveLength(0);
      expect(scripts()).toHaveLength(0);
    });

    it(`bot ${nome} dopo un widget montato => widget tolto, script resta`, () => {
      syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
      const w = widgets()[0];
      const s = scripts()[0];
      const info = (bot === undefined ? { login: 'MARIO' } : { bot, login: 'MARIO' }) as { bot?: boolean; login: string };
      syncAgentWidget(info, doc);
      expect(widgets()).toHaveLength(0);
      expect(w.parent).toBeNull();
      expect(doc.getElementById(AGENT_WIDGET_ID)).toBeNull();
      expect(scripts()).toEqual([s]);
    });
  }
});

describe('SXADV-5775 logout (info assente)', () => {
  it('null senza widget => nessun errore, niente creato', () => {
    expect(() => syncAgentWidget(null, doc)).not.toThrow();
    expect(() => syncAgentWidget(undefined, doc)).not.toThrow();
    expect(tutti()).toHaveLength(0);
  });

  it('null con widget => widget tolto, script resta', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(() => syncAgentWidget(null, doc)).not.toThrow();
    expect(widgets()).toHaveLength(0);
    expect(scripts()).toHaveLength(1);
  });

  it('undefined con widget => widget tolto, script resta', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(() => syncAgentWidget(undefined, doc)).not.toThrow();
    expect(widgets()).toHaveLength(0);
    expect(scripts()).toHaveLength(1);
  });
});

describe('SXADV-5775 bot acceso ma senza utente', () => {
  it('login vuota => nessun widget', () => {
    syncAgentWidget({ bot: true, login: '' }, doc);
    expect(widgets()).toHaveLength(0);
  });

  it('login assente => nessun widget', () => {
    syncAgentWidget({ bot: true }, doc);
    expect(widgets()).toHaveLength(0);
  });

  it('login vuota dopo un widget montato => widget tolto', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    syncAgentWidget({ bot: true, login: '' }, doc);
    expect(widgets()).toHaveLength(0);
  });
});

describe('SXADV-5775 riaccensione', () => {
  it('acceso -> spento -> acceso => widget ricreato, script sempre uno', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    const primo = widgets()[0];
    syncAgentWidget({ bot: false, login: 'MARIO' }, doc);
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    expect(widgets()).toHaveLength(1);
    const secondo = widgets()[0];
    expect(secondo.parent).toBe(body);
    expect(secondo.id).toBe(AGENT_WIDGET_ID);
    expect(secondo.settings).toEqual(settingsLegacy('MARIO'));
    expect(primo.parent).toBeNull();
    expect(scripts()).toHaveLength(1);
  });

  it('logout -> login di un altro utente => widget del nuovo utente, script sempre uno', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' }, doc);
    syncAgentWidget(null, doc);
    syncAgentWidget({ bot: true, login: 'LUIGI' }, doc);
    expect(widgets()).toHaveLength(1);
    expect(widgets()[0].settings).toEqual(settingsLegacy('LUIGI'));
    expect(scripts()).toHaveLength(1);
  });
});

describe('SXADV-5775 documento di default', () => {
  const g = globalThis as Record<string, unknown>;
  let salvato: unknown;
  let aveva = false;
  beforeEach(() => {
    aveva = 'document' in g;
    salvato = g.document;
    g.document = doc;
  });
  afterEach(() => {
    if (aveva) g.document = salvato;
    else delete g.document;
  });

  it('senza doc usa il document globale', () => {
    syncAgentWidget({ bot: true, login: 'MARIO' });
    expect(widgets()).toHaveLength(1);
    expect(scripts()).toHaveLength(1);
    syncAgentWidget(null);
    expect(widgets()).toHaveLength(0);
  });
});
