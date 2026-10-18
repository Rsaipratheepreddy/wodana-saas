import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { caseTitle } from "../client-portal/portal-notices";
import { readDrawingRevisions } from "../project-core/project-drawings";
import { clientChoicesSignedOff } from "../project-core/project-materials";
import { orderPaymentIn } from "../purchasing/client-payment";
import { caseFacts, completeTask, designTeamConfig, caseRoleHolder, leadDesigner, samplesApprovedAt, tellMembers, workspaceToday } from "./design-journey.store";
import { ledgerProcurementProblem, readLedger, type LedgerVersionRow } from "./design-ledger.store";
import { TEAM_SLOTS, type TeamSlot } from "./design-team.domain";
import {
  categoriesProblem, changedSinceHandoff, DEFAULT_FINISH_CATEGORIES, editorSlotsProblem, logStatus, markerProblem, markerValue, names, originOf, readCategories,
  signatureProblem, signaturesMissing, specificationProblem, type FinishCategory,
} from "./finishes.domain";

type Db = Pick<PoolClient, "query">;

/** The firm's finishes configuration, with the defaults for a workspace that configured nothing. */
export type FinishSettings = {
  categories: FinishCategory[]; configured: boolean; specificationGate: boolean; finishesToQsDays: number; materialEditorSlots: TeamSlot[];
  signatureRequiredSince: Date | null; version: number;
};

export async function finishSettings(db: Db, workspaceId: string): Promise<FinishSettings> {
  const row = (await db.query<{ categories: unknown; specificationGate: boolean; days: number; slots: string[]; since: Date | null; version: number }>(
    `SELECT categories, specification_gate AS "specificationGate", finishes_to_qs_days AS days, material_editor_slots AS slots, signature_required_since AS since, version
       FROM workspace_finish_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  if (!row) return { categories: [...DEFAULT_FINISH_CATEGORIES], configured: false, specificationGate: false, finishesToQsDays: 3, materialEditorSlots: [], signatureRequiredSince: null, version: 0 };
  const categories = readCategories(row.categories);
  return { categories: categories.length ? categories : [...DEFAULT_FINISH_CATEGORIES], configured: true, specificationGate: row.specificationGate, finishesToQsDays: row.days,
    materialEditorSlots: (row.slots ?? []).filter((slot): slot is TeamSlot => (TEAM_SLOTS as readonly string[]).includes(slot)), signatureRequiredSince: row.since, version: row.version };
}

/**
 * Saves the firm's finishes configuration (Settings › Design), version-checked. The first time a category asks for the
 * client's signature, the day is kept: projects that ordered before it aren't blocked after the fact (PLM-148).
 */
export async function saveFinishSettings(db: Db, workspaceId: string, input: { version: number; categories?: unknown; specificationGate?: unknown; finishesToQsDays?: unknown; materialEditorSlots?: unknown }, userId: string) {
  const current = await finishSettings(db, workspaceId);
  if (input.version !== current.version) throw new ConflictException("Someone changed these settings. Reload to see the latest.");
  if (input.categories !== undefined) { const problem = categoriesProblem(input.categories); if (problem) throw new UnprocessableEntityException(problem); }
  if (input.materialEditorSlots !== undefined) { const problem = editorSlotsProblem(input.materialEditorSlots); if (problem) throw new UnprocessableEntityException(problem); }
  if (input.specificationGate !== undefined && typeof input.specificationGate !== "boolean") throw new BadRequestException("Say yes or no for the final specification.");
  if (input.finishesToQsDays !== undefined && (!Number.isInteger(input.finishesToQsDays) || Number(input.finishesToQsDays) < 1 || Number(input.finishesToQsDays) > 60))
    throw new BadRequestException("The days to send the finishes to QS are 1 to 60.");
  const categories = input.categories !== undefined ? readCategories(input.categories) : current.categories;
  const slots = input.materialEditorSlots !== undefined ? [...new Set(input.materialEditorSlots as TeamSlot[])] : current.materialEditorSlots;
  const gate = input.specificationGate !== undefined ? input.specificationGate as boolean : current.specificationGate;
  const days = input.finishesToQsDays !== undefined ? Number(input.finishesToQsDays) : current.finishesToQsDays;
  const signing = categories.some((category) => category.clientSignature);
  await db.query(
    `INSERT INTO workspace_finish_settings (workspace_id, categories, specification_gate, finishes_to_qs_days, material_editor_slots, signature_required_since, version, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, CASE WHEN $6 THEN now() END, 1, $7, now())
     ON CONFLICT (workspace_id) DO UPDATE SET categories = excluded.categories, specification_gate = excluded.specification_gate, finishes_to_qs_days = excluded.finishes_to_qs_days,
       material_editor_slots = excluded.material_editor_slots,
       signature_required_since = coalesce(workspace_finish_settings.signature_required_since, excluded.signature_required_since),
       version = workspace_finish_settings.version + 1, updated_by = excluded.updated_by, updated_at = now()`,
    [workspaceId, JSON.stringify(categories), gate, days, slots, signing, userId]);
  return { before: current, after: await finishSettings(db, workspaceId) };
}

export type PriceBand = { id: string; label: string; minAmount: string | null; maxAmount: string | null; position: number; archived: boolean };

export async function priceBands(db: Db, workspaceId: string, all = false): Promise<PriceBand[]> {
  return (await db.query<PriceBand>(
    `SELECT id, label, min_amount::text AS "minAmount", max_amount::text AS "maxAmount", position, archived_at IS NOT NULL AS archived FROM sample_price_bands
      WHERE workspace_id = $1 AND ($2 OR archived_at IS NULL) ORDER BY archived_at NULLS FIRST, position, lower(label)`, [workspaceId, all])).rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- the schedule ----------

type SnapshotRow = { id: string; entryId: string; assetId: string; assetName: string | null; markerX: string; markerY: string; label: string; createdByName: string | null; createdAt: Date };
type SignatureRow = { id: string; entryId: string; versionId: string; signedOn: string; signer: string; assetId: string; assetName: string | null; note: string; recordedByName: string | null; recordedAt: Date };

/** The case's delivery project, once it exists (the schedule reads its drawings and its procurement gate). */
export async function caseProject(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; reference: string; name: string; status: string; startedAt: Date | null }>(
    `SELECT id, reference, name, status, started_at AS "startedAt" FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 ORDER BY started_at NULLS LAST, created_at LIMIT 1`,
    [workspaceId, caseId])).rows[0] ?? null;
}

/** The design journey's order and whether it has a samples step (new design journeys do; furniture/joinery orders and old journeys don't). */
async function journeyOf(db: Db, workspaceId: string, caseId: string) {
  const row = (await db.query<{ flowVersion: number; designed: boolean }>(
    `SELECT flow_version AS "flowVersion", (package_id IS NOT NULL OR package_name IS NOT NULL) AS designed FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId])).rows[0];
  if (!row) return { exists: false, designed: false, samplesStep: false };
  const samples = (await db.query(`SELECT 1 FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'samples'`, [workspaceId, caseId])).rowCount;
  return { exists: true, designed: row.designed, samplesStep: Boolean(samples) && Number(row.flowVersion) >= 2 };
}

