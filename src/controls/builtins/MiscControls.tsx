import { Button, Select } from 'antd';
import {
  FileOutlined,
  LinkOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { triggerDownload } from '../../services/api';

interface AttachmentItem { key: string; fileName: string }

export const AttachmentsControl: ControlComponent = ({ control, onAction }) => {
  if (control.visible === false) return null;
  const items = (control.items as AttachmentItem[] | undefined) ?? [];
  const downloadCmd = control.downloadCommand as string | undefined;
  const editCmd = control.editCommand as string | undefined;
  const deleteCmd = control.deleteCommand as string | undefined;
  const canEdit = !!control.canEdit;
  const canDelete = !!control.canDelete;
  if (items.length === 0) return null;
  return (
    <div className="attachments-control" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item) => (
        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {canDelete && deleteCmd && (
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              title="Elimina"
              onClick={() => onAction(deleteCmd, { option1: item.key })}
            />
          )}
          {canEdit && editCmd && (
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              title="Modifica"
              onClick={() => onAction(editCmd, { option1: item.key })}
            />
          )}
          {downloadCmd ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                triggerDownload(downloadCmd, { option1: item.key }, undefined, item.fileName);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <FileOutlined /> {item.fileName}
            </a>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FileOutlined /> {item.fileName}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

export const BpmStatusControl: ControlComponent = ({ control, onChange }) => {
  if (control.visible === false) return null;
  if (control.readOnly) {
    return <span className="bpm-status-readonly">{(control.value as string) || ''}</span>;
  }
  const options = (control.options as { value: string; text: string }[] | undefined) ?? [];
  return (
    <Select
      id={control.id}
      value={control.value as string | undefined}
      onChange={(v) => control.name && onChange(control.name, v)}
      allowClear
      style={{ minWidth: 160 }}
      options={options.map((o) => ({ value: o.value, label: o.text }))}
    />
  );
};

export const ImageFormatControl: ControlComponent = ({ control }) => {
  const src = control.src as string | undefined;
  if (!src) return null;
  return <img src={src} alt="" />;
};

export const NavigateViewButtonControl: ControlComponent = ({ control, onAction }) => {
  if (control.visible === false) return null;
  const cmd = (control.command ?? control.action) as string | undefined;
  if (!cmd) return null;
  const extra: Record<string, string> = {};
  if (control.navpath) extra.navpath = control.navpath as string;
  if (control.controlName) extra.option1 = control.controlName as string;
  return (
    <Button
      id={control.id}
      size="small"
      icon={control.icon
        ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} />
        : <LinkOutlined />}
      onClick={() => onAction(cmd, extra)}
      title={control.hint}
    >
      {control.prompt as string | undefined}
    </Button>
  );
};

export const PathControl: ControlComponent = ({ control }) => {
  if (control.visible === false) return null;
  const segments = (control.segments as string[] | undefined) ?? [];
  if (segments.length === 0) return null;
  return (
    <div className="path-control" style={{ fontFamily: 'monospace', fontSize: 12 }}>
      {segments.map((s, i) => (
        <div key={i} style={{ paddingLeft: i * 12 }}>
          <span style={{ marginRight: 4 }}>&#128193;</span>
          {s}
        </div>
      ))}
    </div>
  );
};

export const PopupUrlControl: ControlComponent = ({ control }) => {
  if (control.visible === false) return null;
  const href = control.href as string | undefined;
  if (!href) return null;
  const target = (control.target as string | undefined) ?? '_blank';
  return (
    <a
      className={(control.cls as string) || 'link'}
      href={href}
      target={target}
      rel="noopener noreferrer"
    >
      {(control.prompt as string | undefined) ?? href}
    </a>
  );
};

export const UploadButtonControl: ControlComponent = ({ control, onAction }) => {
  const cmd = (control.command ?? control.action) as string | undefined;
  return (
    <Button
      id={control.id}
      icon={<DownloadOutlined style={{ transform: 'rotate(180deg)' }} />}
      onClick={() => cmd && onAction(cmd)}
      title={control.hint}
    >
      {(control.prompt as string | undefined) ?? 'Upload'}
    </Button>
  );
};
