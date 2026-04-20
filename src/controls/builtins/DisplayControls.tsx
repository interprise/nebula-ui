import { Input } from 'antd';
import { BarcodeOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange } from '../helpers';

export const BarcodeControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <Input
      {...commonProps}
      value={control.value as string}
      prefix={<BarcodeOutlined />}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
};

export const UrlControl: ControlComponent = ({ control }) => (
  <a href={control.value as string} target="_blank" rel="noopener noreferrer">
    {control.displayValue || (control.value as string)}
  </a>
);

export const HtmlControl: ControlComponent = ({ control }) => (
  <span dangerouslySetInnerHTML={{ __html: (control.value as string) || '' }} />
);

export const HtmlFormatControl: ControlComponent = ({ control }) => (
  <span
    className={(control.cls as string) || ''}
    dangerouslySetInnerHTML={{ __html: (control.value as string) || '' }}
  />
);

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
  return <span className="hint-text">{control.value as string}</span>;
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
      <div dangerouslySetInnerHTML={{ __html: warningHtml }} />
    </div>
  );
};
