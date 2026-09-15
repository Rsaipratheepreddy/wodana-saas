import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8164/api/v1";
if (!["127.0.0.1", "localhost"].includes(new URL(api).hostname))
  throw new Error("The funnel smoke is restricted to an isolated local API.");

const run = randomUUID();
const slug = `funnel-${run}`;
const owner = {
  "x-wodana-user-subject": `funnel-owner-${run}`,
  "x-wodana-user-email": `funnel-owner-${run}@example.com`,
  "x-wodana-user-name": "Funnel Owner",
};
const reviewer = {
  "x-wodana-user-subject": `funnel-reviewer-${run}`,
  "x-wodana-user-email": `funnel-reviewer-${run}@example.com`,
  "x-wodana-user-name": "Funnel Reviewer",
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

const workspace = await request("/workspaces", {
  body: {
    name: "Generic Funnel Verification",
    slug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "FUNNEL",
      displayName: "Generic Funnel Verification",
      registeredName: "Generic Funnel Verification LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
const workspaceId = workspace.workspace.id;
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

const invitation = await request(`/workspaces/${workspaceId}/invitations`, {
  body: {
    displayName: "Funnel Reviewer",
    email: reviewer["x-wodana-user-email"],
    roleCodes: ["owner"],
  },
});
await request(`/workspaces/invitations/${invitation.id}/accept`, {
  headers: reviewer,
  method: "POST",
});
members = await request(`/workspaces/${workspaceId}/members`);
const reviewerMember = members.find(
  (member) => member.email === reviewer["x-wodana-user-email"],
);
assert(reviewerMember?.roles.includes("owner"));

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
const projectWorkflowStages = workflowFallback.defaultTemplate.stages.map(
  (stage, index) => ({
    ...stage,
    visibleName: index === 0 ? "Mobilisation" : stage.visibleName,
  }),
);
await request(`${workflowPath}/${projectWorkflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 0,
    code: "tenant_delivery",
    name: "Tenant delivery",
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
    ],
  },
});

const intakeBody = {
  source: "company",
  channel: "website",
  intakeMethod: "form",
  externalEventId: `funnel-${run}`,
  party: {
    displayName: "Generic Client",
    email: `client-${run}@example.com`,
    phone: "+971501234567",
    preferredLocale: "en-AE",
    preferredTimezone: "Asia/Dubai",
  },
  title: "Two-room interior project",
  summary: "A generic customer enquiry used only in the disposable funnel verification.",
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
assert.equal(intakeReplay.intakeEventId, intake.intakeEventId);
assert.equal(intakeReplay.enquiryId, intake.enquiryId);

const leads = await request(`/workspaces/${workspaceId}/crm/leads`);
const lead = leads.data.find((candidate) => candidate.partyId === intake.partyId);
assert(lead, "CRM intake must create a queryable lead.");
const opportunity = await request(
  `/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`,
  {
    body: {
      leadVersion: lead.version,
      partyId: lead.partyId,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      ownerMembershipId: ownerMember.id,
      title: "Generic Client — interior project",
      description: "Qualified from the generic intake path.",
      amount: 1500,
      currencyCode: "AED",
      expectedCloseAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  },
);
const prepared = await request(`/workspaces/${workspaceId}/pre-projects`, {
  body: { opportunityId: opportunity.id },
});
const preparationReplay = await request(`/workspaces/${workspaceId}/pre-projects`, {
  body: { opportunityId: opportunity.id },
});
assert.equal(preparationReplay.id, prepared.id);
const caseId = prepared.id;
const plannedProject = await request(
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
    brand: portalSettings.brand,
  },
  method: "PUT",
});
const commercialPath = `/workspaces/${workspaceId}/commercial/cases/${caseId}`;
const mobile = `+9715${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
await request(`${commercialPath}/contacts`, {
  body: {
    name: "Generic Client",
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

await request(`${contentPath}/rooms`, {
  body: { id: roomId, version: 0, name: "Primary bedroom" },
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
    catalogLinks: [],
  },
  method: "PUT",
});

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
  decisionBy: "Generic Client",
  decisionSource: "meeting",
  decisionAt: new Date().toISOString(),
});

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

quoteId = (await commercial("create")).data.quotes[0].id;
let commercialState = await request(commercialPath);
const quote = commercialState.data.quotes.find((candidate) => candidate.id === quoteId);
assert.equal(quote.lines.length, 1);
assert.equal(quote.lines[0].scopeId, scopeId);
assert.equal(quote.lines[0].specificationVersion, 3);
Object.assign(quote.lines[0], {
  specification: "Four-door wardrobe with soft-close hardware.",
  material: "",
  finish: "",
  unitCost: 400,
  rate: 750,
});
quote.taxRate = 5;
quote.paymentTerms = [
  {
    id: randomUUID(),
    title: "Handover payment",
    percent: 100,
    trigger: "On handover",
    requiredForRelease: false,
  },
];
await commercial("save", { quote });
await commercial("submit");
await commercial("approve");
commercialState = await request(commercialPath);
const approverId = commercialState.contacts.find((contact) => contact.phone === mobile).id;
await commercial("issue", { approverId });

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
await commercial("submit_owner_review", {
  commission: 0,
  checklist: {
    agreement: true,
    boq: true,
    documents: true,
    margin: true,
    materials: true,
    payment: true,
  },
  note: "Accepted scope and commercial evidence checked.",
});
await commercial(
  "decide_owner_review",
  { decision: "approve", note: "Independent owner review complete." },
  reviewer,
);
const released = await commercial("release", {
  note: "Approved for delivery planning.",
});
const projectId = released.data.release.projectId;
assert(projectId);
assert.equal(projectId, plannedProject.id);

commercialState = await request(commercialPath);
const project = await request(
  `/workspaces/${workspaceId}/projects/${projectId}/execution`,
);
const releasedLine = project.data.scope.lines[0];
assert.equal(project.caseId, caseId);
assert.equal(project.data.scope.quoteId, quoteId);
assert.equal(project.data.scope.quoteHash, commercialState.data.dealFile.quoteHash);
assert.equal(project.data.scope.dealFileId, commercialState.data.dealFile.id);
assert.equal(project.data.scope.releaseId, commercialState.data.release.id);
assert.equal(releasedLine.id, quote.lines[0].id);
assert.equal(releasedLine.sourceScopeId, scopeId);
assert.equal(releasedLine.sourceScopeVersion, quote.lines[0].scopeVersion);
assert.equal(releasedLine.sourceSpecificationVersion, 3);
assert.equal(releasedLine.rate, 750);
assert.equal(releasedLine.lineTotal, 1500);
assert.equal("unitCost" in releasedLine, false);
assert.equal("photo" in releasedLine, false);
assert.equal(project.data.workflow.template.id, projectWorkflowTemplateId);
assert.equal(project.data.workflow.template.version, 1);
assert.equal(project.data.workflow.template.stages[0].visibleName, "Mobilisation");

await request(`${workflowPath}/${projectWorkflowTemplateId}`, {
  method: "PUT",
  body: {
    version: 1,
    code: "tenant_delivery",
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
  "Mobilisation",
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
let workflowState = await projectCommand("workflow_transition", {
  toStageKey: "delivery",
  note: "Delivery plan and ownership reviewed.",
});
assert.equal(workflowState.data.workflow.currentStageKey, "delivery");
assert.equal(workflowState.data.workflow.history.at(-1).action, "advanced");

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
  { toStageKey: "handover", note: "" },
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

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      workspaceId,
      intakeId: intake.intakeEventId,
      enquiryId: intake.enquiryId,
      leadId: lead.id,
      opportunityId: opportunity.id,
      caseId,
      quoteId,
      dealFileId: commercialState.data.dealFile.id,
      projectId,
      assertions: {
        apiBusinessRecordsOnly: true,
        intakeReplaySafe: true,
        preparationReplaySafe: true,
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
      },
    },
    null,
    2,
  )}\n`,
);
