import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { palmLivingBrandFixture, palmLivingCatalogImport } from "./palm-living-fixture.mjs";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8164/api/v1";
if (!["127.0.0.1", "localhost"].includes(new URL(api).hostname))
  throw new Error("The funnel smoke is restricted to an isolated local API.");

const run = randomUUID();
const palmFixture = process.env.WODANA_SYNTHETIC_FIXTURE === "palm";
const palmIntakeProfile = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-crm-intake-profile.json", import.meta.url), "utf8"));
const palmWorkflowFixture = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-project-workflow.json", import.meta.url), "utf8"));
if (process.env.WODANA_SYNTHETIC_FIXTURE && !palmFixture)
  throw new Error("WODANA_SYNTHETIC_FIXTURE only accepts the isolated palm profile.");
const fixture = palmFixture ? {
  workspaceName: "Palm Living UAT (synthetic)",
  registeredName: "Palm Living UAT Synthetic LLC",
  slugPrefix: "palm-synthetic",
  ownerName: "Operations UAT",
  ownerEmailPrefix: "operations",
  reviewerName: "Cece UAT reviewer",
  reviewerEmailPrefix: "cece",
  customerName: "Amina Rahman (synthetic)",
  enquiryTitle: "Two-room villa renovation",
  enquirySummary: "Synthetic shared-link enquiry for a villa renovation, joinery and furnishing scope.",
  opportunityTitle: "Amina Rahman — villa renovation (synthetic)",
  formTitle: "Palm Living project enquiry (synthetic)",
} : {
  workspaceName: "Generic Funnel Verification",
  registeredName: "Generic Funnel Verification LLC",
  slugPrefix: "funnel",
  ownerName: "Funnel Owner",
  ownerEmailPrefix: "funnel-owner",
  reviewerName: "Funnel Reviewer",
  reviewerEmailPrefix: "funnel-reviewer",
  customerName: "Generic Client",
  enquiryTitle: "Two-room interior project",
  enquirySummary: "A generic customer enquiry used only in the disposable funnel verification.",
  opportunityTitle: "Generic Client — interior project",
  formTitle: "Project enquiry (synthetic)",
};
const slug = `${fixture.slugPrefix}-${run}`;
const owner = {
  "x-wodana-user-subject": `${fixture.ownerEmailPrefix}-${run}`,
  "x-wodana-user-email": `${fixture.ownerEmailPrefix}-${run}@wodana.invalid`,
  "x-wodana-user-name": fixture.ownerName,
};
const reviewer = {
  "x-wodana-user-subject": `${fixture.reviewerEmailPrefix}-${run}`,
  "x-wodana-user-email": `${fixture.reviewerEmailPrefix}-${run}@wodana.invalid`,
  "x-wodana-user-name": fixture.reviewerName,
};
const operationsApprover = {
  "x-wodana-user-subject": `funnel-operations-${run}`,
  "x-wodana-user-email": `funnel-operations-${run}@wodana.invalid`,
  "x-wodana-user-name": "Funnel Operations approver",
};
const internal = {
  "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token",
};
const jobViewer = {
  "x-wodana-user-subject": `funnel-job-viewer-${run}`,
  "x-wodana-user-email": `funnel-job-viewer-${run}@example.com`,
  "x-wodana-user-name": "Job Viewer",
};
const jobDenied = {
  "x-wodana-user-subject": `funnel-job-denied-${run}`,
  "x-wodana-user-email": `funnel-job-denied-${run}@example.com`,
  "x-wodana-user-name": "Job Denied",
};
const outsider = {
  "x-wodana-user-subject": `funnel-job-outsider-${run}`,
  "x-wodana-user-email": `funnel-job-outsider-${run}@example.com`,
  "x-wodana-user-name": "Job Outsider",
};

