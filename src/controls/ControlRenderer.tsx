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
  PhoneOutlined,
  MobileOutlined,
  MailOutlined,
  PrinterOutlined,
  DeleteOutlined,
  HomeOutlined,
  DollarOutlined,
  ToolOutlined,
  ShoppingOutlined,
  CarOutlined,
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <InputNumber
            {...commonProps}
            value={value as number}
            precision={control.decimals}
            prefix={type === 'money' ? (control.currencySymbol || '€') : undefined}
            style={{ width: control.size ? control.size * 8 + 32 : 120 }}
            onChange={handleChange}
          />
          {(control as Record<string, unknown>).unitSuffix && (
            <span className="unit-suffix">{(control as Record<string, unknown>).unitSuffix as string}</span>
          )}
        </span>
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

    // --- EntrAsp custom controls ---

    case 'contatti': {
      const contacts = (control as Record<string, unknown>).contacts as Array<Record<string, unknown>> | undefined;
      if (!contacts || contacts.length === 0) return null;
      return (
        <div className="contatti-list">
          {contacts.map((c, i) => (
            <div key={i} className="contatto-row" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 500, marginRight: 8 }}>
                {c.flagDefault && <HomeOutlined title="Principale" style={{ marginRight: 2 }} />}
                {c.flagAmministrazione && <DollarOutlined title="Amministrazione" style={{ marginRight: 2 }} />}
                {c.flagTecnico && <ToolOutlined title="Tecnico" style={{ marginRight: 2 }} />}
                {c.flagCommerciale && <ShoppingOutlined title="Commerciale" style={{ marginRight: 2 }} />}
                {c.flagSpedizione && <CarOutlined title="Logistica" style={{ marginRight: 2 }} />}
                {c.name as string}:
              </span>
              {(c.phone || c.phone2) && <span style={{ marginRight: 8 }}><PhoneOutlined /> {c.phone as string}{c.phone2 ? ` / ${c.phone2}` : ''}</span>}
              {(c.mobile || c.mobile2) && <span style={{ marginRight: 8 }}><MobileOutlined /> {c.mobile as string}{c.mobile2 ? ` / ${c.mobile2}` : ''}</span>}
              {(c.fax || c.fax2) && <span style={{ marginRight: 8 }}><PrinterOutlined /> {c.fax as string}{c.fax2 ? ` / ${c.fax2}` : ''}</span>}
              {(c.email || c.email2) && <span><MailOutlined /> {c.email as string}{c.email2 ? ` / ${c.email2}` : ''}</span>}
            </div>
          ))}
        </div>
      );
    }

    case 'reportBar': {
      const reports = (control as Record<string, unknown>).reports as Array<{ value: string; text: string }> | undefined;
      const selected = (control as Record<string, unknown>).selected as string;
      if (!reports || reports.length === 0) return null;
      return (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {reports.length > 1 && (
            <Select
              size="small"
              defaultValue={selected}
              style={{ minWidth: 200 }}
              options={reports.map((r) => ({ value: r.value, label: r.text }))}
              onChange={(val) => onChange('$ReportBarItem', val)}
            />
          )}
          <Button size="small" icon={<PrinterOutlined />} onClick={() => onAction('ExecuteBarReport')}>PDF</Button>
          <Button size="small" icon={<MailOutlined />} onClick={() => onAction('EmailBarReport')}>Email</Button>
        </span>
      );
    }

    case 'allegati': {
      const files = (control as Record<string, unknown>).files as Array<{ key: string; fileName: string }> | undefined;
      return (
        <div>
          {control.editable && (
            <Upload beforeUpload={() => false} maxCount={1}>
              <Button size="small" icon={<UploadOutlined />}>Allega</Button>
            </Upload>
          )}
          {files && files.map((f) => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <a onClick={() => onAction('EmailAllegatiDownload', { option1: f.key })} style={{ cursor: 'pointer' }}>{f.fileName}</a>
              {control.editable && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onAction('EmailAllegatiDelete', { option1: f.key })} />
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'varianti': {
      const variants = (control as Record<string, unknown>).variants as Array<{
        code: string; seq: string; description: string; value: string;
        options: Array<{ value: string; text: string }>;
      }> | undefined;
      if (!variants || variants.length === 0) return null;
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 8px', alignItems: 'center' }}>
          {variants.map((v) => (
            <React.Fragment key={v.code}>
              <span className="prompt-cell">{v.description}:</span>
              <Select
                size="small"
                value={v.value}
                style={{ minWidth: 120 }}
                disabled={!control.editable}
                options={v.options.map((o) => ({ value: o.value, label: o.text }))}
                onChange={(val) => onChange(`${fieldName}.${v.seq}`, val)}
              />
            </React.Fragment>
          ))}
        </div>
      );
    }

    case 'array': {
      const values = (control as Record<string, unknown>).values as string[] | undefined;
      if (!values) return null;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {values.map((v, i) => (
            <Input
              key={i}
              size="small"
              value={v}
              disabled={!control.editable}
              maxLength={control.maxLength}
              style={{ width: Math.min((control.maxLength || 20) * 9, 200) }}
              onChange={(e) => onChange(`${fieldName}.${i}`, e.target.value)}
            />
          ))}
        </div>
      );
    }

    // Complex custom controls - basic fallback rendering
    case 'ruoli':
    case 'sottoconti':
    case 'partitario':
    case 'disponibilita':
    case 'assegnazioni':
    case 'cdmsClass':
    case 'consuntivazione':
    case 'gestorePrivilegi':
    case 'lgtcCalendario':
    case 'lgtcMap':
    case 'richOffAtt':
    case 'gantt':
    case 'promptbuilder':
      return (
        <div className="custom-control-placeholder" style={{ padding: 4, color: '#999', fontStyle: 'italic' }}>
          [{type}] {value != null ? String(value) : ''}
        </div>
      );

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
