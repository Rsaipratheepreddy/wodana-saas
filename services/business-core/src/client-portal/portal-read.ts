import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { commercialRepository } from "../commercial/commercial-repository";
import type { ChangeRequest, CommercialData } from "../commercial/commercial.types";
import { readInvoices, readMilestonePaid, withBalances } from "../receivables/receivables";
import type { Grant, PortalContact } from "./portal-auth";
import { portalQuote } from "./portal-quote";
import { effectiveSections, readProjectAccess, type PortalSettings, type Section, type Sections } from "./portal-settings";

type Db = Pick<PoolClient, "query">;

/**
 * The client's view of their projects, built field by field from the records staff published. Nothing is
 * spread from an internal object: every value below is named. A hidden section is never sent (null), and a
 * paused project shows only that it's paused.
 */

type CaseRow = {
  caseId: string; caseStatus: string; title: string; projectId: string | null; projectName: string | null; reference: string | null; projectStatus: string | null;
  startedAt: string | null; startDate: string | null; promiseDate: string | null; currency: string | null;
};

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

export async function workspaceToday(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
}

export async function readCase(db: Db, workspaceId: string, caseId: string): Promise<CaseRow | undefined> {
  return (await db.query<CaseRow>(
    `SELECT pre_case.id AS "caseId", pre_case.status AS "caseStatus", opportunity.title, project.id AS "projectId", project.name AS "projectName",
            project.reference, project.status AS "projectStatus", project.started_at AS "startedAt", project.start_date::text AS "startDate",
            project.promise_date::text AS "promiseDate", trim(project.currency) AS currency
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
                                           AND project.status <> 'archived'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
}

export async function readView(db: Db, workspaceId: string, contact: PortalContact, settings: PortalSettings, definitions: DefinitionSource) {
  const today = await workspaceToday(db, workspaceId);
  const projects = [];
  for (const grant of contact.grants) {
    const row = await readCase(db, workspaceId, grant.caseId);
    if (!row) continue;
    projects.push(await readProject(db, workspaceId, grant, row, settings, today, definitions));
  }
  return { contact: { name: contact.name, nameConfirmed: contact.nameConfirmed, phone: contact.phone }, today, projects };
}

async function readProject(db: Db, workspaceId: string, grant: Grant, row: CaseRow, settings: PortalSettings, today: string, definitions: DefinitionSource) {
  const access = row.projectId ? await readProjectAccess(db, workspaceId, row.projectId) : null;
  const sections = effectiveSections(settings, access);
  const started = Boolean(row.projectId);
  const base = {
    id: row.caseId, title: row.projectName ?? row.title, reference: row.reference, role: grant.role,
    status: (row.projectStatus ?? "planning") as "planning" | "active" | "on_hold" | "completed" | "cancelled",
    paused: Boolean(access?.paused),
  };
  if (access?.paused) return { ...base, sections, manager: null, stage: null, handoverDate: null, next: [], latestUpdate: null, progress: null, decisions: null,
    payments: null, documents: null, warranty: null, messages: null };
  const commercial = await loadCommercial(db, workspaceId, row.caseId);
  const on = (section: Section) => sections[section];
  const progress = started && on("progress") ? await readProgress(db, workspaceId, row.projectId!, settings) : null;
  const decisions = on("decisions") ? await readDecisions(db, workspaceId, grant, row, commercial, today, definitions) : null;
  const payments = on("payments") ? await readPayments(db, workspaceId, row, commercial, settings, today) : null;
  const documents = on("documents") ? await readDocuments(db, workspaceId, row, commercial) : null;
  const warranty = started && on("warranty") ? await readWarranty(db, workspaceId, row, today) : null;
  const messages = on("messages") ? { requests: commercial.requests.filter((request) => !request.decisionRequest).map((request) => portalRequest(request, grant)) } : null;
  const stage = started ? await readStage(db, workspaceId, row.projectId!, row.projectStatus!, settings) : null;
  const latestUpdate = progress?.updates[0] ?? null;
  return {
    ...base, sections: sections as Sections,
    manager: started ? await readManager(db, workspaceId, row.projectId!) : null,
    stage, handoverDate: started && settings.progress.dates ? row.promiseDate : null,
    next: nextSteps(decisions, payments),
    latestUpdate, progress, decisions, payments, documents, warranty, messages,
  };
}

export type PortalProject = Awaited<ReturnType<typeof readProject>>;

async function loadCommercial(db: Db, workspaceId: string, caseId: string): Promise<CommercialData> {
  const stored = (await commercialRepository.load(db as PoolClient, workspaceId, caseId))?.content as CommercialData | undefined;
  return { quotes: [], requests: [], payments: [], ...stored } as CommercialData;
}

/** "Your project manager": the one staff name a client sees. */
async function readManager(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ name: string }>(
    `SELECT person.display_name AS name FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
       JOIN users person ON person.id = membership.user_id
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager LIMIT 1`, [workspaceId, projectId])).rows[0]?.name ?? null;
}

async function readStages(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ name: string; status: string; startedOn: string | null; finishedOn: string | null }>(
    `SELECT stage.name, stage.status, (stage.started_at AT TIME ZONE workspace.default_timezone)::date::text AS "startedOn",
            (stage.completed_at AT TIME ZONE workspace.default_timezone)::date::text AS "finishedOn"
       FROM project_stages stage JOIN workspaces workspace ON workspace.id = stage.workspace_id
      WHERE stage.workspace_id = $1 AND stage.project_id = $2 AND stage.status <> 'skipped' ORDER BY stage.position`, [workspaceId, projectId])).rows;
}

async function readStage(db: Db, workspaceId: string, projectId: string, status: string, settings: PortalSettings) {
  const stages = await readStages(db, workspaceId, projectId);
  if (!stages.length) return null;
  const current = stages.findIndex((stage) => stage.status === "current");
  const index = status === "completed" ? stages.length - 1 : current >= 0 ? current : stages.filter((stage) => stage.status === "done").length;
  return { number: Math.min(index + 1, stages.length), total: stages.length, name: settings.progress.stageNames ? stages[Math.min(index, stages.length - 1)].name : null };
}

async function readProgress(db: Db, workspaceId: string, projectId: string, settings: PortalSettings) {
  const stages = (await readStages(db, workspaceId, projectId)).map((stage) => ({
    name: settings.progress.stageNames ? stage.name : null,
    state: (stage.status === "done" ? "done" : stage.status === "current" ? "current" : "upcoming") as "done" | "current" | "upcoming",
    startedOn: settings.progress.dates ? stage.startedOn : null, finishedOn: settings.progress.dates ? stage.finishedOn : null,
  }));
  const updates = settings.progress.updates ? (await db.query<{ id: string; at: string; text: string }>(
    `SELECT id, created_at AS at, note AS text FROM project_status_updates
      WHERE workspace_id = $1 AND project_id = $2 AND shared_at IS NOT NULL AND btrim(note) <> '' ORDER BY created_at DESC LIMIT 50`, [workspaceId, projectId])).rows
    .map((update) => ({ id: update.id, at: new Date(update.at).toISOString(), text: update.text })) : [];
  const photos = settings.progress.photos ? (await db.query<{ id: string; on: string }>(
    `SELECT photo.id, report.report_date::text AS on FROM site_report_photos photo
       JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
      WHERE photo.workspace_id = $1 AND report.project_id = $2 AND report.status = 'approved' AND photo.shared_at IS NOT NULL AND photo.mime_type LIKE 'image/%'
      ORDER BY report.report_date DESC, photo.created_at LIMIT 240`, [workspaceId, projectId])).rows : [];
  const days = new Map<string, Array<{ id: string }>>();
  for (const photo of photos) days.set(photo.on, [...(days.get(photo.on) ?? []), { id: photo.id }]);
  return { stages, updates, photoDays: [...days].map(([on, list]) => ({ on, photos: list })) };
}

async function readDecisions(db: Db, workspaceId: string, grant: Grant, row: CaseRow, commercial: CommercialData, today: string, definitions: DefinitionSource) {
  const approver = grant.role === "approver";
  const quotes = commercial.quotes.filter((quote) => quote.issuedAt).map((quote) => portalQuote(quote, grant.id, grant.role));
  const designs = (await db.query<{ id: string; title: string; type: string; number: number; status: string; dueAt: string | null; room: string | null; item: string | null; mimeType: string }>(
    `SELECT version.id, design.title, design.document_type AS type, version.number,
            CASE WHEN version.status = 'client_review' AND version.client_review_expires_at <= now() THEN 'expired' ELSE version.status END AS status,
            version.client_review_expires_at AS "dueAt", room.name AS room, entry.title AS item, asset.mime_type AS "mimeType"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
       LEFT JOIN pre_project_brief_entries entry ON entry.workspace_id = design.workspace_id AND entry.case_id = design.case_id AND entry.id = design.scope_entry_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND design.archived_at IS NULL
        AND version.status IN ('client_review', 'approved', 'changes_requested', 'rejected')
        AND version.number = (SELECT max(number) FROM pre_project_design_versions latest WHERE latest.workspace_id = design.workspace_id AND latest.design_id = design.id)
      ORDER BY coalesce(room.name, ''), design.title`, [workspaceId, row.caseId])).rows
    .map((design) => ({ id: design.id, title: design.title, type: design.type, number: design.number, status: design.status, dueAt: design.dueAt ? new Date(design.dueAt).toISOString() : null,
      room: design.room, item: design.item, mimeType: design.mimeType, canDecide: approver && design.status === "client_review" && row.caseStatus === "active" }));
  const requests = commercial.requests.filter((request) => request.decisionRequest).map((request) => {
    const asked = request.decisionRequest!;
    return {
      id: request.id, number: request.number, title: request.title, detail: request.detail, dueDate: request.dueDate || null, target: asked.target.label,
      choices: asked.allowedChoices.map((choice) => ({ id: choice.id, label: choice.label })),
      decision: asked.decision ? { choiceLabel: asked.decision.choiceLabel, note: asked.decision.note, decidedAt: asked.decision.decidedAt, decidedBy: asked.decision.decidedBy } : null,
      canDecide: approver && asked.clientApproverGrantId === grant.id && !asked.decision && request.status === "awaiting_decision" && !(request.dueDate && request.dueDate < today),
    };
  });
  return {
    quotes, designs, requests,
    definition: await readDefinition(db, workspaceId, grant, row, definitions),
    materials: row.projectId ? await readMaterials(db, workspaceId, row.projectId, approver, row.projectStatus!) : null,
    handovers: row.projectId ? await readHandovers(db, workspaceId, row.projectId, approver, row.projectStatus!) : [],
  };
}

/** The pre-project definition as the definition module presents it to the portal (status, current, decision). */
export type DefinitionSource = {
  portalData(client: PoolClient, workspaceId: string, caseId: string, grant: { id: string; role: string }): Promise<null | {
    id: string; number: number; snapshot: Record<string, unknown>; message: string; publishedAt: string | null; status: string;
    decision: { decision: string | null; note: string | null; decidedAt: string | null } | null; canDecide: boolean;
  }>;
};

/** The requirements the client confirms before quoting: what they asked for, never the firm's working notes. */
async function readDefinition(db: Db, workspaceId: string, grant: Grant, row: CaseRow, definitions: DefinitionSource) {
  const latest = await definitions.portalData(db as PoolClient, workspaceId, row.caseId, grant);
  if (!latest) return null;
  const definition = (latest.snapshot?.definition ?? {}) as { brief?: Record<string, unknown>; rooms?: Array<{ name?: unknown }>; items?: Array<Record<string, unknown>> };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const brief = definition.brief ?? {};
  return {
    id: latest.id, number: latest.number, message: latest.message ?? "", publishedAt: latest.publishedAt, status: latest.status,
    brief: { goals: text(brief.goals), propertyType: text(brief.propertyType), location: text(brief.location), area: text(brief.area), timeline: text(brief.timeline),
      preferences: text(brief.preferences), retainedItems: text(brief.retainedItems), exclusions: text(brief.exclusions), constraints: text(brief.constraints) },
    rooms: (definition.rooms ?? []).map((room) => text(room.name)).filter(Boolean),
    items: (definition.items ?? []).map((item) => ({ title: text(item.title), room: text(item.roomName) || null, quantity: typeof item.quantity === "number" ? item.quantity : null,
      unit: text(item.unit), requirement: text(item.requirement), avoid: text(item.avoid) })),
    decision: latest.decision ? { decision: latest.decision.decision, decidedAt: latest.decision.decidedAt, note: latest.decision.note ?? "" } : null,
    canDecide: latest.canDecide,
  };
}

/** The material list revision the client signs: names, finishes and quantities, never suppliers, codes or notes. */
async function readMaterials(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const revision = (await db.query<{ id: string; number: number; status: string; sentAt: string; decidedAt: string | null; decidedBy: string | null; note: string;
    snapshot: Array<{ id: string; name: string; specification: string; quantity: string | null; unit: string; boqLineIds: string[] }> }>(
    `SELECT id, number, status, sent_at AS "sentAt", decided_at AS "decidedAt", decided_by_name AS "decidedBy", decision_note AS note, snapshot
       FROM project_material_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, projectId])).rows[0];
  if (!revision) return null;
  const areas = new Map((await db.query<{ id: string; area: string | null }>(
    `SELECT line.id, room.name AS area FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
      WHERE line.workspace_id = $1 AND line.project_id = $2`, [workspaceId, projectId])).rows.map((line) => [line.id, line.area]));
  const decisions = (await db.query<{ itemId: string; decision: "approved" | "rejected"; note: string }>(
    `SELECT item_id AS "itemId", decision, note FROM project_material_decisions WHERE workspace_id = $1 AND revision_id = $2`, [workspaceId, revision.id])).rows;
  return {
    id: revision.id, number: revision.number, status: revision.status as "sent" | "signed_off" | "changes_requested",
    sentAt: new Date(revision.sentAt).toISOString(), decidedAt: revision.decidedAt ? new Date(revision.decidedAt).toISOString() : null, decidedBy: revision.decidedBy,
    items: revision.snapshot.map((item) => ({
      id: item.id, name: item.name, specification: item.specification, quantity: item.quantity, unit: item.unit,
      areas: [...new Set(item.boqLineIds.map((id) => areas.get(id)).filter((area): area is string => Boolean(area)))],
      decision: decisions.find((entry) => entry.itemId === item.id)?.decision ?? null,
      note: decisions.find((entry) => entry.itemId === item.id)?.note ?? "",
    })),
    canDecide: approver && revision.status === "sent" && ["active", "on_hold"].includes(projectStatus),
  };
}

