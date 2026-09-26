import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const commit = process.argv.includes("--commit");
const allowRemote = process.argv.includes("--allow-remote");
const profile = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-crm-intake-profile.json", import.meta.url), "utf8"));
const brand = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-living-brand.json", import.meta.url), "utf8"));
const workflow = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-project-workflow.json", import.meta.url), "utf8"));
const design = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-design-packages.json", import.meta.url), "utf8"));
const fixtureHash = createHash("sha256").update(JSON.stringify({ profile, brand, workflow, design })).digest("hex");
const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8166/api/v1";
const endpoint = new URL(api);
const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
if (!local && !allowRemote) throw new Error("Remote Palm configuration requires --allow-remote.");
if (!local && commit) assert.equal(process.env.PALM_TENANT_APPLY_CONFIRM, `palm-living:${fixtureHash.slice(0, 12)}`,
  `Set PALM_TENANT_APPLY_CONFIRM=palm-living:${fixtureHash.slice(0, 12)} after reviewing these exact tenant fixtures.`);

const auth = process.env.WODANA_ACCESS_TOKEN
  ? { authorization: `Bearer ${process.env.WODANA_ACCESS_TOKEN}` }
  : process.env.WODANA_COOKIE
    ? { cookie: process.env.WODANA_COOKIE }
    : local
      ? {
          "x-wodana-user-subject": "palm-living-local-operations",
          "x-wodana-user-email": "operations@palmlivingae.com",
          "x-wodana-user-name": "Palm Living Operations",
        }
      : {};
if (!local && !Object.keys(auth).length)
  throw new Error("Remote Palm configuration requires WODANA_ACCESS_TOKEN or WODANA_COOKIE.");

