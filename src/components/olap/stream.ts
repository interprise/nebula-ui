import type { StreamLine } from './types';

const CMD2_URL = '/entrasp/controller2';

/** Open the NDJSON OLAP stream and yield each parsed line. The server writes
 *  one JSON object per line (`{kind:"meta",...}` | `{kind:"row",...}` | `{kind:"end"}` |
 *  `{kind:"error",message}`); we read incrementally from the response body
 *  and split on '\n' so the consumer can react before the full payload
 *  arrives. */
export async function* streamCube(
  viewName: string,
  sid: string,
  visibleDims: string[] | undefined,
  formValues: Record<string, string | string[]> | undefined,
  signal?: AbortSignal,
): AsyncIterable<StreamLine> {
  const params = new URLSearchParams();
  params.set('action', 'olap.StreamCube');
  params.set('sid', sid);
  params.set('viewName', viewName);
  if (visibleDims && visibleDims.length > 0) {
    params.set('visibleDims', visibleDims.join(','));
  }
  if (formValues) {
    for (const [k, v] of Object.entries(formValues)) {
      if (Array.isArray(v)) {
        for (const item of v) params.append(k, item);
      } else {
        params.append(k, v);
      }
    }
  }

  const resp = await fetch(CMD2_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    credentials: 'same-origin',
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  if (!resp.body) throw new Error('No response body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        yield JSON.parse(line) as StreamLine;
      }
    }
    const last = buf.trim();
    if (last) yield JSON.parse(last) as StreamLine;
  } finally {
    reader.releaseLock();
  }
}
