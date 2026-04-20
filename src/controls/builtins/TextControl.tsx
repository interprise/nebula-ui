import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, getTextMaxWidth } from '../helpers';
import { withPostDecorations } from '../decorations';

const TextControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const textMaxWidth = getTextMaxWidth(control);
  const isUppercase = !!control.uppercase;
  return withPostDecorations(
    <Input
      {...commonProps}
      value={control.value as string}
      maxLength={control.maxLength}
      style={{ width: '100%', maxWidth: textMaxWidth, ...(isUppercase && { textTransform: 'uppercase' }) }}
      onChange={(e) => handleChange(isUppercase ? e.target.value.toUpperCase() : e.target.value)}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default TextControl;
