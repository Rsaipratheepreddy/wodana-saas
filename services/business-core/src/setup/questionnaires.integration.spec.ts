import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KIT_QUESTIONS } from "./questionnaires.domain";
import { SetupQuestionnairesService } from "./questionnaires.service";
import { readAnswers, writeAnswers } from "./questionnaires.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("Setup questionnaires (§0.3 P3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, ids: { workspaceId: string; otherId: string; service: SetupQuestionnairesService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [actor, `q-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      for (const id of [workspaceId, otherId]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Setup',$2,'AED',$3)", [id, `q-${id.slice(0, 8)}`, actor]);
      }
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      await work(client, { workspaceId, otherId, service: new SetupQuestionnairesService({ withPermission: run, withAnyPermission: run } as never) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const subject = () => ({ type: "case" as const, id: randomUUID() });

  it("starts from the kit, saves a draft, publishes versions and restores an older one as the draft", async () => {
    await withWorkspace(async (client, { workspaceId, service }) => {
      const start = await service.get(actor, workspaceId, "kickoff");
      expect(start).toMatchObject({ revision: 0, version: 0, draftChanged: false, problems: [] });
      expect(start.draft).toEqual(KIT_QUESTIONS.kickoff);
      await expect(service.publish(actor, workspaceId, "kickoff", { revision: 0 })).resolves.toMatchObject({ version: 1 });
      const mine = [{ label: "Who attended?", kind: "text" as const, required: true }, { label: "Updates by", kind: "choice" as const, options: ["Call", "Portal update"] }];
      const drafted = await service.get(actor, workspaceId, "kickoff");
      await expect(service.saveDraft(actor, workspaceId, "kickoff", { revision: drafted.revision + 5, questions: mine })).rejects.toThrow(/another window/);
      const saved = await service.saveDraft(actor, workspaceId, "kickoff", { revision: drafted.revision, questions: mine });
      expect(saved).toMatchObject({ version: 1, draftChanged: true });
      // Saving the same questions again is a no-op.
      expect((await service.saveDraft(actor, workspaceId, "kickoff", { revision: saved.revision, questions: mine })).revision).toBe(saved.revision);
      const published = await service.publish(actor, workspaceId, "kickoff", { revision: saved.revision, note: "Attendees required" });
      expect(published).toMatchObject({ version: 2, draftChanged: false });
      expect(published.versions.map((version) => version.number)).toEqual([2, 1]);
      await expect(service.publish(actor, workspaceId, "kickoff", { revision: published.revision })).rejects.toThrow(/Nothing has changed/);
      const restored = await service.restore(actor, workspaceId, "kickoff", { revision: published.revision, number: 0 });
      expect(restored).toMatchObject({ version: 2, draftChanged: true });
      expect(restored.draft).toEqual(KIT_QUESTIONS.kickoff);
      const audit = await client.query("SELECT action FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at", [workspaceId]);
      expect(audit.rows.map((row) => row.action)).toEqual(["setup.questionnaire_published.v1", "setup.questionnaire_draft_saved.v1", "setup.questionnaire_published.v1", "setup.questionnaire_restored.v1"]);
    });
  });

  it("won't publish a broken draft and lists every questionnaire in one place", async () => {
    await withWorkspace(async (_client, { workspaceId, service }) => {
      const saved = await service.saveDraft(actor, workspaceId, "handover", { revision: 0, questions: [{ label: "Pick one", kind: "choice", options: ["Only"] }] });
      await expect(service.publish(actor, workspaceId, "handover", { revision: saved.revision })).rejects.toThrow('Give "Pick one" at least two choices.');
      const list = await service.list(actor, workspaceId);
      expect(list.questionnaires.map((item) => item.purpose)).toEqual(["kickoff", "handover", "warranty_claim"]);
      expect(list.questionnaires.find((item) => item.purpose === "handover")).toMatchObject({ draftChanged: true, version: 0 });
      expect(list.elsewhere.map((item) => item.key)).toEqual(["consultation", "site_visit"]);
      await expect(service.get(actor, workspaceId, "payroll")).rejects.toThrow(/not found/);
    });
  });

  it("keeps a running job on the version it first answered, and a new job follows the latest", async () => {
    await withWorkspace(async (client, { workspaceId, service }) => {
      const first = await service.saveDraft(actor, workspaceId, "kickoff", { revision: 0, questions: [{ label: "Who attended?", kind: "text", required: true }] });
      await service.publish(actor, workspaceId, "kickoff", { revision: first.revision });
      const running = subject();
      await expect(writeAnswers(client, workspaceId, "kickoff", running, {}, { userId: null, name: "Designer" }, null, { complete: true })).rejects.toThrow("Answer first: Who attended?");
      await expect(writeAnswers(client, workspaceId, "kickoff", running, { nope: "x" }, { userId: null, name: "Designer" }, null, { complete: false })).rejects.toThrow(/Reload/);
      await writeAnswers(client, workspaceId, "kickoff", running, { who_attended: "Client and designer" }, { userId: null, name: "Designer" }, null, { complete: true });
      const next = await service.get(actor, workspaceId, "kickoff");
      const second = await service.saveDraft(actor, workspaceId, "kickoff", { revision: next.revision, questions: [{ label: "Budget confirmed?", kind: "yes_no", required: true }] });
      await service.publish(actor, workspaceId, "kickoff", { revision: second.revision });
      const kept = await readAnswers(client, workspaceId, "kickoff", running, null);
      expect(kept).toMatchObject({ version: 1, answers: { who_attended: "Client and designer" }, answeredBy: "Designer" });
      const fresh = await readAnswers(client, workspaceId, "kickoff", subject(), null);
      expect(fresh.version).toBe(2);
      expect(fresh.questions.map((question) => question.key)).toEqual(["budget_confirmed"]);
    });
  });

  it("keeps each firm's questionnaires and answers to itself (forced RLS)", async () => {
    await withWorkspace(async (client, { workspaceId, otherId, service }) => {
      const saved = await service.saveDraft(actor, workspaceId, "warranty_claim", { revision: 0, questions: [{ label: "Which room?", kind: "text" }] });
      await service.publish(actor, workspaceId, "warranty_claim", { revision: saved.revision });
      await writeAnswers(client, workspaceId, "warranty_claim", { type: "warranty_claim", id: randomUUID() }, { which_room: "Kitchen" }, { userId: null, name: "Client" }, null, { complete: true });
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      for (const table of ["setup_questionnaires", "setup_questionnaire_versions", "setup_questionnaire_answers"]) {
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`, [workspaceId])).rows[0].n).toBe(0);
      }
      await expect(client.query("INSERT INTO setup_questionnaires (workspace_id, purpose) VALUES ($1, 'kickoff')", [workspaceId])).rejects.toThrow(/row-level security/);
    });
  });
});
