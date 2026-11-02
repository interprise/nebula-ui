// Le schede del documentale (SXADV-5789). Il documentale e' un'area a se' con schede
// proprie, come nel legacy dove e' una pagina diversa: si riconoscono dal sid, che
// comincia per "D" come quello del legacy. Il prefisso lo conosce anche il server:
// JSONMenu non le elenca in `panels`, quindi un F5 non le ricostruisce fra quelle del
// gestionale. Il contatore delle schede parte da 2: D0 e' dell'albero (api.ts), D1
// della dashboard.

export type SidebarMode = 'menu' | 'cdms';

export type CdmsFunzione = 'ricerca' | 'recenti' | 'profili' | 'utenti' | 'nuovoAlbero' | 'cestino' | 'listaNodo';

interface SchedaArea {
  sid: string;
  cdmsFunzione?: CdmsFunzione;
}

export const sidDiArea = (area: SidebarMode, n: number): string => `${area === 'cdms' ? 'D' : 'S'}${n}`;

export const isSchedaDocumentale = (t: Pick<SchedaArea, 'sid'>): boolean => t.sid.startsWith('D');

export const schedeDiArea = <T extends Pick<SchedaArea, 'sid'>>(tabs: T[], area: SidebarMode): T[] =>
  tabs.filter((t) => isSchedaDocumentale(t) === (area === 'cdms'));

// «Ricerca» e «Documenti recenti» non si chiudono, come nel legacy (closable: false).
export const schedaChiudibile = (t: SchedaArea, visibili: number): boolean =>
  visibili > 1 && t.cdmsFunzione !== 'ricerca' && t.cdmsFunzione !== 'recenti';

// Come si apre ciascuna funzione (newdocs.js: setupPanels, showTrashcan, ...).
export type FunzioneApribile = Exclude<CdmsFunzione, 'listaNodo'>;

export const APERTURA_FUNZIONE: Record<FunzioneApribile, { viewName: string; title: string; action?: string; orderBy?: string }> = {
  ricerca: { viewName: 'cdmsRisorseQuery', title: 'Ricerca', action: 'QueryPage' },
  recenti: { viewName: 'cdmsRisorseList', title: 'Documenti recenti', orderBy: 'dataUltimaRevisione desc' },
  profili: { viewName: 'cdmsProfiliList', title: 'Gestione Profili' },
  utenti: { viewName: 'cdmsUtentiList', title: 'Gestione Utenti' },
  nuovoAlbero: { viewName: 'cdmsNodiClassificazioneDetail', title: 'Aggiungi Albero', action: 'AddPage' },
  cestino: { viewName: 'cdmsRisorseListCestino', title: 'Cestino' },
};

// I sid aperti, per chiuderne le Session dopo un ricaricamento della pagina. Il
// sessionStorage puo' non esserci: senza, resta solo una Session viva fino a scadenza.
const SID_APERTI = 'nebula.documentale.sid';

const leggiSid = (): string[] => {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(SID_APERTI) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const scriviSid = (sids: string[]): void => {
  try {
    sessionStorage.setItem(SID_APERTI, JSON.stringify(sids));
  } catch {
    // vedi sopra
  }
};

export const ricordaSidDocumentale = (sid: string): void => scriviSid([...leggiSid().filter((s) => s !== sid), sid]);

export const dimenticaSidDocumentale = (sid: string): void => scriviSid(leggiSid().filter((s) => s !== sid));

export const prendiSidOrfani = (): string[] => {
  const sids = leggiSid();
  scriviSid([]);
  return sids;
};
