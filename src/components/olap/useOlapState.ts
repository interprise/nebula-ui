import { useEffect, useState } from 'react';
import { streamCube } from './stream';
import type { CubeMeta, CubeRow } from './types';

export type Phase = 'loading' | 'streaming' | 'ready' | 'error';

export interface OlapState {
  phase: Phase;
  error?: string;
  meta?: CubeMeta;
  rows: CubeRow[];
}

/** Subscribes to the NDJSON cube stream for `viewName` on mount, plus on
 *  every `streamGen` increment — the consumer bumps that counter from an
 *  Esegui-style action so the cube re-streams with the latest form-field
 *  values. Phase transitions: loading → (meta arrives) streaming → (end)
 *  ready, or any → error. Rows are accumulated and committed on `end`. */
export function useOlapState(
  viewName: string,
  sid: string,
  getFormValues: () => Record<string, string | string[]>,
  streamGen: number,
): OlapState {
  const [state, setState] = useState<OlapState>({ phase: 'loading', rows: [] });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let meta: CubeMeta | undefined;
    const rows: CubeRow[] = [];
    const fv = getFormValues();

    (async () => {
      try {
        for await (const line of streamCube(viewName, sid, undefined, fv, controller.signal)) {
          if (cancelled) return;
          if (line.kind === 'meta') {
            meta = line;
            setState({ phase: 'streaming', meta, rows: [] });
          } else if (line.kind === 'row') {
            rows.push(line);
          } else if (line.kind === 'values') {
            // Server resolves descriptions for distinct dim codes after the
            // row stream and emits one packet per dim. Merge into meta in
            // place; React picks up the updated map when we commit on `end`.
            if (meta) {
              const dim = meta.dimensions.find((d) => d.name === line.dim);
              if (dim) dim.values = { ...(dim.values ?? {}), ...line.values };
            }
          } else if (line.kind === 'end') {
            setState({ phase: 'ready', meta, rows: rows.slice() });
          } else if (line.kind === 'error') {
            setState({ phase: 'error', error: line.message, meta, rows: rows.slice() });
          }
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState((prev) => ({ phase: 'error', error: msg, meta: prev.meta, rows: prev.rows }));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // getFormValues is a stable ref-backed getter; re-running on every
    // identity change would re-stream after each render. We re-stream
    // explicitly via streamGen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewName, sid, streamGen]);

  return state;
}
