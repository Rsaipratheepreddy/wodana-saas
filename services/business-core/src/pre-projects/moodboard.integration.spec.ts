import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BriefService } from "./brief.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("moodboard pins and requirement links", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("links a pin to requirements, places it on the board and keeps it on reload", async () => {
    const client: PoolClient = await pool.connect();
    const workspaceId = randomUUID(), user = randomUUID(), partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Designer')", [user, `${user.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Studio',$2,'AED',$3)", [workspaceId, `mb-${workspaceId.slice(0, 8)}`, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, user]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: user });
      const service = new BriefService({ withPermission: run, withPermissions: run } as never, { record: async () => randomUUID() } as never, {} as never);
      const actor = {} as never;
      const base = { roomId: null, note: "", category: "General", priority: "preferred", scopeStatus: "undecided", reviewStatus: "captured", unit: "nos", referenceUrl: "", avoid: "", source: "team", assetIds: [] as string[] };
      const kitchen = randomUUID(), wardrobe = randomUUID(), pin = randomUUID();
      await service.saveEntry(actor, workspaceId, caseId, { ...base, id: kitchen, version: 0, kind: "requirement", title: "Kitchen cabinets" } as never);
      await service.saveEntry(actor, workspaceId, caseId, { ...base, id: wardrobe, version: 0, kind: "requirement", title: "Wardrobe" } as never);

      await expect(service.saveEntry(actor, workspaceId, caseId, { ...base, id: pin, version: 0, kind: "inspiration", title: "Warm oak", referenceUrl: "https://www.instagram.com/p/abc/", requirementIds: [randomUUID()] } as never)).rejects.toThrow(/requirements from this project/);
      const saved = await service.saveEntry(actor, workspaceId, caseId, { ...base, id: pin, version: 0, kind: "inspiration", title: "Warm oak", referenceUrl: "https://www.instagram.com/p/abc/", source: "client", requirementIds: [kitchen, wardrobe] } as never) as { requirementIds: string[]; board: unknown };
      expect(new Set(saved.requirementIds)).toEqual(new Set([kitchen, wardrobe]));
      expect(saved.board).toBeNull();
      // A new pin is shown to the client by default; one the team keeps to themselves isn't, and an edit never changes it.
      const teamOnly = randomUUID();
      await service.saveEntry(actor, workspaceId, caseId, { ...base, id: teamOnly, version: 0, kind: "inspiration", title: "Reference only", sharedWithClient: false } as never);
      const shares = async () => (await client.query("SELECT entry_id FROM pre_project_moodboard_shares WHERE workspace_id=$1 AND case_id=$2", [workspaceId, caseId])).rows.map((row) => row.entry_id);
      expect(await shares()).toEqual([pin]);

      await expect(service.saveEntry(actor, workspaceId, caseId, { ...base, id: randomUUID(), version: 0, kind: "requirement", title: "Bad", requirementIds: [kitchen] } as never)).rejects.toThrow(/Only moodboard items/);
      await expect(service.saveMoodboardLayout(actor, workspaceId, caseId, [{ entryId: kitchen, x: 0, y: 0, width: 240, z: 1, sentiment: "love" }])).rejects.toThrow(/moodboard items/);

      await service.saveMoodboardLayout(actor, workspaceId, caseId, [{ entryId: pin, x: 320.4, y: -40, width: 300, z: 3, sentiment: "avoid" }]);
      await service.saveMoodboardLayout(actor, workspaceId, caseId, [{ entryId: pin, x: 360, y: 10, width: 280, z: 4, sentiment: "love" }]);
      const reloaded = await service.entry(client, workspaceId, caseId, pin) as { board: unknown; requirementIds: string[] };
      expect(reloaded.board).toEqual({ x: 360, y: 10, width: 280, z: 4, sentiment: "love" });

      // Clearing the links keeps the pin.
      const cleared = await service.saveEntry(actor, workspaceId, caseId, { ...base, id: pin, version: 1, kind: "inspiration", title: "Warm oak", referenceUrl: "https://www.instagram.com/p/abc/", source: "client", requirementIds: [] } as never) as { requirementIds: string[] };
      expect(cleared.requirementIds).toEqual([]);
      expect(await shares()).toEqual([pin]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
