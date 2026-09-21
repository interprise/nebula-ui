import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Segmented, Typography } from 'antd';
import { HomeOutlined, BellOutlined, AppstoreOutlined } from '@ant-design/icons';
import BannerCard from './BannerCard';
import DashboardPanel from './DashboardPanel';
import { avvisiNuovi, segnaVisti } from '../hooks/avvisiVisti';
import type { Banner, LoginInfo } from '../types/ui';

interface HomePanelProps {
  loginInfo: LoginInfo;
  onBannerClick?: (navigateTo: string) => void;
}

type Cosa = 'dashboard' | 'avvisi';

/** Quanto dura «l'apertura» della Home: oltre, gli avvisi nuovi non spostano piu' nulla. */
const APERTURA_MS = 30000;

const { Title, Text } = Typography;

const HomePanel: React.FC<HomePanelProps> = ({ loginInfo, onBannerClick }) => {
  const banners: Banner[] = (loginInfo.banners || []).filter((b) => b.banHomePage !== false);
  const hasContent = banners.length > 0;
  // La Home si apre sugli AVVISI se ce n'e' almeno uno che questa persona non ha
  // ancora visto, altrimenti sulla dashboard (Luca, 21/09): un avviso nuovo e' una
  // cosa che qualcuno ha scritto perche' venisse letta, la dashboard sta li' e
  // aspetta. Il «gia' visto» vive nel browser, per login: sul server non esiste.
  const nuovi = useMemo(() => avvisiNuovi(banners, loginInfo.login), [banners, loginInfo.login]);
  const [cosa, setCosa] = useState<Cosa>('dashboard');

  // Gli avvisi non ci sono ancora al primo disegno: arrivano col loginfo e li
  // aggiorna il Ping. Decidere una volta sola al montaggio voleva dire decidere
  // sempre «dashboard». Qui si guarda finche' non si e' deciso, e la scelta salta
  // appena si vede il primo avviso nuovo — ma non dopo che l'utente ha scelto lui:
  // spostargli la pagina sotto il naso mentre legge sarebbe peggio.
  const scelto = useRef(false);
  const deciso = useRef(false);
  const montato = useRef(Date.now());
  useEffect(() => {
    if (scelto.current || deciso.current || nuovi.length === 0) return;
    // Solo all'APERTURA. Un avviso che arriva mezz'ora dopo col Ping non deve
    // spostare la pagina sotto le mani di chi sta guardando la dashboard: lo dice
    // l'etichetta del commutatore, che intanto conta i nuovi.
    if (Date.now() - montato.current > APERTURA_MS) return;
    deciso.current = true;
    setCosa('avvisi');
  }, [nuovi.length]);

  // Guardati gli avvisi, non sono piu' nuovi. Si segna quello che c'e' adesso: se
  // ne arriva uno mentre la Home e' aperta, resta nuovo e la prossima volta si
  // aprira' ancora di li'.
  const segnati = useRef(false);
  useEffect(() => {
    if (cosa !== 'avvisi' || segnati.current || banners.length === 0) return;
    segnaVisti(banners, loginInfo.login);
    segnati.current = true;
  }, [cosa, banners, loginInfo.login]);

  return (
    <div
      style={{
        maxWidth: cosa === 'dashboard' ? 1400 : 820,
        margin: '0 auto',
        padding: '32px 24px',
        width: '100%',
      }}
    >
      {/* Welcome header */}
      {/* Sulla dashboard il benvenuto si stringe: com'era, spingeva i widget sotto la
          piega, e la Home esiste per far vedere quelli. Sugli avvisi resta com'era. */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: cosa === 'dashboard' ? 12 : 32,
          padding: cosa === 'dashboard' ? '10px 20px' : '24px 20px',
          background: 'linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)',
          borderRadius: 14,
          border: '1px solid #bae0ff',
        }}
      >
        {cosa === 'dashboard' ? (
          <Title level={5} style={{ margin: 0, color: '#003a8c' }}>
            <HomeOutlined style={{ marginRight: 8 }} />
            Benvenuto, {loginInfo.login}
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
              {loginInfo.profile}
            </Text>
          </Title>
        ) : (
          <>
            <HomeOutlined style={{ fontSize: 40, color: '#1677ff', marginBottom: 10 }} />
            <Title level={3} style={{ margin: 0, color: '#003a8c' }}>
              Benvenuto, {loginInfo.login}
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              {loginInfo.profile}
            </Text>
          </>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Segmented<Cosa>
          value={cosa}
          onChange={(v) => {
            scelto.current = true;
            setCosa(v);
          }}
          options={[
            { value: 'dashboard', label: 'Dashboard', icon: <AppstoreOutlined /> },
            {
              value: 'avvisi',
              // Il numero che conta e' quello dei NUOVI, finche' ce ne sono: e' la
              // ragione per cui uno guarda li'.
              label: nuovi.length > 0
                ? `Avvisi (${nuovi.length} ${nuovi.length === 1 ? 'nuovo' : 'nuovi'})`
                : hasContent
                  ? `Avvisi (${banners.length})`
                  : 'Avvisi',
              icon: <BellOutlined />,
            },
          ]}
        />
      </div>

      {cosa === 'dashboard' ? (
        <DashboardPanel />
      ) : hasContent ? (
        <div>
          {banners.map((b, i) => (
            <BannerCard key={i} banner={b} onNavigate={onBannerClick} />
          ))}
        </div>
      ) : (
        <Empty
          description={
            <Text type="secondary">Nessun avviso disponibile</Text>
          }
          style={{ marginTop: 40 }}
        />
      )}

      {/* Hint footer */}
      <div
        style={{
          marginTop: 40,
          textAlign: 'center',
          fontSize: 12,
          color: '#8c8c8c',
        }}
      >
        Seleziona una voce dal menu a sinistra per iniziare
      </div>
    </div>
  );
};

export default HomePanel;
