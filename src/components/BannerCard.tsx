import React, { useState } from 'react';
import { Card, Space, Tag, Button, Tooltip } from 'antd';
import {
  NotificationOutlined,
  CalendarOutlined,
  LinkOutlined,
  ArrowRightOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { Banner } from '../types/ui';

interface BannerCardProps {
  banner: Banner;
  onNavigate?: (navigateTo: string) => void;
  compact?: boolean;
  /** Initial collapsed state (default: expanded) */
  defaultCollapsed?: boolean;
  /** When true, card is not collapsible (always expanded) */
  notCollapsible?: boolean;
}

/** Extract plain text preview from possibly-HTML banner text.
 *  Decodes HTML entities by letting the browser parse the fragment. */
function toPreview(html: string, max: number): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const BannerCard: React.FC<BannerCardProps> = ({
  banner, onNavigate, compact, defaultCollapsed = false, notCollapsible = false,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed && !notCollapsible);
  const body = banner.hpText || banner.text;
  const externalLinks: { url: string; label: string }[] = [];
  if (banner.linkEsterno1) externalLinks.push({ url: banner.linkEsterno1, label: banner.linkEsternoDescr1 || banner.linkEsterno1 });
  if (banner.linkEsterno2) externalLinks.push({ url: banner.linkEsterno2, label: banner.linkEsternoDescr2 || banner.linkEsterno2 });
  if (banner.linkEsterno3) externalLinks.push({ url: banner.linkEsterno3, label: banner.linkEsternoDescr3 || banner.linkEsterno3 });

  const isClickable = !!banner.navigateTo && !!onNavigate;
  const preview = toPreview(body, 100);

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((c) => !c);
  };

  return (
    <Card
      hoverable={isClickable}
      className="banner-card"
      style={{
        marginBottom: compact ? 10 : 14,
        borderLeft: '4px solid #1677ff',
        borderRadius: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
      styles={{ body: { padding: compact ? 12 : 16 } }}
      onClick={collapsed ? toggleCollapse : (isClickable ? () => onNavigate!(banner.navigateTo!) : undefined)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon column */}
        <div
          style={{
            width: collapsed ? 28 : 36,
            height: collapsed ? 28 : 36,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'width 0.15s, height 0.15s',
          }}
        >
          <NotificationOutlined style={{ color: '#fff', fontSize: collapsed ? 14 : 18 }} />
        </div>

        {/* Content column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {collapsed ? (
            /* COLLAPSED: single-line preview with date */
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {banner.banDate && (
                <Tag color="blue" style={{ fontSize: 11, margin: 0, flexShrink: 0 }}>
                  {banner.banDate}
                </Tag>
              )}
              <span
                style={{
                  fontSize: 13,
                  color: '#595959',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
                title={preview}
              >
                {preview}
              </span>
            </div>
          ) : (
            <>
              {/* Date badge */}
              {banner.banDate && (
                <Tag
                  icon={<CalendarOutlined />}
                  color="blue"
                  style={{ marginBottom: 6, fontSize: 11 }}
                >
                  {banner.banDate}
                </Tag>
              )}

              {/* Body */}
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: '#262626',
                  wordBreak: 'break-word',
                }}
                dangerouslySetInnerHTML={{ __html: body }}
              />

              {/* External links */}
              {externalLinks.length > 0 && (
                <Space wrap style={{ marginTop: 10 }}>
                  {externalLinks.map((link, i) => (
                    <Button
                      key={i}
                      size="small"
                      icon={<LinkOutlined />}
                      type="default"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(link.url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      {link.label}
                    </Button>
                  ))}
                </Space>
              )}

              {/* Call-to-action footer */}
              {isClickable && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: '#1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Apri dettaglio <ArrowRightOutlined />
                </div>
              )}
            </>
          )}
        </div>

        {/* Collapse toggle */}
        {!notCollapsible && (
          <Tooltip title={collapsed ? 'Espandi' : 'Comprimi'}>
            <Button
              type="text"
              size="small"
              icon={collapsed ? <DownOutlined /> : <UpOutlined />}
              onClick={toggleCollapse}
              style={{ flexShrink: 0, marginTop: -4 }}
            />
          </Tooltip>
        )}
      </div>
    </Card>
  );
};

export { toPreview };
export default BannerCard;
