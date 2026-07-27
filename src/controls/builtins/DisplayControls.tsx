import { Input } from 'antd';
import { fixServerHtml } from '../../services/serverHtml';
import { BarcodeOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue, parseInlineStyle } from '../helpers';

export const BarcodeControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  return (
    <Input
      {...commonProps}
      value={value}
      prefix={<BarcodeOutlined />}
      onChange={(e) => { setValue(e.target.value); store(e.target.value); }}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
};

export const UrlControl: ControlComponent = ({ control }) => {
  if (control.visible === false) return null;
  const href = (control.href ?? control.value) as string | undefined;
  const label = (control.prompt ?? control.displayValue ?? control.value) as string | undefined;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
};

export const HtmlControl: ControlComponent = ({ control }) => (
  <span dangerouslySetInnerHTML={{ __html: fixServerHtml((control.value as string) || '') }} />
);

export const HtmlFormatControl: ControlComponent = ({ control }) => {
  const cls = control.cls as string | undefined;
  const style = parseInlineStyle(control.style as string | undefined);
  // A styled htmlFormat (e.g. a header carrying contentClass="section_header"
  // and/or contentStyle) must render as a block filling the cell, or its class
  // styling — background bar, `text-align:center` — has nothing to lay out
  // against and collapses to plain inline text (SXADV-5487). Mirror HintControl.
  // Plain (unclassed) htmlFormat keeps its inline behavior.
  const styled = !!cls || !!control.style;
  return (
    <span
      className={cls || ''}
      style={styled ? { display: 'block', width: '100%', ...style } : style}
      dangerouslySetInnerHTML={{ __html: fixServerHtml((control.value as string) || '') }}
    />
  );
};

export const HintControl: ControlComponent = ({ control, onAction }) => {
  const forGroup = control.forGroup as string | undefined;
  if (forGroup) {
    const collapsed = control.collapsed as boolean;
    const collapseKey = control.collapseKey as string;
    const path = control.path as string;
    return (
      <span
        className="hint-group-toggle"
        style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        onClick={() => onAction('ToggleGroupExpand', { navpath: path, option1: collapseKey })}
      >
        {collapsed ? <CaretRightOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
        <span className="hint-text">{control.value as string}</span>
      </span>
    );
  }
  // A hint used as a top-prompt / column header carries its legacy styling via
  // contentClass (control.cls) — e.g. `section_header` centers the text (the
  // "middle of the fields" look) and applies the header chrome — and/or
  // contentStyle (control.style, e.g. text-align). Both were dropped before, so
  // header hints collapsed to plain left-aligned text (SXADV-5472). Render as a
  // block filling the cell so text-align in those styles actually centers.
  const value = control.value as string | undefined;
  // Blank content (empty or whitespace-only, e.g. a spacer `content=" "`) must
  // NOT get the header class/style, or it renders as an empty blue box. Keep the
  // spaces so the cell still reserves its width.
  if (!value || value.trim() === '') {
    return <span className="hint-text" style={{ display: 'block', width: '100%' }}>{value}</span>;
  }
  const cls = control.cls as string | undefined;
  const style = parseInlineStyle(control.style as string | undefined);
  return (
    <span
      className={cls || 'hint-text'}
      style={{ display: 'block', width: '100%', ...style }}
    >
      {value}
    </span>
  );
};

export const HighlightControl: ControlComponent = ({ control }) => (
  <strong className="highlight-text">{control.value as string}</strong>
);

export const WarningControl: ControlComponent = ({ control }) => {
  const warningHtml = control.html as string | undefined;
  if (!warningHtml) return null;
  return (
    <div className="warning-control" style={{
      display: 'flex', gap: 10, padding: '8px 12px',
      background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8,
      lineHeight: 1.4, fontSize: 13,
    }}>
      <span style={{ fontSize: 16, color: '#faad14', flexShrink: 0, lineHeight: '20px' }}>&#9888;</span>
      <div dangerouslySetInnerHTML={{ __html: fixServerHtml(warningHtml) }} />
    </div>
  );
};
