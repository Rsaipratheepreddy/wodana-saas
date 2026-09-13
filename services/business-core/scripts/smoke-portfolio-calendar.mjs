import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const api = process.env.PORTFOLIO_CALENDAR_TEST_API ?? "http://127.0.0.1:8152/api/v1";
const databaseUrl = new URL(process.env.PORTFOLIO_CALENDAR_TEST_DB ?? "postgresql://localhost/invalid");
if (!["127.0.0.1", "localhost"].includes(new URL(api).hostname)
  || !["127.0.0.1", "localhost", ""].includes(databaseUrl.hostname)
  || !databaseUrl.pathname.includes("portfolio_calendar_test"))
  throw new Error("This smoke creates fixtures and requires a disposable local portfolio_calendar_test database.");

const run = randomUUID();
const actor = {
  "x-wodana-user-subject": `calendar-owner-${run}`,
  "x-wodana-user-email": `calendar-owner-${run}@example.com`,
  "x-wodana-user-name": "Calendar Owner",
};
const outside = {
  "x-wodana-user-subject": `calendar-outside-${run}`,
  "x-wodana-user-email": `calendar-outside-${run}@example.com`,
  "x-wodana-user-name": "Outside User",
};
async function request(path, { headers = actor, body, method = body ? "POST" : "GET", expected = method === "POST" ? 201 : 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

const created = await request("/workspaces", { body: {
  name: "Portfolio Calendar Test",
  slug: `portfolio-calendar-${run}`,
  defaultCurrency: "AED",
  defaultLocale: "en-AE",
  defaultTimezone: "Asia/Dubai",
  unitSystem: "metric",
  weekStartsOn: 1,
  firstLegalEntity: { code: "TEST", displayName: "Test Company", registeredName: "Test Company LLC", countryCode: "AE", baseCurrency: "AED", locale: "en-AE", timezone: "Asia/Dubai" },
} });
const workspaceId = created.workspace.id;
const legalEntityId = created.legalEntities[0].id;
const membershipId = (await request(`/workspaces/${workspaceId}/members`))[0].id;
const design = await request(`/workspaces/${workspaceId}/business-units`, { body: {
  legalEntityId, code: "DESIGN", name: "Design", type: "department", timezone: "Asia/Dubai", color: "#DC2626",
} });
const pipeline = await request(`/workspaces/${workspaceId}/crm/pipelines`, { body: {
  code: "delivery", name: "Delivery", isDefault: true,
  stages: [{ code: "qualified", name: "Qualified", position: 1, probability: 50 }],
} });
const stage = pipeline.stages[0];

const client = new pg.Client({ connectionString: databaseUrl.toString() });
await client.connect();
try {
  const owner = (await client.query("SELECT user_id FROM workspace_memberships WHERE workspace_id=$1 AND id=$2", [workspaceId, membershipId])).rows[0];
  assert(owner && pipeline && stage, "Workspace bootstrap must provide an owner and CRM pipeline.");
  const partyId = randomUUID(), opportunityId = randomUUID(), caseId = randomUUID(), projectId = randomUUID();
  const resourceA = randomUUID(), resourceB = randomUUID();
  await client.query("BEGIN");
  await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name,created_by) VALUES($1,$2,'person','Nadia Client','nadia client',$3)", [partyId, workspaceId, owner.user_id]);
  await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,currency_code,amount) VALUES($1,$2,$3,$4,$5,'Villa 18','AED',100000)", [opportunityId, workspaceId, partyId, pipeline.id, stage.id]);
  await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, owner.user_id]);
  await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,'Villa 18 Fit-out',$4)", [projectId, workspaceId, caseId, owner.user_id]);
  await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,true)", [workspaceId, projectId, membershipId]);
  const task = (id, title, startTime, endTime) => ({ id, parentId: "", title, status: "planned", start: "2026-09-08", end: "2026-09-08", baselineStart: "2026-09-08", baselineEnd: "2026-09-08", quantity: 1, weight: 1, resourceId: id === "task-design" ? resourceA : resourceB, startTime, endTime });
  const content = { revision: 1, phase: "active", controls: { reference: "DEAL-018", risk: "on_track" }, tasks: [task("task-design", "Design review", "13:00", "14:00"), task("task-production", "Production review", "13:30", "14:30")], reports: [], files: [], milestones: [] };
  await client.query("INSERT INTO project_execution(project_id,workspace_id,revision,content) VALUES($1,$2,1,$3)", [projectId, workspaceId, content]);
  await client.query("INSERT INTO project_resources(id,workspace_id,name,kind,members,business_unit_id) VALUES($1,$3,'Design Team A','crew',$4,$5),($2,$3,'Design Team B','crew',$4,$5)", [resourceA, resourceB, workspaceId, [membershipId], design.id]);
  await client.query("INSERT INTO project_bookings(workspace_id,project_id,task_id,resource_id,starts_on,ends_on,status,member_ids,slots) VALUES($1,$2,'task-design',$3,'2026-09-08','2026-09-08','confirmed',$5,$6),($1,$2,'task-production',$4,'2026-09-08','2026-09-08','confirmed',$5,$7)", [workspaceId, projectId, resourceA, resourceB, [membershipId], JSON.stringify([{ date: "2026-09-08", startTime: "13:00", endTime: "14:00" }]), JSON.stringify([{ date: "2026-09-08", startTime: "13:30", endTime: "14:30" }])]);
  await client.query("COMMIT");

  const calendar = await request(`/workspaces/${workspaceId}/projects/calendar?from=2026-09-06&to=2026-09-12`);
  assert.equal(calendar.range.timezone, "Asia/Dubai");
  assert.equal(calendar.events.length, 2);
  assert.equal(calendar.overlapCount, 2);
  assert(calendar.events.every((event) => event.department.color === "#DC2626" && event.overlapIds.length === 1));
  assert(calendar.events.every((event) => event.department.code === "DESIGN" && event.department.visibleName === "Design"));
  assert(calendar.events[0].title.includes("DEAL-018 — Nadia Client — Design — Design Team"));
  const filtered = await request(`/workspaces/${workspaceId}/projects/calendar?from=2026-09-06&to=2026-09-12&businessUnitId=${design.id}`);
  assert.equal(filtered.events.length, 2);
  await request(`/workspaces/${workspaceId}/projects/calendar?from=2026-01-01&to=2026-12-31`, { expected: 400 });
  await request("/me", { headers: outside });
  await request(`/workspaces/${workspaceId}/projects/calendar?from=2026-09-06&to=2026-09-12`, { headers: outside, expected: 404 });

  const portfolio = await request(`/workspaces/${workspaceId}/projects/portfolio`);
  assert.equal(portfolio.length, 1);
  assert.equal(portfolio[0].taskSummary.total, 2);
  assert.equal(portfolio[0].schedule.currentStart, "2026-09-08");
  console.log("PASS: portfolio summary, department colors, timed events, overlaps, filters, bounded ranges and tenant access.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
