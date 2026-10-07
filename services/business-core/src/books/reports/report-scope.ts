import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Db } from "../ledger/ledger";
import { fiscalYearStart, isDay } from "./report-math";
import type { BooksReportQuery, ReportEntity } from "./report-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTITY_COLUMNS = `entity.id, entity.code, entity.display_name AS name, settings.functional_currency AS currency,
  coalesce(nullif(btrim(entity.locale), ''), 'en') AS locale, entity.country_code AS "countryCode", entity.timezone AS "timeZone",
  settings.enabled, settings.fiscal_year_start_month AS "fiscalYearStartMonth", settings.start_date::text AS "startDate",
  settings.lock_date::text AS "lockDate", settings.template_code AS "templateCode", settings.template_version AS "templateVersion",
  (now() AT TIME ZONE entity.timezone)::date::text AS today`;

/**
 * The companies with books: the Ledger on, or journals kept from when it was. Reports never offer a company that
 * has neither.
 */
export async function listReportEntities(db: Db, workspaceId: string): Promise<ReportEntity[]> {
  return (await db.query<ReportEntity>(
    `SELECT ${ENTITY_COLUMNS}
       FROM books_settings settings
       JOIN legal_entities entity ON entity.workspace_id = settings.workspace_id AND entity.id = settings.legal_entity_id
      WHERE settings.workspace_id = $1
        AND (settings.enabled OR EXISTS (SELECT 1 FROM books_journals journal WHERE journal.workspace_id = settings.workspace_id
                                          AND journal.legal_entity_id = settings.legal_entity_id))
      ORDER BY settings.enabled DESC, entity.display_name, entity.id`, [workspaceId])).rows;
}

export async function readReportEntity(db: Db, workspaceId: string, legalEntityId: string): Promise<ReportEntity | null> {
  if (!UUID.test(legalEntityId)) return null;
  return (await listReportEntities(db, workspaceId)).find((entity) => entity.id === legalEntityId) ?? null;
}

export type ParsedScope = { entity: ReportEntity; scope: BooksReportQuery };

/**
 * The company and period a report reads: `entity` (else the first company with books), `from` (else the start of
 * its financial year) and `to` (else today in its time zone), inclusive.
 */
export async function resolveScope(db: Db, workspaceId: string, query: Record<string, unknown>): Promise<ParsedScope> {
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string).trim() : "");
  const requested = text("entity");
  if (requested && !UUID.test(requested)) throw new BadRequestException("Choose a company");
  const entities = await listReportEntities(db, workspaceId);
  const entity = requested ? entities.find((row) => row.id === requested) : entities[0];
  if (!entity) throw new NotFoundException(requested ? "This company has no Ledger" : "The Ledger is not on for any company");
  for (const key of ["from", "to"]) if (text(key) && !isDay(text(key))) throw new BadRequestException("Dates are calendar days (YYYY-MM-DD)");
  const to = text("to") || entity.today;
  const from = text("from") || fiscalYearStart(to, entity.fiscalYearStartMonth);
  if (from > to) throw new BadRequestException("The period ends before it starts");
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 10 * 366 * 86_400_000) throw new BadRequestException("Choose a period of ten years or less");
  return { entity, scope: { legalEntityId: entity.id, from, to } };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
