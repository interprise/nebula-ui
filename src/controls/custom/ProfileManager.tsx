import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Input, Select, Spin } from 'antd';
import {
  PlusSquareOutlined,
  MinusSquareOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeAlpine } from 'ag-grid-community';
import type { ColDef, ICellRendererParams, GridReadyEvent } from 'ag-grid-community';
import type { CustomControlProps } from '../customControls';

ModuleRegistry.registerModules([AllCommunityModule]);

interface PrivilegeGrant {
  granted: boolean;
  inherited: boolean;
}

interface PrivilegeNode {
  name: string;
  description: string;
  hasChildren: boolean;
  open: boolean;
  level: number;
  navTarget?: string;
  grants: Record<string, PrivilegeGrant>;
  children?: PrivilegeNode[];
}

interface ProfileInfo {
  name: string;
  inherited: string[];
}

interface FlatRow {
  name: string;
  description: string;
  hasChildren: boolean;
  open: boolean;
  level: number;
  navTarget?: string;
  grants: Record<string, PrivilegeGrant>;
}

function flattenPrivileges(nodes: PrivilegeNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({
      name: node.name,
      description: node.description,
      hasChildren: node.hasChildren,
      open: node.open,
      level: node.level,
      navTarget: node.navTarget,
      grants: node.grants,
    });
    if (node.children && node.open) {
      rows.push(...flattenPrivileges(node.children));
    }
  }
  return rows;
}

/** Flatten the entire tree (ignoring open/close) and filter by text.
 *  Only matching nodes are shown as a flat list with breadcrumb path for context. */
function flattenAndFilter(nodes: PrivilegeNode[], filter: string): FlatRow[] {
  const lowerFilter = filter.toLowerCase();
  const rows: FlatRow[] = [];

  function collect(nodeList: PrivilegeNode[], ancestors: string[]): void {
    for (const node of nodeList) {
      if (node.description?.toLowerCase().includes(lowerFilter) || node.name.toLowerCase().includes(lowerFilter)) {
        const breadcrumb = ancestors.length > 0
          ? ancestors.join(' > ') + ' > ' + node.description
          : node.description;
        rows.push({
          name: node.name,
          description: breadcrumb,
          hasChildren: node.hasChildren,
          open: false,
          level: 0,
          navTarget: node.navTarget,
          grants: node.grants,
        });
      }
      if (node.children) {
        collect(node.children, [...ancestors, node.description]);
      }
    }
  }
  collect(nodes, []);
  return rows;
}

