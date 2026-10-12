import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import * as api from '../../services/api';
import { useFeedback } from '../../hooks/feedback';
import type { ErrorItem } from '../../types/ui';
import { RisultatoVista } from './RisultatoWidget';
import { oppostoDi, toniDi } from './risultato';
import type { Opzioni, Risultato, Tono, Trasformazione } from './risultato';

/** Un gruppo che l'anteprima offre da escludere (`dashboard.Preview`, SALESCENDE E6). */
interface Candidato {
  k?: string;
  etichetta?: string;
}

const TONI: { value: Tono; label: string }[] = [
  { value: 'bene', label: 'una buona notizia' },
  { value: 'attenzione', label: 'da tenere d\'occhio' },
  { value: 'neutro', label: 'indifferente' },
];

/** Quello del widget che il pannello legge e riscrive. */
export interface WidgetDaModificare {
  idWidget: number;
  titolo?: string;
  forma?: string;
  intervalloMin?: number;
  trasformazione?: Trasformazione | null;
  opzioni?: Opzioni | null;
  /** Il dettaglio della lista: quello che apre il clic se il campo resta vuoto. */
  dettaglioPredefinito?: string | null;
  /** Da quali aziende vengono i risultati adesso, e se la lista dipende dall'azienda. */
  ambito?: { modo?: string; codici?: string[]; possibile?: boolean } | null;
  colonne?: Array<{ item?: string; etichetta?: string; tipo?: string | null }>;
  /** Chi lo vede nel catalogo e se arriva da solo (CONDIVISIONE H2). */
  condivisione?: { ambito?: string; mandato?: boolean } | null;
}

interface Props {
  widget: WidgetDaModificare | null;
  /** Le aziende su cui l'utente puo' entrare (SXADV-6000), da dashboard.Get. */
  aziende?: Array<{ codice: string; descrizione?: string }>;
  sid: string;
  onClose: () => void;
  /** Il salvataggio e' andato: chi apre il pannello rilegge e aggiorna. */
  onSalvato: (idWidget: number, titolo: string) => void;
  /** Chi guarda puo' condividere (privilegio dashboard.condividi), e le sedi dell'azienda. */
  puoCondividere?: boolean;
  sedi?: Array<{ codice: string; descrizione?: string | null }>;
}

/** Lo stato del pannello: un campo per scelta, la trasformazione si compone da qui. */
interface Bozza {
  titolo: string;
  forma: 'list' | 'kpi' | 'bar';
  gruppo: string | null;
  agg: string;
  col: string | null;
  conFiltro: boolean;
  op: string;
  valore: number | null;
  outAgg: string;
  topN: number;
  resto: string;
  sale: Tono;
  scende: Tono;
  /** Le chiavi dei gruppi tolti dal calcolo (SALESCENDE E8). */
  escludi: string[];
  /** La vista che apre il clic su una riga; vuota = quella della lista. */
  vistaDettaglio: string;
  /** SXADV-6000: da quali aziende prendere i risultati. */
  ambito: 'corrente' | 'scelte' | 'tutte';
  aziendeScelte: string[];
  intervallo: number;
  /** Condivisione: privato | azienda | sede:<codice>, e se arriva da solo nelle Home. */
  condivisione: string;
  mandato: boolean;
}

const AGGREGATI = [
  { value: 'count', label: 'conteggio delle righe' },
  { value: 'sum', label: 'somma' },
  { value: 'avg', label: 'media' },
  { value: 'min', label: 'minimo' },
  { value: 'max', label: 'massimo' },
];
const OPERATORI = ['>', '>=', '<', '<=', '=', '!='].map((o) => ({ value: o, label: o }));
const INTERVALLI = [15, 30, 60, 120, 240, 480, 1440].map((m) => ({
  value: m,
  label: m < 60 ? `${m} minuti` : m === 60 ? '1 ora' : m === 1440 ? '1 giorno' : `${m / 60} ore`,
}));

