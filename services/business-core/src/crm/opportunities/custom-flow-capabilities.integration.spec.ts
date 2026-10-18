import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { flowChecksum } from "../flows/flow-definition";
import { STARTER_FLOWS } from "../flows/starter-flows";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { OpportunityDiscoveryService } from "./discovery.service";
import { flowSummary, loadFlowFacts, pipelineStages } from "./flow-facts";
import { IntroMeetingService } from "./intro-meeting.service";
import { hasDesignRound, wonProposalKind } from "./opportunity-proposals";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Job = {
  workspaceId: string; opportunityId: string; designer: string; stage: Record<string, string>; packageId: string; floorPlanId: string;
  opportunities: CrmOpportunitiesService; intro: IntroMeetingService; discovery: OpportunityDiscoveryService;
};

/**
 * An enquiry type with its own flow (a copy of the design or fit-out starter under the workspace's own code, as the
 * QA-002 repair builds them: interior_design_furniture, full_fit_out) does what the starter does: the intro is booked,
 * the design package chosen, the design fee proposal is there, and the opportunity qualifies. Decided by the flow's
 * steps, never by its code.
 */
integration("an enquiry type's own flow keeps its starter's features", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withJob(starter: "design" | "fit_out", code: string, work: (client: PoolClient, job: Job) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), amUser = randomUUID(), designerUser = randomUUID(), am = randomUUID(), designer = randomUUID();
    const taxonomyId = randomUUID(), optionId = randomUUID(), flowId = randomUUID(), pipelineId = randomUUID(), partyId = randomUUID();
    const enquiryId = randomUUID(), leadId = randomUUID(), opportunityId = randomUUID(), packageId = randomUUID(), floorPlanId = randomUUID();
    const stage: Record<string, string> = Object.fromEntries(["qualified", "qualification", "proposal", "negotiation", "won", "lost"].map((key) => [key, randomUUID()]));
    const definition = structuredClone(STARTER_FLOWS[starter].definition);
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Aisha AM'),($3,$4,'Dana Designer')",
        [amUser, `am-${amUser.slice(0, 8)}@example.com`, designerUser, `d-${designerUser.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Europe/London',$3)",
        [workspaceId, `own-flow-${workspaceId.slice(0, 8)}`, amUser]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$3,$4,'active'),($2,$3,$5,'active')", [am, designer, workspaceId, amUser, designerUser]);
      // The enquiry type points at the workspace's own flow (its own code), a copy of the starter's steps.
      await client.query("INSERT INTO crm_taxonomies(id,workspace_id,code,name) VALUES($1,$2,'enquiry_type','Enquiry types')", [taxonomyId, workspaceId]);
      await client.query("INSERT INTO crm_taxonomy_options(id,workspace_id,taxonomy_id,code,label,flow) VALUES($1,$2,$3,$4,'Own type',$4)", [optionId, workspaceId, taxonomyId, code]);
      await client.query("INSERT INTO crm_flows(id,workspace_id,code,name,enquiry_type_option_id) VALUES($1,$2,$3,'Own type',$4)", [flowId, workspaceId, code, optionId]);
      await client.query("INSERT INTO crm_flow_versions(workspace_id,flow_id,version,definition,checksum,source) VALUES($1,$2,1,$3::jsonb,$4,'starter')",
        [workspaceId, flowId, JSON.stringify(definition), flowChecksum(definition)]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      for (const [index, key] of Object.keys(stage).entries())
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES($1,$2,$3,$4,$4,$5,10)", [stage[key], workspaceId, pipelineId, key, index + 1]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Yasmin','yasmin')", [partyId, workspaceId]);
      // A real intake event, so saving the enquiry later passes its cross-workspace check.
      const intakeId = randomUUID();
      await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
        VALUES($1,$2,'referral','external','manual',$3,repeat('c',64),'{}',$1,now())`, [intakeId, workspaceId, `key-${intakeId}`]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','referral','external',now(),'E-1',$5,'{"customerType":"homeowner","targetCompletion":"2031-09-01"}')`, [enquiryId, workspaceId, intakeId, partyId, code]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [leadId, workspaceId, enquiryId, partyId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,owner_membership_id,title,reference,next_action_at,
          conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Villa','O-1',now() + interval '1 day','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`,
      [opportunityId, workspaceId, partyId, leadId, pipelineId, stage.qualified, am]);
      await client.query("INSERT INTO crm_lead_qualification_values(workspace_id,lead_id,question_key,value) VALUES($1,$2,$3,$4)",
        [workspaceId, leadId, `requirement_asset_${floorPlanId}`, JSON.stringify({ id: floorPlanId, name: "plan.pdf", mimeType: "application/pdf" })]);
      await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency) VALUES($1,$2,'bespoke','Bespoke','fixed',8000,'AED')", [packageId, workspaceId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: amUser });
      const access = { withPermission: run, withPermissions: run, hasPermission: async () => true } as never;
      const events = { record: async () => randomUUID() } as never;
      const discovery = new OpportunityDiscoveryService(access);
      await work(client, {
        workspaceId, opportunityId, designer, stage, packageId, floorPlanId, discovery,
        opportunities: new CrmOpportunitiesService(access, events, undefined, discovery), intro: new IntroMeetingService(access, events, discovery),
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const version = async (client: PoolClient, id: string) => Number((await client.query("SELECT version FROM crm_opportunities WHERE id = $1", [id])).rows[0].version);
  const summary = async (client: PoolClient, job: Job) => {
    const facts = await loadFlowFacts(client, job.workspaceId, job.opportunityId);
    const pipeline = (await client.query("SELECT pipeline_id, stage_id, status FROM crm_opportunities WHERE id = $1", [job.opportunityId])).rows[0];
    return { facts, view: flowSummary({ facts, stages: await pipelineStages(client, job.workspaceId, pipeline.pipeline_id), currentStageId: pipeline.stage_id, status: pipeline.status }) };
  };
  /** Books the intro with the designer and records it as held. */
  const holdIntro = async (client: PoolClient, job: Job) => {
    const booked = await job.intro.book(actor, job.workspaceId, job.opportunityId,
      { designerMembershipId: job.designer, mode: "in_person", startsAt: "2031-03-03T09:00:00Z", endsAt: "2031-03-03T10:00:00Z", timezone: "Europe/London" });
    expect(booked.intro).toMatchObject({ status: "pending" });
    expect(booked.designer).toMatchObject({ membershipId: job.designer, name: "Dana Designer" });
    await client.query("UPDATE crm_activities SET status = 'completed', completed_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2", [job.workspaceId, booked.intro!.activityId]);
  };
  /** §0.3 P0: the intro's outcome: going ahead with this enquiry type, by a target date. */
  const goAhead = async (client: PoolClient, job: Job, scope: string) =>
    job.opportunities.recordOutcome(actor, job.workspaceId, job.opportunityId, { version: await version(client, job.opportunityId), outcome: "proceed", scope, targetCompletion: "2031-09-01" });
  const toQualification = async (client: PoolClient, job: Job) =>
    job.opportunities.transition(actor, job.workspaceId, job.opportunityId, { version: await version(client, job.opportunityId), stageId: job.stage.qualification });

  it("a copy of the design flow under its own code: intro, design package, design fee proposal, and it qualifies", async () => {
    await withJob("design", "interior_design_furniture", async (client, job) => {
      const before = await summary(client, job);
      expect(before.view.flow).toBe("interior_design_furniture");
      expect(before.view.capabilities).toEqual({ intro: true, designPackage: true, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false });

      // The property details and the design package, on Discovery.
      await job.discovery.save(actor, job.workspaceId, job.opportunityId,
        { area: "120", areaUnit: "sqm", clientEmail: "yasmin@example.com", propertyLocation: "Villa 4, Palm", floorPlanAssetId: job.floorPlanId, designPackageId: job.packageId });
      expect((await summary(client, job)).facts.packageCode).toBe("bespoke");
      // Without the intro the opportunity can't qualify: the flow asks for it.
      await expect(toQualification(client, job)).rejects.toMatchObject({ response: { missing: [{ key: "introMeeting", label: "Intro meeting completed" },
        { key: "qualificationOutcome" }] } });

      await holdIntro(client, job);
      await goAhead(client, job, "interior_design_furniture");
      const moved = await toQualification(client, job);
      expect(moved.stage_id).toBe(job.stage.qualification);

      // Proposal 1 (the design fee) belongs to the job: a proof that names no round wins it first.
      expect(await hasDesignRound(client, job.workspaceId, job.opportunityId)).toBe(true);
      expect(wonProposalKind([], null, await hasDesignRound(client, job.workspaceId, job.opportunityId))).toBe("design");
    });
  });

  it("§0.3 P0: the intro outcome: each answer needs its own facts; needs time books the follow-up as the next action; lost closes it", async () => {
    await withJob("design", "interior_design_furniture", async (client, job) => {
      const outcome = async (input: Record<string, unknown>) => job.opportunities.recordOutcome(actor, job.workspaceId, job.opportunityId, { version: await version(client, job.opportunityId), ...input } as never);
      const missing = async (input: Record<string, unknown>) => (await outcome(input).catch((error) => error)).response?.missing?.map((item: { key: string }) => item.key);
      expect(await missing({ outcome: "proceed" })).toEqual(["scope", "targetCompletion"]);
      expect(await missing({ outcome: "proceed", scope: "not_sure", targetCompletion: "2020-01-01" })).toEqual(["scope", "targetCompletion"]);
      expect(await missing({ outcome: "proceed", scope: "castle", targetCompletion: "2031-02-30" })).toEqual(["scope", "targetCompletion"]);
      expect(await missing({ outcome: "needs_time", followUpOn: "2020-01-01" })).toEqual(["followUpOn"]);
      expect(await missing({ outcome: "lost", reason: " " })).toEqual(["reason"]);
      await expect(job.opportunities.recordOutcome(actor, job.workspaceId, job.opportunityId, { version: 999, outcome: "needs_time", followUpOn: "2031-04-01" })).rejects.toThrow("Opportunity changed");

      // Needs time: the follow-up is the next action, at 09:00 on the firm's calendar.
      const thinking = await outcome({ outcome: "needs_time", followUpOn: "2031-04-01" });
      expect(thinking).toMatchObject({ qualificationOutcome: "needs_time", qualificationScope: null });
      const task = (await client.query("SELECT title, due_at, is_next_action FROM crm_activities WHERE opportunity_id = $1 AND is_next_action", [job.opportunityId])).rows;
      expect(task).toEqual([{ title: "Follow up: the client is thinking it over", due_at: new Date("2031-04-01T08:00:00Z"), is_next_action: true }]);
      expect((await client.query("SELECT next_action_at FROM crm_opportunities WHERE id = $1", [job.opportunityId])).rows[0].next_action_at).toEqual(new Date("2031-04-01T08:00:00Z"));
      expect((await summary(client, job)).facts.qualificationProceed).toBe(false);

      // Going ahead later records the scope and the client's target date on the enquiry.
      await outcome({ outcome: "proceed", scope: "interior_design_furniture", targetCompletion: "2031-12-01" });
      const facts = (await summary(client, job)).facts;
      expect([facts.qualificationProceed, facts.targetCompletionSet]).toEqual([true, true]);
      expect((await client.query("SELECT details->>'targetCompletion' AS at FROM crm_enquiries WHERE workspace_id = $1", [job.workspaceId])).rows[0].at).toBe("2031-12-01");

      // Lost closes the opportunity with its reason, through the Lost transition.
      const lost = await outcome({ outcome: "lost", reason: "Went with another studio" });
      expect(lost).toMatchObject({ status: "lost", stageId: job.stage.lost, outcomeReason: "Went with another studio" });
      await expect(outcome({ outcome: "needs_time", followUpOn: "2031-05-01" })).rejects.toThrow("Reopen the opportunity");
    });
  });

  it("a copy of the fit-out flow under its own code: intro and qualification, no design package round", async () => {
    await withJob("fit_out", "full_fit_out", async (client, job) => {
      const before = await summary(client, job);
      expect(before.view.flow).toBe("full_fit_out");
      expect(before.view.capabilities).toEqual({ intro: true, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: true, qsPricing: true });

      await job.discovery.save(actor, job.workspaceId, job.opportunityId,
        { area: "300", areaUnit: "sqm", clientEmail: "yasmin@example.com", propertyLocation: "Villa 4, Palm", floorPlanAssetId: job.floorPlanId });
      await expect(toQualification(client, job)).rejects.toMatchObject({ response: { missing: [{ key: "introMeeting", label: "Intro meeting completed" },
        { key: "qualificationOutcome" }] } });
      await holdIntro(client, job);
      await goAhead(client, job, "full_fit_out");
      expect((await toQualification(client, job)).stage_id).toBe(job.stage.qualification);
      expect(await hasDesignRound(client, job.workspaceId, job.opportunityId)).toBe(false);
    });
  });

  it("a firm's own flow that drops the design package round shows no design fee proposal, whatever its code", async () => {
    await withJob("design", "interior_design_light", async (client, job) => {
      const definition = structuredClone(STARTER_FLOWS.design.definition);
      definition.steps = definition.steps.filter((step) => step.check !== "package_chosen" && step.key !== "design_quote");
      // The firm publishes its own version without the package round.
      await client.query(`INSERT INTO crm_flow_versions(workspace_id,flow_id,version,definition,checksum,source)
        SELECT workspace_id, flow_id, 2, $2::jsonb, $3, 'published' FROM crm_flow_versions WHERE workspace_id = $1`, [job.workspaceId, JSON.stringify(definition), flowChecksum(definition)]);
      expect((await summary(client, job)).view.capabilities).toMatchObject({ intro: true, designPackage: false });
      expect(await hasDesignRound(client, job.workspaceId, job.opportunityId)).toBe(false);
    });
  });
});
