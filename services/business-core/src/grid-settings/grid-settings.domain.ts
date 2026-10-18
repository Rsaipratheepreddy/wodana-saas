import { createHash } from "node:crypto";

/**
 * A list's workspace default (plan §0.7 R14): which columns start hidden for everyone. Hiding is configuration,
 * never deletion — the data stays and a person can still show a column for themselves.
 */
export const GRID_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const COLUMN_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
export const MAX_HIDDEN_COLUMNS = 100;

/**
 * Who may change a list's default for everyone: the module's manage permission, matched by the list key's
 * prefix (the longest prefix wins). A list key outside these modules has no workspace default.
 */
const MANAGE_PERMISSION_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["crm.", "crm.settings.manage"],
  ["planning.", "pre_projects.manage_lifecycle"],
  ["projects.", "projects.manage"],
  ["purchasing.", "purchasing.manage"],
  ["inventory.", "stock.manage"],
  ["finance.bills", "payables.manage"],
  ["finance.", "finance.settings.manage"],
  ["hrms.", "hrms.manage"],
];

export function managePermissionFor(gridKey: string): string | null {
  if (!isGridKey(gridKey)) return null;
  // "crm." covers every Sales list; "finance.bills" covers that list and its sub-lists ("finance.bills.*").
  const matches = (prefix: string) => prefix.endsWith(".") ? gridKey.startsWith(prefix) : gridKey === prefix || gridKey.startsWith(`${prefix}.`);
  const match = MANAGE_PERMISSION_BY_PREFIX.filter(([prefix]) => matches(prefix)).sort(([left], [right]) => right.length - left.length)[0];
  return match?.[1] ?? null;
}

export function isGridKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && GRID_KEY.test(value);
}

export class GridSettingsInputError extends Error {}

/** The hidden columns to save: valid ids, each once, in a stable order. */
export function normalizeHiddenColumns(input: unknown): string[] {
  if (!Array.isArray(input)) throw new GridSettingsInputError("Choose the columns to hide");
  if (input.length > MAX_HIDDEN_COLUMNS) throw new GridSettingsInputError(`Hide at most ${MAX_HIDDEN_COLUMNS} columns`);
  const ids = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string" || !COLUMN_ID.test(item)) throw new GridSettingsInputError("A column name is not valid");
    ids.add(item);
  }
  return [...ids].sort();
}

/** The same change always hashes the same, so a replayed request is recognised. */
export function gridSettingsRequestHash(gridKey: string, hiddenColumns: string[], version: number) {
  return createHash("sha256").update(JSON.stringify({ gridKey, hiddenColumns: [...hiddenColumns].sort(), version })).digest("hex");
}
