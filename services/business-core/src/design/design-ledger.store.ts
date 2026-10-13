import { randomUUID } from "node:crypto";
import { Dec } from "../catalog-core/decimal";
import { searchCatalog } from "../quotation/quote-catalog";
import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { cancelApproval, requestApproval } from "../approvals/approval-engine.api";
import { caseTeam, caseTitle, tellClients, tellStaff } from "../client-portal/portal-notices";
import {
  CONFIRMATION_METHODS, confirmProblem, impactText, LEDGER_KINDS, ledgerState, lineTotal, lockProblem, outsourcedWaiting, priceImpact, procurementProblem, versionProblem,
  type ConfirmationMethod, type EntryState, type LedgerKind, type LedgerVersionInput, type VersionStatus,
} from "./design-ledger.domain";
import { salesAdminMembership } from "./design-journey.store";

type Db = Pick<PoolClient, "query">;

/** Who wrote a version: a staff user (the client confirms or declines; a client-written choice comes with the portal revamp). */
export type LedgerActor = { userId: string };

export type LedgerVersionRow = {
  id: string; entryId: string; number: number; title: string; specification: string; catalogItemId: string | null; supplier: string;
  quantity: string | null; unit: string; unitPrice: string | null; currency: string | null; priceImpact: string; timeImpactDays: number;
  source: string; saidAt: string; evidenceAssetId: string | null; evidenceName: string | null; evidenceNote: string; note: string; afterLock: boolean;
  status: VersionStatus; confirmedAt: string | null; confirmationMethod: string | null; confirmedByName: string | null; fromPortal: boolean;
  recordedByName: string | null; recordedAt: string;
  /** PLM-144: from a local supplier, and where its sign-off stands (the approval engine: pending, approved, returned, rejected). */
  outsourced: boolean; signOff: string | null;
};
export type LedgerEntryRow = {
  id: string; kind: LedgerKind; roomId: string | null; roomName: string | null; position: number; currentNumber: number;
  archivedAt: string | null; archivedAfterLock: boolean; version: number;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

async function latestLock(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; number: number; reason: string; lockedAt: Date; lockedByName: string | null; note: string | null }>(
    `SELECT lock.id, lock.number, lock.reason, lock.locked_at AS "lockedAt", account.display_name AS "lockedByName", lock.note
       FROM design_ledger_locks lock LEFT JOIN users account ON account.id = lock.locked_by
      WHERE lock.workspace_id = $1 AND lock.case_id = $2 ORDER BY lock.number DESC LIMIT 1`, [workspaceId, caseId])).rows[0] ?? null;
}

