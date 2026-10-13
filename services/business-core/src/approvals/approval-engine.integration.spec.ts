import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  amendApprovalAmount, approvalStatus, canDecideApproval, decideApproval, escalateWaitingApprovals, pendingForPerson, requestApproval,
} from "./approval-engine";
import { ensureDealApproval, decideDealStep } from "../commercial/deal-file-approval";
import { decideProposalValue, loadProposals, markProposalWon, setProposalValue } from "../crm/opportunities/opportunity-proposals";
import { loadDealClosing } from "../crm/opportunities/deal-closing";
import type { OwnerReview, Quote } from "../commercial/commercial.types";
import { waitingFor, type ApprovalContext } from "./approval-sources";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces (two connections are needed for the race); every command runs as the app role under forced RLS.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type People = { sales: string; finance: string; approver: string; approver2: string; dual: string; owner: string; cover: string; outsider: string };

integration("E3 approval engine on real Postgres (allow, deny, cross-tenant, replay, stale, race)", () => {
  let pool: Pool;
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
  const people: People = { sales: randomUUID(), finance: randomUUID(), approver: randomUUID(), approver2: randomUUID(), dual: randomUUID(), owner: randomUUID(), cover: randomUUID(), outsider: randomUUID() };
  const ids = { party: randomUUID(), pipeline: randomUUID(), stage: randomUUID(), won: randomUUID(), opportunity: randomUUID(), legacyOpportunity: randomUUID() };

  /** One tenant transaction as the app role, committed (or rolled back on error) like the API does. */
  async function tenant<T>(ws: string, userId: string, work: (client: PoolClient) => Promise<T>, connection?: PoolClient): Promise<T> {
    const client = connection ?? await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, userId]);
      await client.query("SET LOCAL ROLE wodana_app");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!connection) client.release();
    }
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people))
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${id.slice(0, 8)}@example.com`, key[0].toUpperCase() + key.slice(1)]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const ws of [workspaceId, otherWorkspaceId])
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'E3 firm',$2,'AED',$3)", [ws, `e3-${ws.slice(0, 8)}`, people.owner]);
      const roles: Record<string, { id: string; code: string; permissions: string[] | "all" }> = {
        sales: { id: randomUUID(), code: "sales", permissions: ["commercial.finance.verify", "commercial.deal.approve", "crm.opportunities.manage", "crm.opportunities.view"] },
        finance: { id: randomUUID(), code: "finance", permissions: ["commercial.finance.verify", "crm.opportunities.view"] },
        approver: { id: randomUUID(), code: "deal_approver", permissions: ["commercial.deal.approve", "crm.opportunities.view"] },
        dual: { id: randomUUID(), code: "finance_lead", permissions: ["commercial.finance.verify", "commercial.deal.approve"] },
        owner: { id: randomUUID(), code: "owner", permissions: "all" },
        cover: { id: randomUUID(), code: "assistant", permissions: ["crm.opportunities.view"] },
      };
      for (const role of Object.values(roles)) {
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,$4)", [role.id, workspaceId, role.code, role.code === "owner"]);
        if (role.permissions === "all") await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, role.id]);
        else await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role.id, role.permissions]);
      }
      const assign: Array<[keyof People, string]> = [["sales", "sales"], ["finance", "finance"], ["approver", "approver"], ["approver2", "approver"], ["dual", "dual"], ["owner", "owner"], ["cover", "cover"]];
      for (const [person, role] of assign) {
        const membership = randomUUID();
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, people[person]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, roles[role].id]);
      }
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), otherWorkspaceId, people.outsider]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,display_name,normalized_name,type) VALUES($1,$2,'Amira','amira','person')", [ids.party, workspaceId]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [ids.pipeline, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'qualified','Qualified',1),($4,$2,$3,'won','Won',2)",
        [ids.stage, workspaceId, ids.pipeline, ids.won]);
      // An opportunity numbered before PLM-099 keeps its D- reference.
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$4,$5,'Old villa','D-0001')",
        [ids.legacyOpportunity, workspaceId, ids.party, ids.pipeline, ids.stage]);
      await client.query("INSERT INTO crm_opportunity_counters(workspace_id,last_value) VALUES($1,1)", [workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      // PLM-099: a new opportunity takes the workspace's prefix (the product default O-).
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title) VALUES($1,$2,$3,$4,$5,'Villa 12')",
        [ids.opportunity, workspaceId, ids.party, ids.pipeline, ids.stage]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  afterAll(() => pool?.end());

  const request = (subjectId: string, amount: string | null = "250000", over: Partial<Parameters<typeof requestApproval>[1]> = {}) => (client: PoolClient) =>
    requestApproval(client, { workspaceId, kind: "deal_file", subjectId, title: "Villa 12 · Q-3", amount, currency: amount ? "AED" : null, requesterUserId: people.sales, notify: false, ...over });

  it("opens under the default policy and decides in order: Finance, then a Deal File approver (allow and deny)", async () => {
    const subject = randomUUID();
    const opened = await tenant(workspaceId, people.sales, request(subject));
    expect(opened).toMatchObject({ status: "pending", currentStep: 1, policy: { name: "Deal File", version: 1 }, amount: "250000", currency: "AED" });
    expect(opened.steps.map((step) => step.label)).toEqual(["Finance verifies", "Deal File approver"]);
    // The requester holds both permissions but never decides their own request (E3-2).
    await expect(tenant(workspaceId, people.sales, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.sales, decision: "approve" }))).rejects.toThrow(/your own/);
    // The approver can't take Finance's step; Finance can.
    await expect(tenant(workspaceId, people.approver, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.approver, decision: "approve" }))).rejects.toThrow(/isn't yours/);
    const verified = await tenant(workspaceId, people.dual, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.dual, decision: "approve", notify: false }));
    expect(verified).toMatchObject({ status: "pending", currentStep: 2 });
    // Who verified doesn't approve, even holding the approval permission.
    await expect(tenant(workspaceId, people.dual, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.dual, decision: "approve" }))).rejects.toThrow(/earlier step/);
    const approved = await tenant(workspaceId, people.approver, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.approver, decision: "approve", notify: false }));
    expect(approved.status).toBe("approved");
    expect(approved.steps.map((step) => [step.state, step.decidedBy])).toEqual([["done", "Dual"], ["done", "Approver"]]);
  });

  it("QA-014: tells the approver the amount as money (grouped, at the currency's precision), not a raw number", async () => {
    await tenant(workspaceId, people.owner, (client) => seedDefaultNotificationTemplates(client, workspaceId));
    const opened = await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind: "deal_file", subjectId: randomUUID(), title: "Villa 12 · Q-4",
      amount: "99999999", currency: "AED", requesterUserId: people.sales }));
    const bodies = await tenant(workspaceId, people.owner, async (client) => (await client.query<{ body: string }>(
      `SELECT body FROM notifications WHERE workspace_id = $1 AND event_type = 'approvals.requested' AND channel = 'in_app' AND idempotency_key LIKE $2`,
      [workspaceId, `approvals.requested:${opened.id}:%`])).rows.map((row) => row.body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).toMatch(/asks for your approval · AED 99,999,999\.00\.$/);
  });

  it("keeps tenants apart: another workspace neither sees nor decides the request, nor writes into it", async () => {
    const subject = randomUUID();
    const opened = await tenant(workspaceId, people.sales, request(subject));
    expect(await tenant(otherWorkspaceId, people.outsider, (client) => approvalStatus(client, otherWorkspaceId, "deal_file", subject))).toBeNull();
    await expect(tenant(otherWorkspaceId, people.outsider, (client) => decideApproval(client, { workspaceId: otherWorkspaceId, requestId: opened.id, deciderUserId: people.outsider, decision: "approve" })))
      .rejects.toThrow(/Nothing is waiting/);
    await expect(tenant(otherWorkspaceId, people.outsider, (client) => client.query(
      `INSERT INTO approval_decisions (workspace_id, request_id, step_position, decision, decided_by) VALUES ($1, $2, 1, 'approve', $3)`, [workspaceId, opened.id, people.outsider])))
      .rejects.toThrow(/row-level security|violates/);
  });

  it("is idempotent: the same request and the same command decide once (replay)", async () => {
    const subject = randomUUID();
    const first = await tenant(workspaceId, people.sales, request(subject));
    const again = await tenant(workspaceId, people.sales, request(subject));
    expect(again.id).toBe(first.id);
    const commandId = randomUUID();
    const decide = (client: PoolClient) => decideApproval(client, { workspaceId, requestId: first.id, deciderUserId: people.finance, decision: "approve", commandId, notify: false });
    const once = await tenant(workspaceId, people.finance, decide);
    const twice = await tenant(workspaceId, people.finance, decide);
    expect(twice).toMatchObject({ id: once.id, currentStep: 2, version: once.version });
    const count = await tenant(workspaceId, people.finance, (client) => client.query("SELECT count(*)::int AS count FROM approval_decisions WHERE workspace_id = $1 AND request_id = $2", [workspaceId, first.id]));
    expect(count.rows[0].count).toBe(1);
    // Decisions are append-only.
    await expect(tenant(workspaceId, people.finance, (client) => client.query("UPDATE approval_decisions SET note = 'x' WHERE workspace_id = $1 AND request_id = $2", [workspaceId, first.id])))
      .rejects.toThrow(/append-only|permission denied/);
  });

  it("refuses a stale decision (version-checked) and tells the final state", async () => {
    const opened = await tenant(workspaceId, people.sales, request(randomUUID()));
    await tenant(workspaceId, people.finance, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.finance, decision: "approve", notify: false }));
    await expect(tenant(workspaceId, people.approver, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.approver, decision: "approve", expectedVersion: opened.version })))
      .rejects.toThrow(/acted on this first/);
  });

  it("E3-6: two approvers at the same moment — one decision wins, the other sees the final state", async () => {
    const opened = await tenant(workspaceId, people.sales, request(randomUUID()));
    await tenant(workspaceId, people.finance, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.finance, decision: "approve", notify: false }));
    const [left, right] = [await pool.connect(), await pool.connect()];
    try {
      const results = await Promise.allSettled([people.approver, people.approver2].map((userId, index) =>
        tenant(workspaceId, userId, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: userId, decision: "approve", notify: false }), [left, right][index])));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(String(lost.reason.message)).toMatch(/already approved by/);
    } finally {
      left.release();
      right.release();
    }
    const decisions = await tenant(workspaceId, people.approver, (client) => client.query("SELECT count(*)::int AS count FROM approval_decisions WHERE workspace_id = $1 AND request_id = $2 AND step_position = 2", [workspaceId, opened.id]));
    expect(decisions.rows[0].count).toBe(1);
  });

  it("E3-4: a policy edit is a new version; a waiting request keeps the version it opened under", async () => {
    const kind = "refund";
    const first = await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind, subjectId: randomUUID(), title: "Refund", amount: "1000", currency: "AED", requesterUserId: people.sales, notify: false }));
    await tenant(workspaceId, people.owner, async (client) => {
      const policy = (await client.query<{ id: string }>("SELECT id FROM approval_policies WHERE workspace_id = $1 AND subject_kind = $2", [workspaceId, kind])).rows[0];
      const version = (await client.query<{ id: string }>(
        `INSERT INTO approval_policy_versions (workspace_id, policy_id, version_number, name, currency_code, owner_above_amount) VALUES ($1, $2, 2, 'Refund', 'AED', 0) RETURNING id`, [workspaceId, policy.id])).rows[0];
      for (const [position, code] of [[1, "commercial.finance.verify"], [2, "commercial.deal.approve"]] as const)
        await client.query("INSERT INTO approval_policy_steps (workspace_id, policy_version_id, position, approver_kind, permission_code) VALUES ($1, $2, $3, 'permission', $4)", [workspaceId, version.id, position, code]);
      await client.query("UPDATE approval_policies SET current_version = 2, version = version + 1 WHERE workspace_id = $1 AND id = $2", [workspaceId, policy.id]);
    });
    const second = await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind, subjectId: randomUUID(), title: "Refund", amount: "1000", currency: "AED", requesterUserId: people.sales, notify: false }));
    expect(first.policy.version).toBe(1);
    expect(first.steps).toHaveLength(2);
    expect(second.policy.version).toBe(2);
    expect(second.steps.map((step) => step.label)).toEqual(["", "", "Owner"]);
    const reread = await tenant(workspaceId, people.sales, (client) => approvalStatus(client, workspaceId, kind, first.subjectId));
    expect(reread?.steps).toHaveLength(2);
    // Versions can't be edited in place.
    await expect(tenant(workspaceId, people.owner, (client) => client.query("UPDATE approval_policy_versions SET name = 'x' WHERE workspace_id = $1", [workspaceId]))).rejects.toThrow(/append-only|permission denied/);
  });

  it("E3-3: an amount change after approval opens a new approval showing old → new; within the tolerance nothing resets", async () => {
    const subject = randomUUID();
    const opened = await tenant(workspaceId, people.sales, request(subject, "100000"));
    for (const userId of [people.finance, people.approver])
      await tenant(workspaceId, userId, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: userId, decision: "approve", notify: false }));
    const changed = await tenant(workspaceId, people.sales, (client) => amendApprovalAmount(client, { workspaceId, kind: "deal_file", subjectId: subject, amount: "120000", currency: "AED", actorUserId: people.sales, notify: false }));
    expect(changed.reset).toBe(true);
    expect(changed.status).toMatchObject({ status: "pending", currentStep: 1, previousAmount: "100000", amount: "120000" });
    // A pending request with nothing decided yet takes the new amount in place.
    const fresh = await tenant(workspaceId, people.sales, request(randomUUID(), "5000"));
    const moved = await tenant(workspaceId, people.sales, (client) => amendApprovalAmount(client, { workspaceId, kind: "deal_file", subjectId: fresh.subjectId, amount: "5100", currency: "AED", actorUserId: people.sales }));
    expect(moved).toMatchObject({ reset: false, status: { id: fresh.id, amount: "5100" } });
  });

  it("E3-1: a delegate covers an approver who is away, recorded for whom; after the escalation time the next approver decides", async () => {
    await tenant(workspaceId, people.finance, (client) => client.query(
      `INSERT INTO approval_delegations (workspace_id, user_id, delegate_user_id, starts_at, ends_at, created_by) VALUES ($1, $2, $3, now() - interval '1 hour', now() + interval '1 day', $2)`,
      [workspaceId, people.finance, people.cover]));
    const opened = await tenant(workspaceId, people.sales, request(randomUUID()));
    const covered = await tenant(workspaceId, people.cover, (client) => decideApproval(client, { workspaceId, requestId: opened.id, deciderUserId: people.cover, decision: "approve", notify: false }));
    expect(covered.steps[0]).toMatchObject({ state: "done", decidedBy: "Cover", onBehalfOf: "Finance", via: "delegate" });
    // The cover's queue shows it while the delegation runs.
    const queued = await tenant(workspaceId, people.cover, async (client) => {
      const next = await requestApproval(client, { workspaceId, kind: "opportunity_value", subjectId: randomUUID(), title: "Villa 12 · Proposal 1", amount: "15000", currency: "AED", requesterUserId: people.sales, notify: false });
      return { next, waiting: await pendingForPerson(client, workspaceId, people.cover) };
    });
    expect(queued.waiting.map((item) => [item.status.id, item.eligibility.via])).toContainEqual([queued.next.id, "delegate"]);

    // Escalation: a policy that escalates after 2 hours.
    await tenant(workspaceId, people.owner, async (client) => {
      const policy = (await client.query<{ id: string }>(`INSERT INTO approval_policies (workspace_id, subject_kind, name, is_default) VALUES ($1, 'change_request', 'Changes', true) RETURNING id`, [workspaceId])).rows[0];
      const version = (await client.query<{ id: string }>(`INSERT INTO approval_policy_versions (workspace_id, policy_id, version_number, name, escalate_after_hours) VALUES ($1, $2, 1, 'Changes', 2) RETURNING id`, [workspaceId, policy.id])).rows[0];
      await client.query(`INSERT INTO approval_policy_steps (workspace_id, policy_version_id, position, approver_kind, user_id, label) VALUES ($1, $2, 1, 'person', $3, 'Finance in person'), ($1, $2, 2, 'person', $4, 'Approver in person')`,
        [workspaceId, version.id, people.finance, people.approver]);
    });
    const waiting = await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind: "change_request", subjectId: randomUUID(), title: "Change", amount: null, currency: null, requesterUserId: people.sales, notify: false }));
    const later = new Date(Date.now() + 3 * 3_600_000);
    expect(await tenant(workspaceId, people.approver, (client) => canDecideApproval(client, workspaceId, waiting.id, people.approver))).toMatchObject({ canDecide: false });
    expect(await tenant(workspaceId, people.approver, (client) => canDecideApproval(client, workspaceId, waiting.id, people.approver, later))).toMatchObject({ canDecide: true, via: "escalation" });
    const first = await tenant(workspaceId, people.owner, (client) => escalateWaitingApprovals(client, workspaceId, later));
    const second = await tenant(workspaceId, people.owner, (client) => escalateWaitingApprovals(client, workspaceId, later));
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    expect(second.escalated).toBe(0);
  });

  it("wires the Deal File: a review in flight before the engine resumes at the approver's step; partial approvals wait for the Owner", async () => {
    const quote = { id: randomUUID(), number: 3, currency: "AED", total: 1_200_000, kind: "quotation", status: "accepted" } as unknown as Quote;
    const review = { id: randomUUID(), quoteId: quote.id, status: "pending_approval", submittedById: people.sales, financeReviewedById: people.finance } as OwnerReview;
    const resumed = await tenant(workspaceId, people.approver, (client) => ensureDealApproval(client, { workspaceId, caseId: randomUUID(), review, quote, title: "Villa 12 · Q-3" }));
    expect(resumed).toMatchObject({ currentStep: 2, steps: [{ state: "done", via: "legacy" }, { state: "current" }] });
    // A firm policy: Deal Files from 1,000,000 AED also need the Owner.
    await tenant(workspaceId, people.owner, async (client) => {
      const policy = (await client.query<{ id: string }>(`INSERT INTO approval_policies (workspace_id, subject_kind, name) VALUES ($1, 'deal_file', 'Large deals') RETURNING id`, [workspaceId])).rows[0];
      const version = (await client.query<{ id: string }>(`INSERT INTO approval_policy_versions (workspace_id, policy_id, version_number, name, currency_code, min_amount, owner_above_amount) VALUES ($1, $2, 1, 'Large deals', 'AED', 1000000, 1000000) RETURNING id`, [workspaceId, policy.id])).rows[0];
      for (const [position, code] of [[1, "commercial.finance.verify"], [2, "commercial.deal.approve"]] as const)
        await client.query("INSERT INTO approval_policy_steps (workspace_id, policy_version_id, position, approver_kind, permission_code) VALUES ($1, $2, $3, 'permission', $4)", [workspaceId, version.id, position, code]);
    });
    const large = { ...review, id: randomUUID(), status: "pending_finance" } as OwnerReview;
    const step = (userId: string, which: "finance" | "approver") => (client: PoolClient) =>
      decideDealStep(client, { workspaceId, caseId: randomUUID(), review: large, quote, title: "Villa 12 · Q-3", actorUserId: userId, step: which, decision: "approve", note: "" });
    expect(await tenant(workspaceId, people.finance, step(people.finance, "finance"))).toMatchObject({ policy: { name: "Large deals" }, currentStep: 2 });
    expect(await tenant(workspaceId, people.approver, step(people.approver, "approver"))).toMatchObject({ status: "pending", currentStep: 3 });
    expect(await tenant(workspaceId, people.owner, step(people.owner, "approver"))).toMatchObject({ status: "approved" });
  });

  it("PLM-101/103: a proposal value is verified by Finance and locked by the approver; a later change waits with old → new", async () => {
    const opportunityId = ids.opportunity;
    const title = "O-0002 · Amira";
    await tenant(workspaceId, people.sales, (client) => setProposalValue(client, { workspaceId, opportunityId, title, kind: "design", amount: "15000", currency: "AED", note: null, actorUserId: people.sales }));
    await tenant(workspaceId, people.finance, (client) => decideProposalValue(client, { workspaceId, opportunityId, kind: "design", decision: "approve", note: null, actorUserId: people.finance }));
    await tenant(workspaceId, people.approver, (client) => decideProposalValue(client, { workspaceId, opportunityId, kind: "design", decision: "approve", note: null, actorUserId: people.approver }));
    let [design] = await tenant(workspaceId, people.sales, (client) => loadProposals(client, workspaceId, opportunityId));
    expect(design).toMatchObject({ kind: "design", amount: "15000", valueStatus: "approved", approvedBy: "Approver" });
    const change = await tenant(workspaceId, people.sales, (client) => setProposalValue(client, { workspaceId, opportunityId, title, kind: "design", amount: "18000", currency: "AED", note: "Two more spaces", actorUserId: people.sales }));
    expect(change.approval).toMatchObject({ status: "pending", previousAmount: "15000", amount: "18000" });
    [design] = await tenant(workspaceId, people.sales, (client) => loadProposals(client, workspaceId, opportunityId));
    expect(design).toMatchObject({ amount: "15000", valueStatus: "approved" });
    for (const userId of [people.finance, people.approver])
      await tenant(workspaceId, userId, (client) => decideProposalValue(client, { workspaceId, opportunityId, kind: "design", decision: "approve", note: null, actorUserId: userId }));
    [design] = await tenant(workspaceId, people.sales, (client) => loadProposals(client, workspaceId, opportunityId));
    expect(design.amount).toBe("18000");
    // Won once per proposal, each with its own date.
    const won = await tenant(workspaceId, people.sales, (client) => markProposalWon(client, { workspaceId, opportunityId, round: "design", actorUserId: people.sales }));
    const again = await tenant(workspaceId, people.sales, (client) => markProposalWon(client, { workspaceId, opportunityId, round: "design", actorUserId: people.sales }));
    expect([won.changed, again.changed]).toEqual([true, false]);
    // PLM-099: the new opportunity is O-, the one numbered before keeps D-.
    const references = await tenant(workspaceId, people.sales, (client) => client.query<{ reference: string }>(
      "SELECT reference FROM crm_opportunities WHERE workspace_id = $1 ORDER BY reference", [workspaceId]));
    expect(references.rows.map((row) => row.reference)).toEqual(["D-0001", "O-0002"]);
  });

  it("names a waiting request after its record as it is now: a renamed client, opportunity or case shows its current title, not the one it was raised with", async () => {
    const opportunityId = ids.opportunity;
    const reference = (await tenant(workspaceId, people.sales, (client) => client.query<{ reference: string }>("SELECT reference FROM crm_opportunities WHERE workspace_id = $1 AND id = $2", [workspaceId, opportunityId]))).rows[0].reference;
    const context = (userId: string, permissions: string[]): ApprovalContext => ({ workspaceId, userId, displayName: userId, membershipId: null, currency: "AED",
      can: async (permission) => permissions.includes(permission), managedProjects: new Set() });
    // Sales enters the main proposal's value; Finance verifies it from Home › Approvals, where the row is named after the client.
    const { approval } = await tenant(workspaceId, people.sales, (client) => setProposalValue(client, { workspaceId, opportunityId, title: `${reference} · Amira`, kind: "main", amount: "90000", currency: "AED", note: null, actorUserId: people.sales }));
    const financeRow = () => tenant(workspaceId, people.finance, async (client) => (await waitingFor(client, context(people.finance, ["commercial.finance.verify"]))).rows.find((row) => row.kind === "approval" && row.id === approval!.id));
    // The client (shared by both opportunities) and the legacy opportunity, whose Planning case carries the second request.
    const rename = (party: string, legacyTitle: string) => tenant(workspaceId, people.owner, async (client) => {
      await client.query("UPDATE crm_parties SET display_name = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, ids.party, party]);
      await client.query("UPDATE crm_opportunities SET title = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2", [workspaceId, ids.legacyOpportunity, legacyTitle]);
    });
    try {
      expect(await financeRow()).toMatchObject({ title: `${reference} · Amira · Proposal 2 · Main` });
      // The client is renamed before Finance gets to it: the row and the request read the current name.
      await rename("Amira Haddad", "Old villa");
      expect(await financeRow()).toMatchObject({ title: `${reference} · Amira Haddad · Proposal 2 · Main` });
      expect(await tenant(workspaceId, people.finance, (client) => approvalStatus(client, workspaceId, "opportunity_value", approval!.subjectId))).toMatchObject({ title: `${reference} · Amira Haddad · Proposal 2 · Main` });
      // A case's approval (material changes after sign-off) follows the opportunity's title when the case is renamed.
      const caseId = randomUUID();
      const setup = await pool.connect();
      try {
        await setup.query("BEGIN");
        await setup.query("SET LOCAL session_replication_role = replica");
        await setup.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, ids.legacyOpportunity, people.sales]);
        await setup.query("COMMIT");
      } finally { setup.release(); }
      await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind: "ledger_change", subjectId: caseId, title: "Material changes after sign-off · Old villa", amount: null, currency: null,
        href: `/workspace/pre-projects/cases/${caseId}/designs?stage=ledger`, requesterUserId: people.sales, notify: false }));
      await rename("Amira Haddad", "Old villa · west wing");
      expect(await tenant(workspaceId, people.finance, (client) => approvalStatus(client, workspaceId, "ledger_change", caseId))).toMatchObject({ title: "Material changes after sign-off · Old villa · west wing" });
      // A request whose record is gone keeps the title it was raised with.
      const orphan = await tenant(workspaceId, people.sales, request(randomUUID()));
      expect(await tenant(workspaceId, people.finance, (client) => approvalStatus(client, workspaceId, "deal_file", orphan.subjectId))).toMatchObject({ title: "Villa 12 · Q-3" });
      for (const userId of [people.finance, people.approver])
        await tenant(workspaceId, userId, (client) => decideProposalValue(client, { workspaceId, opportunityId, kind: "main", decision: "approve", note: null, actorUserId: userId }));
    } finally {
      // The other tests know the client as Amira and the legacy opportunity as Old villa.
      await rename("Amira", "Old villa");
    }
  });

  it("PLM-102: Deal Closed is computed from the records the closing event names", async () => {
    // An opportunity without an enquiry runs the basic flow; the firm says its deals close on delivery (a row, not code).
    await tenant(workspaceId, people.owner, async (client) => {
      await client.query(`INSERT INTO crm_flows (workspace_id, code, name) VALUES ($1, 'basic', 'Basic') ON CONFLICT (workspace_id, code) DO NOTHING`, [workspaceId]);
      const flow = (await client.query<{ id: string }>(`SELECT id FROM crm_flows WHERE workspace_id = $1 AND code = 'basic'`, [workspaceId])).rows[0];
      await client.query(`INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum) VALUES ($1, $2, 1, $3, $4) ON CONFLICT DO NOTHING`,
        [workspaceId, flow.id, JSON.stringify({ schema: 1, columns: ["qualified", "won"], branches: [], steps: [{ key: "payment_proof", name: "Proof", role: "sales", check: "payment_proof_attached", column: "won" }] }), "b".repeat(64)]);
      await client.query(`INSERT INTO crm_flow_closing_rules (workspace_id, flow_id, furniture_path, closing_event) VALUES ($1, $2, NULL, 'delivered')
                          ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO UPDATE SET closing_event = 'delivered'`, [workspaceId, flow.id]);
    });
    const before = await tenant(workspaceId, people.sales, (client) => loadDealClosing(client, workspaceId, ids.legacyOpportunity));
    expect(before).toMatchObject({ event: "delivered", closed: false });
    await tenant(workspaceId, people.sales, (client) => client.query(
      `INSERT INTO crm_deal_fulfilment_events (workspace_id, opportunity_id, event, received_by, recorded_by) VALUES ($1, $2, 'delivered', 'Amira', $3)`, [workspaceId, ids.legacyOpportunity, people.sales]));
    const after = await tenant(workspaceId, people.sales, (client) => loadDealClosing(client, workspaceId, ids.legacyOpportunity));
    expect(after).toMatchObject({ event: "delivered", closed: true, checks: [{ key: "delivered", done: true }] });
  });

  it("lists a quotation With QS for the named QS (and as their own for the requester), not for every QS; it opens the quotation", async () => {
    const caseId = randomUUID(), reviewId = randomUUID(), quoteId = "q-qs-1";
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, ids.opportunity, people.sales]);
      await setup.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,total) VALUES($1,$2,$3,1,7,'quotation','draft','Joinery','AED',185000.5)`,
        [workspaceId, caseId, quoteId]);
      await setup.query(`INSERT INTO quote_qs_reviews(workspace_id,id,case_id,quote_id,assignee_user_id,status,requested_by) VALUES($1,$2,$3,$4,$5,'with_qs',$6)`,
        [workspaceId, reviewId, caseId, quoteId, people.dual, people.sales]);
      // Two QS: the one it was sent to (finance_lead) and another (finance).
      await setup.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1, role.id, permission.id FROM roles role, permissions permission
                          WHERE role.workspace_id = $1 AND role.code IN ('finance_lead', 'finance') AND permission.code = 'commercial.estimate' ON CONFLICT DO NOTHING`, [workspaceId]);
      await setup.query("COMMIT");
    } finally { setup.release(); }
    await tenant(workspaceId, people.sales, (client) => requestApproval(client, { workspaceId, kind: "quote_qs", subjectId: reviewId, title: "Q-7 · Amira", amount: "185000.5", currency: "AED",
      requesterUserId: people.sales, href: `/workspace/pre-projects/cases/${caseId}/quotations?quote=${quoteId}`, notify: false }));
    const context = (userId: string, permissions: string[]): ApprovalContext => ({ workspaceId, userId, displayName: userId, membershipId: null, currency: "AED",
      can: async (permission) => permissions.includes(permission), managedProjects: new Set() });
    const rows = (userId: string, permissions: string[]) => tenant(workspaceId, userId, async (client) => (await waitingFor(client, context(userId, permissions))).rows.filter((row) => row.kind === "qs_review"));
    // The QS it was sent to: Q-7 · client, the amount, a link to the quotation.
    const named = await rows(people.dual, ["commercial.estimate", "commercial.finance.verify"]);
    expect(named).toEqual([expect.objectContaining({ id: reviewId, title: "Q-7 · Amira", amount: "185000.5", currency: "AED", canDecide: true, decide: null, subject: "Sales",
      href: `/workspace/pre-projects/cases/${caseId}/quotations?quote=${quoteId}` })]);
    // Another QS doesn't see it; the requester sees it as theirs (someone else decides).
    expect(await rows(people.finance, ["commercial.estimate"])).toEqual([]);
    expect(await rows(people.sales, ["commercial.estimate"])).toEqual([expect.objectContaining({ canDecide: false, subject: "Dual" })]);
  });
});
