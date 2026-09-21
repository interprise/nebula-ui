import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Quando l'aggiornamento era previsto: se e' passato, la fotografia e' in ritardo. */
  prossimoAgg?: string | null;
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
  sospeso?: boolean;
  descrizione?: string | null;
  filtriLeggibili?: boolean;
  colonne?: Colonna[];
  filtri?: Array<{ etichetta: string; valore: string; negato?: boolean; casella?: boolean }>;
  fotografia: Fotografia;
}

interface Props {
  /** Si richiama quando la Home torna a galla, per riprendere i dati aggiornati. */
  ricarica?: number;
}

/**
 * «Aggiorna ora» si accende con G8, che e' il pezzo che lo fa funzionare. Finche' e'
 * spento il pulsante non si disegna: un comando che apre un avviso su una versione
 * futura e' un comando morto in mano all'utente, e su un collaudo e' peggio.
 */
const AGGIORNA_ORA = false;

/** Che cosa dire all'utente per ogni stato della fotografia. */
const STATI: Record<string, string> = {
  PRE: 'Sto preparando i dati.',
  RUN: 'Aggiornamento in corso…',
  ERR: 'L\'ultimo aggiornamento non e\' riuscito.',
  NAC: 'Non hai accesso a questa lista.',
};

/**
 * I numeri come li scrive il resto dell'applicativo: il raggruppamento c'e' SEMPRE,
 * anche a quattro cifre (nelle liste si legge «1.220,00 €»). `toLocaleString('it-IT')`
 * da solo non basta: per l'italiano CLDR dichiara `minimumGroupingDigits=2`, quindi
 * scriverebbe «4762» dove qui si scrive «4.762» (Luca, 21/09).
 */
const NUMERO = (() => {
  try {
    // `useGrouping: 'always'` e' ES2023: la libreria di tipi qui e' piu' vecchia e lo
    // dichiara ancora booleano, il motore invece lo capisce. Se un giorno non lo
    // capisse, il catch torna al raggruppamento predefinito.
    return new Intl.NumberFormat('it-IT', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
  } catch {
    return new Intl.NumberFormat('it-IT');
  }
})();
const numero = (n: number) => NUMERO.format(n);

/**
 * Quando e' stata scattata. Solo l'ora se e' di oggi; con la data se e' piu' vecchia —
 * «aggiornato alle 14:43» su una fotografia di tre giorni fa la fa sembrare di
 * stamattina, ed e' proprio quello che il widget non deve far credere.
 */
const quando = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const oggi = new Date();
  const stessoGiorno =
    d.getDate() === oggi.getDate() &&
    d.getMonth() === oggi.getMonth() &&
    d.getFullYear() === oggi.getFullYear();
  return stessoGiorno
    ? `alle ${ora}`
    : `il ${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} alle ${ora}`;
};

/** L'aggiornamento era previsto e non e' arrivato: finche' non c'e' lo scheduler, capita. */
const inRitardo = (prossimo?: string | null) => {
  if (!prossimo) return false;
  const d = new Date(prossimo);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
};

