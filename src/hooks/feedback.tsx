import React, { useMemo } from 'react';
import { App, Button } from 'antd';
import type { ErrorItem } from '../types/ui';
import { fixServerHtml } from '../services/serverHtml';

/**
 * Come si presenta all'utente quello che il server dice: una regola sola per
 * tipo di messaggio, la stessa del legacy (`ui.js` handleErrors) — SXADV-5814.
 *
 * - ERROR: finestra centrale "Richiesta NON eseguita" con OK. Gli avvertimenti
 *   della stessa risposta si accodano nella stessa finestra.
 * - CONFIRMATION: finestra "Richiesta di conferma" con OK / Annulla.
 * - YESNOCANCEL: finestra "Richiesta di conferma" con Sì / No / Annulla.
 * - WARNING senza errori: finestra "Richiesta eseguita con avvertimenti" con OK.
 * - INFO: avviso in basso a destra che si chiude da solo.
 * - NOTIFICATION: avviso in basso a destra che resta finché non lo si chiude.
 *
 * Prima ERROR e WARNING erano toast di pochi secondi senza OK: i messaggi di
 * controllo, anche lunghi, sparivano prima di essere letti.
 *
 * I testi vengono da `entrasp.properties` e portano markup (`<br>`, `<b>`) che
 * il legacy rendeva come HTML: qui lo stesso, altrimenti i tag si leggono.
 */

export type ConfirmAnswer = 'yes' | 'no';

export interface ServerMessageHandlers {
  /** Risposta alla domanda: 'yes' per OK / Sì, 'no' per il No di YESNOCANCEL. */
  onAnswer?: (prompt: ErrorItem, answer: ConfirmAnswer) => void;
  /** Annulla (o Esc): l'azione che ha posto la domanda non avviene. */
  onCancel?: () => void;
}

export interface Feedback {
  /** I messaggi di una risposta del server, raggruppati per tipo come nel legacy. */
  showServerMessages: (errors: ErrorItem[], handlers?: ServerMessageHandlers) => void;
  /** Messaggi nati nel client (testo semplice), resi come i tipi omonimi del server. */
  error: (text: string) => void;
  warning: (text: string) => void;
  info: (text: string) => void;
}

/** Durata degli avvisi INFO. Il legacy ne dava 3 e il client ne dava 3: troppo
 *  pochi per leggere un testo intero (SXADV-5814.2c). Col mouse sopra si fermano. */
const TOAST_SECONDS = 10;

/** Le finestre si allargano col testo fino a una misura leggibile, come quella
 *  del legacy; oltre, il corpo va a capo e poi scorre. */
const DIALOG_WIDTH = 'min(640px, calc(100vw - 32px))';

const serverBody = (items: ErrorItem[]) => (
  <div
    className="app-message-body"
    dangerouslySetInnerHTML={{ __html: fixServerHtml(items.map((e) => e.message).join('<br />')) }}
  />
);

const textBody = (text: string) => <div className="app-message-body">{text}</div>;

export function useFeedback(): Feedback {
  const { modal, notification } = App.useApp();

  return useMemo(() => {
    const dialog = { width: DIALOG_WIDTH, className: 'app-message-dialog', okText: 'OK' };

    const notExecuted = (content: React.ReactNode) =>
      modal.error({ ...dialog, title: 'Richiesta NON eseguita', content });

    const executedWithWarnings = (content: React.ReactNode, title = 'Richiesta eseguita con avvertimenti') =>
      modal.warning({ ...dialog, title, content });

    const toast = (content: React.ReactNode, sticky: boolean) =>
      notification.info({
        title: 'Avviso',
        description: content,
        placement: 'bottomRight',
        className: 'app-toast',
        duration: sticky ? false : TOAST_SECONDS,
        showProgress: !sticky,
        pauseOnHover: true,
      });

    const showServerMessages = (errors: ErrorItem[], handlers: ServerMessageHandlers = {}) => {
      const ofType = (type: ErrorItem['type']) => errors.filter((e) => e.type === type);
      const errs = ofType('ERROR');
      const warnings = ofType('WARNING');

      // Un errore vince su tutto: la richiesta non e' avvenuta, quindi non c'e'
      // niente da confermare e le informazioni non valgono.
      if (errs.length > 0) {
        notExecuted(serverBody([...errs, ...warnings]));
        return;
      }

      const confirms = ofType('CONFIRMATION');
      if (confirms.length > 0) {
        const prompt = confirms[confirms.length - 1];
        modal.confirm({
          ...dialog,
          title: 'Richiesta di conferma',
          content: serverBody(confirms),
          cancelText: 'Annulla',
          onOk: () => handlers.onAnswer?.(prompt, 'yes'),
          onCancel: () => handlers.onCancel?.(),
          // Ordine del legacy: l'azione prima, Annulla all'estrema destra.
          footer: (_, { OkBtn, CancelBtn }) => (
            <>
              <OkBtn />
              <CancelBtn />
            </>
          ),
        });
        return;
      }

      const yesNo = ofType('YESNOCANCEL');
      if (yesNo.length > 0) {
        const prompt = yesNo[yesNo.length - 1];
        // Il No e' una risposta, non un annullamento: rigioca la richiesta con
        // "<mnemonic>:N," e il server prende l'altra strada (processOkCancel).
        const dlg = modal.confirm({
          ...dialog,
          title: 'Richiesta di conferma',
          content: serverBody(yesNo),
          okText: 'Sì',
          cancelText: 'Annulla',
          onOk: () => handlers.onAnswer?.(prompt, 'yes'),
          onCancel: () => handlers.onCancel?.(),
          footer: (_, { OkBtn, CancelBtn }) => (
            <>
              <OkBtn />
              <Button
                onClick={() => {
                  dlg.destroy();
                  handlers.onAnswer?.(prompt, 'no');
                }}
              >
                No
              </Button>
              <CancelBtn />
            </>
          ),
        });
        return;
      }

      if (warnings.length > 0) executedWithWarnings(serverBody(warnings));
      const infos = ofType('INFO');
      if (infos.length > 0) toast(serverBody(infos), false);
      const notifications = ofType('NOTIFICATION');
      if (notifications.length > 0) toast(serverBody(notifications), true);
    };

    return {
      showServerMessages,
      error: (text) => notExecuted(textBody(text)),
      warning: (text) => executedWithWarnings(textBody(text), 'Attenzione'),
      info: (text) => toast(textBody(text), false),
    };
  }, [modal, notification]);
}
