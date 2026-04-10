import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getCustomControl } from './customControls';
import {
  Input,
  InputNumber,
  Select,
  DatePicker,
  TimePicker,
  Checkbox,
  Button,
  Upload,
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
  CaretRightOutlined,
  CaretDownOutlined,
  LinkOutlined,
  StarFilled,
  OrderedListOutlined,
  FileSearchOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons';
import type { UIControl } from '../types/ui';
import { SidContext, PathContext } from '../components/ViewRenderer';
import * as api from '../services/api';
import dayjs from 'dayjs';

// Convert Java date format (dd/MM/yyyy) to dayjs format (DD/MM/YYYY)
function javaToDayjsFormat(fmt: string | undefined): string | undefined {
  if (!fmt) return undefined;
  return fmt.replace(/dd/g, 'DD').replace(/yyyy/g, 'YYYY').replace(/yy/g, 'YY');
}

// Decode HTML entities like &#x20AC; → €
function decodeHtmlEntities(s: string): string {
  const el = document.createElement('span');
  el.innerHTML = s;
  return el.textContent || s;
}

// Money/number input: shows currency symbol only when blurred and value is non-empty
const MoneyInput: React.FC<{
  commonProps: Record<string, unknown>;
  value: unknown;
  decimals?: number;
  currencySymbol?: string;
  unitSuffix?: unknown;
  width: number;
  onChange: (val: unknown) => void;
}> = ({ commonProps, value, decimals, currencySymbol, unitSuffix, width, onChange }) => {
  const [focused, setFocused] = useState(false);
  const symbol = currencySymbol !== undefined ? decodeHtmlEntities(String(currencySymbol || '€')) : undefined;
  const showPrefix = symbol && !focused && value != null && value !== '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <InputNumber
        {...commonProps}
        value={value as number}
        precision={decimals}
        prefix={showPrefix ? symbol : undefined}
        placeholder={symbol || undefined}
        style={{ width }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={onChange}
      />
      {!!unitSuffix && (
        <span className="unit-suffix">{String(unitSuffix)}</span>
      )}
    </span>
  );
};

// Separate component for boolean/checkbox — needs local state since
// handleFieldChange in Shell only updates a ref (no re-render).
const BooleanControl: React.FC<{
  control: UIControl;
  isQuery: boolean;
  isDisabled: boolean;
  handleChange: (val: unknown) => void;
}> = ({ control, isQuery, isDisabled, handleChange }) => {
  const serverVal = control.value;
  const toBool = (v: unknown) => v === true || v === 'true' || v === '1';
  const toNull = (v: unknown) => v === null || v === undefined || v === '';

  const [localVal, setLocalVal] = useState(serverVal);
  useEffect(() => { setLocalVal(serverVal); }, [serverVal]);

  const boolVal = toBool(localVal);
  const isNull = toNull(localVal);

  if (isQuery) {
    // Tri-state: null (indeterminate) → true → false → null
    const handleTriState = () => {
      let next: unknown;
      if (isNull) next = true;
      else if (boolVal) next = false;
      else next = null;
      setLocalVal(next);
      handleChange(next);
    };
    return (
      <Checkbox
        id={control.id}
        checked={!isNull && boolVal}
        indeterminate={isNull}
        disabled={isDisabled}
        onChange={handleTriState}
      />
    );
  }

  return (
    <Checkbox
      id={control.id}
      checked={boolVal}
      disabled={isDisabled}
      onChange={(e) => {
        setLocalVal(e.target.checked);
        handleChange(e.target.checked);
      }}
    />
  );
};

// Workflow state pill — consistent color derived from state name
export const WorkflowPill: React.FC<{ state: string; prevState?: string }> = ({ state, prevState }) => {
  // Hash string to a hue (0-360)
  let hash = 0;
  for (let i = 0; i < state.length; i++) {
    hash = state.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  const bg = `hsl(${hue}, 55%, 45%)`;
  // Luminance check: HSL lightness 45% with medium saturation → always use white text
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        background: bg,
        color: '#fff',
        fontWeight: 600,
        fontSize: 12,
        padding: '2px 12px',
        borderRadius: 12,
        whiteSpace: 'nowrap',
        letterSpacing: 0.3,
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>
        {state}
      </span>
      {prevState && (
        <span style={{ fontSize: 11, color: '#999' }}>
          da {prevState}
        </span>
      )}
    </span>
  );
};

// Remote combo (ListUIControl) — fetches options from server as user types
const RemoteCombo: React.FC<{
  control: UIControl;
  commonProps: Record<string, unknown>;
  value: unknown;
  maxWidth?: number;
  onChange: (val: unknown) => void;
}> = ({ control, commonProps, value, maxWidth, onChange }) => {
  const sid = useContext(SidContext);
  const displayText = control.displayText as string | undefined;
  const navpath = control.navpath as string;
  const controlName = control.controlName as string || control.name || '';

  // Start with the current value as the only option
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    value ? [{ value: value as string, label: displayText || (value as string) }] : []
  );
  const [fetching, setFetching] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Update options when server sends new value
  useEffect(() => {
    if (value) {
      setOptions(prev => {
        const exists = prev.some(o => o.value === value);
        if (exists) return prev;
        return [{ value: value as string, label: displayText || (value as string) }, ...prev];
      });
    }
  }, [value, displayText]);

  const loadedRef = useRef(false);

  const fetchOptions = useCallback(async (query: string) => {
    setFetching(true);
    try {
      const results = await api.fetchComboOptions(navpath, controlName, query, sid);
      setOptions(results.map(r => ({ value: r.value, label: r.text })));
    } catch {
      // keep existing options on error
    } finally {
      setFetching(false);
      setHasFetched(true);
    }
  }, [navpath, controlName, sid]);

  const handleSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query), 300);
  }, [fetchOptions]);

  const handleDropdownOpen = useCallback((open: boolean) => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      fetchOptions('');
    }
  }, [fetchOptions]);

  return (
    <Select
      {...commonProps}
      value={value as string || undefined}
      showSearch
      filterOption={false}
      loading={fetching}
      notFoundContent={fetching ? 'Caricamento...' : (hasFetched ? 'Nessun risultato' : null)}
      onDropdownVisibleChange={handleDropdownOpen}
      style={{ width: '100%', ...(maxWidth && { maxWidth }) }}
      options={options}
      onSearch={handleSearch}
      onChange={onChange}
    />
  );
};

