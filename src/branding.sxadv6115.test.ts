import { describe, it, expect } from 'vitest';
import { productLogo, brandFavicon, applyBrandFavicon } from './branding';
// Il sorgente come testo via Vite: il tsconfig dell'app non ha i tipi di Node.
import shellSource from './components/Shell.tsx?raw';

// SXADV-6115 — il logo del prodotto "Pandora" nel client React cambia: al posto
// di /entrasp/images/logos/pandora_bianco.png arriva un asset importato da Vite
// (src/assets/pandora-logo.png), e con Pandora anche l'icona della pagina
// (src/assets/pandora-favicon.png). Nebula resta com'era: logo_sx.png, che su
// ALFA il server sostituisce da se' (vedi la memoria "ALFA si dichiara con
// l'asset del logo"), quindi Nebula DEVE continuare a puntarlo.
//
// Il server manda il marchio esattamente come 'Pandora': ogni altra grafia
// (minuscolo, spazi) non e' Pandora e ricade su Nebula.
//
// Niente jsdom nel progetto: per applyBrandFavicon un Document finto, largo
// abbastanza da reggere le vie ragionevoli per trovare/creare il <link rel=icon>
// (querySelector su document o head, getElementsByTagName, createElement,
// appendChild, remove, attributi e proprieta' href/type).

const OLD_PANDORA = '/entrasp/images/logos/pandora_bianco.png';
const NEBULA = '/entrasp/images/logos/logo_sx.png';

// ---------------------------------------------------------------------------
// Document finto
// ---------------------------------------------------------------------------