/** The case's ledger: entries with every version (newest first), what the latest lock holds, and one state word. */
export async function readLedger(db: Db, workspaceId: string, caseId: string) {
  const lock = await latestLock(db, workspaceId, caseId);
  const entries = (await db.query<LedgerEntryRow>(
    `SELECT entry.id, entry.kind, entry.room_id AS "roomId", room.name AS "roomName", entry.position, entry.current_number AS "currentNumber",
            entry.archived_at AS "archivedAt", entry.version,
            (entry.archived_at IS NOT NULL AND EXISTS (SELECT 1 FROM design_ledger_locks lock WHERE lock.workspace_id = entry.workspace_id AND lock.case_id = entry.case_id
               AND lock.locked_at < entry.archived_at)) AS "archivedAfterLock"
       FROM design_ledger_entries entry
       LEFT JOIN pre_project_rooms room ON room.workspace_id = entry.workspace_id AND room.id = entry.room_id
      WHERE entry.workspace_id = $1 AND entry.case_id = $2 ORDER BY entry.archived_at NULLS FIRST, entry.position, entry.created_at`, [workspaceId, caseId])).rows;
  const versions = (await db.query<LedgerVersionRow>(
    `SELECT version.id, version.entry_id AS "entryId", version.number, version.title, version.specification, version.catalog_item_id AS "catalogItemId", version.supplier,
            version.quantity::text AS quantity, version.unit, version.unit_price::text AS "unitPrice", version.currency, version.price_impact::text AS "priceImpact",
            version.time_impact_days AS "timeImpactDays", version.source, version.said_at AS "saidAt", version.evidence_asset_id AS "evidenceAssetId", asset.original_name AS "evidenceName",
            version.evidence_note AS "evidenceNote", version.note, version.after_lock AS "afterLock", version.status, version.confirmed_at AS "confirmedAt",
            version.confirmation_method AS "confirmationMethod", version.confirmed_by_name AS "confirmedByName", version.recorded_by_grant_id IS NOT NULL AS "fromPortal",
            COALESCE(recorder.display_name, grant_row.name) AS "recordedByName", version.recorded_at AS "recordedAt", version.outsourced,
            CASE WHEN version.outsourced THEN (SELECT request.status FROM approval_requests request WHERE request.workspace_id = version.workspace_id
              AND request.subject_kind = 'outsourced_material' AND request.subject_id = version.id AND request.status <> 'superseded'
              ORDER BY request.requested_at DESC LIMIT 1) END AS "signOff"
       FROM design_ledger_versions version
       LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.evidence_asset_id
       LEFT JOIN users recorder ON recorder.id = version.recorded_by
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = version.workspace_id AND grant_row.id = version.recorded_by_grant_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 ORDER BY version.entry_id, version.number DESC`, [workspaceId, caseId])).rows
    .map((row) => ({ ...row, saidAt: iso(row.saidAt)!, confirmedAt: iso(row.confirmedAt), recordedAt: iso(row.recordedAt)! }));
  const lines = lock ? (await db.query<{ entryId: string; versionId: string }>(
    `SELECT entry_id AS "entryId", version_id AS "versionId" FROM design_ledger_lock_lines WHERE workspace_id = $1 AND lock_id = $2`, [workspaceId, lock.id])).rows : [];
  const shaped = entries.map((entry) => {
    const own = versions.filter((version) => version.entryId === entry.id);
    const current = own.find((version) => version.number === entry.currentNumber) ?? own[0] ?? null;
    const lockedId = lines.find((line) => line.entryId === entry.id)?.versionId;
    const locked = lockedId ? own.find((version) => version.id === lockedId) ?? null : null;
    return { ...entry, archivedAt: iso(entry.archivedAt), title: current?.title ?? "", current, locked: locked ? { id: locked.id, number: locked.number } : null, versions: own };
  });
  const states: EntryState[] = shaped.map((entry) => ({ id: entry.id, title: entry.title, archived: Boolean(entry.archivedAt), archivedAfterLock: entry.archivedAfterLock,
    current: entry.current ? { id: entry.current.id, number: entry.current.number, status: entry.current.status } : null, locked: entry.locked,
    signOffWaiting: outsourcedWaiting(entry.current) }));
  const currency = await ledgerCurrency(db, workspaceId, caseId);
  return {
    state: ledgerState(states, Boolean(lock)),
    lockProblem: lockProblem(states),
    lock: lock ? { number: lock.number, reason: lock.reason, lockedAt: iso(lock.lockedAt)!, lockedByName: lock.lockedByName, note: lock.note } : null,
    currency,
    entries: shaped,
  };
}

export type LedgerView = Awaited<ReturnType<typeof readLedger>>;

