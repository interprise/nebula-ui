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

/**
 * Una riga: la chiave del record, e una cella per colonna (t = il testo della lista).
 * Dopo un aggiornamento la riga puo' portare `n` (nuova) e la cella `p` (il valore di
 * prima): le marcature le mette il server confrontando le due fotografie.
 */
interface Riga {
  k?: string;
  n?: boolean;
  c?: Array<{ t?: string; v?: unknown; p?: string | null; errore?: string }>;
}

interface Variazioni {
  nuove?: number;
  cambiate?: number;
  uscite?: number;
  totale?: number;
  /** La ricerca di adesso non e' quella di prima: le righe non si appaiano. */
  criteriDiversi?: boolean;
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
  /** Le righe che nell'ultimo aggiornamento sono sparite dall'elenco. */
  uscite?: Riga[];
  variazioni?: Variazioni;
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
 * La dashboard parla al server con un sid SUO. `Controller` esegue ogni comando dentro
 * il monitor della Session, e senza sid finirebbe su `S1`, la stessa delle schede di
 * lavoro: un «Aggiorna ora» su una lista pesante — due minuti misurati — terrebbe fermo
 * tutto quello che l'utente clicca nel frattempo, con la sola barra in cima a dirlo.
 * Il lavoro vero gira comunque in una Session di servizio (SXADV-62, revisione 22/09).
 *
 * <p>Il lavoro dei comandi di dashboard sta tutto in una Session di servizio, mai su
 * questo sid: e' quello che permette al polling di convivere col job sulla stessa
 * Session senza ricadere in SXADV-5795. Chi aggiunge un comando qui deve tenere
 * l'abitudine. (Una connessione la prende comunque la PRIMA richiesta su un sid nuovo,
 * quella che autentica: non si sovrappone a niente, ma non e' «mai».)
 */
const SID = 'D1';

/**
 * Il sid su cui gira il JOB di «Aggiorna ora»: uno per widget.
 *
 * <p>Una Session ha un solo turno di job. Tenendoli tutti su `D1`, aggiornare un
 * secondo widget mentre il primo lavora si sarebbe preso un rifiuto per un quarto
 * d'ora — prima i due andavano in parallelo, e la prova sul server vero l'ha visto
 * subito. Una sessione per widget rimette le cose come stavano, e per giunta lascia
 * ogni job da solo sulla sua Session. Sono Session vuote: non aprono nessuna vista e
 * non prendono nessuna connessione.
 */
const sidJob = (idWidget: number) => `DJ${Math.trunc(idWidget)}`;

/**
 * Oltre questo non si aspetta piu'. Il server molla una prenotazione dopo un quarto
 * d'ora; se a venti minuti il job risulta ancora vivo qualcosa non ha funzionato, e
 * continuare a chiedere non lo farebbe finire.
 */
const ATTESA_MASSIMA_MS = 20 * 60000;

/**
 * Segue un comando che il server ha trasformato in JOB.
 *
 * <p>Rifare la ricerca di una lista pesante dura minuti, e una POST aperta cosi' a
 * lungo la chiude un proxy prima che il server abbia finito. Lato server la protezione
 * c'e' gia': passato il tempo di attesa la richiesta risponde `trackAsynchJob` e il
 * lavoro continua per conto suo. Il polling tocca a noi — e' la stessa cosa che fa
 * `Shell.pollProgress` per le ricerche lunghe.
 *
 * <p>Si smette quando la risposta non porta piu' `trackAsynchJob`: quello e' l'unico
 * segnale che il job e' DAVVERO finito. Fermarsi a `progress === 100` sarebbe troppo
 * presto — il server mette 100 appena il lavoro e' eseguito, ma l'esito lo deposita
 * subito dopo, e si rischierebbe di leggere una risposta ancora senza.
 *
 * @param vivo si richiama a ogni giro: se torna false il pannello non c'e' piu' e si
 *          smette di chiedere (il lavoro sul server finisce lo stesso e la prossima
 *          lettura lo trova fatto).
 * @returns la risposta finale, o null se si e' smesso di seguirlo.
 */
async function seguiJob(
  prima: Record<string, unknown>,
  sid: string,
  vivo: () => boolean
): Promise<Record<string, unknown> | null> {
  if (!prima.trackAsynchJob) return prima;
  const scadenza = Date.now() + ATTESA_MASSIMA_MS;
  let attesa = 500;
  api.beginTrackedJob();
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, attesa));
      if (!vivo()) return null;
      const resp = (await api.checkProgress(sid)) as unknown as Record<string, unknown>;
      if (!resp.trackAsynchJob) return resp;
      // Si smette di guardare, ma il lavoro sul server continua e si salva da se':
      // quindi non e' un errore da finestra, ed e' sbagliato dire «riprova» (chi
      // riprovasse subito si prenderebbe «si sta gia' aggiornando»).
      if (Date.now() > scadenza) return { dashboardAggiorna: { esito: 'errore', motivo: 'TEMPO',
        messaggio: 'L\'aggiornamento sta durando molto: smetto di seguirlo, ma va avanti.'
          + ' Il risultato comparira\' da se\'.' } };
      attesa = Math.min(attesa * 2, 5000);
    }
  } finally {
    api.endTrackedJob();
  }
}

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
 * Porta in vista la prima variazione del widget.
 *
 * <p>Il bersaglio e' una CELLA, mai la riga: una riga e' larga quanto la tabella, e
 * centrarla porta fuori la prima colonna — cioe' il codice del record e la parola
 * «nuova», che e' l'evidenza che non dipende dal colore.
 *
 * <p>Si riprova per qualche disegno: quando la tabella e' grande React non ha ancora
 * finito, e un tentativo solo non trovava niente e non scorreva — in silenzio.
 */
