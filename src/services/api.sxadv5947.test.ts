import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerDownload } from './api';

// SXADV-5947: un 200 a corpo vuoto diventava un file `download.txt` da 0 byte,
// senza messaggi. triggerDownload deve rigettare e non salvare niente; il resto
// del contratto (file vero, busta errori, protocollo differito LoadFile) resta.
//
// Nessun DOM nel progetto: `document` e' finto e un file "salvato" e' un clic
// sull'ancora, col Blob che le era stato associato.

interface Saved { name: string; blob: Blob }

let fetchMock: ReturnType<typeof vi.fn>;
let saved: Saved[];
let blobs: Map<string, Blob>;

/** Le risposte, una per fetch, nell'ordine. */
function answers(...list: Response[]) {
  for (const r of list) fetchMock.mockResolvedValueOnce(r);
}

const body = (n: number) => new URLSearchParams(String((fetchMock.mock.calls[n][1] as RequestInit).body));
const url = (n: number) => fetchMock.mock.calls[n][0] as string;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json;charset=UTF-8' } });

/** Risposta binaria; senza `headers` nessuna content-type. */
const file = (headers: Record<string, string> = {}, bytes = [1, 2, 3]) =>
  new Response(new Uint8Array(bytes), { status: 200, headers });

/** Stessa forma di Util.sendJSONFile: valori codificati con URLEncoder (Java). */
const javaEnc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
const callback = (index: string, type = 'application/vnd.ms-excel', path = '/tmp/TMP1.xls') =>
  json({
    uiData: {
      callback: `handleFileDownload.createDelegate(this, [{fileName: "${javaEnc(path)}", type: "${type}", index: "${javaEnc(index)}"}])`,
    },
  });

