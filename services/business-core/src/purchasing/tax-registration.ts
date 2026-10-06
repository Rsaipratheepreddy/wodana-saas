import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * How the workspace's country writes a tax registration number (PLM-111), from its region pack: the
 * name ("TRN", "GSTIN", "VAT number"), and, where the country has one fixed format, its pattern and an
 * example. A country without a fixed format (or without a pack) accepts any number as typed.
 */
export type TaxNumberRule = { label: string | null; pattern: string | null; example: string | null };

const NO_RULE: TaxNumberRule = { label: null, pattern: null, example: null };

/** Spaces, dots, dashes and slashes people type between groups are not part of the number. */
export function normaliseTaxNumber(value: string) {
  return value.replace(/[\s.\-/]+/g, "").toUpperCase();
}

/** The number as stored: checked and normalised where the country has a format, else trimmed as typed. */
export function checkTaxNumber(value: string, rule: TaxNumberRule): string {
  const typed = value.trim();
  if (!typed || !rule.pattern) return typed;
  const number = normaliseTaxNumber(typed);
  let format: RegExp;
  try { format = new RegExp(rule.pattern); } catch { return typed; }
  if (!format.test(number)) throw new BadRequestException(`${rule.label ?? "Tax number"} should look like ${rule.example ?? "the official format"}.`);
  return number;
}

/** The workspace's rule, from the latest region pack of its country. */
export async function readTaxNumberRule(db: Db, workspaceId: string): Promise<TaxNumberRule> {
  const row = (await db.query<{ tax: { registrationLabel?: unknown; registrationFormat?: { pattern?: unknown; example?: unknown } } | null }>(
    `SELECT profile.configuration->'tax' AS tax
       FROM workspaces workspace JOIN tenant_setup_profiles profile ON profile.kind = 'region' AND profile.code = upper(split_part(workspace.default_locale, '-', 2))
      WHERE workspace.id = $1 ORDER BY profile.version DESC LIMIT 1`, [workspaceId])).rows[0]?.tax;
  if (!row) return NO_RULE;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { label: text(row.registrationLabel), pattern: text(row.registrationFormat?.pattern), example: text(row.registrationFormat?.example) };
}
