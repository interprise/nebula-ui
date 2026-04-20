import type { ControlComponent } from './types';

const registry = new Map<string, ControlComponent>();
const cellRenderable = new Set<string>();

export function registerControl(type: string, component: ControlComponent): void {
  registry.set(type, component);
}

export function registerControls(entries: Record<string, ControlComponent>): void {
  for (const [type, component] of Object.entries(entries)) {
    registry.set(type, component);
  }
}

export function getControl(type: string): ControlComponent | undefined {
  return registry.get(type);
}

export function hasControl(type: string): boolean {
  return registry.has(type);
}

export function listControlTypes(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Mark one or more control types as suitable for rendering inside AG Grid
 *  list cells. Types NOT marked here use the grid's native cell rendering —
 *  the usual case for plain text/number/date/money/etc. */
export function registerCellRenderable(...types: string[]): void {
  for (const t of types) cellRenderable.add(t);
}

export function isCellRenderable(type: string): boolean {
  return cellRenderable.has(type);
}