/** Dal widget salvato ai campi del pannello. */
const daWidget = (w: WidgetDaModificare): Bozza => {
  const t = w.trasformazione || {};
  const forma = w.forma === 'kpi' || w.forma === 'bar' ? w.forma : 'list';
  const having = t.having && t.having.op ? t.having : null;
  const val = having ? Number(having.value) : NaN;
  return {
    titolo: w.titolo || '',
    forma,
    gruppo: (t.group || [])[0] || null,
    agg: t.agg || 'count',
    col: t.col || null,
    conFiltro: !!having,
    op: (having && having.op) || '>',
    valore: Number.isFinite(val) ? val : 0,
    outAgg: t.outAgg || 'count',
    topN: t.topN || 10,
    resto: t.resto || 'altri',
    ...toniDi(w.opzioni),
    escludi: Array.isArray(t.escludi) ? t.escludi.filter((k) => typeof k === 'string') : [],
    vistaDettaglio: typeof w.opzioni?.vistaDettaglio === 'string' ? w.opzioni.vistaDettaglio : '',
    ambito:
      w.opzioni?.aziende?.modo === 'scelte' || w.opzioni?.aziende?.modo === 'tutte'
        ? w.opzioni.aziende.modo
        : 'corrente',
    aziendeScelte: Array.isArray(w.opzioni?.aziende?.codici) ? [...w.opzioni.aziende.codici] : [],
    intervallo: w.intervalloMin || 60,
    condivisione: w.condivisione?.ambito || 'privato',
    mandato: !!w.condivisione?.mandato,
  };
};

/**
 * Dai campi alla trasformazione del contratto. Solo quello che la forma usa: un
 * `outAgg` salvato su un grafico a barre non farebbe danni, ma farebbe credere a chi
 * rilegge il JSON che conti qualcosa.
 */
const trasformazioneDa = (b: Bozza): Trasformazione | null => {
  if (b.forma === 'list') return null;
  const t: Trasformazione = { agg: b.agg };
  if (b.gruppo) t.group = [b.gruppo];
  if (b.agg !== 'count' && b.col) t.col = b.col;
  // Con la casella spuntata e il valore cancellato il filtro NON sparisce in silenzio:
  // va al server senza valore, e l'anteprima e il salvataggio dicono che manca.
  if (b.gruppo && b.conFiltro)
    t.having = { op: b.op, value: b.valore === null ? '' : b.valore };
  if (b.forma === 'kpi' && b.gruppo) t.outAgg = b.outAgg;
  if (b.gruppo && b.escludi.length) t.escludi = [...b.escludi];
  if (b.forma === 'bar') {
    t.topN = b.topN;
    t.resto = b.resto;
  }
  return t;
};

/**
 * Le opzioni da salvare: `sale` solo per il numero, la vista di dettaglio solo se
 * scritta. Le chiavi che il pannello non conosce restano come erano: il server le
 * conserva, e un Salva da qui non deve cancellarle. Vuote = stringa vuota, come
 * prima: il server salva NULL.
 */
const opzioniDa = (
  b: Bozza,
  prima: Opzioni | null | undefined,
  ambitoPossibile = true,
): string => {
  const o: Opzioni = { ...(prima || {}) };
  delete o.sale;
  delete o.scende;
  delete o.vistaDettaglio;
  delete o.aziende;
  if (b.forma === 'kpi') {
    o.sale = b.sale;
    o.scende = b.scende;
  }
  const vista = b.vistaDettaglio.trim();
  if (vista) o.vistaDettaglio = vista;
  // Su una lista che non dipende dall'azienda l'ambito non si manda: il server lo
  // rifiuterebbe, e chi cambia solo il titolo resterebbe bloccato.
  if (ambitoPossibile && b.ambito === 'tutte') o.aziende = { modo: 'tutte' };
  else if (ambitoPossibile && b.ambito === 'scelte')
    o.aziende = { modo: 'scelte', codici: b.aziendeScelte };
  return Object.keys(o).length ? JSON.stringify(o) : '';
};

