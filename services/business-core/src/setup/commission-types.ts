import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P3: the commission types a deal file offers, the firm's own list (named and ordered by it). Without a list the
 * kit's three apply. Removing a type retires it: lines already using it keep their type; new lines can't pick it.
 */
export type CommissionType = { code: string; label: string };
export const KIT_COMMISSION_TYPES: CommissionType[] = [
  { code: "sales", label: "Sales" }, { code: "designer", label: "Designer fee" }, { code: "referral", label: "Referral" },
];

/** The list as a version token: saving checks it so two people don't overwrite each other. */
export const commissionVersion = (types: CommissionType[]) => createHash("sha256").update(JSON.stringify(types)).digest("hex").slice(0, 16);

export async function readCommissionTypes(db: Db, workspaceId: string): Promise<{ types: CommissionType[]; version: string; fromKit: boolean }> {
  const rows = (await db.query<CommissionType>(`SELECT code, label FROM setup_commission_types WHERE workspace_id = $1 AND active ORDER BY position, code`, [workspaceId])).rows;
  const any = rows.length > 0 || (await db.query(`SELECT 1 FROM setup_commission_types WHERE workspace_id = $1 LIMIT 1`, [workspaceId])).rowCount! > 0;
  const types = any ? rows : KIT_COMMISSION_TYPES;
  return { types, version: commissionVersion(types), fromKit: !any };
}

/** A firm's list, checked: one to eight types, each named, codes unique (a new type gets a code from its name). */
export function normaliseCommissionTypes(input: unknown): CommissionType[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) throw new BadRequestException("Keep one to eight commission types.");
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label || label.length > 60) throw new BadRequestException(`Name commission type ${index + 1}.`);
    const code = typeof row.code === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(row.code) ? row.code
      : label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `type_${index + 1}`;
    const unique = /^[a-z]/.test(code) ? code : `t_${code}`.slice(0, 40);
    if (seen.has(unique)) throw new BadRequestException(`"${label}" is in the list twice.`);
    seen.add(unique);
    return { code: unique, label };
  });
}

/** Saves the firm's list (version-checked; saving the same list changes nothing). Returns the list as saved. */
export async function saveCommissionTypes(db: Db, workspaceId: string, userId: string, input: { version?: unknown; types?: unknown }) {
  const before = await readCommissionTypes(db, workspaceId);
  if (input.version !== before.version) throw new ConflictException("The commission types changed in another window. Reload and try again.");
  const types = normaliseCommissionTypes(input.types);
  if (commissionVersion(types) === before.version && !before.fromKit) return { before, after: before, changed: false };
  await db.query(`UPDATE setup_commission_types SET active = false, updated_by = $2, updated_at = now() WHERE workspace_id = $1`, [workspaceId, userId]);
  for (const [position, type] of types.entries()) {
    await db.query(`INSERT INTO setup_commission_types (workspace_id, code, label, position, active, updated_by) VALUES ($1, $2, $3, $4, true, $5)
      ON CONFLICT (workspace_id, code) DO UPDATE SET label = excluded.label, position = excluded.position, active = true, updated_by = excluded.updated_by, updated_at = now()`,
      [workspaceId, type.code, type.label, position, userId]);
  }
  return { before, after: await readCommissionTypes(db, workspaceId), changed: true };
}
