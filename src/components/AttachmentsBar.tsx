import React, { useCallback, useRef, useState } from 'react';
import { Button, Tooltip, Badge, App } from 'antd';
import { UploadOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { AttachmentsInfo } from '../types/ui';
import * as api from '../services/api';
import AttachmentsDrawer from './AttachmentsDrawer';

interface AttachmentsBarProps {
  info: AttachmentsInfo;
  sid: string;
  /** Path of the DETAIL view the bar is bound to. Forwarded to the
   *  AttachmentList command so the server can activate the right view. */
  navpath?: string;
  /** Refresh the underlying view (after upload/delete). The parent should
   *  trigger a Refresh action against the server. */
  onRefresh: () => void;
  /** Open metadata view (cdmsRisorseDetail) for an attachment key. Only
   *  used when info.cdmsActive. */
  onOpenMetadata?: (key: string) => void;
}

const AttachmentsBar: React.FC<AttachmentsBarProps> = ({
  info,
  sid,
  navpath,
  onRefresh,
  onOpenMetadata,
}) => {
  // Context-aware message so toasts inherit the ConfigProvider CSS-var theme;
  // the static `message` import renders invisibly under it. (SXADV-5542)
  const { message } = App.useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      setUploading(true);
      try {
        await api.uploadAttachment(f, sid);
        onRefresh();
      } catch (err) {
        message.error((err as Error).message || 'Caricamento fallito');
      } finally {
        setUploading(false);
      }
    },
    [sid, onRefresh],
  );

  const handleListClick = useCallback(() => {
    if (info.count === 1 && info.single) {
      api
        // DocDownload extends Command2 → /controller2. On /controller the
        // dispatcher finds the class and fails casting it to Command.
        .triggerDownload('DocDownload', { key: info.single.key }, sid, info.single.fileName, true)
        .catch((e) => message.error((e as Error).message || 'Download fallito'));
      return;
    }
    setDrawerOpen(true);
  }, [info.count, info.single, sid]);

  const showUpload = info.allowAdd;
  const showList = info.allowList;
  const hasAttachments = info.count > 0;

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {showUpload && (
          <Tooltip title="Carica allegato">
            <Button
              type="text"
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={handlePick}
            />
          </Tooltip>
        )}
        {showList && (
          <Tooltip
            title={
              info.count === 0
                ? 'Nessun allegato'
                : info.count === 1 && info.single
                  ? `Scarica ${info.single.description || info.single.fileName}`
                  : `${info.count} allegati`
            }
          >
            <Badge count={hasAttachments ? info.count : 0} size="small" offset={[-4, 4]}>
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                onClick={handleListClick}
                disabled={!hasAttachments}
                style={hasAttachments ? undefined : { color: 'rgba(0,0,0,0.3)' }}
              />
            </Badge>
          </Tooltip>
        )}
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </span>
      {showList && (
        <AttachmentsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          info={info}
          sid={sid}
          navpath={navpath}
          onRefresh={onRefresh}
          onOpenMetadata={onOpenMetadata}
        />
      )}
    </>
  );
};

export default AttachmentsBar;