/** Perche' le barre non si possono scegliere, o null. */
const motivoNoBarre = (b: Bozza) => (b.gruppo ? null : 'serve un raggruppamento');

/**
 * SXADV-62 · G10, il pannello «Modifica widget».
 *
 * <p>Tutto quello che si vede nell'anteprima lo calcola il server
 * (`dashboard.Preview`, sulle righe salvate della fotografia): il pannello compone la
 * trasformazione dai campi e la manda, niente di piu'. Il salvataggio
 * (`dashboard.Save`) non tocca la fotografia: il numero esatto arriva con
 * l'aggiornamento che chi apre il pannello lancia subito dopo.
 */
const ModificaWidget: React.FC<Props> = ({
  widget, aziende, sid, onClose, onSalvato, puoCondividere, sedi,
}) => {
  const feedback = useFeedback();
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [anteprima, setAnteprima] = useState<Risultato | null>(null);
  /** I gruppi dell'ultima anteprima fra cui scegliere quelli da escludere (E6). */
  const [candidati, setCandidati] = useState<Candidato[]>([]);
  const [erroreAnteprima, setErroreAnteprima] = useState<string | null>(null);
  const [calcolando, setCalcolando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroreSalva, setErroreSalva] = useState<string | null>(null);
  /** Numero dell'ultima anteprima chiesta: le risposte arrivate tardi si scartano. */
  const richiesta = useRef(0);
  /** Il pannello e' aperto su QUESTO widget: dopo la chiusura niente piu' risposte. */
  const aperto = useRef<number | null>(null);

  useEffect(() => {
    aperto.current = widget ? widget.idWidget : null;
    richiesta.current++;
    setBozza(widget ? daWidget(widget) : null);
    setAnteprima(null);
    setCandidati([]);
    setErroreAnteprima(null);
    setErroreSalva(null);
    setSalvando(false);
    setCalcolando(false);
  }, [widget]);

  /** C'e' un'anteprima in volo, e quale aspetta di partire dopo di lei. */
  const inVolo = useRef(false);
  const prossima = useRef<{ mia: number; id: number; forma: string; testo: string } | null>(null);

  const pompa = async () => {
    inVolo.current = true;
    try {
      while (prossima.current) {
        const { mia, id, forma, testo } = prossima.current;
        prossima.current = null;
        // superata da un cambio arrivato mentre aspettava: non si chiede nemmeno
        if (mia !== richiesta.current || aperto.current !== id) continue;
        try {
          const resp = (await api.postAction2('dashboard.Preview', {
            sid,
            idWidget: String(id),
            forma,
            trasformazione: testo,
          })) as unknown as Record<string, unknown>;
          if (mia !== richiesta.current || aperto.current !== id) continue;
          if (resp.esito === 'ok' && resp.risultato) {
            setAnteprima(resp.risultato as Risultato);
            // Una risposta senza candidati (filtro sui gruppi a meta') non cancella quelli
            // che ci sono: il raggruppamento e' lo stesso, li azzera solo un cambio di gruppo.
            if (Array.isArray(resp.candidati) && resp.candidati.length)
              setCandidati(resp.candidati as Candidato[]);
            setErroreAnteprima(null);
          } else {
            const errors = resp.errors as ErrorItem[] | undefined;
            setAnteprima(null);
            setErroreAnteprima(
              String(
                resp.messaggio ||
                  (errors && errors[0] && errors[0].message) ||
                  'L\'anteprima non si e\' potuta calcolare.'
              )
            );
          }
        } catch (e) {
          if (mia !== richiesta.current || aperto.current !== id) continue;
          setAnteprima(null);
          setErroreAnteprima(
            e instanceof Error ? e.message : 'L\'anteprima non si e\' potuta calcolare.'
          );
        }
        if (mia === richiesta.current && aperto.current === id) setCalcolando(false);
      }
    } finally {
      inVolo.current = false;
    }
  };

  const colonne = useMemo(
    () =>
      (widget?.colonne || [])
        .filter((c) => c.item)
        .map((c) => ({
          value: c.item as string,
          label: c.etichetta || c.item,
          tipo: c.tipo || '',
        })),
    [widget]
  );
  /**
   * La colonna da sommare negli esempi: un importo o un numero, mai una data o un
   * testo. Il tipo e' il controllo della lista (ExtMoney, ...). Fra gli importi si
   * preferisce il «Saldo», che sulle liste di saldi e' quello che si guarda; se no
   * l'ultimo, che nelle liste e' di norma il totale.
   */
  const numeriche = colonne.filter((c) => /money|number|numeric|decimal|integer|double|importo/i.test(c.tipo));
  const daSommare =
    numeriche.find((c) => /saldo/i.test(String(c.label)))?.value ||
    numeriche[numeriche.length - 1]?.value ||
    null;
  /** Il raggruppamento degli esempi: la prima colonna che non e' un numero. */
  const daRaggruppare =
    colonne.find((c) => !numeriche.includes(c) && !/date|data/i.test(c.tipo))?.value ||
    colonne[0]?.value ||
    null;

  const trasformazione = bozza ? trasformazioneDa(bozza) : null;
  // Le scelte per «Escludi i gruppi»: i candidati dell'anteprima, piu' i gruppi gia'
  // esclusi che fra i candidati non ci sono (col testo noto, o la chiave).
  const opzioniEscludi = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const visti = new Set<string>();
    const nome = (k: string, etichetta?: string | null) =>
      etichetta ? etichetta : k ? k : '(vuoto)';
    for (const c of candidati) {
      const k = typeof c.k === 'string' ? c.k : '';
      if (visti.has(k)) continue;
      visti.add(k);
      out.push({ value: k, label: nome(k, c.etichetta) });
    }
    for (const k of bozza?.escludi || []) {
      if (visti.has(k)) continue;
      visti.add(k);
      const noto = (anteprima?.esclusi || []).find((e) => e.k === k);
      out.push({ value: k, label: nome(k, noto?.etichetta) });
    }
    return out;
  }, [candidati, bozza?.escludi, anteprima]);
  const chiaveAnteprima = bozza ? `${bozza.forma}|${JSON.stringify(trasformazione)}` : '';

  // L'anteprima si chiede con un attimo di attesa: chi scrive un valore non deve far
  // partire un calcolo a ogni cifra.
  useEffect(() => {
    if (!widget || !bozza) return;
    if (!trasformazione) {
      richiesta.current++;
      setAnteprima(null);
      setErroreAnteprima(null);
      setCalcolando(false);
      return;
    }
    const mia = ++richiesta.current;
    const id = widget.idWidget;
    const forma = bozza.forma;
    const testo = JSON.stringify(trasformazione);
    setCalcolando(true);
    const timer = setTimeout(() => {
      // Una richiesta sola in volo: se ce n'e' gia' una, questa aspetta il suo turno
      // e parte solo se nel frattempo non ne e' arrivata una piu' nuova. Chi cambia
      // tre campi di fila non accoda tre calcoli sulla fotografia.
      prossima.current = { mia, id, forma, testo };
      if (!inVolo.current) void pompa();
    }, 350);
    return () => clearTimeout(timer);
    // la chiave riassume bozza.forma e la trasformazione: e' l'unica cosa che conta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveAnteprima, widget, sid]);

  const cambia = (p: Partial<Bozza>) => {
    // I candidati sono valori della colonna di prima: non si offrono sul gruppo nuovo.
    if (p.gruppo !== undefined && p.gruppo !== bozza?.gruppo) setCandidati([]);
    setBozza((b) => {
      if (!b) return b;
      const n = { ...b, ...p };
      // Cambiare «sale» porta «scende» all'opposto; dopo, «scende» si sceglie da se'.
      if (p.sale !== undefined && p.scende === undefined) n.scende = oppostoDi(p.sale);
      // Le chiavi escluse sono valori della colonna di raggruppamento: cambiata quella,
      // non vogliono piu' dire niente.
      if (p.gruppo !== undefined && p.gruppo !== b.gruppo && p.escludi === undefined)
        n.escludi = [];
      // Le barre senza raggruppamento non esistono: se si toglie il gruppo si torna al
      // numero invece di lasciare una scelta che il server rifiuterebbe.
      if (n.forma === 'bar' && !n.gruppo) n.forma = 'kpi';
      return n;
    });
  };

  /** Gli esempi riempiono i campi e basta: salvare resta una scelta. */
  const esempio = (quale: 'rosso' | 'totale' | 'barre') => {
    if (!bozza) return;
    const primo = daRaggruppare;
    const numerica = daSommare;
    if (quale === 'rosso')
      cambia({ forma: 'kpi', gruppo: bozza.gruppo || primo, agg: 'sum', col: numerica,
        conFiltro: true, op: '>', valore: 0, outAgg: 'count' });
    else if (quale === 'totale')
      cambia({ forma: 'kpi', gruppo: null, agg: 'sum', col: numerica, conFiltro: false });
    else
      cambia({ forma: 'bar', gruppo: bozza.gruppo || primo, agg: 'sum', col: numerica,
        conFiltro: false, topN: 10, resto: 'altri' });
  };

  const salva = async () => {
    if (!widget || !bozza || salvando) return;
    if (!bozza.titolo.trim()) {
      setErroreSalva('Il titolo non puo\' essere vuoto.');
      return;
    }
    const id = widget.idWidget;
    setSalvando(true);
    setErroreSalva(null);
    try {
      // La condivisione si salva a parte (dashboard.Condividi), solo se e' cambiata, e PRIMA
      // della definizione: un rifiuto non lascia salvato a meta' (CONDIVISIONE U3).
      const prima = widget.condivisione?.ambito || 'privato';
      const mandato = bozza.condivisione !== 'privato' && bozza.mandato;
      if (puoCondividere
        && (bozza.condivisione !== prima || mandato !== !!widget.condivisione?.mandato)) {
        const c = (await api.postAction2('dashboard.Condividi', {
          sid,
          idWidget: String(id),
          ambito: bozza.condivisione,
          mandato: mandato ? '1' : '0',
        })) as unknown as Record<string, unknown>;
        if (c.esito !== 'ok') {
          if (aperto.current === id)
            setErroreSalva(String(c.messaggio || 'La condivisione non e\' stata salvata.'));
          return;
        }
      }
      const resp = (await api.postAction2('dashboard.Save', {
        sid,
        idWidget: String(id),
        titolo: bozza.titolo.trim(),
        forma: bozza.forma,
        trasformazione: trasformazione ? JSON.stringify(trasformazione) : '',
        opzioni: opzioniDa(bozza, widget.opzioni, widget.ambito?.possibile !== false),
        intervalloMin: String(bozza.intervallo),
      })) as unknown as Record<string, unknown>;
      if (resp.esito === 'ok') {
        // Anche a pannello gia' chiuso: il server ha salvato, e la Home deve mostrarlo.
        // Tacerlo farebbe credere di aver annullato una modifica che invece c'e'.
        onSalvato(id, bozza.titolo.trim());
        return;
      }
      if (aperto.current !== id) return;
      const errors = resp.errors as ErrorItem[] | undefined;
      setErroreSalva(
        String(
          resp.messaggio ||
            (errors && errors[0] && errors[0].message) ||
            'Il widget non e\' stato salvato.'
        )
      );
    } catch (e) {
      if (aperto.current !== id) return;
      feedback.failure(e);
    } finally {
      if (aperto.current === id) setSalvando(false);
    }
  };

  const noBarre = bozza ? motivoNoBarre(bozza) : null;

  return (
    <Drawer
      title="Modifica widget"
      placement="right"
      size={460}
      open={!!widget}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Annulla</Button>
          <Button type="primary" onClick={() => void salva()} loading={salvando}>
            Salva
          </Button>
        </Space>
      }
    >
      {bozza ? (
        <Form layout="vertical" size="small" className="dash-modifica">
          <Form.Item label="Titolo" required>
            <Input
              value={bozza.titolo}
              maxLength={100}
              onChange={(e) => cambia({ titolo: e.target.value })}
              aria-label="Titolo"
            />
          </Form.Item>

          <Form.Item label="Esempi rapidi">
            <Space wrap size={4}>
              <Button size="small" onClick={() => esempio('rosso')}>
                Conta i gruppi con valore &gt; 0
              </Button>
              <Button size="small" onClick={() => esempio('totale')}>
                Somma di una colonna
              </Button>
              <Button size="small" onClick={() => esempio('barre')}>
                Somma per gruppo, a barre
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="Forma">
            <Radio.Group
              value={bozza.forma}
              onChange={(e) => cambia({ forma: e.target.value })}
              optionType="button"
              aria-label="Forma"
            >
              <Radio.Button value="list">Lista</Radio.Button>
              <Radio.Button value="kpi">Numero</Radio.Button>
              <Radio.Button value="bar" disabled={!!noBarre}>
                Barre
              </Radio.Button>
            </Radio.Group>
            {noBarre ? (
              <Typography.Text type="secondary" className="dash-modifica-motivo">
                {' '}Barre: {noBarre}
              </Typography.Text>
            ) : null}
          </Form.Item>

          {bozza.forma === 'list' ? (
            <Typography.Text type="secondary">
              La lista mostra le righe della ricerca, come sono.
            </Typography.Text>
          ) : (
            <>
              <Form.Item label="Raggruppa per">
                <Select
                  value={bozza.gruppo ?? ''}
                  onChange={(v) => cambia({ gruppo: v || null })}
                  options={[{ value: '', label: 'nessuno' }, ...colonne]}
                  aria-label="Raggruppa per"
                />
              </Form.Item>
              <Form.Item label="Calcola">
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    value={bozza.agg}
                    onChange={(v) => cambia({ agg: v })}
                    options={AGGREGATI}
                    style={{ width: '45%' }}
                    aria-label="Calcola"
                  />
                  {bozza.agg !== 'count' ? (
                    <Select
                      value={bozza.col ?? undefined}
                      placeholder="su quale colonna"
                      onChange={(v) => cambia({ col: v })}
                      options={colonne}
                      style={{ width: '55%' }}
                      aria-label="Su quale colonna"
                    />
                  ) : null}
                </Space.Compact>
              </Form.Item>
              {bozza.gruppo ? (
                <Form.Item label="Tieni solo i gruppi con">
                  <Space.Compact style={{ width: '100%' }}>
                    <Checkbox
                      checked={bozza.conFiltro}
                      onChange={(e) => cambia({ conFiltro: e.target.checked })}
                      aria-label="Filtra i gruppi"
                      style={{ alignSelf: 'center', marginRight: 8 }}
                    />
                    <Select
                      value={bozza.op}
                      disabled={!bozza.conFiltro}
                      onChange={(v) => cambia({ op: v })}
                      options={OPERATORI}
                      style={{ width: 80 }}
                      aria-label="Confronto"
                    />
                    <InputNumber
                      value={bozza.valore}
                      disabled={!bozza.conFiltro}
                      onChange={(v) => cambia({ valore: v === null ? null : Number(v) })}
                      decimalSeparator=","
                      style={{ flex: 1 }}
                      aria-label="Valore del filtro"
                    />
                  </Space.Compact>
                </Form.Item>
              ) : null}
              {bozza.gruppo ? (
                <Form.Item
                  label="Escludi i gruppi"
                  extra="Si tolgono dal calcolo e il widget lo dice. Si sceglie fra i gruppi dell'anteprima."
                >
                  <Select
                    mode="multiple"
                    allowClear
                    value={bozza.escludi}
                    onChange={(v: string[]) => cambia({ escludi: v })}
                    options={opzioniEscludi}
                    placeholder="nessuno"
                    optionFilterProp="label"
                    aria-label="Escludi i gruppi"
                  />
                </Form.Item>
              ) : null}
              {bozza.forma === 'kpi' && bozza.gruppo ? (
                <Form.Item label="Numero finale">
                  <Select
                    value={bozza.outAgg}
                    onChange={(v) => cambia({ outAgg: v })}
                    options={[
                      { value: 'count', label: 'quanti gruppi' },
                      { value: 'sum', label: 'somma dei gruppi' },
                      { value: 'avg', label: 'media dei gruppi' },
                    ]}
                    aria-label="Numero finale"
                  />
                </Form.Item>
              ) : null}
              {bozza.forma === 'bar' ? (
                <Form.Item label="Quante barre">
                  <Space>
                    <InputNumber
                      min={1}
                      max={12}
                      value={bozza.topN}
                      onChange={(v) => cambia({ topN: Math.min(12, Math.max(1, Number(v) || 10)) })}
                      aria-label="Quante barre"
                    />
                    <Select
                      value={bozza.resto}
                      onChange={(v) => cambia({ resto: v })}
                      options={[
                        { value: 'altri', label: 'le altre sommate in «Altri»' },
                        { value: 'escludi', label: 'le altre escluse' },
                      ]}
                      style={{ width: 220 }}
                      aria-label="Le altre barre"
                    />
                  </Space>
                </Form.Item>
              ) : null}
              {bozza.forma === 'kpi' ? (
                <>
                  <Form.Item label="Se il numero sale è">
                    <Radio.Group
                      value={bozza.sale}
                      onChange={(e) => cambia({ sale: e.target.value })}
                      aria-label="Se il numero sale"
                    >
                      {TONI.map((t) => (
                        <Radio key={t.value} value={t.value}>{t.label}</Radio>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item label="Se il numero scende è">
                    <Radio.Group
                      value={bozza.scende}
                      onChange={(e) => cambia({ scende: e.target.value })}
                      aria-label="Se il numero scende"
                    >
                      {TONI.map((t) => (
                        <Radio key={t.value} value={t.value}>{t.label}</Radio>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                </>
              ) : null}
            </>
          )}

          {/* Per ogni forma: tornando alla lista il campo c'e' ancora. */}
          <Form.Item
            label="Apri il dettaglio con"
            extra="Il clic su una riga apre questa vista. Vuoto: quella della lista."
          >
            <Input
              value={bozza.vistaDettaglio}
              onChange={(e) => cambia({ vistaDettaglio: e.target.value })}
              placeholder={widget?.dettaglioPredefinito || 'nessun dettaglio'}
              allowClear
              aria-label="Vista di dettaglio"
            />
          </Form.Item>

          {/* SXADV-6000: da quali aziende vengono i risultati. Il server rifiuta una
              scelta vuota o un'azienda non abilitata, e il messaggio resta qui. */}
          <Form.Item
            label="Aziende"
            extra={
              widget?.ambito?.possibile === false
                ? 'Questa lista non dipende dall\'azienda.'
                : 'Con piu\' aziende si aprono dalla Home solo le righe dell\'azienda corrente.'
            }
          >
            <Radio.Group
              value={bozza.ambito}
              onChange={(e) => cambia({ ambito: e.target.value })}
              disabled={widget?.ambito?.possibile === false}
              aria-label="Ambito aziende"
            >
              <Radio value="corrente">Solo l&apos;azienda corrente</Radio>
              <Radio value="scelte">Aziende scelte</Radio>
              <Radio value="tutte">Tutte le mie aziende ({(aziende || []).length})</Radio>
            </Radio.Group>
            {bozza.ambito === 'scelte' && widget?.ambito?.possibile !== false ? (
              <Select
                mode="multiple"
                value={bozza.aziendeScelte}
                onChange={(v: string[]) => cambia({ aziendeScelte: v })}
                options={(aziende || []).map((a) => ({
                  value: a.codice,
                  label: a.descrizione ? `${a.codice} — ${a.descrizione}` : a.codice,
                }))}
                optionFilterProp="label"
                placeholder="Scegli le aziende"
                style={{ width: '100%', marginTop: 8 }}
                aria-label="Aziende scelte"
              />
            ) : null}
          </Form.Item>

          {puoCondividere ? (
            // Chi lo vede nel catalogo, e se arriva da solo nelle Home (CONDIVISIONE U3).
            <Form.Item
              label="Condivisione"
              extra="Chi lo riceve vede la stessa definizione, con i numeri calcolati coi suoi permessi."
            >
              <Select
                value={bozza.condivisione}
                onChange={(v: string) => cambia({ condivisione: v })}
                options={[
                  { value: 'privato', label: 'Privato' },
                  { value: 'azienda', label: 'Tutta l\'azienda' },
                  ...(sedi || []).map((s) => ({
                    value: `sede:${s.codice}`,
                    label: `Sede ${s.codice}${s.descrizione ? ` — ${s.descrizione}` : ''}`,
                  })),
                  // una sede salvata che non c'e' piu' fra quelle dell'azienda: si dice, non
                  // si mostra il valore grezzo
                  ...(bozza.condivisione.startsWith('sede:')
                    && !(sedi || []).some((x) => `sede:${x.codice}` === bozza.condivisione)
                    ? [{ value: bozza.condivisione,
                      label: `Sede ${bozza.condivisione.slice(5)} (non piu' fra le sedi)` }]
                    : []),
                ]}
                aria-label="Condivisione"
              />
              {bozza.condivisione !== 'privato' ? (
                <Checkbox
                  checked={bozza.mandato}
                  onChange={(e) => cambia({ mandato: e.target.checked })}
                  style={{ marginTop: 8 }}
                >
                  Mandalo nelle Home
                </Checkbox>
              ) : null}
            </Form.Item>
          ) : null}

          <Form.Item label="Aggiorna ogni">
            <Select
              value={bozza.intervallo}
              onChange={(v) => cambia({ intervallo: v })}
              options={
                INTERVALLI.some((i) => i.value === bozza.intervallo)
                  ? INTERVALLI
                  : [...INTERVALLI, { value: bozza.intervallo, label: `${bozza.intervallo} minuti` }]
              }
              aria-label="Aggiorna ogni"
            />
          </Form.Item>

          {bozza.forma !== 'list' ? (
            <section className="dash-modifica-anteprima" aria-label="Anteprima" aria-busy={calcolando}>
              <Typography.Text strong>Anteprima</Typography.Text>{' '}
              {calcolando ? <Spin size="small" /> : null}
              {erroreAnteprima ? (
                <Alert type="warning" showIcon title={erroreAnteprima} />
              ) : anteprima ? (
                <RisultatoVista
                  risultato={anteprima}
                  forma={bozza.forma}
                  trasformazione={trasformazione}
                  opzioni={{ sale: bozza.sale, scende: bozza.scende }}
                />
              ) : null}
            </section>
          ) : null}

          {erroreSalva ? (
            <Alert type="error" showIcon title={erroreSalva} style={{ marginTop: 12 }} />
          ) : null}
        </Form>
      ) : null}
    </Drawer>
  );
};

export default ModificaWidget;
