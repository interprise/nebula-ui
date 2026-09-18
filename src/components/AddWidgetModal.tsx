import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, Tag, Spin, Typography } from 'antd';
import * as api from '../services/api';
import { useFeedback } from '../hooks/feedback';
import type { ErrorItem } from '../types/ui';

/** Quello che il server chiama "sorgente" del widget, per la parte che qui si mostra. */
interface Sorgente {
  filtri?: Array<{ campo: string; etichetta: string; valore: string; negato?: boolean; casella?: boolean }>;
  filtriLeggibili?: boolean;
  descrizione?: string;
  colonne?: Array<{ etichetta?: string }>;
  listView?: string;
}

interface Widget {
  idWidget?: number | null;
  titolo?: string;
  intervalloMin?: number;
}

export interface WidgetAggiunto {
  widget: Widget;
  /** Stato della prima fotografia: OK se il widget nasce popolato, PRE se e' in preparazione. */
  fotografia?: {
    stato?: string;
    motivo?: string;
    messaggio?: string;
    /** Il conteggio VERO della lista. */
    totaleRighe?: number;
    /** Quante righe la fotografia ne ha conservate (tetto 1.000). */
    righeInFotografia?: number;
    parziale?: boolean;
  };
}

interface Props {
  open: boolean;
  sid: string;
  onClose: () => void;
  onAggiunto: (esito: WidgetAggiunto) => void;
}

/** Gli intervalli previsti dal piano (§4.5). Il minimo e' 15 minuti. */
const INTERVALLI = [
  { value: 15, label: 'Ogni 15 minuti' },
  { value: 30, label: 'Ogni 30 minuti' },
  { value: 60, label: 'Ogni ora' },
  { value: 240, label: 'Ogni 4 ore' },
];

/**
 * "Aggiungi alla dashboard": mostra che cosa verrebbe salvato — i filtri della
 * ricerca come elementi distinti, le colonne, il nome proposto e ogni quanto si
 * aggiorna — e poi lo salva.
 *
 * <p>La bozza la calcola il server con la stessa chiamata che poi salva
 * (`anteprima=true`): cosi' la finestra non indovina niente e mostra esattamente
 * i filtri che verranno rieseguiti.
 */
