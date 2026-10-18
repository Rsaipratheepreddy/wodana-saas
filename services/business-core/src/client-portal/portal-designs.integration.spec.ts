import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import type { DecisionContext } from "./portal-decisions";
import { designFileComment } from "./portal-designs";
import { tellClients } from "./portal-notices";
import { readView } from "./portal-read";
import { readPortalSettings } from "./portal-settings";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const NO_DEFINITIONS = { portalData: async () => null } as never;

type World = {
  client: PoolClient; workspaceId: string; caseId: string; grantId: string; designer: string;
  design: (input: { title: string; type: string; stage?: string | null; statuses: string[]; archived?: boolean }) => Promise<{ id: string; versions: string[] }>;
  ctx: () => Promise<DecisionContext>;
  folder: () => Promise<{ groups: Array<{ key: string; designs: Array<{ id: string; title: string; files: Array<{ id: string; number: number; status: string; canComment: boolean;
    comments: Array<{ text: string; fromClient: boolean; author: string | null; mine: boolean }> }> }> }> } | null>;
  notices: (code: string, channel?: string) => Promise<Array<{ recipient: string; body: string }>>;
};

integration("PLM-153: the client's Designs folder (every shared design file, by stage, to view and comment on)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), grantId = randomUUID(), designer = randomUUID(), membership = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Lina Designer')", [designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `dz-${workspaceId.slice(0, 8)}`, designer]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, designer]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, designer]);
      await client.query("INSERT INTO design_journeys(workspace_id,case_id) VALUES($1,$2)", [workspaceId, caseId]);
      await client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,$2,true)", [workspaceId, `dz-${workspaceId.slice(0, 8)}`]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Maya Client','+971500000001','approver','maya@example.com')",
        [grantId, workspaceId, caseId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const contact = { sessionId: "s", phone: "+971500000001", name: "Maya Client", nameConfirmed: true,
        grants: [{ id: grantId, caseId, name: "Maya Client", role: "approver", email: "maya@example.com", confirmed: true, demo: false }] };
      const files = { has: async (key: string | null) => Boolean(key), present: async <T>(rows: T[]) => rows } as never;
      let at = Date.now() - 50 * 3_600_000;
      await run({
        client, workspaceId, caseId, grantId, designer,
        design: async ({ title, type, stage = null, statuses, archived = false }) => {
          const id = randomUUID();
          await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [id, workspaceId, caseId, title, type, stage, designer, archived ? new Date() : null]);
          const versions: string[] = [];
          for (const [index, status] of statuses.entries()) {
            const asset = randomUUID(), version = randomUUID();
            at += 3_600_000;
            await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by)
              VALUES($1,$2,$3,$4,'image/png',10,$5,$6,repeat('c',64),$7)`, [asset, workspaceId, caseId, `${title}-${index + 1}.png`, `k/${asset}`, `k/${asset}/p`, designer]);
            await client.query(`INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,note,status,created_by,created_at)
              VALUES($1,$2,$3,$4,$5,$6,'',$7,$8,$9)`, [version, workspaceId, caseId, id, index + 1, asset, status, designer, new Date(at)]);
            versions.push(version);
          }
          return { id, versions };
        },
        ctx: async () => ({ db: client, workspaceId, contact, settings: await readPortalSettings(client, workspaceId), today: "2026-10-13" }) as unknown as DecisionContext,
        folder: async () => (await readView(client, workspaceId, contact as never, await readPortalSettings(client, workspaceId), NO_DEFINITIONS, files)).projects[0].designs as never,
        notices: async (code, channel = "in_app") => (await client.query<{ recipient: string; body: string }>(
          `SELECT recipient_id AS recipient, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at`, [workspaceId, code, channel])).rows,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("lists every shared file by stage, newest first with earlier rounds, never an internal or archived one; an empty project has none", async () => {
    await world(async (w) => {
      expect((await w.folder())!.groups).toEqual([]);
      const board = await w.design({ title: "Living mood board", type: "Concept / mood board", statuses: ["approved", "client_review"] });
      const layout = await w.design({ title: "Ground floor layout", type: "Space plan / furniture layout", stage: "space_planning", statuses: ["changes_requested"] });
      const render = await w.design({ title: "Kitchen render", type: "3D render / visualization", statuses: ["approved"] });
      await w.design({ title: "Draft elevation", type: "Elevation", statuses: ["draft", "internal_approved"] });
      await w.design({ title: "Old render", type: "3D render", statuses: ["approved"], archived: true });
      // A concept shown to the client only as a presentation's option.
      const option = await w.design({ title: "Concept B", type: "Other", stage: "concepts", statuses: ["internal_approved"] });
      const presentation = randomUUID();
      await w.client.query(`INSERT INTO design_presentations(id,workspace_id,case_id,stage,round,status,presented_at,created_by) VALUES($1,$2,$3,'concepts',1,'presented',now(),$4)`,
        [presentation, w.workspaceId, w.caseId, w.designer]);
      await w.client.query(`INSERT INTO design_presentation_options(id,workspace_id,case_id,presentation_id,title,design_id,created_by) VALUES($1,$2,$3,$4,'Option B',$5,$6)`,
        [randomUUID(), w.workspaceId, w.caseId, presentation, option.id, w.designer]);

      const folder = (await w.folder())!;
      expect(folder.groups.map((group) => [group.key, group.designs.map((design) => design.title)])).toEqual([
        ["concepts", ["Concept B", "Living mood board"]], ["layouts", ["Ground floor layout"]], ["renders", ["Kitchen render"]]]);
      const mood = folder.groups[0].designs.find((design) => design.id === board.id)!;
      expect(mood.files.map((file) => [file.number, file.status])).toEqual([[2, "client_review"], [1, "approved"]]);
      expect(folder.groups[0].designs[0].files.map((file) => file.status)).toEqual(["presented"]);
      expect(folder.groups[1].designs[0].files[0]).toMatchObject({ id: layout.versions[0], status: "changes_requested", canComment: true });
      expect(folder.groups[2].designs[0].files[0].id).toBe(render.versions[0]);
    });
  });

  it("takes the client's comment on any shared file (an approved earlier round too); its designer hears it and sees it in the Design tab", async () => {
    await world(async (w) => {
      const board = await w.design({ title: "Living mood board", type: "Concept / mood board", statuses: ["approved", "client_review"] });
      const ctx = await w.ctx();
      const commentId = randomUUID();
      await designFileComment(ctx, { caseId: w.caseId, versionId: board.versions[0], commentId, text: "Can we keep the oak floor from this round?" });
      expect(await w.notices("design.client_commented")).toEqual([expect.objectContaining({ recipient: w.designer, body: "Maya Client: Can we keep the oak floor from this round?" })]);
      expect(await w.notices("design.client_commented", "email")).toHaveLength(1);
      const thread = (await w.client.query(`SELECT version_id AS "versionId", client_visible AS visible, client_grant_id AS grant FROM pre_project_design_threads WHERE workspace_id = $1 AND id = $2`,
        [w.workspaceId, commentId])).rows[0];
      expect(thread).toEqual({ versionId: board.versions[0], visible: true, grant: w.grantId });
      const file = (await w.folder())!.groups[0].designs[0].files.find((item) => item.id === board.versions[0])!;
      expect(file.comments).toEqual([expect.objectContaining({ text: "Can we keep the oak floor from this round?", fromClient: true, author: "Maya Client", mine: true })]);
      // §0.3: a comment pinned on the picture keeps its point (the team sees the same pin); a point off the design is refused.
      const pinned = randomUUID();
      await designFileComment(ctx, { caseId: w.caseId, versionId: board.versions[0], commentId: pinned, text: "This corner feels dark", anchor: { x: 0.25, y: 0.333333 } });
      await expect(designFileComment(ctx, { caseId: w.caseId, versionId: board.versions[0], commentId: randomUUID(), text: "Off", anchor: { x: 1.4, y: 0.2 } }))
        .rejects.toThrow("Place the pin on the design.");
      expect((await w.client.query(`SELECT anchor FROM pre_project_design_threads WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, pinned])).rows[0].anchor).toEqual({ x: 0.25, y: 0.3333 });
      const withPin = (await w.folder())!.groups[0].designs[0].files.find((item) => item.id === board.versions[0])!;
      expect(withPin.comments.find((comment) => comment.text === "This corner feels dark")).toMatchObject({ anchor: { x: 0.25, y: 0.3333 }, threadId: pinned });

      // A file the team takes back (archived) can't be commented on; neither can one that was never shared.
      await w.client.query(`UPDATE pre_project_designs SET archived_at = now() WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, board.id]);
      await expect(designFileComment(ctx, { caseId: w.caseId, versionId: board.versions[1], commentId: randomUUID(), text: "Hi" })).rejects.toThrow("isn't shared with you any more");
      const draft = await w.design({ title: "Draft", type: "Elevation", statuses: ["draft"] });
      await expect(designFileComment(ctx, { caseId: w.caseId, versionId: draft.versions[0], commentId: randomUUID(), text: "Hi" })).rejects.toThrow("isn't shared with you any more");
    });
  });

  it("follows the Designs switch, and the team's reply reaches the client by email whichever of Designs, Decisions or the Moodboard they see", async () => {
    await world(async (w) => {
      const render = await w.design({ title: "Kitchen render", type: "3D render", statuses: ["approved"] });
      await w.client.query(`UPDATE client_portal_settings SET show_designs = false, show_moodboard = false WHERE workspace_id = $1`, [w.workspaceId]);
      expect(await w.folder()).toBeNull();
      await expect(designFileComment(await w.ctx(), { caseId: w.caseId, versionId: render.versions[0], commentId: randomUUID(), text: "Hi" })).rejects.toThrow("isn't shared with you");
      // Decisions still shown: a design reply goes.
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "design_replied", recordId: "design-reply:1", title: "Kitchen render", note: "Yes" }))
        .toMatchObject({ queued: 1 });
      await w.client.query(`UPDATE client_portal_settings SET show_decisions = false WHERE workspace_id = $1`, [w.workspaceId]);
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "design_replied", recordId: "design-reply:2", title: "Kitchen render" }))
        .toMatchObject({ queued: 0, reason: "hidden" });
      await w.client.query(`UPDATE client_portal_settings SET show_designs = true WHERE workspace_id = $1`, [w.workspaceId]);
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "design_replied", recordId: "design-reply:3", title: "Kitchen render" }))
        .toMatchObject({ queued: 1 });
    });
  });
});
