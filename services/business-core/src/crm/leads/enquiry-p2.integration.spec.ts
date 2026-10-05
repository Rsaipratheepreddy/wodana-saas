import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmIntakeService } from "../intake/crm-intake.service";
import { CrmOpportunitiesService } from "../opportunities/crm-opportunities.service";
import { OpportunityDiscoveryService } from "../opportunities/discovery.service";
import { IntroMeetingService } from "../opportunities/intro-meeting.service";
import { EnquiryFieldsService } from "../settings/enquiry-fields.service";
import { CrmLeadsService } from "./crm-leads.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const DESIGN_FLOW = { schema: 1, columns: ["qualified", "qualification", "proposal", "negotiation", "won"], branches: [], steps: [
  { key: "first_contact", name: "Make first contact", role: "sales", check: "contact_logged", column: "qualified" },
  { key: "intro_meeting", name: "Hold the intro meeting", role: "sales", check: "intro_meeting_completed", column: "qualification" },
  { key: "payment_proof", name: "Attach the payment proof", role: "sales", check: "payment_proof_attached", column: "won" },
] };
const SHOWROOM_FLOW = { ...DESIGN_FLOW, steps: [DESIGN_FLOW.steps[0], { key: "quote", name: "Prepare the quotation", role: "sales", check: "quote_exists", column: "proposal" }, DESIGN_FLOW.steps[2]] };

type Ids = {
  workspaceId: string; otherWorkspaceId: string; pipelineId: string;
  admin: string; sales: string; sales2: string; designer: string;
  adminMember: string; salesMember: string; sales2Member: string; designerMember: string;
};
type Services = { leads: CrmLeadsService; intake: CrmIntakeService; opportunities: CrmOpportunitiesService; fields: EnquiryFieldsService; intro: IntroMeetingService };

/**
 * P2 enquiry (plan §6.5a, §7a E1-1/E1-2/E1-6): duplicates across channels, returning clients, locked identity,
 * required fields per enquiry type at conversion and before the intro, all problems at once, the enquiry team
 * carried into the opportunity, and who reads internal notes. Every command runs as the app role (forced RLS).
 */
