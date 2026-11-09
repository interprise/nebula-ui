/** Quante righe servono a un testo alto `scrollHeight` px, massimo 30. */
export function textareaFitRows(scrollHeight: number, lineHeight: number, padding: number): number {
  if (!(lineHeight > 0) || !Number.isFinite(scrollHeight) || !Number.isFinite(padding)) return 0;
  return Math.min(30, Math.ceil(Math.max(0, scrollHeight - padding) / lineHeight));
}
