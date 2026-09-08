import type * as ReactType from 'react';
import type * as AntdType from 'antd';
import type * as IconsType from '@ant-design/icons';
import type * as AgGridType from 'ag-grid-community';
import type * as AgGridReactType from 'ag-grid-react';
import type { ControlComponent } from './types';
import type { ServerResponse } from '../types/ui';

export interface HostRegistry {
  registerControl: (type: string, component: ControlComponent) => void;
  registerControls: (entries: Record<string, ControlComponent>) => void;
  registerCellRenderable: (...types: string[]) => void;
}

/** Runtime dependencies + registry the host passes into the plugin entry.
 *  The plugin's default export has the signature `(host: HostAPI) => void`.
 *  This interface must stay in sync with the mirror in
 *  entrasp/react-plugins/entrasp-controls/src/hostApi.ts. */
/** Servizi dell'host che un controllo del plugin non puo' rifarsi da solo:
 *  scaricare un file e caricarne uno passano da `services/api`, e il `sid`
 *  vive in un React context dell'host. Un plugin che se li reimplementa
 *  sbaglia endpoint o resta su S1. SXADV-5869. */
export interface HostServices {
  /** Vedi services/api.triggerDownload. `useCommand2` per i Command2
   *  (DocDownload, LoadFile), che rispondono su /controller2. */
  triggerDownload: (
    action: string,
    params?: Record<string, string>,
    sid?: string,
    fallbackName?: string,
    useCommand2?: boolean,
  ) => Promise<void>;
  /** Vedi services/api.uploadFile: posta il file in multipart e lo parcheggia
   *  sulla Session; il consumo lo fa la richiesta successiva (Post). */
  uploadFile: (
    file: File,
    sid?: string,
    extraParams?: Record<string, string>,
    action?: string,
  ) => Promise<ServerResponse>;
  /** Hook: il sid della scheda in cui il controllo si sta renderizzando. */
  useSid: () => string;
}

export interface HostAPI {
  React: typeof ReactType;
  antd: typeof AntdType;
  icons: typeof IconsType;
  agGrid: typeof AgGridType;
  agGridReact: typeof AgGridReactType;
  registry: HostRegistry;
  services: HostServices;
}
