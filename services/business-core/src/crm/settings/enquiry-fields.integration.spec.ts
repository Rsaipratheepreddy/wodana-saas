import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmSettingsService } from "./crm-settings.service";
import { EnquiryFieldsService } from "./enquiry-fields.service";
import { enquiryCustomValuesSql, writeEnquiryCustomValues } from "./enquiry-fields";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("enquiry fields", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function withWorkspace(work: (client: PoolClient, ids: { workspaceId: string; enquiryId: string; leadId: string; settings: CrmSettingsService; fields: EnquiryFieldsService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), user = randomUUID(), enquiryId = randomUUID(), leadId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Admin')", [user, `admin-${user.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and parent rows
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Fields',$2,'AED',$3)", [workspaceId, `fields-${workspaceId.slice(0, 8)}`, user]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','company','website',now(),'E-1','fit_out','{}')`, [enquiryId, workspaceId, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, randomUUID()]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: user });
      const access = { withPermission: run } as never, events = { record: async () => undefined } as never;
      await work(client, { workspaceId, enquiryId, leadId, settings: new CrmSettingsService(access, events, { record: async () => undefined, ensureBaseline: async () => undefined } as never), fields: new EnquiryFieldsService(access, events) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("hides fixed fields with version checks and stores custom answers on the enquiry", async () => {
    await withWorkspace(async (client, { workspaceId, enquiryId, settings, fields }) => {
      const initial = await fields.list(actor, workspaceId);
      expect(initial.system.budgetRange).toEqual({ visible: true, version: 0 });
      const hidden = await fields.setSystemVisibility(actor, workspaceId, "budgetRange", { visible: false, version: 0 });
      expect(hidden).toMatchObject({ key: "budgetRange", visible: false, version: 1 });
      await expect(fields.setSystemVisibility(actor, workspaceId, "budgetRange", { visible: true, version: 0 })).rejects.toThrow(/changed/);
      await expect(fields.setSystemVisibility(actor, workspaceId, "mobile", { visible: false, version: 0 })).rejects.toThrow(/always shown/);

      const floor = await settings.createField(actor, workspaceId, { entityType: "enquiry", key: "floor", label: "Floor", dataType: "number", position: 1 }) as { id: string; visible: boolean };
      const rooms = await settings.createField(actor, workspaceId, { entityType: "enquiry", key: "rooms", label: "Rooms", dataType: "multi_select", configuration: { options: ["Kitchen", "Bath"] }, visible: false, position: 2 }) as { id: string; visible: boolean };
      const moving = await settings.createField(actor, workspaceId, { entityType: "enquiry", key: "moving", label: "Moving in", dataType: "date", position: 3 }) as { id: string };
      expect([floor.visible, rooms.visible]).toEqual([true, false]);
      const listed = await fields.list(actor, workspaceId);
      expect(listed.custom.map((field: { label: string }) => field.label)).toEqual(["Floor", "Rooms", "Moving in"]);

      await writeEnquiryCustomValues(client, workspaceId, enquiryId, { [floor.id]: "3", [rooms.id]: ["Kitchen", "Bath"], [moving.id]: "2026-10-01", [randomUUID()]: "ignored" });
      await writeEnquiryCustomValues(client, workspaceId, enquiryId, { [floor.id]: "4" });
      const values = await client.query(`SELECT ${enquiryCustomValuesSql("$1", "$2")} AS values`, [workspaceId, enquiryId]);
      expect(values.rows[0].values).toEqual({ [floor.id]: 4, [rooms.id]: ["Kitchen", "Bath"], [moving.id]: "2026-10-01" });
      expect((await fields.list(actor, workspaceId)).custom.find((field: { id: string }) => field.id === floor.id)).toMatchObject({ valueCount: 1 });
    });
  });

  it("lets staff set and clear an enquiry's own-field values through its lead", async () => {
    await withWorkspace(async (client, { workspaceId, leadId, settings, fields }) => {
      // The fixture enquiry has no intake event row; skip the parent-row trigger when touching it.
      await client.query("SET LOCAL session_replication_role = replica");
      const type = await settings.createField(actor, workspaceId, { entityType: "enquiry", key: "ptype", label: "Property type", dataType: "select", configuration: { options: ["Villa", "Flat"] } }) as { id: string };
      const floor = await settings.createField(actor, workspaceId, { entityType: "enquiry", key: "floor", label: "Floor", dataType: "number" }) as { id: string };
      expect((await fields.setLeadValues(actor, workspaceId, leadId, { values: { [type.id]: "Villa", [floor.id]: 2 } })).customFields).toEqual({ [type.id]: "Villa", [floor.id]: 2 });
      expect((await fields.setLeadValues(actor, workspaceId, leadId, { values: { [floor.id]: null } })).customFields).toEqual({ [type.id]: "Villa" });
      await expect(fields.setLeadValues(actor, workspaceId, leadId, { values: { [type.id]: "Castle" } })).rejects.toThrow("Property type");
      await expect(fields.setLeadValues(actor, workspaceId, randomUUID(), { values: {} })).rejects.toThrow("not found");
    });
  });
});
