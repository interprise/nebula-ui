import React, { useCallback } from 'react';
import {
  Input,
  InputNumber,
  Select,
  DatePicker,
  TimePicker,
  Checkbox,
  Button,
  Upload,
  Switch,
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  DownloadOutlined,
  UploadOutlined,
  BarcodeOutlined,
} from '@ant-design/icons';
import type { UIControl } from '../types/ui';
import dayjs from 'dayjs';

interface ControlRendererProps {
  control: UIControl;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

const ControlRenderer: React.FC<ControlRendererProps> = ({ control, onAction, onChange }) => {
  const { type, name, editable, value, hint, mandatory, disabled } = control;
  const readOnly = editable === false;
  const fieldName = name || control.id || '';

  const handleChange = useCallback(
    (val: unknown) => {
      onChange(fieldName, val);
      if (control.reload) {
        onAction(control.reload.action, {
          navpath: control.reload.navpath || '',
          option1: control.reload.option1 || '',
          option2: control.reload.option2 || '',
        });
      }
    },
    [fieldName, onChange, onAction, control.reload]
  );

  const commonProps = {
    id: control.id,
    title: hint,
    disabled: disabled || readOnly,
    status: mandatory && !value ? ('error' as const) : undefined,
  };

  switch (type) {
    case 'text':
      return (
        <Input
          {...commonProps}
          value={value as string}
          maxLength={control.maxLength}
          style={control.size ? { width: control.size * 8 + 16 } : undefined}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'number':
    case 'money':
      return (
        <InputNumber
          {...commonProps}
          value={value as number}
          precision={control.decimals}
          prefix={type === 'money' ? (control.currencySymbol || '€') : undefined}
          style={{ width: control.size ? control.size * 8 + 32 : 120 }}
          onChange={handleChange}
        />
      );

    case 'date':
      return (
        <DatePicker
          {...commonProps}
          value={value ? dayjs(value as string, control.format || 'DD/MM/YYYY') : null}
          format={control.format || 'DD/MM/YYYY'}
          onChange={(_d, dateStr) => handleChange(dateStr)}
        />
      );

    case 'time':
      return (
        <TimePicker
          {...commonProps}
          value={value ? dayjs(value as string, 'HH:mm') : null}
          format="HH:mm"
          onChange={(_t, timeStr) => handleChange(timeStr)}
        />
      );

    case 'timestamp':
      return (
        <DatePicker
          {...commonProps}
          showTime
          value={value ? dayjs(value as string, control.format || 'DD/MM/YYYY HH:mm') : null}
          format={control.format || 'DD/MM/YYYY HH:mm'}
          onChange={(_d, dateStr) => handleChange(dateStr)}
        />
      );

    case 'durata':
      return (
        <Input
          {...commonProps}
          value={value as string}
          placeholder={control.format}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'boolean':
      return (
        <Checkbox
          id={control.id}
          checked={value === true || value === 'true' || value === '1'}
          disabled={commonProps.disabled}
          onChange={(e) => handleChange(e.target.checked)}
        />
      );

    case 'checkbox':
      return (
        <Switch
          id={control.id}
          checked={value === true || value === 'true' || value === '1'}
          disabled={commonProps.disabled}
          onChange={handleChange}
        />
      );

    case 'combo':
      if (control.remote) {
        return (
          <Select
            {...commonProps}
            value={value as string}
            showSearch
            filterOption={false}
            style={{ width: '100%' }}
            onChange={handleChange}
            onSearch={(searchText) => {
              onAction('ListFilter', {
                option1: fieldName,
                option2: searchText,
              });
            }}
          />
        );
      }
      return (
        <Select
          {...commonProps}
          value={value as string}
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          onChange={handleChange}
          options={(control.options || []).map((o) => ({
            value: o.value,
            label: o.text,
          }))}
        />
      );

    case 'multiselect':
      return (
        <Select
          {...commonProps}
          mode="multiple"
          value={value as string[]}
          style={{ width: '100%' }}
          onChange={handleChange}
          options={(control.options || []).map((o) => ({
            value: o.value,
            label: o.text,
          }))}
        />
      );

    case 'textarea':
      return (
        <Input.TextArea
          {...commonProps}
          value={value as string}
          rows={control.rows || 3}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'password':
      return (
        <Input.Password
          {...commonProps}
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'htmlarea':
      return (
        <Input.TextArea
          {...commonProps}
          value={value as string}
          rows={control.rows || 6}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'button':
      return (
        <Button
          id={control.id}
          disabled={control.disabled}
          icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
          onClick={() => control.action && onAction(control.action)}
          title={hint}
        >
          {control.prompt}
        </Button>
      );

    case 'action':
      return (
        <Button
          id={control.id}
          type="link"
          disabled={control.disabled}
          onClick={() => control.action && onAction(control.action)}
        >
          {control.prompt}
        </Button>
      );

    case 'windowButton':
      return (
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
          title={hint}
        >
          {control.prompt}
        </Button>
      );

    case 'lookup':
    case 'navigateView':
      return (
        <Button
          id={control.id}
          size="small"
          icon={<SearchOutlined />}
          disabled={control.disabled}
          onClick={() => control.action && onAction(control.action)}
          title={hint}
        />
      );

    case 'add':
      return (
        <Button
          id={control.id}
          size="small"
          icon={<PlusOutlined />}
          disabled={control.disabled}
          onClick={() => control.action && onAction(control.action)}
          title={hint}
        />
      );

    case 'upload':
      return (
        <Upload
          beforeUpload={() => false}
          maxCount={1}
          disabled={commonProps.disabled}
        >
          <Button icon={<UploadOutlined />}>Upload</Button>
        </Upload>
      );

    case 'download':
      return (
        <Button
          id={control.id}
          icon={<DownloadOutlined />}
          onClick={() => control.action && onAction(control.action)}
          title={hint}
        >
          {control.prompt || 'Download'}
        </Button>
      );

    case 'barcode':
      return (
        <Input
          {...commonProps}
          value={value as string}
          prefix={<BarcodeOutlined />}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'url':
      return (
        <a href={value as string} target="_blank" rel="noopener noreferrer">
          {control.displayValue || (value as string)}
        </a>
      );

    case 'html':
      return <span dangerouslySetInnerHTML={{ __html: (value as string) || '' }} />;

    case 'hint':
      return <span className="hint-text">{value as string}</span>;

    case 'highlight':
      return <strong className="highlight-text">{value as string}</strong>;

    default:
      return (
        <Input
          {...commonProps}
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
        />
      );
  }
};

export default ControlRenderer;
