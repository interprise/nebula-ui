import type { ControlComponent } from './types';

/** Tabella dei controlli: tipo (quello che manda il server) -> componente.
 *
 *  Oggetto senza prototipo, non una `Map`, per due motivi. Le chiavi arrivano
 *  dal server, e senza prototipo un tipo come `constructor` o `__proto__` da'
 *  `undefined` invece di una funzione che non e' un componente. E soprattutto i
 *  renderer devono LEGGERE il componente, non farselo RESTITUIRE da una
 *  chiamata: un tag JSX che viene da una chiamata fatta durante il render, per
 *  il compilatore React, e' un componente creato li' sul momento — quindi
 *  destinato a rimontare a ogni render e a perdere lo stato locale del
 *  controllo. Non puo' sapere che dietro c'e' una tabella riempita una volta
 *  all'avvio, quindi lo segnala (regola `react-hooks/static-components`). Con
 *  l'accesso a proprieta' l'identita' del componente e' evidentemente stabile e
 *  la segnalazione non c'e'. */
const registry: Record<string, ControlComponent> = Object.create(null);

/** Vista in sola lettura della tabella, per i renderer: `controls[tipo]`.
 *  Si scrive solo con le `register*` qui sotto. */
export const controls: Readonly<Record<string, ControlComponent | undefined>> = registry;

const cellRenderable = new Set<string>();

export function registerControl(type: string, component: ControlComponent): void {
  registry[type] = component;
}

export function registerControls(entries: Record<string, ControlComponent>): void {
  for (const [type, component] of Object.entries(entries)) {
    registry[type] = component;
  }
}

export function hasControl(type: string): boolean {
  return type in registry;
}

export function listControlTypes(): string[] {
  return Object.keys(registry).sort();
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
