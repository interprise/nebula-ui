import { uploadFile } from './api';
import type { ErrorItem } from '../types/ui';

/** Il file scelto in un campo `upload` (FileUploadUIControl) e non ancora
 *  partito. Come il campo file nativo del legacy, la scelta non manda niente:
 *  il file sale col Save/Post della vista (SXADV-5761). Uno per sessione: il
 *  legacy ne conosceva uno solo (`uiData.upload`). */
export interface PendingUpload {
  file: File;
  params: Record<string, string>;
  action: string;
  viewName?: string;
}

export type FlushResult =
  | { ok: true; action: string; params: Record<string, string> }
  | { ok: false; errors?: ErrorItem[]; error?: unknown };

const pending = new Map<string, PendingUpload>();
const listeners = new Map<string, Set<() => void>>();

function notify(sid: string) {
  for (const cb of [...(listeners.get(sid) ?? [])]) cb();
}

export function setPendingUpload(sid: string, p: PendingUpload): void {
  pending.set(sid, p);
  notify(sid);
}

export function getPendingUpload(sid: string): PendingUpload | undefined {
  return pending.get(sid);
}

export function clearPendingUpload(sid: string): void {
  if (!pending.delete(sid)) return;
  notify(sid);
}

export function subscribePendingUpload(sid: string, cb: () => void): () => void {
  let set = listeners.get(sid);
  if (!set) listeners.set(sid, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0 && listeners.get(sid) === set) listeners.delete(sid);
  };
}

/** Annulla ridisegna la vista: il campo file del legacy ripartiva vuoto. */
export function cancelsUpload(action: string): boolean {
  return action === 'Cancel';
}

const inFlight = new Map<string, Promise<FlushResult>>();

/** C'e' un file da mandare, o in volo, per questa sessione. */
export function hasPendingUpload(sid: string): boolean {
  return pending.has(sid) || inFlight.has(sid);
}

/** Legacy ajaxDo/doUpload: Save o Post con un file in attesa -> prima il
 *  multipart col solo file (`FileUpload`, o il comando del campo), poi
 *  l'azione, solo se il caricamento e' andato bene. `uiData.cdmsKey` gira
 *  l'azione su CdmsEdit (cleanUpload). Se il caricamento fallisce il file
 *  resta in attesa: corretto l'errore, Salva lo rimanda. Un Save/Post che
 *  arriva col file in volo (il Post del campo che perde il fuoco, poi il
 *  clic su Salva) aspetta il caricamento e parte dopo, come nella coda del
 *  legacy; se il caricamento fallisce non parte (l'errore lo mostra chi l'ha
 *  mandato: `ok:false` senza errori). */
export async function flushPendingUpload(
  sid: string,
  action: string,
  params: Record<string, string>,
  currentViewName?: string,
): Promise<FlushResult> {
  const unchanged: FlushResult = { ok: true, action, params };
  if (action !== 'Save' && action !== 'Post') return unchanged;
  const running = inFlight.get(sid);
  if (running) {
    const r = await running;
    if (!r.ok) return { ok: false };
  }
  const p = pending.get(sid);
  if (!p) return unchanged;
  // Preso subito: un secondo Salva mentre il file e' in volo non lo rimanda.
  pending.delete(sid);
  if (p.viewName && currentViewName && p.viewName !== currentViewName) {
    notify(sid);
    return unchanged;
  }
  const upload = sendUpload(sid, p, action, params);
  inFlight.set(sid, upload);
  try {
    return await upload;
  } finally {
    if (inFlight.get(sid) === upload) inFlight.delete(sid);
  }
}

async function sendUpload(
  sid: string,
  p: PendingUpload,
  action: string,
  params: Record<string, string>,
): Promise<FlushResult> {
  const restore = () => {
    if (!pending.has(sid)) pending.set(sid, p);
  };
  try {
    const resp = await uploadFile(p.file, sid, p.params, p.action);
    const errors = (resp.errors ?? []).filter((e) => e.type === 'ERROR');
    if (errors.length > 0) {
      restore();
      return { ok: false, errors: resp.errors };
    }
    notify(sid);
    const cdmsKey = (resp.uiData as Record<string, unknown> | undefined)?.cdmsKey as string | undefined;
    if (cdmsKey) return { ok: true, action: 'CdmsEdit', params: { navpath: cdmsKey } };
    return { ok: true, action, params };
  } catch (error) {
    restore();
    return { ok: false, error };
  }
}