/** The case's currency: the enquiry's, else the workspace's. */
async function ledgerCurrency(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ currency: string | null }>(
    `SELECT COALESCE(NULLIF(opportunity.currency_code, ''), workspace.default_currency) AS currency FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.currency ?? null;
}

/** Catalog items a choice can point to: the quotation builder's catalog search, priced in the case's currency, with the preferred supplier. */
export async function ledgerCatalogChoices(db: Db, workspaceId: string, caseId: string, search: string) {
  const items = await searchCatalog(db, workspaceId, { search: search.slice(0, 120), currency: (await ledgerCurrency(db, workspaceId, caseId)) ?? "", priceBookId: null, limit: 20 });
  if (!items.length) return [];
  const suppliers = new Map((await db.query<{ itemId: string; name: string }>(
    `SELECT DISTINCT ON (link.item_id) link.item_id AS "itemId", vendor.display_name AS name
       FROM catalog_supplier_links link JOIN workspace_vendors vendor ON vendor.workspace_id = link.workspace_id AND vendor.id = link.vendor_id
      WHERE link.workspace_id = $1 AND link.item_id = ANY($2::uuid[]) AND link.variant_id IS NULL
      ORDER BY link.item_id, link.preferred DESC, link.created_at`, [workspaceId, items.map((item) => item.id)])).rows.map((row) => [row.itemId, row.name]));
  return items.map((item) => ({ ...item, supplier: suppliers.get(item.id) ?? null }));
}

function clean(input: LedgerVersionInput & { catalogItemId?: string | null; evidenceAssetId?: string | null }) {
  const text = (value: string | null | undefined) => (value ?? "").trim();
  return {
    title: text(input.title), specification: text(input.specification), supplier: text(input.supplier).slice(0, 200), quantity: text(input.quantity) || null,
    unit: text(input.unit).slice(0, 40), unitPrice: text(input.unitPrice) || null, timeImpactDays: input.timeImpactDays ?? 0, source: input.source as string,
    saidAt: input.saidAt as string, evidenceNote: text(input.evidenceNote), note: text(input.note), catalogItemId: input.catalogItemId ?? null, evidenceAssetId: input.evidenceAssetId ?? null,
    outsourced: input.outsourced === true,
  };
}

/**
 * PLM-144: an outsourced version asks for its sign-off through the approval engine (kind outsourced_material; the
 * firm's policy says who, Palm: the Creative Director). A version it replaces stops waiting.
 */
async function askSignOff(db: Db, workspaceId: string, caseId: string, input: { versionId: string; replacedId: string | null; fields: ReturnType<typeof clean>; currency: string | null; actor: LedgerActor }) {
  if (input.replacedId) await cancelApproval(db, { workspaceId, kind: "outsourced_material", subjectId: input.replacedId, actorUserId: input.actor.userId, reason: "Replaced by a new version" });
  if (!input.fields.outsourced) return;
  const facts = await caseTitle(db, workspaceId, caseId);
  const total = lineTotal(input.fields.quantity, input.fields.unitPrice);
  const supplier = input.fields.supplier ? ` (${input.fields.supplier})` : "";
  await requestApproval(db, { workspaceId, kind: "outsourced_material", subjectId: input.versionId, title: `${input.fields.title}${supplier} · ${facts.title || facts.clientName}`.slice(0, 300),
    href: ledgerLink(caseId), amount: total && input.currency ? total.toFixed(2) : null, currency: total && input.currency ? input.currency : null, requesterUserId: input.actor.userId });
}

async function assertBelongs(db: Db, workspaceId: string, caseId: string, input: { roomId?: string | null; catalogItemId?: string | null; evidenceAssetId?: string | null }) {
  if (input.roomId && !(await db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, input.roomId])).rowCount)
    throw new BadRequestException("Choose a room of this project.");
  if (input.catalogItemId && !(await db.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.catalogItemId])).rowCount)
    throw new BadRequestException("Choose an item from the catalog.");
  if (input.evidenceAssetId && !(await db.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, input.evidenceAssetId])).rowCount)
    throw new BadRequestException("Attach a file from this project.");
}

async function insertVersion(db: Db, workspaceId: string, caseId: string, entryId: string, id: string, number: number,
  fields: ReturnType<typeof clean>, impact: string, afterLock: boolean, currency: string | null, actor: LedgerActor) {
  await db.query(
    `INSERT INTO design_ledger_versions (id, workspace_id, case_id, entry_id, number, title, specification, catalog_item_id, supplier, quantity, unit, unit_price, currency,
                                         price_impact, time_impact_days, source, said_at, evidence_asset_id, evidence_note, note, after_lock, recorded_by, recorded_by_grant_id, outsourced)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12::numeric, $13, $14::numeric, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [id, workspaceId, caseId, entryId, number, fields.title, fields.specification, fields.catalogItemId, fields.supplier, fields.quantity, fields.unit, fields.unitPrice,
      fields.unitPrice ? currency : null, impact, fields.timeImpactDays, fields.source, fields.saidAt, fields.evidenceAssetId, fields.evidenceNote, fields.note, afterLock,
      actor.userId, null, fields.outsourced]);
}

/** Replays of the same command (same ids, same content) return the ledger unchanged; anything else with those ids is refused. */
function sameVersion(existing: LedgerVersionRow, fields: ReturnType<typeof clean>) {
  const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Dec.of(a).cmp(b) === 0);
  return existing.title === fields.title && existing.specification === fields.specification && same(existing.quantity, fields.quantity)
    && same(existing.unitPrice, fields.unitPrice) && existing.unit === fields.unit && existing.source === fields.source
    && existing.catalogItemId === fields.catalogItemId && existing.outsourced === fields.outsourced;
}

