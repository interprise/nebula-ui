import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, getTextMaxWidth } from '../helpers';

const PasswordControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const textMaxWidth = getTextMaxWidth(control);
  return (
    <Input.Password
      {...commonProps}
      value={control.value as string}
      style={{ width: '100%', maxWidth: textMaxWidth }}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
};

export default PasswordControl;
