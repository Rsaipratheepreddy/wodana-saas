import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const { hashPassword } = require("../dist/auth/local-password.js");
const { qsEstimateCurrent, qsEstimateHash } = require("../dist/commercial/qs-estimate.js");
const { freezeHash } = require("../dist/commercial/commercial.domain.js");
const sharp = require("sharp");
const api = process.env.PALM_QA_API ?? "http://127.0.0.1:8131/api/v1";
const database = process.env.PALM_QA_DATABASE ?? "wodana";
assert(["127.0.0.1", "localhost"].includes(new URL(api).hostname), "Use a loopback API only.");
assert(database === "wodana", "This check is restricted to the local wodana database.");

const db = new pg.Client({ host: "/tmp", database });
await db.connect();
const marker = randomBytes(4).toString("hex");
const mobile = `+9715${randomInt(10_000_000, 100_000_000)}`;
const email = `palm-flow-qa-${marker}@example.invalid`;
const password = `PalmQa#${randomBytes(12).toString("hex")}!`;
const userId = randomUUID();
let workspaceId = "";
let membershipId = "";
let token = "";

async function request(path, { method = "GET", body, expected = 200, idempotencyKey } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function createQaActor(roleCode) {
  const actorId = randomUUID();
  const actorEmail = `palm-flow-qa-${roleCode}-${randomBytes(5).toString("hex")}@example.invalid`;
  const actorPassword = `PalmQa#${randomBytes(12).toString("hex")}!`;
  const secret = await hashPassword(actorPassword);
  await db.query("BEGIN");
  try {
    const role = (await db.query(
      "SELECT id FROM roles WHERE workspace_id=$1 AND code=$2",
      [workspaceId, roleCode],
    )).rows[0];
    assert(role, `Palm ${roleCode} role must exist.`);
    await db.query(
      `INSERT INTO users(id,primary_email,display_name,preferred_locale,preferred_timezone)
       VALUES($1,$2,$3,'en-AE','Asia/Dubai')`,
      [actorId, actorEmail, `Palm flow QA ${roleCode}`],
    );
    await db.query(
      "INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)",
      [actorId, secret.hash, secret.salt],
    );
    await db.query(
      `INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider)
       VALUES($1,'local',$2,$3)`,
      [actorId, `local:${actorId}`, actorEmail],
    );
    const membership = (await db.query(
      `INSERT INTO workspace_memberships(workspace_id,user_id,status,joined_at)
       VALUES($1,$2,'active',now()) RETURNING id`,
      [workspaceId, actorId],
    )).rows[0];
    await db.query(
      "INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)",
      [workspaceId, membership.id, role.id],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const login = await request("/auth/login", {
    method: "POST", expected: 201,
    body: { email: actorEmail, password: actorPassword, tenantSlug: "palm-living" },
  });
  assert(login.accessToken, `${roleCode} login failed.`);
  return { userId: actorId, token: login.accessToken };
}

try {
  await db.query("BEGIN");
  const tenant = (await db.query(
    `SELECT workspace.id, role.id AS "ownerRoleId" FROM workspaces workspace
     JOIN roles role ON role.workspace_id=workspace.id AND role.code='owner'
     WHERE workspace.slug='palm-living' AND workspace.status='active'`,
  )).rows[0];
  assert(tenant, "The local Palm workspace and Owner role must exist.");
  workspaceId = tenant.id;
  const secret = await hashPassword(password);
  await db.query(
    `INSERT INTO users(id,primary_email,display_name,preferred_locale,preferred_timezone)
     VALUES($1,$2,'Palm flow QA','en-AE','Asia/Dubai')`,
    [userId, email],
  );
  await db.query(
    `INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)`,
    [userId, secret.hash, secret.salt],
  );
  await db.query(
    `INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider)
     VALUES($1,'local',$2,$3)`,
    [userId, `local:${userId}`, email],
  );
  membershipId = (await db.query(
    `INSERT INTO workspace_memberships(workspace_id,user_id,status,joined_at)
     VALUES($1,$2,'active',now()) RETURNING id`,
    [workspaceId, userId],
  )).rows[0].id;
  await db.query(
    `INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)`,
    [workspaceId, membershipId, tenant.ownerRoleId],
  );
  await db.query("COMMIT");

  const login = await request("/auth/login", {
    method: "POST", expected: 201,
    body: { email, password, tenantSlug: "palm-living" },
  });
  assert(login.accessToken, "Palm QA sign-in did not issue an access token.");
  token = login.accessToken;
  const profile = await request("/me");
  assert(profile.memberships.some(item => item.workspaceId === workspaceId));
  console.log(JSON.stringify({ step: "authenticated_palm_owner", workspaceId, qaUserId: userId }));

  const settings = await request(`/workspaces/${workspaceId}/crm/settings`);
  if (!settings.taxonomies.some(item => item.code === "enquiry_type" && item.status === "active")) {
    await request(`/workspaces/${workspaceId}/crm/taxonomies`, {
      method: "POST", expected: 201,
      body: {
        code: "enquiry_type", name: "Enquiry type",
        options: [
          { code: "not_sure", label: "Not sure yet", position: 0 },
          { code: "interior_design_fitout", label: "Interior design & fitout", position: 1 },
          { code: "moodboards_only", label: "Moodboards only", position: 2 },
          { code: "furniture_only", label: "Furniture only", position: 3 },
        ],
      },
    });
  }
  if (!settings.qualificationForms.some(item => item.status === "active" && item.serviceType === null)) {
    const form = await request(`/workspaces/${workspaceId}/crm/qualification-forms`, {
      method: "POST", expected: 201,
      body: {
        code: "palm_general", name: "Palm Living requirements",
        questions: [
          { key: "scope_confirmed", label: "Has the requested scope been confirmed?", dataType: "boolean", required: true, position: 0 },
          { key: "property_type", label: "Property type", dataType: "text", required: true, position: 1 },
        ],
      },
    });
    await request(`/workspaces/${workspaceId}/crm/qualification-forms/${form.id}`, {
      method: "PATCH", body: { version: form.version, status: "active" },
    });
  }
  console.log(JSON.stringify({ step: "enquiry_types_ready" }));

  const intake = await request(`/workspaces/${workspaceId}/crm/intake-events`, {
    method: "POST", expected: 201, idempotencyKey: `palm-real-flow-${marker}`,
    body: {
      source: "company", channel: "website", intakeMethod: "form",
      externalEventId: `palm-real-flow-${marker}`,
      party: {
        displayName: `Palm QA client ${marker}`,
        email: `palm-flow-client-${marker}@example.invalid`,
        mobile,
        preferredLocale: "en-AE", preferredTimezone: "Asia/Dubai",
      },
      title: `QA · Palm design and furniture ${marker}`,
      summary: "Synthetic local acceptance case for the two-payment Palm project flow.",
      serviceType: "not_sure",
      details: { emirate: "dubai", area: "Dubai Hills" },
      originalPayload: { test: "palm-real-local" },
      attribution: [{ source: "website", medium: "form", campaign: "local-qa" }],
    },
  });
  assert(intake.intakeEventId && intake.partyId && intake.enquiryId, `Intake fields: ${Object.keys(intake).join(",")}`);
  console.log(JSON.stringify({ step: "enquiry_created", intakeEventId: intake.intakeEventId, enquiryId: intake.enquiryId, fields: Object.keys(intake) }));

  const lead = await request(`/workspaces/${workspaceId}/crm/leads/${intake.leadId}`);
  const selectedType = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/details`, {
    method: "PATCH",
    body: {
      version: lead.version, serviceType: "interior_design_fitout",
      summary: "Synthetic two-round design and furniture acceptance case.",
      party: {
        displayName: `Palm QA client ${marker}`,
        email: `palm-flow-client-${marker}@example.invalid`,
        mobile,
        preferredLocale: "en-AE", preferredTimezone: "Asia/Dubai",
      },
      details: { emirate: "dubai", area: "Dubai Hills" },
    },
  });
  const qualified = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualification`, {
    method: "PUT",
    body: { version: selectedType.version, values: { scope_confirmed: true, property_type: "villa" } },
  });
  assert(qualified.qualificationState?.ready, "Lead qualification did not become ready.");
  const pipeline = (await db.query(
    `SELECT pipeline.id AS "pipelineId", stage.id AS "stageId", entity.id AS "legalEntityId"
     FROM crm_pipelines pipeline JOIN crm_pipeline_stages stage ON stage.pipeline_id=pipeline.id
     JOIN legal_entities entity ON entity.workspace_id=pipeline.workspace_id AND entity.status='active'
     WHERE pipeline.workspace_id=$1 AND pipeline.is_default AND pipeline.status='active' AND stage.status='active'
     ORDER BY stage.position LIMIT 1`, [workspaceId],
  )).rows[0];
  assert(pipeline, "Palm sales pipeline and legal entity must be configured.");
  const opportunity = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`, {
    method: "POST", expected: 201,
    body: {
      leadVersion: qualified.version, partyId: lead.partyId,
      legalEntityId: pipeline.legalEntityId,
      pipelineId: pipeline.pipelineId, stageId: pipeline.stageId,
      ownerMembershipId: membershipId,
      title: `QA · Palm design and furniture ${marker}`,
      description: "Synthetic local two-payment acceptance case.",
      amount: 85000, currencyCode: "AED",
      expectedCloseAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const prepared = await request(`/workspaces/${workspaceId}/pre-projects`, {
    method: "POST", expected: 201, body: { opportunityId: opportunity.id },
  });
  assert(prepared.id, "The enquiry did not become a Sales preparation case.");
  const pending = await request(`/workspaces/${workspaceId}/pre-projects?pendingDeal=true`);
  assert(pending.items.some(item => item.id === prepared.id && !item.projectId), "The unpaid case is missing from Sales preparation.");
  console.log(JSON.stringify({ step: "sales_preparation_created", leadId: lead.id, opportunityId: opportunity.id, caseId: prepared.id }));

  const commercialPath = `/workspaces/${workspaceId}/commercial/cases/${prepared.id}`;
  const commercialState = () => request(commercialPath);
  const commercialCommand = async (action, extra = {}, expected = 201) => {
    const current = await commercialState();
    return request(commercialPath, {
      method: "POST", expected,
      body: { action, revision: current.data.revision, ...extra },
    });
  };
  await commercialCommand("set_palm_flow", {
    scope: {
      design: true, mainQuotation: true, materialSelection: true,
      procurement: true, manufacturing: true, siteWorks: true, installation: true,
    },
  });
  const firstRound = await commercialCommand("create");
  const designQuote = firstRound.data.quotes.at(-1);
  assert.equal(designQuote?.round, "design");
  const projectsBeforePayment = await request(`/workspaces/${workspaceId}/projects/portfolio`);
  assert(!projectsBeforePayment.some(project => project.caseId === prepared.id), "An unpaid case opened a project.");
  console.log(JSON.stringify({ step: "design_quote_draft", quoteId: designQuote.id, status: designQuote.status }));

  await commercialCommand("save", {
    quoteId: designQuote.id,
    quote: {
      ...designQuote,
      lines: [{
        id: randomUUID(), room: "Whole project", title: "Interior design package",
        specification: "Moodboards, layouts and design specification after site visit.",
        material: "", finish: "", quantity: 1, unit: "package",
        unitCost: 9000, rate: 15000,
        manualReason: "Bespoke design service, not a catalogue item",
      }],
      paymentTerms: [{
        id: randomUUID(), title: "Design deposit", percent: 100,
        trigger: "Signed design agreement", requiredForRelease: true,
        requiredForProduction: false,
      }],
    },
  });
  const submitted = await commercialCommand("submit", { quoteId: designQuote.id });
  assert.equal(submitted.data.quotes.find(item => item.id === designQuote.id)?.status, "internal_review");
  console.log(JSON.stringify({ step: "design_quote_submitted_for_qs", quoteId: designQuote.id }));

  const ownerToken = token;
  const qs = await createQaActor("quantity_surveyor");
  token = qs.token;
  const estimated = await commercialCommand("qs_approve", { quoteId: designQuote.id });
  assert.equal(estimated.data.quotes.find(item => item.id === designQuote.id)?.status, "internal_approved");
  assert.equal(estimated.data.quotes.find(item => item.id === designQuote.id)?.qsEstimate?.reviewedById, qs.userId);
  token = ownerToken;
  console.log(JSON.stringify({ step: "design_quote_qs_approved", quoteId: designQuote.id }));

  const portalPath = `/workspaces/${workspaceId}/commercial/portal-settings`;
  const portal = await request(portalPath);
  if (!portal.enabled) {
    await request(portalPath, {
      method: "PUT",
      body: { version: portal.version, enabled: true, brand: portal.brand },
    });
  }
  await request(`${commercialPath}/contacts`, {
    method: "PUT",
    body: { name: `Palm QA client ${marker}`, phone: mobile, role: "approver", active: true, testContact: true },
  });
  const withContact = await commercialState();
  const approver = withContact.contacts.find(item => item.phone === mobile && item.role === "approver");
  assert(approver, "The local QA client approver was not added.");
  const issued = await commercialCommand("issue", { quoteId: designQuote.id, approverId: approver.id });
  assert.equal(issued.data.quotes.find(item => item.id === designQuote.id)?.status, "issued");
  console.log(JSON.stringify({ step: "design_quote_issued", quoteId: designQuote.id, portalSlug: issued.portalSlug }));

  const portalApi = async (path, body, portalToken) => {
    const response = await fetch(`${api}/client-portal/palm-living/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(portalToken ? { authorization: `Bearer ${portalToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    assert.equal(response.status, path === "action" ? 201 : 201,
      `Client portal ${path}: ${response.status} ${JSON.stringify(payload)}`);
    return payload;
  };
  const loginChallenge = await portalApi("challenge", { phone: mobile, purpose: "login" });
  assert(loginChallenge.testMode, "Local portal OTP test mode is required for synthetic acceptance.");
  const clientSession = await portalApi("login", { challengeId: loginChallenge.challengeId, code: "123456" });
  assert(clientSession.token, "The client portal did not open a session.");
  const decisionChallenge = await portalApi("challenge", {
    phone: mobile, purpose: `decision:${prepared.id}:${designQuote.id}:accept`,
  }, clientSession.token);
  const clientDecision = await portalApi("action", {
    caseId: prepared.id, action: "decision", quoteId: designQuote.id,
    decision: "accept", selectedOptionLineIds: [], note: "",
    challengeId: decisionChallenge.challengeId, code: "123456",
  }, clientSession.token);
  assert.equal(clientDecision.ok, true);
  const accepted = await commercialState();
  assert.equal(accepted.data.quotes.find(item => item.id === designQuote.id)?.status, "accepted");
  console.log(JSON.stringify({ step: "design_quote_client_accepted", quoteId: designQuote.id }));

  const currentOpportunity = await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}`);
  await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/transition`, {
    method: "POST", expected: 201,
    body: { version: currentOpportunity.version, stageId: pipeline.stageId,
      status: "won", reason: "Local synthetic QA: accepted design package" },
  });
  const agreement = await commercialCommand("agreement", {
    quoteId: designQuote.id,
    reference: `QA-DESIGN-AGREEMENT-${marker}`,
    terms: "Local synthetic QA design package terms.",
    evidence: `QA signed design agreement record ${marker}`,
    evidenceKind: "operational",
  });
  assert.equal(agreement.data.agreement?.status, "draft");
  const executed = await commercialCommand("execute_agreement");
  assert.equal(executed.data.agreement?.status, "executed");
  const payment = executed.data.payments.find(item => item.sourceQuoteId === designQuote.id && item.requiredForRelease);
  assert(payment && payment.amount >= 15000, "The design deposit must be at least AED 15,000.");
  const receipt = await commercialCommand("report_payment_receipt", {
    paymentId: payment.id,
    reference: `QA-RECEIPT-${marker}`,
    evidence: `Local synthetic QA receipt ${marker}`,
    evidenceKind: "operational",
  });
  assert.equal(receipt.data.payments.find(item => item.id === payment.id)?.status, "proof_submitted");
  const finance = await createQaActor("finance_reviewer");
  token = finance.token;
  const verified = await commercialCommand("verify_payment", { paymentId: payment.id });
  assert.equal(verified.data.payments.find(item => item.id === payment.id)?.status, "verified");
  token = ownerToken;
  console.log(JSON.stringify({ step: "design_agreement_and_payment_verified", paymentId: payment.id }));

  const commissionLines = [{ recipientName: "QA account manager", type: "sales", basis: "amount", value: 100 }];
  const submittedDeal = await commercialCommand("submit_owner_review", {
    checklist: { agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true },
    commissionLines, paymentProofUrl: `https://qa.invalid/receipts/${marker}`,
    note: "Local synthetic QA only",
  });
  assert.equal(submittedDeal.data.ownerReview?.status, "pending_finance");
  token = finance.token;
  const financeReviewed = await commercialCommand("review_deal_finance", {
    decision: "confirm", paymentVerified: true, commissionLines,
    note: "Local synthetic QA verified",
  });
  assert.equal(financeReviewed.data.ownerReview?.status, "pending_approval");
  const operations = await createQaActor("operations_approver");
  token = operations.token;
  const operationsView = await commercialState();
  assert.equal(operationsView.canApproveDeal, false, "Operations must not see the Palm Owner approval action.");
  await commercialCommand("decide_owner_review", { decision: "approve" }, 403);
  const approverOwner = await createQaActor("owner");
  token = approverOwner.token;
  const ownerReviewed = await commercialCommand("decide_owner_review", { decision: "approve" });
  assert.equal(ownerReviewed.data.ownerReview?.status, "approved");
  assert(ownerReviewed.data.dealFile?.reference, "Owner approval must create one Deal File.");
  const projectsAfterPayment = await request(`/workspaces/${workspaceId}/projects/portfolio`);
  const opened = projectsAfterPayment.filter(project => project.caseId === prepared.id);
  assert.equal(opened.length, 1, "The first paid agreement must open exactly one project.");
  assert(opened[0].reference || opened[0].projectRef || opened[0].code,
    "The project must expose its project reference.");
  console.log(JSON.stringify({ step: "first_payment_opened_one_project", projectId: opened[0].id,
    dealFileReference: ownerReviewed.data.dealFile.reference }));

  const executionPath = `/workspaces/${workspaceId}/projects/${opened[0].id}/execution`;
  const projectState = () => request(executionPath);
  const projectCommand = async (action, extra = {}, expected = 201) => {
    const current = await projectState();
    return request(executionPath, {
      method: "POST", expected,
      body: { action, revision: current.data.revision,
        requestId: `palmqa-${randomUUID()}`, ...extra },
    });
  };
  const atDealFile = await projectState();
  assert.equal(atDealFile.data.workflow?.currentStageKey, "deal_file");
  assert.match(atDealFile.data.controls?.reference ?? "", /^PRJ-\d{4}-/);
  await projectCommand("workflow_transition", { toStageKey: "site_visit", note: "Local synthetic QA visit scheduling" });
  const withoutVisit = await projectState();
  assert.equal(withoutVisit.data.workflow?.currentStageKey, "site_visit");
  await projectCommand("workflow_transition", { toStageKey: "design_specifications", note: "Must block without visit" }, 409);
  await projectCommand("record_site_visit", {
    visitedOn: new Date().toISOString().slice(0, 10),
    scopeSummary: "QA villa scope and furniture requirements recorded after first payment.",
    evidenceReference: `QA-VISIT-${marker}`,
    feeReviewNote: "Review final room scope before main quotation.",
  });
  const designStage = await projectCommand("workflow_transition", {
    toStageKey: "design_specifications", note: "Visit captured; begin design work",
  });
  assert.equal(designStage.data.workflow?.currentStageKey, "design_specifications");
  console.log(JSON.stringify({ step: "paid_project_reached_design", projectId: opened[0].id,
    projectRef: designStage.data.controls.reference }));

  // A main quotation must not inherit the pre-payment design quote's relaxed site-plan gate.
  const assetId = randomUUID();
  const planImage = await sharp({ create: { width: 16, height: 16,
    channels: 3, background: { r: 238, g: 236, b: 230 } } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([planImage], { type: "image/png" }), `QA-site-plan-${marker}.png`);
  const uploadResponse = await fetch(`${api}/workspaces/${workspaceId}/pre-projects/${prepared.id}/assets/${assetId}`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: form,
  });
  const upload = await uploadResponse.json().catch(() => null);
  assert.equal(uploadResponse.status, 201, `Site-plan upload: ${uploadResponse.status} ${JSON.stringify(upload)}`);
  assert.equal(upload.id, assetId);
  await request(`/workspaces/${workspaceId}/pre-projects/${prepared.id}/entries`, {
    method: "PUT", body: {
      id: randomUUID(), version: 0, kind: "file", title: "QA site plan after first payment",
      note: "Synthetic local QA attachment", category: "site plan", priority: "must_have",
      scopeStatus: "included", reviewStatus: "reviewed", unit: "file",
      referenceUrl: "", avoid: "", source: "team", assetIds: [assetId],
    },
  });
  const designId = randomUUID();
  const designVersionId = randomUUID();
  const uploadedDesign = await request(`/workspaces/${workspaceId}/pre-projects/${prepared.id}/designs/upload`, {
    method: "POST", expected: 201,
    body: { note: "Local synthetic QA concept after the paid site visit", files: [{
      id: designId, versionId: designVersionId, assetId,
      title: "QA villa concept layout", documentType: "Space plan / furniture layout",
      note: "Local synthetic QA concept", includedClientRounds: 1,
    }] },
  });
  assert.equal(uploadedDesign.items?.[0]?.versions?.[0]?.status, "draft");
  const designActivity = async (action, extra = {}) => {
    const list = await request(`/workspaces/${workspaceId}/pre-projects/${prepared.id}/designs`);
    const design = list.items.find(item => item.id === designId);
    assert(design, "The uploaded design must be listed.");
    return request(`/workspaces/${workspaceId}/pre-projects/${prepared.id}/designs/${designId}/activity`, {
      method: "POST", expected: 201,
      body: { id: randomUUID(), version: design.version, versionId: designVersionId,
        action, note: "", decisionBy: "", ...extra },
    });
  };
  await designActivity("internal_review", { reviewerId: userId, contextConfirmed: true });
  token = ownerToken;
  await designActivity("internal_approved");
  await designActivity("client_review");
  const designDecisionChallenge = await portalApi("challenge", {
    phone: mobile, purpose: `design-decision:${prepared.id}:${designVersionId}:accept`,
  }, clientSession.token);
  const designDecision = await portalApi("action", {
    caseId: prepared.id, action: "design-decision", versionId: designVersionId,
    decision: "accept", note: "", challengeId: designDecisionChallenge.challengeId,
    code: "123456",
  }, clientSession.token);
  assert.equal(designDecision.ok, true);
  const approvedDesigns = await request(`/workspaces/${workspaceId}/pre-projects/${prepared.id}/designs`);
  assert.equal(approvedDesigns.items.find(item => item.id === designId)?.versions?.[0]?.status, "approved");
  token = approverOwner.token;
  console.log(JSON.stringify({ step: "design_specification_client_approved", designId }));
  const secondRound = await commercialCommand("create");
  const mainQuote = secondRound.data.quotes.at(-1);
  assert.equal(mainQuote?.round, "main");
  assert.equal(secondRound.data.dealFile?.id, ownerReviewed.data.dealFile.id,
    "The main quotation must reuse the existing Deal File.");
  await commercialCommand("save", {
    quoteId: mainQuote.id,
    quote: {
      ...mainQuote,
      lines: [{ id: randomUUID(), room: "Whole villa", title: "Fitout and furniture package",
        specification: "Local QA fitted joinery and selected furniture", material: "Mixed",
        finish: "As specified", quantity: 1, unit: "package", unitCost: 40000,
        rate: 70000, manualReason: "Bespoke site-measured package" }],
      paymentTerms: [{ id: randomUUID(), title: "Main agreement payment", percent: 100,
        trigger: "Signed main agreement", requiredForRelease: true, requiredForProduction: true }],
    },
  });
  const mainSubmitted = await commercialCommand("submit", { quoteId: mainQuote.id });
  assert.equal(mainSubmitted.data.quotes.find(item => item.id === mainQuote.id)?.status, "internal_review");
  token = qs.token;
  const mainEstimated = await commercialCommand("qs_approve", { quoteId: mainQuote.id });
  assert.equal(mainEstimated.data.quotes.find(item => item.id === mainQuote.id)?.status, "internal_approved");
  assert(qsEstimateCurrent(mainEstimated.data.quotes.find(item => item.id === mainQuote.id)),
    "QS estimate changed immediately after approval.");
  token = approverOwner.token;
  const mainIssued = await commercialCommand("issue", { quoteId: mainQuote.id, approverId: approver.id });
  if (!qsEstimateCurrent(mainIssued.data.quotes.find(item => item.id === mainQuote.id))) {
    const beforeIssue = mainEstimated.data.quotes.find(item => item.id === mainQuote.id);
    const afterIssue = mainIssued.data.quotes.find(item => item.id === mainQuote.id);
    const projection = q => ({ round: q.round, direction: q.direction, familyId: q.familyId,
      definitionBaseline: q.definitionBaseline, designEvidence: q.designEvidence,
      title: q.title, cover: q.cover, presentation: q.presentation, rooms: q.rooms,
      inclusions: q.inclusions, currency: q.currency,
      lines: q.lines.map(({ unitCost, manualReason, ...line }) => line),
      discount: q.discount, paymentTerms: q.paymentTerms, paymentTemplate: q.paymentTemplate });
    const beforeProjection = projection(beforeIssue);
    const afterProjection = projection(afterIssue);
    console.log(JSON.stringify({ step: "qs_hash_changed_during_issue", changedKeys: Object.keys(afterIssue)
      .filter(key => JSON.stringify(beforeIssue[key]) !== JSON.stringify(afterIssue[key])),
      removedKeys: Object.keys(beforeIssue).filter(key => !(key in afterIssue)),
      projectionChangedKeys: Object.keys(beforeProjection).filter(key =>
        JSON.stringify(beforeProjection[key]) !== JSON.stringify(afterProjection[key])),
      beforeQs: beforeIssue.qsEstimate, afterQs: afterIssue.qsEstimate,
      beforeComputed: qsEstimateHash(beforeIssue), afterComputed: qsEstimateHash(afterIssue),
      beforePublic: freezeHash(beforeIssue), afterPublic: freezeHash(afterIssue) }));
  }
  assert(qsEstimateCurrent(mainIssued.data.quotes.find(item => item.id === mainQuote.id)),
    "QS estimate changed on issue.");
  const mainDecisionChallenge = await portalApi("challenge", {
    phone: mobile, purpose: `decision:${prepared.id}:${mainQuote.id}:accept`,
  }, clientSession.token);
  const mainDecision = await portalApi("action", {
    caseId: prepared.id, action: "decision", quoteId: mainQuote.id,
    decision: "accept", selectedOptionLineIds: [], note: "",
    challengeId: mainDecisionChallenge.challengeId, code: "123456",
  }, clientSession.token);
  assert.equal(mainDecision.ok, true);
  const afterMainAcceptance = await commercialState();
  assert.equal(afterMainAcceptance.data.quotes.find(item => item.id === mainQuote.id)?.status, "accepted");
  assert(qsEstimateCurrent(afterMainAcceptance.data.quotes.find(item => item.id === mainQuote.id)),
    "QS estimate changed on client acceptance.");
  assert.equal(afterMainAcceptance.data.designRound?.quoteId, designQuote.id);
  console.log(JSON.stringify({ step: "main_quote_separately_accepted", quoteId: mainQuote.id,
    designQuoteId: designQuote.id }));

  const mainAgreement = await commercialCommand("agreement", {
    quoteId: mainQuote.id,
    reference: `QA-MAIN-AGREEMENT-${marker}`,
    terms: "Local synthetic QA fitout and furniture terms.",
    evidence: `QA signed main agreement record ${marker}`,
    evidenceKind: "operational",
  });
  assert.equal(mainAgreement.data.agreement?.quoteId, mainQuote.id);
  const mainExecuted = await commercialCommand("execute_agreement");
  assert.equal(mainExecuted.data.agreement?.status, "executed");
  const mainPayment = mainExecuted.data.payments.find(item => item.sourceQuoteId === mainQuote.id && item.requiredForRelease);
  assert(mainPayment && mainPayment.id !== payment.id, "The main quote must have its own payment schedule.");
  await commercialCommand("report_payment_receipt", {
    paymentId: mainPayment.id,
    reference: `QA-MAIN-RECEIPT-${marker}`,
    evidence: `Local synthetic QA main payment receipt ${marker}`,
    evidenceKind: "operational",
  });
  token = finance.token;
  const mainVerified = await commercialCommand("verify_payment", { paymentId: mainPayment.id });
  assert.equal(mainVerified.data.payments.find(item => item.id === mainPayment.id)?.status, "verified");
  token = ownerToken;
  await commercialCommand("submit_owner_review", {
    checklist: { agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true },
    commissionLines, paymentProofUrl: `https://qa.invalid/receipts/main/${marker}`,
    note: "Local synthetic QA main round only",
  });
  token = finance.token;
  await commercialCommand("review_deal_finance", {
    decision: "confirm", paymentVerified: true, commissionLines,
    note: "Local synthetic QA main round verified",
  });
  token = approverOwner.token;
  const mainApproved = await commercialCommand("decide_owner_review", { decision: "approve" });
  assert.equal(mainApproved.data.dealFile?.id, ownerReviewed.data.dealFile.id,
    "The second paid round must update the same Deal File.");
  assert.equal(mainApproved.data.dealFile?.quoteId, mainQuote.id);
  const projectsAfterMain = await request(`/workspaces/${workspaceId}/projects/portfolio`);
  const stillOne = projectsAfterMain.filter(project => project.caseId === prepared.id);
  assert.equal(stillOne.length, 1, "The second payment must not duplicate the project.");
  assert.equal(stillOne[0].id, opened[0].id);
  console.log(JSON.stringify({ step: "main_payment_updated_same_deal_and_project",
    projectId: stillOne[0].id, dealFileReference: mainApproved.data.dealFile.reference }));

  await projectCommand("project_roles", { assignments: [
    { role: "senior_designer", memberId: membershipId },
    { role: "sales_manager", memberId: membershipId },
    { role: "surveyor", memberId: membershipId },
    { role: "finance", memberId: membershipId },
    { role: "procurement_production", memberId: membershipId },
    { role: "project_manager", memberId: membershipId },
  ] });

  for (const stage of ["main_quote", "main_qs_review", "main_client_approval",
    "main_agreement_payment", "material_list_signoff"]) {
    const transitioned = await projectCommand("workflow_transition", {
      toStageKey: stage, note: `Local QA verified ${stage}`,
    });
    assert.equal(transitioned.data.workflow?.currentStageKey, stage);
  }
  const materials = await commercialCommand("sync_material_approvals");
  const pendingMaterials = materials.data.materialApprovals.filter(item => item.quoteId === mainQuote.id);
  assert(pendingMaterials.length >= 1, "The accepted main quotation must generate material selections.");
  for (const material of pendingMaterials) {
    await commercialCommand("submit_material_approval", {
      materialApprovalId: material.id, approverId: approver.id,
    });
    const challenge = await portalApi("challenge", {
      phone: mobile, purpose: `material-decision:${prepared.id}:${material.id}:accept`,
    }, clientSession.token);
    const decision = await portalApi("action", {
      caseId: prepared.id, action: "material-decision", materialApprovalId: material.id,
      decision: "accept", note: "", challengeId: challenge.challengeId, code: "123456",
    }, clientSession.token);
    assert.equal(decision.ok, true);
  }
  const signedOff = await commercialState();
  assert(signedOff.data.materialApprovals.filter(item => item.quoteId === mainQuote.id)
    .every(item => item.status === "approved"));
  const released = await commercialCommand("release", {
    note: "Local synthetic QA release after client material sign-off",
  });
  assert.equal(released.data.release?.projectId, opened[0].id,
    "Release must continue the existing paid project.");
  const procurement = await projectState();
  assert.equal(procurement.data.workflow?.currentStageKey, "procurement",
    "The approved material sign-off should automatically open procurement.");
  console.log(JSON.stringify({ step: "materials_signed_and_procurement_released",
    projectId: opened[0].id, materialCount: pendingMaterials.length }));

  const controlsBeforeHold = (await projectState()).data.controls;
  const held = await projectCommand("project_controls", { controls: {
    ...controlsBeforeHold, onHold: true, holdReason: "QA supplier check",
    holdOwnerId: membershipId,
  } });
  assert.equal(held.data.controls?.onHold, true);
  const heldTransition = await projectCommand("workflow_transition", {
    toStageKey: "manufacturing_readiness", note: "Must wait while on hold",
  }, 409);
  assert.match(heldTransition.message ?? "", /hold/i);
  const resumed = await projectCommand("project_controls", { controls: {
    ...held.data.controls, onHold: false, holdReason: "", holdOwnerId: "",
  } });
  assert.equal(resumed.data.controls?.onHold, false);

  const manufacturingGate = await projectCommand("workflow_transition", {
    toStageKey: "manufacturing_readiness", note: "Procurement complete for local QA",
  });
  assert.equal(manufacturingGate.data.workflow?.currentStageKey, "manufacturing_readiness");
  const prematureFactory = await projectCommand("workflow_transition", {
    toStageKey: "factory_production", note: "Must not start without production plan",
  }, 409);
  assert.match(prematureFactory.message ?? "", /production_plan_ready/i);
  console.log(JSON.stringify({ step: "manufacturing_plan_gate_enforced",
    projectId: opened[0].id }));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end();
}