async function request(
  path,
  {
    body,
    headers = owner,
    method = body === undefined ? "GET" : "POST",
    expected = method === "POST" ? 201 : 200,
  } = {},
) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function rawRequest(path, { body, headers = owner, method = "POST" } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const workspace = await request("/workspaces", {
  body: {
    name: fixture.workspaceName,
    slug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "FUNNEL",
      displayName: fixture.workspaceName,
      registeredName: fixture.registeredName,
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
const workspaceId = workspace.workspace.id;
let palmBrandConfigured = false;
let palmCatalogImported = false;
let palmCatalogRecordCount = 0;
if (palmFixture) {
  const appearance = await request(`/workspaces/${workspaceId}/appearance`, {
    method: "PUT",
    expected: 200,
    body: {
      workspaceVersion: workspace.workspace.version,
      primaryColor: palmLivingBrandFixture.primaryColor,
      secondaryColor: palmLivingBrandFixture.secondaryColor,
      headingFont: palmLivingBrandFixture.headingFont.token,
      bodyFont: palmLivingBrandFixture.bodyFont.token,
    },
  });
  assert.equal(appearance.primaryColor, "#E4E3DE");
  assert.equal(appearance.secondaryColor, "#000000");
  assert.equal(appearance.headingFont, "alta");
  assert.equal(appearance.bodyFont, "montserrat");
  const publicBrand = await request(`/auth/tenant/${slug}`);
  assert.equal(publicBrand.primaryColor, "#E4E3DE");
  assert.equal(publicBrand.secondaryColor, "#000000");
  assert.equal(publicBrand.headingFont, "alta");
  assert.equal(publicBrand.bodyFont, "montserrat");
  palmBrandConfigured = true;

  const catalogId = randomUUID();
  await request(`/workspaces/${workspaceId}/catalog/collections`, {
    body: {
      id: catalogId,
      name: "Palm Living electrical materials",
      description: "Client-supplied electrical material register pending commercial and stock review.",
      starter: false,
    },
  });
  const catalogImport = palmLivingCatalogImport(catalogId);
  const preview = await request(`/workspaces/${workspaceId}/catalog/import`, {
    body: { ...catalogImport, dryRun: true },
  });
  assert.equal(preview.preview, true);
  assert.equal(preview.created, 41);
  const applied = await request(`/workspaces/${workspaceId}/catalog/import`, {
    body: { ...catalogImport, dryRun: false },
  });
  assert.equal(applied.preview, false);
  assert.equal(applied.created, 41);
  const hardware = applied.items.filter((item) => item.kind === "hardware");
  assert.equal(hardware.length, 39);
  assert(hardware.every((item) => item.commerce?.pricingMode === "unpriced"));
  assert(hardware.every((item) => item.provenance?.reviewStatus === "needs_review"));
  palmCatalogRecordCount = applied.items.length;
  palmCatalogImported = true;
}
const designUnit = await request(`/workspaces/${workspaceId}/business-units`, {
  body: {
    legalEntityId: workspace.legalEntities[0].id,
    code: "DESIGN",
    name: "Design",
    type: "department",
    timezone: "Asia/Dubai",
    color: "#DC2626",
  },
});
let members = await request(`/workspaces/${workspaceId}/members`);
const ownerMember = members.find((member) => member.roles.includes("owner"));
assert(ownerMember);

const reviewerRole = await request(`/workspaces/${workspaceId}/roles`, {
  body: {
    code: "uat_reviewer",
    name: "UAT design and commercial reviewer",
    permissionCodes: [
      "pre_projects.view",
      "pre_projects.edit",
      "pre_projects.review_designs",
      "commercial.approve",
      "commercial.estimate",
      "commercial.finance.verify",
    ],
  },
});
const reviewerTeam = await request(`/workspaces/${workspaceId}/teams`, {
  body: {
    businessUnitId: designUnit.id,
    code: "UAT_REVIEW",
    name: "UAT review",
    description: "Synthetic team-inherited access fixture.",
    roleIds: [reviewerRole.id],
  },
});
const beforeReviewerInvite = await request(`/workspaces/${workspaceId}/billing`);
assert.deepEqual({
  members: beforeReviewerInvite.usage.members,
  pendingInvitations: beforeReviewerInvite.usage.pendingInvitations,
  reservedSeats: beforeReviewerInvite.usage.reservedSeats,
}, { members: 1, pendingInvitations: 0, reservedSeats: 1 });
const invitation = await request(`/workspaces/${workspaceId}/invitations`, {
  body: {
    displayName: fixture.reviewerName,
    email: reviewer["x-wodana-user-email"],
    roleCodes: [],
    teamIds: [reviewerTeam.id],
  },
});
const pendingReviewerInvite = await request(`/workspaces/${workspaceId}/billing`);
assert.deepEqual({
  members: pendingReviewerInvite.usage.members,
  pendingInvitations: pendingReviewerInvite.usage.pendingInvitations,
  reservedSeats: pendingReviewerInvite.usage.reservedSeats,
}, { members: 1, pendingInvitations: 1, reservedSeats: 2 });
await request(`/workspaces/invitations/${invitation.id}/accept`, {
  headers: reviewer,
  method: "POST",
});
members = await request(`/workspaces/${workspaceId}/members`);
const reviewerMember = members.find(
  (member) => member.email === reviewer["x-wodana-user-email"],
);
assert(reviewerMember);
assert.deepEqual(reviewerMember.roles, []);
assert(reviewerMember.inheritedRoles.includes("uat_reviewer"));
assert(reviewerMember.teams.some((team) => team.id === reviewerTeam.id));
const acceptedReviewerInvite = await request(`/workspaces/${workspaceId}/billing`);
assert.deepEqual({
  members: acceptedReviewerInvite.usage.members,
  pendingInvitations: acceptedReviewerInvite.usage.pendingInvitations,
  reservedSeats: acceptedReviewerInvite.usage.reservedSeats,
}, { members: 2, pendingInvitations: 0, reservedSeats: 2 });

const salesQueue = await request(`/workspaces/${workspaceId}/crm/queues`, {
  body: {
    code: palmFixture ? palmIntakeProfile.operations.queue.code : "sales",
    name: palmFixture ? palmIntakeProfile.operations.queue.name : "Sales and account managers",
    isFallback: true,
    ...(palmFixture ? { takeoverAfterMinutes: palmIntakeProfile.operations.queue.takeoverAfterMinutes } : {}),
  },
});
await request(`/workspaces/${workspaceId}/crm/queues/${salesQueue.id}/members`, {
  method: "PUT",
  body: { membershipId: ownerMember.id, capacity: 100, weight: 1, isAvailable: true },
});

let palmSlaPolicy = null;
if (palmFixture) {
  const configured = palmIntakeProfile.operations.firstResponseSla;
  palmSlaPolicy = await request(`/workspaces/${workspaceId}/crm/sla-policies`, {
    body: {
      name: configured.name,
      eventType: "first_response",
      warningAfterMinutes: configured.warningAfterMinutes,
      breachAfterMinutes: configured.breachAfterMinutes,
      calculationMode: configured.calculationMode,
      schedule: configured.schedule,
    },
  });
  assert.equal(salesQueue.takeoverAfterMinutes, 60);
  assert.equal(palmSlaPolicy.calculationMode, "business");
  assert.deepEqual(palmSlaPolicy.schedule, configured.schedule);
}

if (palmFixture) {
  const createTaxonomy = (code, name, entries) => request(`/workspaces/${workspaceId}/crm/taxonomies`, {
    body: { code, name, options: entries.map((entry, position) => ({ ...entry, position })) },
  });
  await createTaxonomy("lead_source", "Lead source", palmIntakeProfile.sources);
  for (const [source, channels] of Object.entries(palmIntakeProfile.channels)) {
    await createTaxonomy(`lead_channel_${source}`, `${palmIntakeProfile.sources.find(option => option.code === source)?.label ?? source} channels`, channels);
  }
  await createTaxonomy("enquiry_type", "Enquiry type", palmIntakeProfile.enquiryTypes);
  await createTaxonomy("budget_range", "Budget range", palmIntakeProfile.budgetRanges);
  const configuredOptions = await request(`/workspaces/${workspaceId}/crm/lead-options`);
  assert.deepEqual(configuredOptions.enquiryTypes.map(option => option.label), palmIntakeProfile.enquiryTypes.map(option => option.label));
  assert.deepEqual(configuredOptions.channels.third_party.map(option => option.label), ["PlyLeads"]);
  assert.deepEqual(configuredOptions.channels.digital_marketing.map(option => option.label), ["Palm Living", "TBD"]);
} else {
  await request(`/workspaces/${workspaceId}/crm/taxonomies`, {
    body: { code: "enquiry_type", name: "Enquiry type", options: [
      { code: "not_sure", label: "Not Sure Yet", position: 0 },
      { code: "renovation_fit_out", label: "Renovation / Fit-Out", position: 1 },
    ] },
  });
}

const workflowPath = `/workspaces/${workspaceId}/projects/workflow-templates`;
const workflowFallback = await request(workflowPath);
assert.equal(workflowFallback.defaultTemplate.source, "built_in");
assert.equal(workflowFallback.defaultTemplate.version, 0);
assert.equal(workflowFallback.templates.length, 0);
const workflowTemplateId = randomUUID();
const savedWorkflow = await request(`${workflowPath}/${workflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 0,
    code: "generic_delivery",
    name: "Generic delivery",
    description: "A tenant-owned vocabulary around the shared execution engine.",
    isDefault: true,
    stages: workflowFallback.defaultTemplate.stages,
  },
});
assert.equal(savedWorkflow.version, 1);
assert.equal(savedWorkflow.source, "workspace");
assert.equal(
  (await request(workflowPath)).defaultTemplate.id,
  workflowTemplateId,
);
await request(`${workflowPath}/${workflowTemplateId}`, {
  method: "PUT",
  expected: 409,
  body: {
    version: 0,
    code: "generic_delivery",
    name: "Stale write must fail",
    description: "",
    isDefault: true,
    stages: workflowFallback.defaultTemplate.stages,
  },
});
const archivedWorkflow = await request(
  `${workflowPath}/${workflowTemplateId}/archive`,
  { body: { version: 1 } },
);
assert.equal(archivedWorkflow.status, "archived");
assert.equal(archivedWorkflow.version, 2);
assert.equal((await request(workflowPath)).defaultTemplate.source, "built_in");
const projectWorkflowTemplateId = randomUUID();
const projectWorkflowStages = palmFixture ? palmWorkflowFixture.stages : workflowFallback.defaultTemplate.stages.map(
  (stage, index) => ({
    ...stage,
    visibleName: index === 0 ? "Mobilisation" : stage.visibleName,
  }),
);
const projectWorkflowCode = palmFixture ? palmWorkflowFixture.code : "tenant_delivery";
const projectFirstStageName = palmFixture ? "Deal File" : "Mobilisation";
await request(`${workflowPath}/${projectWorkflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 0,
    code: projectWorkflowCode,
    name: palmFixture ? palmWorkflowFixture.name : "Tenant delivery",
    description: "The default frozen by new projects in this workspace.",
    isDefault: true,
    stages: projectWorkflowStages,
  },
});

const pipeline = await request(`/workspaces/${workspaceId}/crm/pipelines`, {
  body: {
    code: "sales",
    name: "Sales",
    isDefault: true,
    stages: [
      {
        code: "qualified",
        name: "Qualified",
        position: 1,
        probability: 40,
        forecastCategory: "pipeline",
        entryRequirements: {},
      },
      { code: "won", name: "Won", position: 2, probability: 100, forecastCategory: "closed", entryRequirements: {} },
      { code: "lost", name: "Lost", position: 3, probability: 0, forecastCategory: "closed", entryRequirements: {} },
    ],
  },
});
const qualificationDraft = await request(`/workspaces/${workspaceId}/crm/qualification-forms`, {
  body: {
    code: "funnel_qualification",
    name: "Funnel qualification",
    serviceType: "renovation_fit_out",
    questions: [
      { key: "scope_confirmed", label: "Scope confirmed", dataType: "boolean", required: true, position: 1 },
      { key: "property_type", label: "Property type", dataType: "select", required: true, position: 2, configuration: { options: ["villa", "apartment"] } },
    ],
  },
});
await request(`/workspaces/${workspaceId}/crm/qualification-forms/${qualificationDraft.id}`, {
  method: "PATCH",
  body: { version: qualificationDraft.version, status: "active" },
});

const sharedFormDraft = await request(`/workspaces/${workspaceId}/crm/lead-forms`, {
  body: {},
});
const sharedFormQuestions = palmFixture
  ? sharedFormDraft.draft.questions.map(question => {
      const field = palmIntakeProfile.form.fields.find(candidate => candidate.field === question.field);
      return field ? { ...question, title: field.title, required: field.required } : question;
    })
  : sharedFormDraft.draft.questions;
const sharedForm = await request(`/workspaces/${workspaceId}/crm/lead-forms/${sharedFormDraft.id}`, {
  method: "PATCH",
  body: {
    version: sharedFormDraft.version,
    action: "publish",
    draft: {
      ...sharedFormDraft.draft,
      title: palmFixture ? palmIntakeProfile.form.title : fixture.formTitle,
      description: palmFixture ? palmIntakeProfile.form.description : sharedFormDraft.draft.description,
      source: palmFixture ? palmIntakeProfile.form.source : "company",
      channel: palmFixture ? palmIntakeProfile.form.channel : "website",
      questions: sharedFormQuestions,
    },
  },
});
const publicSharedForm = await request(`/public/crm/lead-forms/${sharedForm.token}`, {
  headers: {},
});
assert.equal(publicSharedForm.branding.displayName, fixture.workspaceName);
assert.equal(publicSharedForm.source, undefined);
assert.equal(publicSharedForm.channel, undefined);
// Core field identifiers drive the public emirate/area and phone widgets; routing metadata stays private.
assert(publicSharedForm.questions.some((question) => question.field === "emirate"));
assert(publicSharedForm.questions.every((question) => question.field !== "source" && question.field !== "channel"));
assert.equal(publicSharedForm.consentLabel, "I agree to be contacted about this enquiry.");
if (palmFixture) {
  assert.equal(publicSharedForm.questions.find(question => question.title === "Email")?.required, true);
  assert.deepEqual(publicSharedForm.questions.find(question => question.title === "What can we help with?")?.options.map(option => option.label), palmIntakeProfile.enquiryTypes.map(option => option.label));
  assert.deepEqual(publicSharedForm.questions.find(question => question.title === "Approximate project budget")?.options.map(option => option.label), palmIntakeProfile.budgetRanges.map(option => option.label));
}
const sharedRequestId = randomUUID();
const sharedValues = {
  displayName: "Noor Al Mansoori (synthetic shared link)",
  mobile: "+971500000001",
  email: "noor.shared-link@wodana.invalid",
  emirate: "dubai",
  area: "Dubai Hills",
  location: "Dubai Hills (synthetic)",
  serviceType: "not_sure",
  budgetRange: "",
  summary: "Three-bedroom furnishing and joinery enquiry created only for local UAT.",
};
const sharedAnswers = Object.fromEntries(sharedForm.draft.questions.map((question) => [
  question.id,
  sharedValues[question.field] ?? "",
]));
await request(`/public/crm/lead-forms/${sharedForm.token}`, {
  headers: {},
  body: { requestId: sharedRequestId, revision: publicSharedForm.revision, answers: sharedAnswers, serviceConsent: true },
});
await request(`/public/crm/lead-forms/${sharedForm.token}`, {
  headers: {},
  body: { requestId: sharedRequestId, revision: publicSharedForm.revision, answers: sharedAnswers, serviceConsent: true },
});
const sharedResponses = await request(`/workspaces/${workspaceId}/crm/lead-forms/${sharedForm.id}/responses`);
assert.equal(sharedResponses.data.length, 1);
const sharedIntake = await request(`/workspaces/${workspaceId}/crm/intake-events/${sharedResponses.data[0].id}`);
const sharedLeadList = await request(`/workspaces/${workspaceId}/crm/leads?search=${encodeURIComponent(sharedValues.displayName)}`);
const sharedLead = sharedLeadList.data.find((candidate) => candidate.partyName === sharedValues.displayName);
assert(sharedLead, "The shared-link enquiry must appear in the accountable CRM queue.");
assert.equal(sharedLead.partyId, sharedIntake.resolvedPartyId);
assert.equal(sharedIntake.payload.formId, sharedForm.id);
assert.deepEqual(sharedIntake.payload.formRawAnswers, sharedAnswers);
assert.equal(sharedIntake.payload.assignment.mode, "automatic");
assert.equal(sharedIntake.payload.consents[0].status, "granted");
assert.equal(sharedIntake.payload.consents[0].evidence.method, "public_enquiry_form");
assert.equal(sharedIntake.payload.consent.formRevision, publicSharedForm.revision);
assert.equal(sharedLead.source, "company");
assert.equal(sharedLead.channel, "website");
assert.equal(sharedLead.intakeMethod, "form");
assert.equal(sharedLead.ownerMembershipId, ownerMember.id);
const sharedLeadDetail = await request(`/workspaces/${workspaceId}/crm/leads/${sharedLead.id}`);
assert.equal(sharedLeadDetail.assignments[0].assignmentMethod, "automatic");

const duplicateAnswers = { ...sharedAnswers };
duplicateAnswers[sharedForm.draft.questions.find(question => question.field === "displayName").id] = "Noor A. (synthetic duplicate candidate)";
await request(`/public/crm/lead-forms/${sharedForm.token}`, {
  headers: {},
  body: { requestId: randomUUID(), revision: publicSharedForm.revision, answers: duplicateAnswers, serviceConsent: true },
});
const duplicateResponses = await request(`/workspaces/${workspaceId}/crm/lead-forms/${sharedForm.id}/responses`);
assert.equal(duplicateResponses.data.length, 2);
const duplicateResponse = duplicateResponses.data.find(response => response.status === "duplicate_candidate");
assert(duplicateResponse, "Repeated unverified contact must remain a duplicate candidate for review.");
assert(duplicateResponse.candidateCount > 0);
assert.equal(duplicateResponse.consentStatus, "granted");
const duplicateIntake = await request(`/workspaces/${workspaceId}/crm/intake-events/${duplicateResponse.id}`);
assert(duplicateIntake.candidates.length > 0);
assert.deepEqual(duplicateIntake.payload.formRawAnswers, duplicateAnswers);

let palmSalesTeam = null;
let staffAssignedLead = null;
if (palmFixture) {
  const salesRole = await request(`/workspaces/${workspaceId}/roles`, {
    body: {
      code: "palm_sales_account_manager",
      name: "Sales and account manager",
      description: "Respond to and follow up assigned Palm enquiries.",
      permissionCodes: [
        "crm.parties.view", "crm.leads.view", "crm.leads.manage", "crm.leads.assign",
        "crm.activities.view", "crm.activities.manage", "crm.communications.view",
        "crm.notifications.view",
      ],
    },
  });
  palmSalesTeam = await request(`/workspaces/${workspaceId}/teams`, {
    body: {
      businessUnitId: designUnit.id,
      code: palmIntakeProfile.operations.team.code,
      name: palmIntakeProfile.operations.team.name,
      description: "Synthetic Palm sales team with inherited access and queue membership.",
      memberIds: [reviewerMember.id],
      leadMembershipId: reviewerMember.id,
      roleIds: [salesRole.id],
      queueIds: [salesQueue.id],
    },
  });
  const afterSalesTeam = await request(`/workspaces/${workspaceId}/members`);
  const inheritedSalesMember = afterSalesTeam.find(member => member.id === reviewerMember.id);
  assert(inheritedSalesMember.inheritedRoles.includes("palm_sales_account_manager"));
  assert(inheritedSalesMember.teams.some(team => team.id === palmSalesTeam.id));
  const routedQueues = await request(`/workspaces/${workspaceId}/crm/queues`);
  assert(routedQueues.find(queue => queue.id === salesQueue.id).members.some(member =>
    member.membershipId === reviewerMember.id && member.teamId === palmSalesTeam.id));

  const staffName = "Staff-created Palm enquiry (synthetic)";
  const staffIntake = await request(`/workspaces/${workspaceId}/crm/intake-events`, {
    headers: { ...owner, "idempotency-key": `palm-staff-${run}`, "x-correlation-id": randomUUID() },
    body: {
      source: "self_generated",
      channel: "call",
      intakeMethod: "manual",
      externalEventId: `palm-staff-${run}`,
      party: {
        displayName: staffName,
        email: `staff-created-${run}@wodana.invalid`,
        mobile: "+971500000002",
        preferredLocale: "en-AE",
        preferredTimezone: "Asia/Dubai",
      },
      title: staffName,
      details: { emirate: "dubai", area: "Dubai Hills" },
      summary: "Synthetic staff-created enquiry assigned to a named eligible team owner.",
      serviceType: "not_sure",
      originalPayload: { method: "manual_staff_entry" },
      assignment: { mode: "manual", ownerMembershipId: reviewerMember.id, queueId: salesQueue.id },
    },
  });
  const staffLeads = await request(`/workspaces/${workspaceId}/crm/leads?search=${encodeURIComponent(staffName)}`);
  staffAssignedLead = staffLeads.data.find(candidate => candidate.partyName === staffName);
  assert(staffAssignedLead);
  assert.equal(staffAssignedLead.id, staffIntake.leadId);
  assert.equal(staffAssignedLead.ownerMembershipId, reviewerMember.id);
  assert.equal(staffAssignedLead.queueId, salesQueue.id);
  const staffLeadDetail = await request(`/workspaces/${workspaceId}/crm/leads/${staffAssignedLead.id}`);
  assert.equal(staffLeadDetail.assignments[0].assignmentMethod, "manual");
  await request(`/workspaces/${workspaceId}/crm/leads/${staffAssignedLead.id}`, { headers: reviewer });

  if (!process.env.DATABASE_URL) throw new Error("Palm takeover acceptance needs the disposable database.");
  const databaseEndpoint = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseEndpoint.hostname)
    || !databaseEndpoint.pathname.startsWith('/wodana_funnel_test_'))
    throw new Error("Palm takeover acceptance requires the disposable local funnel database.");
  const takeoverDatabase = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await takeoverDatabase.connect();
    await takeoverDatabase.query("BEGIN");
    await takeoverDatabase.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    await takeoverDatabase.query(
      "UPDATE crm_leads SET ownership_due_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [workspaceId, sharedLead.id],
    );
    await takeoverDatabase.query("COMMIT");
  } finally {
    await takeoverDatabase.end();
  }
  const takeover = await request(`/internal/crm/slas/workspaces/${workspaceId}/process-takeovers`, {
    headers: internal,
    body: { limit: 100 },
  });
  assert(takeover.reassigned.some(item => item.leadId === sharedLead.id && item.ownerMembershipId === reviewerMember.id));
  const transferredLead = await request(`/workspaces/${workspaceId}/crm/leads/${sharedLead.id}`);
  assert.equal(transferredLead.ownerMembershipId, reviewerMember.id);
  assert.equal(transferredLead.assignments[0].reason, "No call or note was logged before the ownership deadline");
  const reviewerNotifications = await request(`/workspaces/${workspaceId}/crm/notifications`, { headers: reviewer });
  assert(reviewerNotifications.some(notification => notification.deepLink === `/workspace/crm/leads?lead=${sharedLead.id}`
    && notification.eventType === "crm.lead.assigned"));

  await request(`/workspaces/${workspaceId}/crm/activities`, {
    headers: reviewer,
    body: {
      leadId: sharedLead.id,
      type: "note",
      title: "Follow-up logged",
      description: "Synthetic note stops ownership takeover but is not a verified customer response.",
      ownerMembershipId: reviewerMember.id,
    },
  });
  const noteDatabase = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await noteDatabase.connect();
    await noteDatabase.query("BEGIN");
    await noteDatabase.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    await noteDatabase.query(
      "UPDATE crm_leads SET ownership_due_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [workspaceId, sharedLead.id],
    );
    await noteDatabase.query("COMMIT");
  } finally {
    await noteDatabase.end();
  }
  const afterNote = await request(`/internal/crm/slas/workspaces/${workspaceId}/process-takeovers`, {
    headers: internal,
    body: { limit: 100 },
  });
  assert(afterNote.engaged.includes(sharedLead.id));
  const retainedLead = await request(`/workspaces/${workspaceId}/crm/leads/${sharedLead.id}`);
  assert.equal(retainedLead.ownerMembershipId, reviewerMember.id);
  assert.equal(retainedLead.ownershipDueAt, null);
  const retainedFirstResponses = retainedLead.sla.filter(instance => instance.eventType === "first_response");
  assert(retainedFirstResponses.length, "The lead must retain its first-response SLA instance");
  assert(retainedFirstResponses.every(instance => instance.respondedAt === null), "An internal note must not claim a customer response");

  assert.equal(retainedLead.enquiry.source, "company");
  assert.equal(retainedLead.enquiry.channel, "website");
  assert.equal(retainedLead.enquiry.intakeMethod, "form");
  assert(retainedLead.enquiry.correlationId);
  assert.deepEqual(retainedLead.enquiry.attribution, []);
  const followUpAt = new Date(Date.now() + 86_400_000).toISOString();
  const followUp = await request(`/workspaces/${workspaceId}/crm/activities`, {
    headers: reviewer,
    body: {
      leadId: sharedLead.id,
      partyId: sharedLead.partyId,
      type: "task",
      title: "Call customer about the synthetic enquiry",
      ownerMembershipId: reviewerMember.id,
      dueAt: followUpAt,
      isNextAction: true,
    },
  });
  assert.equal(followUp.isNextAction, true);
  const responseCall = await request(`/workspaces/${workspaceId}/crm/activities`, {
    headers: reviewer,
    body: {
      leadId: sharedLead.id,
      partyId: sharedLead.partyId,
      type: "call",
      interactionDirection: "outbound",
      title: "Customer call",
      description: "Synthetic completed outbound call for local response-workspace acceptance.",
      ownerMembershipId: reviewerMember.id,
      isNextAction: false,
    },
  });
  const completedResponseCall = await request(`/workspaces/${workspaceId}/crm/activities/${responseCall.id}/complete`, {
    headers: reviewer,
    body: { version: responseCall.version, outcome: "Customer reached (synthetic)" },
  });
  assert.equal(completedResponseCall.firstResponseEvidence?.recorded, true, `Outbound response evidence was rejected: ${JSON.stringify(completedResponseCall.firstResponseEvidence)}`);
  const afterResponse = await request(`/workspaces/${workspaceId}/crm/leads/${sharedLead.id}`);
  const answeredFirstResponse = afterResponse.sla.find(instance => instance.eventType === "first_response" && instance.responseSourceId === responseCall.id);
  assert(answeredFirstResponse?.respondedAt, `Completed outbound call did not become first-response evidence: ${JSON.stringify(afterResponse.sla)}`);
  assert.equal(answeredFirstResponse.responseSourceType, "activity");
  assert.equal(answeredFirstResponse.responseSourceId, responseCall.id);
}