/** The latest hand-off to QS and exactly which version of each finish it carried. */
async function latestHandoff(db: Db, workspaceId: string, caseId: string) {
  const handoff = (await db.query<{ id: string; number: number; note: string; sentAt: Date; sentByName: string | null }>(
    `SELECT handoff.id, handoff.number, handoff.note, handoff.sent_at AS "sentAt", sender.display_name AS "sentByName" FROM finish_qs_handoffs handoff
       LEFT JOIN users sender ON sender.id = handoff.sent_by WHERE handoff.workspace_id = $1 AND handoff.case_id = $2 ORDER BY handoff.number DESC LIMIT 1`,
    [workspaceId, caseId])).rows[0];
  if (!handoff) return null;
  const lines = (await db.query<{ entryId: string; versionId: string; title: string }>(
    `SELECT line.entry_id AS "entryId", line.version_id AS "versionId", version.title FROM finish_qs_handoff_lines line
       JOIN design_ledger_versions version ON version.workspace_id = line.workspace_id AND version.id = line.version_id
      WHERE line.workspace_id = $1 AND line.handoff_id = $2`, [workspaceId, handoff.id])).rows;
  return { ...handoff, lines };
}

/** The finishes of a case: the live materials of its ledger (a design choice is not a finish). */
async function liveFinishes(db: Db, workspaceId: string, caseId: string) {
  const ledger = await readLedger(db, workspaceId, caseId);
  return { ledger, finishes: ledger.entries.filter((entry) => entry.kind === "material" && !entry.archivedAt) };
}

/** The version procurement uses for a finish: the signed-off one while the list is locked, else the current one. */
const requiredVersion = (entry: { locked: { id: string } | null; current: { id: string } | null }) => entry.locked?.id ?? entry.current?.id ?? null;

async function signaturesOf(db: Db, workspaceId: string, caseId: string): Promise<SignatureRow[]> {
  return (await db.query<SignatureRow>(
    `SELECT signature.id, signature.entry_id AS "entryId", signature.version_id AS "versionId", to_char(signature.signed_on, 'YYYY-MM-DD') AS "signedOn", signature.signer,
            signature.asset_id AS "assetId", asset.original_name AS "assetName", signature.note, recorder.display_name AS "recordedByName", signature.recorded_at AS "recordedAt"
       FROM finish_client_signatures signature
       LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = signature.workspace_id AND asset.id = signature.asset_id
       LEFT JOIN users recorder ON recorder.id = signature.recorded_by
      WHERE signature.workspace_id = $1 AND signature.case_id = $2 ORDER BY signature.recorded_at DESC, signature.id`, [workspaceId, caseId])).rows;
}

/**
 * PLM-146: whether the specification is final for the final quotation: the samples approved (where the job has a samples
 * step), the finishes sent to QS, and nothing changed since the latest hand-off.
 */
export async function specificationState(db: Db, workspaceId: string, caseId: string) {
  const journey = await journeyOf(db, workspaceId, caseId);
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  const handoff = await latestHandoff(db, workspaceId, caseId);
  const samplesApproved = Boolean(await samplesApprovedAt(db, workspaceId, caseId));
  const changed = handoff ? changedSinceHandoff(finishes.map((entry) => ({ id: entry.id, title: entry.title, versionId: entry.current?.id ?? null })), handoff.lines) : [];
  const problem = specificationProblem({ samplesStep: journey.samplesStep, samplesApproved, sentNumber: handoff?.number ?? null, changedSince: changed, finishes: finishes.length });
  return { journey, samplesApproved, handoff, changed, problem, final: !problem };
}

/**
 * PLM-148: the finishes the client still has to sign before this project's materials are ordered: none when no category
 * asks for it, or when the project already ordered before the firm started asking (older procurement isn't blocked).
 */
