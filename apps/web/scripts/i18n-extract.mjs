// Adds every label used in the web app to lib/i18n/en.json (English text is the key): the first argument of
// t("…"), tKey("…") and (await getServerT())("…"), in any quote style, including both branches of t(cond ? "…" : "…").
// New labels are appended in the order they are found; existing entries are never reordered or removed.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const catalogPath = join(root, 'lib/i18n/en.json');
const found = new Set();

function literals(node, out = []) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)) literals(node.expression, out);
  else if (ts.isConditionalExpression(node)) { literals(node.whenTrue, out); literals(node.whenFalse, out); }
  else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) { literals(node.left, out); literals(node.right, out); }
  return out;
}

/** `t(…)`, `tKey(…)`, or a one-off `(await getServerT())(…)` in server code. */
function isTranslateCall(node) {
  if (!ts.isCallExpression(node) || !node.arguments[0]) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return ['t', 'tKey'].includes(callee.text);
  const inner = ts.isParenthesizedExpression(callee) && ts.isAwaitExpression(callee.expression) ? callee.expression.expression : null;
  return Boolean(inner && ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === 'getServerT');
}

function scan(path) {
  const source = readFileSync(path, 'utf8');
  if (!/\b(t|tKey|getServerT\(\)\))\(/.test(source)) return;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (isTranslateCall(node)) {
      for (const text of literals(node.arguments[0])) if (text.trim()) found.add(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'test-results'].includes(name) || name.startsWith('.next')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx|ts)$/.test(name) && !/\.(test|spec|stories)\./.test(name) && !name.endsWith('.d.ts')) scan(path);
  }
}

for (const dir of ['app', 'components', 'lib', 'design-system']) walk(join(root, dir));
// Read the catalogue last so a run started alongside another edit keeps both sets of labels.
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const added = [...found].filter((key) => !(key in catalog));
for (const key of added) catalog[key] = key;
if (added.length) writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`${added.length} new label(s) added to en.json`);
if (process.argv.includes('--unused')) {
  const unused = Object.keys(catalog).filter((key) => !found.has(key));
  console.log(`${unused.length} label(s) in en.json not found as a literal t()/tKey() argument (some are used through variables)`);
}
