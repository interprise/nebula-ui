import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, getFieldName } from '../helpers';

/** Placeholder rich-text editor — currently a plain textarea with a subtle
 *  indicator that content is HTML. Replace with a real editor (CKEditor 5 /
 *  TipTap / react-quill) once a dependency is chosen. */
const HtmlAreaControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const fieldName = getFieldName(control);
  const value = control.value;
  const minRows = control.rows || 6;
  const contentLines = typeof value === 'string' ? value.split('\n').length : 0;
  const rows = Math.max(minRows, Math.min(contentLines + 1, 30));
  return (
    <div style={{ width: '100%' }}>
      <Input.TextArea
        key={control.id || fieldName}
        {...commonProps}
        defaultValue={value as string}
        rows={rows}
        style={{ width: '100%', maxHeight: '50vh', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
        onChange={(e) => handleChange(e.target.value)}
      />
      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
        Editor HTML (rich text non ancora integrato)
      </div>
    </div>
  );
};

export default HtmlAreaControl;
