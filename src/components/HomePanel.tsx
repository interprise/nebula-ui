import React from 'react';
import { Empty, Typography } from 'antd';
import { HomeOutlined, BellOutlined } from '@ant-design/icons';
import BannerCard from './BannerCard';
import type { Banner, LoginInfo } from '../types/ui';

interface HomePanelProps {
  loginInfo: LoginInfo;
  onBannerClick?: (navigateTo: string) => void;
}

const { Title, Text } = Typography;

const HomePanel: React.FC<HomePanelProps> = ({ loginInfo, onBannerClick }) => {
  const banners: Banner[] = (loginInfo.banners || []).filter((b) => b.banHomePage !== false);
  const hasContent = banners.length > 0;

  return (
    <div
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '32px 24px',
        width: '100%',
      }}
    >
      {/* Welcome header */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: 32,
          padding: '24px 20px',
          background: 'linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)',
          borderRadius: 14,
          border: '1px solid #bae0ff',
        }}
      >
        <HomeOutlined style={{ fontSize: 40, color: '#1677ff', marginBottom: 10 }} />
        <Title level={3} style={{ margin: 0, color: '#003a8c' }}>
          Benvenuto, {loginInfo.login}
        </Title>
        <Text type="secondary" style={{ fontSize: 14 }}>
          {loginInfo.profile}
        </Text>
      </div>

      {/* Banner section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          paddingBottom: 8,
          borderBottom: '2px solid #f0f0f0',
        }}
      >
        <BellOutlined style={{ fontSize: 18, color: '#1677ff' }} />
        <Title level={5} style={{ margin: 0 }}>
          Avvisi e notifiche
          {hasContent && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>
              ({banners.length})
            </Text>
          )}
        </Title>
      </div>

      {/* Banners */}
      {hasContent ? (
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