interface ControlRendererProps {
  control: UIControl;
  pageType?: number; // 0=QUERY, 1=LIST, 2=DETAIL
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

/** Wraps a control with post-decoration icons/widgets matching the Java addPostDecoration() output */
const withPostDecorations = (
  element: React.ReactNode,
  control: UIControl,
  pageType: number | undefined,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange?: (name: string, value: unknown) => void,
): React.ReactNode => {
  const nav = control.navigateView as { command: string; navpath: string; controlName: string } | undefined;
  const add = control.navigateAdd as { command: string; navpath: string; controlName: string } | undefined;
  const hasLookup = control.editable && control.lookupViewName && control.navigateLookupCommand;
  const isMandatoryIcon = control.mandatory && control.editable
    && control.type !== 'boolean' && control.type !== 'checkbox';
  const hasNegation = control.negation && pageType === 0; // QUERY page
  const postPrompt = control.postPrompt;

  const hasDecorations = nav || add || hasLookup || isMandatoryIcon || hasNegation || postPrompt;
  if (!hasDecorations) return element;

  const fieldName = control.name || control.id || '';
  return (
    <span className="post-decorations">
      {hasNegation && (
        <span className="negation-box">
          <span className="negation-label">not</span>
          <Checkbox
            checked={!!control.negationValue}
            onChange={(e) => onChange?.(fieldName + '$not', e.target.checked ? '1' : '')}
          />
        </span>
      )}
      {element}
      {postPrompt && <span className="post-prompt">{postPrompt}</span>}
      {isMandatoryIcon && (
        control.mandatoryIcon === 'sequence'
          ? <OrderedListOutlined className="mandatory-icon" title="Obbligatorio (sequenza)" />
          : <StarFilled className="mandatory-icon" title="Obbligatorio" />
      )}
      {nav && (
        <LinkOutlined
          className="nav-icon"
          title="Apri dettaglio"
          onClick={() => onAction(nav.command, { navpath: nav.navpath, option1: nav.controlName })}
        />
      )}
      {hasLookup && (
        <FileSearchOutlined
          className="lookup-icon"
          title="Ricerca"
          onClick={() => onAction(control.navigateLookupCommand!, { option1: fieldName })}
        />
      )}
      {add && (
        <PlusOutlined
          className="add-icon"
          title="Nuovo"
          onClick={() => onAction(add.command, { navpath: add.navpath, option1: add.controlName })}
        />
      )}
    </span>
  );
};

const ControlRenderer: React.FC<ControlRendererProps> = ({ control, pageType, onAction, onChange }) => {
  const { type, name, editable, value, hint, mandatory, disabled } = control;
  const viewPath = useContext(PathContext);

  // Wrap onAction to always include navpath from the current view context
  const doAction = useCallback((action: string, params?: Record<string, string>) => {
    const p = { ...params };
    if (viewPath && !p.navpath) p.navpath = viewPath;
    onAction(action, p);
  }, [onAction, viewPath]);

  // No controlled open — let Ant Design handle combo open/close natively
  // Editability is decided server-side (ViewItem.isEditable) and sent as the `editable` flag.
  // The frontend simply uses it: non-editable controls are disabled.
  const isDisabled = !!disabled || editable === false;
  const fieldName = name || control.id || '';

  const handleChange = useCallback(
    (val: unknown) => {
      onChange(fieldName, val);
      // Server sends reload trigger as a string, with command/navpath/option1 as separate fields
      if (control.reload) {
        const command = (control.command as string) || 'Post';
        const navpath = (control.navpath as string) || '';
        const option1 = (control.option1 as string) || '';
        doAction(command, { navpath, option1 });
      }
    },
    [fieldName, onChange, doAction, control.reload, control.command, control.navpath, control.option1]
  );

  const commonProps = {
    id: control.id,
    title: hint,
    disabled: isDisabled,
    status: mandatory && !value ? ('error' as const) : undefined,
  };

  // Check custom control registry before built-in types
  const CustomControl = type ? getCustomControl(type) : undefined;
  if (CustomControl) {
    return <CustomControl control={control} pageType={pageType} onAction={doAction} onChange={onChange} />;
  }

  // Cap text field width based on server size, with a max of 500px
  const textMaxWidth = control.size ? Math.min(control.size * 8 + 16, 500) : 500;

  switch (type) {
    case 'text': {
      const isUppercase = !!control.uppercase;
      return withPostDecorations(
        <Input
          {...commonProps}
          value={value as string}
          maxLength={control.maxLength}
          style={{ width: '100%', maxWidth: textMaxWidth, ...(isUppercase && { textTransform: 'uppercase' }) }}
          onChange={(e) => handleChange(isUppercase ? e.target.value.toUpperCase() : e.target.value)}
        />,
        control,
        pageType,
        doAction,
        onChange,
      );
    }

    case 'number':
    case 'money':
      return (
        <MoneyInput
          commonProps={commonProps}
          value={value}
          decimals={control.decimals}
          currencySymbol={type === 'money' ? (control.currencySymbol as string) : undefined}
          unitSuffix={control.unitSuffix}
          width={control.size ? control.size * 9 + 34 : 125}
          onChange={handleChange}
        />
      );

    case 'date': {
      const dateFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY';
      return (
        <DatePicker
          {...commonProps}
          value={value ? dayjs(value as string, dateFmt) : null}
          format={dateFmt}
          style={{ minWidth: 96 }}
          onChange={(_d, dateStr) => handleChange(dateStr)}
        />
      );
    }

    case 'time':
      return (
        <TimePicker
          {...commonProps}
          value={value ? dayjs(value as string, 'HH:mm') : null}
          format="HH:mm"
          style={{ minWidth: 95 }}
          onChange={(_t, timeStr) => handleChange(timeStr)}
        />
      );

    case 'timestamp': {
      const tsFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm';
      return (
        <DatePicker
          {...commonProps}
          showTime
          value={value ? dayjs(value as string, tsFmt) : null}
          format={tsFmt}
          style={{ minWidth: 170 }}
          onChange={(_d, dateStr) => handleChange(dateStr)}
        />
      );
    }

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
    case 'checkbox':
      return (
        <BooleanControl
          control={control}
          isQuery={pageType === 0}
          isDisabled={isDisabled}
          handleChange={handleChange}
        />
      );

    case 'combo': {
      if (control.remote) {
        return withPostDecorations(
          <RemoteCombo
            control={control}
            commonProps={commonProps}
            value={value}
            maxWidth={textMaxWidth}
            onChange={handleChange}
          />,
          control,
          onAction,
        );
      }
      return withPostDecorations(
        <Select
          {...commonProps}

          value={(value as string) || undefined}
          showSearch
          optionFilterProp="label"
          allowClear
          style={{ width: '100%', maxWidth: textMaxWidth }}
          onChange={handleChange}
          options={(control.options || []).map((o) => ({
            value: o.value,
            label: o.text,
          }))}
        />,
        control,
        pageType,
        doAction,
        onChange,
      );
    }

    case 'multiselect':
      return (
        <Select
          {...commonProps}
          mode="multiple"
          value={value as string[]}
          style={{ width: '100%', maxWidth: textMaxWidth }}
          onChange={handleChange}
          options={(control.options || []).map((o) => ({
            value: o.value,
            label: o.text,
          }))}
        />
      );

    case 'textarea':
    case 'htmlarea':
    case 'expBuilder': {
      const taSize = Number(control.size) || 0;
      const taWidth = taSize > 0 ? taSize * 8 + 16 : undefined;
      const minRows = control.rows || 3;
      const contentLines = typeof value === 'string' ? value.split('\n').length : 0;
      const rows = Math.max(minRows, Math.min(contentLines + 1, 30));
      return (
        <Input.TextArea
          key={control.id || fieldName}
          {...commonProps}
          defaultValue={value as string}
          rows={rows}
          style={{ width: '100%', maxHeight: '50vh', resize: 'vertical' }}
          onChange={(e) => handleChange(e.target.value)}
        />
      );
    }

    case 'password':
      return (
        <Input.Password
          {...commonProps}
          value={value as string}
          style={{ width: '100%', maxWidth: textMaxWidth }}
          onChange={(e) => handleChange(e.target.value)}
        />
      );

    case 'button':
      return (
        <Button
          id={control.id}
          disabled={control.disabled}
          icon={control.icon ? <img src={`/entrasp/images/${control.icon}`} width={16} height={16} /> : undefined}
          onClick={() => control.action && doAction(control.action)}
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
          onClick={() => control.action && doAction(control.action)}
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
              control.action && doAction(control.action);
            }
          }}
          title={hint}
        >
          {control.prompt}
        </Button>
      );

    case 'lookup':
      return (
        <Button
          id={control.id}
          size="small"
          icon={<SearchOutlined />}
          disabled={control.disabled}
          onClick={() => control.action && doAction(control.action)}
          title={hint}
        />
      );

    case 'navigateView':
      return (
        <span
          id={control.id}
          className="navigate-view-link"
          style={{ cursor: 'pointer', color: '#1677ff', whiteSpace: 'nowrap', marginRight: 12 }}
          title={hint}
          onClick={() => control.action && doAction(control.action, {
            navpath: control.navpath as string,
            option1: control.name as string,
          })}
        >
          <LinkOutlined style={{ marginRight: 4, fontSize: 12 }} />
          {control.prompt as string}
        </span>
      );

    case 'add':
      return (
        <Button
          id={control.id}
          size="small"
          icon={<PlusOutlined />}
          disabled={control.disabled}
          onClick={() => control.action && doAction(control.action)}
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
          onClick={() => control.action && doAction(control.action)}
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

    case 'hint': {
      const forGroup = control.forGroup as string | undefined;
      if (forGroup) {
        const collapsed = control.collapsed as boolean;
        const collapseKey = control.collapseKey as string;
        const path = control.path as string;
        return (
          <span
            className="hint-group-toggle"
            style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => doAction('ToggleGroupExpand', { navpath: path, option1: collapseKey })}
          >
            {collapsed ? <CaretRightOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
            <span className="hint-text">{value as string}</span>
          </span>
        );
      }
      return <span className="hint-text">{value as string}</span>;
    }

    case 'highlight':
      return <strong className="highlight-text">{value as string}</strong>;

    case 'htmlFormat':
      return (
        <span
          className={control.cls as string || ''}
          dangerouslySetInnerHTML={{ __html: (value as string) || '' }}
        />
      );

    case 'warning': {
      const warningHtml = control.html as string | undefined;
      if (!warningHtml) return null;
      return (
        <div className="warning-control" style={{
          display: 'flex', gap: 10, padding: '8px 12px',
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8,
          lineHeight: 1.4, fontSize: 13,
        }}>
          <span style={{ fontSize: 16, color: '#faad14', flexShrink: 0, lineHeight: '20px' }}>&#9888;</span>
          <div dangerouslySetInnerHTML={{ __html: warningHtml }} />
        </div>
      );
    }

    case 'actionBar': {
      const actions = control.actions as Array<{ index: number; prompt: string; highlight?: boolean; hint?: string }> | undefined;
      const wfState = control.workflowState as string | undefined;
      const prevState = control.prevWorkflowState as string | undefined;
      const actionPath = control.path as string;
      if (!actions?.length && !wfState) return null;
      return (
        <div className="action-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {wfState && <WorkflowPill state={wfState} prevState={prevState} />}
          {actions?.map((act) => (
            <Button
              key={act.index}
              size="small"
              type={act.highlight ? 'primary' : 'default'}
              title={act.hint}
              onClick={() => doAction('workflow.Action', { navpath: actionPath, option1: String(act.index) })}
            >
              {act.prompt}
            </Button>
          ))}
        </div>
      );
    }

    case 'buttonBar': {
      const buttons = control.buttons as Array<Record<string, unknown>> | undefined;
      if (!buttons?.length) return null;
      return (
        <div className="button-bar" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {buttons.map((btn, i) => {
            const btnControl = btn as unknown as UIControl;
            const ci = btnControl.configureIcon;
            const btnEl = (
              <ControlRenderer
                control={btnControl}
                pageType={pageType}
                onAction={onAction}
                onChange={onChange}
              />
            );
            if (!ci) return <React.Fragment key={i}>{btnEl}</React.Fragment>;
            const Icon = ci.included ? CheckCircleFilled : CloseCircleFilled;
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {btnEl}
                <Icon
                  className={`configure-icon ${ci.included ? 'configure-on' : 'configure-off'}`}
                  title={ci.included ? 'Bottone incluso - clicca per escludere' : 'Bottone escluso - clicca per includere'}
                  onClick={() => doAction('ToggleItem', { navpath: ci.itemId })}
                />
              </span>
            );
          })}
        </div>
      );
    }

    // --- EntrAsp custom controls ---

    case 'contatti': {
      const contacts = control.contacts as Array<Record<string, unknown>> | undefined;
      if (!contacts || contacts.length === 0) return null;
      return (
        <div className="contatti-list">
          {contacts.map((c, i) => (
            <div key={i} className="contatto-row" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 500, marginRight: 8 }}>
                {!!c.flagDefault && <HomeOutlined title="Principale" style={{ marginRight: 2 }} />}
                {!!c.flagAmministrazione && <DollarOutlined title="Amministrazione" style={{ marginRight: 2 }} />}
                {!!c.flagTecnico && <ToolOutlined title="Tecnico" style={{ marginRight: 2 }} />}
                {!!c.flagCommerciale && <ShoppingOutlined title="Commerciale" style={{ marginRight: 2 }} />}
                {!!c.flagSpedizione && <CarOutlined title="Logistica" style={{ marginRight: 2 }} />}
                {String(c.name)}:
              </span>
              {!!(c.phone || c.phone2) && <span style={{ marginRight: 8 }}><PhoneOutlined /> {String(c.phone || '')}{c.phone2 ? ` / ${c.phone2}` : ''}</span>}
              {!!(c.mobile || c.mobile2) && <span style={{ marginRight: 8 }}><MobileOutlined /> {String(c.mobile || '')}{c.mobile2 ? ` / ${c.mobile2}` : ''}</span>}
              {!!(c.fax || c.fax2) && <span style={{ marginRight: 8 }}><PrinterOutlined /> {String(c.fax || '')}{c.fax2 ? ` / ${c.fax2}` : ''}</span>}
              {!!(c.email || c.email2) && <span><MailOutlined /> {String(c.email || '')}{c.email2 ? ` / ${c.email2}` : ''}</span>}
            </div>
          ))}
        </div>
      );
    }

    case 'reportBar': {
      const reports = control.reports as Array<{ value: string; text: string }> | undefined;
      const selected = control.selected as string;
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
          <Button size="small" icon={<PrinterOutlined />} onClick={() => doAction('ExecuteBarReport')}>PDF</Button>
          <Button size="small" icon={<MailOutlined />} onClick={() => doAction('EmailBarReport')}>Email</Button>
        </span>
      );
    }

    case 'allegati': {
      const files = control.files as Array<{ key: string; fileName: string }> | undefined;
      return (
        <div>
          {control.editable && (
            <Upload beforeUpload={() => false} maxCount={1}>
              <Button size="small" icon={<UploadOutlined />}>Allega</Button>
            </Upload>
          )}
          {files && files.map((f) => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <a onClick={() => doAction('EmailAllegatiDownload', { option1: f.key })} style={{ cursor: 'pointer' }}>{f.fileName}</a>
              {control.editable && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => doAction('EmailAllegatiDelete', { option1: f.key })} />
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'varianti': {
      const variants = control.variants as Array<{
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
      const values = control.values as string[] | undefined;
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
      return withPostDecorations(
        <Input
          {...commonProps}
          value={value as string}
          style={{ width: '100%', maxWidth: textMaxWidth }}
          onChange={(e) => handleChange(e.target.value)}
        />,
        control,
        pageType,
        doAction,
        onChange,
      );
  }
};

export default ControlRenderer;
