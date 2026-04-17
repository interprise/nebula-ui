import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tag, Button, Tooltip, Drawer, Input, Checkbox, Spin, Empty, Space, Typography } from 'antd';
import {
  CloseOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  PlusOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { UIControl } from '../types/ui';
import { SidContext } from '../components/ViewRenderer';
import * as api from '../services/api';

interface SelItem {
  value: string;
  text: string;       // chip text (lookup expression, e.g. code only)
  listText?: string;  // richer display text for the drawer list (default lookup)
}

interface MultiSelectControlProps {
  control: UIControl;
  pageType?: number;
  editable: boolean;
  hint?: string;
  value: unknown;
  onChange: (val: unknown) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
  maxWidth?: number;
}

const { Text } = Typography;

/** Parse server value into array of keys.
 *  Format can be: `@cursor:BO:k1,k2`, `k1,k2,k3`, `[k1,k2]`, or `[]`. */
function parseKeys(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('@cursor:')) {
    // @cursor:BO:k1,k2,k3
    const colonAfterBO = s.indexOf(':', 8);
    const list = colonAfterBO >= 0 ? s.substring(colonAfterBO + 1) : '';
    return list.split(',').map((k) => k.trim()).filter(Boolean);
  }
  return s.split(',').map((k) => k.trim()).filter(Boolean);
}

