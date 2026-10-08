/**
 * SXADV-62 F2 · «Aggiungi widget»: il catalogo dei widget condivisi con chi guarda (contratto
 * CONDIVISIONE, U1). Solo la definizione — titolo, autore, lista, filtri, forma — e mai
 * numeri: quelli di chi l'ha creato non sono di chi guarda, e quelli suoi li calcola il giro
 * dopo l'aggiunta.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Empty, Input, Spin, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import * as api from '../../services/api';
import { useFeedback } from '../../hooks/feedback';

/** Una voce del catalogo (dashboard.Catalogo, C2). */
export interface VoceCatalogo {
  idWidget: number;
  titolo?: string;
  autore?: string | null;
  forma?: string;
  viewName?: string;
  /** Il titolo della lista d'origine, come lo vede chi guarda. */
  lista?: string | null;
  descrizione?: string | null;
  filtri?: Array<{ etichetta?: string; valore?: string; negato?: boolean; casella?: boolean }>;
  filtriLeggibili?: boolean;
  colonne?: Array<{ etichetta?: string | null }>;
  ambito?: string;
  mandato?: boolean;
  giaNellaHome?: boolean;
}

const FORME: Record<string, string> = {
  list: 'Lista',
  kpi: 'Numero',
  bar: 'Barre',
  col: 'Colonne',
  pie: 'Torta',
  line: 'Linea',
};

interface Props {
  aperto: boolean;
  sid: string;
  onClose: () => void;
  /** Aggiunto: chi apre il pannello rilegge la Home. */
  onAggiunto: (titolo: string) => void;
}

const CatalogoWidget: React.FC<Props> = ({ aperto, sid, onClose, onAggiunto }) => {
  const feedback = useFeedback();
  const [voci, setVoci] = useState<VoceCatalogo[] | null>(null);
  const [cerca, setCerca] = useState('');
  const [inCorso, setInCorso] = useState<number | null>(null);

  const leggi = useCallback(async () => {
    setVoci(null);
    try {
      const resp = (await api.postAction2('dashboard.Catalogo', { sid })) as unknown as {
        esito?: string;
        widget?: VoceCatalogo[];
      };
      setVoci(resp.esito === 'ok' ? resp.widget || [] : []);
    } catch (e) {
      feedback.failure(e);
      setVoci([]);
    }
    // feedback e' memoizzato da useFeedback (vedi DashboardPanel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  useEffect(() => {
    if (!aperto) return;
    setCerca('');
    void leggi();
  }, [aperto, leggi]);

  const filtrate = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (voci || []).filter((v) => !q || (v.titolo || '').toLowerCase().includes(q));
  }, [voci, cerca]);
  const gruppi = [
    { titolo: 'Della mia sede', voci: filtrate.filter((v) => (v.ambito || '').startsWith('sede:')) },
    { titolo: 'Di tutta l\'azienda', voci: filtrate.filter((v) => v.ambito === 'azienda') },
  ];

  const aggiungi = async (v: VoceCatalogo) => {
    if (inCorso !== null) return;
    setInCorso(v.idWidget);
    try {
      const resp = (await api.postAction2('dashboard.AggiungiDalCatalogo', {
        sid,
        idWidget: String(v.idWidget),
      })) as unknown as Record<string, unknown>;
      if (resp.esito !== 'ok') {
        feedback.warning(String(resp.messaggio || 'Il widget non si e\' potuto aggiungere.'));
        return;
      }
      setVoci((l) => (l || []).map((x) => (x.idWidget === v.idWidget ? { ...x, giaNellaHome: true } : x)));
      onAggiunto(v.titolo || 'Widget');
    } catch (e) {
      feedback.failure(e);
    } finally {
      setInCorso(null);
    }
  };

  return (
    <Drawer title="Aggiungi widget" placement="right" size={460} open={aperto} onClose={onClose}
      destroyOnHidden>
      <Input.Search
        placeholder="Cerca per titolo"
        allowClear
        value={cerca}
        onChange={(e) => setCerca(e.target.value)}
        aria-label="Cerca nel catalogo"
        style={{ marginBottom: 12 }}
      />
      {voci === null ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : filtrate.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={(voci || []).length === 0
            ? 'Nessun widget condiviso con te.'
            : 'Nessun widget con questo titolo.'}
        />
      ) : (
        gruppi.filter((g) => g.voci.length > 0).map((g) => (
          <section key={g.titolo} className="dash-catalogo-gruppo">
            <Typography.Title level={5}>{g.titolo}</Typography.Title>
            {g.voci.map((v) => (
              <article key={v.idWidget} className="dash-catalogo-voce" data-widget={v.idWidget}>
                <div className="dash-catalogo-testa">
                  <Typography.Text strong>{v.titolo}</Typography.Text>
                  <Tag>{FORME[v.forma || ''] || v.forma}</Tag>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {v.autore ? `di ${v.autore} · ` : ''}
                  {v.lista || v.viewName}
                </Typography.Text>
                {/* I filtri come li mostra la Home: le caselle senza valore, l'esclusione detta */}
                {v.filtriLeggibili === false && v.descrizione ? (
                  <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>{v.descrizione}</Typography.Text>
                ) : (v.filtri || []).length > 0 ? (
                  <div className="dash-widget-filtri">
                    {(v.filtri || []).map((f, i) => (
                      <Tag key={i}>
                        {f.etichetta}
                        {f.negato ? ' (escluso)' : ''}
                        {f.casella ? '' : `: ${f.valore}`}
                      </Tag>
                    ))}
                  </div>
                ) : null}
                {v.forma === 'list' && (v.colonne || []).length > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                    Colonne: {(v.colonne || []).map((c) => c.etichetta).filter(Boolean).join(', ')}
                  </Typography.Text>
                ) : null}
                <div>
                  {v.giaNellaHome ? (
                    <Typography.Text type="secondary">già nella tua Home</Typography.Text>
                  ) : (
                    <Button size="small" type="primary" icon={<PlusOutlined />}
                      loading={inCorso === v.idWidget} onClick={() => void aggiungi(v)}>
                      Aggiungi
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </section>
        ))
      )}
    </Drawer>
  );
};

export default CatalogoWidget;
