import type { ServerResponse } from '../types/ui';

const CMD_URL = '/entrasp/controller';
const CMD2_URL = '/entrasp/controller2';

function buildFormData(
  params: Record<string, string>,
  formValues?: Record<string, string | string[]>
): URLSearchParams {
  const data = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    data.append(k, v);
  }
  if (formValues) {
    for (const [k, v] of Object.entries(formValues)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          data.append(k, item);
        }
      } else {
        data.append(k, v);
      }
    }
  }
  return data;
}

async function post(
  url: string,
  params: Record<string, string>,
  formValues?: Record<string, string | string[]>
): Promise<ServerResponse> {
  const body = buildFormData(params, formValues);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'same-origin',
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

export async function getConfig(): Promise<ServerResponse> {
  return post(CMD2_URL, { action: 'GetConfig' });
}

export async function login(username: string, password: string): Promise<ServerResponse> {
  // GetConfig establishes the HTTP session on the server
  await getConfig();
  return post(CMD2_URL, {
    action: 'JSONMenu',
    username,
    password,
    ui: 'react',
  });
}

export async function logout(): Promise<ServerResponse> {
  return post(CMD2_URL, { action: 'Logout' });
}

export async function executeMenuItem(
  menuId: string,
  sid: string = 'S1'
): Promise<ServerResponse> {
  return post(CMD_URL, {
    action: 'ExecuteMenuItem',
    menuId,
    sid,
  });
}

export async function postAction(
  action: string,
  params: Record<string, string> = {},
  formValues?: Record<string, string | string[]>,
  sid: string = 'S1'
): Promise<ServerResponse> {
  return post(CMD_URL, { action, sid, ...params }, formValues);
}

export async function postAction2(
  action: string,
  params: Record<string, string> = {}
): Promise<ServerResponse> {
  return post(CMD2_URL, { action, ...params });
}

/** POST to the controller and stream the response body as a file download.
 *  Used by Download/Attachments/Report commands that return binary payloads
 *  rather than JSON. Extracts the filename from Content-Disposition when set,
 *  otherwise falls back to `fallbackName`. */
export async function triggerDownload(
  action: string,
  params: Record<string, string> = {},
  sid: string = 'S1',
  fallbackName: string = 'download'
): Promise<void> {
  const body = buildFormData({ action, sid, ...params });
  const resp = await fetch(CMD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'same-origin',
  });
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const blob = await resp.blob();
  let filename = fallbackName;
  const cd = resp.headers.get('content-disposition');
  if (cd) {
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (m) filename = decodeURIComponent(m[1].replace(/"/g, ''));
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadFile(
  file: File,
  sid: string = 'S1',
  extraParams: Record<string, string> = {}
): Promise<ServerResponse> {
  const formData = new FormData();
  formData.append('action', 'FileUpload');
  formData.append('sid', sid);
  for (const [k, v] of Object.entries(extraParams)) {
    formData.append(k, v);
  }
  formData.append('file', file);
  const resp = await fetch(CMD_URL, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
  });
  return resp.json();
}

export async function reloadMenu(): Promise<ServerResponse> {
  return post(CMD2_URL, { action: 'JSONMenu', ui: 'react' });
}

export async function checkProgress(sid: string = 'S1'): Promise<ServerResponse> {
  return post(CMD2_URL, { action: 'JSONProgress', sid });
}

export async function fetchComboOptions(
  navpath: string,
  controlName: string,
  query: string,
  sid: string = 'S1'
): Promise<{ value: string; text: string }[]> {
  const resp = await post(CMD_URL, {
    action: 'ListUIControlList',
    sid,
    navpath,
    option1: controlName,
    query,
    limit: '100',
  });
  // Server returns { rows: [{ value, text }], resultSize }
  return (resp as unknown as { rows: { value: string; text: string }[] }).rows || [];
}

export interface MultiSelectRow {
  value: string;
  text: string;       // chip text (compact, lookup expression)
  listText?: string;  // richer display text for the drawer list
}

export interface MultiSelectListResponse {
  rows: MultiSelectRow[];
  viewType: string; // 'LIST' | 'QUERY' | etc.
}

export async function fetchMultiSelectOptions(
  navpath: string,
  controlName: string,
  query: string,
  sid: string = 'S1'
): Promise<MultiSelectListResponse> {
  const resp = await post(CMD2_URL, {
    action: 'MultiSelectList',
    sid,
    navpath,
    option1: controlName,
    query,
  });
  const r = resp as unknown as MultiSelectListResponse;
  return { rows: r.rows || [], viewType: r.viewType || 'LIST' };
}

// --- Expression Builder metadata ---

export interface MetadataRow {
  name: string;
  type: 'A' | 'R'; // Attribute or Relationship
  target?: string; // target BO name for relationships
  method?: boolean;
  javaType?: string;
}

export async function fetchMetadata(
  boName: string,
  allowMethods: boolean,
  query: string,
): Promise<MetadataRow[]> {
  const resp = await post(CMD2_URL, {
    action: 'Metadata',
    boName,
    allowMethods: allowMethods ? 'true' : 'false',
    query: query || '',
  });
  return (resp as unknown as { rows: MetadataRow[] }).rows || [];
}

// --- CDMS (Document Management) ---

export interface CdmsNode {
  cdmsId: string;
  path: string;
  text: string;
  editable?: boolean;
  draggable?: boolean;
  leaf?: boolean;
}

export async function cdmsGetRoots(): Promise<{ nodes: CdmsNode[]; admin: boolean }> {
  const resp = await post(CMD2_URL, { action: 'CdmsRoots' });
  return resp as unknown as { nodes: CdmsNode[]; admin: boolean };
}

export async function cdmsGetChildren(path: string): Promise<CdmsNode[]> {
  const resp = await post(CMD2_URL, { action: 'CdmsGet', path });
  return resp as unknown as CdmsNode[];
}

export async function cdmsExec(
  cmd: string,
  params: Record<string, string>
): Promise<{ success?: boolean; error?: string }> {
  const resp = await post(CMD2_URL, { action: 'CdmsExec', cmd, ...params });
  return resp as unknown as { success?: boolean; error?: string };
}
