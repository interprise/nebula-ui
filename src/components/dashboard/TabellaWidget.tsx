import React, { useRef, useState } from 'react';
import {
  colonneMostrate,
  completaOrdine,
  larghezzaValida,
  ordinamentoEffettivo,
  prossimoOrdinamento,
  spostaColonna,
  type Ordinamento,
  type VistaTabella,
} from './vistaTabella';

/**
 * SXADV-6001 .2 .3 .4 .6 · la tabella di un widget «list»: le righe della fotografia,
 * con le colonne nell'ordine, nella larghezza e con l'ordinamento che sceglie chi guarda
 * (contratto docs/sxadv-62-prove/COLONNE_contratto.md, V5). Le righe arrivano gia'
 * ordinate dal server; qui si disegna e si raccolgono le scelte, che salva il pannello.
 */

export interface ColonnaTabella {
  item?: string;
  etichetta?: string;
}

export interface CellaTabella {
  t?: string;
  v?: unknown;
  p?: string | null;
}

export interface RigaTabella {
  k?: string;
  az?: string;
  n?: boolean;
  c?: CellaTabella[];
}

interface Props {
  colonne: ColonnaTabella[];
  righe: RigaTabella[];
  /** L'ordine di 6001.0 (posizione che le colonne avevano nella lista), se c'e'. */
  ordineIniziale?: number[] | null;
  /** L'ordinamento di 6001.0, che vale finche' la vista non ne sceglie uno. */
  ordinamentoLocale?: Ordinamento | null;
  vista: VistaTabella | null;
  /**
   * Le celle non corrispondono piu' alle intestazioni: niente vista, niente scelte, si
   * mostra com'e' (come 6001.0).
   */
  schemaCambiato?: boolean;
  /** I widget su piu' aziende: la colonna «Azienda» prima, fissa, fuori dalla vista. */
  colonnaAzienda?: boolean;
  rigaApribile: (r: RigaTabella) => boolean;
  onApri: (r: RigaTabella) => void;
  onVista: (vista: VistaTabella) => void;
}

const FRECCIA = { asc: '▲', desc: '▼' } as const;

