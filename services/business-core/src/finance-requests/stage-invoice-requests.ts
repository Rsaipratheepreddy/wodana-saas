import type { PoolClient } from "pg";
import { readMilestones } from "../project-core/project-milestones";
import { netOfTax } from "./finance-requests";
import { afterRaise, entityTax, insertRequest, parseFields } from "./finance-request-commands";
import { readSettings, today } from "./finance-requests.store";
import { randomUUID } from "node:crypto";

type Db = PoolClient;

/**
 * PLM-108: when a project's payment stage is reached (its due date has come and nobody has invoiced it), its
 * invoice request is raised for Finance, once, in the salesperson's name — only where the firm turned this on
 * (Finance › Requests › Settings). A stage missing the client's email or a company's tax number goes to the
 * salesperson first, as Needs info. Runs in the daily job inside each workspace's tenant transaction; one stage
 * that can't be raised (no company or tax rate) is skipped, never blocking the others.
 */
export async function raiseStageInvoiceRequests(db: Db, workspaceId: string) {
  const settings = await readSettings(db, workspaceId);
  if (!settings.stageInvoiceRequests) return { raised: 0 };
  const day = await today(db, workspaceId);
  const projects = (await db.query<{ id: string; caseId: string; currency: string; opportunityId: string; partyId: string; legalEntityId: string | null; ownerId: string | null }>(
    `SELECT project.id, project.case_id AS "caseId", coalesce(project.currency, workspace.default_currency) AS currency, opportunity.id AS "opportunityId",
            opportunity.party_id AS "partyId", opportunity.legal_entity_id AS "legalEntityId", owner.user_id AS "ownerId"
       FROM delivery_projects project
       JOIN workspaces workspace ON workspace.id = project.workspace_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.id = pre_case.opportunity_id
       LEFT JOIN workspace_memberships owner ON owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE project.workspace_id = $1 AND project.status = 'active'`, [workspaceId])).rows;
  const entities = (await db.query<{ id: string }>(`SELECT id FROM legal_entities WHERE workspace_id = $1 AND status = 'active' AND archived_at IS NULL`, [workspaceId])).rows;
  let raised = 0;
  for (const project of projects) {
    const { milestones } = await readMilestones(db, workspaceId, { id: project.id, caseId: project.caseId, currency: project.currency.trim() });
    const reached = milestones.filter((milestone) => milestone.state === "to_invoice" && milestone.dueDate && milestone.dueDate <= day);
    if (!reached.length) continue;
    const requester = project.ownerId ?? (await db.query<{ userId: string }>(
      `SELECT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active
        ORDER BY ('account_manager' = ANY(assignment.role_keys)) DESC, assignment.is_manager DESC LIMIT 1`, [workspaceId, project.id])).rows[0]?.userId;
    const legalEntityId = project.legalEntityId ?? (entities.length === 1 ? entities[0].id : null);
    if (!requester || !legalEntityId) continue;
    for (const milestone of reached) {
      const taken = (await db.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND case_id = $2 AND payment_stage_id = $3 AND status <> 'rejected'`,
        [workspaceId, project.caseId, milestone.id])).rowCount;
      if (taken) continue;
      await db.query("SAVEPOINT stage_invoice_request");
      try {
        const tax = await entityTax(db, workspaceId, legalEntityId);
        const rate = tax.rates.find((item) => item.isDefault) ?? tax.rates[0];
        if (!rate) { await db.query("ROLLBACK TO SAVEPOINT stage_invoice_request"); continue; }
        const client = (await db.query<{ type: string; email: string | null }>(
          `SELECT party.type::text AS type, (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id
             AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC, point.created_at LIMIT 1) AS email
             FROM crm_parties party WHERE party.workspace_id = $1 AND party.id = $2`, [workspaceId, project.partyId])).rows[0];
        const currency = milestone.currency.trim();
        const fields = await parseFields(db, { workspaceId, userId: requester }, "invoice", {
          opportunityId: project.opportunityId, projectId: project.id, currency, legalEntityId, taxCode: rate.code, invoiceKind: "standard", paymentStageId: milestone.id,
          clientEmail: client?.email ?? "", lines: [{ description: [milestone.title, milestone.trigger].filter(Boolean).join(" · ").slice(0, 500), quantity: "1",
            unitPrice: netOfTax(milestone.amount, rate.rate, currency) }],
        }, "stage");
        const missing = [!fields.clientEmail ? "the client's email" : "", client?.type === "organization" && !fields.clientTaxNumber ? "the client's tax registration number" : ""].filter(Boolean);
        await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('finance-request-number:' || $1::text, 0))`, [workspaceId]);
        const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM finance_requests WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
        const id = randomUUID();
        await insertRequest(db, workspaceId, id, number, "invoice", "stage", requester, missing.length ? "needs_info" : "new", fields);
        await afterRaise(db, workspaceId, id, null, "submitted", missing.length ? `Add ${missing.join(" and ")}, then send it to Finance.` : `${milestone.title} is due.`);
        await db.query("RELEASE SAVEPOINT stage_invoice_request");
        raised += 1;
      } catch {
        await db.query("ROLLBACK TO SAVEPOINT stage_invoice_request");
      }
    }
  }
  return { raised };
}
