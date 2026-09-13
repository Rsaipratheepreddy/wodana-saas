import type { CatalogSelection, QuoteLine } from "./types";

export type MaterialRole = "material" | "finish";
export const catalogLabel = (selection: CatalogSelection) =>
  selection.snapshot.name + (selection.snapshot.code ? ` · ${selection.snapshot.code}` : "");

export function materialSelections(line: QuoteLine, role: MaterialRole) {
  return (line.catalogLinks ?? []).filter((selection) => selection.role === role);
}

/** Keep client-facing specifications alongside, rather than in place of, catalog identities. */
export function materialNotes(line: QuoteLine, role: MaterialRole) {
  const value = line[role];
  const selections = materialSelections(line, role);
  const summary = selections.map(catalogLabel).join("\n");
  if (summary && value === summary) return "";
  if (summary && value.startsWith(summary + "\n\n")) return value.slice(summary.length + 2);
  // Earlier quotations stored one selected name (finishes without a code).
  if (selections.length === 1 && [catalogLabel(selections[0]), selections[0].snapshot.name].includes(value)) return "";
  return value;
}

export function updateMaterials(line: QuoteLine, role: MaterialRole, selections: CatalogSelection[], notes = materialNotes(line, role)): QuoteLine {
  return {
    ...line,
    catalogLinks: [...(line.catalogLinks ?? []).filter((selection) => selection.role !== role), ...selections],
    [role]: [selections.map(catalogLabel).join("\n"), notes].filter(Boolean).join("\n\n"),
  };
}

export function selectUnit(line: QuoteLine, selection: CatalogSelection | null): QuoteLine {
  return {
    ...line,
    catalogLinks: [...(line.catalogLinks ?? []).filter((link) => link.role !== "unit"), ...(selection ? [selection] : [])],
    ...(selection ? { unit: String(selection.snapshot.configuration?.symbol ?? selection.snapshot.code) } : {}),
  };
}

export function customUnit(line: QuoteLine, unit: string): QuoteLine {
  const selected = line.catalogLinks?.find((link) => link.role === "unit");
  return {
    ...line, unit,
    catalogLinks: (line.catalogLinks ?? []).filter((link) => link.role !== "unit" ||
      String(selected?.snapshot.configuration?.symbol ?? selected?.snapshot.code) === unit),
  };
}
