import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue, getTextMaxWidth } from '../helpers';
import { withPostDecorations } from '../decorations';

const TextControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  const textMaxWidth = getTextMaxWidth(control);
  const isUppercase = !!control.uppercase;
  return withPostDecorations(
    <Input
      {...commonProps}
      value={value}
      maxLength={control.maxLength}
      // contentStyle per ultimo: quello che la view chiede vince (SXADV-5734).
      style={{ width: textMaxWidth, maxWidth: '100%', ...(isUppercase && { textTransform: 'uppercase' }), ...commonProps.style }}
      onChange={(e) => {
        // Show the raw keystrokes (CSS uppercases visually) so the caret
        // never jumps; store the uppercased value for the server.
        setValue(e.target.value);
        store(isUppercase ? e.target.value.toUpperCase() : e.target.value);
      }}
      onBlur={commit}
      onPressEnter={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default TextControl;