const intakeBody = {
  source: "company",
  channel: "website",
  intakeMethod: "form",
  externalEventId: `funnel-${run}`,
  party: {
    displayName: fixture.customerName,
    email: `client-${run}@wodana.invalid`,
    mobile: "+971501234567",
    preferredLocale: "en-AE",
    preferredTimezone: "Asia/Dubai",
  },
  title: fixture.enquiryTitle,
  details: { emirate: "dubai", area: "Dubai Hills" },
  summary: fixture.enquirySummary,
  serviceType: "not_sure",
  originalPayload: { form: "generic-funnel-smoke" },
  attribution: [{ source: "website", medium: "form", campaign: "uat" }],
};
const intakeHeaders = {
  ...owner,
  "idempotency-key": `funnel-intake-${run}`,
  "x-correlation-id": randomUUID(),
};
const intake = await request(`/workspaces/${workspaceId}/crm/intake-events`, {
  body: intakeBody,
  headers: intakeHeaders,
});
const intakeReplay = await request(`/workspaces/${workspaceId}/crm/intake-events`, {
  body: intakeBody,
  headers: { ...intakeHeaders, "x-correlation-id": randomUUID() },
});
assert(intake.intakeEventId);
assert.equal(intake.resolutionType, "new_identity");
assert.equal(intakeReplay.intakeEventId, intake.intakeEventId);
assert.equal(intakeReplay.enquiryId, intake.enquiryId);
assert.equal(intakeReplay.resolutionType, "new_identity");
assert.equal(intakeReplay.resolvedPartyId, intake.partyId);
const intakeDetail = await request(`/workspaces/${workspaceId}/crm/intake-events/${intake.intakeEventId}`);
assert.equal(intakeDetail.resolutionType, "new_identity");
assert.equal(intakeDetail.resolvedPartyId, intake.partyId);
assert.equal(intakeDetail.resolutionEvidence.matchStrength, "none");

