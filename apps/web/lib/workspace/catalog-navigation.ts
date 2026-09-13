import { catalogSections, type CatalogKind, type CatalogRecord } from "./catalog";

export const recordSections = catalogSections.filter(s => !["catalog_group", "record_group"].includes(s.kind));
export const isMasterRecord = (r: CatalogRecord) => !["catalog_group", "record_group"].includes(r.kind);
export const recordGroupId = (r: CatalogRecord) => r.links.find(l => l.relation === "record_group")?.targetId;
export const withRecordGroup = (r: CatalogRecord, groupId: string) => ({
  ...r,
  links: [...r.links.filter(l => l.relation !== "record_group"), ...(groupId ? [{ relation: "record_group", targetId: groupId }] : [])],
});
export const catalogGroups = (items: CatalogRecord[]) => items.filter(r => r.kind === "record_group" && !r.archived)
  .sort((a,b) => Number(a.configuration?.sortOrder ?? 0) - Number(b.configuration?.sortOrder ?? 0) || a.name.localeCompare(b.name));
export function defaultRecordKind(group?: CatalogRecord): CatalogKind {
  return recordSections.find(s => s.kind === group?.configuration?.defaultKind)?.kind ?? "custom";
}
export function recordCode(name: string, id: string) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0,80) || `RECORD_${id.replaceAll("-", "").slice(0,12).toUpperCase()}`;
}
// Excel's tab-delimited clipboard can contain quoted newlines and escaped quotes.
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i=0; i<input.length; i++) {
    const c=input[i];
    if (c === '"' && (quoted || !cell)) {
      if (quoted && input[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell); cell="";
      if (c === "\n") { rows.push(row); row=[]; }
    } else cell += c;
  }
  if (quoted) throw new Error("The pasted text has an unfinished quoted cell.");
  if (cell || row.length || !rows.length) rows.push([...row,cell]);
  return rows;
}
