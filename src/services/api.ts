import type { ServerResponse } from '../types/ui';

const CMD_URL = '/entrasp/controller';
const CMD2_URL = '/entrasp/controller2';

function buildFormData(
  params: Record<string, string>,
  formValues?: Record<string, string>
): URLSearchParams {
  const data = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    data.append(k, v);
  }
  if (formValues) {
    for (const [k, v] of Object.entries(formValues)) {
      data.append(k, v);
    }
  }
  return data;
}

async function post(
  url: string,
  params: Record<string, string>,
  formValues?: Record<string, string>
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
  formValues?: Record<string, string>,
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

export async function uploadFile(
  fileInput: HTMLInputElement,
  sid: string = 'S1'
): Promise<ServerResponse> {
  const formData = new FormData();
  formData.append('action', 'FileUpload');
  formData.append('sid', sid);
  if (fileInput.files?.[0]) {
    formData.append('file', fileInput.files[0]);
  }
  const resp = await fetch(CMD_URL, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
  });
  return resp.json();
}

export async function reloadMenu(): Promise<ServerResponse> {
  return post(CMD2_URL, { action: 'JSONMenu' });
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