async function request(resource, { body, method = body === undefined ? "GET" : "POST", expected = [200, 201] } = {}) {
  const response = await fetch(`${api}${resource}`, {
    method,
    headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!(Array.isArray(expected) ? expected : [expected]).includes(response.status))
    throw new Error(`${method} ${resource}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const me = await request("/me");
const membership = me.memberships?.find((row) => row.workspaceSlug === "palm-living");
assert(membership?.workspaceId, "The operator is not an active Palm Living member.");
const workspaceId = membership.workspaceId;
const changes = [], unchanged = [], pending = [];
const same = (left, right) => isDeepStrictEqual(left, right);
const act = async (label, action) => {
  if (!commit) { pending.push(label); return null; }
  const result = await action(); changes.push(label); return result;
};

let workspace = await request(`/workspaces/${workspaceId}`);
const desiredAppearance = {
  primaryColor: brand.primaryColor,
  secondaryColor: brand.secondaryColor,
  headingFont: brand.headingFont.token,
  bodyFont: brand.bodyFont.token,
};
const currentAppearance = Object.fromEntries(Object.keys(desiredAppearance).map((key) => [key, workspace.branding[key]]));
if (same(currentAppearance, desiredAppearance)) unchanged.push("brand appearance");
else await act("brand appearance", async () => request(`/workspaces/${workspaceId}/appearance`, {
  method: "PUT", expected: 200, body: { workspaceVersion: workspace.workspace.version, ...desiredAppearance },
}));

const desiredTaxonomies = [
  { code: "lead_source", name: "Lead source", options: profile.sources },
  ...Object.entries(profile.channels).map(([source, options]) => ({
    code: `lead_channel_${source}`,
    name: `${profile.sources.find((entry) => entry.code === source)?.label ?? source} channels`,
    options,
  })),
  { code: "enquiry_type", name: "Enquiry type", options: profile.enquiryTypes },
  { code: "customer_type", name: "Client type", options: profile.customerTypes ?? [] },
  { code: "referral_broker", name: "Brokers", options: profile.referralBrokers ?? [] },
  { code: "referral_partner", name: "Referral partners", options: profile.referralPartners ?? [] },
  // The source document does not approve numeric budget bands. Keep only its safe fallback.
  { code: "budget_range", name: "Budget range", options: profile.budgetRanges },
];
let settings = await request(`/workspaces/${workspaceId}/crm/settings`);
for (const desired of desiredTaxonomies) {
  const existing = settings.taxonomies.find((entry) => entry.code === desired.code);
  const options = desired.options.map((entry, position) => ({ ...entry, position }));
  const currentOptions = existing?.options?.filter((entry) => entry.status === "active").map(({ code, label, position }) => ({ code, label, position })) ?? [];
  if (existing?.status === "active" && existing.name === desired.name && same(currentOptions, options)) { unchanged.push(`taxonomy:${desired.code}`); continue; }
  if (existing) await act(`taxonomy:${desired.code}`, () => request(`/workspaces/${workspaceId}/crm/taxonomies/${existing.id}`, {
    method: "PATCH", body: { version: existing.version, name: desired.name, status: "active", options },
  }));
  else await act(`taxonomy:${desired.code}`, () => request(`/workspaces/${workspaceId}/crm/taxonomies`, { body: { ...desired, options } }));
}

let queues = await request(`/workspaces/${workspaceId}/crm/queues`);
let queue = queues.find((entry) => entry.code === profile.operations.queue.code);
const queueMatches = queue && queue.status === "active" && queue.name === profile.operations.queue.name &&
  queue.isFallback === true && queue.takeoverAfterMinutes === profile.operations.queue.takeoverAfterMinutes && isDeepStrictEqual(queue.takeoverSchedule ?? null, profile.operations.queue.takeoverSchedule ?? null);
if (queueMatches) unchanged.push("queue:sales");
else if (queue) queue = await act("queue:sales", () => request(`/workspaces/${workspaceId}/crm/queues/${queue.id}`, {
  method: "PATCH", body: { version: queue.version, name: profile.operations.queue.name, isFallback: true, takeoverAfterMinutes: profile.operations.queue.takeoverAfterMinutes, takeoverSchedule: profile.operations.queue.takeoverSchedule, status: "active" },
})) ?? queue;
else queue = await act("queue:sales", () => request(`/workspaces/${workspaceId}/crm/queues`, { body: {
  code: profile.operations.queue.code, name: profile.operations.queue.name, isFallback: true,
  takeoverAfterMinutes: profile.operations.queue.takeoverAfterMinutes,
  takeoverSchedule: profile.operations.queue.takeoverSchedule,
} }));

let slas = await request(`/workspaces/${workspaceId}/crm/sla-policies`);
const desiredSla = { ...profile.operations.firstResponseSla, eventType: "first_response" };
delete desiredSla.name;
let sla = slas.find((entry) => entry.eventType === "first_response" && entry.status === "active");
const slaComparable = sla && {
  eventType: sla.eventType, warningAfterMinutes: sla.warningAfterMinutes, breachAfterMinutes: sla.breachAfterMinutes,
  calculationMode: sla.calculationMode, schedule: sla.schedule,
};
if (sla && sla.name === profile.operations.firstResponseSla.name && same(slaComparable, desiredSla)) unchanged.push("sla:first_response");
else if (sla) await act("sla:first_response", () => request(`/workspaces/${workspaceId}/crm/sla-policies/${sla.id}`, {
  method: "PATCH", body: { version: sla.version, name: profile.operations.firstResponseSla.name, status: "active", ...desiredSla },
}));
else await act("sla:first_response", () => request(`/workspaces/${workspaceId}/crm/sla-policies`, {
  body: { name: profile.operations.firstResponseSla.name, ...desiredSla },
}));

if (!queue && !commit) pending.push("assignment policy, sales role and team require queue creation");
if (queue) {
  const policies = await request(`/workspaces/${workspaceId}/crm/assignment-policies`);
  const policy = policies.find((entry) => entry.name === "Palm Living default assignment" && entry.status === "active");
  const desiredPolicy = { name: "Palm Living default assignment", priority: 100, fallbackQueueId: queue.id, preserveRelationshipOwner: true, rules: [] };
  if (policy && policy.priority === 100 && policy.fallbackQueueId === queue.id && policy.preserveRelationshipOwner === true && !policy.rules.length) unchanged.push("assignment:default");
  else if (policy) await act("assignment:default", () => request(`/workspaces/${workspaceId}/crm/assignment-policies/${policy.id}`, {
    method: "PATCH", body: { version: policy.version, ...desiredPolicy, status: "active" },
  }));
  else await act("assignment:default", () => request(`/workspaces/${workspaceId}/crm/assignment-policies`, { body: desiredPolicy }));

  workspace = await request(`/workspaces/${workspaceId}`);
  let salesUnit = workspace.businessUnits.find((entry) => entry.code === "SALES");
  if (!salesUnit) salesUnit = await act("business-unit:sales", () => request(`/workspaces/${workspaceId}/business-units`, { body: {
    legalEntityId: workspace.legalEntities[0].id, code: "SALES", name: "Sales", type: "department", timezone: "Asia/Dubai", color: "#000000",
  } })); else unchanged.push("business-unit:sales");
  const permissionCodes = [
    "crm.parties.view", "crm.parties.manage", "crm.leads.view", "crm.leads.manage", "crm.leads.assign",
    "crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.transition", "crm.opportunities.sensitive_values",
    "crm.activities.view", "crm.activities.manage", "crm.communications.view", "crm.communications.send",
    "crm.notifications.view", "crm.reports.view", "pre_projects.view", "pre_projects.edit", "catalog.view",
  ];
  const roles = await request(`/workspaces/${workspaceId}/roles`);
  let salesRole = roles.find((entry) => entry.code === "sales_account_manager");
  const desiredRole = {
    name: "Sales / Account Manager",
    description: "Handles enquiries, follow-ups, qualification, opportunities and pre-execution handoff.",
    permissionCodes: [...permissionCodes].sort(),
  };
  const roleMatches = salesRole && salesRole.name === desiredRole.name &&
    salesRole.description === desiredRole.description && same([...salesRole.permissions].sort(), desiredRole.permissionCodes);
  if (!salesRole) salesRole = await act("role:sales-account-manager", () => request(`/workspaces/${workspaceId}/roles`, { body: {
    code: "sales_account_manager", ...desiredRole,
  } }));
  else if (roleMatches) unchanged.push("role:sales-account-manager");
  else salesRole = await act("role:sales-account-manager", () => request(`/workspaces/${workspaceId}/roles/${salesRole.id}`, {
    method: "PATCH", body: { version: salesRole.version, ...desiredRole },
  })) ?? salesRole;
  const members = await request(`/workspaces/${workspaceId}/members`);
  const operations = members.find((entry) => entry.email?.toLowerCase() === "operations@palmlivingae.com") ?? members.find((entry) => entry.roles?.includes("owner"));
  assert(operations, "Palm Living needs one active owner/Operations member before sales routing can be configured.");
  if (salesUnit && salesRole) {
    const teams = await request(`/workspaces/${workspaceId}/teams`);
    let team = teams.find((entry) => entry.code === profile.operations.team.code);
    const desiredTeam = {
      businessUnitId: salesUnit.id, name: profile.operations.team.name,
      description: "Shared Palm Living sales access and automatic enquiry routing.",
      memberIds: [operations.id], leadMembershipId: operations.id, roleIds: [salesRole.id], queueIds: [queue.id],
    };
    const teamComparable = team && {
      businessUnitId: team.businessUnitId, name: team.name, description: team.description,
      memberIds: team.members.map((entry) => entry.membershipId).sort(),
      leadMembershipId: team.members.find((entry) => entry.isLead)?.membershipId ?? null,
      roleIds: [...team.roleIds].sort(), queueIds: [...team.queueIds].sort(),
    };
    if (team && same(teamComparable, { ...desiredTeam, memberIds: [...desiredTeam.memberIds].sort(), roleIds: [...desiredTeam.roleIds].sort(), queueIds: [...desiredTeam.queueIds].sort() })) unchanged.push("team:sales-account-managers");
    else if (team) await act("team:sales-account-managers", () => request(`/workspaces/${workspaceId}/teams/${team.id}`, { method: "PATCH", body: { version: team.version, ...desiredTeam } }));
    else await act("team:sales-account-managers", () => request(`/workspaces/${workspaceId}/teams`, { body: { code: profile.operations.team.code, ...desiredTeam } }));
  }
}

const workflowId = "f03a7996-b75a-52c4-b8cc-e7f04bf3e1c2";
const workflowPath = `/workspaces/${workspaceId}/projects/workflow-templates`;
const workflowState = await request(workflowPath);
let existingWorkflow = workflowState.templates.find((entry) => entry.code === workflow.code);
const desiredWorkflow = { code: workflow.code, name: workflow.name, description: workflow.description, isDefault: true, stages: workflow.stages };
if (existingWorkflow && existingWorkflow.status === "active" && existingWorkflow.isDefault && same(existingWorkflow.stages, workflow.stages) && existingWorkflow.name === workflow.name && existingWorkflow.description === workflow.description) unchanged.push("project-workflow:palm-design-build-delivery");
else await act("project-workflow:palm-design-build-delivery", () => request(`${workflowPath}/${existingWorkflow?.id ?? workflowId}`, {
  method: "PUT", body: { version: existingWorkflow?.version ?? 0, ...desiredWorkflow },
}));

// Prepare the client-approved field structure but keep it unpublished until Palm
// approves the exact public wording and routing receipt on the live domain.
const forms = await request(`/workspaces/${workspaceId}/crm/lead-forms`);
const formRows = forms.data ?? forms.items ?? (Array.isArray(forms) ? forms : []);
let websiteForm = formRows.find((entry) => entry.draft?.source === profile.form.source && entry.draft?.channel === profile.form.channel);
if (!websiteForm && commit) websiteForm = await request(`/workspaces/${workspaceId}/crm/lead-forms`, { body: {} });
if (websiteForm) {
  const questions = websiteForm.draft.questions.map((question) => {
    const field = profile.form.fields.find((entry) => entry.field === question.field);
    return field ? { ...question, title: field.title, required: field.required } : question;
  });
  const draft = { ...websiteForm.draft, title: profile.form.title, description: profile.form.description, source: profile.form.source, channel: profile.form.channel, questions };
  if (websiteForm.status !== "published" && same(websiteForm.draft, draft)) unchanged.push("form:website-draft");
  else await act("form:website-draft", () => request(`/workspaces/${workspaceId}/crm/lead-forms/${websiteForm.id}`, {
    method: "PATCH", body: { version: websiteForm.version, action: websiteForm.status === "published" ? "pause" : "save", draft },
  }));
} else pending.push("form:website-draft");

// Design packages and minimum design deposit (PLM-041): configuration, applied idempotently.
const designSettings = await request(`/workspaces/${workspaceId}/design/settings`);
if (JSON.stringify(designSettings.minimumDeposit) === JSON.stringify(design.minimumDeposit)) unchanged.push("design:minimum-deposit");
else await act("design:minimum-deposit", () => request(`/workspaces/${workspaceId}/design/settings`, { method: "PUT", expected: 200, body: { minimumDeposit: design.minimumDeposit, version: designSettings.version } }));
for (const desired of design.packages) {
  const existing = designSettings.packages.find((row) => row.code === desired.code);
  const same = existing && ["name", "pricingMethod", "rate", "currency", "includedRevisions", "includesSpacePlanning", "includesRenders", "inclusions", "position"].every((key) => String(existing[key] ?? "") === String(desired[key] ?? ""))
    && String(existing.areaUnit ?? "") === String(desired.areaUnit ?? "") && String(existing.requiredRoleCode ?? "") === String(desired.requiredRoleCode ?? "");
  if (same) unchanged.push(`design:package:${desired.code}`);
  else await act(`design:package:${desired.code}`, () => request(`/workspaces/${workspaceId}/design/packages`, { body: { ...desired, ...(existing ? { id: existing.id, version: existing.version } : {}) } }));
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  committed: commit,
  workspaceId,
  fixtureHash,
  changed: changes,
  unchanged,
  pending,
  boundaries: {
    publicForms: "draft_only_until_wording_and_live_receipt_are_approved",
    qualificationForm: "not_configured_without_approved_questions",
    pipeline: "not_configured_without_approved_sales_stages",
    externalChannels: profile.connectionBoundary,
    budgetBands: "not_invented_only_not_sure_available",
  },
}, null, 2)}\n`);