async function readHandovers(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const packs = (await db.query<{ id: string; revision: number; title: string; status: string; areas: string[] | null; issuedAt: string; decidedOn: string | null; decidedBy: string | null;
    note: string }>(
    `SELECT id, revision, title, status, ARRAY(SELECT jsonb_array_elements_text(snapshot->'areas')) AS areas, issued_at AS "issuedAt", decided_on::text AS "decidedOn",
            decided_by_name AS "decidedBy", decision_note AS note
       FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND status <> 'draft' ORDER BY revision DESC`, [workspaceId, projectId])).rows;
  const documents = (await db.query<{ packId: string; id: string; kind: string; title: string; mimeType: string }>(
    `SELECT pack_id AS "packId", id, kind, title, mime_type AS "mimeType" FROM handover_documents WHERE workspace_id = $1 AND pack_id = ANY($2::uuid[]) ORDER BY created_at`,
    [workspaceId, packs.map((pack) => pack.id)])).rows;
  return packs.map((pack) => ({
    id: pack.id, revision: pack.revision, title: pack.title, status: pack.status as "issued" | "accepted" | "refused", areas: pack.areas ?? [],
    issuedAt: new Date(pack.issuedAt).toISOString(), decidedOn: pack.decidedOn, decidedBy: pack.decidedBy,
    // What the client refused it for, or what they accepted with still outstanding.
    note: pack.status === "draft" ? "" : pack.note,
    documents: documents.filter((document) => document.packId === pack.id).map((document) => ({ id: document.id, kind: document.kind, title: document.title, mimeType: document.mimeType })),
    canDecide: approver && pack.status === "issued" && ["active", "on_hold"].includes(projectStatus),
  }));
}

