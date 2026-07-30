import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue, getTextMaxWidth } from '../helpers';
import { withPostDecorations } from '../decorations';

const PasswordControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  const textMaxWidth = getTextMaxWidth(control);
  return withPostDecorations(
    <Input.Password
      {...commonProps}
      value={value}
      style={{ width: '100%', maxWidth: textMaxWidth }}
      onChange={(e) => { setValue(e.target.value); store(e.target.value); }}
      onBlur={commit}
      onPressEnter={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default PasswordControl;
