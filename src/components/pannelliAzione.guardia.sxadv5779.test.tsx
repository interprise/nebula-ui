import { describe, it, expect } from 'vitest';
import ts from 'typescript';

// SXADV-5779 — guardia trasversale: Annulla all'estrema destra anche nel DOM, cosi'
// un dialogo nuovo non torna all'ordine predefinito di antd (Annulla, poi l'azione).
//
// I casi che esistono davvero nei sorgenti, e che la guardia riconosce sull'albero
// sintattico (non a regex: un <Button> va a capo, un footer sta su piu' righe):
//   1. modal.confirm({...}): il footer predefinito mette Annulla PRIMA, quindi serve
//      `footer`, che sia annullaADestra o una funzione con <CancelBtn /> per ultimo;
//   2. <Modal>: stessa cosa; footer={null} va bene, non ha pulsanti;
//   3. <Button>Annulla</Button> scritto a mano (footer di Modal e Drawer, extra del
//      Drawer, barre): dopo di lui, fra i fratelli, nessun altro Button;
//   4. tutto quello che porta `cancelText` altrove (Popconfirm, un involucro) non si
//      puo' verificare: si segnala, chi lo aggiunge guarda e decide.

type Esito = { problemi: string[]; conferme: number; modali: number; annulla: number };

const nomeTag = (t: ts.JsxTagNameExpression) => t.getText();

function testoDiretto(el: ts.JsxElement): string {
  return el.children
    .map((c) => {
      if (ts.isJsxText(c)) return c.text;
      if (ts.isJsxExpression(c) && c.expression && ts.isStringLiteralLike(c.expression)) return c.expression.text;
      return '\u0000';
    })
    .join('')
    .trim();
}

function contieneButton(n: ts.Node): boolean {
  if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && nomeTag(n.tagName) === 'Button') return true;
  return !!ts.forEachChild(n, (c) => contieneButton(c) || undefined);
}

/** Il nodo che sta davvero fra i fratelli: `{cond && <Button/>}`, `(<Button/>)`. */
function salitaAlFratello(n: ts.Node): ts.Node {
  let cur = n;
  while (
    ts.isParenthesizedExpression(cur.parent) ||
    ts.isJsxExpression(cur.parent) ||
    ts.isConditionalExpression(cur.parent) ||
    (ts.isBinaryExpression(cur.parent) && cur.parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
  ) {
    cur = cur.parent;
  }
  return cur;
}

function fratelliDopo(n: ts.Node): readonly ts.Node[] {
  const su = salitaAlFratello(n);
  const p = su.parent;
  let tutti: readonly ts.Node[] = [];
  if (ts.isJsxElement(p) || ts.isJsxFragment(p)) tutti = p.children;
  else if (ts.isArrayLiteralExpression(p)) tutti = p.elements;
  const i = tutti.indexOf(su);
  return i < 0 ? [] : tutti.slice(i + 1);
}

/** undefined = il footer rispetta l'ordine, altrimenti il perche' no. */
function giudicaFooter(e: ts.Expression): string | undefined {
  if (e.kind === ts.SyntaxKind.NullKeyword) return undefined;
  if (ts.isIdentifier(e)) return e.text === 'annullaADestra' ? undefined : `footer "${e.text}" non verificabile`;
  if (ts.isArrayLiteralExpression(e) || ts.isJsxElement(e) || ts.isJsxFragment(e) || ts.isJsxSelfClosingElement(e)) {
    return undefined; // i <Button> scritti a mano li guarda la regola 3
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    const tag: string[] = [];
    const visita = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) tag.push(nomeTag(n.tagName));
      ts.forEachChild(n, visita);
    };
    visita(e.body);
    const pulsanti = tag.filter((t) => t === 'OkBtn' || t === 'CancelBtn' || t === 'Button');
    if (pulsanti.includes('CancelBtn') && pulsanti[pulsanti.length - 1] !== 'CancelBtn') {
      return `CancelBtn non e' l'ultimo pulsante del footer (${pulsanti.join(', ')})`;
    }
    return undefined;
  }
  return `footer non verificabile: ${e.getText().slice(0, 40)}`;
}

