import { Dec } from "./decimal";

/**
 * Quantity formulas, e.g. `ceil(height / 450) * 2` or `area * 1.05`. A small safe grammar
 * (numbers, variables, + - * / ( ), ceil floor round min max abs); never evaluated as code.
 */
export type Node =
  | { type: "num"; value: string }
  | { type: "var"; name: string }
  | { type: "neg"; value: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

export class FormulaError extends Error {
  constructor(message: string, readonly position: number) { super(message); }
}

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ceil: { min: 1, max: 2 }, floor: { min: 1, max: 2 }, round: { min: 1, max: 2 },
  min: { min: 2, max: 10 }, max: { min: 2, max: 10 }, abs: { min: 1, max: 1 },
};

type Token = { kind: "num" | "id" | "op" | "(" | ")" | ","; text: string; at: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    const number = /^\d+(\.\d+)?/.exec(source.slice(i));
    if (number) { tokens.push({ kind: "num", text: number[0], at: i }); i += number[0].length; continue; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(source.slice(i));
    if (id) { tokens.push({ kind: "id", text: id[0].toLowerCase(), at: i }); i += id[0].length; continue; }
    if ("+-*/".includes(ch)) { tokens.push({ kind: "op", text: ch, at: i }); i += 1; continue; }
    if (ch === "(" || ch === ")" || ch === ",") { tokens.push({ kind: ch, text: ch, at: i }); i += 1; continue; }
    throw new FormulaError(`Unexpected "${ch}"`, i);
  }
  return tokens;
}

export function parseFormula(source: string): Node {
  if (source.length > 500) throw new FormulaError("Formula is too long", 500);
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const expect = (kind: Token["kind"], text?: string) => {
    const token = tokens[pos];
    if (!token || token.kind !== kind || (text && token.text !== text)) throw new FormulaError(`Expected ${text ?? kind}`, token?.at ?? source.length);
    pos += 1; return token;
  };
  const expr = (): Node => {
    let left = term();
    while (peek()?.kind === "op" && (peek().text === "+" || peek().text === "-")) { const op = expect("op").text as "+" | "-"; left = { type: "bin", op, left, right: term() }; }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (peek()?.kind === "op" && (peek().text === "*" || peek().text === "/")) { const op = expect("op").text as "*" | "/"; left = { type: "bin", op, left, right: unary() }; }
    return left;
  };
  const unary = (): Node => {
    if (peek()?.kind === "op" && peek().text === "-") { pos += 1; return { type: "neg", value: unary() }; }
    if (peek()?.kind === "op" && peek().text === "+") { pos += 1; return unary(); }
    return primary();
  };
  const primary = (): Node => {
    const token = peek();
    if (!token) throw new FormulaError("Formula ends too early", source.length);
    if (token.kind === "num") { pos += 1; return { type: "num", value: token.text }; }
    if (token.kind === "(") { pos += 1; const inner = expr(); expect(")"); return inner; }
    if (token.kind === "id") {
      pos += 1;
      if (peek()?.kind === "(") {
        const spec = FUNCTIONS[token.text];
        if (!spec) throw new FormulaError(`Unknown function ${token.text}`, token.at);
        pos += 1;
        const args: Node[] = [];
        if (peek()?.kind !== ")") { args.push(expr()); while (peek()?.kind === ",") { pos += 1; args.push(expr()); } }
        expect(")");
        if (args.length < spec.min || args.length > spec.max) throw new FormulaError(`${token.text} takes ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} values`, token.at);
        return { type: "call", name: token.text, args };
      }
      return { type: "var", name: token.text };
    }
    throw new FormulaError(`Unexpected "${token.text}"`, token.at);
  };
  const tree = expr();
  if (pos < tokens.length) throw new FormulaError(`Unexpected "${tokens[pos].text}"`, tokens[pos].at);
  return tree;
}

/** Names the formula needs, in first-use order (shown as the line's inputs). */
export function formulaInputs(node: Node, out: string[] = []): string[] {
  if (node.type === "var" && !out.includes(node.name)) out.push(node.name);
  if (node.type === "neg") formulaInputs(node.value, out);
  if (node.type === "bin") { formulaInputs(node.left, out); formulaInputs(node.right, out); }
  if (node.type === "call") node.args.forEach((arg) => formulaInputs(arg, out));
  return out;
}

export function evaluateFormula(node: Node, variables: Record<string, Dec | string | number>): Dec {
  switch (node.type) {
    case "num": return Dec.of(node.value);
    case "var": {
      const value = variables[node.name];
      if (value === undefined || value === null || value === "") throw new FormulaError(`${node.name} has no value`, 0);
      return Dec.of(value);
    }
    case "neg": return evaluateFormula(node.value, variables).neg();
    case "bin": {
      const a = evaluateFormula(node.left, variables), b = evaluateFormula(node.right, variables);
      if (node.op === "+") return a.add(b);
      if (node.op === "-") return a.sub(b);
      if (node.op === "*") return a.mul(b);
      if (b.isZero()) throw new FormulaError("Division by zero", 0);
      return a.div(b);
    }
    case "call": {
      const args = node.args.map((arg) => evaluateFormula(arg, variables));
      const places = args[1] ? Number(args[1].toString()) : 0;
      if (args[1] && (!Number.isInteger(places) || places < 0 || places > 6)) throw new FormulaError(`${node.name} places must be 0–6`, 0);
      if (node.name === "ceil") return args[0].ceil(places);
      if (node.name === "floor") return args[0].floor(places);
      if (node.name === "round") return args[0].round(places);
      if (node.name === "abs") return args[0].abs();
      if (node.name === "min") return args.reduce((a, b) => (a.cmp(b) <= 0 ? a : b));
      return args.reduce((a, b) => (a.cmp(b) >= 0 ? a : b));
    }
  }
}