async function readPayments(db: Db, workspaceId: string, row: CaseRow, commercial: CommercialData, settings: PortalSettings, today: string) {
  const amounts = settings.invoiceAmounts;
  const show = (value: string | number | null) => (amounts && value !== null ? Dec.of(value).toFixed(4) : null);
  const milestones = (await db.query<{ id: string; title: string; amount: string; currency: string | null; dueDate: string | null; payUrl: string | null }>(
    `SELECT id, title, amount::text AS amount, nullif(currency, '') AS currency, due_date::text AS "dueDate", detail->'invoice'->>'paymentUrl' AS "payUrl"
       FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2 AND amount > 0 ORDER BY sort_order`, [workspaceId, row.caseId])).rows;
  const paid = await readMilestonePaid(db, workspaceId, milestones.map((milestone) => ({ caseId: row.caseId, paymentId: milestone.id })));
  const receipts = (await db.query<{ paymentId: string; amount: string; receivedOn: string | null }>(
    `SELECT allocation.payment_id AS "paymentId", allocation.amount::text AS amount,
            left(coalesce(receipt.detail->>'verifiedAt', receipt.detail->>'reportedAt', ''), 10) AS "receivedOn"
       FROM commercial_allocations allocation
       JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id
      WHERE allocation.workspace_id = $1 AND allocation.case_id = $2 AND receipt.status = 'finance_verified' AND allocation.detail->>'reversedAt' IS NULL
      ORDER BY 3`, [workspaceId, row.caseId])).rows;
  const invoices = row.projectId ? await withBalances(db, workspaceId, await readInvoices(db, workspaceId, { projectId: row.projectId }), today) : [];
  const live = new Map(invoices.filter((invoice) => invoice.status === "issued").map((invoice) => [invoice.paymentId, invoice]));
  const currency = row.currency ?? milestones.find((milestone) => milestone.currency)?.currency ?? invoices[0]?.currency ?? null;
  return {
    currency, showAmounts: amounts,
    invoices: invoices.map((invoice) => ({
      id: invoice.id, number: invoice.number, milestone: invoice.milestoneTitle, issueDate: invoice.issueDate, dueDate: invoice.dueDate, currency: invoice.currency,
      total: show(invoice.total), paid: show(invoice.paid), balance: show(invoice.balance),
      status: (invoice.status === "credited" ? "credited" : Dec.of(invoice.balance).cmp(0) <= 0 ? "paid" : invoice.overdue ? "overdue" : "due") as "credited" | "paid" | "overdue" | "due",
      receipts: invoice.status === "issued" ? receipts.filter((receipt) => receipt.paymentId === invoice.paymentId).map((receipt) => ({ amount: show(receipt.amount), receivedOn: receipt.receivedOn || null })) : [],
    })),
    schedule: milestones.map((milestone) => {
      const received = paid.get(`${row.caseId}|${milestone.id}`) ?? Dec.ZERO;
      const invoice = live.get(milestone.id);
      const settled = received.cmp(milestone.amount) >= 0;
      const status = settled ? "paid" : received.cmp(0) > 0 ? "part_paid" : invoice ? (invoice.overdue ? "overdue" : "due") : "upcoming";
      return {
        id: milestone.id, title: milestone.title, amount: show(milestone.amount), paid: show(received.toFixed(4)), dueDate: invoice?.dueDate ?? milestone.dueDate,
        status: status as "paid" | "part_paid" | "overdue" | "due" | "upcoming", invoiceNumber: invoice?.number ?? null,
        // A pay link only when one exists and something is still owed.
        payUrl: !settled && milestone.payUrl && /^https:\/\//.test(milestone.payUrl) ? milestone.payUrl : null,
      };
    }),
  };
}