function analizza(nomeFile: string, testo: string): Esito {
  const sf = ts.createSourceFile(nomeFile, testo, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out: Esito = { problemi: [], conferme: 0, modali: 0, annulla: 0 };
  const segnala = (n: ts.Node, msg: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    out.problemi.push(`${nomeFile}:${line + 1} ${msg}`);
  };

  const visita = (n: ts.Node) => {
    // 1. modal.confirm
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'confirm') {
      const ricevente = n.expression.expression.getText();
      const arg = n.arguments[0];
      const haOggetto = !!arg && ts.isObjectLiteralExpression(arg);
      if (/modal/i.test(ricevente) || haOggetto) {
        out.conferme++;
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          segnala(n, `${ricevente}.confirm con argomento non verificabile`);
        } else {
          const footer = arg.properties.find(
            (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'footer',
          );
          if (!footer) segnala(n, `${ricevente}.confirm senza footer: antd mette Annulla prima`);
          else {
            const g = giudicaFooter(footer.initializer);
            if (g) segnala(n, g);
          }
        }
      }
    }
    // 2 e 4. tag con footer/cancelText
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = nomeTag(n.tagName);
      const attr = (nome: string) =>
        n.attributes.properties.find(
          (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === nome,
        );
      if (tag === 'Modal') {
        out.modali++;
        const f = attr('footer');
        if (!f) segnala(n, '<Modal> senza footer: antd mette Annulla prima');
        else if (f.initializer && ts.isJsxExpression(f.initializer) && f.initializer.expression) {
          const g = giudicaFooter(f.initializer.expression);
          if (g) segnala(n, g);
        }
      } else if (tag === 'Popconfirm') {
        segnala(n, '<Popconfirm>: antd mette Annulla prima e non ha un footer da riordinare');
      } else if (attr('cancelText')) {
        segnala(n, `<${tag} cancelText=...>: ordine non verificabile`);
      }
    }
    // 3. <Button>Annulla</Button>
    if (ts.isJsxElement(n) && nomeTag(n.openingElement.tagName) === 'Button' && testoDiretto(n) === 'Annulla') {
      out.annulla++;
      if (fratelliDopo(n).some(contieneButton)) segnala(n, '<Button>Annulla</Button> seguito da un altro Button');
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return out;
}

const sorgenti = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const fogli = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const diProduzione = Object.entries(sorgenti).filter(([f]) => !/\.test\.tsx?$/.test(f));

describe('SXADV-5779 la guardia sa riconoscere un dialogo sbagliato', () => {
  const sbagliati: Array<[string, string]> = [
    ['confirm senza footer', `modal.confirm({ title: 'x', okText: 'OK', cancelText: 'Annulla' });`],
    ['Modal.confirm senza footer, anche senza cancelText', `Modal.confirm({ title: 'x' });`],
    ['confirm da una variabile', `const c = {}; modal.confirm(c);`],
    ['confirm con footer invertito', `modal.confirm({ footer: (_, { OkBtn, CancelBtn }) => <><CancelBtn /><OkBtn /></> });`],
    ['confirm con un pulsante dopo CancelBtn', `modal.confirm({ footer: (_, { OkBtn, CancelBtn }) => <><CancelBtn /><Button>No</Button><OkBtn /></> });`],
    ['confirm con footer sconosciuto', `modal.confirm({ footer: altro });`],
    ['Modal senza footer', `const a = <Modal open title="x" okText="Si" cancelText="Annulla">c</Modal>;`],
    ['Modal autochiuso senza footer', `const a = <Modal open />;`],
    ['Annulla prima in un array', `const a = <Modal footer={[<Button key="a">Annulla</Button>, <Button key="b">OK</Button>]} />;`],
    ['Annulla prima in uno Space', `const a = <Space><Button>Annulla</Button><Button type="primary">Salva</Button></Space>;`],
    ['Annulla a capo e prima', `const a = <div><Button size="small">\n  Annulla\n</Button>\n<Button>Salva</Button></div>;`],
    ['azione dopo Annulla, ma condizionale', `const a = <div><Button>Annulla</Button>{ok && <Button>Salva</Button>}</div>;`],
    ['azione dopo Annulla, dentro un Tooltip', `const a = <div><Button>Annulla</Button><Tooltip><Button>Salva</Button></Tooltip></div>;`],
    ['Annulla condizionale, poi azione', `const a = <div>{no && <Button>Annulla</Button>}<Button>Salva</Button></div>;`],
    ['Popconfirm', `const a = <Popconfirm title="x" okText="Si" cancelText="Annulla"><a /></Popconfirm>;`],
    ['involucro con cancelText', `const a = <Finestra cancelText="Annulla" />;`],
  ];
  it.each(sbagliati)('%s', (_, testo) => {
    expect(analizza('prova.tsx', testo).problemi).toHaveLength(1);
  });

  const giusti: Array<[string, string]> = [
    ['annullaADestra su confirm', `modal.confirm({ title: 'x', footer: annullaADestra });`],
    ['annullaADestra su Modal', `const a = <Modal footer={annullaADestra} />;`],
    ['Modal senza pulsanti', `const a = <Modal footer={null} />;`],
    ['footer scritto a mano in ordine', `modal.confirm({ footer: (_, { OkBtn, CancelBtn }) => <><OkBtn /><Button>No</Button><CancelBtn /></> });`],
    ['array in ordine', `const a = <Modal footer={[<Button key="b">OK</Button>, <Button key="a">Annulla</Button>]} />;`],
    ['Space in ordine', `const a = <Space><Button type="primary">Salva</Button><Button>Annulla</Button></Space>;`],
    ['feedback.confirm non e\' un dialogo da guardare qui', `feedback.confirm('D?', 'T', () => {});`],
    ['Annulla con un Input dopo', `const a = <div><Button>Annulla</Button><Input /></div>;`],
  ];
  it.each(giusti)('%s', (_, testo) => {
    expect(analizza('prova.tsx', testo).problemi).toEqual([]);
  });
});

describe('SXADV-5779 guardia sui sorgenti', () => {
  it('nessuna finestra di src/ mette Annulla prima dell\'azione', () => {
    const problemi = diProduzione.flatMap(([f, t]) => analizza(f, t).problemi);
    expect(problemi).toEqual([]);
  });

  it('la guardia ha davvero guardato i dialoghi che esistono', () => {
    // Una guardia che non trova niente passa sempre: i posti noti al 02/11/2026 sono
    // 8 conferme (CdmsTree 3, feedback 2, Toolbar, EditPanel, AttachmentsDrawer),
    // 4 <Modal> e 5 <Button>Annulla</Button>. Se se ne tolgono, si abbassano questi.
    const tot = diProduzione.map(([f, t]) => analizza(f, t));
    expect(tot.reduce((a, e) => a + e.conferme, 0)).toBeGreaterThanOrEqual(8);
    expect(tot.reduce((a, e) => a + e.modali, 0)).toBeGreaterThanOrEqual(4);
    expect(tot.reduce((a, e) => a + e.annulla, 0)).toBeGreaterThanOrEqual(5);
  });

  it('i fogli di stile non rimettono in vista un ordine diverso da quello del DOM', () => {
    // L'ordine sta nel DOM perche' il Tab segua quello che si vede: rovesciare i
    // pulsanti da CSS riaprirebbe la divergenza.
    const regola = /[^{}]*(ant-modal-footer|ant-modal-confirm-btns|ant-drawer-extra|ant-drawer-footer)[^{}]*\{[^}]*\}/g;
    const colpevoli = Object.entries(fogli).flatMap(([f, css]) =>
      [...css.matchAll(regola)]
        .filter((m) => /row-reverse|(^|[\s;{])order\s*:/.test(m[0]))
        .map((m) => `${f}: ${m[0].trim().slice(0, 80)}`),
    );
    expect(colpevoli).toEqual([]);
  });
});