const leads = await request(`/workspaces/${workspaceId}/crm/leads`);
const lead = leads.data.find((candidate) => candidate.partyId === intake.partyId);
assert(lead, "CRM intake must create a queryable lead.");
const initialConversion = {
  leadVersion: lead.version,
  partyId: lead.partyId,
  legalEntityId: workspace.legalEntities[0].id,
  pipelineId: pipeline.id,
  stageId: pipeline.stages[0].id,
  ownerMembershipId: ownerMember.id,
  title: fixture.opportunityTitle,
  description: "Qualified from the isolated synthetic intake path.",
  amount: 1500,
  currencyCode: "AED",
  expectedCloseAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
};
await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`, {
  body: initialConversion,
  expected: 422,
});
const selectedType = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/details`, {
  method: "PATCH",
  body: {
    version: lead.version,
    serviceType: "renovation_fit_out",
    summary: fixture.enquirySummary,
    party: intakeBody.party,
    details: intakeBody.details,
  },
});
await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualification`, {
  method: "PUT",
  body: { version: selectedType.version, values: { scope_confirmed: "yes", property_type: "villa" } },
  expected: 422,
});
const qualifiedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualification`, {
  method: "PUT",
  body: { version: selectedType.version, values: { scope_confirmed: true, property_type: "villa" } },
});
assert.equal(qualifiedLead.qualificationState.ready, true);
assert.equal(qualifiedLead.qualificationState.selection, "service_specific");
const conversionInput = { ...initialConversion, leadVersion: qualifiedLead.version };
const opportunity = await request(
  `/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`,
  { body: conversionInput },
);
assert.equal(opportunity.conversionOrigin, "lead_qualification");
assert.match(opportunity.qualificationEvidenceHash, /^[0-9a-f]{64}$/);
const conversionReplay = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`, { body: conversionInput });
assert.equal(conversionReplay.id, opportunity.id);
assert.equal(conversionReplay.conversionReplay, true);
await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`, {
  body: { ...conversionInput, title: "Changed retry" },
  expected: 409,
});
const convertedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`);
assert.equal(convertedLead.qualificationEvidenceHash, opportunity.qualificationEvidenceHash);
assert.equal(convertedLead.qualificationState.frozen, true);
const prepared = await request(`/workspaces/${workspaceId}/pre-projects`, {
  body: { opportunityId: opportunity.id },
});
const preparationReplay = await request(`/workspaces/${workspaceId}/pre-projects`, {
  body: { opportunityId: opportunity.id },
});
assert.equal(preparationReplay.id, prepared.id);
const caseId = prepared.id;
assert.equal(prepared.status, "active");
assert.equal(prepared.phase, "discover");
assert.equal(prepared.version, 1);
assert.equal(prepared.ownerMembershipId, ownerMember.id);
assert.equal(prepared.qualificationEvidenceHash, opportunity.qualificationEvidenceHash);
assert.equal(prepared.conversionOrigin, "lead_qualification");
assert.equal(prepared.qualificationEvidence.answers.find((answer) => answer.questionKey === "property_type")?.value, "villa");
const discoveryHandoff = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/brief`);
assert.equal(discoveryHandoff.brief.propertyType, "villa");
assert.equal(discoveryHandoff.fromCrm, true);
const healthLeads = await request(`/workspaces/${workspaceId}/crm/leads?limit=100`);
for (const groupBy of ["mainSource", "channel", "owner", "team", "enquiryType", "freshness"]) {
  const health = await request(`/workspaces/${workspaceId}/crm/reports/lead-flow?groupBy=${groupBy}`);
  assert.equal(health.groupBy, groupBy);
  assert.equal(health.reconciliation.matches, true);
  assert.equal(health.reconciliation.totalLeads, healthLeads.data.length);
  assert.equal(health.rows.reduce((total, row) => total + Number(row.leads), 0), healthLeads.data.length);
}
const slaHealth = await request(`/workspaces/${workspaceId}/crm/reports/sla`);
assert.equal(slaHealth.reconciliation.matches, true);
assert.equal(slaHealth.rows.reduce((total, row) => total + Number(row.count), 0), Number(slaHealth.summary.total));
assert.equal((await rawRequest(`/workspaces/${workspaceId}/crm/reports/lead-flow?groupBy=owner`, { headers: reviewer, method: "GET" })).status, 403);

const profileRequestId = randomUUID();
const profileInput = {
  requestId: profileRequestId,
  version: prepared.version,
  targetDate: "2026-10-15",
  priority: "high",
  riskLevel: "medium",
};
const profiled = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, {
  method: "PATCH",
  body: profileInput,
});
assert.equal(profiled.version, 2);
assert.equal(profiled.targetDate, profileInput.targetDate);
assert.equal(profiled.priority, "high");
assert.equal(profiled.riskLevel, "medium");
const preparationList = await request(`/workspaces/${workspaceId}/pre-projects`);
assert.equal(preparationList.items.find((item) => item.id === caseId)?.targetDate, profileInput.targetDate);
const profileReplay = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, {
  method: "PATCH",
  body: profileInput,
});
assert.equal(profileReplay.version, profiled.version);
await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, {
  method: "PATCH",
  expected: 409,
  body: { ...profileInput, riskLevel: "high" },
});
await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, {
  method: "PATCH",
  expected: 409,
  body: { requestId: randomUUID(), version: prepared.version, priority: "urgent" },
});
const concurrentProfiles = await Promise.all([
  rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, { method: "PATCH", body: { requestId: randomUUID(), version: profiled.version, riskLevel: "high" } }),
  rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/profile`, { method: "PATCH", body: { requestId: randomUUID(), version: profiled.version, riskLevel: "critical" } }),
]);
assert.deepEqual(concurrentProfiles.map((result) => result.status).sort(), [200, 409]);
const afterConcurrentProfile = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}`);
assert.equal(afterConcurrentProfile.version, profiled.version + 1);

const defined = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, {
  body: { requestId: randomUUID(), version: afterConcurrentProfile.version, action: "set_phase", phase: "define" },
});
assert.equal(defined.phase, "define");
await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, {
  expected: 400,
  body: { requestId: randomUUID(), version: defined.version, action: "set_phase", phase: "price" },
});
const holdRequest = { requestId: randomUUID(), version: defined.version, action: "hold", reason: "Waiting for a client decision" };
const duplicateHolds = await Promise.all([
  rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, { body: holdRequest }),
  rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, { body: holdRequest }),
]);
assert.deepEqual(duplicateHolds.map((result) => result.status), [201, 201]);
const held = duplicateHolds[0].body;
assert.equal(held.status, "on_hold");
assert.equal(held.phase, "define");
assert.equal(held.isOnHold, true);
assert.equal(duplicateHolds[1].body.version, held.version);
const heldRoom = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/rooms`, {
  method: "PUT",
  expected: 200,
  body: { id: randomUUID(), version: 0, name: "Survey room while held" },
});
assert.equal(heldRoom.name, "Survey room while held");
const resumed = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, {
  body: { requestId: randomUUID(), version: held.version, action: "resume", reason: "Client replied" },
});
assert.equal(resumed.status, "active");
assert.equal(resumed.phase, "define");
const cancelled = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, {
  body: { requestId: randomUUID(), version: resumed.version, action: "cancel", reason: "Cancellation recovery verification" },
});
assert.equal(cancelled.status, "cancelled");
const reopened = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/lifecycle`, {
  body: { requestId: randomUUID(), version: cancelled.version, action: "reopen", reason: "Client confirmed continuation" },
});
assert.equal(reopened.status, "active");
assert.equal(reopened.phase, "define");
const plannedProject = palmFixture ? null : await request(
  `/workspaces/${workspaceId}/projects/planning`,
  { body: { caseId } },
);

