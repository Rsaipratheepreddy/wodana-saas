// The workspace API areas the app calls (the first path segment after /workspaces/{id}/), read from the source
// with the TypeScript parser, so src/auth/api-areas.json — and with it the browser preview's proxy — can't fall
// behind. `node scripts/api-areas.mjs` lists them with one place each is used.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('../src/', import.meta.url);
// The client portal talks to its own API paths (client-portal/…), not the workspace ones.
const skipped = [new URL('portal/', root).href];
const AREA = /^([a-z][a-z0-9-]*)(?:[/?]|$)/;
// `type/subtype` strings that are not API paths.
const MIME = new Set(['application', 'audio', 'font', 'image', 'multipart', 'text', 'video']);
const API_METHODS = new Set(['get', 'send', 'upload', 'url']);

async function files(directory) {
  if (skipped.includes(directory.href)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) && !/\.(d|generated)\.ts$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

/** `api.get(…)`, `api.send(…)`, `api.upload(…)` or `api.url(…)`: the workspace API client. */
const isApiCall = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'api' && API_METHODS.has(node.expression.name.text);

/** Whether a literal in this position can be a workspace path at all (not an import, a label, a key, a type…). */
function inPathPosition(node) {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return false;
  if (ts.isJsxAttribute(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent) || ts.isArrayLiteralExpression(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isEnumMember(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return false;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return false;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return false;
  return true;
}

/** The text a path would start with: the whole string, or a template's literal head (`site/projects/` of `site/projects/${id}`). */
function literalHead(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
}

/**
 * Area → where it is used (`file:line  text`). A literal counts when it is the path given to the API client, or
 * when it has more segments (`payables/bills/…`), wherever it is built; a bare word elsewhere is a label or a key.
 */
export async function usedAreas() {
  const areas = new Map();
  for (const file of await files(root)) {
    const name = fileURLToPath(file).split('/src/')[1];
    const source = ts.createSourceFile(name, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      const head = literalHead(node);
      if (head !== null && inPathPosition(node)) {
        const match = AREA.exec(head);
        if (match) {
          const [, area] = match;
          const direct = ts.isCallExpression(node.parent) && node.parent.arguments[0] === node && isApiCall(node.parent);
          const longer = head.length > area.length && !MIME.has(area);
          if (direct || longer) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            if (!areas.has(area)) areas.set(area, new Set());
            areas.get(area).add(`${name}:${line}  ${head}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return new Map([...areas.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [area, places] of await usedAreas()) console.log(`${area}\t${[...places][0]}${places.size > 1 ? `  (+${places.size - 1})` : ''}`);
}
