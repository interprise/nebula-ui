/**
 * Harness per la prova e2e di HtmlAreaControl (vedi htmlarea.e2e.mjs).
 * Monta il VERO controllo, con `control`/`onChange`/`onAction` finti, e
 * pubblica su `window` quel che serve al test:
 *
 *   window.__pwned          -> 0; qualsiasi payload che esegue lo porta a 1
 *   window.__onChangeLog    -> elenco dei valori passati a onChange (HTML salvato)
 *   window.__lastValue()    -> ultimo valore salvato ('' per documento vuoto)
 *   window.__setIncoming(h) -> simula un render del server (ri-sincronizza il valore)
 *   window.__editorEl()     -> il nodo contenteditable di ProseMirror
 *   window.__editorHTML()   -> innerHTML del contenteditable (DOM vivo)
 *
 * Il flag __pwned e' il sensore dell'esecuzione: i payload del test provano a
 * scrivere window.__pwned=1 / a chiamare window.__pwn(); se nessun codice gira,
 * resta 0. alert/confirm/print sono dirottati sullo stesso flag per sicurezza.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import HtmlAreaControl from '../../src/controls/builtins/HtmlAreaControl';
import type { UIControl } from '../../src/types/ui';
import '../../src/styles/tokens.css';
import '../../src/styles/global.css';

declare global {
  interface Window {
    __pwned: number;
    __pwn: () => void;
    __onChangeLog: unknown[];
    __lastValue: () => unknown;
    __setIncoming: (html: string) => void;
    __editorEl: () => Element | null;
    __editorHTML: () => string;
    __ready: boolean;
  }
}

window.__pwned = 0;
window.__pwn = () => { window.__pwned = 1; };
window.__onChangeLog = [];
window.__lastValue = () =>
  window.__onChangeLog.length ? window.__onChangeLog[window.__onChangeLog.length - 1] : undefined;
// Dirotta i sink piu' comuni sullo stesso sensore.
window.alert = () => { window.__pwned = 1; };
window.confirm = () => { window.__pwned = 1; return false; };
window.print = () => { window.__pwned = 1; };

window.__editorEl = () => document.querySelector('.htmlarea .ProseMirror');
window.__editorHTML = () => window.__editorEl()?.innerHTML ?? '';

// eslint-disable-next-line react-refresh/only-export-components -- pagina di prova, nessun HMR
function Harness() {
  const [value, setValue] = useState<string>('');
  useEffect(() => {
    window.__setIncoming = (html: string) => setValue(html);
    // Segnala al test che il bundle e' montato e __setIncoming e' pronto.
    window.__ready = true;
  }, []);

  const control: UIControl = {
    id: 'banHpText',
    name: 'banHpText',
    hint: 'Testo Home Page',
    value,
  } as UIControl;

  return (
    <div style={{ padding: 16, maxWidth: 760 }}>
      <HtmlAreaControl
        control={control}
        onChange={(_name, v) => { window.__onChangeLog.push(v); }}
        onAction={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={{ token: { fontFamily: "'Inter', sans-serif", fontSize: 13 } }}>
      <AntApp>
        <Harness />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
