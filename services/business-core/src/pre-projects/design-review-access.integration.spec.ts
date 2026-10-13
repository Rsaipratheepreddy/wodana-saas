import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { BriefService } from "./brief.service";
import { DesignService } from "./design.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

// The teams as docs/fixtures/palm-teams-access.json sets them up.
const DESIGNER = ["pre_projects.view", "pre_projects.edit", "pre_projects.record_client_design_decisions"];
const CREATIVE_DIRECTOR = ["pre_projects.view", "pre_projects.review_designs", "projects.view", "catalog.view"];
const VIEWER = ["pre_projects.view"];

type World = { client: PoolClient; workspaceId: string; caseId: string; designer: string; director: string; otherReviewer: string; viewer: string;
  design: (title: string, status: string, reviewer: string | null) => Promise<{ id: string; versionId: string }>;
  as: (userId: string) => DesignService };

/**
 * QA-004 (plan 6.7): the Creative Director approves a design sent to them, or sends it back with notes, without the
 * planning edit permission. Only the assigned reviewer decides; everything else on a design stays with editors.
 * Runs the real permission checks as the app role (forced RLS).
 */
integration("QA-004: the assigned design reviewer decides without editing the case", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  });
  afterAll(() => pool.end());

  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), designer = randomUUID(), director = randomUUID(), otherReviewer = randomUUID(), viewer = randomUUID();
    const asset = randomUUID(), opportunity = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Dana Designer'),($3,$4,'Diego Director'),($5,$6,'Rana Reviewer'),($7,$8,'Vic Viewer')",
        [designer, `d-${designer.slice(0, 8)}@example.com`, director, `cd-${director.slice(0, 8)}@example.com`, otherReviewer, `r-${otherReviewer.slice(0, 8)}@example.com`, viewer, `v-${viewer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Studio',$2,'AED',$3)", [workspaceId, `dr-${workspaceId.slice(0, 8)}`, designer]);
      for (const [userId, code, permissions] of [[designer, "team_interior_design", DESIGNER], [director, "team_creative_director", CREATIVE_DIRECTOR], [otherReviewer, "reviewer", CREATIVE_DIRECTOR], [viewer, "viewer", VIEWER]] as const) {
        const membership = randomUUID(), role = randomUUID();
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, userId]);
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [role, workspaceId, code]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, permissions]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      }
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$3,$3,'Majlis design','D-0012')`, [opportunity, workspaceId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, designer]);
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'majlis.pdf','application/pdf',1,'k',repeat('a',64),$4)",
        [asset, workspaceId, caseId, designer]);
      const design = async (title: string, status: string, reviewer: string | null) => {
        const id = randomUUID(), versionId = randomUUID();
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,created_by) VALUES($1,$2,$3,$4,'concept',$5)", [id, workspaceId, caseId, title, designer]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,reviewer_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
          [versionId, workspaceId, caseId, id, asset, designer, status, reviewer]);
        await client.query("SET LOCAL session_replication_role = origin");
        return { id, versionId };
      };
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
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
      const events = new CrmEventsService();
      const as = (userId: string) => {
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId, displayName: userId }) } as never);
        return new DesignService(access, new BriefService(access, events, {} as never), events);
      };
      await work({ client, workspaceId, caseId, designer, director, otherReviewer, viewer, design, as });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const versionOf = async (w: World, id: string) => Number((await w.client.query("SELECT version FROM pre_project_designs WHERE id = $1", [id])).rows[0].version);
  const decide = async (w: World, userId: string, design: { id: string; versionId: string }, action: string, note = "") =>
    w.as(userId).activity(actor, w.workspaceId, w.caseId, design.id, { id: randomUUID(), version: await versionOf(w, design.id), versionId: design.versionId, action, note, decisionBy: "" });

  it("lets the Creative Director approve or send back a design sent to them, with pinned notes", async () => {
    await world(async (w) => {
      const concept = await w.design("Majlis concept", "internal_review", w.director);
      const layout = await w.design("Dining layout", "internal_review", w.director);
      const approved = await decide(w, w.director, concept, "internal_approved");
      expect(approved.versions[0]).toMatchObject({ status: "internal_approved" });
      // Sending back: a pinned note on the version, then the decision with what to change.
      const noted = await w.as(w.director).createThread(actor, w.workspaceId, w.caseId, layout.id, { id: randomUUID(), versionId: layout.versionId, title: "Seating", body: "Seat twelve, not ten", blocking: true });
      expect(noted.threads.map((thread: { title: string }) => thread.title)).toEqual(["Seating"]);
      const returned = await decide(w, w.director, layout, "changes_requested", "Seat twelve, not ten");
      expect(returned.versions[0]).toMatchObject({ status: "changes_requested" });
      const recorded = (await w.client.query(`SELECT action, created_by AS "by" FROM pre_project_design_activity WHERE workspace_id = $1 ORDER BY created_at, action`, [w.workspaceId])).rows;
      expect(recorded).toEqual(expect.arrayContaining([{ action: "internal_approved", by: w.director }, { action: "changes_requested", by: w.director }]));
      // Audited like every design step.
      expect((await w.client.query(`SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action IN ('pre_project.design_internal_approved.v1', 'pre_project.design_changes_requested.v1') AND actor_user_id = $2`,
        [w.workspaceId, w.director])).rows[0].n).toBe(2);
      // The designer hears both answers.
      expect((await w.client.query(`SELECT event_type FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND channel = 'in_app' ORDER BY event_type`, [w.workspaceId, w.designer])).rows.map((row) => row.event_type))
        .toEqual(["design.review_approved", "design.sent_back"]);
    });
  });

  const step = async (w: World, userId: string, design: { id: string; versionId: string }, action: string, extra: Record<string, unknown> = {}) =>
    w.as(userId).activity(actor, w.workspaceId, w.caseId, design.id, { id: randomUUID(), version: await versionOf(w, design.id), versionId: design.versionId, action, note: "", decisionBy: "", ...extra });
  const journey = (w: World, role: string | null) => w.client.query("INSERT INTO design_journeys(workspace_id,case_id,package_name,reviewer_role_code) VALUES($1,$2,'Package',$3)", [w.workspaceId, w.caseId, role]);

  it("PLM-145: on a package without a review role the lead designer shares the file with the client directly, and no reviewer is offered", async () => {
    await world(async (w) => {
      await journey(w, null);
      const concept = await w.design("Majlis concept", "draft", null);
      const options = await w.as(w.designer).list(actor, w.workspaceId, w.caseId);
      expect(options).toMatchObject({ internalReview: false, reviewers: [] });
      await expect(step(w, w.designer, concept, "internal_review", { reviewerId: w.director, contextConfirmed: true })).rejects.toThrow(/no internal review/);
      const shared = await step(w, w.designer, concept, "client_review");
      expect(shared.versions[0]).toMatchObject({ status: "client_review" });
      expect((await w.client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type::text = 'design.review_requested'`, [w.workspaceId])).rows[0].n).toBe(0);
    });
  });

  it("PLM-145: keeps the internal review on a package with a review role, with only that role's holders as reviewers", async () => {
    await world(async (w) => {
      await journey(w, "team_creative_director");
      const concept = await w.design("Majlis concept", "draft", null);
      const options = await w.as(w.designer).list(actor, w.workspaceId, w.caseId);
      expect(options.internalReview).toBe(true);
      expect(options.reviewers.map((row: { id: string }) => row.id)).toEqual([w.director]);
      await expect(step(w, w.designer, concept, "client_review")).rejects.toThrow(/no longer available/);
      await expect(step(w, w.designer, concept, "internal_review", { reviewerId: w.otherReviewer, contextConfirmed: true })).rejects.toThrow(/review role/);
      const sent = await step(w, w.designer, concept, "internal_review", { reviewerId: w.director, contextConfirmed: true });
      expect(sent.versions[0]).toMatchObject({ status: "internal_review", reviewerId: w.director });
    });
  });

  it("keeps the decision with the assigned reviewer and everything else with editors", async () => {
    await world(async (w) => {
      const concept = await w.design("Majlis concept", "internal_review", w.director);
      // Another reviewer, someone who only reads, and an editor without design review: refused.
      await expect(decide(w, w.otherReviewer, concept, "internal_approved")).rejects.toThrow(/Only the assigned reviewer/);
      await expect(decide(w, w.viewer, concept, "internal_approved")).rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      await expect(decide(w, w.designer, concept, "internal_approved")).rejects.toThrow(/Design review permission is required/);
      await expect(w.as(w.otherReviewer).createThread(actor, w.workspaceId, w.caseId, concept.id, { id: randomUUID(), versionId: concept.versionId, title: "Note", body: "x", blocking: false }))
        .rejects.toThrow(/Only editors or the assigned reviewer/);
      // The reviewer decides; presenting to the client, recording the client's answer or a new review stay with editors.
      await decide(w, w.director, concept, "internal_approved");
      await expect(w.as(w.director).activity(actor, w.workspaceId, w.caseId, concept.id, { id: randomUUID(), version: await versionOf(w, concept.id), versionId: concept.versionId, action: "client_review", note: "", decisionBy: "" }))
        .rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      const sent = await w.design("Sent to the client", "client_review", w.director);
      await expect(decide(w, w.director, sent, "changes_requested", "Client wants walnut")).rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      const draft = await w.design("A draft", "draft", null);
      await expect(w.as(w.director).activity(actor, w.workspaceId, w.caseId, draft.id, { id: randomUUID(), version: await versionOf(w, draft.id), versionId: draft.versionId, action: "comment", note: "Looks good", decisionBy: "" }))
        .rejects.toThrow(/Permissions required: pre_projects.view, pre_projects.edit/);
      expect((await w.client.query(`SELECT status FROM pre_project_design_versions WHERE id = $1`, [sent.versionId])).rows[0].status).toBe("client_review");
    });
  });
});
