import type { CalcAst } from './types';

/** Evaluate a serialized calculated-measure AST against a row's already-summed
 *  base-measure values. Mirrors `CalculationVisitor` in CORE: post-order walk
 *  pushing onto a stack, then per-node visit pops operands and pushes the
 *  result. Returns the final stack value (number, or null when any input
 *  is null or division-by-zero/unsupported op short-circuits).
 *
 *  Operator-vs-arg-order semantics match the Java visitor verbatim so the
 *  React cube matches the legacy HTML cube cell-for-cell, even where the
 *  Java pop order is the opposite of source order. */
export function evalCalc(
  ast: CalcAst | undefined,
  measureValues: Record<string, number | null | undefined>,
): number | null {
  if (!ast || ast.kind === 'null') return null;
  const stack: (number | null)[] = [];
  walk(ast, stack, measureValues);
  return stack.length > 0 ? (stack.pop() as number | null) : null;
}

function walk(
  node: CalcAst,
  stack: (number | null)[],
  measureValues: Record<string, number | null | undefined>,
): void {
  if ('args' in node && node.args) {
    for (const child of node.args) walk(child, stack, measureValues);
  }
  visit(node, stack, measureValues);
}

function visit(
  node: CalcAst,
  stack: (number | null)[],
  measureValues: Record<string, number | null | undefined>,
): void {
  switch (node.kind) {
    case 'atom': {
      const v = measureValues[node.token];
      stack.push(v == null ? null : v);
      return;
    }
    case 'num': {
      const n = Number(node.token);
      stack.push(Number.isFinite(n) ? n : null);
      return;
    }
    case 'op': {
      const argc = node.args?.length ?? 0;
      if (argc === 2) {
        // Java CalculationVisitor pops `left` first (LIFO ⇒ second arg),
        // then `right` (first arg), and computes `left OP right`. We mirror
        // that ordering so cell values match the legacy renderer exactly.
        const left = stack.pop() ?? null;
        const right = stack.pop() ?? null;
        if (left == null || right == null) {
          stack.push(null);
          return;
        }
        let r: number | null = null;
        switch (node.token) {
          case '+': r = left + right; break;
          case '-': r = left - right; break;
          case '*': r = left * right; break;
          case '/': r = right === 0 ? null : left / right; break;
        }
        stack.push(r);
        return;
      }
      // Unary
      const v = stack.pop() ?? null;
      if (v == null) { stack.push(null); return; }
      stack.push(node.token === '-' ? -v : null);
      return;
    }
    case 'fn': {
      if (node.token === 'round') {
        // Mirrors visitor: pops `value` first (top), then `decs`.
        const value = stack.pop() ?? null;
        const decs = stack.pop() ?? null;
        if (value == null) { stack.push(null); return; }
        const d = decs == null ? 0 : Math.trunc(decs);
        const f = Math.pow(10, d);
        stack.push(Math.round(value * f) / f);
        return;
      }
      // Unsupported function — drop its operands and yield null so the
      // calculated cell renders empty rather than masking an upstream bug.
      const argc = node.args?.length ?? 0;
      for (let i = 0; i < argc; i++) stack.pop();
      stack.push(null);
      return;
    }
    case 'unknown':
    case 'null':
    default:
      stack.push(null);
      return;
  }
}
