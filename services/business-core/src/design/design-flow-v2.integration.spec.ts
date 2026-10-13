import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalStatus, decideApproval } from "../approvals/approval-engine.api";
import { APPROVAL_OUTCOMES } from "../approvals/approval-outcomes";
import { OpportunityDiscoveryService } from "../crm/opportunities/discovery.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { designStageSource } from "../reminders/sources/designs";
import { readDesignEntries } from "../team-calendars/team-calendars.store";
import { workspaceClock } from "../team-calendars/workspace-clock";
import { DesignDecisionsService } from "./design-decisions.service";
import { DesignJourneyService } from "./design-journey.service";
import { processDesignDeadlines, samplesApprovedAt, startJourney } from "./design-journey.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the app role
// (wodana_app, forced RLS) in its own committed transaction, as the person named, with only the permissions given.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type People = Record<"ops" | "am" | "lead" | "junior" | "admin" | "visualiser" | "draftsman" | "techLead" | "coordinator" | "director", { user: string; member: string }>;
type Seed = { workspaceId: string; caseId: string; opportunityId: string; packages: Record<"bespoke" | "concept" | "director", string>; people: People };

const ALL = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs", "pre_projects.record_client_design_decisions", "pre_projects.manage_lifecycle"];
const DESIGNER = ["pre_projects.view", "pre_projects.edit", "pre_projects.record_client_design_decisions"];
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("the design order of 13 Oct 2026 (PLM-139–145, PLM-151, PLM-152, PLM-154)", { timeout: 120_000 }, () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
  });
  afterAll(async () => { await pool.end(); });

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async function seed(packageCode: "bespoke" | "concept" | "director"): Promise<Seed> {
    const workspaceId = randomUUID(), caseId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID();
    const names = { ops: "Omar Ops", am: "Aisha AM", lead: "Lina Lead", junior: "Jad Junior", admin: "Sara Sales Admin", visualiser: "Vik Visualiser", draftsman: "Dev Draftsman",
      techLead: "Tara Technical Lead", coordinator: "Mona Materials", director: "Cece Creative" } as const;
    const people = Object.fromEntries(Object.keys(names).map((key) => [key, { user: randomUUID(), member: randomUUID() }])) as People;
    const packages = { bespoke: randomUUID(), concept: randomUUID(), director: randomUUID() };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [key, name] of Object.entries(names))
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key as keyof People].user, `${people[key as keyof People].user.slice(0, 8)}@example.com`, name]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `v2-${workspaceId.slice(0, 8)}`, people.ops.user]);
      for (const person of Object.values(people)) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [person.member, workspaceId, person.user]);
      // Workspace roles: the technical lead tags the Draftsman; the Creative Director reviews (and signs outsourced materials off); the Material Coordinator collects samples.
      for (const [code, who, permission] of [["technical_lead", people.techLead, null], ["creative_director", people.director, "pre_projects.review_designs"], ["material_coordinator", people.coordinator, null]] as const) {
        const role = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [role, workspaceId, code]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, who.member, role]);
        if (permission) await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = $3", [workspaceId, role, permission]);
      }
      await client.query("INSERT INTO workspace_project_settings(workspace_id, roles) VALUES($1, $2::jsonb)", [workspaceId, JSON.stringify([
        { key: "account_manager", label: "Account manager" }, { key: "designer", label: "Lead Interior Designer" }, { key: "junior_designer", label: "Junior Interior Designer" },
        { key: "sales_admin", label: "Sales Admin" }, { key: "visualiser", label: "Visualiser" }, { key: "draftsman", label: "Draftsman" }, { key: "material_coordinator", label: "Material Coordinator" },
        { key: "project_manager", label: "Project manager" }])]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), people.am.member]);
      await client.query(`INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,area_unit,includes_space_planning,includes_renders,included_revisions,review_role_code,rate_from,unit_definition) VALUES
        ($1,$4,'bespoke','Bespoke Interior Design','per_area',40,'AED','sqft',true,true,2,null,false,null),
        ($2,$4,'concept','Concept Package','per_space',10000,'AED',null,true,false,2,null,false,'1 space = 1 room with a door'),
        ($3,$4,'creative_director','Designed by the Creative Director','per_area',100,'AED','sqft',true,true,2,'creative_director',true,null)`,
        [packages.bespoke, packages.concept, packages.director, workspaceId]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id,area,area_unit) VALUES($1,$2,$3,2000,'sqft')", [workspaceId, opportunityId, packages[packageCode]]);
      await client.query(`INSERT INTO workspace_design_settings(workspace_id,inspiration_days,site_visit_questions,concept_options_max) VALUES($1,7,$2,2)`, [workspaceId, JSON.stringify([
        { key: "access", question: "How do we get in?" }, { key: "family", question: "How big is the family?", scope: "Kitchen" }, { key: "beds", question: "Bed sizes?", scope: "Bedrooms" }])]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.ops.user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Main kitchen')", [randomUUID(), workspaceId, caseId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("COMMIT");
    } finally { client.release(); }
    await asApp(workspaceId, people.ops.user, (client) => startJourney(client, workspaceId, caseId, people.ops.user));
    return { workspaceId, caseId, opportunityId, packages, people };
  }

  /** Staff services as one person with a set of permissions; anything else is refused like the real access guard. */
  function as(ids: Seed, who: keyof People, permissions: string[]) {
    const userId = ids.people[who].user;
    const access = {
      withPermission: (_actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => access.withPermissions(_actor, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!required.every((permission) => permissions.includes(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId }));
      },
      withAnyPermission: (_actor: unknown, workspaceId: string, any: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) =>
        access.withPermissions(_actor, workspaceId, [any.find((permission) => permissions.includes(permission)) ?? any[0]], work),
      hasPermission: async (_client: unknown, _workspaceId: string, _user: string, permission: string) => permissions.includes(permission),
    };
    return { journey: new DesignJourneyService(access as never), decisions: new DesignDecisionsService(access as never), discovery: new OpportunityDiscoveryService(access as never) };
  }
  const sql = <T extends Record<string, unknown> = Record<string, unknown>>(ids: Seed, text: string, values: unknown[] = []) => asApp(ids.workspaceId, ids.people.ops.user, async (client) => (await client.query<T>(text, values)).rows);
  const told = async (ids: Seed, code: string) => (await sql<{ recipient: string }>(ids, `SELECT DISTINCT recipient_id AS recipient FROM notifications WHERE workspace_id = $1 AND event_type::text IN ($2::text, regexp_replace($2::text, '_booked$', '.booked')) AND channel = 'in_app' ORDER BY 1`,
    [ids.workspaceId, code])).map((row) => row.recipient);
  const stageRow = (view: { stages: Array<{ stage: string }> }, stage: string) => view.stages.find((row) => row.stage === stage) as unknown as { status: string; version: number; dueAt: string | Date; clientDueAt: string | Date | null; ownerName: string | null; outcome: string | null };
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  /** A booked meeting moved into the past, as if it took place. */
  const held = (ids: Seed, stage: string) => sql(ids, `UPDATE crm_appointments appointment SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'
    FROM design_journey_stages stage WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = $3 AND appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id`,
    [ids.workspaceId, ids.caseId, stage]);
  const asset = async (ids: Seed) => {
    const id = randomUUID();
    await sql(ids, "INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'signed.pdf','application/pdf',1,$5,repeat('a',64),$4)",
      [id, ids.workspaceId, ids.caseId, ids.people.lead.user, `k-${id}`]);
    return id;
  };
  const team = (lead: string, extra: Array<{ slot: string; membershipId?: string | null; notApplicable?: boolean }> = []) => [{ slot: "lead_designer", membershipId: lead }, ...extra];

  it("runs a Bespoke job from the fee to the design approval: team, kick-off, concept with the site measure, renders and their sign-off, samples", async () => {
    const ids = await seed("bespoke");
    const ops = as(ids, "ops", ALL), am = as(ids, "am", ["pre_projects.view"]), lead = as(ids, "lead", DESIGNER), junior = as(ids, "junior", DESIGNER);
    let view = await ops.journey.get(actor, ids.workspaceId, ids.caseId);
    expect(view.stages.map((row) => [row.stage, row.status])).toEqual([["inspiration", "active"], ["kickoff", "locked"], ["concepts", "locked"], ["renders", "locked"], ["samples", "locked"], ["approval", "locked"]]);
    expect(view.journey).toMatchObject({ flowVersion: 2 });
    // PLM-151: the fee is paid, so the Account Manager is asked to allocate the team.
    expect(view.tasks.map((task) => [task.task, task.status, task.ownerName])).toEqual([["team_allocation", "open", "Aisha AM"]]);
    expect(await told(ids, "design.team_to_allocate")).toEqual([ids.people.am.user]);
    expect(view.team?.missing).toEqual(["lead_designer", "junior_designer", "sales_admin"]);
    // The Account Manager picks from the workspace's people without the People module's permission; someone who sets nothing gets no list.
    expect((await am.journey.get(actor, ids.workspaceId, ids.caseId)).team?.candidates.map((person) => person.displayName)).toEqual(expect.arrayContaining(["Jad Junior", "Sara Sales Admin"]));
    expect((await junior.journey.get(actor, ids.workspaceId, ids.caseId)).team?.candidates).toEqual([]);

    // Inspiration closes; the kick-off can't be booked before the lead designer is allocated.
    view = await ops.journey.closeInspiration(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "inspiration").version });
    await expect(lead.journey.scheduleKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, startsAt: future(1), endsAt: future(1.05), timezone: "Asia/Dubai" }))
      .rejects.toThrow("Allocate the lead designer first");

    // Only the Account Manager (or an admin) allocates; someone else on the job can't.
    const version = () => am.journey.get(actor, ids.workspaceId, ids.caseId).then((current) => current.journey!.version as number);
    await expect(junior.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: team(ids.people.junior.member) })).rejects.toThrow(/can't set/);
    view = await am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: team(ids.people.lead.member, [
      { slot: "junior_designer", membershipId: ids.people.junior.member }, { slot: "sales_admin", membershipId: ids.people.admin.member }]) });
    expect(view.tasks.find((task) => task.task === "team_allocation")?.status).toBe("done");
    expect(view.team?.missing).toEqual([]);
    expect(stageRow(view, "kickoff").ownerName).toBe("Lina Lead");
    expect((await sql(ids, "SELECT membership_id FROM crm_opportunity_designer WHERE workspace_id = $1 AND opportunity_id = $2", [ids.workspaceId, ids.opportunityId]))[0].membership_id).toBe(ids.people.lead.member);
    expect(await told(ids, "design.team_allocated")).toEqual([ids.people.lead.user, ids.people.junior.user, ids.people.admin.user].sort());
    // A replay changes nothing; changing an allocated designer needs a reason, which the history keeps.
    await expect(am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: (await version()) - 1, roles: team(ids.people.junior.member) })).rejects.toThrow(/another window/);
    await expect(am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: team(ids.people.junior.member) })).rejects.toThrow("Give a reason for changing the designer");
    await am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: team(ids.people.junior.member), reason: "Lina is on leave" });
    view = await am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: team(ids.people.lead.member), reason: "Lina is back" });
    const history = await sql<{ reason: string }>(ids, "SELECT reason FROM crm_opportunity_designer_history WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY changed_at", [ids.workspaceId, ids.opportunityId]);
    expect(history.map((row) => row.reason)).toEqual(["Allocated as the lead designer", "Lina is on leave", "Lina is back"]);
    // The Account Manager doesn't tag the Visualiser: the lead designer does.
    await expect(am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: await version(), roles: [{ slot: "visualiser", membershipId: ids.people.visualiser.member }] })).rejects.toThrow(/can't set/);

    // PLM-140: the kick-off, booked and held, with the render sign-off date agreed there.
    view = await lead.journey.scheduleKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, startsAt: future(1), endsAt: future(1.05), timezone: "Asia/Dubai", address: "Villa 12" });
    expect(await told(ids, "design.kickoff_booked")).toEqual([ids.people.am.user, ids.people.junior.user].sort());
    await expect(lead.journey.completeKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, renderSignoffOn: day(40) })).rejects.toThrow("The kick-off meeting hasn't taken place yet");
    // PLM-154: the question list is used at the kick-off too; its answers carry on into the site measure.
    view = await lead.journey.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, answers: [{ key: "access", answer: "Service lift" }] });
    await held(ids, "kickoff");
    await expect(lead.journey.completeKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version })).rejects.toThrow("Enter the render sign-off date agreed with the client");
    view = await lead.journey.completeKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, renderSignoffOn: day(40) });
    expect(view.journey).toMatchObject({ renderSignoffDueOn: day(40) });
    const concept = stageRow(view, "concepts");
    expect(concept.status).toBe("active");
    // The first concept a week after the meeting; the client was promised the development window (1 room: the 14-day minimum).
    expect(Math.round((new Date(concept.dueAt).getTime() - Date.now()) / 3_600_000)).toBe(7 * 24 - 2);
    expect(Math.round((new Date(concept.clientDueAt!).getTime() - Date.now()) / 3_600_000)).toBe(14 * 24 - 2);
    // PLM-141: the design site measure opens beside it, due 3 days after the kick-off, for the lead and the junior.
    const measure = view.tasks.find((task) => task.task === "site_measure")!;
    expect(measure).toMatchObject({ status: "open", ownerName: "Lina Lead" });
    expect(Math.round((new Date(measure.dueAt!).getTime() - Date.now()) / 3_600_000)).toBe(3 * 24 - 2);
    expect(view.siteVisit).toMatchObject({ within: "task", open: true });
    expect(await told(ids, "design.site_measure_due")).toEqual([ids.people.lead.user, ids.people.junior.user].sort());

    // PLM-142: two concept options at most; the client's choice waits for the site measure.
    const options = (count: number) => Array.from({ length: count }, (_, index) => ({ id: randomUUID(), title: `Option ${index + 1}`, linkUrl: `https://www.canva.com/design/${index}` }));
    await expect(lead.decisions.createPresentation(actor, ids.workspaceId, ids.caseId, { id: randomUUID(), stage: "concepts", options: options(3) })).rejects.toThrow("Show at most 2 concept options");
    const round = { id: randomUUID(), stage: "concepts", options: options(2) };
    await lead.decisions.createPresentation(actor, ids.workspaceId, ids.caseId, round);
    let presented = await lead.decisions.present(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 });
    const shown = presented.presentations[0];
    const decided = await lead.decisions.decide(actor, ids.workspaceId, ids.caseId, round.id, { version: shown.version, decision: "chosen", optionId: shown.options[0].id, source: "meeting", decidedBy: "Maya Client" });
    expect(decided.completed).toBe(false);
    expect(stageRow(await lead.journey.get(actor, ids.workspaceId, ids.caseId), "concepts").status).toBe("active");

    // PLM-141/154: the junior measures; the kitchen's questions apply (the job has a kitchen), the bedrooms' don't.
    view = await junior.journey.get(actor, ids.workspaceId, ids.caseId);
    expect(view.checklistGroups.map((group) => [group.scope, group.required])).toEqual([[null, true], ["Kitchen", true], ["Bedrooms", false]]);
    const room = (await sql<{ id: string }>(ids, "SELECT id FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2", [ids.workspaceId, ids.caseId]))[0].id;
    await sql(ids, `INSERT INTO pre_project_site_records(id,workspace_id,case_id,kind,room_id,title,status,version,content,created_by,updated_by) VALUES($1,$2,$3,'measurement',$4,'Kitchen wall','measured',1,$5,$6,$6)`,
      [randomUUID(), ids.workspaceId, ids.caseId, room, JSON.stringify({ assetIds: [randomUUID()] }), ids.people.junior.user]);
    await expect(junior.journey.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: view.siteVisit!.version, summary: "Measured" })).rejects.toThrow("Answer the last site visit question");
    view = await junior.journey.answerSiteVisit(actor, ids.workspaceId, ids.caseId, { version: view.siteVisit!.version, answers: [{ key: "family", answer: "Five, cooks daily" }] });
    expect(view.siteChecklistProblem).toBeNull();
    view = await junior.journey.completeSiteVisit(actor, ids.workspaceId, ids.caseId, { version: view.siteVisit!.version, summary: "Every wall measured" });
    // The concept the client already chose completes now; renders start.
    expect(view.tasks.find((task) => task.task === "site_measure")).toMatchObject({ status: "done", completedByName: "Jad Junior" });
    expect([stageRow(view, "concepts").status, stageRow(view, "concepts").outcome, stageRow(view, "renders").status]).toEqual(["done", "chosen", "active"]);

    // PLM-143: the lead tags the Visualiser, the technical lead the Draftsman; the client-facing date is the one agreed at the kick-off.
    expect(new Date(stageRow(view, "renders").clientDueAt!).toISOString().slice(0, 10)).toBe(day(40));
    await expect(lead.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: [{ slot: "draftsman", membershipId: ids.people.draftsman.member }] })).rejects.toThrow(/can't set/);
    view = await lead.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: [{ slot: "visualiser", membershipId: ids.people.visualiser.member }] });
    view = await as(ids, "techLead", ["pre_projects.view"]).journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: [{ slot: "draftsman", membershipId: ids.people.draftsman.member }] });
    expect(await told(ids, "design.render_tagged")).toEqual([ids.people.visualiser.user, ids.people.draftsman.user].sort());
    // Render time is set per job.
    view = await lead.journey.setDeadline(actor, ids.workspaceId, ids.caseId, "renders", { version: stageRow(view, "renders").version, dueOn: day(20) });
    await expect(lead.journey.setDeadline(actor, ids.workspaceId, ids.caseId, "renders", { version: stageRow(view, "renders").version, dueOn: day(-2) })).rejects.toThrow("Choose today or a later day");
    // The client's render sign-off (date and file) ends the renders; samples start with the Material Coordinator.
    const signed = await asset(ids);
    await expect(lead.journey.recordRenderSignOff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "renders").version, signedOn: day(0), signer: "Maya Client", assetId: randomUUID() }))
      .rejects.toThrow("Attach the client's render sign-off");
    view = await lead.journey.recordRenderSignOff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "renders").version, signedOn: day(0), signer: "Maya Client", assetId: signed });
    expect([stageRow(view, "renders").outcome, stageRow(view, "samples").status]).toEqual(["render_signed_off", "active"]);
    expect(view.journey).toMatchObject({ renderSignedOn: day(0), renderSignoffSigner: "Maya Client", renderSignoffAssetName: "signed.pdf" });
    expect(view.tasks.find((task) => task.task === "sample_collection")).toMatchObject({ status: "open", ownerName: "Mona Materials" });
    expect(await told(ids, "design.samples_to_collect")).toEqual([ids.people.coordinator.user]);

    // PLM-144: samples collected by the Material Coordinator (someone else without edit rights can't), then the sample meeting.
    await expect(lead.journey.approveSamples(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "samples").version })).rejects.toThrow("Collect the samples first");
    const collection = () => lead.journey.get(actor, ids.workspaceId, ids.caseId).then((current) => current.tasks.find((task) => task.task === "sample_collection")!.version);
    await expect(as(ids, "visualiser", ["pre_projects.view"]).journey.completeSampleCollection(actor, ids.workspaceId, ids.caseId, { version: await collection() })).rejects.toThrow(/person collecting/);
    view = await as(ids, "coordinator", ["pre_projects.view"]).journey.completeSampleCollection(actor, ids.workspaceId, ids.caseId, { version: await collection(), note: "Own stock, two brands" });
    expect(await told(ids, "design.samples_collected")).toEqual([ids.people.lead.user]);
    view = await lead.journey.scheduleMaterialSelection(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "samples").version, startsAt: future(2), endsAt: future(2.05), timezone: "Asia/Dubai",
      address: "Villa 12", atClientHome: true });
    expect(await told(ids, "design.sample_meeting_booked")).toEqual([ids.people.am.user, ids.people.junior.user, ids.people.coordinator.user].sort());
    await held(ids, "samples");
    // Own stock confirmed; a local supplier's material needs the Creative Director's sign-off before it counts.
    const said = new Date(Date.now() - 60_000).toISOString();
    await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, { id: randomUUID(), versionId: randomUUID(), kind: "material", title: "Oak veneer", source: "showroom", saidAt: said });
    await lead.decisions.addEntry(actor, ids.workspaceId, ids.caseId, { id: randomUUID(), versionId: randomUUID(), kind: "material", title: "Onyx slab", supplier: "Local stone", quantity: "2", unitPrice: "1500",
      source: "showroom", saidAt: said, outsourced: true });
    let ledger = await lead.decisions.ledger(actor, ids.workspaceId, ids.caseId);
    for (const entry of ledger.entries) await lead.decisions.recordDecision(actor, ids.workspaceId, ids.caseId, entry.id, entry.current!.id, { decision: "confirmed", method: "in_person", decidedBy: "Maya Client" });
    ledger = await lead.decisions.ledger(actor, ids.workspaceId, ids.caseId);
    const onyx = ledger.entries.find((entry) => entry.title === "Onyx slab")!;
    expect(onyx.current).toMatchObject({ outsourced: true, signOff: "pending" });
    expect(ledger.lockProblem).toBe("Waiting for the sign-off of the outsourced material: Onyx slab");
    view = await lead.journey.get(actor, ids.workspaceId, ids.caseId);
    await expect(lead.journey.approveSamples(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "samples").version })).rejects.toThrow("Waiting for the sign-off of the outsourced material: Onyx slab");
    const request = (await asApp(ids.workspaceId, ids.people.director.user, (client) => approvalStatus(client, ids.workspaceId, "outsourced_material", onyx.current!.id)))!;
    expect(request).toMatchObject({ status: "pending", amount: "3000", currency: "AED" });
    await asApp(ids.workspaceId, ids.people.director.user, (client) => decideApproval(client, { workspaceId: ids.workspaceId, requestId: request.id, deciderUserId: ids.people.director.user, decision: "approve", notify: false }));
    view = await lead.journey.approveSamples(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "samples").version });
    expect([stageRow(view, "samples").outcome, stageRow(view, "approval").status]).toEqual(["samples_approved", "active"]);
    // The fact the later steps (finishes for QS, value engineering, procurement) read.
    expect(await asApp(ids.workspaceId, ids.people.ops.user, (client) => samplesApprovedAt(client, ids.workspaceId, ids.caseId))).toBeInstanceOf(Date);
  });

  it("ends a Concept package's design with samples after the concept: no renders, no render date at the kick-off", async () => {
    const ids = await seed("concept");
    const ops = as(ids, "ops", ALL), lead = as(ids, "lead", DESIGNER);
    let view = await ops.journey.get(actor, ids.workspaceId, ids.caseId);
    expect(view.stages.map((row) => row.stage)).toEqual(["inspiration", "kickoff", "concepts", "samples", "approval"]);
    view = await ops.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: team(ids.people.lead.member, [
      { slot: "junior_designer", notApplicable: true }, { slot: "sales_admin", membershipId: ids.people.admin.member }]) });
    expect(view.tasks.find((task) => task.task === "team_allocation")?.status).toBe("done");
    view = await ops.journey.closeInspiration(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "inspiration").version });
    view = await lead.journey.scheduleKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version, startsAt: future(1), endsAt: future(1.05), timezone: "Asia/Dubai" });
    await held(ids, "kickoff");
    view = await lead.journey.completeKickoff(actor, ids.workspaceId, ids.caseId, { version: stageRow(view, "kickoff").version });
    expect(view.journey).toMatchObject({ renderSignoffDueOn: null });
    // The site measure, then the concept's files approved: samples follow straight away.
    await sql(ids, "UPDATE design_journey_tasks SET status = 'done', completed_at = now() WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure'", [ids.workspaceId, ids.caseId]);
    const round = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: "Warm", linkUrl: "https://www.canva.com/design/warm" }] };
    await lead.decisions.createPresentation(actor, ids.workspaceId, ids.caseId, round);
    const shown = (await lead.decisions.present(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 })).presentations[0];
    expect((await lead.decisions.decide(actor, ids.workspaceId, ids.caseId, round.id, { version: shown.version, decision: "chosen", optionId: shown.options[0].id, source: "meeting", decidedBy: "Maya" })).completed).toBe(true);
    view = await lead.journey.get(actor, ids.workspaceId, ids.caseId);
    expect(stageRow(view, "samples").status).toBe("active");
  });

  it("lets only the Creative Director choose the lead and approve rounds on their package; an agreed rate above it waits for them (PLM-139, PLM-145)", async () => {
    const ids = await seed("director");
    const am = as(ids, "am", ["pre_projects.view"]), director = as(ids, "director", ["pre_projects.view", "pre_projects.review_designs"]), lead = as(ids, "lead", DESIGNER);
    let view = await am.journey.get(actor, ids.workspaceId, ids.caseId);
    // The reviewer is told to choose the lead; the Account Manager the rest.
    expect(await told(ids, "design.team_to_allocate")).toEqual([ids.people.am.user, ids.people.director.user].sort());
    expect(view.team?.slots.filter((slot) => slot.canSet).map((slot) => slot.slot)).toEqual(["junior_designer", "sales_admin", "material_coordinator"]);
    await expect(am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: team(ids.people.lead.member) })).rejects.toThrow(/can't set/);
    view = await director.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: team(ids.people.lead.member) });
    expect(view.team?.slots.find((slot) => slot.slot === "lead_designer")?.member?.membershipId).toBe(ids.people.lead.member);

    // Rounds wait for the Creative Director before the client sees them.
    await sql(ids, `UPDATE design_journey_stages SET status = CASE WHEN stage IN ('inspiration', 'kickoff') THEN 'done' WHEN stage = 'concepts' THEN 'active' ELSE status END,
      completed_at = CASE WHEN stage IN ('inspiration', 'kickoff') THEN now() END WHERE workspace_id = $1 AND case_id = $2`, [ids.workspaceId, ids.caseId]);
    const round = { id: randomUUID(), stage: "concepts", options: [{ id: randomUUID(), title: "Gallery", linkUrl: "https://www.canva.com/design/gallery" }] };
    await lead.decisions.createPresentation(actor, ids.workspaceId, ids.caseId, round);
    expect(await told(ids, "design.presentation_to_review")).toEqual([ids.people.director.user]);
    await expect(lead.decisions.present(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 })).rejects.toThrow(/approves this presentation before the client sees it/);
    await expect(lead.decisions.review(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 })).rejects.toThrow(/reviewer approves/);
    const reviewed = await director.decisions.review(actor, ids.workspaceId, ids.caseId, round.id, { version: 1 });
    expect(reviewed.presentations[0]).toMatchObject({ reviewedByName: "Cece Creative" });
    expect(await told(ids, "design.presentation_reviewed")).toEqual([ids.people.lead.user]);
    const shown = await lead.decisions.present(actor, ids.workspaceId, ids.caseId, round.id, { version: 2 });
    expect(shown.presentations[0].status).toBe("presented");

    // PLM-139: "from 100 per sq ft": 125 agreed with the client keeps the fee at 100 until the Creative Director approves it.
    const sales = as(ids, "am", ["crm.opportunities.view", "crm.opportunities.manage"]);
    const discovery = await sales.discovery.get(actor, ids.workspaceId, ids.opportunityId);
    let saved = await sales.discovery.save(actor, ids.workspaceId, ids.opportunityId, { version: discovery.version, designRate: "125" });
    expect(saved.designFee).toEqual({ amount: "200000.00", currency: "AED" });
    expect(saved.designRate).toMatchObject({ requested: "125.00", rate: "100.00", approval: "pending" });
    const request = (await asApp(ids.workspaceId, ids.people.director.user, (client) => approvalStatus(client, ids.workspaceId, "design_rate", ids.opportunityId)))!;
    expect(request).toMatchObject({ status: "pending", amount: "250000", currency: "AED" });
    await asApp(ids.workspaceId, ids.people.director.user, async (client) => {
      const after = await decideApproval(client, { workspaceId: ids.workspaceId, requestId: request.id, deciderUserId: ids.people.director.user, decision: "approve", notify: false });
      await APPROVAL_OUTCOMES.design_rate!(client, ids.workspaceId, after, "approve", ids.people.director.user, null);
    });
    saved = await sales.discovery.get(actor, ids.workspaceId, ids.opportunityId);
    expect(saved.designFee).toEqual({ amount: "250000.00", currency: "AED" });
    expect(saved.designRate).toMatchObject({ rate: "125.00", approval: "approved" });
    // Back at the package's rate, nothing waits.
    saved = await sales.discovery.save(actor, ids.workspaceId, ids.opportunityId, { version: saved.version, designRate: null });
    expect([saved.designFee?.amount, saved.designRate]).toEqual(["200000.00", null]);
  });

  it("leaves the lead designer to the Account Manager when nobody holds the package's review role", async () => {
    const ids = await seed("director");
    await sql(ids, "DELETE FROM member_roles WHERE workspace_id = $1 AND membership_id = $2", [ids.workspaceId, ids.people.director.member]);
    const am = as(ids, "am", ["pre_projects.view"]);
    const view = await am.journey.get(actor, ids.workspaceId, ids.caseId);
    expect(view.team?.slots.find((slot) => slot.slot === "lead_designer")?.canSet).toBe(true);
    await am.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: team(ids.people.lead.member) });
  });

  it("keeps a journey started in the old order on its own steps, with its site visit as a stage and no team to allocate", async () => {
    const ids = await seed("bespoke");
    await sql(ids, "DELETE FROM design_journeys WHERE workspace_id = $1 AND case_id = $2", [ids.workspaceId, ids.caseId]);
    await asApp(ids.workspaceId, ids.people.ops.user, (client) => startJourney(client, ids.workspaceId, ids.caseId, ids.people.ops.user, { flow: 1 }));
    const view = await as(ids, "ops", ALL).journey.get(actor, ids.workspaceId, ids.caseId);
    expect(view.journey).toMatchObject({ flowVersion: 1 });
    expect(view.stages.map((row) => row.stage)).toEqual(["inspiration", "site_visit", "concepts", "space_planning", "material_selection", "renders", "approval"]);
    expect(view.tasks).toEqual([]);
    expect(view.siteVisit).toMatchObject({ within: "stage", open: false });
  });

  it("puts the new steps on the design calendar and chases them through the reminder engine (PLM-152)", async () => {
    const ids = await seed("bespoke");
    const ops = as(ids, "ops", ALL);
    await sql(ids, "UPDATE design_journey_tasks SET due_at = now() - interval '1 day' WHERE workspace_id = $1 AND case_id = $2 AND task = 'team_allocation'", [ids.workspaceId, ids.caseId]);
    const entries = await asApp(ids.workspaceId, ids.people.ops.user, async (client) => readDesignEntries(client, ids.workspaceId, day(-3), day(10), await workspaceClock(client, ids.workspaceId)));
    expect(entries.find((entry) => entry.key === `task:${ids.caseId}:team_allocation`)).toMatchObject({ kind: "design_deadline", detail: "team_allocation", overdue: true, ownerName: "Aisha AM" });
    const due = await asApp(ids.workspaceId, ids.people.ops.user, (client) => designStageSource.open(client, ids.workspaceId, { now: new Date(), limit: 50 } as never));
    expect(due.find((item) => item.key === `design_task:${ids.caseId}:team_allocation`)).toMatchObject({ title: "Design team", ownerMembershipId: ids.people.am.member });
    expect([...await asApp(ids.workspaceId, ids.people.ops.user, (client) => designStageSource.stillOpen(client, ids.workspaceId, [`design_task:${ids.caseId}:team_allocation`]))])
      .toEqual([`design_task:${ids.caseId}:team_allocation`]);
    // Overdue once in its history; done, it leaves the reminders.
    expect((await asApp(ids.workspaceId, ids.people.ops.user, (client) => processDesignDeadlines(client, ids.workspaceId))).alerted).toBe(1);
    const view = await ops.journey.get(actor, ids.workspaceId, ids.caseId);
    await ops.journey.setTeam(actor, ids.workspaceId, ids.caseId, { version: view.journey!.version as number, roles: team(ids.people.lead.member, [
      { slot: "junior_designer", notApplicable: true }, { slot: "sales_admin", notApplicable: true }]) });
    expect([...await asApp(ids.workspaceId, ids.people.ops.user, (client) => designStageSource.stillOpen(client, ids.workspaceId, [`design_task:${ids.caseId}:team_allocation`]))]).toEqual([]);
  });
});