const MultiSelectControl: React.FC<MultiSelectControlProps> = ({
  control, editable, hint, value, onChange, onAction, maxWidth,
}) => {
  const sid = useContext(SidContext);
  const navpath = (control.navpath as string) || '';
  const controlName = (control.controlName as string) || control.name || '';
  const maxItemsShown = (control.maxItemsShown as number) || 5;

  // Static options (code-table mode) — pre-populated by server (memoized by reference)
  const staticOptions = useMemo(
    () => (control.options as SelItem[] | undefined) || [],
    [control.options],
  );
  // Selected items with labels — from server renderJSON
  const serverSelected = useMemo(
    () => (control.selectedItems as SelItem[] | undefined) || [],
    [control.selectedItems],
  );

  // Local state tracks selection — synced from prop value, but user edits
  // update it immediately so chips refresh without waiting for a server round-trip.
  const [localValue, setLocalValue] = useState<string>(() => parseKeys(value).join(','));
  useEffect(() => {
    setLocalValue(parseKeys(value).join(','));
  }, [value]);

  const selectedKeys = useMemo(() => parseKeys(localValue), [localValue]);

  // Separate state for labels learned during drawer fetches (remote mode)
  const [fetchedLabels, setFetchedLabels] = useState<Record<string, string>>({});
  // Cache of full SelItem (incl. listText) seen during fetches — used to
  // render "Only selected" mode with proper descriptions.
  const [fetchedItems, setFetchedItems] = useState<Record<string, SelItem>>({});

  // Combined label map (derived, not stored)
  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of staticOptions) m[o.value] = o.text;
    for (const o of serverSelected) m[o.value] = o.text;
    Object.assign(m, fetchedLabels);
    return m;
  }, [staticOptions, serverSelected, fetchedLabels]);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [allOptions, setAllOptions] = useState<SelItem[]>([]);
  const [contentViewType, setContentViewType] = useState<string>('LIST');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [filter, setFilter] = useState('');
  const [pendingKeys, setPendingKeys] = useState<string[]>(selectedKeys);
  // Expanded chip overflow
  const [expanded, setExpanded] = useState(false);
  // Drawer "only selected" mode — useful to review/deselect without scrolling
  const [onlySelected, setOnlySelected] = useState(false);

  // Fetch options when opening drawer (if contentViewName mode)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openDrawer = useCallback(async () => {
    setPendingKeys(selectedKeys);
    setFilter('');
    setOnlySelected(false); // reset to normal view every time the drawer opens
    setDrawerOpen(true);
    // If we have a code-table or options are already loaded, skip fetch
    if (staticOptions.length > 0) {
      setAllOptions(staticOptions);
      return;
    }
    if (!control.contentViewName) return;
    setLoadingOptions(true);
    try {
      const resp = await api.fetchMultiSelectOptions(navpath, controlName, '', sid || 'S1');
      setAllOptions(resp.rows);
      setContentViewType(resp.viewType);
      const map: Record<string, string> = {};
      const itemMap: Record<string, SelItem> = {};
      for (const o of resp.rows) { map[o.value] = o.text; itemMap[o.value] = o; }
      setFetchedLabels((prev) => ({ ...prev, ...map }));
      setFetchedItems((prev) => ({ ...prev, ...itemMap }));
    } catch {
      setAllOptions([]);
    } finally {
      setLoadingOptions(false);
    }
  }, [selectedKeys, staticOptions, control.contentViewName, navpath, controlName, sid]);

  // Server-side search for remote lists (debounced)
  const handleSearch = useCallback((q: string) => {
    setFilter(q);
    if (staticOptions.length > 0 || !control.contentViewName) return;
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(async () => {
      setLoadingOptions(true);
      try {
        const resp = await api.fetchMultiSelectOptions(navpath, controlName, q, sid || 'S1');
        setAllOptions(resp.rows);
        setContentViewType(resp.viewType);
        const map: Record<string, string> = {};
        const itemMap: Record<string, SelItem> = {};
        for (const o of resp.rows) { map[o.value] = o.text; itemMap[o.value] = o; }
        setFetchedLabels((prev) => ({ ...prev, ...map }));
        setFetchedItems((prev) => ({ ...prev, ...itemMap }));
      } catch {
        // keep previous
      } finally {
        setLoadingOptions(false);
      }
    }, 300);
  }, [staticOptions.length, control.contentViewName, navpath, controlName, sid]);

  // Combined pool of known items (for "only selected" mode — includes server-
  // provided selected items + everything we've seen during fetches).
  const knownItemsByKey = useMemo(() => {
    const m: Record<string, SelItem> = {};
    for (const o of allOptions) m[o.value] = o;
    for (const [k, v] of Object.entries(fetchedItems)) {
      if (!m[k] || (!m[k].listText && v.listText)) m[k] = v;
    }
    for (const o of serverSelected) if (!m[o.value] || (!m[o.value].listText && o.listText)) m[o.value] = o;
    for (const o of staticOptions) if (!m[o.value]) m[o.value] = o;
    return m;
  }, [allOptions, serverSelected, staticOptions, fetchedItems]);

  // Filtered options for the drawer
  const visibleOptions = useMemo(() => {
    let base: SelItem[];
    if (onlySelected) {
      // Show items that are currently selected (pendingKeys), looked up from
      // all known sources so users can review/deselect without scrolling.
      base = pendingKeys.map((k) => knownItemsByKey[k] || { value: k, text: k });
    } else {
      base = allOptions;
    }
    if (!filter) return base;
    const lower = filter.toLowerCase();
    // For remote mode, server already filtered; client filter is only needed
    // for static options OR for the "only selected" subset.
    if (onlySelected || staticOptions.length > 0) {
      return base.filter(
        (o) =>
          (o.listText || o.text).toLowerCase().includes(lower) ||
          o.value.toLowerCase().includes(lower),
      );
    }
    return base;
  }, [allOptions, filter, staticOptions.length, onlySelected, pendingKeys, knownItemsByKey]);

  const removeKey = useCallback((key: string) => {
    if (!editable) return;
    const next = selectedKeys.filter((k) => k !== key);
    const nextValue = next.join(',');
    setLocalValue(nextValue);
    onChange(nextValue);
  }, [editable, selectedKeys, onChange]);

  const applySelection = useCallback(() => {
    const nextValue = pendingKeys.join(',');
    setLocalValue(nextValue);
    onChange(nextValue);
    setDrawerOpen(false);
  }, [pendingKeys, onChange]);

  const togglePending = useCallback((key: string) => {
    setPendingKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }, []);

  const selectAll = useCallback(() => {
    setPendingKeys(visibleOptions.map((o) => o.value));
  }, [visibleOptions]);

  const selectNone = useCallback(() => {
    setPendingKeys([]);
    // Leaving "only selected" mode active with no selections would hide the whole list
    setOnlySelected(false);
  }, []);

  // Chip rendering: show first N, then "+K others" with expand toggle
  const chipsToShow = expanded ? selectedKeys : selectedKeys.slice(0, maxItemsShown);
  const hiddenCount = Math.max(0, selectedKeys.length - maxItemsShown);

  return (
    <span className="multiselect-container" style={{ maxWidth, width: '100%' }} title={hint}>
      <span
        className="multiselect-chips"
        onClick={editable ? openDrawer : undefined}
        style={editable ? { cursor: 'pointer' } : undefined}
      >
        {selectedKeys.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
            {editable ? 'Clicca per selezionare' : 'Nessuna selezione'}
          </Text>
        )}
        {chipsToShow.map((k) => (
          <Tag
            key={k}
            className="multiselect-chip"
            closable={editable}
            closeIcon={<CloseOutlined style={{ fontSize: 10 }} />}
            onClose={(e) => { e.preventDefault(); e.stopPropagation(); removeKey(k); }}
            color="blue"
          >
            {labelMap[k] || k}
          </Tag>
        ))}
        {!expanded && hiddenCount > 0 && (
          <Tag
            className="multiselect-chip-more"
            style={{ cursor: 'pointer', borderStyle: 'dashed' }}
            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          >
            +{hiddenCount} altri
          </Tag>
        )}
        {expanded && selectedKeys.length > maxItemsShown && (
          <Tag
            style={{ cursor: 'pointer', borderStyle: 'dashed' }}
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          >
            Mostra meno
          </Tag>
        )}
      </span>
      {editable && (
        <Tooltip title={selectedKeys.length > 0 ? 'Modifica selezione' : 'Seleziona'}>
          <Button
            className="multiselect-picker-btn"
            size="small"
            icon={selectedKeys.length > 0 ? <FolderOpenOutlined /> : <PlusOutlined />}
            onClick={openDrawer}
          />
        </Tooltip>
      )}

      <Drawer
        title={`Selezione: ${(control.prompt as string) || controlName}`}
        placement="right"
        width={480}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Annulla</Button>
            <Button type="primary" onClick={applySelection}>
              Conferma ({pendingKeys.length})
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
          <Input
            placeholder="Cerca..."
            prefix={<SearchOutlined />}
            allowClear
            value={filter}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <Space wrap>
            <Button size="small" onClick={selectAll} disabled={visibleOptions.length === 0 || onlySelected}>
              Seleziona tutto
            </Button>
            <Button size="small" onClick={selectNone} disabled={pendingKeys.length === 0}>
              Deseleziona tutto
            </Button>
            <Button
              size="small"
              type={onlySelected ? 'primary' : 'default'}
              onClick={() => setOnlySelected((v) => !v)}
              disabled={pendingKeys.length === 0}
              icon={onlySelected ? <CheckCircleFilled /> : <CheckCircleOutlined />}
            >
              Solo selezionati
            </Button>
            {contentViewType === 'QUERY' && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setDrawerOpen(false);
                  onAction('MultiSelectAdd', { navpath, option1: controlName });
                }}
              >
                Ricerca avanzata →
              </Button>
            )}
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {pendingKeys.length} / {allOptions.length} selezionati
            </Text>
          </Space>
          {allOptions.length >= 100 && (
            <Text type="warning" style={{ fontSize: 11 }}>
              Visualizzati primi 100 — affina la ricerca per restringere i risultati
            </Text>
          )}
          <div style={{ flex: 1, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
            {loadingOptions ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : visibleOptions.length === 0 ? (
              <Empty description="Nessun elemento" style={{ padding: 40 }} />
            ) : (
              visibleOptions.map((o) => {
                const checked = pendingKeys.includes(o.value);
                const label = o.listText || o.text;
                return (
                  <div
                    key={o.value}
                    className="multiselect-option"
                    onClick={() => togglePending(o.value)}
                    style={{
                      padding: '6px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      borderBottom: '1px solid #fafafa',
                      background: checked ? '#e6f4ff' : undefined,
                    }}
                  >
                    <Checkbox checked={checked} />
                    <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Drawer>
    </span>
  );
};

export default MultiSelectControl;