/** Il motivo del rigetto; fallisce se la promessa si risolve. */
async function rejection(p: Promise<void>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('triggerDownload si e\' risolta: atteso un rigetto');
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  saved = [];
  blobs = new Map();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    const u = `blob:t${n++}`;
    blobs.set(u, b as Blob);
    return u;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', {
    createElement: () => {
      const a = {
        href: '',
        download: '',
        style: {},
        setAttribute: (k: string, v: string) => { (a as unknown as Record<string, string>)[k] = v; },
        remove: () => {},
        click: () => { saved.push({ name: a.download, blob: blobs.get(a.href) as Blob }); },
      };
      return a;
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SXADV-5947: 200 a corpo vuoto', () => {
  it('il caso del ticket (niente corpo, niente header): rigetta con un messaggio e non salva', async () => {
    answers(new Response(null, { status: 200 }));
    const e = await rejection(triggerDownload('FileDownload', { navpath: 'S2-0.0', option1: 'downloadXls.S2-0' }, 'S2'));
    expect(e).toBeInstanceOf(Error);
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('stringa vuota con content-type binaria: non salva', async () => {
    answers(new Response('', { status: 200, headers: { 'content-type': 'application/vnd.ms-excel' } }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
  });

  // Con la disposition il server dichiara un file: puo' essere un allegato vuoto.
  it('corpo vuoto con content-disposition: e\' un file dichiarato, si salva', async () => {
    answers(new Response(null, {
      status: 200,
      headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="vuoto.xls"' },
    }));
    await triggerDownload('FileDownload', {}, 'S1');
    expect(saved.length).toBe(1);
  });

  it('204 senza corpo: non salva', async () => {
    answers(new Response(null, { status: 204 }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
  });

  it('content-type JSON a corpo vuoto: messaggio per l\'utente, non l\'errore del parser', async () => {
    answers(new Response('', { status: 200, headers: { 'content-type': 'application/json' } }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message.trim()).not.toBe('');
    expect(e.message).not.toMatch(/JSON|Unexpected/i);
    expect(saved).toEqual([]);
  });

  it('corpo vuoto su /controller2: stesso trattamento', async () => {
    answers(new Response(null, { status: 200 }));
    const e = await rejection(triggerDownload('DocDownload', { key: 'K1' }, 'S1', 'a.pdf', true));
    expect(e.message.trim()).not.toBe('');
    expect(url(0)).toBe('/entrasp/controller2');
    expect(saved).toEqual([]);
  });
});

describe('SXADV-5947: file vero', () => {
  it('salvato col nome tra virgolette della content-disposition, byte integri', async () => {
    answers(file({ 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="Bilancio.xls"' }));
    await triggerDownload('FileDownload', {}, 'S2', 'ripiego');
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Bilancio.xls');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('nome senza virgolette', async () => {
    answers(file({ 'content-disposition': 'attachment; filename=Bilancio.xls' }));
    await triggerDownload('FileDownload', {}, 'S1');
    expect(saved[0].name).toBe('Bilancio.xls');
  });

  it('nome in forma filename*=UTF-8\'\': decodificato', async () => {
    answers(file({ 'content-disposition': "attachment; filename*=UTF-8''Bilancio%202025.xls" }));
    await triggerDownload('FileDownload', {}, 'S1');
    expect(saved[0].name).toBe('Bilancio 2025.xls');
  });

  it('un % letterale nel nome non fa perdere un file gia\' arrivato', async () => {
    answers(file({ 'content-disposition': 'attachment; filename="Sconto 10%.xls"' }));
    await triggerDownload('FileDownload', {}, 'S1');
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Sconto 10%.xls');
  });

  it('senza content-disposition: nome di ripiego', async () => {
    answers(file());
    await triggerDownload('FileDownload', {}, 'S1', 'ripiego.xls');
    expect(saved.map((s) => s.name)).toEqual(['ripiego.xls']);
  });

  it('un solo byte basta: non e\' un corpo vuoto', async () => {
    answers(file({}, [0]));
    await triggerDownload('FileDownload', {}, 'S1', 'x.bin');
    expect(saved[0].blob.size).toBe(1);
  });

  it('spedisce action, sid, navpath e option1 a /controller', async () => {
    answers(file());
    await triggerDownload('FileDownload', { navpath: 'S2-0.0', option1: 'downloadXls.S2-0' }, 'S2');
    expect(url(0)).toBe('/entrasp/controller');
    const b = body(0);
    expect(b.get('action')).toBe('FileDownload');
    expect(b.get('sid')).toBe('S2');
    expect(b.get('navpath')).toBe('S2-0.0');
    expect(b.get('option1')).toBe('downloadXls.S2-0');
  });
});

describe('SXADV-5947: risposte d\'errore', () => {
  it('busta con errors: rigetta col messaggio del server, niente file', async () => {
    answers(json({ errors: [{ type: 'ERROR', message: 'Il file non c\'e\' piu\'' }] }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message).toBe('Il file non c\'e\' piu\'');
    expect(saved).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('errors vince su un callback nella stessa busta: nessun LoadFile', async () => {
    const cb = await callback('a.xls').json();
    answers(json({ ...cb, errors: [{ message: 'no' }] }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message).toBe('no');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('busta JSON senza errors ne\' callback (p.es. sessione scaduta): rigetta, niente file', async () => {
    answers(json({ notLoggedIn: true }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
  });

  it('callback che non e\' handleFileDownload: rigetta, nessun LoadFile', async () => {
    answers(json({ uiData: { callback: 'altro()' } }));
    await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([]);
  });

  it('HTTP 500: rigetta col codice, niente file', async () => {
    answers(new Response('boom', { status: 500 }));
    const e = await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(e.message).toContain('500');
    expect(saved).toEqual([]);
  });

  it('fetch che cade (rete): il rigetto passa al chiamante', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await rejection(triggerDownload('FileDownload', {}, 'S1'));
    expect(saved).toEqual([]);
  });
});

describe('SXADV-5947: protocollo differito uiData.callback + LoadFile', () => {
  it('secondo fetch a /controller2 con fileName, type, index e il sid della scheda', async () => {
    answers(callback('Bilancio.xls'), file());
    await triggerDownload('XlsExport', {}, 'S2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(url(1)).toBe('/entrasp/controller2');
    const b = body(1);
    expect(b.get('action')).toBe('LoadFile');
    expect(b.get('sid')).toBe('S2');
    expect(b.get('fileName')).toBe('/tmp/TMP1.xls');
    expect(b.get('type')).toBe('application/vnd.ms-excel');
    expect(b.get('index')).toBe('Bilancio.xls');
  });

  it('salva i byte col nome di index', async () => {
    answers(callback('Bilancio.xls'), file({}, [9, 8]));
    await triggerDownload('XlsExport', {}, 'S1');
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Bilancio.xls');
    expect(saved[0].blob.size).toBe(2);
  });

  it('LoadFile a corpo vuoto: rigetta con un messaggio, niente file', async () => {
    answers(callback('Bilancio.xls'), new Response(null, { status: 200 }));
    const e = await rejection(triggerDownload('XlsExport', {}, 'S1'));
    expect(e).toBeInstanceOf(Error);
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
  });

  it('LoadFile a corpo vuoto anche con gli header del file: niente file', async () => {
    answers(callback('Bilancio.xls'), new Response(null, {
      status: 200,
      headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="Bilancio.xls"' },
    }));
    const e = await rejection(triggerDownload('XlsExport', {}, 'S1'));
    expect(e.message.trim()).not.toBe('');
    expect(saved).toEqual([]);
  });

  it('LoadFile in HTTP 500: rigetta col codice, niente file', async () => {
    answers(callback('Bilancio.xls'), new Response('boom', { status: 500 }));
    const e = await rejection(triggerDownload('XlsExport', {}, 'S1'));
    expect(e.message).toContain('500');
    expect(saved).toEqual([]);
  });

  it('LoadFile che risponde con la busta errors: il messaggio, non un .xls fatto di JSON', async () => {
    answers(callback('Bilancio.xls'), json({ errors: [{ message: 'file temporaneo sparito' }] }));
    const e = await rejection(triggerDownload('XlsExport', {}, 'S1'));
    expect(e.message).toBe('file temporaneo sparito');
    expect(saved).toEqual([]);
  });

  // Risposte come quelle di LoadFileCommand: la disposition c'e' sempre, con index
  // tal quale e un .zip in piu' quando il tipo e' zip.
  const loadFile = (index: string, type = 'application/vnd.ms-excel') =>
    file({
      'content-type': type,
      'content-disposition': `attachment; filename="${index}${type === 'application/zip' ? '.zip' : ''}"`,
    });

  // Util.sendJSONFile codifica con URLEncoder: lo spazio arriva come `+`.
  it('nome con spazi: `+` di URLEncoder torna spazio, nel POST e nel file', async () => {
    answers(callback('Bilancio 2025.xls'), loadFile('Bilancio 2025.xls'));
    await triggerDownload('XlsExport', {}, 'S1');
    expect(body(1).get('index')).toBe('Bilancio 2025.xls');
    expect(saved[0].name).toBe('Bilancio 2025.xls');
  });

  it('index gia\' .zip (XLSViewRenderer): niente .zip.zip', async () => {
    answers(callback('Vista.zip', 'application/zip', '/tmp/TMP2.zip'), loadFile('Vista.zip', 'application/zip'));
    await triggerDownload('XlsExport', {}, 'S1');
    expect(saved[0].name).toBe('Vista.zip');
  });

  it('index zip senza estensione: si aggiunge .zip', async () => {
    answers(callback('Report', 'application/zip', '/tmp/TMP2.zip'), loadFile('Report', 'application/zip'));
    await triggerDownload('XlsExport', {}, 'S1');
    expect(saved[0].name).toBe('Report.zip');
  });

  it('un ; nel nome non lo tronca', async () => {
    answers(callback('Bilancio; 2025.xls'), loadFile('Bilancio; 2025.xls'));
    await triggerDownload('XlsExport', {}, 'S1');
    expect(saved[0].name).toBe('Bilancio; 2025.xls');
  });
});
