import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, CloseOutlined, EditOutlined, EyeOutlined, UnorderedListOutlined } from '@ant-design/icons';
import * as api from '../services/api';
import { useFeedback } from '../hooks/feedback';
import type { ErrorItem } from '../types/ui';
import { RisultatoVista } from './dashboard/RisultatoWidget';
import {
  mostraRisultato,
  type Opzioni,
  type Risultato,
  type Trasformazione,
} from './dashboard/risultato';
import ModificaWidget from './dashboard/ModificaWidget';
import GrigliaWidget, { type PostoSalvato } from './dashboard/GrigliaWidget';
import { ordinaRighe, permuta } from './dashboard/ordineColonne';

/** Una colonna della lista fotografata: l'intestazione che il widget mostra. */
interface Colonna {
  /** Il nome con cui la trasformazione si riferisce alla colonna. */
  item?: string;
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
  /** L'azienda del record: c'e' solo nei widget su piu' aziende (SXADV-6000). */
  az?: string;
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
  /** L'ultimo tentativo, anche fallito: cambia quando il giro ci riprova. */
  tsTentativo?: string | null;
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
  /**
   * Il `ts` della fotografia che questa persona ha visto l'ultima volta (F2 pezzo 2), o
   * null. Con un `visto` le evidenze sono rispetto a quello, non all'aggiornamento
   * precedente.
   */
  visto?: string | null;
  /** Perche' l'ultimo aggiornamento e' fallito (VIEW, MENU, SEZIONE, CRITERI, RICERCA…). */
  motivo?: string | null;
  /** La lista d'origine e' cambiata: il widget non si aggiorna piu' da solo (pezzo 3). */
  definitivo?: boolean;
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
  /** Chi guarda ne e' l'autore e puo' cambiarne la definizione (F2 §10.1). */
  modificabile?: boolean;
  descrizione?: string | null;
  filtriLeggibili?: boolean;
  colonne?: Colonna[];
  /** Permutazione di `colonne`: la posizione che avevano nella lista (SXADV-6001.0). */
  ordineColonne?: number[] | null;
  /**
   * L'ordinamento cliccato su una lista che stava in una pagina (lo faceva AG Grid, il
   * server non lo conosce): colonna = indice in `colonne` e nelle celle (SXADV-6001.0).
   */
  ordinamentoLocale?: { colonna: number; verso: 'asc' | 'desc' } | null;
  filtri?: Array<{ etichetta: string; valore: string; negato?: boolean; casella?: boolean }>;
  fotografia: Fotografia;
  /** La trasformazione salvata (G9), o null: il widget mostra la lista. */
  trasformazione?: Trasformazione | null;
  opzioni?: Opzioni | null;
  /** La vista che apre il clic su una riga, o null: righe non cliccabili. */
  dettaglio?: string | null;
  /** Il dettaglio della lista, segnaposto del campo in «Modifica widget». */
  dettaglioPredefinito?: string | null;
  /**
   * Da quali aziende vengono i risultati (SXADV-6000): `codici` sono quelle effettive
   * adesso; `possibile` dice se la lista dipende dall'azienda.
   */
  ambito?: Ambito;
  /** Il risultato gia' calcolato dal server: il client lo disegna e basta. */
  risultato?: Risultato | null;
}

export interface Ambito {
  modo?: 'corrente' | 'scelte' | 'tutte';
  codici?: string[];
  possibile?: boolean;
  /** Abilitate ma lasciate fuori: li' l'utente ha un altro profilo (SXADV-6000). */
  escluse?: string[];
}

/** Un'azienda su cui l'utente puo' entrare. */
export interface AziendaAbilitata {
  codice: string;
  descrizione?: string;
}

/**
 * Le fotografie che la Home mostra e che non sono ancora il «visto» di chi guarda, tolte
 * quelle gia' segnate da sole con quel `ts` (la risposta dice il visto solo alla rilettura).
 */
const daSegnare = (lista: Widget[] | null, segnate: Map<number, Fotografia>) =>
  (lista || [])
    .filter((w) => !!w.fotografia?.ts && w.fotografia.ts !== w.fotografia.visto
      && segnate.get(w.idWidget)?.ts !== w.fotografia.ts)
    .map((w) => ({ idWidget: w.idWidget, ts: w.fotografia.ts as string }));

/** «Segna come viste» nel riquadro delle variazioni di un widget (contratto VISTO C4). */
const SegnaVisteBottone: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button type="link" size="small" className="dash-visto" onClick={onClick}>
    Segna come viste
  </Button>
);

/** Il widget prende i risultati da piu' aziende (o da un'altra)? */
const suPiuAziende = (w: Widget) => !!w.ambito && !!w.ambito.modo && w.ambito.modo !== 'corrente';