const portalSettings = await request(
  `/workspaces/${workspaceId}/commercial/portal-settings`,
);
await request(`/workspaces/${workspaceId}/commercial/portal-settings`, {
  body: {
    version: portalSettings.version,
    enabled: true,
    brand: palmFixture ? {
      ...portalSettings.brand,
      name: "Palm Living",
      primaryColor: palmLivingBrandFixture.secondaryColor,
      accentColor: palmLivingBrandFixture.primaryColor,
      layout: "minimal",
    } : portalSettings.brand,
  },
  method: "PUT",
});
const commercialPath = `/workspaces/${workspaceId}/commercial/cases/${caseId}`;
const mobile = `+9715${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
await request(`${commercialPath}/contacts`, {
  body: {
    name: fixture.customerName,
    phone: mobile,
    role: "approver",
    testContact: true,
  },
  method: "PUT",
});

const roomId = randomUUID();
const scopeId = randomUUID();
const sitePlanId = randomUUID();
const assetId = randomUUID();
const designId = randomUUID();
const designVersionId = randomUUID();
const measurementId = randomUUID();
const dimensionId = randomUUID();
const contentPath = `/workspaces/${workspaceId}/pre-projects/${caseId}`;
const deliveryCatalogId=randomUUID(),catalogRoomId=randomUUID(),catalogUnitId=randomUUID(),catalogWorkId=randomUUID();
await request(`/workspaces/${workspaceId}/catalog/collections`,{body:{id:deliveryCatalogId,name:'Synthetic delivery catalog',description:'Isolated source traceability acceptance',starter:false}});
const catalogRecord=(id,kind,code,name,links=[])=>({id,catalogId:deliveryCatalogId,version:0,kind,code,name,description:'Synthetic local acceptance record',market:'CUSTOM',aliases:[],attributes:[],sizes:[],sources:[],links,specificationStatus:'workspace_verified',dimension:kind==='unit'?'count':'none',...(kind==='unit'?{baseFactor:1}:{})});
const catalogRoom=catalogRecord(catalogRoomId,'room','DELIVERY_ROOM','Primary bedroom');
const catalogUnit=catalogRecord(catalogUnitId,'unit','DELIVERY_NOS','Number');
const catalogWork=catalogRecord(catalogWorkId,'work','DELIVERY_WARDROBE','Built-in wardrobe',[{relation:'unit',targetId:catalogUnitId},{relation:'room',targetId:catalogRoomId}]);
for(const record of [catalogRoom,catalogUnit,catalogWork]) await request(`/workspaces/${workspaceId}/catalog/records`,{method:'PUT',body:record});

await request(`${contentPath}/rooms`, {
  body: { id: roomId, version: 0, name: "Primary bedroom", catalogRecordId:catalogRoomId },
  method: "PUT",
});
await request(`${contentPath}/entries`, {
  body: {
    id: scopeId,
    version: 0,
    kind: "requirement",
    title: "Built-in wardrobe",
    roomId,
    note: "Four-door wardrobe with soft-close hardware.",
    category: "Joinery",
    priority: "must_have",
    scopeStatus: "included",
    reviewStatus: "reviewed",
    quantity: 2,
    unit: "nos",
    referenceUrl: "",
    avoid: "",
    source: "client",
    assetIds: [],
    catalogLinks: [{role:'work',recordId:catalogWorkId}],
  },
  method: "PUT",
});

const incompleteReadiness = await request(`${contentPath}/readiness?target=pricing`);
assert.equal(incompleteReadiness.ready, false);
assert.deepEqual(
  incompleteReadiness.nextActions.map((next) => next.code),
  [
    "ADD_SITE_PLAN",
    "PUBLISH_DEFINITION",
    "CREATE_SPECIFICATION",
    "RECORD_MEASUREMENT",
    "LINK_DESIGN_REVISION",
  ],
);

const png = readFileSync(
  new URL("../../../apps/web/public/brand/wodana/woddy-mark-v4.png", import.meta.url),
);
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "funnel-plan.png");
const upload = await fetch(`${api}${contentPath}/assets/${assetId}`, {
  method: "POST",
  headers: owner,
  body: form,
});
assert.equal(upload.status, 201, await upload.text());

await request(`${contentPath}/entries`, {
  body: {
    id: sitePlanId,
    version: 0,
    kind: "file",
    title: "Current site plan",
    note: "Current layout for measurement verification.",
    category: "Site layout",
    priority: "must_have",
    scopeStatus: "included",
    reviewStatus: "reviewed",
    quantity: 1,
    unit: "file",
    referenceUrl: "",
    avoid: "",
    source: "team",
    assetIds: [assetId],
    catalogLinks: [],
  },
  method: "PUT",
});
await request(`${contentPath}/designs/upload`, {
  body: {
    roomId,
    scopeEntryId: scopeId,
    note: "Controlled design for the accepted scope.",
    files: [
      {
        id: designId,
        versionId: designVersionId,
        assetId,
        title: "Wardrobe design",
        documentType: "Joinery / millwork detail",
        note: "Revision 1",
      },
    ],
  },
});
await request(`${contentPath}/specifications/${scopeId}`, {
  body: {
    version: 0,
    refinedRequirement: "Four-door wardrobe with soft-close hardware.",
    construction: "Workshop fabricated joinery.",
    inclusions: "Carcass, doors, hardware and installation.",
    exclusions: "Loose furniture.",
    assumptions: "Verified site opening.",
    materials: [],
    dimensions: [],
    designRefs: [{ versionId: designVersionId, usage: "2d", sheet: "R1" }],
  },
  method: "PUT",
});
await request(`${contentPath}/site/measurements`, {
  body: {
    id: measurementId,
    version: 0,
    title: "Wardrobe opening",
    note: "Verified site opening.",
    assetIds: [assetId],
    roomId,
    entryId: scopeId,
    specificationVersion: 1,
    dimensions: [
      {
        id: dimensionId,
        name: "Width",
        unit: "mm",
        basis: "site_opening",
        measured: 2400,
        source: "team",
        evidence: "Site image",
      },
    ],
  },
  method: "PUT",
});
await request(`${contentPath}/site/${measurementId}/review`, {
  body: { version: 1, status: "verified", note: "Dimension independently checked." },
});

async function designActivity(action, headers, extra = {}) {
  const design = (await request(`${contentPath}/designs`, { headers })).items.find(
    (item) => item.id === designId,
  );
  return request(`${contentPath}/designs/${designId}/activity`, {
    headers,
    body: {
      id: randomUUID(),
      version: design.version,
      versionId: designVersionId,
      action,
      note: "",
      decisionBy: "",
      ...extra,
    },
  });
}
await designActivity("internal_review", owner, {
  reviewerId: reviewerMember.userId,
  contextConfirmed: true,
});
await designActivity("internal_approved", reviewer, {
  note: "Drawing and specification checked.",
});
await designActivity("client_review", owner);
await designActivity("approved", owner, {
  note: "Client approved in the recorded design meeting.",
  decisionBy: fixture.customerName,
  decisionSource: "meeting",
  decisionAt: new Date().toISOString(),
});

const unpublishedReadiness = await request(`${contentPath}/readiness?target=pricing`);
assert.equal(unpublishedReadiness.ready, false);
assert.deepEqual(unpublishedReadiness.nextActions.map((next) => next.code), [
  "PUBLISH_DEFINITION",
]);

const definitionState = await request(`${contentPath}/definition-baselines`);
assert.equal(definitionState.draft.readyToPublish, true);
assert.equal(definitionState.current, null);
const definitionRequestId = randomUUID();
const definitionBaseline = await request(`${contentPath}/definition-baselines`, {
  body: {
    requestId: definitionRequestId,
    sourceHash: definitionState.draft.sourceHash,
    message: "Please confirm this requirements and design definition.",
  },
});
assert.equal(definitionBaseline.number, 1);
assert.equal(definitionBaseline.status, "awaiting_confirmation");
assert.match(definitionBaseline.snapshotHash, /^[0-9a-f]{64}$/);
const definitionReplay = await request(`${contentPath}/definition-baselines`, {
  body: {
    requestId: definitionRequestId,
    sourceHash: definitionState.draft.sourceHash,
    message: "Please confirm this requirements and design definition.",
  },
});
assert.equal(definitionReplay.id, definitionBaseline.id);
assert.equal(definitionReplay.replayed, true);

const loginChallenge = await request(`/client-portal/${slug}/challenge`, {
  body: { phone: mobile, purpose: "login" },
  headers: {},
});
const clientToken = (
  await request(`/client-portal/${slug}/login`, {
    body: { challengeId: loginChallenge.challengeId, code: "123456" },
    headers: {},
  })
).token;
const clientHeaders = { authorization: `Bearer ${clientToken}` };
const definitionPortal = await request(`/client-portal/${slug}/data`, {
  headers: clientHeaders,
});
const portalBaseline = definitionPortal.cases.find((item) => item.id === caseId).definitionBaseline;
assert.equal(portalBaseline.id, definitionBaseline.id);
assert.equal(portalBaseline.canDecide, true);
assert.equal(JSON.stringify(portalBaseline).includes("objectKey"), false);
const definitionChallenge = await request(`/client-portal/${slug}/challenge`, {
  body: {
    phone: mobile,
    purpose: `definition-decision:${caseId}:${definitionBaseline.id}:accept`,
  },
  headers: clientHeaders,
});
const definitionDecision = {
  caseId,
  action: "definition-decision",
  baselineId: definitionBaseline.id,
  decision: "accept",
  note: "",
  challengeId: definitionChallenge.challengeId,
  code: "123456",
};
await request(`/client-portal/${slug}/action`, {
  body: definitionDecision,
  headers: clientHeaders,
});
const definitionDecisionReplay = await request(`/client-portal/${slug}/action`, {
  body: definitionDecision,
  headers: clientHeaders,
});
assert.equal(definitionDecisionReplay.replayed, true);

const confirmedDefinition = await request(`${contentPath}/definition-baselines`);
assert.equal(confirmedDefinition.confirmed, true);
assert.equal(confirmedDefinition.current.status, "confirmed");
const initiallyReady = await request(`${contentPath}/readiness?target=pricing`);
assert.equal(initiallyReady.ready, true);

const currentSpecification = (
  await request(`${contentPath}/specifications/${scopeId}`)
).items[0];
await request(`${contentPath}/specifications/${scopeId}`, {
  method: "PUT",
  body: {
    version: currentSpecification.version,
    refinedRequirement: `${currentSpecification.refinedRequirement} Confirmed access clearance.`,
    construction: currentSpecification.construction,
    inclusions: currentSpecification.inclusions,
    exclusions: currentSpecification.exclusions,
    assumptions: currentSpecification.assumptions,
    materials: currentSpecification.materials.map((material) => ({
      id: material.id,
      application: material.application,
      materialId: material.materialId ?? null,
      brandId: material.brandId ?? null,
      finishId: material.finishId ?? null,
      productName: material.productName,
      productCode: material.productCode,
      finishCode: material.finishCode,
      stockSize: material.stockSize,
      status: material.status,
      selectedBy: material.selectedBy,
      selectedAt: material.selectedAt ?? null,
      evidence: material.evidence,
      assetIds: material.assetIds,
    })),
    dimensions: currentSpecification.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      unit: dimension.unit,
      basis: dimension.basis,
      approximate: dimension.approximate ?? null,
      measured: dimension.measured ?? null,
      source: dimension.source,
      evidence: dimension.evidence,
    })),
    designRefs: currentSpecification.designRefs.map((reference) => ({
      versionId: reference.versionId,
      usage: reference.usage,
      sheet: reference.sheet,
    })),
  },
});
const changedReadiness = await request(`${contentPath}/readiness?target=pricing`);
assert.equal(changedReadiness.ready, false);
assert.equal(changedReadiness.nextActions[0].code, "PUBLISH_DEFINITION");
const changedDefinition = await request(`${contentPath}/definition-baselines`);
assert.equal(changedDefinition.current.status, "superseded");
const replacementBaseline = await request(`${contentPath}/definition-baselines`, {
  body: {
    requestId: randomUUID(),
    sourceHash: changedDefinition.draft.sourceHash,
    message: "Please confirm the updated access requirement.",
  },
});
assert.equal(replacementBaseline.number, 2);
assert.equal(replacementBaseline.supersedesId, definitionBaseline.id);
const replacementChallenge = await request(`/client-portal/${slug}/challenge`, {
  body: {
    phone: mobile,
    purpose: `definition-decision:${caseId}:${replacementBaseline.id}:accept`,
  },
  headers: clientHeaders,
});
await request(`/client-portal/${slug}/action`, {
  body: {
    caseId,
    action: "definition-decision",
    baselineId: replacementBaseline.id,
    decision: "accept",
    note: "",
    challengeId: replacementChallenge.challengeId,
    code: "123456",
  },
  headers: clientHeaders,
});
const preparationReadiness = await request(`${contentPath}/readiness?target=pricing`);
assert.equal(preparationReadiness.ready, true);
assert.equal(preparationReadiness.summary.evaluatedItemCount, 1);
assert.equal(preparationReadiness.summary.blockerCount, 0);
assert.match(preparationReadiness.stateHash, /^[0-9a-f]{64}$/);
assert.equal(preparationReadiness.items[0].scopeItemId, scopeId);

let quoteId;
async function commercial(action, body = {}, headers = owner) {
  const state = await request(commercialPath, { headers });
  return request(commercialPath, {
    headers,
    body: {
      action,
      revision: state.data.revision,
      ...(quoteId ? { quoteId } : {}),
      ...body,
    },
  });
}

if (palmFixture) await commercial("set_palm_flow", { scope: {
  design: false, mainQuotation: true, materialSelection: false, procurement: true,
  manufacturing: false, siteWorks: false, installation: true,
} });
quoteId = (await commercial("create")).data.quotes[0].id;
let commercialState = await request(commercialPath);
const composerPath = `${commercialPath}/quotation-proposals`;
const composerRequestId = randomUUID();
const composerInput = {
  requestId: composerRequestId,
  quoteId,
  revision: commercialState.data.revision,
  mode: "scope",
};
const scopeProposal = await request(composerPath, { body: composerInput });
assert.equal(scopeProposal.run.proposal.items.length, 1);
assert.equal(scopeProposal.run.proposal.coverage.linkedSourceIds[0], scopeId);
assert.equal(scopeProposal.run.duplicates.length, 0);
const proposalReplay = await request(composerPath, { body: composerInput });
assert.equal(proposalReplay.replayed, true);
assert.equal(proposalReplay.run.id, scopeProposal.run.id);
const applyRequestId = randomUUID();
const applyInput = {
  requestId: applyRequestId,
  revision: commercialState.data.revision,
  selectedItemIds: [scopeProposal.run.proposal.items[0].id],
};
const appliedProposal = await request(
  `${composerPath}/${scopeProposal.run.id}/apply`,
  { body: applyInput },
);
assert.equal(appliedProposal.addedItemIds.length, 1);
assert.equal(appliedProposal.skippedDuplicateItemIds.length, 0);
const appliedReplay = await request(
  `${composerPath}/${scopeProposal.run.id}/apply`,
  { body: applyInput },
);
assert.equal(appliedReplay.replayed, true);
assert.equal(appliedReplay.revision, appliedProposal.revision);
const composerState = await request(
  `${commercialPath}/quotation-composer?quoteId=${quoteId}`,
);
assert.equal(composerState.runs[0].status, "applied");
assert.equal(composerState.runs[0].stale, false);
assert.equal(composerState.definition.id, replacementBaseline.id);
commercialState = await request(commercialPath);
const quote = commercialState.data.quotes.find((candidate) => candidate.id === quoteId);
assert.equal(quote.lines.length, 1);
assert.equal(quote.lines[0].scopeId, scopeId);
assert.equal(quote.lines[0].specificationVersion, 4);
Object.assign(quote.lines[0], {
  specification: "Four-door wardrobe with soft-close hardware.",
  material: "",
  finish: "",
  unitCost: 400,
  rate: 750,
  catalogPriceRequest: { action: 'override', reason: 'Synthetic negotiated wardrobe price including installation' },
});
quote.taxRate = 5;
quote.paymentTerms = [
  {
    id: randomUUID(),
    title: "Advance",
    percent: 50,
    trigger: "On agreement",
    requiredForRelease: true,
  },
  {
    id: randomUUID(),
    title: "Handover balance",
    percent: 50,
    trigger: "On handover",
    requiredForRelease: false,
  },
];
await commercial("save", { quote });
const submittedQuotation = await commercial("submit");
assert.deepEqual(
  submittedQuotation.data.quotes.find((candidate) => candidate.id === quoteId)
    .definitionBaseline,
  {
    id: replacementBaseline.id,
    number: replacementBaseline.number,
    hash: replacementBaseline.snapshotHash,
  },
);
await commercial(palmFixture ? "qs_approve" : "approve", {}, palmFixture ? reviewer : owner);
commercialState = await request(commercialPath);
const approverId = commercialState.contacts.find((contact) => contact.phone === mobile).id;
await commercial("issue", { approverId });

const decisionChallenge = await request(`/client-portal/${slug}/challenge`, {
  body: { phone: mobile, purpose: `decision:${caseId}:${quoteId}:accept` },
  headers: clientHeaders,
});
await request(`/client-portal/${slug}/action`, {
  body: {
    caseId,
    action: "decision",
    quoteId,
    decision: "accept",
    note: "",
    challengeId: decisionChallenge.challengeId,
    code: "123456",
  },
  headers: clientHeaders,
});

await commercial("agreement", {
  quoteId,
  reference: "AGR-FUNNEL-1",
  terms: "Accepted quotation terms.",
  evidence: "Signed agreement reference SIG-FUNNEL-1",
});
await commercial("execute_agreement");
commercialState = await request(commercialPath);
const releasePayment = commercialState.data.payments.find((payment) => payment.requiredForRelease);
assert(releasePayment, "The accepted quotation must create a release payment milestone.");
await commercial("report_payment_receipt", {
  paymentId: releasePayment.id,
  reference: "SYNTHETIC-ADVANCE-RECEIPT",
  evidence: "Synthetic local-only bank receipt evidence; no provider or real payment.",
});
await commercial("verify_payment", { paymentId: releasePayment.id }, reviewer);
const wonCandidate = await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}`);
await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/transition`, {
  body: { version: wonCandidate.version, stageId: pipeline.stages.find(stage => stage.code === "won").id, status: "won", reason: "Client accepted the synthetic quotation." },
});
if (palmFixture) {
  await request(`/workspaces/${workspaceId}/roles`, {
    body: { code: "uat_sales_submitter", name: "UAT Sales submitter", permissionCodes: ["pre_projects.view", "pre_projects.edit"] },
  });
}
const opsInvitation = await request(`/workspaces/${workspaceId}/invitations`, {
  body: { email: operationsApprover["x-wodana-user-email"], roleCodes: palmFixture ? ["operations_approver", "uat_sales_submitter"] : ["operations_approver"] },
});
await request(`/workspaces/invitations/${opsInvitation.id}/accept`, { headers: operationsApprover, method: "POST" });
await commercial("submit_owner_review", {
  commissionLines: [{ recipientName: "Synthetic Sales", type: "sales", basis: "amount", value: 10 }],
  paymentProofUrl: "https://example.com/synthetic-payment-proof",
  checklist: {
    agreement: true,
    boq: true,
    documents: true,
    margin: true,
    materials: true,
    payment: true,
  },
  note: "Accepted scope and commercial evidence checked.",
}, palmFixture ? operationsApprover : owner);
await commercial("review_deal_finance", {
  decision: "confirm",
  paymentVerified: true,
  commissionLines: [{ recipientName: "Synthetic Sales", type: "sales", basis: "amount", value: 10 }],
  note: "Synthetic payment evidence and commission checked.",
}, reviewer);
await commercial(
  "decide_owner_review",
  { decision: "approve", note: "Independent Operations review complete." },
  palmFixture ? owner : operationsApprover,
);
const released = await commercial("release", {
  note: "Approved for delivery planning.",
});
const projectId = released.data.release.projectId;
assert(projectId);
if (!palmFixture) assert.equal(projectId, plannedProject.id);

commercialState = await request(commercialPath);
const project = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/execution`,
);
const releasedLine = project.data.scope.lines[0];
assert.equal(project.caseId, caseId);
assert.deepEqual(project.sites, []);
assert.equal(project.data.initiation.status, "not_started");
assert.equal(project.data.initiation.commercial.quoteId, quoteId);
assert.equal(project.data.initiation.commercial.dealFileId, commercialState.data.dealFile.id);
assert.equal(project.data.scope.quoteId, quoteId);
assert.equal(project.data.scope.quoteHash, commercialState.data.dealFile.quoteHash);
assert.equal(project.data.scope.dealFileId, commercialState.data.dealFile.id);
assert.equal(project.data.scope.releaseId, commercialState.data.release.id);
assert.deepEqual(
  project.data.scope.definitionBaseline,
  commercialState.data.dealFile.definitionBaseline,
);
assert.equal(releasedLine.id, quote.lines[0].id);
assert.equal(releasedLine.sourceScopeId, scopeId);
assert.equal(releasedLine.sourceScopeVersion, quote.lines[0].scopeVersion);
assert.equal(releasedLine.sourceSpecificationVersion, 4);
assert.equal(releasedLine.rate, 750);
assert.equal(releasedLine.lineTotal, 1500);
assert.equal("unitCost" in releasedLine, false);
assert.equal("photo" in releasedLine, false);
// Editing the reusable master must not rewrite the captured requirement or released BOQ.
await request(`/workspaces/${workspaceId}/catalog/records`,{method:'PUT',body:{...catalogWork,version:1,name:'Updated master wardrobe'}});
const capturedSpecification=await request(`${contentPath}/specifications/${scopeId}`);
assert(capturedSpecification.items[0].requirement.catalogLinks.some(link=>link.recordId===catalogWorkId&&link.snapshot.name==='Built-in wardrobe'));
const afterCatalogEdit=await request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
assert.deepEqual(afterCatalogEdit.data.scope,project.data.scope);
assert.equal(project.data.workflow.template.id, projectWorkflowTemplateId);
assert.equal(project.data.workflow.template.version, 1);
assert.equal(project.data.workflow.template.stages[0].visibleName, projectFirstStageName);
assert.equal(project.data.workflow.currentStageKey, palmFixture ? "procurement" : "planning");
if (palmFixture) {
  assert(project.data.workflow.template.stages.some(stage => stage.key === "procurement"));
  assert(!project.data.workflow.template.stages.some(stage => stage.key === "factory_production"));
  assert(!project.data.workflow.template.stages.some(stage => stage.key === "manufacturing_readiness"));
  assert.deepEqual(project.data.workflow.template.stages.find(stage => stage.key === "procurement")?.exitGates, []);
}