/** A new material or design choice, its first version proposed for the client's confirmation. */
export async function addEntry(db: Db, workspaceId: string, caseId: string, input: LedgerVersionInput & { id: string; versionId: string; kind: string; roomId?: string | null; catalogItemId?: string | null; evidenceAssetId?: string | null }, actor: LedgerActor) {
  if (!LEDGER_KINDS.includes(input.kind as LedgerKind)) throw new BadRequestException("Choose material or design.");
  const problem = versionProblem(input);
  if (problem) throw new UnprocessableEntityException(problem);
  const fields = clean(input);
  const existing = (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM design_ledger_entries WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.id])).rows[0];
  if (existing) {
    const first = (await readLedger(db, workspaceId, caseId)).entries.find((entry) => entry.id === input.id)?.versions.find((version) => version.number === 1);
    if (existing.caseId !== caseId || !first || first.id !== input.versionId || !sameVersion(first, fields)) throw new ConflictException("This choice ID is already in use.");
    return { replayed: true, versionId: input.versionId, afterLock: first.afterLock };
  }
  await assertBelongs(db, workspaceId, caseId, { ...input, catalogItemId: fields.catalogItemId, evidenceAssetId: fields.evidenceAssetId });
  const ledger = await readLedger(db, workspaceId, caseId);
  const position = Math.max(-1, ...ledger.entries.map((entry) => entry.position)) + 1;
  const afterLock = Boolean(ledger.lock);
  await db.query(`INSERT INTO design_ledger_entries (id, workspace_id, case_id, kind, room_id, position, current_number, created_by) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
    [input.id, workspaceId, caseId, input.kind, input.roomId ?? null, position, actor.userId]);
  const impact = priceImpact(null, fields);
  await insertVersion(db, workspaceId, caseId, input.id, input.versionId, 1, fields, impact, afterLock, ledger.currency, actor);
  await askSignOff(db, workspaceId, caseId, { versionId: input.versionId, replacedId: null, fields, currency: ledger.currency, actor });
  await noticeVersion(db, workspaceId, caseId, { versionId: input.versionId, title: fields.title, impact, days: fields.timeImpactDays, afterLock, currency: ledger.currency, actor });
  return { replayed: false, versionId: input.versionId, afterLock };
}

/** A change to a choice: a new version against the entry's version number (stale numbers are refused). */
export async function addVersion(db: Db, workspaceId: string, caseId: string, entryId: string, input: LedgerVersionInput & { versionId: string; entryVersion: number; catalogItemId?: string | null; evidenceAssetId?: string | null }, actor: LedgerActor) {
  const problem = versionProblem(input);
  if (problem) throw new UnprocessableEntityException(problem);
  const fields = clean(input);
  const entry = (await db.query<{ version: number; currentNumber: number; archivedAt: Date | null }>(
    `SELECT version, current_number AS "currentNumber", archived_at AS "archivedAt" FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, entryId])).rows[0];
  if (!entry) throw new NotFoundException("This choice isn't on the list.");
  const ledger = await readLedger(db, workspaceId, caseId);
  const own = ledger.entries.find((item) => item.id === entryId)!;
  const replay = own.versions.find((version) => version.id === input.versionId);
  if (replay) {
    if (!sameVersion(replay, fields)) throw new ConflictException("This version ID is already in use.");
    return { replayed: true, versionId: input.versionId, afterLock: replay.afterLock };
  }
  if (entry.archivedAt) throw new ConflictException("This choice was removed from the list.");
  if (entry.version !== input.entryVersion) throw new ConflictException("This choice changed in another window. Reload and try again.");
  await assertBelongs(db, workspaceId, caseId, { catalogItemId: fields.catalogItemId, evidenceAssetId: fields.evidenceAssetId });
  const previous = own.current;
  const number = entry.currentNumber + 1;
  const afterLock = Boolean(ledger.lock);
  const impact = priceImpact(previous ? { quantity: previous.quantity, unitPrice: previous.unitPrice } : null, fields);
  // The version it replaces stays as history; one still waiting for the client is superseded.
  await db.query(`UPDATE design_ledger_versions SET status = 'superseded' WHERE workspace_id = $1 AND entry_id = $2 AND status = 'proposed'`, [workspaceId, entryId]);
  await insertVersion(db, workspaceId, caseId, entryId, input.versionId, number, fields, impact, afterLock, ledger.currency, actor);
  await askSignOff(db, workspaceId, caseId, { versionId: input.versionId, replacedId: previous?.outsourced ? previous.id : null, fields, currency: ledger.currency, actor });
  await db.query(`UPDATE design_ledger_entries SET current_number = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId, number]);
  await noticeVersion(db, workspaceId, caseId, { versionId: input.versionId, title: fields.title, impact, days: fields.timeImpactDays, afterLock, currency: ledger.currency, actor });
  return { replayed: false, versionId: input.versionId, afterLock };
}

/** Removes a choice before the list is locked; after the lock a removal is a change too (archived, kept in history). */
export async function archiveEntry(db: Db, workspaceId: string, caseId: string, entryId: string, entryVersion: number, userId: string) {
  const entry = (await db.query<{ version: number; archivedAt: Date | null }>(
    `SELECT version, archived_at AS "archivedAt" FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, entryId])).rows[0];
  if (!entry) throw new NotFoundException("This choice isn't on the list.");
  if (entry.archivedAt) return false;
  if (entry.version !== entryVersion) throw new ConflictException("This choice changed in another window. Reload and try again.");
  await db.query(`UPDATE design_ledger_entries SET archived_at = clock_timestamp(), archived_by = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId, userId]);
  await db.query(`UPDATE design_ledger_versions SET status = 'superseded' WHERE workspace_id = $1 AND entry_id = $2 AND status = 'proposed'`, [workspaceId, entryId]);
  // A removed outsourced choice no longer waits for its sign-off.
  for (const version of (await db.query<{ id: string }>(`SELECT id FROM design_ledger_versions WHERE workspace_id = $1 AND entry_id = $2 AND outsourced`, [workspaceId, entryId])).rows)
    await cancelApproval(db, { workspaceId, kind: "outsourced_material", subjectId: version.id, actorUserId: userId, reason: "Removed from the list" });
  return true;
}

/**
 * The client's decision on the version they were shown: confirmed (or declined) with who, when and how (E5-2).
 * From the portal the contact is the evidence; from staff, the method and the person who decided.
 */
export async function decideVersion(db: Db, workspaceId: string, caseId: string, entryId: string, versionId: string,
  input: { decision: "confirmed" | "declined"; method: string; decidedBy: string; note?: string | null; grantId?: string | null; recordedBy?: string | null }) {
  if (!CONFIRMATION_METHODS.includes(input.method as ConfirmationMethod)) throw new BadRequestException("Say how the client confirmed.");
  if (input.method === "portal" ? !input.grantId : !input.recordedBy) throw new BadRequestException("Say who recorded the client's decision.");
  const name = input.decidedBy.trim();
  if (!name || name.length > 200) throw new BadRequestException("Say who decided.");
  if (input.decision === "declined" && !input.note?.trim()) throw new BadRequestException("Say what the client wants instead.");
  const entry = (await db.query<{ currentNumber: number; archivedAt: Date | null }>(
    `SELECT current_number AS "currentNumber", archived_at AS "archivedAt" FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, entryId])).rows[0];
  if (!entry || entry.archivedAt) throw new NotFoundException("This choice isn't on the list any more.");
  const version = (await db.query<{ number: number; status: VersionStatus; title: string; confirmedGrant: string | null; confirmedBy: string | null }>(
    `SELECT number, status, title, confirmed_by_grant_id AS "confirmedGrant", confirmation_recorded_by AS "confirmedBy" FROM design_ledger_versions
      WHERE workspace_id = $1 AND entry_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, entryId, versionId])).rows[0];
  if (!version) throw new NotFoundException("This version isn't on the list.");
  // The same decision sent again is a replay.
  if (version.status === input.decision && ((input.grantId && version.confirmedGrant === input.grantId) || (input.recordedBy && version.confirmedBy === input.recordedBy))) return { replayed: true, title: version.title };
  const problem = confirmProblem(version, entry.currentNumber);
  if (problem) throw new ConflictException(problem);
  await db.query(
    `UPDATE design_ledger_versions SET status = $4, confirmed_at = clock_timestamp(), confirmation_method = $5, confirmed_by_name = $6, confirmed_by_grant_id = $7,
            confirmation_recorded_by = $8, confirmation_note = $9 WHERE workspace_id = $1 AND entry_id = $2 AND id = $3`,
    [workspaceId, entryId, versionId, input.decision, input.method, name, input.grantId ?? null, input.recordedBy ?? null, input.note?.trim() || null]);
  await db.query(`UPDATE design_ledger_entries SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId]);
  if (input.grantId) {
    const facts = await caseTitle(db, workspaceId, caseId);
    await tellStaff(db, { workspaceId, recipients: await caseTeam(db, workspaceId, caseId, ["design"]), code: "design.ledger_confirmed",
      variables: { clientName: facts.clientName, title: version.title, note: input.decision === "confirmed" ? "Confirmed in the portal." : `Declined: ${input.note?.trim()}` },
      deepLink: ledgerLink(caseId), key: `${versionId}:${input.decision}` });
  }
  return { replayed: false, title: version.title };
}

