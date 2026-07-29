import { useContext, useState } from 'react';
import { Button, Upload, App } from 'antd';
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
    // white-space lives in CSS (global.css): nowrap by default, but relaxed to
    // wrap inside form layout cells — a nowrap link in a fixed-width cell gets
    // hard-clipped by overflow:hidden when zoom shrinks the viewport, silently
    // hiding trailing links ("Storico Ordini" etc., 5450.1C). Legacy rendered
    // them as plain <a> in table cells, which wrapped.
    style={{ cursor: 'pointer', color: '#1677ff', marginRight: 12 }}
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

/** Shared file-picker behaviour for `upload` (FileUploadUIControl) and
 *  `uploadButton` (UploadButtonUIControl). Both mapped to the same legacy
 *  ExtJS component (`Ext.ux.form.FileUploadField`, ui.js `"upload"`), which
 *  on `fileselected` did:
 *    1. POST the file alone, multipart, to `ctl.action || 'FileUpload'`
 *       (doUpload) — the command parks it on the Session (uploadedFiles);
 *    2. on success re-dispatch the current view with `action=Post`
 *       (cleanUpload -> ajaxDo), which is what runs
 *       Command.checkForUpload -> UploadSupport.performUpload() and actually
 *       imports the file. `uiData.cdmsKey` redirects that follow-up to
 *       CdmsEdit instead (CdmsUploadCommand).
 *  Step 2 was missing: the file landed on the session and nothing consumed
 *  it, so "carica da file" appeared to do nothing (SXADV-5672). */
function useFilePicker(
  control: Parameters<ControlComponent>[0]['control'],
  onAction: (action: string, params?: Record<string, string>) => void,
) {
  // Context-aware message so toasts inherit the ConfigProvider CSS-var theme;
  // the static `message` import renders invisibly under it. (SXADV-5542)
  const { message } = App.useApp();
  const sid = useContext(SidContext);
  const uploadAction = (control.uploadAction as string | undefined) ?? 'FileUpload';
  const [fileName, setFileName] = useState<string | null>(null);
  const handleFile = async (file: File) => {
    try {
      const extra: Record<string, string> = {};
      if (control.controlName) extra.option1 = control.controlName as string;
      if (control.navpath) extra.navpath = control.navpath as string;
      const resp = await uploadFile(file, sid, extra, uploadAction);
      if (resp.errors && resp.errors.length > 0) {
        message.error(resp.errors[0].message);
        return false;
      }
      setFileName(file.name);
      const cdmsKey = (resp.uiData as Record<string, unknown> | undefined)?.cdmsKey as string | undefined;
      if (cdmsKey) onAction('CdmsEdit', { navpath: cdmsKey });
      else onAction('Post');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Upload fallito');
    }
    return false; // prevent antd's built-in xhr upload
  };
  return { handleFile, fileName };
}

export const UploadControl: ControlComponent = ({ control, onAction }) => {
  const isDisabled = !!control.disabled || control.editable === false;
  const { handleFile, fileName } = useFilePicker(control, onAction);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Upload
        beforeUpload={handleFile}
        maxCount={1}
        disabled={isDisabled}
        showUploadList={false}
      >
        <Button icon={<UploadOutlined />} disabled={isDisabled} title={control.hint}>
          {(control.prompt as string | undefined) ?? 'Scegli File'}
        </Button>
      </Upload>
      {fileName && <span className="upload-file-name">{fileName}</span>}
    </span>
  );
};

/** UploadButton: the icon-only variant (legacy arrow_up.png image button).
 *  Same file-picker flow, no filename echo — it sits inline next to other
 *  fields (cdmsRisorseDetail). */
export const UploadButtonControl: ControlComponent = (props) => {
  if (props.control.visible === false) return null;
  return <UploadButtonInner {...props} />;
};

const UploadButtonInner: ControlComponent = ({ control, onAction }) => {
  const isDisabled = !!control.disabled || control.editable === false;
  const { handleFile } = useFilePicker(control, onAction);
  return (
    <Upload beforeUpload={handleFile} maxCount={1} disabled={isDisabled} showUploadList={false}>
      <Button
        id={control.id}
        disabled={isDisabled}
        title={control.hint}
        icon={control.icon
          ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} />
          : <UploadOutlined />}
      >
        {control.prompt as string | undefined}
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