const mostraPrimaVariazione = (idWidget: number, tentativi = 12) => {
  const cerca = () => {
    const riquadro = document.querySelector(`[data-widget="${idWidget}"]`);
    const bersaglio =
      riquadro?.querySelector('td.cella-cambiata') ||
      riquadro?.querySelector('tr.riga-nuova td');
    if (bersaglio) {
      bersaglio.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      return;
    }
    if (tentativi > 0) mostraPrimaVariazione(idWidget, tentativi - 1);
  };
  requestAnimationFrame(cerca);
};

/** «3 nuove, 2 cambiate e 1 uscita»: si nominano solo le cose che sono successe. */
const descriviVariazioni = (v: Variazioni) => {
  const pezzi: string[] = [];
  if (v.nuove) pezzi.push(`${v.nuove} ${v.nuove === 1 ? 'nuova' : 'nuove'}`);
  if (v.cambiate) pezzi.push(`${v.cambiate} ${v.cambiate === 1 ? 'cambiata' : 'cambiate'}`);
  if (v.uscite) pezzi.push(`${v.uscite} ${v.uscite === 1 ? 'uscita' : 'uscite'}`);
  if (pezzi.length === 0) return 'nessuna variazione';
  if (pezzi.length === 1) return pezzi[0];
  return pezzi.slice(0, -1).join(', ') + ' e ' + pezzi[pezzi.length - 1];
};

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
  /** Quali widget stanno aggiornando adesso: e' roba del singolo, non del pannello. */
  const [inCorso, setInCorso] = useState<Record<number, boolean>>({});
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
      const resp = (await api.postAction2('dashboard.Get', { sid: SID })) as unknown as Record<
        string,
        unknown
      >;
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

  const aggiorna = async (w: Widget) => {
    if (inCorso[w.idWidget]) return;
    setInCorso((p) => ({ ...p, [w.idWidget]: true }));
    try {
      const sid = sidJob(w.idWidget);
      const avvio = (await api.postAction2('dashboard.Aggiorna', {
        sid,
        idWidget: String(w.idWidget),
      })) as unknown as Record<string, unknown>;
      // Oltre i 25 secondi il server risponde «sto lavorando» e l'esito arriva col
      // polling: nella forma e' la stessa risposta, quindi da qui in giu' non cambia
      // niente.
      const resp = await seguiJob(avvio, sid, () => vivo.current);
      // Il pannello puo' essersi smontato nei due minuti dell'aggiornamento: non gli si
      // apre una finestra addosso a chi nel frattempo sta guardando altro.
      if (!resp || !vivo.current) return;
      const esito = (resp.dashboardAggiorna || {}) as Record<string, unknown>;
      if (esito.esito !== 'ok') {
        const errors = resp.errors as ErrorItem[] | undefined;
        const motivo = String(esito.motivo || '');
        if (errors && errors.length > 0) feedback.showServerMessages(errors);
        else if (motivo === 'TROPPO_PRESTO' || motivo === 'IN_CORSO' || motivo === 'ALTRO_IN_CORSO'
          || motivo === 'TEMPO')
          // Un freno da un minuto non merita una finestra da chiudere.
          feedback.info(String(esito.messaggio || 'Riprova fra poco.'));
        else feedback.error(String(esito.messaggio || 'L\'aggiornamento non e riuscito.'));
        return;
      }
      const v = (esito.variazioni || {}) as Variazioni;
      feedback.info(
        v.criteriDiversi
          ? `"${w.titolo || 'Widget'}" aggiornato. I criteri sono cambiati dall'ultima`
            + ' volta (una data che si aggiorna da sola), quindi le righe non si possono'
            + ' confrontare con quelle di prima.'
          : v.totale
            ? `"${w.titolo || 'Widget'}" aggiornato: ${descriviVariazioni(v)}.`
            : `"${w.titolo || 'Widget'}" aggiornato: nessuna variazione.`
      );
      // Si rilegge tutto: le righe arrivano gia' con le variazioni segnate sopra, e
      // cosi' quello che si vede e' esattamente quello che c'e' salvato.
      await leggi();
      // E si porta la vista sulla prima variazione: la tabella del widget scorre in
      // orizzontale, e una cella cambiata in una colonna fuori schermo e' un'evidenza
      // che non evidenzia niente — chi preme «Aggiorna ora» legge solo il riepilogo e
      // deve andarsela a cercare.
      if (v.totale && !v.criteriDiversi) mostraPrimaVariazione(w.idWidget);
    } catch (e) {
      // Il polling puo' durare minuti: se nel frattempo l'utente e' andato altrove, una
      // JSONProgress caduta gli aprirebbe «Errore Server» sopra la maschera che sta
      // compilando. Stesso riguardo che ha leggi() (revisione indipendente, 22/09).
      if (vivo.current) feedback.failure(e);
    } finally {
      setInCorso((p) => {
        const q = { ...p };
        delete q[w.idWidget];
        return q;
      });
    }
  };

  const rimuovi = async (w: Widget) => {
    try {
      const resp = (await api.postAction2('dashboard.RimuoviWidget', {
        sid: SID,
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
        const visibili = (foto.righe || []).filter(
          (r) => r.n || (r.c || []).some((c) => c.p !== undefined)
        ).length;
        const totale = foto.totaleRighe;
        return (
        <article key={w.idWidget} className="dash-widget" data-widget={w.idWidget}>
          <header className="dash-widget-head">
            <Typography.Text strong ellipsis={{ tooltip: w.titolo }}>
              {w.titolo}
            </Typography.Text>
            <Space size={0}>
              {(
                <Tooltip title="Aggiorna ora">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined spin={!!inCorso[w.idWidget]} />}
                    aria-label="Aggiorna ora"
                    disabled={!!inCorso[w.idWidget]}
                    onClick={() => void aggiorna(w)}
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

          {foto.stato === 'OK' ? null : (
            <>
              <Typography.Text type="secondary">
                {STATI[foto.stato || ''] || 'In attesa di dati.'}
              </Typography.Text>
              {/* Il testo tecnico si LEGGE — chi sta davanti a un widget rotto deve
                  poter dire al telefono che cosa c'e' scritto — ma in piccolo e su una
                  riga sola: per esteso lo da' il suggerimento. */}
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
          {/* Le righe si mostrano se ci sono, qualunque sia lo stato: dopo un
              aggiornamento fallito la fotografia buona resta nel database, e lasciarla
              fuori dagli occhi vuol dire che «resta» solo per modo di dire. */}
          {mostrate > 0 ? (
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
                    <tr key={r.k || i} className={r.n ? 'riga-nuova' : undefined}>
                      {(r.c || []).map((cella, j) => {
                        // Gli importi a destra come in ogni lista: il valore grezzo
                        // della cella dice gia' se e' un numero, non serve indovinarlo
                        // dal testo formattato.
                        const classi = [
                          typeof cella.v === 'number' ? 'number' : '',
                          cella.p !== undefined ? 'cella-cambiata' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <td key={j} className={classi || undefined}>
                            {/* Il valore di prima accanto a quello nuovo: e' l'unica
                                cosa che rende leggibile «e' cambiato», e arriva gia'
                                formattato dal server. */}
                            {cella.p !== undefined && cella.p !== null ? (
                              <s className="valore-prima">{cella.p}</s>
                            ) : null}
                            {j === 0 && r.n ? <span className="segno-nuova">nuova</span> : null}
                            {cella.t}
                          </td>
                        );
                      })}
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
          ) : null}
          {foto.variazioni?.criteriDiversi ? (
            <div className="dash-widget-variazioni">
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                I criteri sono cambiati dall&apos;ultima volta (una data che si aggiorna da
                sola): le righe non si sono potute confrontare con quelle di prima.
              </Typography.Text>
            </div>
          ) : null}
          {(foto.variazioni?.totale || 0) > 0 ? (
            <div className="dash-widget-variazioni">
              <span className="chiave chiave-nuova" aria-hidden="true" />{' '}
              {descriviVariazioni(foto.variazioni || {})}{' '}
              dall&apos;ultimo aggiornamento
              {/* Il conteggio e' sulla fotografia intera, la tabella ne mostra al
                  massimo 200: dire 37 e mostrarne 3 senza spiegarlo e' una bugia
                  involontaria. */}
              {visibili > 0 && visibili < (foto.variazioni?.totale || 0)
                ? ` (${visibili} qui sotto)`
                : null}
              {foto.parziale
                ? `, confronto sulle prime ${numero((foto.righeInFotografia || 0))} di ${numero(totale || 0)}`
                : null}
              {(foto.uscite || []).length > 0 ? (
                <details>
                  <summary>
                    {(foto.uscite || []).length}{' '}
                    {foto.parziale
                      ? 'non piu\' fra le prime righe'
                      : (foto.uscite || []).length === 1
                        ? 'uscita dall\'elenco'
                        : 'uscite dall\'elenco'}
                  </summary>
                  <ul>
                    {(foto.uscite || []).map((r, i) => (
                      <li key={r.k || i}>
                        <s>{(r.c || []).map((c) => c.t).filter(Boolean).slice(0, 3).join(' · ')}</s>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          {mostrate === 0 && foto.stato === 'OK' ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Nessuna riga: oggi questa ricerca non trova niente.
            </Typography.Text>
          ) : null}
        </article>
        );
      })}
    </div>
  );
};

export default DashboardPanel;
