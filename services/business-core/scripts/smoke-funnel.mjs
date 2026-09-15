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
      },
    },
    null,
    2,
  )}\n`,
);