export async function signatureGate(db: Db, workspaceId: string, projectId: string) {
  const settings = await finishSettings(db, workspaceId);
  const project = (await db.query<{ caseId: string; reference: string; name: string }>(`SELECT case_id AS "caseId", reference, name FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0];
  const none = { missing: [] as string[], exempt: false, required: 0, caseId: project?.caseId ?? null, reference: project?.reference ?? "", name: project?.name ?? "" };
  if (!project || !settings.categories.some((category) => category.clientSignature)) return none;
  if (settings.signatureRequiredSince && (await db.query(
    `SELECT 1 FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.source IN ('material', 'line') AND purchase.created_at < $3
        AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received', 'received', 'closed') LIMIT 1`, [workspaceId, projectId, settings.signatureRequiredSince])).rowCount)
    return { ...none, exempt: true };
  const { finishes } = await liveFinishes(db, workspaceId, project.caseId);
  const signed = await signaturesOf(db, workspaceId, project.caseId);
  const signing = new Set(settings.categories.filter((category) => category.clientSignature).map((category) => category.key));
  const rows = finishes.map((entry) => ({ title: entry.title, categoryKey: entry.categoryKey, requiredVersionId: requiredVersion(entry),
    signedVersionIds: signed.filter((row) => row.entryId === entry.id).map((row) => row.versionId) }));
  return { ...none, missing: signaturesMissing(rows, settings.categories), required: finishes.filter((entry) => entry.categoryKey && signing.has(entry.categoryKey)).length };
}

/** The procurement gate of a project, all three parts (PLM-054 kept, PLM-148 added), for the schedule and the worker. */
export async function procurementGate(db: Db, workspaceId: string, projectId: string) {
  const payment = await orderPaymentIn(db, workspaceId, projectId);
  const materials = await clientChoicesSignedOff(db, workspaceId, projectId) && !(await ledgerProcurementProblem(db, workspaceId, projectId));
  const signatures = await signatureGate(db, workspaceId, projectId);
  return { payment, materials, signatures: { missing: signatures.missing, exempt: signatures.exempt, required: signatures.required }, cleared: payment && materials && !signatures.missing.length };
}

/** The schedule as a page reads it: every finish with its log status, snapshots, signature and pricing, plus the hand-off, the share, the gates and the drawings. */
export async function readSchedule(db: Db, workspaceId: string, caseId: string) {
  const settings = await finishSettings(db, workspaceId);
  const { ledger, finishes } = await liveFinishes(db, workspaceId, caseId);
  const removed = ledger.entries.filter((entry) => entry.kind === "material" && entry.archivedAt);
  const snapshots = (await db.query<SnapshotRow>(
    `SELECT snapshot.id, snapshot.entry_id AS "entryId", snapshot.asset_id AS "assetId", asset.original_name AS "assetName", snapshot.marker_x::text AS "markerX",
            snapshot.marker_y::text AS "markerY", snapshot.label, creator.display_name AS "createdByName", snapshot.created_at AS "createdAt"
       FROM finish_snapshots snapshot
       LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = snapshot.workspace_id AND asset.id = snapshot.asset_id
       LEFT JOIN users creator ON creator.id = snapshot.created_by
      WHERE snapshot.workspace_id = $1 AND snapshot.case_id = $2 AND snapshot.archived_at IS NULL ORDER BY snapshot.created_at`, [workspaceId, caseId])).rows;
  const signatures = await signaturesOf(db, workspaceId, caseId);
  const spec = await specificationState(db, workspaceId, caseId);
  const links = (await db.query<{ lineId: string; entryId: string; versionId: string; title: string | null }>(
    `SELECT link.line_id AS "lineId", link.entry_id AS "entryId", link.version_id AS "versionId",
            (SELECT line.title FROM commercial_quote_lines line WHERE line.workspace_id = link.workspace_id AND line.case_id = link.case_id AND line.id = link.line_id LIMIT 1) AS title
       FROM finish_quote_links link WHERE link.workspace_id = $1 AND link.case_id = $2`, [workspaceId, caseId])).rows.filter((row) => row.title !== null);
  const share = (await db.query<{ number: number; sharedAt: Date; sharedByName: string | null; note: string }>(
    `SELECT share.number, share.shared_at AS "sharedAt", sharer.display_name AS "sharedByName", share.note FROM finish_factory_shares share
       LEFT JOIN users sharer ON sharer.id = share.shared_by WHERE share.workspace_id = $1 AND share.case_id = $2 ORDER BY share.number DESC LIMIT 1`, [workspaceId, caseId])).rows[0] ?? null;
  const project = await caseProject(db, workspaceId, caseId);
  const signing = new Set(settings.categories.filter((category) => category.clientSignature).map((category) => category.key));
  const label = new Map(settings.categories.map((category) => [category.key, category.label]));
  const sent = new Map((spec.handoff?.lines ?? []).map((line) => [line.entryId, line.versionId]));
  const entries = finishes.map((entry) => {
    const current = entry.current as LedgerVersionRow | null;
    const required = requiredVersion(entry);
    const signature = signatures.find((row) => row.entryId === entry.id && row.versionId === required) ?? null;
    const lastSignature = signature ?? signatures.find((row) => row.entryId === entry.id) ?? null;
    const priced = links.filter((link) => link.entryId === entry.id);
    return {
      id: entry.id, title: entry.title, roomId: entry.roomId, roomName: entry.roomName, categoryKey: entry.categoryKey,
      // A category the firm removed later still reads by its key.
      categoryLabel: entry.categoryKey ? label.get(entry.categoryKey) ?? entry.categoryKey : null,
      location: entry.location, installNote: entry.installNote, position: entry.position, version: entry.version,
      current: current ? {
        id: current.id, number: current.number, specification: current.specification, supplier: current.supplier, quantity: current.quantity, unit: current.unit,
        catalogItemId: current.catalogItemId, origin: originOf(current), outsourced: current.outsourced, signOff: current.signOff, status: current.status,
        sampleId: current.sampleId, sampleName: current.sampleName, samplePhotoAssetId: current.samplePhotoAssetId, samplePhotoName: current.samplePhotoName,
        note: current.note, confirmedAt: current.confirmedAt, confirmedByName: current.confirmedByName,
      } : null,
      locked: entry.locked,
      status: logStatus(current),
      snapshots: snapshots.filter((row) => row.entryId === entry.id).map(({ entryId: _entry, ...row }) => { void _entry; return { ...row, markerX: Number(row.markerX), markerY: Number(row.markerY), createdAt: row.createdAt.toISOString() }; }),
      signature: {
        required: Boolean(entry.categoryKey && signing.has(entry.categoryKey)),
        signed: Boolean(signature),
        // The latest one recorded, even for an older version (then it is out of date and needs signing again).
        last: lastSignature ? { signedOn: lastSignature.signedOn, signer: lastSignature.signer, assetId: lastSignature.assetId, assetName: lastSignature.assetName,
          recordedByName: lastSignature.recordedByName, outOfDate: lastSignature !== signature } : null,
      },
      sentToQs: Boolean(current && sent.get(entry.id) === current.id),
      changedSinceSent: Boolean(spec.handoff && (!current || sent.get(entry.id) !== current.id)),
      priced: { lines: priced.length, stale: priced.filter((link) => link.versionId !== current?.id).length },
    };
  });
  const gate = project?.startedAt ? await procurementGate(db, workspaceId, project.id) : null;
  return {
    categories: settings.categories,
    entries,
    removed: removed.map((entry) => ({ id: entry.id, title: entry.title, roomName: entry.roomName, archivedAt: entry.archivedAt })),
    lock: ledger.lock, currency: ledger.currency,
    specification: {
      gate: settings.specificationGate && spec.journey.designed, samplesStep: spec.journey.samplesStep, samplesApproved: spec.samplesApproved, final: spec.final, problem: spec.problem,
      handoff: spec.handoff ? { number: spec.handoff.number, sentAt: spec.handoff.sentAt.toISOString(), sentByName: spec.handoff.sentByName, note: spec.handoff.note, finishes: spec.handoff.lines.length } : null,
      changed: spec.changed,
    },
    share: share ? { ...share, sharedAt: share.sharedAt.toISOString() } : null,
    project: project ? { id: project.id, reference: project.reference, name: project.name, started: Boolean(project.startedAt) } : null,
    procurement: gate,
    drawings: await drawingsSchedule(db, workspaceId, caseId, project?.id ?? null),
  };
}

export type ScheduleView = Awaited<ReturnType<typeof readSchedule>>;

/**
 * PLM-156: what the factory reads of a shared sample log: each finish's specification, sample and photos, its snapshots,
 * where it goes and the installation note (with the drawings). Nothing QS keeps (what went to QS, priced lines, prices to
 * check, the specification notices), no client signatures, no supplier, payment or procurement state and no currency.
 */
export function factoryScheduleView(view: ScheduleView) {
  const { entries, removed, categories, share, project, drawings } = view;
  return {
    categories, removed, share, project, drawings,
    entries: entries.map((entry) => ({
      id: entry.id, title: entry.title, roomId: entry.roomId, roomName: entry.roomName, categoryKey: entry.categoryKey, categoryLabel: entry.categoryLabel,
      location: entry.location, installNote: entry.installNote, position: entry.position, version: entry.version, status: entry.status, snapshots: entry.snapshots,
      current: entry.current ? {
        id: entry.current.id, number: entry.current.number, specification: entry.current.specification, quantity: entry.current.quantity, unit: entry.current.unit,
        sampleId: entry.current.sampleId, sampleName: entry.current.sampleName, samplePhotoAssetId: entry.current.samplePhotoAssetId, samplePhotoName: entry.current.samplePhotoName,
      } : null,
    })),
  };
}

/**
 * PLM-156: the drawings schedule, read from the records (never copied): the case's design drawings with their latest
 * revision and status, and the project's shop drawings by revision.
 */
async function drawingsSchedule(db: Db, workspaceId: string, caseId: string, projectId: string | null) {
  const designs = (await db.query<{ id: string; title: string; stage: string | null; roomName: string | null; revision: number | null; status: string | null; updatedAt: Date }>(
    `SELECT design.id, design.title, design.stage, room.name AS "roomName", latest.number AS revision, latest.status, design.updated_at AS "updatedAt"
       FROM pre_project_designs design
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.id = design.room_id
       LEFT JOIN LATERAL (SELECT version.number, version.status FROM pre_project_design_versions version
                           WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY version.number DESC LIMIT 1) latest ON true
      WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL ORDER BY design.stage NULLS LAST, room.name NULLS LAST, design.title`, [workspaceId, caseId])).rows
    .map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  const shop = projectId ? (await readDrawingRevisions(db, workspaceId, projectId)).map((revision) => ({
    id: revision.id, number: revision.number, status: revision.status, sentAt: revision.sentAt, decidedOn: revision.decidedOn,
    files: revision.files.filter((file) => file.kind === "drawing").map((file) => ({ id: file.id, name: file.name })),
  })) : [];
  return { designs, shop };
}

/** A finish of the case that is still on the list, locked for the change. */
async function finishEntry(db: Db, workspaceId: string, caseId: string, entryId: string) {
  const entry = (await db.query<{ kind: string; version: number; archivedAt: Date | null; categoryKey: string | null; location: string; installNote: string; roomId: string | null }>(
    `SELECT kind, version, archived_at AS "archivedAt", category_key AS "categoryKey", location, install_note AS "installNote", room_id AS "roomId"
       FROM design_ledger_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, entryId])).rows[0];
  if (!entry || entry.kind !== "material") throw new NotFoundException("This finish isn't on the schedule.");
  if (entry.archivedAt) throw new ConflictException("This finish was removed from the schedule.");
  return entry;
}

/**
 * The placement of a finish (PLM-156): its category, its room, where in the room and the installation note.
 * Version-checked; the same values again change nothing. It never touches what the client confirmed.
 */
export async function updateFinishDetails(db: Db, workspaceId: string, caseId: string, entryId: string,
  input: { entryVersion: number; categoryKey?: string | null; roomId?: string | null; location?: string | null; installNote?: string | null }) {
  const entry = await finishEntry(db, workspaceId, caseId, entryId);
  const next = {
    categoryKey: input.categoryKey !== undefined ? input.categoryKey : entry.categoryKey,
    roomId: input.roomId !== undefined ? input.roomId : entry.roomId,
    location: input.location !== undefined ? (input.location ?? "").trim() : entry.location,
    installNote: input.installNote !== undefined ? (input.installNote ?? "").trim() : entry.installNote,
  };
  if (next.categoryKey === entry.categoryKey && next.roomId === entry.roomId && next.location === entry.location && next.installNote === entry.installNote) return { changed: false, before: entry, after: next };
  if (entry.version !== input.entryVersion) throw new ConflictException("This finish changed in another window. Reload and try again.");
  if (next.categoryKey && !(await finishSettings(db, workspaceId)).categories.some((category) => category.key === next.categoryKey) && next.categoryKey !== entry.categoryKey)
    throw new BadRequestException("Choose one of the firm's finish categories.");
  if (next.location.length > 200) throw new BadRequestException("Keep where it goes under 200 characters.");
  if (next.installNote.length > 2000) throw new BadRequestException("Keep the installation note under 2000 characters.");
  if (next.roomId && !(await db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, next.roomId])).rowCount)
    throw new BadRequestException("Choose a room of this project.");
  await db.query(`UPDATE design_ledger_entries SET category_key = $4, room_id = $5, location = $6, install_note = $7, version = version + 1, updated_at = now()
                   WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, entryId, next.categoryKey, next.roomId, next.location, next.installNote]);
  return { changed: true, before: entry, after: next };
}

/** PLM-146: the designer marks a finish on a render snapshot (a crop uploaded to the case) with a marker and a label. Idempotent by id. */
export async function addSnapshot(db: Db, workspaceId: string, caseId: string, entryId: string, input: { id: string; assetId: string; markerX: number; markerY: number; label: string }, userId: string) {
  await finishEntry(db, workspaceId, caseId, entryId);
  const problem = markerProblem(input);
  if (problem) throw new UnprocessableEntityException(problem);
  const existing = (await db.query<{ entryId: string; assetId: string; label: string }>(
    `SELECT entry_id AS "entryId", asset_id AS "assetId", label FROM finish_snapshots WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.id])).rows[0];
  if (existing) {
    if (existing.entryId !== entryId || existing.assetId !== input.assetId || existing.label !== input.label.trim()) throw new ConflictException("This snapshot ID is already in use.");
    return { replayed: true };
  }
  if (!(await db.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND mime_type LIKE 'image/%'`, [workspaceId, caseId, input.assetId])).rowCount)
    throw new BadRequestException("Upload the render snapshot (an image) to this project first.");
  if (Number((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM finish_snapshots WHERE workspace_id = $1 AND entry_id = $2 AND archived_at IS NULL`, [workspaceId, entryId])).rows[0].count) >= 12)
    throw new ConflictException("A finish keeps up to 12 snapshots. Remove one first.");
  await db.query(`INSERT INTO finish_snapshots (id, workspace_id, case_id, entry_id, asset_id, marker_x, marker_y, label, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.id, workspaceId, caseId, entryId, input.assetId, markerValue(input.markerX), markerValue(input.markerY), input.label.trim(), userId]);
  return { replayed: false };
}

export async function archiveSnapshot(db: Db, workspaceId: string, caseId: string, snapshotId: string, userId: string) {
  const row = (await db.query<{ archivedAt: Date | null }>(`SELECT archived_at AS "archivedAt" FROM finish_snapshots WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
    [workspaceId, caseId, snapshotId])).rows[0];
  if (!row) throw new NotFoundException("This snapshot isn't on the schedule.");
  if (row.archivedAt) return false;
  await db.query(`UPDATE finish_snapshots SET archived_at = now(), archived_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, snapshotId, userId]);
  return true;
}

/**
 * PLM-146: "Send to QS". The finishes as they are now (each finish's current version) become the next hand-off; the
 * samples must be approved first where the job has a samples step. Sending the same finishes again changes nothing.
 * The step's task is done, and the QS hears it (in the app and by email).
 */
export async function sendToQs(db: Db, workspaceId: string, caseId: string, input: { note?: string | null }, userId: string) {
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
  const spec = await specificationState(db, workspaceId, caseId);
  if (spec.journey.samplesStep && !spec.samplesApproved) throw new ConflictException("Approve the samples first. The finishes go to QS from the approved samples.");
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  if (!finishes.length) throw new UnprocessableEntityException("Add the finishes to the schedule first.");
  const declined = finishes.filter((entry) => entry.current?.status === "declined");
  if (declined.length) throw new ConflictException(`The client didn't approve ${names(declined.map((entry) => entry.title))}. Record the new choice first.`);
  if (spec.handoff && !spec.changed.length) return { replayed: true, number: spec.handoff.number, count: finishes.length };
  const id = randomUUID();
  const number = (spec.handoff?.number ?? 0) + 1;
  const note = (input.note ?? "").trim().slice(0, 2000);
  await db.query(`INSERT INTO finish_qs_handoffs (id, workspace_id, case_id, number, note, sent_by) VALUES ($1, $2, $3, $4, $5, $6)`, [id, workspaceId, caseId, number, note, userId]);
  for (const entry of finishes.filter((item) => item.current))
    await db.query(`INSERT INTO finish_qs_handoff_lines (workspace_id, handoff_id, entry_id, version_id) VALUES ($1, $2, $3, $4)`, [workspaceId, id, entry.id, entry.current!.id]);
  await completeTask(db, workspaceId, caseId, "finishes_to_qs", userId, note || null).catch(() => false);
  const facts = await caseFacts(db, workspaceId, caseId);
  const title = await caseTitle(db, workspaceId, caseId);
  await tellMembers(db, workspaceId, await qsMembers(db, workspaceId, caseId), "finishes.sent_to_qs",
    notice({ clientName: facts?.clientName ?? title.clientName, project: title.title, actor: await userName(db, userId), count: String(finishes.length), note,
      items: names(spec.changed.length ? spec.changed : finishes.map((entry) => entry.title)) }),
    `/workspace/pre-projects/cases/${caseId}/quotations`, `finishes:${caseId}:qs:${number}`, true, userId);
  return { replayed: false, number, count: finishes.length, changed: spec.changed };
}

/**
 * A finish changed after it went to QS (a new version, removed, or declined by the client): the QS hears it, and the
 * quotation lines priced from the old version show the old price flagged. Nothing when the finish never went to QS.
 */
export async function tellFinishChanged(db: Db, workspaceId: string, caseId: string, entryId: string, input: { title: string; what: string; actorUserId: string }) {
  const handoff = await latestHandoff(db, workspaceId, caseId);
  if (!handoff?.lines.some((line) => line.entryId === entryId)) return false;
  const facts = await caseFacts(db, workspaceId, caseId);
  const title = await caseTitle(db, workspaceId, caseId);
  const latest = (await db.query<{ id: string }>(`SELECT id FROM design_ledger_versions WHERE workspace_id = $1 AND entry_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, entryId])).rows[0]?.id ?? "";
  await tellMembers(db, workspaceId, await qsMembers(db, workspaceId, caseId), "finishes.changed",
    notice({ clientName: facts?.clientName ?? title.clientName, project: title.title, actor: await userName(db, input.actorUserId), title: input.title, note: input.what }),
    // Once per change (the finish's latest version and what happened to it).
    `/workspace/pre-projects/cases/${caseId}/quotations`, `finishes:changed:${createHash("sha256").update(`${entryId}:${latest}:${input.what}`).digest("hex").slice(0, 40)}`, true, input.actorUserId);
  return true;
}

/**
 * PLM-148: the client signed the physical sample or the data sheet of a finish, recorded by the designer: the version
 * signed (the one procurement uses), the day, who signed and a photo of it. The same signature again changes nothing.
 */
export async function recordSignature(db: Db, workspaceId: string, caseId: string, entryId: string,
  input: { id: string; versionId: string; signedOn: string; signer: string; assetId: string; note?: string | null }, userId: string) {
  await finishEntry(db, workspaceId, caseId, entryId);
  const problem = signatureProblem(input, await workspaceToday(db, workspaceId));
  if (problem) throw new UnprocessableEntityException(problem);
  const existing = (await db.query<{ entryId: string; versionId: string }>(`SELECT entry_id AS "entryId", version_id AS "versionId" FROM finish_client_signatures WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, input.id])).rows[0];
  if (existing) {
    if (existing.entryId !== entryId || existing.versionId !== input.versionId) throw new ConflictException("This signature ID is already in use.");
    return { replayed: true };
  }
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  const entry = finishes.find((item) => item.id === entryId)!;
  if (requiredVersion(entry) !== input.versionId) throw new ConflictException("This finish changed. Reload and record the signature on the version shown now.");
  if (!(await db.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND (mime_type LIKE 'image/%' OR mime_type = 'application/pdf')`,
    [workspaceId, caseId, input.assetId])).rowCount)
    throw new BadRequestException("Upload the photo of the signed sample or data sheet to this project first.");
  await db.query(`INSERT INTO finish_client_signatures (id, workspace_id, case_id, entry_id, version_id, signed_on, signer, asset_id, note, recorded_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.id, workspaceId, caseId, entryId, input.versionId, input.signedOn, input.signer.trim(), input.assetId, (input.note ?? "").trim().slice(0, 2000), userId]);
  return { replayed: false, title: entry.title };
}

/**
 * PLM-156: the lead designer shares the sample log and photos with the factory: the factory reads the case's schedule
 * from the Factory from now on, and the factory lead hears it (in the app and by email). Each share is kept.
 */
export async function shareWithFactory(db: Db, workspaceId: string, caseId: string, input: { note?: string | null }, userId: string) {
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  if (!finishes.length) throw new UnprocessableEntityException("Add the finishes and samples to the schedule first.");
  const number = Number((await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM finish_factory_shares WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId])).rows[0].next);
  const note = (input.note ?? "").trim().slice(0, 2000);
  await db.query(`INSERT INTO finish_factory_shares (id, workspace_id, case_id, number, note, shared_by) VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), workspaceId, caseId, number, note, userId]);
  const facts = await caseFacts(db, workspaceId, caseId);
  const title = await caseTitle(db, workspaceId, caseId);
  const project = await caseProject(db, workspaceId, caseId);
  const told = await tellMembers(db, workspaceId, await factoryLeads(db, workspaceId, project?.id ?? null), "finishes.factory_shared",
    notice({ clientName: facts?.clientName ?? title.clientName, project: title.title, actor: await userName(db, userId), note, count: String(finishes.length) }),
    `/workspace/factory/samples?case=${caseId}`, `finishes:${caseId}:factory:${number}`, true, userId);
  return { number, told };
}

/** Whether the factory may read this case's schedule: the lead designer shared it with them. */
export async function sharedWithFactory(db: Db, workspaceId: string, caseId: string) {
  return Boolean((await db.query(`SELECT 1 FROM finish_factory_shares WHERE workspace_id = $1 AND case_id = $2 LIMIT 1`, [workspaceId, caseId])).rowCount);
}

/** The cases whose sample log was shared with the factory, newest share first. */
export async function factoryShares(db: Db, workspaceId: string) {
  return (await db.query<{ caseId: string; number: number; sharedAt: Date; sharedByName: string | null; note: string; clientName: string; projectId: string | null; project: string | null }>(
    `SELECT DISTINCT ON (share.case_id) share.case_id AS "caseId", share.number, share.shared_at AS "sharedAt", sharer.display_name AS "sharedByName", share.note,
            coalesce(party.display_name, opportunity.title) AS "clientName", project.id AS "projectId", project.reference || ' · ' || project.name AS project
       FROM finish_factory_shares share
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = share.workspace_id AND pre_case.id = share.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN delivery_projects project ON project.workspace_id = share.workspace_id AND project.case_id = share.case_id
       LEFT JOIN users sharer ON sharer.id = share.shared_by
      WHERE share.workspace_id = $1 ORDER BY share.case_id, share.number DESC`, [workspaceId])).rows
    .sort((a, b) => b.sharedAt.getTime() - a.sharedAt.getTime()).map((row) => ({ ...row, sharedAt: row.sharedAt.toISOString() }));
}

/** Whether an asset belongs to the schedule of a case (a sample photo, a snapshot or a signed sample), so a reader of the schedule may open it. */
export async function scheduleAsset(db: Db, workspaceId: string, caseId: string, assetId: string, options: { signatures?: boolean } = {}) {
  return Boolean((await db.query(
    `SELECT 1 FROM design_ledger_versions WHERE workspace_id = $1 AND case_id = $2 AND sample_photo_asset_id = $3
     UNION ALL SELECT 1 FROM finish_snapshots WHERE workspace_id = $1 AND case_id = $2 AND asset_id = $3
     UNION ALL SELECT 1 FROM finish_client_signatures WHERE workspace_id = $1 AND case_id = $2 AND asset_id = $3 AND $4::boolean LIMIT 1`,
    [workspaceId, caseId, assetId, options.signatures !== false])).rowCount);
}

// ---------- the quotation's side (PLM-146) ----------

/** The finishes a quotation line can be priced from, and which lines are priced from which (with the old price flagged). */
export async function quoteFinishes(db: Db, workspaceId: string, caseId: string) {
  const settings = await finishSettings(db, workspaceId);
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  const label = new Map(settings.categories.map((category) => [category.key, category.label]));
  const snapshots = (await db.query<{ entryId: string; count: number }>(
    `SELECT entry_id AS "entryId", count(*)::int AS count FROM finish_snapshots WHERE workspace_id = $1 AND case_id = $2 AND archived_at IS NULL GROUP BY entry_id`, [workspaceId, caseId])).rows;
  const links = (await db.query<{ lineId: string; entryId: string; versionId: string }>(
    `SELECT line_id AS "lineId", entry_id AS "entryId", version_id AS "versionId" FROM finish_quote_links WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows;
  const handoff = await latestHandoff(db, workspaceId, caseId);
  const archived = new Set((await readLedger(db, workspaceId, caseId)).entries.filter((entry) => entry.archivedAt).map((entry) => entry.id));
  return {
    sent: handoff ? { number: handoff.number, sentAt: handoff.sentAt.toISOString(), sentByName: handoff.sentByName } : null,
    entries: finishes.map((entry) => ({ id: entry.id, title: entry.title, roomName: entry.roomName, categoryLabel: entry.categoryKey ? label.get(entry.categoryKey) ?? entry.categoryKey : null,
      specification: entry.current?.specification ?? "", versionId: entry.current?.id ?? null, number: entry.current?.number ?? null,
      snapshots: snapshots.find((row) => row.entryId === entry.id)?.count ?? 0, sent: Boolean(handoff?.lines.some((line) => line.entryId === entry.id)) })),
    links: links.map((link) => {
      const entry = finishes.find((item) => item.id === link.entryId);
      // The old price is flagged when the finish changed since the line was priced from it, or it was removed.
      return { lineId: link.lineId, entryId: link.entryId, stale: archived.has(link.entryId) || !entry || entry.current?.id !== link.versionId,
        removed: archived.has(link.entryId) };
    }),
  };
}

/** The text a line priced from a finish carries in its material column: the designer's own words. */
export const finishMaterialText = (entry: { title: string; current: { specification: string } | null }) =>
  [entry.title, entry.current?.specification].filter((part) => part && part.trim()).join(" · ").slice(0, 500);

/**
 * Prices a quotation line from a finish (or unlinks it with null): the line's material column takes the designer's
 * specification and the link remembers the finish version priced, so a later change flags the old price.
 */
export async function linkQuoteLine(db: Db, workspaceId: string, caseId: string, lineId: string, entryId: string | null, userId: string) {
  if (!entryId) {
    await db.query(`DELETE FROM finish_quote_links WHERE workspace_id = $1 AND case_id = $2 AND line_id = $3`, [workspaceId, caseId, lineId]);
    return null;
  }
  if (!UUID.test(entryId)) throw new BadRequestException("Choose a finish from the schedule.");
  const { finishes } = await liveFinishes(db, workspaceId, caseId);
  const entry = finishes.find((item) => item.id === entryId);
  if (!entry?.current) throw new BadRequestException("Choose a finish from the schedule.");
  await db.query(
    `INSERT INTO finish_quote_links (workspace_id, case_id, line_id, entry_id, version_id, linked_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, case_id, line_id) DO UPDATE SET entry_id = excluded.entry_id, version_id = excluded.version_id, linked_by = excluded.linked_by, linked_at = now()`,
    [workspaceId, caseId, lineId, entryId, entry.current.id, userId]);
  return { material: finishMaterialText(entry), title: entry.title };
}

/**
 * PLM-146: who edits the quotation's material column: the firm's chosen parts of the job's design team (Palm: the lead
 * and junior designers and the Sales Admin as back-up). With none chosen, or nobody holding them on this job, whoever
 * edits the quotation does; someone who runs Planning may always.
 */
export async function materialEditor(db: Db, workspaceId: string, caseId: string, membershipId: string | null, isAdmin: boolean) {
  const settings = await finishSettings(db, workspaceId);
  if (!settings.materialEditorSlots.length || isAdmin) return { allowed: true, restricted: settings.materialEditorSlots.length > 0, roles: [] as string[] };
  const config = await designTeamConfig(db, workspaceId);
  const roles = settings.materialEditorSlots.map((slot) => config[slot]).filter((role): role is string => Boolean(role));
  const holders = new Set<string>();
  for (const role of roles) { const holder = await caseHolders(db, workspaceId, caseId, role); holder.forEach((id) => holders.add(id)); }
  if (!holders.size) return { allowed: true, restricted: true, roles };
  return { allowed: Boolean(membershipId && holders.has(membershipId)), restricted: true, roles };
}

async function caseHolders(db: Db, workspaceId: string, caseId: string, roleKey: string) {
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT assignment.membership_id AS id FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.active AND $3::varchar = ANY(assignment.role_keys)
        AND (assignment.case_id = $2 OR assignment.project_id IN (SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2))`, [workspaceId, caseId, roleKey])).rows.map((row) => row.id);
}

/**
 * PLM-146: the final quotation (the main round, Proposal 2) waits for the final specification where the firm asks for
 * it, on a job that runs the new design order. A budget range the client asked for may go before; the design fee,
 * variations, furniture/joinery orders and journeys of the old order are never held.
 */
export async function specificationGateProblem(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const settings = await finishSettings(db, workspaceId);
  if (!settings.specificationGate) return null;
  const quote = (await db.query<{ kind: string; round: string | null }>(`SELECT kind, round FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [workspaceId, caseId, quoteId])).rows[0];
  if (!quote || quote.kind !== "quotation" || quote.round === "design") return null;
  if (await budgetRange(db, workspaceId, caseId, quoteId)) return null;
  const spec = await specificationState(db, workspaceId, caseId);
  if (!spec.journey.designed || !spec.journey.samplesStep) return null;
  return spec.problem ? `${spec.problem} A budget range can go before it only if the client asks for one.` : null;
}

