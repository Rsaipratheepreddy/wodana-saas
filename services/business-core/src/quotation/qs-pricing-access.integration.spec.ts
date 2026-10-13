import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QsReviewService } from "../proposals/qs-review.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { QuotationBuilderService } from "./quotation-builder.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

// The roles as firms set them up: Sales admin hands the quotation over; the QS (docs/fixtures/palm-teams-access.json
// team QS and the quantity_surveyor template) prices it without the planning edit permission.
const SALES = ["pre_projects.view", "pre_projects.edit", "crm.opportunities.view"];
const QS = ["pre_projects.view", "crm.opportunities.view", "commercial.costs.view", "commercial.estimate", "catalog.view"];
const VIEWER = ["pre_projects.view", "commercial.costs.view"];

type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; sales: string; qs: string; viewer: string;
  builder: (userId: string) => QuotationBuilderService; review: (userId: string) => QsReviewService };

/**
 * QA-001 (PLM-082/084): a quotation that needs the QS is with the QS; the QS prices its lines (rate, cost, markup)
 * without pre_projects.edit, and nothing else. Runs the real permission checks as the app role (forced RLS).
 */
integration("QA-001: the QS prices the quotation that is with them", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  });
  afterAll(() => pool.end());

  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), sales = randomUUID(), qs = randomUUID(), viewer = randomUUID();
    const party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales'),($3,$4,'Quinn QS'),($5,$6,'Vic Viewer')",
        [sales, `s-${sales.slice(0, 8)}@example.com`, qs, `q-${qs.slice(0, 8)}@example.com`, viewer, `v-${viewer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `qs-${workspaceId.slice(0, 8)}`, sales]);
      const members: Record<string, string> = {};
      for (const [userId, code, permissions] of [[sales, "sales_admin", SALES], [qs, "team_qs", QS], [viewer, "viewer", VIEWER]] as const) {
        const membership = randomUUID(), role = randomUUID();
        members[userId] = membership;
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, userId]);
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [role, workspaceId, code]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, permissions]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      }
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), members[sales]]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, sales]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("INSERT INTO workspace_quotation_settings (workspace_id, qs_review) VALUES ($1, true)", [workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      // Every command runs as the app role inside its own savepoint, like a tenant transaction.
      const database = {
        tenantTransaction: async (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => {
          await client.query("SAVEPOINT tenant");
          try {
            await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, actorUserId]);
            await client.query("SET LOCAL ROLE wodana_app");
            const result = await fn(client);
            await client.query("RESET ROLE");
            await client.query("RELEASE SAVEPOINT tenant");
            return result;
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT tenant");
            await client.query("RESET ROLE");
            throw error;
          }
        },
      };
      const access = (userId: string) => new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId, displayName: userId }) } as never);
      const builder = (userId: string) => new QuotationBuilderService(access(userId), {} as never);
      const review = (userId: string) => new QsReviewService(access(userId));
      // Sales adds the items without prices (the QS sets them on this quotation).
      await builder(sales).apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen base cabinets", unit: "m", quantity: "4.5", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Quartz worktop", unit: "m²", quantity: "2", areaId: kitchen } },
      ] });
      await work({ client, workspaceId, caseId, quoteId, sales, qs, viewer, builder, review });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("lets the QS price every line (rate, cost) and confirm, without the planning edit permission", async () => {
    await world(async (w) => {
      // Before the hand-off the QS has no way in; Sales can't price.
      await expect(w.builder(w.qs).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "1200" } }] }))
        .rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      await expect(w.builder(w.sales).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "1200" } }] }))
        .rejects.toThrow(/QS sets the prices/);
      expect(await w.builder(w.qs).builder(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ canEdit: false, canPrice: false });

      await w.review(w.sales).send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs, note: "From site measurements" });
      const opened = await w.builder(w.qs).builder(actor, w.workspaceId, w.caseId, w.quoteId);
      expect(opened).toMatchObject({ canEdit: false, canPrice: true, canEditCosts: true, canViewCosts: true });

      const priced = await w.builder(w.qs).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [
        { op: "upsert", line: { id: "a", version: 1, rate: "1200", unitCost: "900" } },
        { op: "upsert", line: { id: "b", version: 1, unitCost: "600", markupPercent: "25" } },
      ] });
      expect(priced.lines.map((line) => [line.id, line.rate, line.unitCost])).toEqual([["a", "1200", "900"], ["b", "750", "600"]]);
      const audit = (await w.client.query(`SELECT actor_user_id AS "by" FROM audit_events WHERE workspace_id = $1 AND action = 'quotation.lines_changed.v1' ORDER BY occurred_at DESC LIMIT 1`, [w.workspaceId])).rows[0];
      expect(audit).toEqual({ by: w.qs });

      const confirmed = await w.review(w.qs).decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "confirm", commandId: randomUUID() });
      expect(confirmed).toMatchObject({ stage: "confirmed", review: { status: "confirmed", decidedBy: w.qs } });
      // Confirmed: no longer with the QS, so the QS can't change it any more.
      await expect(w.builder(w.qs).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 2, rate: "1300" } }] }))
        .rejects.toThrow(/Permissions required/);
    });
  });

  it("keeps the QS to prices: no new, removed, reordered or redescribed lines; others without the QS permission stay out", async () => {
    await world(async (w) => {
      await w.review(w.sales).send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs });
      const qs = w.builder(w.qs);
      const refused = /You price this quotation|Sales adds the items/;
      await expect(qs.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, title: "Tall cabinets", rate: "1200" } }] })).rejects.toThrow(refused);
      await expect(qs.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, quantity: "9" } }] })).rejects.toThrow(refused);
      await expect(qs.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "c", version: 1, rate: "50" } }] })).rejects.toThrow(refused);
      await expect(qs.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "delete", id: "a", version: 1 }] })).rejects.toThrow(refused);
      await expect(qs.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "reorder", ids: ["b", "a"] }] })).rejects.toThrow(refused);
      // Nothing changed.
      const lines = (await w.client.query(`SELECT id, title, quantity::text AS quantity, rate::text AS rate FROM commercial_quote_lines WHERE workspace_id = $1 AND quote_id = $2 ORDER BY sort_order`, [w.workspaceId, w.quoteId])).rows;
      expect(lines).toEqual([{ id: "a", title: "Kitchen base cabinets", quantity: "4.5", rate: "0" }, { id: "b", title: "Quartz worktop", quantity: "2", rate: "0" }]);
      // Someone who reads the case but doesn't price quotations: refused, as before.
      await expect(w.builder(w.viewer).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "1" } }] }))
        .rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      expect(await w.builder(w.viewer).builder(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ canEdit: false, canPrice: false, canEditCosts: false });
      // Sales (edit, no QS permission) still can't touch it while it is with the QS.
      await expect(w.builder(w.sales).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, title: "Tall cabinets" } }] }))
        .rejects.toThrow(/with Quinn QS/);
    });
  });
});
