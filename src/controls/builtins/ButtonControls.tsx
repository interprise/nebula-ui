import { Button, Upload } from 'antd';
import { SearchOutlined, PlusOutlined, UploadOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';

export const ButtonControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    disabled={control.disabled}
    icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
    onClick={() => control.action && onAction(control.action)}
    title={control.hint}
  >
    {control.prompt}
  </Button>
);

export const ActionControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    type="link"
    disabled={control.disabled}
    onClick={() => control.action && onAction(control.action)}
  >
    {control.prompt}
  </Button>
);

export const WindowButtonControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    disabled={control.disabled}
    icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
    onClick={() => {
      if (control.openWin) {
        window.open(`/entrasp/controller?action=${control.action}`, '_blank');
      } else {
        control.action && onAction(control.action);
      }
    }}
    title={control.hint}
  >
    {control.prompt}
  </Button>
);

export const LookupControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    size="small"
    icon={<SearchOutlined />}
    disabled={control.disabled}
    onClick={() => control.action && onAction(control.action)}
    title={control.hint}
  />
);

export const NavigateViewControl: ControlComponent = ({ control, onAction }) => (
  <span
    id={control.id}
    className="navigate-view-link"
    style={{ cursor: 'pointer', color: '#1677ff', whiteSpace: 'nowrap', marginRight: 12 }}
    title={control.hint}
    onClick={() => control.action && onAction(control.action, {
      navpath: control.navpath as string,
      option1: control.name as string,
    })}
  >
    <LinkOutlined style={{ marginRight: 4, fontSize: 12 }} />
    {control.prompt as string}
  </span>
);

export const AddControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    size="small"
    icon={<PlusOutlined />}
    disabled={control.disabled}
    onClick={() => control.action && onAction(control.action)}
    title={control.hint}
  />
);

export const UploadControl: ControlComponent = ({ control }) => {
  const isDisabled = !!control.disabled || control.editable === false;
  return (
    <Upload
      beforeUpload={() => false}
      maxCount={1}
      disabled={isDisabled}
    >
      <Button icon={<UploadOutlined />}>Upload</Button>
    </Upload>
  );
};

export const DownloadControl: ControlComponent = ({ control, onAction }) => (
  <Button
    id={control.id}
    icon={<DownloadOutlined />}
    onClick={() => control.action && onAction(control.action)}
    title={control.hint}
  >
    {control.prompt || 'Download'}
  </Button>
);
