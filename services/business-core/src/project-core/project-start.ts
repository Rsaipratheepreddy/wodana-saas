import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { acceptedQuoteValue } from "../commercial/commercial.domain";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData, Quote } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";
import { canonicalHash } from "../crm/shared/crm-types";
import { caseDesigner } from "../crm/opportunities/dedicated-designer";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { acceptedScope } from "../quotation/quotation-builder.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { LEAD_ROLE } from "./project-checks";
import { activeMembers, ensureSettings, ensureTemplates, setRole } from "./project-core.store";
import { noticeProject } from "./project-notices";
import { carryTeamToProject } from "./project-team";
import { proposePackages, seedBoq } from "./project-scope";

type Db = PoolClient;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Starting a project (plan §6.10): only from an accepted quotation once the firm's start rules pass. Its scope
 * is sealed there and never changes (a change is a variation); the team and the route's stages are set up.
 */
/** What starting a project from this case needs, and whether it can start now. */
export async function readStartState(client: Db, access: WorkspaceAccessService, workspaceId: string, caseId: string, user: ActorUser) {
  if (!(await any(access, client, workspaceId, user.userId, ["pre_projects.view", "projects.manage"]))) throw new ForbiddenException("You can't see this planning record.");
  const existing = (await client.query<{ id: string; reference: string }>(
    `SELECT id, reference FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND started_at IS NOT NULL`, [workspaceId, caseId])).rows[0] ?? null;
  const settings = await ensureSettings(client, workspaceId);
  const data = await commercial(client, workspaceId, caseId);
  const quote = data ? startQuote(data) : undefined;
  const checks = data && quote ? startChecks(data, quote, settings) : [];
  const facts = (await client.query<{ name: string; ownerMembershipId: string | null; status: string }>(
    `SELECT opportunity.title AS name, opportunity.owner_membership_id AS "ownerMembershipId", pre_case.status
       FROM pre_project_cases pre_case JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
  if (!facts) throw new NotFoundException("Planning record not found.");
  const canStart = !existing && Boolean(quote) && facts.status === "active" && checks.every((check) => check.ok)
    && await any(access, client, workspaceId, user.userId, ["projects.manage"]);
  return {
    project: existing,
    quote: quote ? { id: quote.id, number: quote.number, title: quote.title, currency: quote.currency, total: String(acceptedQuoteValue(quote)),
      acceptedAt: quote.clientDecision?.decidedAt ?? null, acceptedBy: quote.clientDecision?.decidedBy ?? null } : null,
    checks,
    caseStatus: facts.status,
    templates: existing ? [] : (await ensureTemplates(client, workspaceId, user.userId)).map(({ id, name, isDefault }) => ({ id, name, isDefault })),
    members: existing ? [] : await activeMembers(client, workspaceId),
    suggested: { name: facts.name, lead: null as string | null },
    canStart,
    canManage: await any(access, client, workspaceId, user.userId, ["projects.manage"]),
  };
}

/** Accepted quotations whose project hasn't started yet, for the Projects page's "Start project". */
export async function readReadyCases(client: Db, access: WorkspaceAccessService, workspaceId: string, user: ActorUser) {
  if (!(await any(access, client, workspaceId, user.userId, ["projects.manage"]))) return { cases: [] };
  return { cases: (await client.query<{ caseId: string; name: string; clientName: string; quoteNumber: number; total: string; currency: string }>(
    `SELECT pre_case.id AS "caseId", opportunity.title AS name, coalesce(party.display_name, opportunity.title) AS "clientName",
            quote.number AS "quoteNumber", quote.total::text AS total, quote.currency
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       JOIN commercial_quotes quote ON quote.workspace_id = pre_case.workspace_id AND quote.case_id = pre_case.id
        AND quote.kind = 'quotation' AND quote.status = 'accepted' AND quote.round IS DISTINCT FROM 'design'
      WHERE pre_case.workspace_id = $1 AND pre_case.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL)
      ORDER BY lower(opportunity.title)`, [workspaceId])).rows };
}

/** Starts the project from the accepted quotation: seals the scope, names the team, copies the stages. Starting twice returns the same project. */
export async function startProject(client: Db, access: WorkspaceAccessService, workspaceId: string, caseId: string, body: Record<string, unknown>, user: ActorUser) {
  const facts = (await client.query<{ status: string; name: string; ownerMembershipId: string | null; opportunityId: string }>(
    `SELECT pre_case.status, opportunity.title AS name, opportunity.owner_membership_id AS "ownerMembershipId", opportunity.id AS "opportunityId"
       FROM pre_project_cases pre_case JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 FOR UPDATE OF pre_case`, [workspaceId, caseId])).rows[0];
  if (!facts) throw new NotFoundException("Planning record not found.");
  const existing = (await client.query<{ id: string; startedAt: string | null }>(`SELECT id, started_at AS "startedAt" FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  if (existing?.startedAt) return { projectId: existing.id, existing: true };
  if (facts.status !== "active") throw new ConflictException("This planning record is on hold or closed. Reopen it before starting the project.");
  const settings = await ensureSettings(client, workspaceId);
  const loaded = await commercialRepository.load(client, workspaceId, caseId, { forUpdate: true });
  const data = loaded ? ({ ...(loaded.content as CommercialData), revision: loaded.revision }) : null;
  const quote = data ? startQuote(data) : undefined;
  if (!data || !quote || quote.id !== body.quoteId) throw new ConflictException("Start the project from the accepted quotation.");
  const missing = startChecks(data, quote, settings).filter((check) => !check.ok);
  if (missing.length) throw new ConflictException(`Before the project can start: ${missing.map((check) => START_LABELS[check.key]).join(", ")}.`);
  const templates = await ensureTemplates(client, workspaceId, user.userId);
  const template = templates.find((item) => item.id === body.templateId) ?? (body.templateId ? undefined : templates.find((item) => item.isDefault));
  if (!template) throw new BadRequestException("Choose the project's route.");
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 240) : facts.name;
  const lead = typeof body.leadMembershipId === "string" ? body.leadMembershipId : "";
  if (!(await activeMembers(client, workspaceId)).some((member) => member.membershipId === lead)) throw new BadRequestException("Choose the project manager.");
  const startDate = optionalDate(body.startDate, "Start date");
  const promiseDate = optionalDate(body.promiseDate, "Handover date");
  if (startDate && promiseDate && promiseDate < startDate) throw new BadRequestException("The handover date can't be before the start date.");

  // The sealed scope: priced by the same engine as the quote, and it must match what the client accepted.
  const scope = await acceptedScope(client, workspaceId, caseId, quote.id);
  const accepted = Dec.of(String(acceptedQuoteValue(quote)));
  // The legacy acceptance total is kept to two decimals: allow that rounding, nothing more.
  const tolerance = Dec.of(Math.min(2, scope.quote.decimals) === 0 ? "1" : Math.min(2, scope.quote.decimals) === 1 ? "0.1" : "0.01");
  if (Dec.of(scope.pricing.total).sub(accepted).abs().cmp(tolerance) > 0)
    throw new ConflictException("The quotation's lines no longer add up to the total the client accepted. Issue a new revision and record the client's decision again.");
  const revision = (await client.query<{ position: number }>(
    `SELECT count(*)::int AS position FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND kind = 'quotation'
        AND coalesce(family_id, id) = coalesce($3, $4) AND number <= $5`, [workspaceId, caseId, quote.familyId ?? null, quote.id, quote.number])).rows[0].position;
  const decision = quote.clientDecision!;
  const snapshot = {
    ...scope,
    revisionLabel: `R${revision}`,
    acceptance: { decidedBy: decision.decidedBy, decidedAt: decision.decidedAt, method: decision.method ?? "portal", recordedBy: decision.recordedBy ?? null,
      note: decision.note ?? "", quoteHash: decision.quoteHash, acceptedTotal: String(decision.acceptedTotal ?? quote.total) },
    agreement: data.agreement?.quoteId === quote.id ? { reference: data.agreement.reference, status: data.agreement.status, executedAt: data.agreement.executedAt ?? null } : null,
  };
  const contentHash = canonicalHash(snapshot);

  const counter = (await client.query<{ value: string }>(
    `INSERT INTO project_reference_counters (workspace_id, last_value) VALUES ($1, 1)
     ON CONFLICT (workspace_id) DO UPDATE SET last_value = project_reference_counters.last_value + 1 RETURNING last_value::text AS value`, [workspaceId])).rows[0].value;
  const reference = `${settings.referencePrefix}-${counter.padStart(4, "0")}`;
  const projectId = (await client.query<{ id: string }>(
    `INSERT INTO delivery_projects (workspace_id, case_id, name, created_by, reference, quote_id, template_id, template_name, start_date, promise_date, currency, started_at, started_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $4)
     ON CONFLICT (workspace_id, case_id) DO UPDATE SET name = EXCLUDED.name, reference = EXCLUDED.reference, quote_id = EXCLUDED.quote_id, template_id = EXCLUDED.template_id,
       template_name = EXCLUDED.template_name, start_date = EXCLUDED.start_date, promise_date = EXCLUDED.promise_date, currency = EXCLUDED.currency,
       status = 'active', started_at = now(), started_by = EXCLUDED.started_by, version = delivery_projects.version + 1, updated_at = now()
     RETURNING id`,
    [workspaceId, caseId, name, user.userId, reference, quote.id, template.id, template.name, startDate, promiseDate, scope.quote.currency])).rows[0].id;
  const sealId = randomUUID();
  await client.query(
    `INSERT INTO project_scope_seals (id, workspace_id, project_id, kind, quote_id, quote_number, revision_label, quote_hash, snapshot, content_hash, currency, total,
       accepted_at, accepted_by_name, acceptance_method, recorded_by_name, agreement_reference, sealed_by)
     VALUES ($1, $2, $3, 'baseline', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [sealId, workspaceId, projectId, quote.id, quote.number, snapshot.revisionLabel, decision.quoteHash, JSON.stringify(snapshot), contentHash,
      scope.quote.currency, scope.pricing.total, decision.decidedAt, decision.decidedBy, decision.method ?? "portal", decision.recordedBy ?? null,
      snapshot.agreement?.reference ?? null, user.userId]);
  // The live BOQ starts as the sealed scope, grouped into suggested packages.
  await seedBoq(client, workspaceId, projectId, { id: sealId, revisionLabel: snapshot.revisionLabel }, scope.lines, user.userId);
  await proposePackages(client, workspaceId, projectId, user.userId);
  for (const [position, stage] of template.stages.entries())
    await client.query(
      `INSERT INTO project_stages (id, workspace_id, project_id, position, key, name, owner_role, checks, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, CASE WHEN $4 = 0 THEN now() END)`,
      [randomUUID(), workspaceId, projectId, position, stage.key, stage.name, stage.ownerRole, JSON.stringify(stage.checks), position === 0 ? "current" : "upcoming"]);

  // Everyone working on the planning record keeps access, and its site locations become the project's.
  await client.query(
    `INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active)
     SELECT workspace_id, $3, membership_id, false, active FROM project_assignments WHERE workspace_id = $1 AND case_id = $2
     ON CONFLICT (workspace_id, project_id, membership_id) WHERE project_id IS NOT NULL DO NOTHING`, [workspaceId, caseId, projectId]);
  await client.query(`UPDATE work_locations SET project_id = $3, case_id = NULL, version = version + 1 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, projectId]);
  // The team: the lead chosen now, the account manager and designer carried over from Sales.
  const roleKeys = new Set(settings.roles.map((role) => role.key));
  const named: Array<{ membershipId: string; role: string }> = [{ membershipId: lead, role: LEAD_ROLE }];
  if (facts.ownerMembershipId && roleKeys.has("account_manager")) named.push({ membershipId: facts.ownerMembershipId, role: "account_manager" });
  const designer = await caseDesigner(client, workspaceId, caseId);
  if (designer && roleKeys.has("designer")) named.push({ membershipId: designer, role: "designer" });
  for (const member of named) await setRole(client, workspaceId, projectId, member.role, member.membershipId);
  // PLM-100 / PLM-089: every other role comes from the Planning case, else from what the opportunity tagged (a person or
  // "not applicable"); the roles just named stay as chosen.
  const carried = await carryTeamToProject(client, workspaceId, { projectId, caseId, opportunityId: facts.opportunityId, actorUserId: user.userId });
  for (const entry of carried) if (entry.membershipId) named.push({ membershipId: entry.membershipId, role: entry.role });

  await client.query(
    `UPDATE pre_project_cases SET status = 'released', phase = 'release', released_at = now(), released_by = $3, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId, user.userId]);
  await client.query(
    `INSERT INTO crm_project_links (workspace_id, opportunity_id, project_id, mode, promoted_at) VALUES ($1, $2, $3, 'delivery', now())
     ON CONFLICT (workspace_id, opportunity_id) DO UPDATE SET project_id = EXCLUDED.project_id, mode = 'delivery', promoted_at = coalesce(crm_project_links.promoted_at, now())`,
    [workspaceId, facts.opportunityId, projectId]);
  await ensureJobForSource(client, workspaceId, { type: "project", id: projectId }, user.userId);
  await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.started", entityType: "project", entityId: projectId,
    after: { reference, caseId, quoteId: quote.id, contentHash, template: template.name, team: carried } });
  const labels = new Map(settings.roles.map((role) => [role.key, role.label]));
  await noticeProject(client, { workspaceId, projectId, key: "start", actorUserId: user.userId,
    notice: { code: "project.started", memberships: named.map((member) => ({ membershipId: member.membershipId, role: labels.get(member.role) ?? member.role })) } });
  return { projectId, existing: false };
}

// ---------- helpers ----------
const START_LABELS: Record<string, string> = {
  accepted: "the client accepts the quotation",
  agreement: "the agreement is signed",
  payment: "the payment due before the start is verified",
  approval: "the deal is approved",
};

async function commercial(client: Db, workspaceId: string, caseId: string) {
  const row = await commercialRepository.load(client, workspaceId, caseId);
  return row ? ({ ...(row.content as CommercialData), revision: row.revision }) : null;
}

/** The accepted quotation that starts the project. A design-fee quotation never does. */
function startQuote(data: CommercialData): Quote | undefined {
  return data.quotes.find((quote) => quote.kind === "quotation" && quote.status === "accepted" && quote.round !== "design");
}

function startChecks(data: CommercialData, quote: Quote, settings: { requireAgreement: boolean; requirePayment: boolean; requireApproval: boolean }) {
  return [
    { key: "accepted", ok: quote.clientDecision?.decision === "accept", required: true },
    { key: "agreement", ok: data.agreement?.quoteId === quote.id && data.agreement.status === "executed", required: settings.requireAgreement },
    { key: "payment", ok: financeGatePaymentsReady(data, "release", quote.id), required: settings.requirePayment },
    { key: "approval", ok: data.dealFile?.quoteId === quote.id && data.ownerReview?.status === "approved", required: settings.requireApproval },
  ].filter((check) => check.required);
}

async function any(access: WorkspaceAccessService, client: Db, workspaceId: string, userId: string, codes: string[]) {
  for (const code of codes) if (await access.hasPermission(client, workspaceId, userId, code)) return true;
  return false;
}

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