const ogni = (min?: number) => {
  if (!min) return '';
  if (min === 1) return 'ogni minuto';
  if (min < 60) return `ogni ${min} minuti`;
  if (min === 60) return 'ogni ora';
  if (min === 1440) return 'ogni giorno';
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
  const [errore, setErrore] = useState<string | null>(null);
  /** Quale lettura e' l'ultima chiesta: le risposte in ritardo si scartano. */
  const richiesta = useRef(0);
  /** Il pannello e' ancora a video? Si smonta passando agli avvisi. */
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const leggi = useCallback(async () => {
    // Due letture insieme capitano gia' oggi togliendo due widget di fila, e con
    // «Aggiorna ora» (G8) diventeranno la norma: senza numero di sequenza la risposta
    // piu' lenta rimette a schermo un widget appena tolto.
    const mia = ++richiesta.current;
    setCaricando(true);
    try {
      const resp = (await api.postAction2('dashboard.Get')) as unknown as Record<string, unknown>;
      if (!vivo.current || mia !== richiesta.current) return;
      const errors = resp.errors as ErrorItem[] | undefined;
      if (errors && errors.length > 0) {
        feedback.showServerMessages(errors);
        setErrore('La dashboard non si e\' letta.');
        return;
      }
      setErrore(null);
      setWidget((resp.widget as Widget[]) || []);
    } catch (e) {
      // Niente finestre per un pannello che non c'e' piu': l'utente e' passato agli
      // avvisi e si vedrebbe comparire «Errore Server» per qualcosa che non guarda.
      if (!vivo.current || mia !== richiesta.current) return;
      feedback.failure(e);
      setErrore('La dashboard non si e\' letta.');
    } finally {
      if (vivo.current && mia === richiesta.current) setCaricando(false);
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

  // Una lettura fallita non e' «non hai widget»: invitare a ricrearli sarebbe un
  // consiglio sbagliato dato con sicurezza.
  if (errore)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span>{errore}</span>}
        style={{ padding: '40px 0' }}
      >
        <Button onClick={() => void leggi()} loading={caricando}>
          Riprova
        </Button>
      </Empty>
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
    <div className="dash-widgets" aria-busy={caricando}>
      {widget.map((w) => {
        // Un widget senza fotografia non deve portare giu' la pagina: GetCommand
        // costruisce la cornice di un widget illeggibile dentro un try che inghiotte
        // l'eccezione, quindi quella chiave puo' mancare. Qui moriva la Home intera —
        // niente commutatore, niente avvisi — sulla prima pagina che si apre.
        const foto: Fotografia = w.fotografia || {};
        const mostrate = (foto.righe || []).length;
        const totale = foto.totaleRighe;
        return (
        <article key={w.idWidget} className="dash-widget">
          <header className="dash-widget-head">
            <Typography.Text strong ellipsis={{ tooltip: w.titolo }}>
              {w.titolo}
            </Typography.Text>
            <Space size={0}>
              {AGGIORNA_ORA && (
                <Tooltip title="Aggiorna ora">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    aria-label="Aggiorna ora"
                    onClick={() => void leggi()}
                  />
                </Tooltip>
              )}
              {/* Niente suggerimento su questo tasto: resta aperto sotto il puntatore,
                  e quando la finestrella di conferma non ha spazio a destra antd la apre
                  proprio li' sopra — il tasto «Togli» si becca il clic del suggerimento
                  e il widget non si toglie (trovato dalla prova indipendente, 21/09).
                  Il nome del comando lo dice gia' aria-label, e la conferma si spiega da
                  se'. */}
              <Popconfirm
                title="Togliere questo widget?"
                description="La dashboard non lo mostrera' piu'. I dati non si toccano."
                okText="Togli"
                okButtonProps={{ danger: true }}
                cancelText="Annulla"
                onConfirm={() => rimuovi(w)}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`Togli ${w.titolo || 'widget'} dalla dashboard`}
                />
              </Popconfirm>
            </Space>
          </header>

          <div className="dash-widget-meta">
            {foto.ts ? (
              <span>aggiornato {quando(foto.ts)}</span>
            ) : (
              <span>mai aggiornato</span>
            )}
            {/* «ogni 30 minuti» e' quello che l'utente ha CHIESTO, non quello che
                succede: l'aggiornamento periodico non c'e' ancora. Dirlo come una
                previsione, e segnare quando e' saltata, e' l'unico modo onesto. */}
            {w.intervalloMin ? <span>· previsto {ogni(w.intervalloMin)}</span> : null}
            {inRitardo(foto.prossimoAgg) && foto.ts ? (
              <Typography.Text type="warning" style={{ fontSize: 11.5 }}>
                · in ritardo
              </Typography.Text>
            ) : null}
            {w.sospeso ? (
              <Typography.Text type="warning" style={{ fontSize: 11.5 }}>
                · sospeso
              </Typography.Text>
            ) : null}
            {totale != null ? (
              <span>
                ·{' '}
                {/* «prime N» deve essere il numero che si VEDE. La fotografia ne tiene
                    fino a 1.000, ma alla Home ne arrivano al massimo 200: dire «prime
                    1.000» con 200 righe sotto gli occhi e' una bugia misurabile. */}
                {mostrate < totale
                  ? `prime ${numero(mostrate)} di ${numero(totale)}`
                  : `${numero(totale)} ${totale === 1 ? 'riga' : 'righe'}`}
              </span>
            ) : null}
          </div>

          {/* Quando il server dice che i filtri non sono leggibili uno per uno, la
              frase che ha scritto lui vale piu' delle etichette col valore grezzo. */}
          {w.filtriLeggibili === false && w.descrizione ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {w.descrizione}
            </Typography.Text>
          ) : (w.filtri || []).length > 0 ? (
            <div className="dash-widget-filtri">
              {(w.filtri || []).map((f, i) => (
                <Tag key={i}>
                  {f.etichetta}
                  {f.negato ? ' (escluso)' : ''}
                  {f.casella ? '' : `: ${f.valore}`}
                </Tag>
              ))}
            </div>
          ) : null}
          {w.errore ? (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {w.errore}
            </Typography.Text>
          ) : null}

          {foto.schemaCambiato && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              La lista e&apos; cambiata dopo l&apos;ultimo aggiornamento: le colonne
              potrebbero non corrispondere.
            </Typography.Text>
          )}

          {foto.stato === 'OK' ? (
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
                  {(foto.righe || []).map((r, i) => (
                    <tr key={r.k || i}>
                      {(r.c || []).map((cella, j) => (
                        // Gli importi a destra come in ogni lista: il valore grezzo
                        // della cella dice gia' se e' un numero, non serve indovinarlo
                        // dal testo formattato.
                        <td key={j} className={typeof cella.v === 'number' ? 'number' : undefined}>
                          {cella.t}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(w.colonne || []).length === 0 && mostrate > 0 && (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>
                  Le colonne di questa lista non si leggono piu&apos;: le righe sono
                  quelle salvate, ma senza intestazioni.
                </Typography.Text>
              )}
              {(foto.righe || []).length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Nessuna riga: oggi questa ricerca non trova niente.
                </Typography.Text>
              )}
            </div>
          ) : (
            <>
              <Typography.Text type="secondary">
                {STATI[foto.stato || ''] || 'In attesa di dati.'}
              </Typography.Text>
              {/* Il testo tecnico si LEGGE — chi sta davanti a un widget rotto deve
                  poter dire al telefono che cosa c'e' scritto, e nasconderlo dietro il
                  passaggio del mouse lo toglierebbe a chi usa un dito o un lettore di
                  schermo. Ma sta in piccolo e su una riga sola: per esteso lo da' il
                  suggerimento. */}
              {foto.messaggio ? (
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 11.5 }}
                  ellipsis={{ tooltip: foto.messaggio }}
                >
                  {foto.messaggio}
                </Typography.Text>
              ) : null}
            </>
          )}
        </article>
        );
      })}
    </div>
  );
};

export default DashboardPanel;