/**
 * Locks the list as it is: the exact version of every live choice, all confirmed by the client. The first lock is
 * the design sign-off; later ones approve the changes made since (E5-1).
 */
export async function lockLedger(db: Db, workspaceId: string, caseId: string, userId: string, reason: "design_sign_off" | "change_approved", note: string | null) {
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
  const ledger = await readLedger(db, workspaceId, caseId);
  if (reason === "change_approved" && ledger.state !== "changes_pending") throw new ConflictException(ledger.lock ? "Nothing changed since the list was locked." : "Lock the list at the design sign-off first.");
  if (reason === "design_sign_off" && ledger.lock) return ledger.lock.number;
  const problem = ledger.lockProblem;
  if (problem) throw new ConflictException(problem);
  const number = (ledger.lock?.number ?? 0) + 1;
  const id = randomUUID();
  await db.query(`INSERT INTO design_ledger_locks (id, workspace_id, case_id, number, reason, note, locked_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, workspaceId, caseId, number, reason, note, userId]);
  for (const entry of ledger.entries.filter((item) => !item.archivedAt && item.current))
    await db.query(`INSERT INTO design_ledger_lock_lines (workspace_id, lock_id, entry_id, version_id) VALUES ($1, $2, $3, $4)`, [workspaceId, id, entry.id, entry.current!.id]);
  return number;
}

/**
 * PLM-054: what blocks ordering a project's materials. A case that keeps a ledger can't order until the list was
 * locked; after that procurement uses the locked versions while later changes wait for approval (E5-1).
 */
export async function ledgerProcurementProblem(db: Db, workspaceId: string, projectId: string) {
  const row = (await db.query<{ reference: string; hasLedger: boolean; hasLock: boolean }>(
    `SELECT COALESCE(project.reference, project.name, '') AS reference,
            EXISTS (SELECT 1 FROM design_ledger_entries entry WHERE entry.workspace_id = project.workspace_id AND entry.case_id = project.case_id AND entry.archived_at IS NULL) AS "hasLedger",
            EXISTS (SELECT 1 FROM design_ledger_locks lock WHERE lock.workspace_id = project.workspace_id AND lock.case_id = project.case_id) AS "hasLock"
       FROM delivery_projects project WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
  return row ? procurementProblem(row.hasLedger, row.hasLock, row.reference) : null;
}

const ledgerLink = (caseId: string) => `/workspace/pre-projects/cases/${caseId}/designs?stage=ledger`;

/**
 * A new version waits for the client in their portal. After the lock it is a change: Sales (the Account Manager and
 * the Sales Admin) hear its price and time impact, in the app and by email.
 */
async function noticeVersion(db: Db, workspaceId: string, caseId: string, input: { versionId: string; title: string; impact: string; days: number; afterLock: boolean; currency: string | null; actor: LedgerActor }) {
  await tellClients(db, { workspaceId, caseId, event: "decision_waiting", recordId: `ledger:${input.versionId}`, title: input.title });
  if (!input.afterLock) return;
  const facts = await caseTitle(db, workspaceId, caseId);
  const manager = (await db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       JOIN workspace_memberships membership ON membership.workspace_id = pre_case.workspace_id AND membership.id = opportunity.owner_membership_id AND membership.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows.map((row) => row.userId);
  const admin = await salesAdminMembership(db, workspaceId, caseId);
  const adminUser = admin ? (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, admin])).rows.map((row) => row.userId) : [];
  await tellStaff(db, { workspaceId, recipients: [...new Set([...manager, ...adminUser])], code: "design.ledger_changed",
    variables: { clientName: facts.clientName, title: input.title, impact: impactText(input.impact, input.days, input.currency) },
    deepLink: ledgerLink(caseId), key: input.versionId, email: true, except: input.actor.userId });
}
