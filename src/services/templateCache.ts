import type { UITree } from '../types/ui';

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
