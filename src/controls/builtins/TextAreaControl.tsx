import { Input } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue } from '../helpers';
import { withPostDecorations } from '../decorations';

const TextAreaControl: ControlComponent = ({ control, pageType, onChange, onAction }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  // Controlled + re-synced from control.value, like every other text control.
  // An uncontrolled `defaultValue` is only read at mount, and the control's
  // React key is the field id (stable across records), so React reused the
  // same instance on record navigation and the field kept showing the previous
  // record's text (SXADV-5527). useSyncedValue re-applies control.value when a
  // server round-trip (record navigation, reload) changes it.
  const [value, setValue] = useSyncedValue(control.value);
  const minRows = control.rows || 3;
  const contentLines = value.split('\n').length;
  const rows = Math.max(minRows, Math.min(contentLines + 1, 30));
  return withPostDecorations(
    <Input.TextArea
      {...commonProps}
      value={value}
      rows={rows}
      style={{ width: '100%', maxHeight: '50vh', resize: 'vertical' }}
      onChange={(e) => {
        setValue(e.target.value);
        store(e.target.value);
      }}
      onBlur={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default TextAreaControl;
