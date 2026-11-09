// SXADV-5909: prova sul sorgente della vista utentiDetail (repo fratello entrasp).
// "Azienda e profilo correnti" sta prima di Login, con accanto il combo del
// profilo senza prompt, come nel legacy; "Profilo documentale" resta.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const VIEW_REL = 'src/it/interprise/entrasp/view/utentiDetail.xml';
const viewPath = resolve(here, '../../../entrasp', VIEW_REL);
const legacyPath = resolve(homedir(), 'eclipse-nw/entrasp', VIEW_REL);

type Item = Record<string, string>;

/** Gli ViewItem di primo livello della <View name=...>, nell'ordine del file. */
function itemsOf(path: string, viewName: string): Item[] {
  // La vista e' dichiarata ISO-8859-1: si decodifica come tale.
  const xml = readFileSync(path, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
  const m = xml.match(new RegExp(`<View\\s+name="${viewName}"[\\s\\S]*?</View>`));
  if (!m) throw new Error(`vista ${viewName} non trovata in ${path}`);
  return [...m[0].matchAll(/<ViewItem\b([^>]*?)\/?>/g)].map((t) => {
    const attrs: Item = {};
    for (const a of t[1].matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

const items = itemsOf(viewPath, 'utentiDetail');
const contents = items.map((i) => i.content);

describe('SXADV-5909 utentiDetail: testata', () => {
  it('apre con azienda, profilo, login, reset password, in questo ordine', () => {
    expect(contents.slice(0, 4)).toEqual(['azienda', 'profilo', 'login', 'UtentiResetPassword']);
  });

  it('azienda: prompt del ticket, List, size 40, a inizio riga', () => {
    const a = items[0];
    expect(a.prompt).toBe('Azienda e profilo correnti:');
    expect(a.controlType).toBe('List');
    expect(a.size).toBe('40');
    expect(a.newLine).not.toBe('false');
  });

  it('azienda non forza la modificabilita: la sola lettura viene dalla relazione', () => {
    expect(items[0].isEditable).toBeUndefined();
    expect(items[0].forceEditable).toBeUndefined();
  });

  it('il profilo accanto: stessa riga, editabile, size 20, List, senza prompt', () => {
    const p = items[1];
    expect(p.content).toBe('profilo');
    expect(p.controlType).toBe('List');
    expect(p.newLine).toBe('false');
    expect(p.isEditable).toBe('true');
    expect(p.size).toBe('20');
    expect(p.prompt).toBeUndefined();
  });

  it('il profilo accanto non dipende dalla configurazione', () => {
    expect(items[1].ifConfigValue).toBeUndefined();
  });

  it('login resta in testa alla propria riga, col reset accanto', () => {
    expect(items[2].newLine).not.toBe('false');
    expect(items[3].newLine).toBe('false');
    expect(items[3].isVisible).toBe('?!insert');
  });

  it('azienda e login compaiono una volta sola', () => {
    expect(contents.filter((c) => c === 'azienda')).toHaveLength(1);
    expect(contents.filter((c) => c === 'login')).toHaveLength(1);
  });

  it('oltre al combo accanto resta solo il Profilo: condizionato da profiloPerUtente', () => {
    const profili = items.filter((i) => i.content === 'profilo');
    expect(profili).toHaveLength(2);
    expect(profili[1].prompt).toBe('Profilo:');
    expect(profili[1].ifConfigValue).toBe('security.profiloPerUtente');
  });

  it('Gruppo resta condizionato al contrario: con la chiave a 0 si vede lui', () => {
    const g = items.find((i) => i.content === 'gruppoUtenti');
    expect(g?.ifConfigValue).toBe('!security.profiloPerUtente');
  });

  it('Profilo documentale resta (scelta aperta), legato al modulo cdms', () => {
    const d = items.find((i) => i.content === 'profiloDocumentale');
    expect(d?.prompt).toBe('Profilo documentale:');
    expect(d?.moduleName).toBe('cdms');
  });

  it('il file resta ISO-8859-1: le vocali accentate non diventano UTF-8', () => {
    const raw = readFileSync(viewPath);
    expect(raw.subarray(0, 60).toString('latin1')).toContain('encoding="iso-8859-1"');
    const hint = raw.toString('latin1');
    expect(hint).toContain("Se l'utente si è scordato");
    expect(hint).not.toContain('Ã¨');
  });
});

describe.skipIf(!existsSync(legacyPath))('SXADV-5909 utentiDetail: confronto col legacy', () => {
  const legacy = existsSync(legacyPath) ? itemsOf(legacyPath, 'utentiDetail') : [];

  it('i primi quattro item hanno gli stessi attributi del legacy', () => {
    expect(items.slice(0, 4)).toEqual(legacy.slice(0, 4));
  });

  it('nessun item del legacy manca nella vista', () => {
    const missing = legacy.map((i) => i.content).filter((c) => !contents.includes(c));
    expect(missing).toEqual([]);
  });

  it('rispetto al legacy gli unici item in piu sono quelli del documentale', () => {
    const legacyContents = legacy.map((i) => i.content);
    expect(contents.filter((c) => !legacyContents.includes(c))).toEqual(['profiloDocumentale']);
  });
});