class FakeEl {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  ownerDocument: FakeDoc;
  constructor(tag: string, doc: FakeDoc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
  }
  get nodeName() { return this.tagName; }
  getAttribute(n: string) { return this.attrs.has(n) ? this.attrs.get(n)! : null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, String(v)); }
  hasAttribute(n: string) { return this.attrs.has(n); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  // proprieta' riflesse come nel DOM (href resta qui la stringa dell'attributo:
  // l'asserzione confronta col valore impostato, non con l'URL assoluto)
  get href() { return this.attrs.get('href') ?? ''; }
  set href(v: string) { this.attrs.set('href', String(v)); }
  get type() { return this.attrs.get('type') ?? ''; }
  set type(v: string) { this.attrs.set('type', String(v)); }
  get rel() { return this.attrs.get('rel') ?? ''; }
  set rel(v: string) { this.attrs.set('rel', String(v)); }
  get relList() {
    const toks = () => this.rel.split(/\s+/).filter(Boolean);
    return {
      contains: (t: string) => toks().includes(t),
      add: (t: string) => { if (!toks().includes(t)) this.rel = [...toks(), t].join(' '); },
    };
  }
  appendChild<T extends FakeEl>(c: T): T {
    if (c.parentNode) c.parentNode.removeChild(c);
    this.children.push(c);
    c.parentNode = this;
    return c;
  }
  append(...cs: FakeEl[]) { cs.forEach((c) => this.appendChild(c)); }
  prepend(...cs: FakeEl[]) {
    cs.reverse().forEach((c) => {
      if (c.parentNode) c.parentNode.removeChild(c);
      this.children.unshift(c);
      c.parentNode = this;
    });
  }
  insertBefore<T extends FakeEl>(c: T, ref: FakeEl | null): T {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    this.children.splice(this.children.indexOf(ref), 0, c);
    c.parentNode = this;
    return c;
  }
  get firstChild() { return this.children[0] ?? null; }
  removeChild<T extends FakeEl>(c: T): T {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
    return c;
  }
  remove() { this.parentNode?.removeChild(this); }
  get isConnected() { return this.parentNode !== null; }
  private all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  getElementsByTagName(t: string) {
    return this.all().filter((e) => e.tagName === t.toUpperCase());
  }
  // Selettori accettati: quelli che un'implementazione userebbe per l'icona
  // (link[rel="icon"], link[rel~="icon"], link[rel*="icon"], link[rel='icon']...).
  querySelectorAll(sel: string): FakeEl[] {
    return sel.split(',').flatMap((s) => this.match(s.trim()));
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  private match(s: string): FakeEl[] {
    const m = /^(\w+)?(?:\[rel\s*([~*|^$]?=)\s*["']?([^"'\]]+)["']?\s*(?:i)?\])?$/.exec(s);
    if (!m) throw new Error(`selettore non previsto dal Document finto: ${s}`);
    const [, tag, op, val] = m;
    return this.all().filter((e) => {
      if (tag && e.tagName !== tag.toUpperCase()) return false;
      if (!op) return true;
      const rel = e.rel;
      const toks = rel.split(/\s+/).filter(Boolean);
      switch (op) {
        case '=': return rel === val;
        case '~=': return toks.includes(val);
        case '*=': return rel.includes(val);
        case '^=': return rel.startsWith(val);
        case '$=': return rel.endsWith(val);
        case '|=': return rel === val || rel.startsWith(val + '-');
        default: return false;
      }
    });
  }
}

class FakeDoc {
  documentElement: FakeEl;
  head: FakeEl;
  body: FakeEl;
  constructor() {
    this.documentElement = new FakeEl('html', this);
    this.head = new FakeEl('head', this);
    this.body = new FakeEl('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(t: string) { return new FakeEl(t, this); }
  querySelector(s: string) { return this.documentElement.querySelector(s); }
  querySelectorAll(s: string) { return this.documentElement.querySelectorAll(s); }
  getElementsByTagName(t: string) { return this.documentElement.getElementsByTagName(t); }
}

function docWithIcon(href = '/entrasp/app/favicon.ico', type: string | null = 'image/x-icon') {
  const doc = new FakeDoc();
  const link = doc.createElement('link');
  link.setAttribute('rel', 'icon');
  if (type !== null) link.setAttribute('type', type);
  link.setAttribute('href', href);
  doc.head.appendChild(link);
  return { doc, link };
}

const asDoc = (d: FakeDoc) => d as unknown as Document;
const iconLinks = (d: FakeDoc) =>
  d.getElementsByTagName('link').filter((l) => l.rel.split(/\s+/).includes('icon'));

// ---------------------------------------------------------------------------
// productLogo
// ---------------------------------------------------------------------------

describe('SXADV-6115 productLogo', () => {
  it("Pandora -> il logo NUOVO (asset Vite pandora-logo), non piu' pandora_bianco.png", () => {
    const url = productLogo('Pandora');
    expect(typeof url).toBe('string');
    expect(url).not.toBe(OLD_PANDORA);
    expect(url).not.toContain('pandora_bianco');
    expect(url).toContain('pandora-logo');
    expect(url).not.toBe(NEBULA);
  });

  it('Nebula, marchio assente o vuoto -> logo_sx.png (su ALFA lo sostituisce il server)', () => {
    expect(productLogo('Nebula')).toBe(NEBULA);
    expect(productLogo(undefined)).toBe(NEBULA);
    expect(productLogo()).toBe(NEBULA);
    expect(productLogo('')).toBe(NEBULA);
  });

  it("solo 'Pandora' esatto e' Pandora: altre grafie ricadono su Nebula", () => {
    for (const b of ['pandora', 'PANDORA', ' Pandora', 'Pandora ', 'Pandora2', 'Altro']) {
      expect(productLogo(b), `brand=${JSON.stringify(b)}`).toBe(NEBULA);
    }
  });

  it('e una funzione pura: stessa risposta a chiamate ripetute', () => {
    expect(productLogo('Pandora')).toBe(productLogo('Pandora'));
    expect(productLogo('Nebula')).toBe(productLogo('Nebula'));
  });
});

// ---------------------------------------------------------------------------
// brandFavicon
// ---------------------------------------------------------------------------

describe('SXADV-6115 brandFavicon', () => {
  it("Pandora -> l'asset pandora-favicon", () => {
    const url = brandFavicon('Pandora');
    expect(typeof url).toBe('string');
    expect(url).toContain('pandora-favicon');
    expect(url).not.toBe(productLogo('Pandora'));
  });

  it("qualunque altro marchio -> null (Nebula tiene l'icona della pagina)", () => {
    for (const b of [undefined, '', 'Nebula', 'pandora', 'PANDORA', ' Pandora']) {
      expect(brandFavicon(b), `brand=${JSON.stringify(b)}`).toBeNull();
    }
    expect(brandFavicon()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyBrandFavicon
// ---------------------------------------------------------------------------

describe('SXADV-6115 applyBrandFavicon', () => {
  it("Pandora con <link rel=icon> presente: ne cambia href e type, senza aggiungerne un altro", () => {
    const { doc, link } = docWithIcon();
    applyBrandFavicon('Pandora', asDoc(doc));
    expect(iconLinks(doc)).toHaveLength(1);
    expect(iconLinks(doc)[0]).toBe(link);
    expect(link.getAttribute('href')).toBe(brandFavicon('Pandora'));
    expect(link.getAttribute('type')).toBe('image/png');
  });

  it('la pulizia rimette href e type di prima, esattamente', () => {
    const { doc, link } = docWithIcon('/entrasp/app/favicon.ico', 'image/x-icon');
    const cleanup = applyBrandFavicon('Pandora', asDoc(doc));
    cleanup();
    expect(link.getAttribute('href')).toBe('/entrasp/app/favicon.ico');
    expect(link.getAttribute('type')).toBe('image/x-icon');
    expect(iconLinks(doc)).toEqual([link]);
    expect(link.parentNode).toBe(doc.head);
  });

  it("la pulizia rimette anche l'ASSENZA di type, se prima non c'era", () => {
    const { doc, link } = docWithIcon('/favicon.svg', null);
    const cleanup = applyBrandFavicon('Pandora', asDoc(doc));
    expect(link.getAttribute('type')).toBe('image/png');
    cleanup();
    expect(link.getAttribute('href')).toBe('/favicon.svg');
    // nessun type: ne' 'image/png' rimasto, ne' una stringa inventata
    expect(link.getAttribute('type') ?? '').toBe('');
  });

  it('senza <link rel=icon>: ne crea uno in head, e la pulizia lo toglie', () => {
    const doc = new FakeDoc();
    const cleanup = applyBrandFavicon('Pandora', asDoc(doc));
    const created = iconLinks(doc);
    expect(created).toHaveLength(1);
    expect(created[0].parentNode).toBe(doc.head);
    expect(created[0].getAttribute('href')).toBe(brandFavicon('Pandora'));
    expect(created[0].getAttribute('type')).toBe('image/png');
    cleanup();
    expect(iconLinks(doc)).toHaveLength(0);
    expect(doc.head.children).toHaveLength(0);
  });

  it('la pulizia e idempotente: chiamata due volte non rompe ne altera', () => {
    const { doc, link } = docWithIcon('/a.ico', 'image/x-icon');
    const cleanup = applyBrandFavicon('Pandora', asDoc(doc));
    cleanup();
    expect(() => cleanup()).not.toThrow();
    expect(link.getAttribute('href')).toBe('/a.ico');
    expect(link.getAttribute('type')).toBe('image/x-icon');
    expect(iconLinks(doc)).toEqual([link]);

    const empty = new FakeDoc();
    const c2 = applyBrandFavicon('Pandora', asDoc(empty));
    c2();
    expect(() => c2()).not.toThrow();
    expect(iconLinks(empty)).toHaveLength(0);
  });

  it('Nebula / marchio assente / grafia diversa: nessun cambiamento, pulizia innocua', () => {
    for (const b of [undefined, '', 'Nebula', 'pandora']) {
      const { doc, link } = docWithIcon('/entrasp/app/favicon.ico', 'image/x-icon');
      const cleanup = applyBrandFavicon(b, asDoc(doc));
      expect(typeof cleanup).toBe('function');
      expect(link.getAttribute('href')).toBe('/entrasp/app/favicon.ico');
      expect(link.getAttribute('type')).toBe('image/x-icon');
      expect(() => cleanup()).not.toThrow();
      expect(link.getAttribute('href')).toBe('/entrasp/app/favicon.ico');
      expect(link.getAttribute('type')).toBe('image/x-icon');
      expect(iconLinks(doc)).toEqual([link]);
    }
  });

  it('Nebula senza <link rel=icon>: non ne crea nessuno', () => {
    const doc = new FakeDoc();
    const cleanup = applyBrandFavicon('Nebula', asDoc(doc));
    expect(iconLinks(doc)).toHaveLength(0);
    cleanup();
    expect(iconLinks(doc)).toHaveLength(0);
  });

  it("cambio di marchio Pandora -> Nebula: la pulizia di Pandora riporta l'icona di pagina", () => {
    // come un effetto React: [brand] cambia, gira la pulizia vecchia e poi la nuova applicazione
    const { doc, link } = docWithIcon('/entrasp/app/favicon.ico', 'image/x-icon');
    const c1 = applyBrandFavicon('Pandora', asDoc(doc));
    expect(link.getAttribute('href')).toBe(brandFavicon('Pandora'));
    c1();
    const c2 = applyBrandFavicon('Nebula', asDoc(doc));
    expect(link.getAttribute('href')).toBe('/entrasp/app/favicon.ico');
    expect(link.getAttribute('type')).toBe('image/x-icon');
    c2();
    expect(link.getAttribute('href')).toBe('/entrasp/app/favicon.ico');
    expect(iconLinks(doc)).toEqual([link]);
  });

  it('Pandora applicato due volte di fila (pulizia in ordine inverso): torna allo stato iniziale', () => {
    // StrictMode monta, smonta e rimonta: le due pulizie girano in ordine inverso
    const { doc, link } = docWithIcon('/orig.ico', 'image/x-icon');
    const c1 = applyBrandFavicon('Pandora', asDoc(doc));
    c1();
    const c2 = applyBrandFavicon('Pandora', asDoc(doc));
    expect(link.getAttribute('href')).toBe(brandFavicon('Pandora'));
    c2();
    expect(link.getAttribute('href')).toBe('/orig.ico');
    expect(link.getAttribute('type')).toBe('image/x-icon');
    expect(iconLinks(doc)).toEqual([link]);
  });
});

// ---------------------------------------------------------------------------
// Shell.tsx: il logo di testata passa da productLogo
// ---------------------------------------------------------------------------

describe('SXADV-6115 Shell usa productLogo', () => {
  const src = shellSource;

  it("non riferisce piu' pandora_bianco.png", () => {
    expect(src).not.toContain('pandora_bianco');
  });

  it('importa productLogo da branding e lo chiama col marchio di loginInfo', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bproductLogo\b[^}]*\}\s*from\s*['"]\.\.\/branding['"]/);
    expect(src).toMatch(/productLogo\(\s*loginInfo(\?)?\.brand\s*\)/);
  });
});
