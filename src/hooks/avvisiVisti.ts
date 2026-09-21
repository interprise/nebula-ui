import type { Banner } from '../types/ui';

/**
 * SXADV-62 · Quali avvisi questa persona ha gia' visto.
 *
 * <p>Serve a decidere che cosa mostrare quando si apre la Home: gli **avvisi** se ce
 * n'e' almeno uno nuovo, altrimenti la **dashboard** (Luca, 21/09). Un concetto di
 * «letto» sul server non esiste — `Utenti.getBanners` manda sempre tutti gli avvisi
 * validi, e il numero rosso sulla campanella li conta tutti — quindi il «gia' visto»
 * vive nel browser.
 *
 * <p>La chiave porta il **login**, come la densita' del carattere (`density.ts`,
 * SXADV-5745.E): una chiave unica per origine sarebbe condivisa da chiunque usi quella
 * postazione, e due utenti si cancellerebbero gli avvisi a vicenda.
 *
 * <p>Se `localStorage` non e' disponibile (navigazione privata, criteri aziendali) gli
 * avvisi risultano <b>tutti nuovi</b>: la Home si apre sugli avvisi. E' il lato giusto
 * dove sbagliare — si rivede un avviso gia' letto, invece di non vederne uno nuovo.
 */
const PREFISSO = 'entrasp.ui.avvisi-visti.';
/** Quanti riconoscitori tenere: gli avvisi vecchi escono comunque dal server. */
const TETTO = 200;

const identita = (login?: string | null) => {
  const v = (login ?? '').trim().toUpperCase();
  return v ? v : null;
};

/**
 * Il riconoscitore di un avviso: data e testo. Il server non manda un id, e il testo
 * da solo non basta — lo stesso avviso puo' essere ripubblicato con una data nuova, ed
 * e' giusto che allora torni a essere nuovo.
 */
export function riconoscitore(b: Banner): string {
  const base = `${b.banDate || ''}|${b.hpText || b.text || ''}`;
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function leggi(login?: string | null): Set<string> {
  const id = identita(login);
  if (!id) return new Set();
  try {
    const raw = localStorage.getItem(PREFISSO + id);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    // niente memoria: tutto risulta nuovo, e la Home si apre sugli avvisi
    return new Set();
  }
}

/** Gli avvisi che questa persona non ha ancora visto su questo browser. */
export function avvisiNuovi(banners: Banner[], login?: string | null): Banner[] {
  const visti = leggi(login);
  return banners.filter((b) => !visti.has(riconoscitore(b)));
}

/** Segna come visti gli avvisi passati, tenendo i piu' recenti sotto il tetto. */
export function segnaVisti(banners: Banner[], login?: string | null): void {
  const id = identita(login);
  if (!id || banners.length === 0) return;
  try {
    const visti = leggi(login);
    // delete + add rimette in coda: Set.add su una chiave gia' presente non la sposta,
    // e il tetto scarterebbe un avviso permanente — che tornerebbe «nuovo» proprio
    // perche' lo si vede da sempre.
    for (const b of banners) {
      const r = riconoscitore(b);
      visti.delete(r);
      visti.add(r);
    }
    const elenco = [...visti].slice(-TETTO);
    localStorage.setItem(PREFISSO + id, JSON.stringify(elenco));
  } catch {
    // non memorizzabile: la prossima volta risulteranno nuovi, e pazienza
  }
}
