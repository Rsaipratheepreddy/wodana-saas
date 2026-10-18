#!/usr/bin/env node
// Wraps user-facing JSX text and label-like props in t("…") inside React components, adding
// `const t = useT()` where needed. Conservative: skips text with & or {, props outside components,
// and files that already bind a name `t`. Usage: node scripts/i18n-wrap.mjs <file.tsx>...
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const PROPS = new Set(["label", "title", "description", "placeholder", "aria-label"]);
const isComponentName = (name) => /^[A-Z]/.test(name ?? "");

function componentOf(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && isComponentName(current.name?.text)) return current;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && isComponentName(current.parent.name.getText())) return current;
    if (ts.isFunctionDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current)) {
      // Nested callbacks (map, handlers) are fine as long as an outer component exists.
      continue;
    }
  }
  return null;
}

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let bindsT = false;
  const edits = [];
  const components = new Set();
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.name.getText(sf) === "t") bindsT = true;
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf);
      const text = raw.replace(/\s+/g, " ").trim();
      if (/[A-Za-z]{2,}/.test(text) && !/[&{}<>]/.test(text)) {
        const owner = componentOf(node);
        if (owner) {
          const lead = raw.match(/^\s*/)[0].includes("\n") ? "" : raw.match(/^\s*/)[0];
          const trail = raw.match(/\s*$/)[0].includes("\n") ? "" : raw.match(/\s*$/)[0];
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${lead ? "{\" \"}" : ""}{t(${JSON.stringify(text)})}${trail ? "{\" \"}" : ""}` });
          components.add(owner);
        }
      }
    }
    if (ts.isJsxAttribute(node) && PROPS.has(node.name.getText(sf)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const value = node.initializer.text;
      if (/[A-Za-z]{2,}/.test(value)) {
        const owner = componentOf(node);
        if (owner) { edits.push({ start: node.initializer.getStart(sf), end: node.initializer.getEnd(), text: `{t(${JSON.stringify(value)})}` }); components.add(owner); }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (bindsT) { console.log(`skip ${file}: already binds t`); continue; }
  if (!edits.length) { console.log(`no change ${file}`); continue; }
  for (const owner of components) {
    const body = owner.body;
    if (body && ts.isBlock(body)) edits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: "\n  const t = useT();" });
    else if (body) { edits.push({ start: body.getStart(sf), end: body.getStart(sf), text: "{ const t = useT(); return " }, { start: body.getEnd(), end: body.getEnd(), text: "; }" }); }
  }
  let out = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  if (!out.includes('from "@/lib/i18n/i18n-provider"')) {
    const firstImport = out.search(/^import /m);
    out = out.slice(0, firstImport) + 'import { useT } from "@/lib/i18n/i18n-provider";\n' + out.slice(firstImport);
  }
  writeFileSync(file, out);
  console.log(`wrapped ${edits.length} in ${file}`);
}