/** Files published to the client: the signed agreement, approved designs and issued handover packs. */
async function readDocuments(db: Db, workspaceId: string, row: CaseRow, commercial: CommercialData) {
  const documents: Array<{ id: string; kind: "agreement" | "design" | "handover"; title: string; group: string; date: string | null; mimeType: string }> = [];
  if (commercial.agreement?.status === "executed")
    for (const file of commercial.agreement.files ?? [])
      documents.push({ id: file.id, kind: "agreement", title: file.name, group: commercial.agreement.reference, date: file.addedAt?.slice(0, 10) ?? null, mimeType: file.mimeType });
  const designs = (await db.query<{ id: string; title: string; number: number; room: string | null; mimeType: string; date: string }>(
    `SELECT version.id, design.title, version.number, room.name AS room, asset.mime_type AS "mimeType", version.created_at::date::text AS date
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND design.archived_at IS NULL AND version.status = 'approved'
        AND version.number = (SELECT max(number) FROM pre_project_design_versions approved WHERE approved.workspace_id = design.workspace_id AND approved.design_id = design.id
                               AND approved.status = 'approved')
      ORDER BY coalesce(room.name, ''), design.title`, [workspaceId, row.caseId])).rows;
  for (const design of designs)
    documents.push({ id: design.id, kind: "design", title: `${design.title} · V${design.number}`, group: design.room ?? "", date: design.date, mimeType: design.mimeType });
  if (row.projectId) {
    const handover = (await db.query<{ id: string; title: string; pack: string; revision: number; mimeType: string; date: string }>(
      `SELECT document.id, document.title, pack.title AS pack, pack.revision, document.mime_type AS "mimeType", pack.issued_at::date::text AS date
         FROM handover_documents document JOIN handover_packs pack ON pack.workspace_id = document.workspace_id AND pack.id = document.pack_id
        WHERE document.workspace_id = $1 AND pack.project_id = $2 AND pack.status <> 'draft' ORDER BY pack.revision DESC, document.created_at`,
      [workspaceId, row.projectId])).rows;
    for (const document of handover)
      documents.push({ id: document.id, kind: "handover", title: document.title, group: `${document.pack} · R${document.revision}`, date: document.date, mimeType: document.mimeType });
  }
  return documents;
}

