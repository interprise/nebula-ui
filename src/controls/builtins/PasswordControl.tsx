import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue, getTextMaxWidth } from '../helpers';
import { withPostDecorations } from '../decorations';

const PasswordControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  const commonProps = useCommonProps(control, value); // SXADV-5754.2
  const textMaxWidth = getTextMaxWidth(control);
  return withPostDecorations(
    <Input.Password
      {...commonProps}
      value={value}
      style={{ width: textMaxWidth, maxWidth: '100%', ...commonProps.style }}
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
