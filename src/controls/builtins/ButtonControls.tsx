import { useContext } from 'react';
import { Button, Upload, message } from 'antd';
import { SearchOutlined, PlusOutlined, UploadOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { triggerDownload, uploadFile } from '../../services/api';
import { SidContext } from '../../components/ViewRenderer';

export const ButtonControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    disabled={control.disabled}
    icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
    onClick={() => control.action && onAction(control.action)}
    title={control.hint}
  >
    {control.prompt}
  </Button>
);

export const ActionControl: ControlComponent = ({ control, onAction }) => {
  // The server hides actions with no applicable workflow event for the row.
  if (control.visible === false || !control.action) return null;
  // workflow.Action resolves the event by option1 (the event index emitted by
  // the server); without it the command can't find the event (SXADV-5457.3).
  const extra = control.option1 != null ? { option1: String(control.option1) } : undefined;
  return (
    <Button
      id={control.id}
      type="link"
      size="small"
      disabled={control.disabled}
      icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
      onClick={() => onAction(control.action as string, extra)}
      title={control.hint}
    >
      {control.prompt}
    </Button>
  );
};

export const WindowButtonControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    disabled={control.disabled}
    icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
    onClick={() => {
      if (control.openWin) {
        window.open(`/entrasp/controller?action=${control.action}`, '_blank');
      } else {
        control.action && onAction(control.action);
      }
    }}
    title={control.hint}
  >
    {control.prompt}
  </Button>
);

export const LookupControl: ControlComponent = ({ control, onAction }) => {
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
      icon={<SearchOutlined />}
      disabled={control.disabled}
      onClick={() => onAction(cmd, extra)}
      title={control.hint}
    />
  );
};

export const NavigateViewControl: ControlComponent = ({ control, onAction }) => {
  // Visibility is a render-time concern: the server always emits the descriptor
  // (so it survives template caching) and carries per-record navigability as a
  // `visible` dynProp. Hide when the current record has no navigable target
  // (SXADV-5474).
  if (control.visible === false) return null;
  return (
  <span
    id={control.id}
    className="navigate-view-link"
    style={{ cursor: 'pointer', color: '#1677ff', whiteSpace: 'nowrap', marginRight: 12 }}
    title={control.hint}
    onClick={() => control.action && onAction(control.action, {
      navpath: control.navpath as string,
      // option1 must be the BARE item name: the server resolves the source
      // ViewItem via getItemByName (exact match). control.name is hydrated to
      // the wire-form "name.viewstateId", so use the dedicated controlName
      // field (falling back to name for pre-fix servers) — SXADV-5474.
      option1: (control.controlName ?? control.name) as string,
    })}
  >
    <LinkOutlined style={{ marginRight: 4, fontSize: 12 }} />
    {control.prompt as string}
  </span>
  );
};

export const AddControl: ControlComponent = ({ control, onAction }) => {
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
      icon={<PlusOutlined />}
      disabled={control.disabled}
      onClick={() => onAction(cmd, extra)}
      title={control.hint}
    />
  );
};

export const UploadControl: ControlComponent = ({ control, onAction }) => {
  const sid = useContext(SidContext);
  const isDisabled = !!control.disabled || control.editable === false;
  const followUp = (control.command ?? control.action) as string | undefined;
  const handleFile = async (file: File) => {
    try {
      const resp = await uploadFile(file, sid);
      if (resp.errors && resp.errors.length > 0) {
        message.error(resp.errors[0].message);
        return false;
      }
      if (followUp) onAction(followUp);
      else message.success(`${file.name} caricato`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Upload fallito');
    }
    return false; // prevent antd's built-in xhr upload
  };
  return (
    <Upload
      beforeUpload={handleFile}
      maxCount={1}
      disabled={isDisabled}
      showUploadList={false}
    >
      <Button icon={<UploadOutlined />} disabled={isDisabled}>
        {(control.prompt as string | undefined) ?? 'Upload'}
      </Button>
    </Upload>
  );
};

export const DownloadControl: ControlComponent = ({ control }) => {
  if (control.visible === false) return null;
  const cmd = (control.command ?? control.action) as string | undefined;
  if (!cmd) return null;
  const extra: Record<string, string> = {};
  if (control.navpath) extra.navpath = control.navpath as string;
  if (control.controlName) extra.option1 = control.controlName as string;
  return (
    <Button
      id={control.id}
      icon={control.icon
        ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} />
        : <DownloadOutlined />}
      onClick={() => triggerDownload(cmd, extra)}
      title={control.hint}
    >
      {control.prompt || 'Download'}
    </Button>
  );
};
