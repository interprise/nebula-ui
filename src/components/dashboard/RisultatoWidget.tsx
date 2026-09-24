import React from 'react';
import { Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, PauseOutlined } from '@ant-design/icons';

import {
  aNumero,
  conSegno,
  conteggio,
  scrivi,
  type Opzioni,
  type Risultato,
  type Trasformazione,
} from './risultato';

interface Props {
  risultato: Risultato;
  forma: string;
  trasformazione?: Trasformazione | null;
  opzioni?: Opzioni | null;
}

/** La riga «calcolato su N righe»: dice sempre su che cosa poggia il numero. */
const Base: React.FC<{ r: Risultato }> = ({ r }) => {
  const righe = aNumero(r.righeLette);
  const pezzi: string[] = [];
  if (r.provvisorio)
    pezzi.push('provvisorio: si ricalcola al prossimo aggiornamento');
  if (r.completo === false && righe === 0)
    // niente fotografia ancora: non e' un calcolo parziale, non c'e' niente
    pezzi.push('i dati arrivano col primo aggiornamento');
  else if (r.completo === false && r.via === 'sql')
    // il database ha aggregato tutto, ma i gruppi erano troppi e se ne sono letti una parte
    pezzi.push('parziale: i gruppi sono troppi, se ne mostra una parte');
  else if (r.completo === false && righe !== null)
    pezzi.push(
      `parziale: calcolato sulle ${scrivi(righe, true)} righe salvate, il numero esatto arriva col prossimo aggiornamento`
    );
  if (pezzi.length === 0) return null;
  return (
    <Typography.Text type="secondary" className="dash-risultato-nota">
      {pezzi.join(' · ')}
    </Typography.Text>
  );
};

const Numero: React.FC<Props> = ({ risultato: r, trasformazione, opzioni }) => {
  const intero = conteggio(trasformazione, false);
  const n = aNumero(r.numero);
  const d = aNumero(r.delta);
  const parziale = r.completo === false;
  // Il colore segue la scelta dell'utente e non e' mai l'unico segno: la freccia e il
  // testo col segno dicono la stessa cosa a chi il colore non lo distingue.
  let tono = 'neutro';
  if (d !== null && d !== 0 && opzioni?.sale)
    tono = (d > 0) === (opzioni.sale === 'bene') ? 'bene' : 'male';
  return (
    <div className="dash-numero" data-forma="kpi">
      <div className="dash-numero-valore">
        {/* Niente «almeno»: su una parte delle righe una somma con saldi negativi puo'
            venire piu' alta di quella vera, e un conteggio di gruppi filtrati piu'
            bassa o piu' alta. Si dice «parziale», che e' vero in tutti i casi. */}
        {scrivi(n, intero)}
        {parziale && n !== null ? <span className="dash-numero-parziale"> (parziale)</span> : null}
      </div>
      {d !== null ? (
        <div className={`dash-numero-delta dash-tono-${tono}`}>
          {d > 0 ? (
            <ArrowUpOutlined aria-label="sale" />
          ) : d < 0 ? (
            <ArrowDownOutlined aria-label="scende" />
          ) : (
            <PauseOutlined rotate={90} aria-label="invariato" />
          )}{' '}
          <span className="dash-numero-delta-valore">{d === 0 ? '0' : conSegno(d, intero)}</span>{' '}
          <span className="dash-numero-delta-testo">rispetto all&apos;aggiornamento precedente</span>
        </div>
      ) : null}
      <Base r={r} />
    </div>
  );
};

const Barre: React.FC<Props> = ({ risultato: r, trasformazione }) => {
  const intero = conteggio(trasformazione, true);
  const gruppi = r.gruppi || [];
  const altri = r.altri && aNumero(r.altri.valore) !== null ? r.altri : null;
  const valori = gruppi.map((g) => aNumero(g.valore) ?? 0);
  if (altri) valori.push(aNumero(altri.valore) ?? 0);
  const massimo = Math.max(0, ...valori.map((v) => Math.abs(v)));
  const larghezza = (v: number) => (massimo > 0 ? `${(Math.abs(v) / massimo) * 100}%` : '0%');
  const barra = (chiave: string, etichetta: string, v: number, classe = '') => (
    <li key={chiave} className={`dash-barra ${v < 0 ? 'dash-barra-negativa' : ''} ${classe}`}>
      <span className="dash-barra-etichetta" title={etichetta}>
        {etichetta}
      </span>
      <span className="dash-barra-traccia" aria-hidden="true">
        <span className="dash-barra-riempimento" style={{ width: larghezza(v) }} />
      </span>
      <span className="dash-barra-valore">{scrivi(v, intero)}</span>
    </li>
  );
  if (gruppi.length === 0 && !altri)
    return (
      <div className="dash-barre" data-forma="bar">
        <Typography.Text type="secondary">Nessun gruppo da mostrare.</Typography.Text>
        <Base r={r} />
      </div>
    );
  return (
    <div className="dash-barre" data-forma="bar">
      <ul>
        {gruppi.map((g, i) =>
          barra(`g${i}`, g.etichetta || g.k || '(vuoto)', aNumero(g.valore) ?? 0)
        )}
        {altri
          ? barra(
              'altri',
              `Altri (${scrivi(altri.gruppi ?? 0, true)} ${altri.gruppi === 1 ? 'gruppo' : 'gruppi'})`,
              aNumero(altri.valore) ?? 0,
              'dash-barra-altri'
            )
          : null}
      </ul>
      <Base r={r} />
    </div>
  );
};

/**
 * Il risultato nella forma scelta, oppure null quando il widget deve mostrare la lista
 * (forma «lista», nessun risultato). Un risultato in errore lo dice e lascia la lista:
 * la chiamante la mostra comunque.
 */
export const RisultatoVista: React.FC<Props> = (p) => {
  const { risultato: r, forma } = p;
  if (r.errore)
    return (
      <Typography.Text type="danger" className="dash-risultato-errore">
        Il calcolo non si applica: {r.errore} Sotto, la lista.
      </Typography.Text>
    );
  if (forma === 'kpi') return <Numero {...p} />;
  if (forma === 'bar') return <Barre {...p} />;
  return null;
};