await request(`${workflowPath}/${projectWorkflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 1,
    code: projectWorkflowCode,
    name: "Tenant delivery",
    description: "Updated for future projects only.",
    isDefault: true,
    stages: projectWorkflowStages.map((stage, index) => ({
      ...stage,
      visibleName: index === 0 ? "Future planning" : stage.visibleName,
    })),
  },
});
assert.equal(
  (
    await request(
      `/workspaces/${workspaceId}/projects/${projectId}/execution`,
    )
  ).data.workflow.template.stages[0].visibleName,
  projectFirstStageName,
);

async function projectCommand(action, body = {}, expected = 201) {
  const state = await request(
    `/workspaces/${workspaceId}/projects/${projectId}/execution`,
  );
  return request(
    `/workspaces/${workspaceId}/projects/${projectId}/execution`,
    {
      expected,
      body: {
        action,
        revision: state.data.revision,
        requestId: randomUUID(),
        ...body,
      },
    },
  );
}

const initiationDay = new Date().toISOString().slice(0, 10);
await projectCommand("project_initiation", {
  initiation: {
    projectOwnerId: ownerMember.id,
    teamMemberIds: [ownerMember.id],
    roleAssignments: [{ role: "project_manager", memberId: ownerMember.id }],
    siteReadiness: "to_confirm",
    siteIds: [],
    objective: "Deliver the accepted design and scope.",
    clientPromise: "Confirm the site plan before mobilising.",
    clientContactName: "QA contact",
    clientContactPhone: "",
    clientContactEmail: "",
    accessNotes: "Site access remains to be confirmed.",
    operationalStart: initiationDay,
    targetCompletion: initiationDay,
    handoverDate: "",
  },
});
const initiated = await request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
assert.equal(initiated.data.initiation.status, "confirmed");
assert.equal(initiated.data.initiation.baseline.projectOwnerId, ownerMember.id);
assert.equal(initiated.data.initiation.commercial.quoteId, quoteId);
await projectCommand("project_roles", {
  assignments: [{ role: "project_manager", memberId: reviewerMember.id }],
}, 409);
await projectCommand("project_roles", {
  assignments: [{ role: "project_manager", memberId: ownerMember.id }],
});
const designResourceId = randomUUID();
await projectCommand("resource", {
  resource: {
    id: designResourceId,
    name: "Design Team",
    kind: "crew",
    members: [ownerMember.id],
    active: true,
    businessUnitId: designUnit.id,
    capacityMode: "exclusive",
    capacity: 1,
    timezone: "Asia/Dubai",
    calendar: {
      weekdays: [1, 2, 3, 4, 5],
      startTime: "08:00",
      endTime: "18:00",
      holidays: [],
    },
  },
});
const deliveryTaskId = randomUUID();
await projectCommand("task", {
  task: {
    id: deliveryTaskId,
    parentId: "",
    package: "Delivery planning",
    title: "Coordinate accepted scope",
    description: "API workflow transition fixture.",
    area: "Project-wide",
    location: "office",
    ownerId: ownerMember.id,
    assigneeIds: [],
    resourceId: designResourceId,
    start: "2026-09-16",
    end: "2026-09-17",
    predecessors: [],
    quantity: 1,
    unit: "item",
    weight: 1,
    priority: "normal",
    inspectionRequired: false,
    scopeIds: [releasedLine.id],
    drawingId: "",
    readiness: { scope: true, access: true, materials: true },
  },
});
await projectCommand("milestone", {
  milestone: {
    id: randomUUID(),
    title: "Design coordination complete",
    dueDate: "2026-09-17",
    ownerId: ownerMember.id,
    taskIds: [deliveryTaskId],
    visibleToClient: true,
  },
});
let scheduleState = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/execution`,
);
const bookingRequestId = randomUUID();
const bookingInput = {
  taskId: deliveryTaskId,
  status: "confirmed",
  units: 1,
  startTime: "09:00",
  endTime: "12:00",
  note: "Design capacity confirmed for delivery planning.",
};
const bookingPreview = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/preview`,
  { body: bookingInput },
);
assert.equal(bookingPreview.canConfirm, true);
assert.equal(bookingPreview.blockers.length, 0);
const savedBooking = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings`,
  {
    method: "PUT",
    body: {
      ...bookingInput,
      projectRevision: scheduleState.data.revision,
      bookingVersion: 0,
      requestId: bookingRequestId,
    },
  },
);
assert.equal(savedBooking.status, "confirmed");
assert.equal(savedBooking.version, 1);
assert.equal(
  (
    await request(`/workspaces/${workspaceId}/projects/${projectId}/bookings`, {
      method: "PUT",
      body: {
        ...bookingInput,
        projectRevision: scheduleState.data.revision,
        bookingVersion: 0,
        requestId: bookingRequestId,
      },
    })
  ).id,
  savedBooking.id,
);
const availability = await request(
  `/workspaces/${workspaceId}/projects/schedule/availability?from=2026-09-16&to=2026-09-17&businessUnitId=${designUnit.id}`,
);
assert.equal(availability.resources.length, 1);
assert(availability.availability[0].segments.some((segment) =>
  segment.confirmed === 1 && segment.remaining === 0));
