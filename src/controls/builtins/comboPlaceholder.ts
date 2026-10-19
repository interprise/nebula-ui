/**
 * Didascalia di un combo vuoto: l'`emptyMessage` della view ("Aggiungi
 * testo..." sui testi predefiniti accanto alle note). Il legacy la scriveva come
 * prima `<option>` vuota e ExtJS la mostrava in grigio; qui diventa il
 * placeholder del Select (SXADV-5749.1). Solo testo vero: uno spazio non è una
 * didascalia.
 */
export function comboPlaceholder(control: { emptyMessage?: unknown }): string | undefined {
  const msg = control.emptyMessage;
  return typeof msg === 'string' && msg.trim() ? msg : undefined;
}
