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
const servicePathWorkflowFixture = JSON.parse(readFileSync(new URL("../../../docs/fixtures/palm-project-workflow.json", import.meta.url), "utf8"));
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
const projectWorkflowStages = palmFixture ? servicePathWorkflowFixture.stages : workflowFallback.defaultTemplate.stages.map(
  (stage, index) => ({
    ...stage,
    visibleName: index === 0 ? "Mobilisation" : stage.visibleName,
  }),
);
const projectWorkflowCode = palmFixture ? servicePathWorkflowFixture.code : "tenant_delivery";
const projectFirstStageName = palmFixture ? "Deal File" : "Mobilisation";
await request(`${workflowPath}/${projectWorkflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 0,
    code: projectWorkflowCode,
    name: palmFixture ? servicePathWorkflowFixture.name : "Tenant delivery",
    description: "The default frozen by new projects in this workspace.",
    isDefault: true,
    stages: projectWorkflowStages,
  },
});

// Every workspace is provisioned with a default "sales" pipeline; the smoke keeps its own next to it.
const pipeline = await request(`/workspaces/${workspaceId}/crm/pipelines`, {
  body: {
    code: "smoke_sales",
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
const duplicateResponse = duplicateResponses.data.find(response => response.id !== sharedResponses.data[0].id);
assert(duplicateResponse, "The repeated contact's form response must be recorded.");
// S-3: a likely-existing client never parks the enquiry; it is worked at once on a provisional client.
assert.equal(duplicateResponse.status, "ready", "A repeated unverified contact must become a worked enquiry, not wait in review.");
assert(duplicateResponse.candidateCount > 0);
assert.equal(duplicateResponse.consentStatus, "granted");
const duplicateIntake = await request(`/workspaces/${workspaceId}/crm/intake-events/${duplicateResponse.id}`);
assert(duplicateIntake.candidates.some(candidate => candidate.status === "pending"));
assert.deepEqual(duplicateIntake.payload.formRawAnswers, duplicateAnswers);
const provisionalList = await request(`/workspaces/${workspaceId}/crm/leads?search=${encodeURIComponent("Noor A.")}`);
const provisionalLead = provisionalList.data.find(candidate => candidate.partyId === duplicateIntake.resolvedPartyId);
assert(provisionalLead, "The repeated contact's enquiry must be in the list.");
assert(provisionalLead.clientMatches > 0, "The enquiry must carry Confirm client.");
const provisionalDetail = await request(`/workspaces/${workspaceId}/crm/leads/${provisionalLead.id}`);
assert(provisionalDetail.clientMatches.some(match => match.partyId === sharedLead.partyId));
const confirmedLead = await request(`/workspaces/${workspaceId}/crm/leads/${provisionalLead.id}/confirm-client`, {
  body: { version: provisionalDetail.version, decision: "same", partyId: sharedLead.partyId },
});
assert.equal(confirmedLead.partyId, sharedLead.partyId, "Confirming the client moves the enquiry onto the existing client.");
const confirmedIntake = await request(`/workspaces/${workspaceId}/crm/intake-events/${duplicateResponse.id}`);
assert(!confirmedIntake.candidates.some(candidate => candidate.status === "pending"));

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

  // Staff-typed names are letters and spaces (with hyphen, apostrophe, full stop).
  const staffName = "Staff created Palm enquiry";
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

// The client portal is switched on in Settings → Client portal; its brand is the tenant's own (Appearance).
const portalPath = `/workspaces/${workspaceId}/client-portal`;
const portalSettings = await request(`${portalPath}/settings`);
assert.equal(portalSettings.canManage, true);
assert.equal(portalSettings.demo, true, "The isolated smoke signs clients in with local test codes only.");
const enabledPortal = await request(`${portalPath}/settings`, {
  body: { version: portalSettings.settings.version, enabled: true },
  method: "PUT",
  expected: 200,
});
assert.equal(enabledPortal.settings.enabled, true);
const commercialPath = `/workspaces/${workspaceId}/commercial/cases/${caseId}`;
// A real UAE mobile (050 …): staff-saved contacts must be valid mobiles of their country.
const mobile = `+97150${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const portalContacts = await request(`${portalPath}/cases/${caseId}/contacts`, {
  body: {
    name: fixture.customerName.replace(/\s*\([^)]*\)/g, ""),
    phone: mobile,
    role: "approver",
    testContact: true,
  },
  method: "PUT",
  expected: 200,
});
assert(portalContacts.contacts.some((contact) => contact.phone === mobile && contact.role === "approver" && contact.testContact));

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
  new URL("../../../apps/web/public/brand/logo/wodana-icon.png", import.meta.url),
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

// The client signs in with a code (the local test contact always gets 123456) and decides with a fresh
// code bound to the exact record and choice ("definition:<case>:<baseline>:accept").
const portalSite = await request(`/client-portal/${slug}/site`, { headers: {} });
assert.equal(portalSite.slug, slug);
const loginChallenge = await request(`/client-portal/${slug}/challenge`, {
  body: { phone: mobile },
  headers: {},
});
const clientToken = (
  await request(`/client-portal/${slug}/login`, {
    body: { challengeId: loginChallenge.challengeId, code: "123456" },
    headers: {},
  })
).token;
assert(clientToken, "The client portal must open a session.");
const clientHeaders = { authorization: `Bearer ${clientToken}` };
async function portalDecision(action, purpose, body) {
  const challenge = await request(`/client-portal/${slug}/challenge`, {
    body: { purpose },
    headers: clientHeaders,
  });
  const command = { commandId: randomUUID(), action, caseId, ...body, challengeId: challenge.challengeId, code: "123456" };
  const result = await request(`/client-portal/${slug}/command`, { body: command, headers: clientHeaders });
  assert.equal(result.ok, true);
  return { command, result };
}
const definitionPortal = await request(`/client-portal/${slug}/view`, {
  headers: clientHeaders,
});
const portalBaseline = definitionPortal.projects.find((item) => item.id === caseId).decisions.definition;
assert.equal(portalBaseline.id, definitionBaseline.id);
assert.equal(portalBaseline.canDecide, true);
assert.equal(JSON.stringify(portalBaseline).includes("objectKey"), false);
const definitionDecision = await portalDecision(
  "definition_decision",
  `definition:${caseId}:${definitionBaseline.id}:accept`,
  { baselineId: definitionBaseline.id, decision: "accept", note: "" },
);
const definitionDecisionReplay = await request(`/client-portal/${slug}/command`, {
  body: definitionDecision.command,
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
await portalDecision(
  "definition_decision",
  `definition:${caseId}:${replacementBaseline.id}:accept`,
  { baselineId: replacementBaseline.id, decision: "accept", note: "" },
);
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

if (palmFixture) await commercial("set_service_path", { scope: {
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

const issuedInPortal = (await request(`/client-portal/${slug}/view`, { headers: clientHeaders }))
  .projects.find((item) => item.id === caseId).decisions.quotes.find((item) => item.id === quoteId);
assert.equal(issuedInPortal.canDecide, true);
await portalDecision("quote_decision", `quote:${caseId}:${quoteId}:accept`, {
  quoteId, decision: "accept", selectedOptionLineIds: [], note: "", hash: issuedInPortal.hash,
});
assert.equal((await request(commercialPath)).data.quotes.find((candidate) => candidate.id === quoteId).status, "accepted");

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
  method: "bank",
  receivedOn: new Date().toISOString().slice(0, 10),
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
// The project starts from the accepted quotation (Start project); its scope is sealed there.
const startPath = `/workspaces/${workspaceId}/project-core/start/${caseId}`;
const readiness = await request(startPath);
assert.equal(readiness.quote.id, quoteId);
assert(readiness.canStart, `Start rules must pass: ${JSON.stringify(readiness.checks)}`);
const started = await request(startPath, { body: { quoteId, leadMembershipId: ownerMember.id, name: fixture.opportunityTitle } });
const projectId = started.projectId;
assert(projectId);
commercialState = await request(commercialPath);
const projectDetail = await request(`/workspaces/${workspaceId}/project-core/projects/${projectId}`);
assert.match(projectDetail.project.reference, /^PRJ-\d{4}$/);
assert.equal(projectDetail.stages[0].status, "current");
const liveScope = await request(`/workspaces/${workspaceId}/project-core/projects/${projectId}/scope`);
assert.equal(liveScope.lines.length, liveScope.seals.length ? liveScope.lines.length : 0);
assert(liveScope.lines.length > 0);
const sealPath = `/workspaces/${workspaceId}/project-core/projects/${projectId}/seals/${liveScope.seals[0].id}`;
const sealed = await request(sealPath);
assert.equal(sealed.intact, true);
const sealedLine = sealed.snapshot.lines[0];
assert.equal(sealedLine.id, quote.lines[0].id);
assert.equal(Number(sealedLine.rate), 750);
assert.equal(Number(sealedLine.net), 1500);
assert.equal("unitCost" in sealedLine, false);
// Editing the reusable master must not rewrite the captured requirement or the sealed scope.
await request(`/workspaces/${workspaceId}/catalog/records`,{method:'PUT',body:{...catalogWork,version:1,name:'Updated master wardrobe'}});
const capturedSpecification=await request(`${contentPath}/specifications/${scopeId}`);
assert(capturedSpecification.items[0].requirement.catalogLinks.some(link=>link.recordId===catalogWorkId&&link.snapshot.name==='Built-in wardrobe'));
const afterCatalogEdit=await request(sealPath);
assert.deepEqual(afterCatalogEdit.snapshot,sealed.snapshot);
assert.equal(afterCatalogEdit.contentHash,sealed.contentHash);

const linkedOpportunity = await request(
  `/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}`,
);
assert.equal(linkedOpportunity.lead_id ?? linkedOpportunity.leadId, lead.id);
assert.equal(linkedOpportunity.projectLink.projectId, projectId);
assert.equal((await request(`/workspaces/${workspaceId}/pre-projects/${caseId}`)).status, "released");
assert.deepEqual(await request(startPath, { body: { quoteId, leadMembershipId: ownerMember.id } }), { projectId, existing: true });

const changeCreated = await commercial("create_change_case", {
  kind: "replacement",
  sourceLineIds: [sealedLine.id],
  title: "Replace the approved wardrobe",
  detail: "Use the newly selected finish while preserving the accepted history.",
  owner: fixture.ownerName,
  dueDate: "",
});
const changeId = changeCreated.data.requests.at(-1).id;
const changeAssessed = await commercial("assess_change_case", { requestId: changeId });
const impact = changeAssessed.data.requests.find((item) => item.id === changeId).control.impact;
assert.equal(impact.projectId, projectId);
// The new project has no packages or orders yet (they arrive with the Scope phase), so nothing is affected.
assert(Array.isArray(impact.targets));
const dispositions = impact.targets.map((target) => ({
  targetKind: target.kind,
  targetId: target.id,
  action: "hold_and_replan",
  note: "Pause this affected record and replan after client acceptance.",
}));
if (dispositions.length) await commercial("set_change_dispositions", { requestId: changeId, dispositions });
const changePrepared = await commercial("prepare_change_variations", { requestId: changeId });
const controlled = changePrepared.data.requests.find((item) => item.id === changeId).control;
assert.equal(controlled.quoteIds.length, 2);
assert.deepEqual(controlled.quoteIds.map((id) => changePrepared.data.quotes.find((quote) => quote.id === id).direction), ["deduction", "addition"]);

const jobs = await request(`/workspaces/${workspaceId}/jobs`);
// The repeated form contact is a worked enquiry of its own now (S-3), so it has a Job too.
assert.equal(jobs.total, palmFixture ? 4 : 3);
assert.equal(jobs.items.length, palmFixture ? 4 : 3);
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
assert([403, 404].includes((await rawRequest(`/workspaces/${workspaceId}/project-core/projects/${projectId}`, { headers: reviewer, method: "GET" })).status));
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
assert.equal(viewerJobs.total, palmFixture ? 4 : 3);
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
    assert.equal(jobs.rowCount, palmFixture ? 4 : 3,
      "the shared-link, repeated-contact, staff-created Palm and qualified enquiries must each retain a Job");
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
