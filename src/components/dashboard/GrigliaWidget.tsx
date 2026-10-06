/**
 * SXADV-62 F2 · La griglia della Home e la modalita' «Disposizione» (contratto DISPOSIZIONE,
 * C1-C5; piano F1 §6.1; SXADV-6001.5).
 *
 * I widget arrivano gia' disegnati (gli `<article>` di DashboardPanel, uno per id): qui si
 * decide solo dove stanno. Fuori dalla modalita' niente si sposta; nella modalita' si
 * trascina l'intestazione, si ridimensiona dall'angolo in basso a destra, e da tastiera
 * frecce e Maiusc + frecce. Salva manda la disposizione intera al server; Annulla la butta.
 */
import React, { useMemo, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import GridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  ALTEZZA_RIGA,
  COLONNE,
  LARGHEZZA_STRETTA,
  aggiornaBozza,
  daTastiera,
  layoutDa,
  ordineRigaColonna,
  type Posto,
} from './disposizione';

/** Quello che la griglia manda al server: un elemento per widget (S1). */
export interface PostoSalvato {
  idWidget: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  widget: Posto[];
  /** Il widget disegnato, per id. */
  articoli: Map<number, React.ReactElement>;
  /** Altri pulsanti nella barra sopra i widget («Segna tutte come viste»). */
  extra?: React.ReactNode;
  /** Salva la disposizione: true se il server l'ha presa (la modalita' si chiude). */
  onSalva: (posti: PostoSalvato[]) => Promise<boolean>;
}

const MARGINE: [number, number] = [12, 12];
/** L'altezza in px di h righe, come la calcola la griglia (righe piu' i margini fra loro). */
const altezzaPx = (h = 1) => h * ALTEZZA_RIGA + (h - 1) * MARGINE[1];

const GrigliaWidget: React.FC<Props> = ({ widget, articoli, extra, onSalva }) => {
  // misurata prima del primo disegno: a 1280 px di default uno schermo stretto partirebbe
  // dalla griglia, e uno normale vedrebbe i widget scivolare al loro posto
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  /** La disposizione in corso, o null fuori dalla modalita'. */
  const [bozza, setBozza] = useState<Layout | null>(null);
  const [salvando, setSalvando] = useState(false);
  const daServer = useMemo(() => layoutDa(widget), [widget]);
  const stretta = mounted && width < LARGHEZZA_STRETTA;
  // Mentre si dispone, una rilettura (un widget aggiornato) cambia i contenuti ma non la
  // disposizione (C4); widget spariti, comparsi o con la forma cambiata si allineano.
  const layout = useMemo(
    () => (bozza ? aggiornaBozza(bozza, daServer, widget) : daServer),
    [bozza, daServer, widget],
  );
  // Diventata stretta a modalita' aperta: in colonna non si dispone (C5), e una bozza che
  // non si vede non deve finire salvata. Si chiude come con Annulla.
  if (stretta && bozza) setBozza(null);

  const salva = async () => {
    if (!bozza) return;
    setSalvando(true);
    try {
      const fatto = await onSalva(
        verticalCompactor
          .compact(layout, COLONNE)
          .map((l) => ({ idWidget: Number(l.i), x: l.x, y: l.y, w: l.w, h: l.h })),
      );
      if (fatto) setBozza(null);
    } finally {
      setSalvando(false);
    }
  };

  const tasto = (id: string) => (e: React.KeyboardEvent) => {
    if (!bozza || e.target !== e.currentTarget) return;
    const passo = {
      ArrowLeft: e.shiftKey ? { dw: -1 } : { dx: -1 },
      ArrowRight: e.shiftKey ? { dw: 1 } : { dx: 1 },
      ArrowUp: e.shiftKey ? { dh: -1 } : { dy: -1 },
      ArrowDown: e.shiftKey ? { dh: 1 } : { dy: 1 },
    }[e.key];
    if (!passo) return;
    e.preventDefault();
    setBozza(daTastiera(layout, id, passo));
  };

  const figli = (ordine: string[], conAltezza = false) =>
    ordine.map((i) => {
      const a = articoli.get(Number(i));
      if (!a) return null;
      return (
        <div
          key={i}
          className={bozza ? 'dash-cella dash-cella-disponi' : 'dash-cella'}
          tabIndex={bozza ? 0 : undefined}
          aria-label={bozza ? 'Widget: frecce per spostarlo, Maiusc + frecce per ridimensionarlo' : undefined}
          onKeyDown={tasto(i)}
          style={conAltezza ? { height: altezzaPx(layout.find((l) => l.i === i)?.h) } : undefined}
        >
          {a}
        </div>
      );
    });

  return (
    <div className="dash-home">
      <div className="dash-barra">
        {bozza ? (
          <>
            <Typography.Text type="secondary" className="dash-barra-aiuto">
              Trascina un widget dall&apos;intestazione, ridimensionalo dall&apos;angolo in basso a
              destra (da tastiera: frecce e Maiusc + frecce).
            </Typography.Text>
            <Space>
              <Button size="small" onClick={() => setBozza(null)} disabled={salvando}>
                Annulla
              </Button>
              <Button size="small" type="primary" onClick={() => void salva()} loading={salvando}>
                Salva
              </Button>
            </Space>
          </>
        ) : (
          <Space>
            {extra}
            {!stretta && widget.length > 0 ? (
              <Button size="small" icon={<AppstoreOutlined />} onClick={() => setBozza(daServer)}>
                Disposizione
              </Button>
            ) : null}
          </Space>
        )}
      </div>
      <div ref={containerRef} className="dash-griglia">
        {!mounted ? null : stretta ? (
          <div className="dash-colonna">{figli(ordineRigaColonna(layout), true)}</div>
        ) : (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: COLONNE, rowHeight: ALTEZZA_RIGA, margin: MARGINE, containerPadding: [0, 0] }}
            dragConfig={{
              enabled: !!bozza,
              handle: '.dash-widget-head',
              cancel: 'button, a, input, .ant-btn, .ant-tag, .anticon',
            }}
            resizeConfig={{ enabled: !!bozza, handles: ['se'] }}
            compactor={verticalCompactor}
            onLayoutChange={(l) => {
              if (bozza) setBozza(l);
            }}
          >
            {figli(layout.map((l) => l.i))}
          </GridLayout>
        )}
      </div>
    </div>
  );
};

export default GrigliaWidget;