const projectCalendar = await request(
  `/workspaces/${workspaceId}/projects/calendar?from=2026-09-16&to=2026-09-17&businessUnitId=${designUnit.id}`,
);
assert.equal(projectCalendar.events.length, 2);
assert(projectCalendar.events.every((event) => event.department.color === "#DC2626"));
assert(projectCalendar.items.some((item) => item.kind === "milestone" && item.projectId === projectId));
const alternateResourceId = randomUUID();
await projectCommand("resource", {
  resource: {
    id: alternateResourceId,
    name: "Alternate Design Team",
    kind: "crew",
    members: [ownerMember.id],
    active: true,
    businessUnitId: designUnit.id,
    capacityMode: "exclusive",
    capacity: 1,
    timezone: "Asia/Dubai",
    calendar: {
      weekdays: [1, 2, 3, 4, 5],
      startTime: "08:00",
      endTime: "18:00",
      holidays: [],
    },
  },
});
const overlappingTaskId = randomUUID();
await projectCommand("task", {
  task: {
    id: overlappingTaskId,
    parentId: "",
    package: "Delivery planning",
    title: "Overlapping design review",
    description: "Confirms member-level capacity across two crews.",
    area: "Project-wide",
    location: "office",
    ownerId: ownerMember.id,
    assigneeIds: [],
    resourceId: alternateResourceId,
    start: "2026-09-16",
    end: "2026-09-17",
    predecessors: [],
    quantity: 1,
    unit: "item",
    weight: 1,
    priority: "normal",
    inspectionRequired: false,
    scopeIds: [releasedLine.id],
    drawingId: "",
    readiness: { scope: true, access: true, materials: true },
  },
});
const hardConflict = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/preview`,
  { body: { taskId: overlappingTaskId, status: "confirmed", startTime: "10:00", endTime: "11:00" } },
);
assert.equal(hardConflict.canConfirm, false);
assert(hardConflict.blockers.some((message) => message.includes("team member")));
const tentativePreview = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/preview`,
  { body: { taskId: overlappingTaskId, status: "tentative", startTime: "10:00", endTime: "11:00" } },
);
assert.equal(tentativePreview.blockers.length, 0);
assert(tentativePreview.warnings.some((message) => message.includes("team member")));
scheduleState = await request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
const tentativeBooking = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings`,
  {
    method: "PUT",
    body: {
      taskId: overlappingTaskId,
      status: "tentative",
      startTime: "10:00",
      endTime: "11:00",
      note: "Awaiting final design allocation.",
      units: 1,
      projectRevision: scheduleState.data.revision,
      bookingVersion: 0,
      requestId: randomUUID(),
    },
  },
);
assert.equal(tentativeBooking.status, "tentative");
const activeCalendar = await request(
  `/workspaces/${workspaceId}/projects/calendar?from=2026-09-16&to=2026-09-17&bookingStatus=active`,
);
assert.equal(activeCalendar.events.length, 4);
assert(activeCalendar.events.some((event) => event.bookingStatus === "tentative"));
const cancelledTentative = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/${overlappingTaskId}/cancel`,
  {
    body: {
      bookingVersion: tentativeBooking.version,
      requestId: randomUUID(),
      reason: "Design allocation changed after capacity review.",
    },
  },
);
assert.equal(cancelledTentative.status, "cancelled");
let workflowState;
if (palmFixture) {
  workflowState = await request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
  assert.equal(workflowState.data.workflow.currentStageKey, "procurement");
} else {
  workflowState = await projectCommand("workflow_transition", {
    toStageKey: "delivery",
    note: "Delivery plan and ownership reviewed.",
  });
  assert.equal(workflowState.data.workflow.currentStageKey, "delivery");
  assert.equal(workflowState.data.workflow.history.at(-1).action, "advanced");
}

workflowState = await projectCommand("project_controls", {
  controls: {
    ...workflowState.data.controls,
    onHold: true,
    holdReason: "Awaiting client access",
    holdOwnerId: ownerMember.id,
  },
});
assert.equal(workflowState.data.holdHistory.at(-1).action, "placed");
const holdPreview = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/preview`,
  { body: { taskId: overlappingTaskId, status: "confirmed", startTime: "10:00", endTime: "11:00" } },
);
assert(holdPreview.blockers.some((message) => message.includes("project hold")));
await projectCommand(
  "workflow_transition",
  { toStageKey: palmFixture ? "installation" : "handover", note: "" },
  409,
);
workflowState = await projectCommand("project_controls", {
  controls: {
    ...workflowState.data.controls,
    onHold: false,
    holdReason: "",
    holdOwnerId: "",
  },
});
assert.equal(workflowState.data.holdHistory.at(-1).action, "released");
assert.equal(
  workflowState.data.holdHistory.at(-1).reason,
  "Awaiting client access",
);

const releasedBooking = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/bookings/${deliveryTaskId}/cancel`,
  {
    body: {
      bookingVersion: savedBooking.version,
      requestId: randomUUID(),
      reason: "Release capacity before the concurrency check.",
    },
  },
);
assert.equal(releasedBooking.status, "cancelled");
scheduleState = await request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
const parallelConfirm = (taskId) => fetch(
  `${api}/workspaces/${workspaceId}/projects/${projectId}/bookings`,
  {
    method: "PUT",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({
      taskId,
      status: "confirmed",
      units: 1,
      startTime: "10:00",
      endTime: "11:00",
      note: "Concurrent capacity verification.",
      projectRevision: scheduleState.data.revision,
      bookingVersion: 0,
      requestId: randomUUID(),
    }),
  },
);
const parallelResults = await Promise.all([
  parallelConfirm(deliveryTaskId),
  parallelConfirm(overlappingTaskId),
]);
assert.deepEqual(parallelResults.map((response) => response.status).sort(), [200, 409]);
const confirmedResponse = parallelResults.find((response) => response.status === 200);
assert(confirmedResponse);
const concurrentlyConfirmed = await confirmedResponse.json();
await projectCommand("task_status", {
  id: concurrentlyConfirmed.taskId,
  status: "cancelled",
  note: "Cancellation verifies task and booking lifecycle stay aligned.",
});
const calendarAfterTaskCancellation = await request(
  `/workspaces/${workspaceId}/projects/calendar?from=2026-09-16&to=2026-09-17&bookingStatus=active`,
);
assert.equal(calendarAfterTaskCancellation.events.length, 0);

const linkedOpportunity = await request(
  `/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}`,
);
assert.equal(linkedOpportunity.lead_id ?? linkedOpportunity.leadId, lead.id);
assert.equal(linkedOpportunity.projectLink.projectId, projectId);
assert.equal((await request(`/workspaces/${workspaceId}/pre-projects/${caseId}`)).status, "released");
assert.equal(
  (await request(`/workspaces/${workspaceId}/projects/from-pre-project`, {
    body: { caseId },
  })).id,
  projectId,
);

const changeCreated = await commercial("create_change_case", {
  kind: "replacement",
  sourceLineIds: [releasedLine.id],
  title: "Replace the approved wardrobe",
  detail: "Use the newly selected finish while preserving the accepted history.",
  owner: fixture.ownerName,
  dueDate: "",
});
const changeId = changeCreated.data.requests.at(-1).id;
const changeAssessed = await commercial("assess_change_case", { requestId: changeId });
const impact = changeAssessed.data.requests.find((item) => item.id === changeId).control.impact;
assert.equal(impact.projectId, projectId);
assert(impact.targets.length > 0);
const dispositions = impact.targets.map((target) => ({
  targetKind: target.kind,
  targetId: target.id,
  action: "hold_and_replan",
  note: "Pause this affected record and replan after client acceptance.",
}));
await commercial("set_change_dispositions", { requestId: changeId, dispositions });
const changePrepared = await commercial("prepare_change_variations", { requestId: changeId });
const controlled = changePrepared.data.requests.find((item) => item.id === changeId).control;
assert.equal(controlled.quoteIds.length, 2);
assert.deepEqual(controlled.quoteIds.map((id) => changePrepared.data.quotes.find((quote) => quote.id === id).direction), ["deduction", "addition"]);

const jobs = await request(`/workspaces/${workspaceId}/jobs`);
assert.equal(jobs.total, palmFixture ? 3 : 2);
assert.equal(jobs.items.length, palmFixture ? 3 : 2);
assert(jobs.items.every((item) => /^J-\d{6,}$/.test(item.reference)));
const projectJobSummary = jobs.items.find((item) => item.links.some((link) => link.type === "project" && link.id === projectId));
const sharedJobSummary = jobs.items.find((item) => item.links.some((link) => link.type === "enquiry" && link.id === sharedLead.enquiryId));
assert(projectJobSummary, "The released project must stay on its originating Job.");
assert(sharedJobSummary, "The shared-link enquiry must receive its own Job identity.");
if (palmFixture) {
  assert(jobs.items.some((item) => item.links.some((link) =>
    link.type === "lead" && link.id === staffAssignedLead.id)),
  "The staff-created Palm enquiry must receive its own Job identity.");
}
const job = await request(`/workspaces/${workspaceId}/jobs/${projectJobSummary.jobId}`);
assert.equal(job.jobId, projectJobSummary.jobId);
assert.equal(job.missingSourceCount, 0);
assert.equal(job.phase, "deliver");
assert.equal(job.accessLimited, false);
assert.equal(job.phaseSource.type, "project");
assert(job.nextAction?.route === `/workspace/projects/${projectId}`);
assert(Array.isArray(job.timeline) && job.timeline.some((event) => event.kind === "source_link"));
assert(job.links.some((link) => link.type === "project" && link.id === projectId));
assert(changePrepared.data.quotes.every((quote) => job.links.some((link) => link.type === "quote" && link.id === quote.id && link.caseId === caseId)));
const stageRequestId = randomUUID();
const stagePath = `/workspaces/${workspaceId}/jobs/${projectJobSummary.jobId}/stage`;
const stageInput = {
  stage: "Mobilisation ready",
  reason: "The release gates passed and delivery ownership is confirmed.",
  expectedVersion: 0,
  requestId: stageRequestId,
};
const stageSet = await request(stagePath, { method: "PUT", body: stageInput, expected: 200 });
assert.deepEqual({ phase: stageSet.phase, stage: stageSet.stage, version: stageSet.version, replayed: stageSet.replayed }, {
  phase: "deliver", stage: "Mobilisation ready", version: 1, replayed: false,
});
const stageReplay = await request(stagePath, { method: "PUT", body: stageInput, expected: 200 });
assert.equal(stageReplay.replayed, true);
const staleStage = await rawRequest(stagePath, {
  method: "PUT",
  body: { ...stageInput, stage: "Started", requestId: randomUUID() },
});
assert.equal(staleStage.status, 409);
const stagedJob = await request(`/workspaces/${workspaceId}/jobs/${projectJobSummary.jobId}`);
assert.deepEqual({ label: stagedJob.stage.label, manual: stagedJob.stage.manual, version: stagedJob.stage.version }, {
  label: "Mobilisation ready", manual: true, version: 1,
});
assert(stagedJob.timeline.some((event) => event.kind === "stage" && event.title === "Stage set to Mobilisation ready"));
const unknownJob = await rawRequest(`/workspaces/${workspaceId}/jobs/${randomUUID()}`, { method: "GET" });
assert.equal(unknownJob.status, 404);

