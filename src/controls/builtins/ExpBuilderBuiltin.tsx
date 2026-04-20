import type { ControlComponent } from '../types';
import { useControlChange, getFieldName } from '../helpers';
import ExpBuilderControl from '../ExpBuilderControl';

const ExpBuilderBuiltin: ControlComponent = ({ control, onAction, onChange }) => {
  const handleChange = useControlChange(control, onChange, onAction);
  const isDisabled = !!control.disabled || control.editable === false;
  const fieldName = getFieldName(control);
  return (
    <ExpBuilderControl
      key={control.id || fieldName}
      control={control}
      disabled={isDisabled}
      onChange={handleChange}
    />
  );
};

export default ExpBuilderBuiltin;