async function readWarranty(db: Db, workspaceId: string, row: CaseRow, today: string) {
  const items = (await db.query<{ lineId: string; title: string; area: string | null; areaId: string | null; startsOn: string; endsOn: string; months: number }>(
    `SELECT item.boq_line_id AS "lineId", line.title, room.name AS area, room.id AS "areaId", item.starts_on::text AS "startsOn", item.ends_on::text AS "endsOn", item.months
       FROM warranty_items item
       JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = item.boq_line_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
      WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.months > 0 ORDER BY coalesce(room.name, ''), line.position`,
    [workspaceId, row.projectId, row.caseId])).rows;
  const claims = (await db.query<{ id: string; number: number; raisedOn: string; description: string; status: string; note: string }>(
    `SELECT id, number, raised_on::text AS "raisedOn", description, status, decision_note AS note FROM warranty_claims
      WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC`, [workspaceId, row.projectId])).rows;
  const active = items.filter((item) => item.startsOn <= today && today <= item.endsOn);
  const areas = new Map(active.filter((item) => item.areaId).map((item) => [item.areaId!, item.area!]));
  return {
    items: items.map((item) => ({ id: item.lineId, title: item.title, area: item.area, startsOn: item.startsOn, endsOn: item.endsOn,
      active: item.startsOn <= today && today <= item.endsOn })),
    claims: claims.map((claim) => ({ id: claim.id, number: claim.number, raisedOn: claim.raisedOn, description: claim.description,
      status: claim.status as "open" | "covered" | "not_covered" | "chargeable",
      // Why it isn't covered (or what's charged) is written for the client; a covered claim just gets fixed.
      reason: ["not_covered", "chargeable"].includes(claim.status) ? claim.note : "" })),
    areas: [...areas].map(([id, name]) => ({ id, name })),
    lines: active.map((item) => ({ id: item.lineId, title: item.title, areaId: item.areaId })),
    canClaim: active.length > 0 && ["active", "on_hold", "completed"].includes(row.projectStatus ?? ""),
  };
}