interface Props {
  /** Si richiama quando la Home torna a galla, per riprendere i dati aggiornati. */
  ricarica?: number;
  /**
   * Apre il record di una riga nella scheda corrente, come funzione di primo livello
   * (`ViewByKey` con `newTask`): la Shell lo sa fare, il pannello no. Senza, le righe
   * non si cliccano.
   */
  /** Torna false se la scheda non ha potuto partire (sta gia' caricando). */
  onApriDettaglio?: (titolo: string, viewName: string, chiave: string) => boolean;
  /**
   * «Naviga» (SXADV-5999.2): apre nella scheda corrente la lista della ricerca del
   * widget, rifatta oggi (`dashboard.Naviga` con `newTask`). Senza, il bottone non c'e'.
   */
  onNaviga?: (titolo: string, idWidget: number) => boolean;
  /**
   * Chiesto PRIMA dei controlli sul server di un'apertura (ApriRecord, PreparaNaviga):
   * se la scheda che la riceverebbe sta ancora lavorando, la Shell lo dice e torna
   * false, e qui non parte niente. Assente = sempre si'.
   */
  puoAprire?: () => boolean;
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
 * «Aggiorna ora» non esegue piu' niente nella richiesta (SXADV-62 F2, 01/10): mette il
 * widget in testa alla coda del giro, che aggiorna un widget alla volta in tutto il
 * sistema (Luca: «non farei tanti aggiornamenti in parallelo»). Da qui si segue con
 * `dashboard.Stato`, che non legge le righe ed e' leggero.
 */
/** Ogni quanto si guarda un widget in coda o in corso. */
const PASSO_CODA_MS = 5000;
/** Ogni quanto, con la Home a video, si guarda se il giro ha aggiornato qualcosa. */
const PASSO_CONTROLLO_MS = 60000;
/**
 * Dopo quanto tempo di Home visibile quello che mostra conta come visto (piano F1 §3.4,
 * contratto VISTO C1): abbastanza da non segnare una Home attraversata per sbaglio.
 */
const ATTESA_VISTO_MS = 5000;

/** Una riga di `dashboard.Stato`. */
interface StatoWidget {
  idWidget: number;
  stato?: string;
  ts?: string | null;
  tsTentativo?: string | null;
  inCoda?: boolean;
  /** RUN con una prenotazione fresca; assente = si guarda solo lo stato. */
  inCorso?: boolean;
  posizione?: number | null;
  messaggio?: string | null;
}
interface RispostaStato {
  esito?: string;
  widget?: StatoWidget[];
  giro?: { attivo?: boolean };
}

/** Un widget che aspetta il giro: in coda, o gia' in lavorazione. */
interface InAttesa {
  fase: 'coda' | 'corso';
  posizione: number | null;
  /** Il ts della fotografia quando lo si e' chiesto: quando cambia, e' arrivato. */
  tsPrima: string | null;
  /** Lo ha chiesto l'utente da qui (allora a fine lavoro gli si dice com'e' andata). */
  chiesto: boolean;
  /** Quando e' entrato in attesa: una risposta di Stato partita PRIMA non lo tocca. */
  dal: number;
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

/**
 * Quando il giro riprova dopo un errore transitorio: «riprovo alle 14:30», o «domani alle
 * 09:15» (l'attesa arriva al massimo a un giorno). Null se non si sa.
 */
const riprovo = (prossimo?: string | null) => {
  if (!prossimo) return null;
  const d = new Date(prossimo);
  if (Number.isNaN(d.getTime())) return null;
  // Gia' passato: il giro e' in ritardo, un orario passato direbbe il falso.
  if (d.getTime() <= Date.now()) return 'riprovo a breve';
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const oggi = new Date();
  const domani = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() + 1);
  if (d.toDateString() === oggi.toDateString()) return `riprovo alle ${ora}`;
  if (d.toDateString() === domani.toDateString()) return `riprovo domani alle ${ora}`;
  return `riprovo il ${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} alle ${ora}`;
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
const DashboardPanel: React.FC<Props> = ({ ricarica, onApriDettaglio, onNaviga, puoAprire }) => {
  const feedback = useFeedback();

  /**
   * Un clic gia' partito: finche' la Home non lascia il posto al dettaglio (e si smonta)
   * o non arriva un errore, gli altri clic non aprono niente. Un tempo di sicurezza lo
   * libera se la ViewByKey fallisse lasciando la Home a video.
   */
  const apertura = useRef(false);

  /**
   * Il server ha detto di no. Un rifiuto previsto porta `messaggio` e resta un avviso;
   * un'eccezione arriva da Controller solo come `errors`, e va nella finestra degli
   * errori come ogni altro errore del server: mostrare la sola frase di ripiego
   * nascondeva proprio il testo che serve a capire (Naviga su ALFA, 28/09).
   */
  const rifiuto = useCallback(
    (resp: Record<string, unknown>, ripiego: string) => {
      const errors = resp.errors as ErrorItem[] | undefined;
      if (typeof resp.messaggio !== 'string' && Array.isArray(errors) && errors.length > 0) {
        feedback.showServerMessages(errors);
        return;
      }
      feedback.warning(typeof resp.messaggio === 'string' && resp.messaggio ? resp.messaggio : ripiego);
    },
    [feedback],
  );

  /**
   * Il clic su una riga: prima il server dice quale dettaglio e se il record c'e' ancora
   * (dashboard.ApriRecord, sul sid della dashboard); solo allora la Shell lo apre nella
   * scheda. Senza il controllo, un record cancellato dopo l'ultimo aggiornamento
   * lascerebbe la scheda senza pagina: «Sessione non valida».
   */
  const apriRecord = useCallback(
    async (w: Widget, chiave: string) => {
      if (!onApriDettaglio || apertura.current) return;
      if (puoAprire && !puoAprire()) return;
      apertura.current = true;
      let aperto = false;
      try {
        const resp = (await api.postAction2('dashboard.ApriRecord', {
          sid: SID,
          idWidget: String(w.idWidget),
          k: chiave,
        })) as unknown as Record<string, unknown>;
        if (resp.esito === 'ok' && typeof resp.viewName === 'string' && resp.viewName) {
          // La guardia resta chiusa solo se l'apertura e' partita davvero.
          aperto = onApriDettaglio(w.titolo || 'Dettaglio', resp.viewName, chiave);
          if (!aperto) return;
          window.setTimeout(() => { apertura.current = false; }, 20000);
          return;
        }
        rifiuto(resp, 'Questo record non si puo\' aprire.');
      } catch (e) {
        feedback.failure(e);
      } finally {
        if (!aperto) apertura.current = false;
      }
    },
    [onApriDettaglio, puoAprire, feedback, rifiuto],
  );

  /**
   * «Naviga»: prima il server controlla che la ricerca del widget si possa riaprire
   * (dashboard.PreparaNaviga, senza eseguirla), poi la Shell apre la lista nella scheda.
   * Stesso turno dei clic sulle righe: una cosa alla volta.
   */
  const naviga = useCallback(
    async (w: Widget) => {
      if (!onNaviga || apertura.current) return;
      if (puoAprire && !puoAprire()) return;
      apertura.current = true;
      let aperto = false;
      try {
        const resp = (await api.postAction2('dashboard.PreparaNaviga', {
          sid: SID,
          idWidget: String(w.idWidget),
        })) as unknown as Record<string, unknown>;
        if (resp.esito === 'ok') {
          aperto = onNaviga(w.titolo || 'Lista', w.idWidget);
          if (!aperto) return;
          window.setTimeout(() => { apertura.current = false; }, 20000);
          return;
        }
        rifiuto(resp, 'La lista di questo widget non si puo\' aprire.');
      } catch (e) {
        feedback.failure(e);
      } finally {
        if (!aperto) apertura.current = false;
      }
    },
    [onNaviga, puoAprire, feedback, rifiuto],
  );
  const [widget, setWidget] = useState<Widget[] | null>(null);
  const [caricando, setCaricando] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  /** Il widget aperto nel pannello «Modifica widget». */
  const [modifica, setModifica] = useState<Widget | null>(null);
  /** L'azienda corrente e quelle abilitate (SXADV-6000), come le dice dashboard.Get. */
  const [aziendaCorrente, setAziendaCorrente] = useState<string | null>(null);
  const [aziendeAbilitate, setAziendeAbilitate] = useState<AziendaAbilitata[]>([]);
  /** Quale lettura e' l'ultima chiesta: le risposte in ritardo si scartano. */
  const richiesta = useRef(0);
  /**
   * Le fotografie segnate come viste da sole (C1), come erano a schermo: le evidenze
   * restano finche' la Home e' aperta, anche se un'altra rilettura (un altro widget
   * aggiornato) le riporta senza. Per idWidget; valgono finche' il `ts` e' quello.
   */
  const segnateDaSole = useRef(new Map<number, Fotografia>());
  /**
   * Cresce a ogni «Segna come viste» col pulsante: un segno da solo partito prima non
   * deve rimettere in `segnateDaSole` le evidenze che il pulsante ha appena tolto.
   */
  const generazioneVisto = useRef(0);
  /** Un «Segna come viste» col pulsante e' in volo: il doppio clic non ne manda un altro. */
  const segnaInVolo = useRef(false);
  /** Il pannello e' ancora a video? Si smonta passando agli avvisi. */
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const leggi = useCallback(async (): Promise<Widget[] | null> => {
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
      if (!vivo.current || mia !== richiesta.current) return null;
      const errors = resp.errors as ErrorItem[] | undefined;
      if (errors && errors.length > 0) {
        feedback.showServerMessages(errors);
        setErrore('La dashboard non si e\' letta.');
        return null;
      }
      setErrore(null);
      const letti = ((resp.widget as Widget[]) || []).map((w) => {
        const prima = segnateDaSole.current.get(w.idWidget);
        if (!prima) return w;
        if (!w.fotografia || prima.ts !== w.fotografia.ts) {
          segnateDaSole.current.delete(w.idWidget);
          return w;
        }
        // Solo le evidenze: stato, messaggio e il resto vengono dalla risposta, se no un
        // aggiornamento fallito (stesso ts, stato ERR) resterebbe nascosto.
        return {
          ...w,
          fotografia: {
            ...w.fotografia,
            righe: prima.righe,
            uscite: prima.uscite,
            variazioni: prima.variazioni,
            visto: prima.visto,
          },
        };
      });
      setWidget(letti);
      setAziendaCorrente(typeof resp.aziendaCorrente === 'string' ? resp.aziendaCorrente : null);
      setAziendeAbilitate(Array.isArray(resp.aziendeAbilitate)
        ? (resp.aziendeAbilitate as AziendaAbilitata[])
        : []);
      return letti;
    } catch (e) {
      // Niente finestre per un pannello che non c'e' piu': l'utente e' passato agli
      // avvisi e si vedrebbe comparire «Errore Server» per qualcosa che non guarda.
      if (!vivo.current || mia !== richiesta.current) return null;
      feedback.failure(e);
      setErrore('La dashboard non si e\' letta.');
      return null;
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

  /**
   * I widget che aspettano il giro. Sta nel pannello e non sul server perche' serve solo
   * a dire «in coda» e a sapere quando rileggere; il server resta la fonte (C4: dopo un
   * F5 la coda si ricostruisce da `dashboard.Stato`).
   */
  const [attesa, setAttesa] = useState<Record<number, InAttesa>>({});
  const attesaRef = useRef(attesa);
  attesaRef.current = attesa;
  /**
   * Ogni cambio dell'attesa passa da qui: il riferimento si aggiorna SUBITO, non al
   * prossimo disegno, cosi' una risposta di Stato che arriva prima del ridisegno non
   * riscrive l'attesa con una copia vecchia (terza revisione, 01/10).
   */
  const cambiaAttesa = useCallback(
    (fn: (p: Record<number, InAttesa>) => Record<number, InAttesa>) => {
      const n = fn(attesaRef.current);
      attesaRef.current = n;
      setAttesa(n);
    },
    [],
  );
  /** Il giro c'e'? null finche' non lo si e' chiesto. */
  const [giroAttivo, setGiroAttivo] = useState<boolean | null>(null);
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const aggiorna = async (w: Widget) => {
    if (attesaRef.current[w.idWidget]) return;
    const tsPrima = w.fotografia?.ts ?? null;
    // Subito, prima della risposta: un secondo clic non deve partire.
    // Finche' il server non ha risposto l'attesa non si tocca (dal = infinito): una Stato
    // partita dopo il clic ma prima che la richiesta sia scritta la darebbe per finita.
    cambiaAttesa((p) => ({
      ...p,
      [w.idWidget]: { fase: 'coda', posizione: null, tsPrima, chiesto: true, dal: Number.MAX_SAFE_INTEGER },
    }));
    let restaInAttesa = false;
    try {
      const resp = (await api.postAction2('dashboard.Aggiorna', {
        sid: SID,
        idWidget: String(w.idWidget),
      })) as unknown as Record<string, unknown>;
      if (!vivo.current) return;
      const esito = (resp.dashboardAggiorna || {}) as Record<string, unknown>;
      if (esito.esito === 'in_coda' || esito.esito === 'in_corso') {
        restaInAttesa = true;
        const posizione = typeof esito.posizione === 'number' ? esito.posizione : null;
        // Da qui la richiesta e' scritta: conta solo una Stato partita dopo.
        const dal = Date.now();
        cambiaAttesa((p) => ({
          ...p,
          [w.idWidget]: { fase: esito.esito === 'in_corso' ? 'corso' : 'coda', posizione, tsPrima, chiesto: true, dal },
        }));
        return;
      }
      const errors = resp.errors as ErrorItem[] | undefined;
      const motivo = String(esito.motivo || '');
      if (errors && errors.length > 0) feedback.showServerMessages(errors);
      else if (motivo === 'TROPPO_PRESTO')
        // Un freno da un minuto non merita una finestra da chiudere.
        feedback.info(String(esito.messaggio || 'Riprova fra poco.'));
      else feedback.error(String(esito.messaggio || 'L\'aggiornamento non e\' riuscito.'));
    } catch (e) {
      if (vivo.current) feedback.failure(e);
    } finally {
      if (!restaInAttesa)
        cambiaAttesa((p) => {
          const q = { ...p };
          delete q[w.idWidget];
          return q;
        });
    }
  };

  /**
   * Arrivato l'aggiornamento chiesto da qui: si dice com'e' andata, con le variazioni
   * che il server ha gia' contato, e si porta la vista sulla prima.
   */
  const annuncia = useCallback((id: number, dopo: Widget[] | null) => {
    const w = (dopo || []).find((x) => x.idWidget === id);
    if (!w) return;
    const nome = `"${w.titolo || 'Widget'}"`;
    const foto = w.fotografia;
    if (foto?.stato === 'ERR' || foto?.stato === 'NAC') {
      feedback.info(`${nome}: ${foto.messaggio || STATI[foto.stato]}`);
      return;
    }
    const v = (foto?.variazioni || {}) as Variazioni;
    feedback.info(
      v.criteriDiversi
        ? `${nome} aggiornato. I criteri sono cambiati dall'ultima volta (una data che si`
          + ' aggiorna da sola), quindi le righe non si possono confrontare con quelle di prima.'
        : v.totale
          ? `${nome} aggiornato: ${descriviVariazioni(v)}.`
          : `${nome} aggiornato: nessuna variazione.`
    );
    if (v.totale && !v.criteriDiversi) mostraPrimaVariazione(id);
  }, [feedback]);

  /**
   * Una lettura di `dashboard.Stato`, e che cosa farne: aggiorna la coda (anche con i
   * widget messi in coda da un'altra scheda o prima di un F5, C4) e rilegge la
   * dashboard se il giro ha cambiato qualcosa.
   */
  const controlla = useCallback(async () => {
    // Una scheda del browser nascosta non chiede niente: tenerla viva a colpi di Stato
    // terrebbe aperta la sessione e i widget nel giro per sempre (revisione, 01/10).
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const partenza = Date.now();
    let resp: RispostaStato;
    try {
      resp = (await api.postAction2('dashboard.Stato', { sid: SID })) as unknown as RispostaStato;
    } catch {
      return;   // un controllo saltato non merita una finestra: il prossimo ci riprova
    }
    if (!vivo.current || !resp || resp.esito !== 'ok') return;
    setGiroAttivo(resp.giro?.attivo === true);
    const prima = widgetRef.current || [];
    const arrivati: number[] = [];
    let cambiato = false;
    const nuova: Record<number, InAttesa> = { ...attesaRef.current };
    const visti = new Set<number>();
    for (const s of resp.widget || []) {
      visti.add(s.idWidget);
      const w = prima.find((x) => x.idWidget === s.idWidget);
      const tsVisto = w?.fotografia?.ts ?? null;
      const a = nuova[s.idWidget];
      // Una RUN appesa (nodo caduto) non e' un lavoro in corso: il server lo dice con
      // inCorso, e il widget deve poter essere chiesto di nuovo (revisione, 01/10).
      const inCorso = s.inCorso ?? s.stato === 'RUN';
      const lavora = s.inCoda || inCorso;
      if (lavora) {
        nuova[s.idWidget] = {
          fase: inCorso ? 'corso' : 'coda',
          posizione: typeof s.posizione === 'number' ? s.posizione : null,
          tsPrima: a ? a.tsPrima : tsVisto,
          chiesto: a ? a.chiesto : false,
          dal: a ? a.dal : partenza,
        };
      } else if (a && a.dal < partenza) {
        delete nuova[s.idWidget];
        if (a.chiesto) arrivati.push(s.idWidget);
        cambiato = true;
      }
      // Solo per un widget che ha una fotografia letta: uno illeggibile non ce l'ha, e
      // il confronto lo darebbe «cambiato» a ogni controllo.
      const fv = w?.fotografia;
      // Un widget illeggibile (ERR senza tentativo, costruito da Get senza leggere la
      // fotografia) non si confronta: Stato legge la riga vera, e ts, stato e tentativo
      // sarebbero diversi a ogni controllo, cioe' una rilettura al minuto per sempre.
      const illeggibile = !!fv && fv.stato === 'ERR' && !fv.tsTentativo;
      if (fv && !illeggibile && (s.ts ?? null) !== tsVisto && !lavora) cambiato = true;
      // Un tentativo fallito del giro non cambia ts (l'ultima fotografia buona resta): si
      // vede dallo stato e dal tentativo.
      if (fv && !lavora && !illeggibile
        && ((s.stato ?? null) !== (fv.stato ?? null)
          || (fv.tsTentativo && (s.tsTentativo ?? null) !== fv.tsTentativo)))
        cambiato = true;
    }
    // Un widget tolto (qui o da un'altra scheda) non resta ad aspettare per sempre.
    for (const id of Object.keys(nuova).map(Number))
      if (!visti.has(id) && nuova[id].dal < partenza) delete nuova[id];
    cambiaAttesa(() => nuova);
    if (cambiato) {
      const dopo = await leggi();
      if (vivo.current) for (const id of arrivati) annuncia(id, dopo);
    }
  }, [leggi, annuncia, cambiaAttesa]);

  const inAttesa = Object.keys(attesa).length > 0;
  // Controllo leggero ogni 60 s (C3), e uno subito appena la dashboard e' letta (C4).
  // Il pannello vive solo nella Home: fuori dalla Home non parte niente.
  const letta = widget !== null;
  useEffect(() => {
    if (!letta) return;
    void controlla();
    const t = window.setInterval(() => void controlla(), PASSO_CONTROLLO_MS);
    // Tornando sulla scheda del browser si guarda subito, invece di aspettare il minuto.
    const visibile = () => {
      if (document.visibilityState === 'visible') void controlla();
    };
    document.addEventListener('visibilitychange', visibile);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', visibile);
    };
  }, [letta, controlla]);
  // Ogni 5 s solo mentre qualcosa e' in coda o in corso, e solo se il giro c'e': senza
  // giro la coda non si muove, e chiedere ogni 5 s non la farebbe muovere (C5).
  useEffect(() => {
    if (!inAttesa || giroAttivo === false) return;
    const t = window.setInterval(() => void controlla(), PASSO_CODA_MS);
    return () => window.clearInterval(t);
  }, [inAttesa, giroAttivo, controlla]);

  /**
   * Il «visto» da solo (contratto VISTO C1-C3): 5 s di fila di Home visibile, e quello
   * che mostra diventa il visto. Le evidenze restano a schermo: si rilegge solo quando
   * arriva altro. Un errore non si dice: e' un segno, non un'operazione dell'utente.
   */
  useEffect(() => {
    if (daSegnare(widget, segnateDaSole.current).length === 0) return;
    let t: number | undefined;
    const arma = () => {
      window.clearTimeout(t);
      t = undefined;
      if (document.visibilityState === 'hidden') return;
      t = window.setTimeout(() => {
        if (segnaInVolo.current) return;
        const generazione = generazioneVisto.current;
        const lista = widgetRef.current || [];
        const viste = daSegnare(lista, segnateDaSole.current);
        if (viste.length === 0) return;
        for (const w of lista)
          if (viste.some((v) => v.idWidget === w.idWidget))
            segnateDaSole.current.set(w.idWidget, w.fotografia);
        api.postAction2('dashboard.SegnaViste', { sid: SID, viste: JSON.stringify(viste) })
          .then((resp) => {
            const segnate = (resp as unknown as { segnate?: number[] }).segnate || [];
            for (const v of viste)
              if (generazione !== generazioneVisto.current
                || !segnate.some((id) => Number(id) === v.idWidget))
                segnateDaSole.current.delete(v.idWidget);
          })
          .catch(() => {
            for (const v of viste) segnateDaSole.current.delete(v.idWidget);
          });
      }, ATTESA_VISTO_MS);
    };
    arma();
    document.addEventListener('visibilitychange', arma);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', arma);
    };
  }, [widget]);

  /**
   * Salva la disposizione della modalita' «Disposizione» (dashboard.Disposizione): se il
   * server la rifiuta lo dice e la modalita' resta aperta; se la prende, si rilegge.
   */
  const salvaDisposizione = async (posti: PostoSalvato[]): Promise<boolean> => {
    try {
      const resp = (await api.postAction2('dashboard.Disposizione', {
        sid: SID,
        disposizione: JSON.stringify(posti),
      })) as unknown as Record<string, unknown>;
      if (resp.esito !== 'ok') {
        rifiuto(resp, 'La disposizione non si e\' potuta salvare.');
        return false;
      }
    } catch (e) {
      if (vivo.current) feedback.failure(e);
      return false;
    }
    // Si chiude la modalita' solo con la disposizione nuova in mano: chiudendola prima la
    // griglia tornerebbe un attimo a quella vecchia.
    if (vivo.current) await leggi();
    return true;
  };

  /**
   * «Segna come viste» (un widget) e «Segna tutte come viste» (C4, C5): le evidenze
   * spariscono subito, rileggendo la dashboard.
   */
  const segnaViste = async (lista: Widget[]) => {
    const viste = lista
      .filter((w) => !!w.fotografia?.ts)
      .map((w) => ({ idWidget: w.idWidget, ts: w.fotografia.ts as string }));
    if (viste.length === 0 || segnaInVolo.current) return;
    segnaInVolo.current = true;
    generazioneVisto.current += 1;
    for (const v of viste) segnateDaSole.current.delete(v.idWidget);
    try {
      let resp: Record<string, unknown> = {};
      // Un segno partito da solo nello stesso istante puo' far fallire il primo
      // salvataggio (stessa riga inserita due volte): il secondo tentativo la trova.
      for (let tentativo = 0; tentativo < 2; tentativo++) {
        resp = (await api.postAction2('dashboard.SegnaViste', {
          sid: SID,
          viste: JSON.stringify(viste),
        })) as unknown as Record<string, unknown>;
        if (resp.esito === 'ok' || resp.motivo !== 'SALVATAGGIO') break;
      }
      if (resp.esito !== 'ok' && vivo.current)
        rifiuto(resp, 'Le variazioni non si sono potute segnare come viste.');
    } catch (e) {
      if (vivo.current) feedback.failure(e);
    } finally {
      segnaInVolo.current = false;
    }
    for (const v of viste) segnateDaSole.current.delete(v.idWidget);
    if (vivo.current) void leggi();
  };

  /**
   * Dopo il salvataggio si rilegge (titolo, forma e risultato provvisorio si vedono
   * subito) e si lancia «Aggiorna ora»: il numero esatto — su tutta la ricerca, non
   * sulle righe salvate — lo calcola solo un aggiornamento. Se il server lo rifiuta
   * perche' e' troppo presto, il widget resta col risultato provvisorio, e lo dice.
   */
  const salvato = async (id: number, titolo: string) => {
    const w = (widget || []).find((x) => x.idWidget === id);
    // Si chiude solo il pannello di QUESTO widget: se l'utente l'ha gia' chiuso e ne ha
    // aperto un altro mentre il salvataggio viaggiava, quello resta aperto.
    setModifica((m) => (m && m.idWidget === id ? null : m));
    await leggi();
    // col titolo nuovo: e' quello che il riepilogo dell'aggiornamento deve nominare
    if (w && vivo.current) await aggiorna({ ...w, titolo });
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

  const conEvidenze = widget.filter(
    (w) => (w.fotografia?.variazioni?.totale || 0) > 0 || !!w.fotografia?.variazioni?.criteriDiversi,
  );
  const articoli = new Map<number, React.ReactElement>();
  for (const w of widget) {
        // Un widget senza fotografia non deve portare giu' la pagina: GetCommand
        // costruisce la cornice di un widget illeggibile dentro un try che inghiotte
        // l'eccezione, quindi quella chiave puo' mancare. Qui moriva la Home intera —
        // niente commutatore, niente avvisi — sulla prima pagina che si apre.
        const foto: Fotografia = w.fotografia || {};
        const mostrate = (foto.righe || []).length;
        // Quante volte compare ogni chiave: una riga si apre solo se la sua e' unica.
        const chiaviRipetute = new Map<string, number>();
        for (const r of foto.righe || [])
          if (r.k) chiaviRipetute.set(r.k, (chiaviRipetute.get(r.k) || 0) + 1);
        const visibili = (foto.righe || []).filter(
          (r) => r.n || (r.c || []).some((c) => c.p !== undefined)
        ).length;
        const totale = foto.totaleRighe;
        // Le colonne nella posizione che avevano nella lista d'origine (SXADV-6001.0).
        // Con lo schema cambiato le celle non corrispondono piu' alle intestazioni, e
        // riordinarle le confonderebbe ancora di piu'.
        const ordine = foto.schemaCambiato ? null : w.ordineColonne;
        articoli.set(w.idWidget, (
        <article key={w.idWidget} className="dash-widget" data-widget={w.idWidget}>
          <header className="dash-widget-head">
            <Typography.Text strong ellipsis={{ tooltip: w.titolo }}>
              {w.titolo}
            </Typography.Text>
            {suPiuAziende(w) ? (
              <Tooltip
                title={(w.ambito?.codici || [])
                  .map((c) => {
                    const d = aziendeAbilitate.find((a) => a.codice === c)?.descrizione;
                    return d ? `${c} — ${d}` : c;
                  })
                  .join(', ')
                  + ((w.ambito?.escluse || []).length
                    ? ` — escluse perche' li' hai un altro profilo: ${(w.ambito?.escluse || []).join(', ')}`
                    : '')}
              >
                <Tag className="dash-widget-ambito">
                  {w.ambito?.modo === 'tutte'
                    ? 'tutte le aziende'
                    : `${(w.ambito?.codici || []).length} ${(w.ambito?.codici || []).length === 1 ? 'azienda' : 'aziende'}`}
                </Tag>
              </Tooltip>
            ) : null}
            <Space size={0}>
              {onNaviga ? (
                <Tooltip title="Apri la lista completa">
                  <Button
                    type="text"
                    size="small"
                    icon={<UnorderedListOutlined />}
                    aria-label="Naviga alla lista di origine"
                    onClick={() => void naviga(w)}
                  />
                </Tooltip>
              ) : null}
              {(
                <Tooltip title="Aggiorna ora">
                  <Button
                    type="text"
                    size="small"
                    // Con il giro spento la coda non si muove: una rotella che gira mentirebbe (C5).
                    icon={<ReloadOutlined spin={!!attesa[w.idWidget] && giroAttivo !== false} />}
                    aria-label="Aggiorna ora"
                    disabled={!!attesa[w.idWidget]}
                    onClick={() => void aggiorna(w)}
                  />
                </Tooltip>
              )}
              <Tooltip title="Modifica">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label="Modifica"
                  onClick={() => setModifica(w)}
                />
              </Tooltip>
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
            {/* L'intervallo lo rispetta il giro automatico (SXADV-62 F2), che serve un
                widget alla volta: con la coda lunga puo' arrivare dopo, e «in ritardo»
                lo dice. */}
            {w.intervalloMin && !foto.definitivo ? <span>· {ogni(w.intervalloMin)}</span> : null}
            {attesa[w.idWidget] ? (
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                ·{' '}
                {attesa[w.idWidget].fase === 'corso'
                  ? 'aggiornamento in corso'
                  : giroAttivo === false
                    ? 'in coda, ma l\'aggiornamento automatico non è attivo su questo server'
                    : (attesa[w.idWidget].posizione ?? 0) > 1
                      ? `in coda: ${numero((attesa[w.idWidget].posizione as number) - 1)} prima di te`
                      : 'in coda'}
              </Typography.Text>
            ) : null}
            {inRitardo(foto.prossimoAgg) && foto.ts && !foto.definitivo ? (
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
                {/* Numero e barre sono calcolati su TUTTA la ricerca: «prime 200 di
                    4.762» li farebbe sembrare parziali (SXADV-62, 24/09). Vale solo
                    quando il widget mostra davvero il risultato e non ripiega sulle righe. */}
                {mostrate < totale && !mostraRisultato(w.forma, w.risultato)
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

          {/* RUN qui non si scrive: se un aggiornamento e' davvero in corso lo dice la riga
              sopra, che segue dashboard.Stato (inCorso). Una RUN appesa, scritta da qui,
              direbbe «in corso» per sempre (R8). */}
          {foto.definitivo ? (
            // La lista d'origine e' cambiata (pezzo 3): riprovare da solo non servirebbe, e
            // il giro non lo fa piu'. Si dice in chiaro e si offre che cosa fare.
            <div className="dash-widget-definitivo" role="alert">
              <Typography.Text type="danger">
                La lista d&apos;origine e&apos; cambiata: questo widget non si aggiorna piu&apos;
                da solo.
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                {w.modificabile ? '«Modifica» cambia come si mostra, non la ricerca: ' : ''}
                se la lista non c&apos;e&apos; piu&apos;, toglilo e aggiungilo di nuovo dalla lista.
              </Typography.Text>
              {foto.messaggio ? (
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  {foto.messaggio}
                </Typography.Text>
              ) : null}
              <Space size={4} wrap>
                {w.modificabile ? (
                  <Button size="small" icon={<EditOutlined />} onClick={() => setModifica(w)}>
                    Modifica
                  </Button>
                ) : null}
                <Popconfirm
                  title="Togliere questo widget?"
                  description="La dashboard non lo mostrera' piu'. I dati non si toccano."
                  okText="Togli"
                  okButtonProps={{ danger: true }}
                  cancelText="Annulla"
                  onConfirm={() => rimuovi(w)}
                >
                  <Button size="small" danger icon={<CloseOutlined />}>
                    Rimuovi
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          ) : foto.stato === 'OK' || foto.stato === 'RUN' ? null : (
            <>
              <Typography.Text type="secondary">
                {STATI[foto.stato || ''] || 'In attesa di dati.'}
                {foto.stato === 'ERR' && riprovo(foto.prossimoAgg) ? ` ${riprovo(foto.prossimoAgg)}.` : null}
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
          {w.risultato && (w.forma === 'kpi' || w.forma === 'bar') ? (
            <RisultatoVista
              risultato={w.risultato}
              forma={w.forma}
              trasformazione={w.trasformazione}
              opzioni={w.opzioni}
            />
          ) : null}
          {/* Le righe si mostrano se ci sono, qualunque sia lo stato: dopo un
              aggiornamento fallito la fotografia buona resta nel database, e lasciarla
              fuori dagli occhi vuol dire che «resta» solo per modo di dire. Al posto
              del numero o delle barre no: li' la tabella torna solo se il calcolo non
              si applica. */}
          {mostrate > 0 && !mostraRisultato(w.forma, w.risultato) ? (
            <div className="dash-widget-tabella">
              <table>
                <thead>
                  <tr>
                    {suPiuAziende(w) ? <th>Azienda</th> : null}
                    {permuta(w.colonne || [], ordine).map((c, i) => (
                      <th key={i}>{c.etichetta}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ordinaRighe(
                    foto.righe || [],
                    foto.schemaCambiato ? null : w.ordinamentoLocale?.colonna,
                    w.ordinamentoLocale?.verso,
                  ).map((r, i) => {
                    // Si apre il record della riga col dettaglio che il server ha
                    // scelto (quello della lista, o quello indicato nel widget). Non si
                    // apre una riga senza chiave, con la chiave "null" (una chiave con
                    // parti nulle) o con una chiave ripetuta: su alcune liste si ripete,
                    // e si aprirebbe un record diverso da quello cliccato.
                    // Nei widget su piu' aziende si aprono solo le righe dell'azienda
                    // corrente: il dettaglio girerebbe nel suo contesto (SXADV-6000).
                    const apribile = !!(
                      w.dettaglio && onApriDettaglio && r.k && r.k !== 'null'
                      && chiaviRipetute.get(r.k) === 1
                      && (!suPiuAziende(w) || (!!r.az && r.az === aziendaCorrente))
                    );
                    const apri = () => {
                      if (apribile) void apriRecord(w, r.k as string);
                    };
                    const classiRiga = [r.n ? 'riga-nuova' : '', apribile ? 'riga-apribile' : '']
                      .filter(Boolean)
                      .join(' ');
                    return (
                    <tr
                      key={r.k || i}
                      className={classiRiga || undefined}
                      {...(apribile ? { title: 'Apri il dettaglio', onClick: apri } : {})}
                    >
                      {suPiuAziende(w) ? <td className="dash-cella-azienda">{r.az || ''}</td> : null}
                      {permuta(r.c || [], ordine).map((cella, j) => {
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
                            {/* La tr resta una riga di tabella per chi legge con lo
                                screen reader: il link sta nella prima cella, e il clic
                                del mouse vale su tutta la riga. */}
                            {j === 0 && apribile ? (
                              <span
                                role="link"
                                tabIndex={0}
                                className="riga-apri"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    apri();
                                  }
                                }}
                              >
                                {cella.t}
                              </span>
                            ) : (
                              cella.t
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
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
              </Typography.Text>{' '}
              <SegnaVisteBottone onClick={() => void segnaViste([w])} />
            </div>
          ) : null}
          {(foto.variazioni?.totale || 0) > 0 ? (
            <div className="dash-widget-variazioni">
              <span className="chiave chiave-nuova" aria-hidden="true" />{' '}
              {descriviVariazioni(foto.variazioni || {})}{' '}
              {foto.visto ? 'da quando l\'hai guardato' : 'dall\'ultimo aggiornamento'}
              {/* Il conteggio e' sulla fotografia intera, la tabella ne mostra al
                  massimo 200: dire 37 e mostrarne 3 senza spiegarlo e' una bugia
                  involontaria. */}
              {visibili > 0 && visibili < (foto.variazioni?.totale || 0)
                ? ` (${visibili} qui sotto)`
                : null}
              {foto.parziale
                ? `, confronto sulle prime ${numero((foto.righeInFotografia || 0))} di ${numero(totale || 0)}`
                : null}{' '}
              <SegnaVisteBottone onClick={() => void segnaViste([w])} />
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
          {mostrate === 0 && foto.stato === 'OK' && !mostraRisultato(w.forma, w.risultato) ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Nessuna riga: oggi questa ricerca non trova niente.
            </Typography.Text>
          ) : null}
        </article>
    ));
  }

  return (
    <div className="dash-widgets" aria-busy={caricando}>
      <GrigliaWidget
        widget={widget}
        articoli={articoli}
        onSalva={salvaDisposizione}
        extra={conEvidenze.length > 0 ? (
          <Button size="small" icon={<EyeOutlined />} onClick={() => void segnaViste(widget)}>
            Segna tutte come viste
          </Button>
        ) : null}
      />
      <ModificaWidget
        widget={modifica}
        aziende={aziendeAbilitate}
        sid={SID}
        onClose={() => setModifica(null)}
        onSalvato={(id, titolo) => void salvato(id, titolo)}
      />
    </div>
  );
};

export default DashboardPanel;
