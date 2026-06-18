import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, getFieldName } from '../helpers';

const TextAreaControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const fieldName = getFieldName(control);
  const value = control.value;
  const minRows = control.rows || 3;
  const contentLines = typeof value === 'string' ? value.split('\n').length : 0;
  const rows = Math.max(minRows, Math.min(contentLines + 1, 30));
  return (
    <Input.TextArea
      key={control.id || fieldName}
      {...commonProps}
      defaultValue={value as string}
      rows={rows}
      style={{ width: '100%', maxHeight: '50vh', resize: 'vertical' }}
      onChange={(e) => store(e.target.value)}
      onBlur={commit}
    />
  );
};

export default TextAreaControl;