const AddWidgetModal: React.FC<Props> = ({ open, sid, onClose, onAggiunto }) => {
  const [form] = Form.useForm<{ titolo: string; intervallo: number }>();
  const feedback = useFeedback();
  const [bozza, setBozza] = useState<{ widget: Widget; sorgente: Sorgente } | null>(null);
  const [caricando, setCaricando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // onClose arriva scritta in linea da chi usa la finestra, quindi cambia identita' a
  // ogni ridisegno di quel componente — e la Shell si ridisegna a ogni inizio e fine
  // di richiesta (api.subscribeInFlight). Se stesse fra le dipendenze dell'effetto,
  // ogni risposta del server ne provocherebbe un altro, e la bozza si richiederebbe
  // all'infinito: visto nel browser il 18/09, ~45 dashboard.AddWidget al secondo e la
  // finestra sempre vuota. Qui dentro serve l'ULTIMA versione, non l'identita'.
  const chiusura = useRef(onClose);
  useEffect(() => {
    chiusura.current = onClose;
  });

  // Quale apertura della finestra si sta servendo. Ora che si puo' chiudere anche
  // mentre salva, un salvataggio lento puo' tornare quando l'utente ha gia' chiuso e
  // riaperto su un'altra lista: senza questo numero, la sua onClose() chiuderebbe la
  // finestra NUOVA sotto le mani di chi la sta compilando.
  const apertura = useRef(0);

  // Una risposta del server si mostra come la mostra il resto dell'applicativo
  // (regola di progetto: sempre useFeedback, mai un testo cucito a mano):
  // - CORE che solleva un'eccezione risponde 200 con `errors`, SENZA `esito`: quello
  //   e' il messaggio vero, e va mostrato invece del ripiego generico;
  // - un rifiuto nostro ha `messaggio`;
  // - una richiesta che non ha prodotto risposta leggibile (rete, 500, HTML al posto
  //   del JSON) non e' un testo da mostrare all'utente: e' failure().
  const mostraRisposta = (resp: Record<string, unknown>, ripiego: string) => {
    const errors = resp.errors as ErrorItem[] | undefined;
    if (errors && errors.length > 0) {
      feedback.showServerMessages(errors);
      return;
    }
    const messaggio = resp.messaggio ? String(resp.messaggio) : '';
    feedback.error(messaggio || ripiego);
  };

  useEffect(() => {
    if (!open) {
      setBozza(null);
      form.resetFields();
      return;
    }
    apertura.current += 1;
    // Un salvataggio abbandonato (si puo', da quando la finestra si chiude mentre
    // salva) lascerebbe `salvando` acceso, e la finestra riaperta avrebbe il tasto
    // Aggiungi in rotella per sempre se quella richiesta non torna mai.
    setSalvando(false);
    let vivo = true;
    setCaricando(true);
    void (async () => {
      try {
        const resp = (await api.postAction2('dashboard.AddWidget', {
          sid,
          anteprima: 'true',
        })) as unknown as Record<string, unknown>;
        if (!vivo) return;
        if (resp.esito !== 'ok') {
          mostraRisposta(resp, 'Non si puo aggiungere questa lista alla dashboard.');
          chiusura.current();
          return;
        }
        const widget = (resp.widget || {}) as Widget;
        setBozza({ widget, sorgente: (resp.sorgente || {}) as Sorgente });
        form.setFieldsValue({
          titolo: widget.titolo || '',
          intervallo: widget.intervalloMin || 60,
        });
      } catch (e) {
        if (vivo) {
          feedback.failure(e);
          chiusura.current();
        }
      } finally {
        if (vivo) setCaricando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [open, sid, form]);

  const salva = async (valori: { titolo: string; intervallo: number }) => {
    const mia = apertura.current;
    setSalvando(true);
    try {
      const resp = (await api.postAction2('dashboard.AddWidget', {
        sid,
        titolo: valori.titolo.trim(),
        intervallo: String(valori.intervallo),
      })) as unknown as Record<string, unknown>;
      if (resp.esito !== 'ok') {
        mostraRisposta(resp, 'Il widget non e stato salvato.');
        return;
      }
      // La chiusura vale solo per l'apertura che ha chiesto il salvataggio.
      // L'avviso e la prima fotografia invece vanno fatti comunque: il widget e'
      // stato salvato davvero, e tacerlo sarebbe peggio che darlo in ritardo.
      if (apertura.current === mia) onClose();
      onAggiunto({
        widget: (resp.widget || {}) as Widget,
        fotografia: resp.fotografia as WidgetAggiunto['fotografia'],
      });
    } catch (e) {
      feedback.failure(e);
    } finally {
      // Solo per la propria apertura: una risposta vecchia non deve spegnere la
      // rotella del tasto di una finestra che sta salvando adesso.
      if (apertura.current === mia) setSalvando(false);
    }
  };

  const filtri = bozza?.sorgente.filtri || [];
  return (
    <Modal
      open={open}
      title="Aggiungi alla dashboard"
      okText="Aggiungi"
      cancelText="Annulla"
      // Chiudibile anche mentre salva: se il salvataggio non tornasse (rete, server
      // appeso) Esc, X e Annulla non farebbero niente e l'utente resterebbe chiuso
      // dentro. L'esito arriva comunque, dal feedback.
      onCancel={onClose}
      onOk={() => form.submit()}
      // La rotella sta sul TASTO e non sulla finestra: con confirmLoading antd
      // ingoia Esc, la X e Annulla (Modal.handleCancel esce subito), e chi salva
      // resta chiuso dentro se la risposta non torna. Un Button in loading non
      // accetta clic, quindi la protezione dal doppio invio resta.
      okButtonProps={{ loading: salvando, disabled: caricando || !bozza }}
      destroyOnHidden
    >
      {caricando || !bozza ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" onFinish={salva} disabled={salvando}>
          <Form.Item label="Filtri della ricerca">
            {filtri.length === 0 ? (
              <Typography.Text type="secondary">Nessun filtro: la lista intera.</Typography.Text>
            ) : (
              <div>
                {filtri.map((f, i) => (
                  <Tag key={i} style={{ marginBottom: 4 }}>
                    {f.etichetta}
                    {f.negato ? ' (escluso)' : ''}
                    {f.casella ? '' : `: ${f.valore}`}
                  </Tag>
                ))}
              </div>
            )}
            {bozza.sorgente.filtriLeggibili === false && (
              <Typography.Text type="secondary">
                I valori sono quelli inseriti nella ricerca.
              </Typography.Text>
            )}
          </Form.Item>
          <Form.Item
            label="Nome del widget"
            name="titolo"
            rules={[{ required: true, message: 'Serve un nome', whitespace: true }]}
          >
            <Input maxLength={100} autoFocus />
          </Form.Item>
          <Form.Item label="Si aggiorna" name="intervallo">
            <Select options={INTERVALLI} />
          </Form.Item>
          <Typography.Text type="secondary">
            {(bozza.sorgente.colonne || []).length} colonne, come nella lista.
          </Typography.Text>
        </Form>
      )}
    </Modal>
  );
};

export default AddWidgetModal;
