import { leadDesigner } from "../../design/design-journey.store";
import { signatureGate } from "../../design/finishes.store";
import type { DueItem, ReminderSource } from "../engine/engine";
import { encode, idsOf, keysOf, managersByProject } from "./support";

/**
 * finishes.signature_due (PLM-148): a started project whose finishes, in the categories the client signs (e.g. sanitary
 * ware, whitegoods), still miss the signed sample or data sheet the designer records; procurement can't order its
 * materials until they are in. The case's lead designer hears after the firm's days (by default 1, 3 and 7 days after
 * the project started), then their team lead and the owner. Done once every one is signed, the project stops running,
 * or it ordered before the firm started asking.
 */
export const signatureDueSource: ReminderSource = {
  kind: "finishes.signature_due", module: "design", audience: "staff", critical: false, notify: "engine",
  viewPermission: "projects.view", template: { code: "reminders.finishes.signature_due" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; caseId: string; startedAt: Date; project: string; client: string }>(
      `SELECT project.id, project.case_id AS "caseId", project.started_at AS "startedAt", concat_ws(' · ', nullif(project.reference, ''), project.name) AS project,
              coalesce(party.display_name, opportunity.title, '') AS client
         FROM delivery_projects project
         JOIN workspace_finish_settings settings ON settings.workspace_id = project.workspace_id
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold') AND project.started_at IS NOT NULL
          AND project.started_at BETWEEN $2::timestamptz - interval '180 days' AND $2::timestamptz
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(settings.categories) category
                       JOIN design_ledger_entries entry ON entry.workspace_id = project.workspace_id AND entry.case_id = project.case_id
                        AND entry.kind = 'material' AND entry.archived_at IS NULL AND entry.category_key = category->>'key'
                      WHERE (category->>'clientSignature')::boolean)
        ORDER BY project.started_at DESC LIMIT $3`, [workspaceId, now, limit])).rows;
    const items: DueItem[] = [];
    const managers = await managersByProject(db, workspaceId, rows.map((row) => row.id));
    for (const row of rows) {
      const gate = await signatureGate(db, workspaceId, row.id);
      if (!gate.missing.length) continue;
      const owner = await leadDesigner(db, workspaceId, row.caseId) ?? managers.get(row.id)?.[0] ?? null;
      items.push({
        key: `signatures:${row.id}`, sourceType: "delivery_project", sourceId: row.id, jobSource: { type: "project", id: row.id }, projectId: row.id, caseId: row.caseId,
        partyId: null, ownerMembershipId: owner, ccMembershipIds: [], dueAt: new Date(row.startedAt),
        title: `Client signatures · ${row.project}`, context: `${row.client}: ${gate.missing.slice(0, 3).join(", ")}${gate.missing.length > 3 ? ` and ${gate.missing.length - 3} more` : ""}`,
        href: `/workspace/projects/${encode(row.id)}/scope?view=finishes`, variables: { client: row.client },
      });
    }
    return items;
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "signatures");
    const open: string[] = [];
    for (const id of ids) {
      const running = (await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND status IN ('active', 'on_hold') AND started_at IS NOT NULL`, [workspaceId, id])).rowCount;
      if (running && (await signatureGate(db, workspaceId, id)).missing.length) open.push(id);
    }
    return keysOf("signatures", open);
  },
};
