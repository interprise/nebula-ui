import type { UITree, PanelTemplate } from '../types/ui';

/**
 * In-memory cache of view templates keyed by the server's templateKey
 * ("viewName:pageType"). Populated when the server returns a METADATA+DATA
 * response; consulted when the server returns a DATA-only response so the
 * client can hydrate the cached template against the new values + dynProps.
 *
 * Scope: session-wide (survives tab close/reopen within the same session)
 * but not persisted. Stage 2 of the optimization will add durable caching
 * keyed by (viewName, pageType, privileges) across sessions.
 */
const templates = new Map<string, UITree>();

export function putTemplate(key: string, template: UITree): void {
  templates.set(key, template);
}

export function getTemplate(key: string): UITree | undefined {
  return templates.get(key);
}

export function hasTemplate(key: string): boolean {
  return templates.has(key);
}

export function clearTemplates(): void {
  templates.clear();
}

/**
 * Parallel cache for the instant edit-panel FORM templates, keyed by
 * panelTemplateKey ("viewName:panel"). A listEdit list ships its panelTemplate
 * once; the client caches it here and advertises the keys it holds (see
 * panelTemplateKeys) so the server can OMIT the (cacheable, sid-free) blob on
 * subsequent list renders, sending only the key. On a response that omits it,
 * the client falls back to the cached copy.
 */
const panelTemplates = new Map<string, PanelTemplate>();

export function putPanelTemplate(key: string, template: PanelTemplate): void {
  panelTemplates.set(key, template);
}

export function getPanelTemplate(key: string): PanelTemplate | undefined {
  return panelTemplates.get(key);
}

/** Comma-joined list of cached panel-template keys, for the `panelKeys`
 *  request param that tells the server what it can omit. Empty string when none. */
export function panelTemplateKeysParam(): string {
  return [...panelTemplates.keys()].join(',');
}
