import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import * as api from '../services/api';
import { useFeedback } from '../hooks/feedback';
import type { ErrorItem } from '../types/ui';

/** Una colonna della lista fotografata: l'intestazione che il widget mostra. */
interface Colonna {
  etichetta?: string;
  tipo?: string | null;
}

/** Una riga: la chiave del record, e una cella per colonna (t = il testo della lista). */
interface Riga {
  k?: string;
  c?: Array<{ t?: string; v?: unknown; errore?: string }>;
}

interface Fotografia {
  stato?: string;
  ts?: string | null;
  messaggio?: string | null;
  /** Il conteggio VERO della lista. */
  totaleRighe?: number | null;
  /** Quante ne tiene la fotografia (tetto 1.000). */
  righeInFotografia?: number;
  righe?: Riga[];
  parziale?: boolean;
  schemaCambiato?: boolean;
}

interface Widget {
  idWidget: number;
  titolo?: string;
  forma?: string;
  intervalloMin?: number;
  viewName?: string;
  errore?: string | null;
  descrizione?: string | null;
  colonne?: Colonna[];
  filtri?: Array<{ etichetta: string; valore: string; negato?: boolean; casella?: boolean }>;
  fotografia: Fotografia;
}

interface Props {
  /** Si richiama quando la Home torna a galla, per riprendere i dati aggiornati. */
  ricarica?: number;
}

/** Che cosa dire all'utente per ogni stato della fotografia. */
const STATI: Record<string, string> = {
  PRE: 'Sto preparando i dati.',
  RUN: 'Aggiornamento in corso…',
  ERR: 'L\'ultimo aggiornamento non e\' riuscito.',
  NAC: 'Non hai accesso a questa lista.',
};

const orario = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
};

const ogni = (min?: number) => {
  if (!min) return '';
  if (min < 60) return `ogni ${min} minuti`;
  if (min === 60) return 'ogni ora';
  if (min % 60 === 0) return `ogni ${min / 60} ore`;
  return `ogni ${min} minuti`;
};

/**
 * SXADV-62 · La dashboard dentro la Home.
 *
 * <p>I widget si leggono da `dashboard.Get`, che li prende dalla FOTOGRAFIA salvata:
 * aprire la Home non rilancia nessuna delle ricerche che ci stanno dentro, ed e' il
 * criterio del pezzo. Quello che si vede — intestazioni, testi delle celle, conteggio —
 * e' quello che il server ha gia' calcolato quando il widget e' stato aggiunto.
 */
const DashboardPanel: React.FC<Props> = ({ ricarica }) => {
  const feedback = useFeedback();
  const [widget, setWidget] = useState<Widget[] | null>(null);
  const [caricando, setCaricando] = useState(true);

  const leggi = useCallback(async () => {
    setCaricando(true);
    try {
      const resp = (await api.postAction2('dashboard.Get')) as unknown as Record<string, unknown>;
      const errors = resp.errors as ErrorItem[] | undefined;
      if (errors && errors.length > 0) {
        feedback.showServerMessages(errors);
        setWidget([]);
        return;
      }
      setWidget((resp.widget as Widget[]) || []);
    } catch (e) {
      feedback.failure(e);
      setWidget([]);
    } finally {
      setCaricando(false);
    }
    // feedback e' memoizzato da useFeedback: non rientra fra le dipendenze per
    // non rifare la lettura a ogni ridisegno (vedi AddWidgetModal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void leggi();
  }, [leggi, ricarica]);

  const rimuovi = async (w: Widget) => {
    try {
      const resp = (await api.postAction2('dashboard.RimuoviWidget', {
        idWidget: String(w.idWidget),
      })) as unknown as Record<string, unknown>;
      if (resp.esito !== 'ok') {
        const errors = resp.errors as ErrorItem[] | undefined;
        if (errors && errors.length > 0) feedback.showServerMessages(errors);
        else feedback.error(String(resp.messaggio || 'Il widget non e stato tolto.'));
        return;
      }
      feedback.info(`"${w.titolo || 'Widget'}" tolto dalla dashboard.`);
      void leggi();
    } catch (e) {
      feedback.failure(e);
    }
  };

  if (caricando && widget === null)
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <Spin />
      </div>
    );

  if (!widget || widget.length === 0)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            Nessun widget. Si aggiungono da una lista, con il pulsante{' '}
            <b>Aggiungi alla dashboard</b>: il widget ricorda i filtri che stai usando.
          </span>
        }
        style={{ padding: '40px 0' }}
      />
    );

  return (
    <div className="dash-widgets">
      {widget.map((w) => (
        <article key={w.idWidget} className="dash-widget">
          <header className="dash-widget-head">
            <Typography.Text strong ellipsis={{ tooltip: w.titolo }}>
              {w.titolo}
            </Typography.Text>
            <Space size={0}>
              <Tooltip title="Aggiorna ora">
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  aria-label="Aggiorna ora"
                  onClick={() =>
                    feedback.info('L\'aggiornamento a richiesta arriva col prossimo pezzo.')
                  }
                />
              </Tooltip>
              <Popconfirm
                title="Togliere questo widget?"
                description="La dashboard non lo mostrera' piu'. I dati non si toccano."
                okText="Togli"
                cancelText="Annulla"
                onConfirm={() => rimuovi(w)}
              >
                <Tooltip title="Togli dalla dashboard">
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label={`Togli ${w.titolo || 'widget'} dalla dashboard`}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          </header>

          <div className="dash-widget-meta">
            {w.fotografia.ts ? (
              <span>aggiornato alle {orario(w.fotografia.ts)}</span>
            ) : (
              <span>mai aggiornato</span>
            )}
            {w.intervalloMin ? <span>· {ogni(w.intervalloMin)}</span> : null}
            {w.fotografia.totaleRighe != null ? (
              <span>
                ·{' '}
                {w.fotografia.parziale
                  ? `prime ${(w.fotografia.righeInFotografia || 0).toLocaleString('it-IT')} di ${w.fotografia.totaleRighe.toLocaleString('it-IT')}`
                  : `${w.fotografia.totaleRighe.toLocaleString('it-IT')} righe`}
              </span>
            ) : null}
          </div>

          {(w.filtri || []).length > 0 && (
            <div className="dash-widget-filtri">
              {(w.filtri || []).map((f, i) => (
                <Tag key={i}>
                  {f.etichetta}
                  {f.negato ? ' (escluso)' : ''}
                  {f.casella ? '' : `: ${f.valore}`}
                </Tag>
              ))}
            </div>
          )}

          {w.fotografia.schemaCambiato && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              La lista e&apos; cambiata dopo l&apos;ultimo aggiornamento: le colonne
              potrebbero non corrispondere.
            </Typography.Text>
          )}

          {w.fotografia.stato === 'OK' ? (
            <div className="dash-widget-tabella">
              <table>
                <thead>
                  <tr>
                    {(w.colonne || []).map((c, i) => (
                      <th key={i}>{c.etichetta}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(w.fotografia.righe || []).map((r, i) => (
                    <tr key={r.k || i}>
                      {(r.c || []).map((cella, j) => (
                        <td key={j}>{cella.t}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(w.fotografia.righe || []).length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Nessuna riga: oggi questa ricerca non trova niente.
                </Typography.Text>
              )}
            </div>
          ) : (
            <Typography.Text type="secondary">
              {STATI[w.fotografia.stato || ''] || 'In attesa di dati.'}
              {w.fotografia.messaggio ? ` (${w.fotografia.messaggio})` : ''}
            </Typography.Text>
          )}
        </article>
      ))}
    </div>
  );
};

export default DashboardPanel;
