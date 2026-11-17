import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Popover, Spin } from 'antd';
import { CloseOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { postAction2 } from '../services/api';
import { serverHtml, HTML_POLICY } from '../services/serverHtml';

const NO_FIELD_HELP = 'Nessun aiuto disponibile per questo campo.';

interface Props {
  viewName: string;
  itemId: string;
  /** Icona messa dalla cella (ViewRenderer) e non dalle decorazioni del
   *  campo: e' il ripiego per i controlli che non passano da
   *  `withPostDecorations` (sola lettura, controlli custom). Se nella stessa
   *  cella le decorazioni hanno gia' disegnato la loro '?', questa si toglie
   *  prima del disegno. */
  outside?: boolean;
}

/**
 * La '?' di aiuto accanto a un campo, fuori da Redigi: legacy
 * `UIControl.addDocumentationIcon` -> `EntrAsp.UI.Shell.showHelp`, che chiede
 * `GetItemHelp` a controller2 e mostra il testo in un fumetto chiudibile
 * ancorato all'icona. Il server la manda (`control.helpIcon`) solo dove il
 * testo esiste; la voce puo' pero' sparire dopo, quindi "niente testo" e
 * l'errore di rete si dicono nel fumetto invece di lasciarlo vuoto.
 *
 * Il testo si chiede alla prima apertura e poi resta: riaprire non rifa' la
 * richiesta. Chi la usa le da' come `key` vista, item e revisione dei testi
 * (`helpIconKey`): un altro campo o un testo cambiato e' un'icona nuova, non
 * questa col testo di prima.
 */
const FieldHelpIcon: React.FC<Props> = ({ viewName, itemId, outside }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  // undefined = mai chiesto; null = chiesto, nessun testo; stringa = HTML filtrato
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  const asked = useRef(false);

  const load = useCallback(async () => {
    if (asked.current) return;
    asked.current = true;
    // Riprova dopo un errore: di nuovo la rotella, non il "nessun aiuto" di prima.
    setHtml(undefined);
    try {
      const resp = (await postAction2('GetItemHelp', { viewName, itemId })) as unknown as Record<string, unknown>;
      const help = typeof resp?.help === 'string' ? resp.help : '';
      const clean = help.trim() ? serverHtml(help, HTML_POLICY.content) : '';
      setHtml(clean.trim() ? clean : null);
    } catch {
      // Errore di rete: si dice "nessun aiuto" e alla prossima apertura si riprova.
      asked.current = false;
      setHtml(null);
    }
  }, [viewName, itemId]);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) void load();
  }, [load]);

  // Esc chiude il fumetto, come il pulsante di chiusura e il clic fuori.
  useEffect(() => {
    if (!open) return;
    // Il tasto resta al fumetto: senza fermarlo, lo stesso Esc farebbe anche
    // l'azione della vista (uscire dallo zoom, Annulla...).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  // La '?' sta dopo le icone del campo, come nel legacy (addPostDecoration la
  // scrive per ultima): dentro `.post-decorations` il campo le cede lo spazio.
  // Quella della cella serve solo dove le decorazioni non ci sono.
  useLayoutEffect(() => {
    if (!outside) return;
    // Si nasconde sul DOM, prima del disegno: e' la cella a dire se le
    // decorazioni del campo hanno gia' la loro '?'.
    // Si rifa' a ogni disegno, nei due sensi: la stessa cella puo' passare da
    // un controllo con decorazioni a uno senza (e viceversa) con la stessa key.
    const anchor = anchorRef.current;
    if (!anchor) return;
    const decorated = !!anchor.closest('td')?.querySelector('.post-decorations .help-icon');
    anchor.style.display = decorated ? 'none' : '';
    // `hidden` lo legge il CSS (`.cell-help-wrap`): la cella prende la
    // disposizione con l'icona a fianco solo quando questa si vede.
    anchor.hidden = decorated;
  });

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const content = (
    <div className="field-help-popover" onClick={stop} onMouseDown={stop}>
      {html === undefined
        ? <Spin size="small" />
        : html === null
          ? <span className="field-help-empty">{NO_FIELD_HELP}</span>
          : <div className="field-help-text" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );

  const popover = (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger="click"
      placement="bottomLeft"
      destroyOnHidden={false}
      title={
        <span className="field-help-title">
          <span>Aiuto</span>
          <CloseOutlined
            className="field-help-close"
            role="button"
            aria-label="Chiudi"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
        </span>
      }
      content={content}
    >
      <QuestionCircleOutlined
        className="help-icon"
        role="button"
        aria-label="Aiuto"
        tabIndex={-1}
        onMouseDown={stop}
        onClick={stop}
      />
    </Popover>
  );
  return outside ? <span ref={anchorRef} className="help-icon-outside">{popover}</span> : popover;
};

export default FieldHelpIcon;