integration("P2 enquiry: required fields, team, notes, duplicates (real Postgres)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function seedWorkspace(client: PoolClient, workspaceId: string, owner: string) {
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,created_by) VALUES($1,'P2 studio',$2,'AED','en-AE',$3)", [workspaceId, `p2-${workspaceId.slice(0, 8)}`, owner]);
    const types = randomUUID(), regions = randomUUID();
    await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$3,'enquiry_type','Enquiry types'),($2,$3,'emirate','Regions')", [types, regions, workspaceId]);
    await client.query(`INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,position,flow) VALUES
      ($1,$2,'full_id','Full interior design',1,'design'),($1,$2,'furniture','Furniture only',2,'showroom'),($1,$2,'not_sure','Not sure yet',3,NULL),
      ($1,$3,'dubai','Dubai',1,NULL)`, [workspaceId, types, regions]);
    for (const [code, definition] of [["design", DESIGN_FLOW], ["showroom", SHOWROOM_FLOW]] as const) {
      const flowId = randomUUID();
      await client.query("INSERT INTO crm_flows(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [flowId, workspaceId, code]);
      await client.query("INSERT INTO crm_flow_versions(workspace_id,flow_id,version,definition,checksum) VALUES($1,$2,1,$3,$4)", [workspaceId, flowId, JSON.stringify(definition), "a".repeat(64)]);
    }
  }

  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string, workspaceId?: string) => Services) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherWorkspaceId = randomUUID(), pipelineId = randomUUID();
    const [admin, sales, sales2, designer] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [adminMember, salesMember, sales2Member, designerMember] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [adminRole, salesRole, designerRole] = [randomUUID(), randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[admin, "Admin"], [sales, "Sara Sales"], [sales2, "Omar Sales"], [designer, "Dina Designer"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${name.split(" ")[0].toLowerCase()}-${id.slice(0, 8)}@example.com`, name]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await seedWorkspace(client, workspaceId, admin);
      await seedWorkspace(client, otherWorkspaceId, admin);
      await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$5,$6,'active'),($2,$5,$7,'active'),($3,$5,$8,'active'),($4,$5,$9,'active')`,
        [adminMember, salesMember, sales2Member, designerMember, workspaceId, admin, sales, sales2, designer]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'administrator','Administrator',true),($2,$4,'sales','Account managers',false),($3,$4,'designer','Designers',false)", [adminRole, salesRole, designerRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, adminRole]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`,
        [workspaceId, salesRole, ["crm.leads.view", "crm.leads.manage", "crm.parties.view", "crm.parties.manage", "crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.transition", "crm.activities.view", "crm.activities.manage"]]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, designerRole, ["crm.leads.view"]]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$5),($1,$7,$8)",
        [workspaceId, adminMember, adminRole, salesMember, salesRole, sales2Member, designerMember, designerRole]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'sales','Sales',true)", [pipelineId, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(workspace_id,pipeline_id,code,name,position) VALUES($1,$2,'qualified','New Opportunity',1)", [workspaceId, pipelineId]);
      await client.query("SET LOCAL session_replication_role = origin");
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
      const as = (userId: string) => {
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        const events = new CrmEventsService();
        const leads = new CrmLeadsService(database as never, access, events);
        return {
          leads, intake: new CrmIntakeService(database as never, access, events, leads), opportunities: new CrmOpportunitiesService(access, events),
          fields: new EnquiryFieldsService(access, events), intro: new IntroMeetingService(access, { record: async () => randomUUID() } as never, new OpportunityDiscoveryService(access)),
        };
      };
      await work(client, { workspaceId, otherWorkspaceId, pipelineId, admin, sales, sales2, designer, adminMember, salesMember, sales2Member, designerMember }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  type Enquiry = { name?: string; mobile?: string; email?: string; address?: string; serviceType?: string; channel?: string; notes?: string; summary?: string; budgetRange?: string; team?: unknown[]; owner?: string; identity?: "existing" | "new"; partyId?: string };
  const manual = (ids: Ids, enquiry: Enquiry = {}) => ({
    source: "company", channel: enquiry.channel ?? "call", intakeMethod: "manual",
    party: { displayName: enquiry.name ?? "Layla Haddad", mobile: enquiry.mobile ?? "+971501112233", ...(enquiry.email ? { email: enquiry.email } : {}), ...(enquiry.address ? { address: enquiry.address } : {}) },
    serviceType: enquiry.serviceType ?? "full_id", details: { emirate: "dubai", ...(enquiry.notes ? { internalNotes: enquiry.notes } : {}), ...(enquiry.budgetRange ? { budgetRange: enquiry.budgetRange } : {}) },
    ...(enquiry.summary ? { summary: enquiry.summary } : {}),
    assignment: { mode: "manual", ownerMembershipId: enquiry.owner ?? ids.salesMember },
    ...(enquiry.team ? { team: enquiry.team } : {}), ...(enquiry.identity ? { identity: enquiry.identity, ...(enquiry.partyId ? { partyId: enquiry.partyId } : {}) } : {}),
    originalPayload: { origin: "test" },
  });
  const create = async (services: Services, ids: Ids, enquiry: Enquiry = {}) =>
    (await services.intake.createManual(actor, ids.workspaceId, `p2:${randomUUID()}`, undefined, manual(ids, enquiry) as never)) as unknown as { leadId: string; enquiryId: string; partyId: string };
  const leadRow = async (client: PoolClient, leadId: string) => (await client.query<{ version: number; party_id: string; status: string }>("SELECT version, party_id, status FROM crm_leads WHERE id = $1", [leadId])).rows[0];
  const convert = async (client: PoolClient, services: Services, ids: Ids, leadId: string) => {
    const lead = await leadRow(client, leadId);
    return services.opportunities.qualifyLead(actor, ids.workspaceId, leadId, {
      leadVersion: Number(lead.version), partyId: lead.party_id, pipelineId: ids.pipelineId, ownerMembershipId: ids.salesMember, title: "Villa", nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
    } as never) as Promise<Record<string, unknown>>;
  };
  const edit = async (client: PoolClient, services: Services, leadId: string, ids: Ids, change: { party?: Record<string, unknown>; details?: Record<string, unknown>; team?: unknown[]; serviceType?: string } = {}) => {
    const lead = await leadRow(client, leadId);
    return services.intake.updateDetails(actor, ids.workspaceId, leadId, {
      version: Number(lead.version), serviceType: change.serviceType ?? "full_id",
      party: { displayName: "Layla Haddad", mobile: "+971501112233", ...change.party }, details: { emirate: "dubai", ...change.details }, ...(change.team ? { team: change.team } : {}),
    } as never);
  };
  const problemsOf = async (promise: Promise<unknown>) => {
    try { await promise; } catch (error) { return (error as { response?: { missing?: Array<{ key: string }> }; status?: number }); }
    throw new Error("Expected the command to be refused");
  };
  const require = (services: Services, ids: Ids, fieldKey: string, enquiryType: string, requiredAt: string, version = 0) =>
    services.fields.setRequirement(actor, ids.workspaceId, fieldKey, { types: [{ enquiryType, requiredAt, version }] });

  it("E1-1: the same person on another channel is a possible match, never merged silently; confirming links both enquiries", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.sales);
      const first = await create(staff, ids, { channel: "website", email: "layla@example.com" });
      // The second arrives on WhatsApp through an integration: no one has said who it is yet.
      const second = await staff.intake.createInternal(ids.workspaceId, `wa:${randomUUID()}`, undefined, { ...manual(ids, { channel: "whatsapp", name: "Layla H." }), intakeMethod: "automated", assignment: { mode: "unassigned" } } as never) as unknown as { leadId: string; partyId: string };
      expect(second.partyId).not.toBe(first.partyId);
      const pending = await staff.leads.get(actor, ids.workspaceId, second.leadId) as unknown as { clientMatches: Array<{ partyId: string }> };
      expect(pending.clientMatches.map((match) => match.partyId)).toContain(first.partyId);
      await staff.leads.confirmClient(actor, ids.workspaceId, second.leadId, { version: Number((await leadRow(client, second.leadId)).version), decision: "same", partyId: first.partyId });
      expect((await leadRow(client, second.leadId)).party_id).toBe(first.partyId);
      const enquiries = await client.query("SELECT channel FROM crm_enquiries WHERE workspace_id = $1 AND party_id = $2 ORDER BY received_at", [ids.workspaceId, first.partyId]);
      expect(enquiries.rows.map((row) => row.channel)).toEqual(["website", "whatsapp"]);
    });
  });

  it("E1-2: a returning client starts a new job under the same client; the old job is untouched", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.sales);
      const first = await create(staff, ids, { serviceType: "furniture" });
      const opportunity = await convert(client, staff, ids, first.leadId);
      const before = (await client.query("SELECT status, version, stage_id FROM crm_opportunities WHERE id = $1", [opportunity.id])).rows[0];
      const again = await create(staff, ids, { serviceType: "full_id", identity: "existing", partyId: first.partyId });
      expect(again.partyId).toBe(first.partyId);
      expect((await leadRow(client, again.leadId)).status).not.toBe("duplicate");
      expect((await client.query("SELECT status, version, stage_id FROM crm_opportunities WHERE id = $1", [opportunity.id])).rows[0]).toEqual(before);
      expect((await client.query("SELECT count(*)::int AS n FROM crm_leads WHERE workspace_id = $1 AND party_id = $2", [ids.workspaceId, first.partyId])).rows[0].n).toBe(2);
    });
  });

  it("E1-6: after Qualified, Sales can't change the client's name or phone; a Sales admin can", async () => {
    await scenario(async (client, ids, as) => {
      const lead = await create(as(ids.sales), ids, { serviceType: "furniture" });
      await convert(client, as(ids.sales), ids, lead.leadId);
      expect((await leadRow(client, lead.leadId)).status).toBe("qualified");
      await expect(edit(client, as(ids.sales), lead.leadId, ids, { serviceType: "furniture", party: { displayName: "Someone Else" } })).rejects.toThrow("Only Sales admins can change the client's name or phone");
      await expect(edit(client, as(ids.sales), lead.leadId, ids, { serviceType: "furniture", party: { mobile: "+971509998877" } })).rejects.toThrow("Only Sales admins can change the client's name or phone");
      await expect(edit(client, as(ids.admin), lead.leadId, ids, { serviceType: "furniture", party: { displayName: "Layla Al Haddad" } })).resolves.toMatchObject({ id: lead.leadId });
    });
  });

  it("PLM-096/092: conversion names every field its enquiry type requires at once; another type converts as before; the team carries over (PLM-100)", async () => {
    await scenario(async (client, ids, as) => {
      const admin = as(ids.admin), staff = as(ids.sales);
      for (const key of ["email", "address", "budgetRange", "team:designer"]) await require(admin, ids, key, "full_id", "convert");
      const lead = await create(staff, ids);
      const seen = await staff.leads.get(actor, ids.workspaceId, lead.leadId) as unknown as { conversion: { ready: boolean; missing: Array<{ key: string }> }; teamRoles: string[] };
      expect(seen.teamRoles).toEqual(["designer"]);
      expect(seen.conversion.missing.map((item) => item.key)).toEqual(["email", "address", "budgetRange", "team:designer"]);
      const refused = await problemsOf(convert(client, staff, ids, lead.leadId));
      expect(refused.status).toBe(422);
      expect(refused.response?.missing?.map((item) => item.key)).toEqual(["email", "address", "budgetRange", "team:designer"]);
      expect((await leadRow(client, lead.leadId)).status).not.toBe("qualified");

      // A furniture enquiry keeps today's rules and converts with none of these.
      const furniture = await create(staff, ids, { serviceType: "furniture", mobile: "+971502223344", name: "Noor Saleh" });
      await expect(convert(client, staff, ids, furniture.leadId)).resolves.toMatchObject({ leadId: furniture.leadId });

      await edit(client, staff, lead.leadId, ids, { party: { email: "layla@example.com", address: "Villa 4, Street 9" }, details: { budgetRange: "not_sure" }, team: [{ role: "designer", membershipId: ids.designerMember }] });
      const opportunity = await convert(client, staff, ids, lead.leadId);
      const team = await client.query("SELECT membership_id, role FROM crm_opportunity_team WHERE opportunity_id = $1", [opportunity.id]);
      expect(team.rows).toEqual([{ membership_id: ids.designerMember, role: "designer" }]);
      expect((await client.query("SELECT membership_id FROM crm_opportunity_designer WHERE opportunity_id = $1", [opportunity.id])).rows[0].membership_id).toBe(ids.designerMember);
    });
  });

  it("PLM-096: a field required at creation stops a staff enquiry with every problem listed; Not applicable answers a team role", async () => {
    await scenario(async (_client, ids, as) => {
      const admin = as(ids.admin), staff = as(ids.sales);
      await require(admin, ids, "summary", "full_id", "create");
      await require(admin, ids, "team:designer", "full_id", "create");
      const refused = await problemsOf(create(staff, ids, { name: "" }));
      expect(refused.response?.missing?.map((item) => item.key)).toEqual(["displayName"]);
      const missing = await problemsOf(create(staff, ids));
      expect(missing.response?.missing?.map((item) => item.key)).toEqual(["summary", "team:designer"]);
      const created = await create(staff, ids, { summary: "Kitchen and living room", team: [{ role: "designer", notApplicable: true }] });
      const seen = await staff.leads.get(actor, ids.workspaceId, created.leadId) as unknown as { team: Array<{ role: string; notApplicable: boolean; membershipId: string | null }> };
      expect(seen.team).toMatchObject([{ role: "designer", notApplicable: true, membershipId: null }]);
    });
  });

  it("PLM-096: the intro can't be booked while the enquiry misses a field required before the intro, listed with the Discovery facts", async () => {
    await scenario(async (client, ids, as) => {
      const admin = as(ids.admin), staff = as(ids.sales);
      await require(admin, ids, "address", "full_id", "book_intro");
      const lead = await create(staff, ids, { email: "layla@example.com" });
      const opportunity = await convert(client, staff, ids, lead.leadId);
      const refused = await problemsOf(staff.intro.book(actor, ids.workspaceId, String(opportunity.id), {
        designerMembershipId: ids.designerMember, mode: "in_person", startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(), timezone: "Asia/Dubai",
      }));
      const keys = refused.response?.missing?.map((item) => item.key) ?? [];
      expect(keys).toContain("address");
      expect(keys).toContain("floorPlan");
      expect(String((refused as { message?: string }).message)).toMatch(/Complete the enquiry: Enter the address/);
    });
  });

  it("requirements are validated, version-checked, idempotent and audited; a type's first save keeps its defaults", async () => {
    await scenario(async (client, ids, as) => {
      const admin = as(ids.admin);
      const saved = await require(admin, ids, "address", "full_id", "convert") as { rules: Record<string, Record<string, string>>; versions: Record<string, Record<string, number>> };
      expect(saved.rules.full_id).toEqual({ email: "book_intro", address: "convert" });
      expect(saved.versions.full_id).toEqual({ email: 1, address: 1 });
      // The same value again changes nothing, whatever version the caller holds.
      await expect(require(admin, ids, "address", "full_id", "convert", 0)).resolves.toMatchObject({ versions: { full_id: { address: 1 } } });
      // A stale version is refused.
      await expect(require(admin, ids, "address", "full_id", "book_intro", 0)).rejects.toThrow("These requirements changed");
      await expect(require(admin, ids, "address", "full_id", "book_intro", 1)).resolves.toMatchObject({ rules: { full_id: { address: "book_intro" } } });
      await expect(require(admin, ids, "address", "not_sure", "convert")).rejects.toThrow("Unknown enquiry type");
      await expect(require(admin, ids, "displayName", "full_id", "convert")).rejects.toThrow("can't be required");
      await expect(require(as(ids.sales), ids, "address", "furniture", "convert")).rejects.toThrow(/crm.settings.manage/);
      const audit = await client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action = 'crm.enquiry_requirements.updated.v1'", [ids.workspaceId]);
      expect(audit.rows[0].n).toBe(2);
    });
  });

  it("PLM-024: internal notes reach only the enquiry team by default, everyone in Sales when the firm says so, and an edit by someone who can't read them keeps them", async () => {
    await scenario(async (client, ids, as) => {
      const lead = await create(as(ids.sales), ids, { notes: "Prefers calls after 6pm" });
      const notesFor = async (userId: string) => {
        const seen = await as(userId).leads.get(actor, ids.workspaceId, lead.leadId) as unknown as { enquiry: { details: Record<string, unknown>; originalSubmission: { details: Record<string, unknown> } } };
        const listed = (await as(userId).leads.list(actor, ids.workspaceId, { limit: 50 } as never) as { data: Array<{ id: string; details: Record<string, unknown> }> }).data.find((row) => row.id === lead.leadId);
        const enquiry = await as(userId).intake.getEnquiry(actor, ids.workspaceId, lead.enquiryId) as { details: Record<string, unknown> };
        return [seen.enquiry.details.internalNotes, seen.enquiry.originalSubmission.details.internalNotes, listed?.details.internalNotes, enquiry.details.internalNotes];
      };
      expect(await notesFor(ids.sales)).toEqual(Array(4).fill("Prefers calls after 6pm")); // the owner
      expect(await notesFor(ids.admin)).toEqual(Array(4).fill("Prefers calls after 6pm")); // assigns enquiries
      expect(await notesFor(ids.sales2)).toEqual(Array(4).fill(undefined));
      expect(await notesFor(ids.designer)).toEqual(Array(4).fill(undefined));

      // Omar edits the enquiry without seeing the notes: they stay.
      await edit(client, as(ids.sales2), lead.leadId, ids, { details: { internalNotes: "" } });
      expect((await client.query("SELECT details->>'internalNotes' AS notes FROM crm_enquiries WHERE id = $1", [lead.enquiryId])).rows[0].notes).toBe("Prefers calls after 6pm");
      // Sara changes them; the change shows in the history only for those who read the notes.
      await edit(client, as(ids.sales), lead.leadId, ids, { details: { internalNotes: "VIP, calls after 6pm" } });
      const historyFor = async (userId: string) => (await as(userId).leads.history(actor, ids.workspaceId, lead.leadId)).flatMap((event) => event.changes.map((change) => change.field));
      expect(await historyFor(ids.sales)).toContain("details.internalNotes");
      expect(await historyFor(ids.sales2)).not.toContain("details.internalNotes");

      // Tagged on the team, the designer reads them.
      await edit(client, as(ids.sales), lead.leadId, ids, { team: [{ role: "designer", membershipId: ids.designerMember }] });
      expect((await notesFor(ids.designer))[0]).toBe("VIP, calls after 6pm");

      // Everyone with Sales access, once the firm chooses it (version-checked, audited).
      const settings = await as(ids.admin).leads.salesSettings(actor, ids.workspaceId);
      expect(settings.internalNotesVisibility).toBe("team");
      await expect(as(ids.admin).leads.updateSalesSettings(actor, ids.workspaceId, { version: settings.version + 1, internalNotesVisibility: "sales" })).rejects.toThrow("Sales settings changed");
      await as(ids.admin).leads.updateSalesSettings(actor, ids.workspaceId, { version: settings.version, internalNotesVisibility: "sales" });
      expect((await notesFor(ids.sales2))[0]).toBe("VIP, calls after 6pm");
    });
  });

  it("keeps each workspace's team and requirements to itself (forced RLS), and refuses a stale enquiry edit", async () => {
    await scenario(async (client, ids, as) => {
      const lead = await create(as(ids.sales), ids, { team: [{ role: "designer", membershipId: ids.designerMember }] });
      await require(as(ids.admin), ids, "address", "full_id", "convert");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.otherWorkspaceId]);
      await client.query("SET LOCAL ROLE wodana_app");
      expect((await client.query("SELECT count(*)::int AS n FROM crm_lead_team WHERE lead_id = $1", [lead.leadId])).rows[0].n).toBe(0);
      expect((await client.query("SELECT count(*)::int AS n FROM crm_enquiry_requirements")).rows[0].n).toBe(0);
      await client.query("SAVEPOINT other_tenant");
      await expect(client.query("INSERT INTO crm_enquiry_requirements(workspace_id,enquiry_type,field_key,required_at) VALUES($1,'full_id','email','convert')", [ids.workspaceId])).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");
      await client.query("RESET ROLE");
      await expect(as(ids.admin).leads.get(actor, ids.otherWorkspaceId, lead.leadId)).rejects.toThrow();

      const version = Number((await leadRow(client, lead.leadId)).version);
      await edit(client, as(ids.sales), lead.leadId, ids, { details: { budgetRange: "not_sure" } });
      await expect(as(ids.sales).intake.updateDetails(actor, ids.workspaceId, lead.leadId, { version, serviceType: "full_id", party: { displayName: "Layla Haddad", mobile: "+971501112233" }, details: { emirate: "dubai" } } as never))
        .rejects.toThrow("Lead changed; reload before saving");
    });
  });
});