const searchTerm = fixture.customerName.split(/[ (]/)[0];
const ownerSearch = await request(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(searchTerm)}&limit=50`);
assert.deepEqual(
  [...new Set(ownerSearch.items.map((item) => item.kind))].sort(),
  ["customer", "job", "project", "quotation", "room"],
);
const reviewerSearch = await request(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(searchTerm)}&limit=50`, { headers: reviewer });
assert.deepEqual(
  reviewerSearch.searchedKinds,
  palmFixture ? ["customer", "job", "room", "quotation"] : ["job", "room", "quotation"],
);
assert.deepEqual(
  [...new Set(reviewerSearch.items.map((item) => item.kind))].sort(),
  palmFixture ? ["customer", "job", "quotation", "room"] : ["job", "quotation", "room"],
);
assert(reviewerSearch.items.some((item) => item.kind === "room" && item.id === roomId));
assert(reviewerSearch.items.some((item) => item.kind === "quotation" && item.id === quoteId));
assert.equal((await rawRequest(`/workspaces/${workspaceId}/projects/${projectId}/execution`, { headers: reviewer, method: "GET" })).status, 403);
assert.equal((await rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/brief`, { headers: reviewer, method: "GET" })).status, 200);

await request(`/workspaces/${workspaceId}/teams/${reviewerTeam.id}/archive`, {
  body: { version: reviewerTeam.version },
});
if (palmSalesTeam) {
  await request(`/workspaces/${workspaceId}/teams/${palmSalesTeam.id}/archive`, {
    body: { version: palmSalesTeam.version },
  });
}
const revokedReviewerSearch = await request(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(searchTerm)}&limit=50`, { headers: reviewer });
assert.deepEqual(revokedReviewerSearch, { query: searchTerm, items: [], searchedKinds: [], truncated: false });
assert.equal((await rawRequest(`/workspaces/${workspaceId}/jobs/${projectJobSummary.jobId}`, { headers: reviewer, method: "GET" })).status, 403);
assert.equal((await rawRequest(`/workspaces/${workspaceId}/pre-projects/${caseId}/brief`, { headers: reviewer, method: "GET" })).status, 403);

for (const [person, roleCode, permissionCodes] of [
  [jobViewer, "job_viewer", ["crm.leads.view"]],
  [jobDenied, "job_denied", ["legal_entities.view"]],
]) {
  await request(`/workspaces/${workspaceId}/roles`, {
    body: { code: roleCode, name: roleCode, permissionCodes },
  });
  const invite = await request(`/workspaces/${workspaceId}/invitations`, {
    body: { email: person["x-wodana-user-email"], roleCodes: [roleCode] },
  });
  await request(`/workspaces/invitations/${invite.id}/accept`, { headers: person, method: "POST" });
}
const viewerJobs = await request(`/workspaces/${workspaceId}/jobs`, { headers: jobViewer });
assert.equal(viewerJobs.total, palmFixture ? 3 : 2);
const viewerProjectJob = viewerJobs.items.find((item) => item.jobId === projectJobSummary.jobId);
assert(viewerProjectJob);
assert.deepEqual(viewerProjectJob.links.map((link) => link.type).sort(), ["enquiry", "lead"]);
assert.equal(viewerProjectJob.phase, "unknown");
assert.equal(viewerProjectJob.accessLimited, true);
assert.equal(viewerProjectJob.nextAction, null);
const deniedJobs = await rawRequest(`/workspaces/${workspaceId}/jobs`, { headers: jobDenied, method: "GET" });
assert.equal(deniedJobs.status, 403);
const outsiderJobs = await rawRequest(`/workspaces/${workspaceId}/jobs`, { headers: outsider, method: "GET" });
assert.equal(outsiderJobs.status, 404);
const repairPath = `/workspaces/${workspaceId}/jobs/${job.jobId}/links/repair`;
const repairInput = {
  recordType: "quote", recordId: quoteId, caseId,
  expectedVersion: 1, requestId: randomUUID(), reason: "Review quotation link",
};
const deniedRepair = await rawRequest(repairPath, { headers: jobViewer, body: repairInput });
assert.equal(deniedRepair.status, 403);
const healthyRepair = await rawRequest(repairPath, { body: repairInput });
assert.equal(healthyRepair.status, 409, "healthy links must not be silently rewritten");

let jobIdentityLinked = false;
if (process.env.DATABASE_URL) {
  const databaseEndpoint = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseEndpoint.hostname)
    || !databaseEndpoint.pathname.startsWith("/wodana_funnel_test_"))
    throw new Error("Job ledger smoke requires the disposable local funnel database.");
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await database.connect();
    await database.query("BEGIN READ ONLY");
    await database.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const jobs = await database.query(
      "SELECT id,reference FROM job_identities WHERE workspace_id=$1",
      [workspaceId],
    );
    assert.equal(jobs.rowCount, palmFixture ? 3 : 2,
      "the shared-link, staff-created Palm enquiry, and qualified enquiry must each retain a Job");
    assert(jobs.rows.every((row) => /^J-\d{6,}$/.test(row.reference)));
    const projectJob = await database.query(
      `SELECT job_id FROM job_identity_links
       WHERE workspace_id=$1 AND record_type='project' AND record_id=$2 AND status='active'`,
      [workspaceId, projectId],
    );
    assert.equal(projectJob.rowCount, 1);
    const links = await database.query(
      "SELECT record_type,record_id,case_id FROM job_identity_links WHERE workspace_id=$1 AND job_id=$2 AND status='active'",
      [workspaceId, projectJob.rows[0].job_id],
    );
    for (const [type, id] of [
      ["enquiry", intake.enquiryId], ["lead", lead.id], ["opportunity", opportunity.id],
      ["case", caseId], ["project", projectId],
    ]) {
      assert(links.rows.some((link) => link.record_type === type && link.record_id === id), `${type} must link to the Job`);
    }
    for (const quote of changePrepared.data.quotes)
      assert(links.rows.some((link) => link.record_type === "quote" && link.record_id === quote.id && link.case_id === caseId),
        `quote ${quote.id} must link to its case's Job`);
    const events = await database.query(
      "SELECT count(*)::int AS total FROM job_identity_link_events WHERE workspace_id=$1 AND job_id=$2",
      [workspaceId, projectJob.rows[0].job_id],
    );
    assert.equal(events.rows[0].total, links.rowCount, "replay must not duplicate Job-link audit events");
    const consent = await database.query(
      `SELECT status,evidence FROM crm_consents
       WHERE workspace_id=$1 AND party_id=$2 AND purpose='service' AND channel='all'`,
      [workspaceId, sharedLead.partyId],
    );
    assert.equal(consent.rowCount, 1);
    assert.equal(consent.rows[0].status, "granted");
    assert.equal(consent.rows[0].evidence.method, "public_enquiry_form");
    assert.equal(consent.rows[0].evidence.formRevision, publicSharedForm.revision);
    await database.query("ROLLBACK");
    jobIdentityLinked = true;
  } finally {
    await database.end();
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      workspaceId,
      fixture: palmFixture ? "palm_synthetic_uat" : "generic_funnel",
      operationsActor: owner["x-wodana-user-email"],
      secondRoleActor: reviewer["x-wodana-user-email"],
      clientActor: `${fixture.customerName} · purpose-bound local portal challenge`,
      sharedFormId: sharedForm.id,
      sharedEnquiryId: sharedLead.enquiryId,
      intakeId: intake.intakeEventId,
      enquiryId: intake.enquiryId,
      leadId: lead.id,
      opportunityId: opportunity.id,
      caseId,
      quoteId,
      dealFileId: commercialState.data.dealFile.id,
      projectId,
      palmCatalogRecordCount,
      assertions: {
        apiBusinessRecordsOnly: true,
        isolatedPalmFixture: palmFixture,
        palmBrandConfigured,
        palmCatalogImported,
        sharedLinkReplaySafe: true,
        sharedLinkAttributionSafe: true,
        sharedLinkRawAnswersSafe: true,
        sharedLinkConsentSafe: true,
        duplicateCandidatesPreserved: true,
        palmIntakeProfileExact: palmFixture,
        palmSalesTeamInherited: palmFixture,
        staffNamedOwnerEligible: palmFixture,
        immediateAssignmentNotificationSafe: palmFixture,
        elapsedTakeoverSafe: palmFixture,
        noteStopsTakeoverNotSla: palmFixture,
        responseWorkspaceProvenanceSafe: palmFixture,
        responseWorkspaceActionsSafe: palmFixture,
        outboundCallEvidenceSafe: palmFixture,
        palmBusinessHoursSlaExact: palmFixture,
        secondRoleReviewSafe: true,
        clientActorPurposeBound: true,
        intakeReplaySafe: true,
        intakeResolutionEvidenceSafe: true,
        qualificationEvidenceSafe: true,
        qualificationHandoffVisible: true,
        frozenDiscoveryDefaultsSafe: true,
        crmHealthReportsReconciled: true,
        crmHealthDimensionsComplete: true,
        crmReportPermissionDenied: true,
        conversionReplaySafe: true,
        preparationReplaySafe: true,
        engagementProfileReplaySafe: true,
        engagementConcurrencySafe: true,
        engagementPhaseGovernanceSafe: true,
        engagementHoldWriteSafe: true,
        engagementCancellationRecoverySafe: true,
        preparationReadinessSafe: true,
        definitionBaselineImmutable: true,
        definitionSupersessionSafe: true,
        definitionClientDecisionReplaySafe: true,
        definitionLineagePreserved: true,
        quotationProposalReplaySafe: true,
        quotationProposalDuplicateSafe: true,
        quotationProposalDefinitionBound: true,
        acceptedHashPreserved: true,
        scopeLineagePreserved: true,
        projectReleaseReplaySafe: true,
        workflowTemplateFallbackSafe: true,
        workflowTemplateVersionSafe: true,
        workflowTemplateArchiveSafe: true,
        workflowTemplateFrozenPerProject: true,
        workflowTransitionGatesSafe: true,
        projectHoldHistorySafe: true,
        projectScheduleCapacitySafe: true,
        projectScheduleReplaySafe: true,
        projectScheduleConflictSafe: true,
        projectScheduleHistorySafe: true,
        projectScheduleHoldSafe: true,
        projectScheduleInformationSafe: true,
        projectScheduleConcurrentWriteSafe: true,
        projectScheduleTaskLifecycleSafe: true,
        preReleasePlanningPreserved: true,
        controlledReplacementPrepared: true,
        jobIdentityLinked,
        jobIdentityApi: true,
        jobIdentityPermissionScope: true,
        jobIdentityRepairGuard: true,
        jobOperatingProjectionSafe: true,
        jobStageReplaySafe: true,
        jobTimelineSafe: true,
      },
    },
    null,
    2,
  )}\n`,
);
