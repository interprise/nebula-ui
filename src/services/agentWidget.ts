// SXADV-5775: widget dell'agente AI (InfoCert "trusty").
//
// Il server manda `loginfo.bot` (chiave di configurazione `utilita.bot`); il
// client legacy (entrasp/WebContent/script/ui.js, dopo l'identify di
// Freshworks) monta il web component <agent-widget> e carica widget.js. Qui la
// stessa integrazione, con gli stessi valori: non e' una nuova integrazione, e'
// il porto di quella del legacy.
//
// Differenze volute rispetto al legacy:
//  - lo spegnimento cerca l'id giusto: il legacy cercava "widget-sixtema-erp"
//    ma creava "widget-pandora", quindi non lo toglieva mai;
//  - un cambio di utente senza ricaricare la pagina rimonta il widget con il
//    nuovo username (in React il logout non ricarica la pagina);
//  - lo script si carica una volta sola: la definizione di un custom element
//    non si puo' togliere, quindi resta anche a widget spento.

export const AGENT_WIDGET_ID = 'widget-pandora';
export const AGENT_WIDGET_SCRIPT_ID = 'agent-widget-script';
export const AGENT_WIDGET_SCRIPT_SRC = 'https://widget-agent-trusty.infocert.it/widget.js';

const AGENT = '01KEEWR0BXBKNVHAVQM27X1PYK';
const TENANT = '01JRHZPXHJ1YCFK2ZJCNSPF0C5';

type AgentWidgetElement = HTMLElement & {
  agent?: string;
  tenant?: string;
  settings?: Record<string, unknown>;
};

function widgetSettings(username: string): Record<string, unknown> {
  return {
    username,
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
    chip: { enabled: true, color: '#00C040', text: '?' },
  };
}

export function syncAgentWidget(
  info: { bot?: boolean; login?: string } | null | undefined,
  doc: Document = document,
): void {
  const existing = doc.getElementById(AGENT_WIDGET_ID) as AgentWidgetElement | null;
  const login = info?.login;
  if (info?.bot !== true || !login) {
    existing?.remove();
    return;
  }
  if (existing) {
    // Stesso utente: lasciarlo com'e', rimontarlo chiuderebbe la chat aperta.
    if (existing.settings?.username === login) return;
    existing.remove();
  }
  const w = doc.createElement('agent-widget') as AgentWidgetElement;
  w.setAttribute('id', AGENT_WIDGET_ID);
  w.agent = AGENT;
  w.tenant = TENANT;
  w.settings = widgetSettings(login);
  doc.body.appendChild(w);
  if (!doc.getElementById(AGENT_WIDGET_SCRIPT_ID)) {
    const s = doc.createElement('script');
    s.id = AGENT_WIDGET_SCRIPT_ID;
    s.type = 'text/javascript';
    s.async = true;
    s.src = AGENT_WIDGET_SCRIPT_SRC;
    doc.head.appendChild(s);
  }
}
