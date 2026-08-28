import { useContext, useState } from 'react';
import { Button, Upload, App } from 'antd';
import { SearchOutlined, PlusOutlined, UploadOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { triggerDownload, uploadFile } from '../../services/api';
import { SidContext } from '../../components/ViewRenderer';

/** Un bottone la cui didascalia e' una lettera o due non e' un'azione
 *  etichettata: e' un CONTRASSEGNO (la "S" di anagrafica sincronizzata accanto
 *  al Codice, `controlType="ImageButton" size="2"`). La view gli assegna due
 *  colonne di griglia — una sola cella del righello, ~24px — mentre il padding
 *  di antd da solo ne vale 30, quindi `overflow:hidden` della cella tagliava il
 *  contrassegno a meta' (SXADV-5796.0). Qui prende il vestito stretto che la
 *  sua dimensione dichiarata implica. */
const isMarkerButton = (control: { prompt?: string; icon?: string }): boolean =>
  !control.icon && (control.prompt ?? '').trim().length <= 2;

export const ButtonControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    className={isMarkerButton(control) ? 'nb-btn-marker' : undefined}
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
  // Captions wrap (they must: inside a link band the columns are narrow), but
  // the icon and the count pill are atomic inline boxes, and a line can break
  // on either side of one — so the link icon ended up alone on the first line
  // and the pill alone on the last, both detached from the words they belong
  // to. Bind them to the caption's first and last word inside nowrap spans; the
  // words in between wrap freely (SXADV-5746).
  const prompt = (control.prompt as string | undefined) ?? '';
  const count = typeof control.count === 'number' && control.count > 0 ? control.count : null;
  const words = prompt.trim() ? prompt.trim().split(/\s+/) : [];
  // checkTarget links carry the number of rows behind the link; legacy appended
  // it inline as "(n)", here it's a filled counter pill in the phone-badge
  // idiom (SXADV-5746.2).
  const badge = count === null ? null : <span className="nav-link-count">{count}</span>;
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const middle = words.slice(1, words.length - 1);
  return (
  <span
    id={control.id}
    className="navigate-view-link"
    // white-space and spacing live in CSS (global.css): nowrap by default, but
    // relaxed to wrap inside form layout cells and inside the link band — a
    // nowrap link in a fixed-width cell gets hard-clipped by overflow:hidden
    // when zoom shrinks the viewport, silently hiding trailing links ("Storico
    // Ordini" etc., 5450.1C). Legacy rendered them as plain <a> in table cells,
    // which wrapped.
    style={{ cursor: 'pointer', color: '#1677ff' }}
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
    <span className="nav-link-head">
      <LinkOutlined className="nav-link-icon" />
      {first}
      {last === undefined && badge}
    </span>
    {middle.length > 0 && ' ' + middle.join(' ')}
    {last !== undefined && (
      <>
        {' '}
        <span className="nav-link-tail">{last}{badge}</span>
      </>
    )}
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
