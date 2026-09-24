/* Il bottone mappa (controllo `map`, GMapUIControl in CORE — SXADV-5969.2).
 *
 * Il legacy apriva una finestra ExtJS con Google Maps incorporato (script
 * `maps.googleapis.com/maps/api/js` caricato senza chiave, cosa che Google non
 * accetta piu'), e con `pathFrom` una seconda scheda col percorso stradale. Il
 * client React apre Google Maps in una scheda nuova con gli URL pubblici
 * (`api=1`), che non chiedono una chiave: la mappa dell'indirizzo, o il
 * percorso in auto quando la view dichiara un'origine diversa dall'indirizzo. */

const MAPS = 'https://www.google.com/maps';

export function mapUrl(address: string | undefined | null, pathFrom?: string | null): string | null {
  const to = (address ?? '').trim();
  if (!to) return null;
  const from = (pathFrom ?? '').trim();
  if (from && from.toLowerCase() !== to.toLowerCase()) {
    return `${MAPS}/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;
  }
  return `${MAPS}/search/?api=1&query=${encodeURIComponent(to)}`;
}