/** What the quotation builder shows about the final specification: whether this quotation waits for it, why, and its budget-range mark. */
export async function quoteSpecification(db: Db, workspaceId: string, caseId: string, quote: { id: string; kind: string; round: string | null }) {
  if (quote.kind !== "quotation" || quote.round === "design") return null;
  const settings = await finishSettings(db, workspaceId);
  const spec = await specificationState(db, workspaceId, caseId);
  const applies = settings.specificationGate && spec.journey.designed && spec.journey.samplesStep;
  return { applies, final: spec.final, problem: applies ? spec.problem : null, budgetRange: await budgetRange(db, workspaceId, caseId, quote.id) };
}

export async function budgetRange(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  return (await db.query<{ note: string; markedByName: string | null; markedAt: Date }>(
    `SELECT range.request_note AS note, marker.display_name AS "markedByName", range.marked_at AS "markedAt" FROM quote_budget_ranges range
       LEFT JOIN users marker ON marker.id = range.marked_by WHERE range.workspace_id = $1 AND range.case_id = $2 AND range.quote_id = $3`, [workspaceId, caseId, quoteId])).rows
    .map((row) => ({ ...row, markedAt: row.markedAt.toISOString() }))[0] ?? null;
}

/** Marks a draft quotation as a budget range the client asked for (with what they asked), or takes the mark off. */
export async function setBudgetRange(db: Db, workspaceId: string, caseId: string, quoteId: string, input: { budgetRange: boolean; note?: string | null }, userId: string) {
  const quote = (await db.query<{ kind: string; round: string | null; status: string }>(`SELECT kind, round, status FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
    [workspaceId, caseId, quoteId])).rows[0];
  if (!quote) throw new NotFoundException("Quotation not found.");
  if (quote.kind !== "quotation" || quote.round === "design") throw new ConflictException("Only the main quotation can be a budget range.");
  if (!["draft", "internal_review", "internal_approved"].includes(quote.status)) throw new ConflictException("This quotation was already sent.");
  const current = await budgetRange(db, workspaceId, caseId, quoteId);
  if (!input.budgetRange) {
    if (!current) return false;
    await db.query(`DELETE FROM quote_budget_ranges WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3`, [workspaceId, caseId, quoteId]);
    return true;
  }
  const note = (input.note ?? "").trim();
  if (!note) throw new BadRequestException("Say how the client asked for a budget range.");
  if (note.length > 1000) throw new BadRequestException("Keep it under 1000 characters.");
  if (current?.note === note) return false;
  await db.query(`INSERT INTO quote_budget_ranges (workspace_id, case_id, quote_id, request_note, marked_by) VALUES ($1, $2, $3, $4, $5)
                  ON CONFLICT (workspace_id, case_id, quote_id) DO UPDATE SET request_note = excluded.request_note, marked_by = excluded.marked_by, marked_at = now()`,
    [workspaceId, caseId, quoteId, note, userId]);
  return true;
}

// ---------- procurement (PLM-148) ----------

/** Refused order: the client's signatures are missing. The designer is told after the refusal (outside its transaction). */
export class SignatureMissingException extends ConflictException {
  constructor(readonly projectId: string, readonly caseId: string, readonly reference: string, readonly missing: string[]) {
    super(`The client hasn't signed the samples or data sheets of ${reference} yet: ${names(missing)}. Ordering starts once the designer records them.`);
  }
}

/** Tells the case's designers that procurement tried to order without the client's signatures (once a day per project). */
export async function tellSignatureMissing(db: Db, workspaceId: string, error: SignatureMissingException, actorUserId: string) {
  const facts = await caseFacts(db, workspaceId, error.caseId);
  const title = await caseTitle(db, workspaceId, error.caseId);
  const config = await designTeamConfig(db, workspaceId);
  const designers = [await leadDesigner(db, workspaceId, error.caseId), await caseRoleHolder(db, workspaceId, error.caseId, config.junior_designer)];
  const today = await workspaceToday(db, workspaceId);
  return tellMembers(db, workspaceId, designers, "procurement.signature_missing",
    notice({ clientName: facts?.clientName ?? title.clientName, project: title.title, actor: await userName(db, actorUserId), items: names(error.missing), count: String(error.missing.length) }),
    `/workspace/projects/${error.projectId}/scope?view=finishes`, `procurement:${error.projectId}:signature:${today}`, true, actorUserId);
}

/**
 * The worker's pass for one workspace: a started project whose procurement gate just cleared (payment, material list,
 * signed samples) tells procurement once; a gate that closes again is marked open, so its next clearing tells them again.
 * Only projects with something the client chooses are watched.
 */
export async function processProcurementGates(db: Db, workspaceId: string) {
  const projects = (await db.query<{ id: string; caseId: string; clearedAt: Date | null }>(
    `SELECT project.id, project.case_id AS "caseId", gate.cleared_at AS "clearedAt" FROM delivery_projects project
       LEFT JOIN project_procurement_gates gate ON gate.workspace_id = project.workspace_id AND gate.project_id = project.id
      WHERE project.workspace_id = $1 AND project.started_at IS NOT NULL AND project.status IN ('active', 'on_hold')
        AND (EXISTS (SELECT 1 FROM project_material_items item WHERE item.workspace_id = project.workspace_id AND item.project_id = project.id AND item.client_choice)
          OR EXISTS (SELECT 1 FROM design_ledger_entries entry WHERE entry.workspace_id = project.workspace_id AND entry.case_id = project.case_id AND entry.kind = 'material' AND entry.archived_at IS NULL))
      ORDER BY project.id LIMIT 500`, [workspaceId])).rows;
  let cleared = 0;
  for (const project of projects) {
    const gate = await procurementGate(db, workspaceId, project.id);
    if (gate.cleared && !project.clearedAt) {
      const marked = await db.query(
        `INSERT INTO project_procurement_gates (workspace_id, project_id, cleared_at, notified_at, checked_at) VALUES ($1, $2, now(), now(), now())
         ON CONFLICT (workspace_id, project_id) DO UPDATE SET cleared_at = now(), notified_at = now(), checked_at = now() WHERE project_procurement_gates.cleared_at IS NULL`,
        [workspaceId, project.id]);
      if (!marked.rowCount) continue;
      const facts = await caseFacts(db, workspaceId, project.caseId);
      const title = await caseTitle(db, workspaceId, project.caseId);
      await tellMembers(db, workspaceId, await buyers(db, workspaceId, project.id), "procurement.gate_cleared",
        notice({ clientName: facts?.clientName ?? title.clientName, project: title.title }), `/workspace/purchasing?project=${project.id}`,
        `procurement:${project.id}:cleared:${new Date().toISOString().slice(0, 10)}`, true);
      cleared++;
    } else if (!gate.cleared && project.clearedAt) {
      await db.query(`UPDATE project_procurement_gates SET cleared_at = NULL, checked_at = now() WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, project.id]);
    }
  }
  return { cleared };
}

// ---------- who hears it ----------

/** Template variables: every one the finishes notices name, so none is ever left as a placeholder. */
function notice(values: Partial<Record<"clientName" | "project" | "actor" | "title" | "count" | "items" | "due" | "note", string>>) {
  return { clientName: "", project: "", actor: "", title: "", count: "", items: "", due: "", note: "", ...values };
}

async function userName(db: Db, userId: string) {
  return (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
}

/** Active members holding a permission through a role the firm made (owners and administrators hold every permission, so they are the fallback). */
async function membersWithPermission(db: Db, workspaceId: string, code: string) {
  const rows = (await db.query<{ id: string; system: boolean }>(
    `SELECT DISTINCT membership.id, role.is_system AS system FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN roles role ON role.id = assigned.role_id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, code])).rows;
  const made = [...new Set(rows.filter((row) => !row.system).map((row) => row.id))];
  return made.length ? made : [...new Set(rows.map((row) => row.id))];
}

/** Holders of a team role on the project. */
async function projectRole(db: Db, workspaceId: string, projectId: string | null, roleKey: string) {
  if (!projectId) return [];
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT assignment.membership_id AS id FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND $3::varchar = ANY(assignment.role_keys)`, [workspaceId, projectId, roleKey])).rows.map((row) => row.id);
}

/** The QS of the case: whoever the case's quotation was last sent to for pricing, else the case's QS on the team, else the people who price quotations. */
async function qsMembers(db: Db, workspaceId: string, caseId: string) {
  const assigned = (await db.query<{ id: string }>(
    `SELECT membership.id FROM quote_qs_reviews review JOIN workspace_memberships membership ON membership.workspace_id = review.workspace_id AND membership.user_id = review.assignee_user_id
      WHERE review.workspace_id = $1 AND review.case_id = $2 AND membership.status = 'active' ORDER BY review.requested_at DESC LIMIT 1`, [workspaceId, caseId])).rows.map((row) => row.id);
  if (assigned.length) return assigned;
  const team = await caseHolders(db, workspaceId, caseId, "quantity_surveyor");
  return team.length ? team : membersWithPermission(db, workspaceId, "commercial.estimate");
}

/** The factory lead: the project's factory lead on the team, else the people who approve factory work. */
async function factoryLeads(db: Db, workspaceId: string, projectId: string | null) {
  const team = await projectRole(db, workspaceId, projectId, "factory_lead");
  return team.length ? team : membersWithPermission(db, workspaceId, "factory.approve");
}

/** Procurement: the project's buyer on the team, else the people who raise purchase orders. */
async function buyers(db: Db, workspaceId: string, projectId: string) {
  const team = await projectRole(db, workspaceId, projectId, "procurement");
  return team.length ? team : membersWithPermission(db, workspaceId, "purchasing.manage");
}
