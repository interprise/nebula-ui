import React, { useCallback, useEffect, useState } from 'react';
import {
  Drawer,
  List,
  Button,
  Tooltip,
  Spin,
  Empty,
  Typography,
  App,
  Space,
} from 'antd';
import {
  DownloadOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  FileOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { AttachmentMeta, AttachmentsInfo } from '../types/ui';
import * as api from '../services/api';

const { Text } = Typography;

interface AttachmentsDrawerProps {
  open: boolean;
  onClose: () => void;
  info: AttachmentsInfo;
  sid: string;
  /** Path of the DETAIL view the drawer is bound to. Forwarded to the
   *  AttachmentList command so the server can activate the right view. */
  navpath?: string;
  /** Called after a server-mutating action (delete/upload-via-bar) so the
   *  parent can refresh the underlying view. */
  onRefresh: () => void;
  /** Called when the user picks "metadata" on a row (CDMS only). The parent
   *  is expected to dispatch a navigation to cdmsRisorseDetail for the key. */
  onOpenMetadata?: (key: string) => void;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('it-IT');
  } catch {
    return '';
  }
}

const AttachmentsDrawer: React.FC<AttachmentsDrawerProps> = ({
  open,
  onClose,
  info,
  sid,
  navpath,
  onRefresh,
  onOpenMetadata,
}) => {
  // Context-aware message/modal so they inherit the ConfigProvider CSS-var
  // theme; the static antd imports render invisibly under it. (SXADV-5542)
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<AttachmentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!info.allowList) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await api.fetchAttachments(sid, navpath || '');
      setItems(rows);
    } catch (e) {
      setError((e as Error).message || 'Errore caricamento allegati');
    } finally {
      setLoading(false);
    }
  }, [info.allowList, sid, navpath]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleDownload = useCallback(
    (row: AttachmentMeta) => {
      api
        .triggerDownload('DocDownload', { key: row.key }, sid, row.fileName)
        .catch((e) => message.error((e as Error).message || 'Download fallito'));
    },
    [sid],
  );

  const handleDelete = useCallback(
    (row: AttachmentMeta) => {
      modal.confirm({
        title: 'Eliminare allegato?',
        icon: <ExclamationCircleOutlined />,
        content: row.fileName,
        okText: 'Elimina',
        okButtonProps: { danger: true },
        cancelText: 'Annulla',
        onOk: async () => {
          try {
            await api.postAction('CdmsDelete', { key: row.key }, undefined, sid);
            await load();
            onRefresh();
          } catch (e) {
            message.error((e as Error).message || 'Eliminazione fallita');
          }
        },
      });
    },
    [sid, load, onRefresh],
  );

  return (
    <Drawer
      title="Allegati"
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      extra={
        <Tooltip title="Ricarica">
          <Button type="text" icon={<ReloadOutlined />} onClick={load} disabled={loading} />
        </Tooltip>
      }
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : error ? (
        <Empty description={<Text type="danger">{error}</Text>} />
      ) : items.length === 0 ? (
        <Empty description="Nessun allegato" />
      ) : (
        <List
          dataSource={items}
          renderItem={(row) => (
            <List.Item
              actions={[
                <Tooltip key="dl" title="Scarica">
                  <Button
                    type="text"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownload(row)}
                  />
                </Tooltip>,
                ...(info.cdmsActive && onOpenMetadata
                  ? [
                      <Tooltip key="info" title="Metadati">
                        <Button
                          type="text"
                          icon={<InfoCircleOutlined />}
                          onClick={() => onOpenMetadata(row.key)}
                        />
                      </Tooltip>,
                    ]
                  : []),
                ...(info.allowDelete
                  ? [
                      <Tooltip key="del" title="Elimina">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(row)}
                        />
                      </Tooltip>,
                    ]
                  : []),
              ]}
            >
              <List.Item.Meta
                avatar={<FileOutlined style={{ fontSize: 20 }} />}
                title={
                  <a onClick={() => handleDownload(row)} title={row.fileName}>
                    {row.description || row.fileName}
                  </a>
                }
                description={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {row.description && row.description !== row.fileName && (
                      <Text type="secondary" style={{ fontSize: 12 }} title={row.fileName}>
                        {row.fileName}
                      </Text>
                    )}
                    <Space size="small">
                      {row.size != null && <Text type="secondary">{formatSize(row.size)}</Text>}
                      {row.lastModified != null && (
                        <Text type="secondary">{formatDate(row.lastModified)}</Text>
                      )}
                    </Space>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
};

export default AttachmentsDrawer;