/** A request thread: the team's replies are "your project team", never a person's name. */
export function portalRequest(request: ChangeRequest, grant: Grant) {
  return {
    id: request.id, number: request.number, title: request.title, detail: request.detail, status: request.status, createdAt: request.createdAt,
    resolution: request.resolution,
    comments: request.comments.filter((comment) => comment.visibility === "client").map((comment) => ({
      id: comment.id, at: comment.at, text: comment.text,
      fromClient: (comment as { fromClient?: boolean }).fromClient ?? comment.author === grant.name,
    })),
  };
}

type Decisions = Awaited<ReturnType<typeof readDecisions>>;
type Payments = Awaited<ReturnType<typeof readPayments>>;

/** What's needed from the client now: decisions that wait for them, then what's due to pay. */
function nextSteps(decisions: Decisions | null, payments: Payments | null) {
  const steps: Array<{ kind: "quote" | "design" | "definition" | "materials" | "handover" | "request" | "invoice"; id: string; title: string; due: string | null }> = [];
  if (decisions) {
    for (const quote of decisions.quotes.filter((item) => item.canDecide))
      steps.push({ kind: "quote", id: quote.id, title: `${quote.title} · V${quote.number}`, due: quote.validUntil });
    if (decisions.definition?.canDecide) steps.push({ kind: "definition", id: decisions.definition.id, title: `R${decisions.definition.number}`, due: null });
    for (const design of decisions.designs.filter((item) => item.canDecide)) steps.push({ kind: "design", id: design.id, title: `${design.title} · V${design.number}`, due: design.dueAt });
    if (decisions.materials?.canDecide) steps.push({ kind: "materials", id: decisions.materials.id, title: `R${decisions.materials.number}`, due: null });
    for (const pack of decisions.handovers.filter((item) => item.canDecide)) steps.push({ kind: "handover", id: pack.id, title: `${pack.title} · R${pack.revision}`, due: null });
    for (const request of decisions.requests.filter((item) => item.canDecide)) steps.push({ kind: "request", id: request.id, title: request.title, due: request.dueDate });
  }
  if (payments)
    for (const invoice of payments.invoices.filter((item) => item.status === "due" || item.status === "overdue"))
      steps.push({ kind: "invoice", id: invoice.id, title: invoice.number, due: invoice.dueDate });
  return steps;
}

export function isImage(mimeType: string) {
  return IMAGE.test(mimeType);
}