export default function TabellaWidget({
  colonne,
  righe,
  ordineIniziale,
  ordinamentoLocale,
  vista,
  schemaCambiato,
  colonnaAzienda,
  rigaApribile,
  onApri,
  onVista,
}: Props) {
  const n = colonne.length;
  const scelte = !schemaCambiato && n > 0;
  const mostrate = scelte
    ? colonneMostrate(vista, n, ordineIniziale)
    : Array.from({ length: n }, (_, i) => i);
  const ordinamento = scelte ? ordinamentoEffettivo(vista, ordinamentoLocale) : null;
  /** La colonna che si sta trascinando (spostamento), per accettare il rilascio. */
  const [trascinata, setTrascinata] = useState<number | null>(null);
  const [sopra, setSopra] = useState<number | null>(null);
  /** La larghezza dal vivo mentre si tira la maniglia. */
  const [inCorso, setInCorso] = useState<{ colonna: number; px: number } | null>(null);
  const tirata = useRef<{ colonna: number; x: number; px: number } | null>(null);
  /**
   * La maniglia e' stata presa: il dragstart arriva sull'intestazione (e' lei la
   * trascinabile), non sulla maniglia, quindi e' l'intestazione a doverlo rifiutare.
   */
  const presa = useRef(false);

  const larghezza = (i: number): number | null => {
    if (inCorso && inCorso.colonna === i) return inCorso.px;
    if (!scelte) return null;
    return larghezzaValida(vista?.larghezze?.[String(i)]);
  };
  const stileColonna = (i: number): React.CSSProperties | undefined => {
    const px = larghezza(i);
    return px === null
      ? undefined
      // border-box: la larghezza misurata sull'intestazione comprende il padding, e senza
      // la colonna crescerebbe di quello appena si prende la maniglia.
      : { width: px, minWidth: px, maxWidth: px, boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis' };
  };

  const ordina = (i: number) => {
    if (!scelte) return;
    onVista({ ...(vista || {}), ordinamento: prossimoOrdinamento(ordinamento, i) });
  };

  const sposta = (da: number, su: number) => {
    const ordine = completaOrdine(vista?.ordineColonne, n, ordineIniziale);
    const nuovo = spostaColonna(ordine, da, su);
    if (nuovo.every((k, j) => k === ordine[j])) return;
    onVista({ ...(vista || {}), ordineColonne: nuovo });
  };

  const salvaLarghezza = (i: number, px: number | null) => {
    const larghezze = { ...(vista?.larghezze || {}) };
    if (px === null) delete larghezze[String(i)];
    else larghezze[String(i)] = px;
    const nuova: VistaTabella = { ...(vista || {}) };
    if (Object.keys(larghezze).length > 0) nuova.larghezze = larghezze;
    else delete nuova.larghezze;
    onVista(nuova);
  };

  const maniglia = (i: number) => (
    <span
      className="dash-col-maniglia"
      role="separator"
      aria-orientation="vertical"
      aria-label="Allarga o stringi la colonna"
      title="Trascina per allargare o stringere; doppio clic: larga quanto il contenuto"
      // Il trascinamento della maniglia non deve diventare lo spostamento della colonna
      // ne' il clic d'ordinamento dell'intestazione.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        presa.current = true;
        const th = (e.currentTarget as HTMLElement).closest('th');
        const px = th ? th.getBoundingClientRect().width : 100;
        tirata.current = { colonna: i, x: e.clientX, px };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setInCorso({ colonna: i, px: larghezzaValida(px) ?? 100 });
      }}
      onPointerMove={(e) => {
        const t = tirata.current;
        if (!t) return;
        const px = larghezzaValida(t.px + e.clientX - t.x);
        if (px !== null) setInCorso({ colonna: t.colonna, px });
      }}
      onPointerUp={(e) => {
        const t = tirata.current;
        tirata.current = null;
        presa.current = false;
        if (!t) return;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        const px = larghezzaValida(t.px + e.clientX - t.x);
        setInCorso(null);
        // Un clic senza spostamento non e' una scelta di larghezza.
        if (px !== null && e.clientX !== t.x) salvaLarghezza(t.colonna, px);
      }}
      onPointerCancel={() => {
        tirata.current = null;
        presa.current = false;
        setInCorso(null);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (vista?.larghezze?.[String(i)] !== undefined) salvaLarghezza(i, null);
      }}
    />
  );

  return (
    <table>
      <thead>
        <tr>
          {colonnaAzienda ? <th>Azienda</th> : null}
          {mostrate.map((i) => {
            const c = colonne[i];
            const verso = ordinamento && ordinamento.colonna === i ? ordinamento.verso : undefined;
            const classi = [
              scelte ? 'dash-col-scelta' : '',
              sopra === i && trascinata !== null && trascinata !== i ? 'dash-col-sopra' : '',
              trascinata === i ? 'dash-col-trascinata' : '',
            ].filter(Boolean).join(' ');
            return (
              <th
                key={i}
                data-colonna={i}
                className={classi || undefined}
                style={stileColonna(i)}
                aria-sort={!scelte ? undefined : verso === 'asc' ? 'ascending' : verso === 'desc' ? 'descending' : 'none'}
                title={scelte ? 'Clic: ordina. Trascina sopra un\'altra colonna per spostarla.' : undefined}
                draggable={scelte}
                onClick={() => ordina(i)}
                onDragStart={(e) => {
                  if (presa.current || tirata.current) {
                    e.preventDefault();
                    return;
                  }
                  setTrascinata(i);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox non comincia un trascinamento senza dati.
                  e.dataTransfer.setData('text/plain', String(c?.etichetta ?? i));
                }}
                onDragOver={(e) => {
                  if (trascinata === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (sopra !== i) setSopra(i);
                }}
                onDragLeave={() => {
                  if (sopra === i) setSopra(null);
                }}
                onDrop={(e) => {
                  if (trascinata === null) return;
                  e.preventDefault();
                  const da = trascinata;
                  setTrascinata(null);
                  setSopra(null);
                  sposta(da, i);
                }}
                onDragEnd={() => {
                  setTrascinata(null);
                  setSopra(null);
                }}
              >
                <span className="dash-col-etichetta">{c?.etichetta}</span>
                {verso ? (
                  <span className="dash-col-verso" aria-hidden="true">{FRECCIA[verso]}</span>
                ) : null}
                {scelte ? maniglia(i) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {righe.map((r, ir) => {
          const apribile = rigaApribile(r);
          const classiRiga = [r.n ? 'riga-nuova' : '', apribile ? 'riga-apribile' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <tr
              key={r.k || ir}
              className={classiRiga || undefined}
              {...(apribile ? { title: 'Apri il dettaglio', onClick: () => onApri(r) } : {})}
            >
              {colonnaAzienda ? <td className="dash-cella-azienda">{r.az || ''}</td> : null}
              {/* Senza scelte (schema cambiato, colonne illeggibili) le celle si mostrano
                  tutte e com'erano, anche se non corrispondono alle intestazioni. */}
              {(scelte ? mostrate : (r.c || []).map((_, k) => k)).map((i, j) => {
                const cella = (r.c || [])[i] || {};
                // Gli importi a destra come in ogni lista: il valore grezzo della cella
                // dice gia' se e' un numero, non serve indovinarlo dal testo formattato.
                const classi = [
                  typeof cella.v === 'number' ? 'number' : '',
                  cella.p !== undefined ? 'cella-cambiata' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const stile = stileColonna(i);
                return (
                  <td
                    key={i}
                    className={classi || undefined}
                    style={stile}
                    // Una colonna stretta taglia il testo coi puntini: quello intero resta
                    // sotto il puntatore.
                    title={stile && cella.t ? cella.t : undefined}
                  >
                    {/* Il valore di prima accanto a quello nuovo: e' l'unica cosa che
                        rende leggibile «e' cambiato», e arriva gia' formattato. */}
                    {cella.p !== undefined && cella.p !== null ? (
                      <s className="valore-prima">{cella.p}</s>
                    ) : null}
                    {j === 0 && r.n ? <span className="segno-nuova">nuova</span> : null}
                    {/* La tr resta una riga di tabella per chi legge con lo screen reader:
                        il link sta nella prima cella, e il clic del mouse vale su tutta
                        la riga. */}
                    {j === 0 && apribile ? (
                      <span
                        role="link"
                        tabIndex={0}
                        className="riga-apri"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            onApri(r);
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
  );
}
