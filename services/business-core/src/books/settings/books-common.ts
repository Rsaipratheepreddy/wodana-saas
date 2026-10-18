import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { BOOKS_PERMISSIONS } from "../books-contract";
import { LedgerError, ledgerDecimal } from "../ledger/ledger";

/**
 * What the Ledger's settings and manual-journal commands share: who acts and what they may do, the field checks,
 * the command log that makes every command run once, and how a Ledger rule refusing something reaches the screen.
 */

export type Db = Pick<PoolClient, "query">;

/** Who acts, in which workspace, and what they may do (the service passes the workspace access check). */
export type BooksCtx = { workspaceId: string; userId: string; can: (permission: string) => Promise<boolean> };

export const BOOKS = BOOKS_PERMISSIONS;

export async function requireAny(ctx: BooksCtx, permissions: string[], message: string) {
  for (const permission of permissions) if (await ctx.can(permission)) return;
  throw new ForbiddenException(message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`Choose the ${what.toLowerCase()}.`);
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, what);
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], message: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new BadRequestException(message);
  return value as T;
}

export function text(value: unknown, max: number, what: string, required = false): string {
  if (value !== undefined && value !== null && typeof value !== "string") throw new BadRequestException(`${what} is text.`);
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new BadRequestException(`Enter the ${what.toLowerCase()}.`);
  if (result.length > max) throw new BadRequestException(`${what} is at most ${max} characters.`);
  return result;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day (YYYY-MM-DD). */
export function day(value: unknown, what: string): string {
  if (typeof value !== "string" || !DAY.test(value)) throw new BadRequestException(`Choose the ${what.toLowerCase()}.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`Choose the ${what.toLowerCase()}.`);
  return value;
}

export function optionalDay(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return day(value, what);
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The version the screen saw: a whole number from 0 (0 when the record doesn't exist yet). */
export function versionOf(value: unknown): number {
  const version = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) throw new BadRequestException("Reload and try again.");
  return version;
}

export function checkVersion(current: number, expected: number, what = "This") {
  if (current !== expected) throw new ConflictException(`${what} changed elsewhere. Reload to see it.`);
}

/**
 * An amount with at most four decimals, at least zero, as exact decimal text ("" and null are zero). Never a float:
 * the text is checked and carried as is.
 */
export function amount(value: unknown, what: string): string {
  if (value === null || value === undefined || value === "") return "0.0000";
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/[\s,]/g, "") : "";
  if (!/^\d{1,16}(\.\d{1,4})?$/.test(raw)) throw new BadRequestException(`${what}: enter an amount with up to four decimals.`);
  return ledgerDecimal.format4(ledgerDecimal.units4(raw));
}

export const units = (value: string) => ledgerDecimal.units4(value);
export const format = (value: bigint) => ledgerDecimal.format4(value);

/**
 * Runs a command once by its id: true the first time, false when the same command was already recorded (a retry
 * or a double tap), in which case the caller returns the current state without changing anything.
 */
export async function firstTime(db: Db, ctx: BooksCtx, commandId: string, action: string, entityId: string) {
  return Boolean((await db.query(
    `INSERT INTO books_commands (workspace_id, id, action, entity_id, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, id) DO NOTHING`,
    [ctx.workspaceId, commandId, action, entityId.slice(0, 160), ctx.userId])).rowCount);
}

/** A Ledger rule that refuses a draft, as the screen shows it. */
export function ledgerHttp(error: unknown): never {
  if (error instanceof LedgerError) {
    if (error.code === "unknown_entity") throw new NotFoundException(error.message);
    if (error.code === "template_conflict") throw new ConflictException(error.message);
    throw new UnprocessableEntityException({ message: error.message, code: error.code });
  }
  throw error;
}

/** The people who hold a permission in the workspace now. */
export async function holders(db: Db, workspaceId: string, code: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, code])).rows.map((row) => row.userId);
}

export async function personName(db: Db, userId: string | null) {
  if (!userId) return "";
  return (await db.query<{ name: string }>(`SELECT coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
}

export type Company = {
  id: string; code: string; name: string; countryCode: string; baseCurrency: string; timezone: string; today: string;
  /** The region of its address (as typed, e.g. the state or emirate), the default for its tax return's region. */
  addressRegion?: string | null;
};

/** A company (legal entity) of the workspace, with today's date in its time zone. */
export async function readCompany(db: Db, workspaceId: string, legalEntityId: string): Promise<Company> {
  const row = (await db.query<Company>(
    `SELECT entity.id, entity.code, entity.display_name AS name, entity.country_code AS "countryCode", entity.base_currency AS "baseCurrency", entity.timezone,
            (now() AT TIME ZONE entity.timezone)::date::text AS today, nullif(trim(entity.address->>'region'), '') AS "addressRegion"
       FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2 AND entity.archived_at IS NULL`, [workspaceId, legalEntityId])).rows[0];
  if (!row) throw new NotFoundException("Company not found.");
  return row;
}

export async function readCompanies(db: Db, workspaceId: string): Promise<Company[]> {
  return (await db.query<Company>(
    `SELECT entity.id, entity.code, entity.display_name AS name, entity.country_code AS "countryCode", entity.base_currency AS "baseCurrency", entity.timezone,
            (now() AT TIME ZONE entity.timezone)::date::text AS today, nullif(trim(entity.address->>'region'), '') AS "addressRegion"
       FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.archived_at IS NULL ORDER BY entity.display_name, entity.code`, [workspaceId])).rows;
}

/** A money amount as people read it: "AED 1,234.50" at the currency's precision. */
export function moneyText(value: string, currency: string, decimals: number) {
  const scaled = ledgerDecimal.roundUnits(units(value), decimals);
  const [whole, fraction = ""] = format(scaled).split(".");
  const digits = whole.replace(/^-/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${whole.startsWith("-") ? "-" : ""}${digits}${decimals > 0 ? `.${fraction.slice(0, decimals)}` : ""}`;
}
