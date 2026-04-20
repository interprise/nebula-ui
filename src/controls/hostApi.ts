import type * as ReactType from 'react';
import type * as AntdType from 'antd';
import type * as IconsType from '@ant-design/icons';
import type * as AgGridType from 'ag-grid-community';
import type * as AgGridReactType from 'ag-grid-react';
import type { ControlComponent } from './types';

export interface HostRegistry {
  registerControl: (type: string, component: ControlComponent) => void;
  registerControls: (entries: Record<string, ControlComponent>) => void;
  registerCellRenderable: (...types: string[]) => void;
}

/** Runtime dependencies + registry the host passes into the plugin entry.
 *  The plugin's default export has the signature `(host: HostAPI) => void`.
 *  This interface must stay in sync with the mirror in
 *  entrasp/react-plugins/entrasp-controls/src/hostApi.ts. */
export interface HostAPI {
  React: typeof ReactType;
  antd: typeof AntdType;
  icons: typeof IconsType;
  agGrid: typeof AgGridType;
  agGridReact: typeof AgGridReactType;
  registry: HostRegistry;
}