const ProfileManager: React.FC<CustomControlProps> = ({ control, onAction, onChange }) => {
  const controlName = (control.name as string) || '';
  const profiles = (control.profiles as ProfileInfo[]) || [];
  const privileges = (control.privileges as PrivilegeNode[]) || [];
  const editable = control.editable !== false;

  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [columnFilter, setColumnFilter] = useState('');
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnFilterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterChange = useCallback((value: string) => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    if (!value) {
      // Clear immediately, no debounce
      setDebouncedFilter('');
      return;
    }
    filterTimerRef.current = setTimeout(() => {
      document.body.style.cursor = 'wait';
      requestAnimationFrame(() => {
        setDebouncedFilter(value);
        document.body.style.cursor = '';
      });
    }, 300);
  }, []);

  const rows = useMemo(
    () => debouncedFilter ? flattenAndFilter(privileges, debouncedFilter) : flattenPrivileges(privileges),
    [privileges, debouncedFilter]
  );

  const handleColumnFilterChange = useCallback((value: string) => {
    if (columnFilterTimerRef.current) clearTimeout(columnFilterTimerRef.current);
    if (!value) {
      setColumnFilter('');
      return;
    }
    columnFilterTimerRef.current = setTimeout(() => {
      setColumnFilter(value);
    }, 300);
  }, []);

  const visibleProfiles = useMemo(() => {
    let filtered = profiles.filter(p => !hiddenColumns.includes(p.name));
    if (columnFilter) {
      const lower = columnFilter.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(lower));
    }
    return filtered;
  }, [profiles, hiddenColumns, columnFilter]);

  const handleToggle = useCallback((privilegeName: string) => {
    onAction('ProfileManagerToggle', { navpath: privilegeName });
  }, [onAction]);

  const handleNavTarget = useCallback((navTarget: string) => {
    onAction('ProfileManager', { navpath: navTarget });
  }, [onAction]);

  const handleCheckboxChange = useCallback((privilegeName: string, profileName: string, newValue: boolean) => {
    const fieldName = `${controlName}-${privilegeName}-${profileName}`;
    onChange(fieldName, String(newValue));
    onAction('Post', {});
  }, [controlName, onChange, onAction]);

  const handleHideProfile = useCallback((profileName: string) => {
    setHiddenColumns(prev => [...prev, profileName]);
  }, []);

  const [selectValue, setSelectValue] = useState<string | null>(null);

  const handleRestoreProfile = useCallback((profileName: string) => {
    setHiddenColumns(prev => prev.filter(n => n !== profileName));
    setSelectValue(null);
  }, []);

  const hiddenOptions = useMemo(
    () => hiddenColumns.map(name => ({ value: name, label: name })),
    [hiddenColumns]
  );

  // Privilege tree column renderer
  const PrivilegeCellRenderer = useCallback((params: ICellRendererParams<FlatRow>) => {
    const row = params.data;
    if (!row) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: row.level * 20 }}>
        {row.hasChildren ? (
          <span
            style={{ cursor: 'pointer', marginRight: 4, fontSize: 14 }}
            onClick={() => handleToggle(row.name)}
          >
            {row.open ? <MinusSquareOutlined /> : <PlusSquareOutlined />}
          </span>
        ) : (
          <span style={{ width: 18, display: 'inline-block' }} />
        )}
        <span>{row.description}</span>
        {row.navTarget && (
          <span
            style={{ cursor: 'pointer', marginLeft: 6, color: '#1677ff' }}
            onClick={() => handleNavTarget(row.navTarget!)}
          >
            <LinkOutlined />
          </span>
        )}
      </div>
    );
  }, [handleToggle, handleNavTarget]);

  // Checkbox cell renderer for profile columns
  const CheckboxCellRenderer = useCallback((profileName: string) => {
    const Renderer = (params: ICellRendererParams<FlatRow>) => {
      const row = params.data;
      if (!row) return null;
      const grant = row.grants[profileName];
      if (!grant) return null;
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            backgroundColor: grant.inherited ? '#e0e0e0' : undefined,
          }}
        >
          <input
            type="checkbox"
            checked={grant.granted}
            disabled={!editable}
            onChange={() => {
              if (editable) {
                handleCheckboxChange(row.name, profileName, !grant.granted);
              }
            }}
            style={{ cursor: editable ? 'pointer' : 'default' }}
          />
        </div>
      );
    };
    Renderer.displayName = `CheckboxCell_${profileName}`;
    return Renderer;
  }, [editable, handleCheckboxChange]);

  // Profile header with hide button
  const ProfileHeader = useCallback((profileName: string) => {
    const Header = () => (
      <div
        style={{ cursor: 'pointer', textAlign: 'center', width: '100%' }}
        title={`Clicca per nascondere ${profileName}`}
        onClick={() => handleHideProfile(profileName)}
      >
        {profileName}
      </div>
    );
    Header.displayName = `ProfileHeader_${profileName}`;
    return Header;
  }, [handleHideProfile]);

  const abilitazioneWidth = useMemo(() => {
    let max = 100; // header text
    for (const row of rows) {
      const w = row.level * 20 + (row.description?.length || 0) * 7.5 + 50; // indent + text + icons/padding
      if (w > max) max = w;
    }
    return Math.max(200, Math.ceil(max));
  }, [rows]);

  const columnDefs = useMemo<ColDef<FlatRow>[]>(() => {
    const cols: ColDef<FlatRow>[] = [
      {
        colId: 'abilitazione',
        headerName: 'Abilitazione',
        field: 'description',
        pinned: 'left' as const,
        width: abilitazioneWidth,
        minWidth: 200,
        cellRenderer: PrivilegeCellRenderer,
      },
    ];

    for (const p of visibleProfiles) {
      cols.push({
        headerName: p.name,
        headerComponent: ProfileHeader(p.name),
        width: 100,
        cellRenderer: CheckboxCellRenderer(p.name),
        suppressHeaderMenuButton: true,
      });
    }

    return cols;
  }, [visibleProfiles, abilitazioneWidth, PrivilegeCellRenderer, CheckboxCellRenderer, ProfileHeader]);

  // Measure available height from the nearest scrollable ancestor (tab-content)
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(400);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // Walk up to find the scrollable tab-content container
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent && getComputedStyle(scrollParent).overflow !== 'auto' && getComputedStyle(scrollParent).overflow !== 'scroll') {
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    // Prevent the scroll parent from showing scrollbars — the grid scrolls internally
    scrollParent.style.overflow = 'hidden';

    const update = () => {
      const parentStyle = getComputedStyle(scrollParent!);
      const parentRect = scrollParent!.getBoundingClientRect();
      const contentBottom = parentRect.bottom - parseFloat(parentStyle.paddingBottom) - parseFloat(parentStyle.borderBottomWidth);
      const elRect = el.getBoundingClientRect();
      const available = contentBottom - elRect.top;
      setGridHeight(Math.max(200, Math.floor(available)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollParent);
    return () => { ro.disconnect(); scrollParent!.style.overflow = ''; };
  }, []);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexShrink: 0, flexWrap: 'wrap' }}>
        <Input
          placeholder="Filtra abilitazioni..."
          onChange={e => handleFilterChange(e.target.value)}
          allowClear
          size="small"
          style={{ width: 250 }}
        />
        <Input
          placeholder="Filtra profili..."
          onChange={e => handleColumnFilterChange(e.target.value)}
          allowClear
          size="small"
          style={{ width: 200 }}
        />
        <span style={{ fontSize: 13 }}>Aggiungi profilo:</span>
        <Select
          placeholder=""
          style={{ width: 300, minWidth: 300 }}
          popupMatchSelectWidth={300}
          options={hiddenOptions}
          value={selectValue}
          onChange={handleRestoreProfile}
          disabled={hiddenOptions.length === 0}
          size="small"
        />
        <span style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>
          Cliccare sull&apos;intestazione per nascondere i profili non desiderati
        </span>
      </div>
      <div ref={gridRef} style={{ width: '100%', height: gridHeight }}>
        <AgGridReact<FlatRow>
          theme={themeAlpine}
          rowData={rows}
          columnDefs={columnDefs}
          headerHeight={32}
          rowHeight={28}
          suppressCellFocus
          suppressRowHoverHighlight={false}
        />
      </div>
    </div>
  );
};

export default ProfileManager;
