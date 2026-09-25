import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";
import type { CommercialData, Quote } from "../src/commercial/commercial.types";
const { freezeHash } = createRequire(import.meta.url)("../dist/commercial/commercial.domain.js") as typeof import("../src/commercial/commercial.domain");
const { hashPassword } = createRequire(import.meta.url)("../dist/auth/local-password.js") as typeof import("../src/auth/local-password");
const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

assert.equal(process.env.PALM_FLOW_ISOLATED, "1", "Palm flow QA must run in the isolated smoke harness");
const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8131/api/v1";
assert(["127.0.0.1", "localhost"].includes(new URL(api).hostname), "QA must use a loopback API");
const databaseUrl = process.env.PLATFORM_TEST_DATABASE_URL;
assert(databaseUrl, "The isolated test database URL is required");
const database = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(database.hostname), "QA database must be local");
assert(/^wodana_funnel_test_\d+_\d+$/.test(decodeURIComponent(database.pathname.slice(1))), "QA database must be disposable");
const admin = new pg.Client({ connectionString: databaseUrl });
await admin.connect();
const suffix = randomUUID().slice(0, 8);
const ownerEmail = `palm-flow-${suffix}@example.invalid`;
const password = `Flow#${suffix}2026!`;
let token = "";
let workspaceId = "";
let ownerId = "";
const workspaceSlug = `palm-flow-${suffix}`;

async function request(path: string, method = "GET", body?: unknown, expected = 200, useToken = true) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(useToken && token ? { authorization: `Bearer ${token}` } : {}),
      ...(path === "/internal/tenants" ? { "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token", "idempotency-key": `palm-flow-${suffix}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function tenantQuery(sql: string, values: unknown[] = []) {
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const result = await admin.query(sql, values);
    await admin.query("COMMIT");
    return result;
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

async function createCase(title: string) {
  const pipelineId = randomUUID(), stageId = randomUUID(), partyId = randomUUID();
  const opportunityId = randomUUID(), caseId = randomUUID();
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    await admin.query(`INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,$3,$4,false)`, [pipelineId, workspaceId, `flow_${pipelineId.slice(0, 8)}`, title]);
    await admin.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'won','Won',1)`, [stageId, workspaceId, pipelineId]);
    await admin.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)`, [partyId, workspaceId, "Flow QA client", "flow qa client"]);
    const entity = (await admin.query<{ id: string }>(`SELECT id FROM legal_entities WHERE workspace_id=$1 LIMIT 1`, [workspaceId])).rows[0];
    await admin.query(`INSERT INTO crm_opportunities(id,workspace_id,legal_entity_id,party_id,pipeline_id,stage_id,title,status,amount,currency_code) VALUES($1,$2,$3,$4,$5,$6,$7,'won',1000,'AED')`, [opportunityId, workspaceId, entity.id, partyId, pipelineId, stageId, title]);
    await admin.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)`, [caseId, workspaceId, opportunityId, ownerId]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  return caseId;
}

async function createQaActor(roleCode: string) {
  const actorId = randomUUID();
  const email = `palm-flow-${roleCode}-${randomUUID().slice(0, 8)}@example.invalid`;
  const actorPassword = `Flow#${randomUUID()}!`;
  const secret = await hashPassword(actorPassword);
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const role = (await admin.query<{ id: string }>(
      "SELECT id FROM roles WHERE workspace_id=$1 AND code=$2", [workspaceId, roleCode],
    )).rows[0];
    assert(role, `The ${roleCode} role must be provisioned`);
    await admin.query(
      `INSERT INTO users(id,primary_email,display_name,preferred_locale,preferred_timezone)
       VALUES($1,$2,$3,'en-AE','Asia/Dubai')`,
      [actorId, email, `Palm QA ${roleCode}`],
    );
    await admin.query("INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)",
      [actorId, secret.hash, secret.salt]);
    await admin.query(
      `INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider)
       VALUES($1,'local',$2,$3)`, [actorId, `local:${actorId}`, email],
    );
    const membership = (await admin.query<{ id: string }>(
      `INSERT INTO workspace_memberships(workspace_id,user_id,status,joined_at)
       VALUES($1,$2,'active',now()) RETURNING id`, [workspaceId, actorId],
    )).rows[0];
    await admin.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)",
      [workspaceId, membership.id, role.id]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  const login = await request("/auth/login", "POST", { email, password: actorPassword, tenantSlug: workspaceSlug }, 201, false);
  assert(login.accessToken, `${roleCode} login must issue a token`);
  return { id: actorId, token: login.accessToken as string };
}

async function portalCommand(path: string, body: Record<string, unknown>, portalToken?: string) {
  const response = await fetch(`${api}/client-portal/${workspaceSlug}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(portalToken ? { authorization: `Bearer ${portalToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, 201, `Client portal ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function enrollClientApprover(caseId: string) {
  const portalPath = `/workspaces/${workspaceId}/commercial/portal-settings`;
  const settings = await request(portalPath);
  if (!settings.enabled)
    await request(portalPath, "PUT", { version: settings.version, enabled: true, brand: settings.brand });
  const mobile = `+9715${randomInt(10_000_000, 100_000_000)}`;
  await request(`/workspaces/${workspaceId}/commercial/cases/${caseId}/contacts`, "PUT",
    { name: "Palm QA client", phone: mobile, role: "approver", active: true, testContact: true });
  const approver = (await state(caseId)).contacts.find((contact: { phone: string }) => contact.phone === mobile);
  assert(approver, "The client approver must be linked to this case");
  const loginChallenge = await portalCommand("challenge", { phone: mobile, purpose: "login" });
  assert(loginChallenge.testMode, "Synthetic client OTP must run in test mode");
  const session = await portalCommand("login", { challengeId: loginChallenge.challengeId, code: "123456" });
  assert(session.token, "The client portal must open a session");
  return { mobile, approverId: approver.id as string, clientToken: session.token as string };
}

async function approveDesignRoundThroughApi(caseId: string, quoteId: string) {
  const submitterToken = token;
  const quote = (await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId) as Quote;
  await command(caseId, "save", { quoteId, quote: {
    ...quote,
    lines: [{ id: randomUUID(), room: "Whole project", title: "Interior design package",
      specification: "Moodboards and measured design scope", material: "", finish: "",
      quantity: 1, unit: "package", unitCost: 9000, rate: 15000,
      manualReason: "Bespoke design service" }],
    paymentTerms: [{ id: randomUUID(), title: "Design deposit", percent: 100,
      trigger: "Signed design agreement", requiredForRelease: true, requiredForProduction: false }],
  } });
  await command(caseId, "submit", { quoteId });
  await command(caseId, "approve", { quoteId }, 409);
  await command(caseId, "submit_owner_review", { quoteId }, 409);
  const qs = await createQaActor("quantity_surveyor");
  token = qs.token;
  const estimated = await command(caseId, "qs_approve", { quoteId });
  assert.equal(estimated.data.quotes.find((item: Quote) => item.id === quoteId)?.qsEstimate?.reviewedById, qs.id);
  token = submitterToken;

  const client = await enrollClientApprover(caseId);
  await command(caseId, "issue", { quoteId, approverId: client.approverId });
  const decisionChallenge = await portalCommand("challenge",
    { phone: client.mobile, purpose: `decision:${caseId}:${quoteId}:accept` }, client.clientToken);
  await portalCommand("action", { caseId, action: "decision", quoteId, decision: "accept",
    selectedOptionLineIds: [], note: "", challengeId: decisionChallenge.challengeId, code: "123456" }, client.clientToken);
  assert.equal((await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId)?.status, "accepted");

  await command(caseId, "agreement", { quoteId, reference: `QA-DESIGN-${suffix}`,
    terms: "Synthetic design agreement", evidence: "Synthetic signed agreement record", evidenceKind: "operational" });
  const executed = await command(caseId, "execute_agreement");
  const payment = executed.data.payments.find((item: { sourceQuoteId: string; requiredForRelease: boolean }) =>
    item.sourceQuoteId === quoteId && item.requiredForRelease);
  assert(payment?.amount >= 15000, "The design deposit must be at least AED 15,000");
  await command(caseId, "report_payment_receipt", { paymentId: payment.id,
    reference: `QA-RECEIPT-${suffix}`, evidence: "Synthetic bank receipt evidence", evidenceKind: "operational" });
  const finance = await createQaActor("finance_reviewer");
  token = finance.token;
  await command(caseId, "verify_payment", { paymentId: payment.id });
  token = submitterToken;
  const commissionLines = [{ recipientName: "QA Sales", type: "sales", basis: "amount", value: 100 }];
  await command(caseId, "submit_owner_review", { checklist: {
    agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true,
  }, commissionLines, paymentProofUrl: `https://example.invalid/receipt/${suffix}`, note: "Synthetic QA" });
  token = finance.token;
  await command(caseId, "review_deal_finance", { decision: "confirm", paymentVerified: true,
    commissionLines, note: "Synthetic finance verification" });
  const beforeOwnerApproval = await tenantQuery(
    "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2", [workspaceId, caseId],
  );
  assert.equal(beforeOwnerApproval.rowCount, 0, "Finance verification alone must not open a project");
  const approvingOwner = await createQaActor("owner");
  token = approvingOwner.token;
  const approved = await command(caseId, "decide_owner_review", { decision: "approve" });
  assert.equal(approved.data.ownerReview.status, "approved");
  assert.equal(approved.data.dealFile.quoteId, quoteId);
  token = submitterToken;
  return { qs, finance, approvingOwner, ...client };
}

type RoundActors = Awaited<ReturnType<typeof approveDesignRoundThroughApi>>;

async function approveDesignDeliverableThroughApi(caseId: string, actors: RoundActors) {
  const submitterToken = token;
  const assetId = randomUUID(), designId = randomUUID(), versionId = randomUUID();
  const image = await sharp({ create: { width: 16, height: 16, channels: 3,
    background: { r: 238, g: 236, b: 230 } } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([image], { type: "image/png" }), `QA-site-plan-${suffix}.png`);
  const uploadResponse = await fetch(`${api}/workspaces/${workspaceId}/pre-projects/${caseId}/assets/${assetId}`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: form,
  });
  const upload = await uploadResponse.json().catch(() => null);
  assert.equal(uploadResponse.status, 201, `Site-plan upload: ${uploadResponse.status} ${JSON.stringify(upload)}`);
  assert.equal(upload.id, assetId);
  await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/entries`, "PUT", {
    id: randomUUID(), version: 0, kind: "file", title: "QA site plan after first payment",
    note: "Synthetic isolated QA", category: "site plan", priority: "must_have",
    scopeStatus: "included", reviewStatus: "reviewed", unit: "file",
    referenceUrl: "", avoid: "", source: "team", assetIds: [assetId],
  });
  await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/designs/upload`, "POST", {
    note: "Concept after paid site visit", files: [{
      id: designId, versionId, assetId, title: "QA room layout",
      documentType: "Space plan / furniture layout", note: "Synthetic isolated QA",
      includedClientRounds: 1,
    }],
  }, 201);
  async function designActivity(action: string, extra: Record<string, unknown> = {}) {
    const designs = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/designs`);
    const design = designs.items.find((item: { id: string }) => item.id === designId);
    assert(design, "The uploaded design must be listed");
    return request(`/workspaces/${workspaceId}/pre-projects/${caseId}/designs/${designId}/activity`,
      "POST", { id: randomUUID(), version: design.version, versionId, action,
        note: "", decisionBy: "", ...extra }, 201);
  }
  token = actors.approvingOwner.token;
  await designActivity("internal_review", { reviewerId: ownerId, contextConfirmed: true });
  token = submitterToken;
  await designActivity("internal_approved");
  await designActivity("client_review");
  const challenge = await portalCommand("challenge", {
    phone: actors.mobile, purpose: `design-decision:${caseId}:${versionId}:accept`,
  }, actors.clientToken);
  await portalCommand("action", { caseId, action: "design-decision", versionId,
    decision: "accept", note: "", challengeId: challenge.challengeId, code: "123456" }, actors.clientToken);
  const designs = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/designs`);
  assert.equal(designs.items.find((item: { id: string }) => item.id === designId)?.versions?.[0]?.status, "approved");
}

async function approveMainRoundThroughApi(caseId: string, quoteId: string, actors: RoundActors, readyMade = false) {
  const submitterToken = token;
  const quote = (await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId) as Quote;
  await command(caseId, "save", { quoteId, quote: {
    ...quote,
    lines: [{ id: randomUUID(), room: readyMade ? "Living room" : "Whole project",
      title: readyMade ? "Ready-made sofa and table" : "Fitout and furniture package",
      specification: readyMade ? "Catalog furniture; no design or factory work" : "Fitted joinery and selected furniture",
      material: readyMade ? "Supplier finished" : "Mixed", finish: "As specified",
      quantity: 1, unit: "package", unitCost: readyMade ? 5000 : 40000, rate: readyMade ? 9000 : 70000,
      manualReason: readyMade ? "Client-selected supplier package" : "Bespoke site-measured package" }],
    paymentTerms: [{ id: randomUUID(), title: "Main agreement payment", percent: 100,
      trigger: "Signed main agreement", requiredForRelease: true, requiredForProduction: true }],
  } });
  await command(caseId, "submit", { quoteId });
  token = actors.qs.token;
  const estimated = await command(caseId, "qs_approve", { quoteId });
  assert.equal(estimated.data.quotes.find((item: Quote) => item.id === quoteId)?.qsEstimate?.reviewedById, actors.qs.id);
  token = submitterToken;
  await command(caseId, "issue", { quoteId, approverId: actors.approverId });
  const challenge = await portalCommand("challenge", {
    phone: actors.mobile, purpose: `decision:${caseId}:${quoteId}:accept`,
  }, actors.clientToken);
  await portalCommand("action", { caseId, action: "decision", quoteId, decision: "accept",
    selectedOptionLineIds: [], note: "", challengeId: challenge.challengeId, code: "123456" }, actors.clientToken);
  assert.equal((await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId)?.status, "accepted");
  await command(caseId, "agreement", { quoteId, reference: `QA-MAIN-${suffix}`,
    terms: "Synthetic main agreement", evidence: "Synthetic signed main agreement record", evidenceKind: "operational" });
  const executed = await command(caseId, "execute_agreement");
  const payment = executed.data.payments.find((item: { sourceQuoteId: string; requiredForRelease: boolean }) =>
    item.sourceQuoteId === quoteId && item.requiredForRelease);
  assert(payment, "The main agreement must have its own payment");
  await command(caseId, "report_payment_receipt", { paymentId: payment.id,
    reference: `QA-MAIN-RECEIPT-${suffix}`, evidence: "Synthetic main receipt evidence", evidenceKind: "operational" });
  token = actors.finance.token;
  await command(caseId, "verify_payment", { paymentId: payment.id });
  token = submitterToken;
  const commissionLines = [{ recipientName: "QA Sales", type: "sales", basis: "amount", value: 100 }];
  await command(caseId, "submit_owner_review", { checklist: {
    agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true,
  }, commissionLines, paymentProofUrl: `https://example.invalid/main-receipt/${suffix}`, note: "Synthetic QA" });
  token = actors.finance.token;
  await command(caseId, "review_deal_finance", { decision: "confirm", paymentVerified: true,
    commissionLines, note: "Synthetic main finance verification" });
  token = actors.approvingOwner.token;
  const approved = await command(caseId, "decide_owner_review", { decision: "approve" });
  assert.equal(approved.data.ownerReview.status, "approved");
  assert.equal(approved.data.dealFile.quoteId, quoteId);
  token = submitterToken;
}

async function state(caseId: string) {
  return request(`/workspaces/${workspaceId}/commercial/cases/${caseId}`);
}
async function command(caseId: string, action: string, extra: Record<string, unknown> = {}, expected = 201) {
  const current = await state(caseId);
  return request(`/workspaces/${workspaceId}/commercial/cases/${caseId}`, "POST", { action, revision: current.data.revision, ...extra }, expected);
}
async function projectState(projectId: string) {
  return request(`/workspaces/${workspaceId}/projects/${projectId}/execution`);
}
async function projectCommand(projectId: string, action: string, extra: Record<string, unknown> = {}, expected = 201) {
  const current = await projectState(projectId);
  return request(`/workspaces/${workspaceId}/projects/${projectId}/execution`, "POST", {
    action, revision: current.data.revision, requestId: randomUUID(), ...extra,
  }, expected);
}

async function injectAcceptedRound(caseId: string, quoteId: string, round: "design" | "main", designAmount = 15000) {
  const amount = round === "design" ? designAmount : 1000;
  const current = await state(caseId);
  const data = current.data as CommercialData;
  const entity = (await tenantQuery<{ id: string; code: string; display_name: string; registered_name: string; country_code: string; base_currency: string }>(
    `SELECT id,code,display_name,registered_name,country_code,base_currency FROM legal_entities WHERE workspace_id=$1 LIMIT 1`, [workspaceId],
  )).rows[0];
  data.financeContext = {
    legalEntityId: entity.id, code: entity.code, displayName: entity.display_name,
    registeredName: entity.registered_name, countryCode: entity.country_code,
    baseCurrency: entity.base_currency, currency: "AED", taxValidation: "unvalidated", boundAt: new Date().toISOString(),
  };
  const quote = data.quotes.find(item => item.id === quoteId)!;
  quote.round = round;
  quote.status = "accepted";
  quote.lines = [{ id: randomUUID(), room: "General", title: round === "design" ? "Design package" : "Ready-made furniture", specification: "Approved scope", material: "", finish: "", quantity: 1, unit: "package", unitCost: 400, rate: amount }];
  quote.total = amount;
  quote.designEvidence = { capturedAt: new Date().toISOString(), links: [] };
  quote.hash = freezeHash(quote);
  quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], acceptedTotal: amount } as Quote["clientDecision"];
  const agreementReference = `${round.toUpperCase()}-${suffix}`;
  data.agreement = { quoteId, quoteHash: quote.hash, acceptedTotal: amount, selectedOptionLineIds: [], legalEntityId: entity.id, currency: "AED", reference: agreementReference, terms: "Agreed", evidence: "Signed agreement on file", evidenceKind: "operational", status: "executed" } as CommercialData["agreement"];
  const paymentId = randomUUID(), receiptId = randomUUID();
  data.payments.push({ id: paymentId, sourceQuoteId: quoteId, legalEntityId: entity.id, currency: "AED", title: "Advance", amount, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "Receipt on file", reference: `RC-${round}`, evidenceKind: "operational", agreementReference } as CommercialData["payments"][number]);
  data.receipts ??= [];
  data.receipts.push({ id: receiptId, paymentId, legalEntityId: entity.id, currency: "AED", amount, source: "manual", status: "finance_verified", reference: `RC-${round}`, evidence: "Receipt on file", reportedAt: new Date().toISOString(), reportedBy: "Sales", verifiedAt: new Date().toISOString(), verifiedBy: "Finance" });
  data.allocations ??= [];
  data.allocations.push({ id: randomUUID(), receiptId, paymentId, legalEntityId: entity.id, currency: "AED", amount, createdAt: new Date().toISOString(), createdBy: "Finance" });
  data.ownerReview = {
    id: randomUUID(), quoteId, quoteHash: quote.hash, status: "pending_approval",
    commission: 10, commissionLines: [], finalCommissionLines: [{ recipientName: "Sales", type: "sales", basis: "amount", value: 10, amount: 10 }],
    paymentProofUrl: "https://example.invalid/receipt", financeReviewedById: randomUUID(),
    submittedById: randomUUID(), checklist: { agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true },
  } as CommercialData["ownerReview"];
  await tenantQuery(`UPDATE commercial_cases SET content=$3,revision=$4 WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, caseId, JSON.stringify(data), data.revision]);
  // The real issue command hashes JSONB-canonical line keys. This fixture
  // mirrors that by hashing only after the first database round-trip.
  const canonical = (await state(caseId)).data as CommercialData;
  const canonicalQuote = canonical.quotes.find(item => item.id === quoteId)!;
  canonicalQuote.hash = freezeHash(canonicalQuote);
  canonicalQuote.clientDecision!.quoteHash = canonicalQuote.hash;
  canonical.agreement!.quoteHash = canonicalQuote.hash;
  canonical.ownerReview!.quoteHash = canonicalQuote.hash;
  await tenantQuery(`UPDATE commercial_cases SET content=$3,revision=$4 WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, caseId, JSON.stringify(canonical), canonical.revision]);
}

try {
  const provisioned = await request("/internal/tenants", "POST", {
    externalTenantId: `palm-flow-${suffix}`,
    owner: { email: ownerEmail, displayName: "Flow QA Owner" },
    name: "Palm Flow QA", slug: workspaceSlug,
    defaultCurrency: "AED", defaultLocale: "en-AE", defaultTimezone: "Asia/Dubai", unitSystem: "metric", weekStartsOn: 1,
    firstLegalEntity: { code: `F${suffix.toUpperCase()}`, displayName: "Palm Flow QA", registeredName: "Palm Flow QA", countryCode: "AE", baseCurrency: "AED", locale: "en-AE", timezone: "Asia/Dubai" },
  }, 201, false);
  workspaceId = provisioned.workspace.id;
  const quantitySurveyor = await tenantQuery<{ code: string }>(
    `SELECT permission.code FROM roles role
     JOIN role_permissions assigned ON assigned.role_id=role.id AND assigned.workspace_id=role.workspace_id
     JOIN permissions permission ON permission.id=assigned.permission_id
     WHERE role.workspace_id=$1 AND role.code='quantity_surveyor'`,
    [workspaceId],
  );
  assert.deepEqual(quantitySurveyor.rows.map(row => row.code).sort(), [
    "commercial.costs.view", "commercial.estimate", "crm.opportunities.view", "pre_projects.view",
  ], "A new workspace must provision an assignable QS reviewer with only the required quotation access");
  const activated = await request("/auth/invitations/activate", "POST", { invitationToken: provisioned.ownerInvitation.invitationToken, password }, 201, false);
  token = activated.accessToken;
  ownerId = (await request("/me")).id;
  const fixture = JSON.parse(await readFile(new URL("../../../docs/fixtures/palm-project-workflow.json", import.meta.url), "utf8"));
  await tenantQuery(`INSERT INTO project_workflow_templates(workspace_id,code,name,description,is_default,version,stages,created_by) VALUES($1,$2,$3,$4,true,1,$5,$6)`, [workspaceId, fixture.code, fixture.name, fixture.description, JSON.stringify(fixture.stages), ownerId]);

  const insufficientCase = await createCase("Insufficient design deposit QA");
  await command(insufficientCase, "set_palm_flow", { scope: { design: true, mainQuotation: false, materialSelection: false, procurement: false, manufacturing: false, siteWorks: false, installation: false } });
  const insufficientCreated = await command(insufficientCase, "create");
  await injectAcceptedRound(insufficientCase, insufficientCreated.data.quotes.at(-1).id, "design", 14_999);
  await command(insufficientCase, "decide_owner_review", { decision: "approve" }, 409);
  const prematureProject = await tenantQuery(`SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, insufficientCase]);
  assert.equal(prematureProject.rowCount, 0, "A sub-AED 15,000 design payment must not create the Deal project");

  const designCase = await createCase("Design and furniture QA");
  const designScope = { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true };
  await command(designCase, "set_palm_flow", { scope: designScope });
  const designCreated = await command(designCase, "create");
  const designQuoteId = designCreated.data.quotes.at(-1).id;
  const roundActors = await approveDesignRoundThroughApi(designCase, designQuoteId);
  const openedProjects = await tenantQuery<{ id: string; reference: string }>(
    `SELECT p.id,e.content->'controls'->>'reference' AS reference
     FROM delivery_projects p JOIN project_execution e ON e.project_id=p.id
     WHERE p.workspace_id=$1 AND p.case_id=$2`, [workspaceId, designCase],
  );
  assert.equal(openedProjects.rowCount, 1, "First Owner approval must open exactly one project");
  const firstProject = openedProjects.rows[0];
  assert(firstProject?.reference?.startsWith("PRJ-"), "First paid round must open one Project Ref");
  const approvedCommercial = (await state(designCase)).data as CommercialData;
  const firstDealFileId = approvedCommercial.dealFile?.id;
  assert(firstDealFileId, "First paid round must create the Deal File");
  await tenantQuery(`UPDATE commercial_cases SET content=$3 WHERE workspace_id=$1 AND case_id=$2`,
    [workspaceId, designCase, JSON.stringify({ ...approvedCommercial, dealFile: null })]);
  const blockedProject = await projectState(firstProject.id);
  assert.match(blockedProject.workflowSummary.nextBlocker, /first paid, Owner-approved Deal File/);
  await projectCommand(firstProject.id, "workflow_transition", { toStageKey: "site_visit", note: "Missing Deal File" }, 409);
  await tenantQuery(`UPDATE commercial_cases SET content=$3 WHERE workspace_id=$1 AND case_id=$2`,
    [workspaceId, designCase, JSON.stringify(approvedCommercial)]);
  await projectCommand(firstProject.id, "workflow_transition", { toStageKey: "site_visit", note: "Paid design proposal" });
  await projectCommand(firstProject.id, "workflow_transition", { toStageKey: "design_specifications", note: "Missing visit" }, 409);
  await projectCommand(firstProject.id, "record_site_visit", {
    visitedOn: "2026-09-24", scopeSummary: "Living room and bedrooms measured; design brief confirmed",
    evidenceReference: "Site visit report QA-1", feeReviewNote: "Additional room may require a fee variation",
  });
  await projectCommand(firstProject.id, "workflow_transition", { toStageKey: "design_specifications", note: "Visit recorded" });
  await approveDesignDeliverableThroughApi(designCase, roundActors);
  const mainCreated = await command(designCase, "create");
  const mainQuoteId = mainCreated.data.quotes.at(-1).id;
  assert.equal(mainCreated.data.designRound.quoteId, designQuoteId);
  assert.equal(mainCreated.data.dealFile.id, firstDealFileId);
  await approveMainRoundThroughApi(designCase, mainQuoteId, roundActors);
  const afterMain = await state(designCase);
  assert.equal(afterMain.data.dealFile.id, firstDealFileId);
  assert.equal(afterMain.data.dealFile.id, afterMain.data.designRound.dealFile.id);
  assert.equal(afterMain.data.designRound.ownerReview.status, "approved");
  assert.equal(afterMain.data.designRound.dealFile.quoteId, designQuoteId);
  assert.equal(afterMain.data.ownerReview.status, "approved");
  assert.equal(afterMain.data.ownerReview.quoteId, mainQuoteId);
  assert.equal(afterMain.data.payments.length, 2);
  assert.equal(afterMain.data.payments[0].agreementReference, `QA-DESIGN-${suffix}`);
  const projects = await tenantQuery<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, designCase]);
  assert.equal(projects.rowCount, 1);
  assert.equal(projects.rows[0].id, firstProject.id);
  const beforeMaterialSignoff = await command(designCase, "release", { note: "Premature procurement" }, 409);
  assert.match(JSON.stringify(beforeMaterialSignoff), /material approvals/i);
  const projectMember = (await tenantQuery<{ id: string }>(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceId, ownerId],
  )).rows[0];
  assert(projectMember, "Project stage ownership needs an active member");
  await projectCommand(firstProject.id, "project_roles", { assignments: [
    { role: "senior_designer", memberId: projectMember.id },
    { role: "sales_manager", memberId: projectMember.id },
    { role: "surveyor", memberId: projectMember.id },
    { role: "finance", memberId: projectMember.id },
    { role: "procurement_production", memberId: projectMember.id },
    { role: "project_manager", memberId: projectMember.id },
  ] });
  for (const stage of ["main_quote", "main_qs_review", "main_client_approval",
    "main_agreement_payment", "material_list_signoff"]) {
    const transitioned = await projectCommand(firstProject.id, "workflow_transition", { toStageKey: stage });
    assert.equal(transitioned.data.workflow.currentStageKey, stage);
  }
  const prematureProcurement = await projectCommand(firstProject.id, "workflow_transition",
    { toStageKey: "procurement" }, 409);
  assert.match(JSON.stringify(prematureProcurement), /material sign-off/i);
  const selections = await command(designCase, "sync_material_approvals");
  const pendingSelections = selections.data.materialApprovals.filter((item: { quoteId: string }) => item.quoteId === mainQuoteId);
  assert(pendingSelections.length > 0, "The main quotation must generate material-list decisions");
  for (const selection of pendingSelections) {
    await command(designCase, "submit_material_approval", {
      materialApprovalId: selection.id, approverId: roundActors.approverId,
    });
    const challenge = await portalCommand("challenge", {
      phone: roundActors.mobile, purpose: `material-decision:${designCase}:${selection.id}:accept`,
    }, roundActors.clientToken);
    await portalCommand("action", {
      caseId: designCase, action: "material-decision", materialApprovalId: selection.id,
      decision: "accept", note: "", challengeId: challenge.challengeId, code: "123456",
    }, roundActors.clientToken);
  }
  const signedOff = (await state(designCase)).data as CommercialData;
  assert(signedOff.materialApprovals.filter(item => item.quoteId === mainQuoteId)
    .every(item => item.status === "approved"));
  const procurementRelease = await command(designCase, "release", {
    note: "Client material list signed and production scope released",
  });
  assert.equal(procurementRelease.data.release.projectId, firstProject.id,
    "Procurement must continue the original paid project");
  assert.equal(procurementRelease.data.dealFile.id, firstDealFileId);
  assert.equal(procurementRelease.data.dealFile.materialEvidence.length, pendingSelections.length);
  assert.equal((await projectState(firstProject.id)).data.workflow.currentStageKey, "procurement");
  const manufacturingReadiness = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "manufacturing_readiness", note: "Procurement handoff recorded",
  });
  assert.equal(manufacturingReadiness.data.workflow.currentStageKey, "manufacturing_readiness");
  const prematureFactory = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "factory_production", note: "No production plan yet",
  }, 409);
  assert.match(JSON.stringify(prematureFactory), /production_plan_ready/i);
  const releasedProject = (await projectState(firstProject.id)).data;
  const productionPackages = releasedProject.workPackages.filter((item: { status: string; deliveryRoute: string }) =>
    item.status !== "cancelled" && ["factory", "vendor", "mixed"].includes(item.deliveryRoute));
  assert(productionPackages.length > 0, "The released main quote must create production planning packages");
  const productionDay = new Date().toISOString().slice(0, 10);
  const factoryResourceId = randomUUID();
  const siteResourceId = randomUUID();
  const handoffs: { factoryTaskId: string; siteTaskId: string; quantity: number }[] = [];
  await projectCommand(firstProject.id, "resource", { resource: {
    id: factoryResourceId, name: `QA Factory ${suffix}`, kind: "factory", members: [], active: true,
  } });
  await projectCommand(firstProject.id, "resource", { resource: {
    id: siteResourceId, name: `QA Install Crew ${suffix}`, kind: "crew", members: [projectMember.id], active: true,
  } });
  await projectCommand(firstProject.id, "commercial", {
    budget: releasedProject.scope.value, forecast: 0, financeClosed: false,
    note: "Approved operational budget for the accepted main quotation",
  });
  for (const workPackage of productionPackages) {
    const current = (await projectState(firstProject.id)).data;
    const sources = current.scope.lines.filter((line: { id: string }) => workPackage.scopeLineIds.includes(line.id));
    assert(sources.length > 0, "A production package must link back to released BOQ lines");
    await projectCommand(firstProject.id, "delivery_quantities", {
      id: workPackage.id, version: 0, status: "confirmed",
      rows: sources.map((line: { id: string; title: string; quantity: number; unit: string }) => ({
        id: randomUUID(), title: line.title, quantity: line.quantity, unit: line.unit, basis: "",
        sources: [{ scopeLineId: line.id, quantity: line.quantity }],
      })),
    });
    const planned = (await projectState(firstProject.id)).data;
    const packagePlan = planned.workPackages.find((item: { id: string }) => item.id === workPackage.id);
    const schedule = { ...packagePlan, ownerId: projectMember.id, plannedStart: productionDay,
      plannedEnd: productionDay, nextAction: "Start factory task", nextActionOwnerId: projectMember.id,
      nextActionDate: productionDay };
    const withoutTask = await projectCommand(firstProject.id, "work_package", {
      workPackage: { ...schedule, status: "ready" },
    }, 409);
    assert.match(JSON.stringify(withoutTask), /delivery task/i);
    const approvedDrawing = planned.documents.find((document: { id: string; status: string; scopeLineIds?: string[] }) =>
      document.status === "approved" && sources.some((line: { id: string }) => document.scopeLineIds?.includes(line.id)));
    assert(approvedDrawing, "The accepted design must produce an approved project document for factory planning");
    const factoryTaskId = randomUUID(), siteTaskId = randomUUID();
    await projectCommand(firstProject.id, "task", { task: {
      id: factoryTaskId, parentId: "", package: packagePlan.title, title: `Make ${packagePlan.title}`,
      description: "Production task for the accepted main quotation", area: packagePlan.area,
      location: "factory", ownerId: projectMember.id, assigneeIds: [], resourceId: factoryResourceId,
      start: productionDay, end: productionDay, predecessors: [],
      quantity: sources[0].quantity, unit: sources[0].unit, weight: 1, priority: "normal",
      inspectionRequired: true, scopeIds: sources.map((line: { id: string }) => line.id),
      drawingId: approvedDrawing.id, readiness: { scope: true, access: true, materials: true },
    } });
    await projectCommand(firstProject.id, "task", { task: {
      id: siteTaskId, parentId: "", package: packagePlan.title, title: `Install ${packagePlan.title}`,
      description: "Receive and install accepted factory output", area: packagePlan.area,
      location: "site", ownerId: projectMember.id, assigneeIds: [], resourceId: siteResourceId,
      start: productionDay, end: productionDay, predecessors: [factoryTaskId],
      quantity: sources[0].quantity, unit: sources[0].unit, weight: 1, priority: "normal",
      inspectionRequired: true, scopeIds: sources.map((line: { id: string }) => line.id),
      drawingId: approvedDrawing.id, readiness: { scope: true, access: true, materials: true },
    } });
    handoffs.push({ factoryTaskId, siteTaskId, quantity: sources[0].quantity });
    await projectCommand(firstProject.id, "materials_from_scope", {
      scopeLineIds: sources.map((line: { id: string }) => line.id),
    });
    const beforePurchase = (await projectState(firstProject.id)).data;
    const material = beforePurchase.materials.find((item: { taskId: string; scopeLineId: string }) =>
      item.taskId === factoryTaskId && sources.some((line: { id: string }) => line.id === item.scopeLineId));
    assert(material, "The released BOQ must create a factory-linked material requirement");
    const shortage = await projectCommand(firstProject.id, "work_package", {
      workPackage: { ...beforePurchase.workPackages.find((item: { id: string }) => item.id === workPackage.id),
        ...schedule, status: "ready" },
    }, 409);
    assert.match(JSON.stringify(shortage), /not fully available/i);
    const orderId = randomUUID();
    await projectCommand(firstProject.id, "order", { order: {
      id: orderId, title: material.title, vendor: "Palm QA material supplier", kind: "material",
      materialId: material.id, taskId: factoryTaskId, quantity: material.required, unit: material.unit,
      unitCost: 100, promisedDate: productionDay,
    } });
    await projectCommand(firstProject.id, "order_status", { id: orderId, status: "submitted" });
    const purchasingToken = token;
    token = roundActors.approvingOwner.token;
    await projectCommand(firstProject.id, "order_status", { id: orderId, status: "approved" });
    token = purchasingToken;
    await projectCommand(firstProject.id, "order_status", {
      id: orderId, status: "acknowledged", note: "Supplier confirmed the order and delivery date",
      promisedDate: productionDay,
    });
    const arrived = await projectCommand(firstProject.id, "receipt", {
      id: orderId, accepted: 0, rejected: 0, pending: material.required,
      received: material.required, note: `Uninspected delivery QA-GRN-${suffix}`,
    });
    const pendingReceipt = arrived.data.orders.find((item: { id: string }) => item.id === orderId)?.receipts.at(-1);
    assert.equal(pendingReceipt?.pending, material.required);
    token = roundActors.approvingOwner.token;
    const inspectedReceipt = await projectCommand(firstProject.id, "receipt_inspect", {
      id: orderId, receiptId: pendingReceipt.id, expectedPending: material.required,
      accepted: material.required, rejected: 0, note: `Independent goods inspection ${suffix}`,
    });
    assert(inspectedReceipt.data.materials.find((item: { id: string }) => item.id === material.id)?.movements
      .some((movement: { kind: string; quantity: number }) => movement.kind === "receive" && movement.quantity === material.required));
    token = purchasingToken;
    await projectCommand(firstProject.id, "order_status", {
      id: orderId, status: "closed", confirmed: true, note: "All ordered material accepted and inspected",
    });
    const withTask = (await projectState(firstProject.id)).data.workPackages.find((item: { id: string }) => item.id === workPackage.id);
    const ready = await projectCommand(firstProject.id, "work_package", {
      workPackage: { ...withTask, ...schedule, status: "ready" },
    });
    assert.equal(ready.data.workPackages.find((item: { id: string }) => item.id === workPackage.id)?.status, "ready");
  }
  const factory = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "factory_production", note: "Confirmed BOQ quantities and executable production tasks",
  });
  assert.equal(factory.data.workflow.currentStageKey, "factory_production");
  assert.equal((await state(designCase)).data.dealFile.id, firstDealFileId);
  const factoryTasks = factory.data.tasks.filter((item: { location: string }) => item.location === "factory");
  assert.equal(factoryTasks.length, productionPackages.length);
  const projectOperatorToken = token;
  for (const task of factoryTasks) {
    await projectCommand(firstProject.id, "booking", {
      taskId: task.id, note: "Synthetic factory capacity booking",
    });
    await projectCommand(firstProject.id, "task_status", { id: task.id, status: "in_progress" });
    const reportId = randomUUID();
    const submitted = await projectCommand(firstProject.id, "report_submit", { report: {
      id: reportId, date: productionDay, shift: "Day", location: "factory",
      entries: [{ taskId: task.id, quantity: task.quantity }], hours: 8, people: 2,
      summary: "Measured factory output completed", evidence: `Synthetic factory record ${suffix}`,
      materials: "Approved specification", issues: "", tomorrow: "Independent QC",
    } });
    assert.equal(submitted.data.reports.find((item: { id: string }) => item.id === reportId)?.status, "submitted");
    assert.equal(submitted.data.tasks.find((item: { id: string }) => item.id === task.id)?.approved, 0,
      "Submitted production output must not be accepted without review");
    const selfApproval = await projectCommand(firstProject.id, "approve_report", { id: reportId }, 403);
    assert.match(JSON.stringify(selfApproval), /Another reviewer/i);
    token = roundActors.approvingOwner.token;
    const reviewed = await projectCommand(firstProject.id, "approve_report", { id: reportId });
    assert.equal(reviewed.data.tasks.find((item: { id: string }) => item.id === task.id)?.status, "awaiting_inspection");
    const inspected = await projectCommand(firstProject.id, "inspect", {
      id: task.id, passed: true, note: `Independent factory QC ${suffix}`,
    });
    assert.equal(inspected.data.tasks.find((item: { id: string }) => item.id === task.id)?.status, "completed");
    assert.equal(inspected.data.tasks.find((item: { id: string }) => item.id === task.id)?.approved, task.quantity);
    token = projectOperatorToken;
  }
  for (const handoff of handoffs) {
    await projectCommand(firstProject.id, "booking", {
      taskId: handoff.siteTaskId, note: "Synthetic site crew booking",
    });
    const beforeReceipt = await projectCommand(firstProject.id, "task_status", {
      id: handoff.siteTaskId, status: "in_progress",
    }, 409);
    assert.match(JSON.stringify(beforeReceipt), /Receive accepted factory output/i);
    const dispatchId = randomUUID();
    await projectCommand(firstProject.id, "dispatch", { record: {
      id: dispatchId, title: "Accepted factory output for installation",
      taskId: handoff.factoryTaskId, receivingTaskId: handoff.siteTaskId,
      destination: "Palm QA site", quantity: handoff.quantity, dueDate: productionDay,
    } });
    token = roundActors.approvingOwner.token;
    await projectCommand(firstProject.id, "dispatch_status", { id: dispatchId, status: "ready" });
    token = projectOperatorToken;
    await projectCommand(firstProject.id, "dispatch_status", {
      id: dispatchId, status: "dispatched", carrier: "QA van", reference: `QA-DN-${suffix}`,
    });
    token = roundActors.approvingOwner.token;
    const received = await projectCommand(firstProject.id, "dispatch_status", {
      id: dispatchId, status: "received", accepted: handoff.quantity, rejected: 0,
      evidence: `Signed site receipt QA-GRN-${suffix}`,
    });
    assert.equal(received.data.dispatches.find((item: { id: string }) => item.id === dispatchId)?.accepted,
      handoff.quantity);
    token = projectOperatorToken;
  }
  const siteWorks = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "site_works", note: "QC-passed factory output received at site",
  });
  assert.equal(siteWorks.data.workflow.currentStageKey, "site_works");
  for (const handoff of handoffs) {
    const started = await projectCommand(firstProject.id, "task_status", {
      id: handoff.siteTaskId, status: "in_progress",
    });
    assert.equal(started.data.tasks.find((item: { id: string }) => item.id === handoff.siteTaskId)?.status,
      "in_progress");
    const siteReportId = randomUUID();
    const submitted = await projectCommand(firstProject.id, "report_submit", { report: {
      id: siteReportId, date: productionDay, shift: "Day", location: "site",
      entries: [{ taskId: handoff.siteTaskId, quantity: handoff.quantity }],
      hours: 6, people: 2, summary: "Installed accepted factory output",
      evidence: `Synthetic installation photo ${suffix}`, materials: "Accepted factory delivery",
      issues: "", tomorrow: "Independent site QC",
    } });
    assert.equal(submitted.data.tasks.find((item: { id: string }) => item.id === handoff.siteTaskId)?.approved, 0);
    token = roundActors.approvingOwner.token;
    const reviewed = await projectCommand(firstProject.id, "approve_report", { id: siteReportId });
    assert.equal(reviewed.data.tasks.find((item: { id: string }) => item.id === handoff.siteTaskId)?.status,
      "awaiting_inspection");
    const inspected = await projectCommand(firstProject.id, "inspect", {
      id: handoff.siteTaskId, passed: true, note: `Independent installation QC ${suffix}`,
    });
    assert.equal(inspected.data.tasks.find((item: { id: string }) => item.id === handoff.siteTaskId)?.status,
      "completed");
    token = projectOperatorToken;
  }
  const installation = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "installation", note: "Site output installed and QC inspected",
  });
  assert.equal(installation.data.workflow.currentStageKey, "installation");
  assert(installation.data.workPackages.every((item: { status: string }) => item.status === "completed"),
    "Finished factory and installation tasks must complete their linked work packages");
  const handoverClient = await enrollClientApprover(designCase);
  const warrantyDate = new Date(`${productionDay}T00:00:00Z`);
  warrantyDate.setUTCFullYear(warrantyDate.getUTCFullYear() + 1);
  const handoverIds: string[] = [];
  for (const workPackage of installation.data.workPackages) {
    const handoverId = randomUUID(), documentId = randomUUID();
    handoverIds.push(handoverId);
    await projectCommand(firstProject.id, "handover", { handover: {
      id: handoverId, sourcePackageId: workPackage.id,
      title: `${workPackage.title} acceptance`, warrantyUntil: warrantyDate.toISOString().slice(0, 10),
      clientReviewDueDate: productionDay, clientApproverId: handoverClient.approverId,
    } });
    const beforeCloseoutFile = await projectCommand(firstProject.id, "handover_status", {
      id: handoverId, status: "ready", confirmed: true, clientApproverId: handoverClient.approverId,
    }, 409);
    assert.match(JSON.stringify(beforeCloseoutFile), /closeout documents/i);
    await projectCommand(firstProject.id, "document", { document: {
      id: documentId, title: `${workPackage.title} as-built and care record`, kind: "as_built",
      revision: "R01", url: "", note: `Controlled as-built and care reference QA-${suffix}`,
      replaces: "", scopeLineIds: workPackage.scopeLineIds,
    } });
    await projectCommand(firstProject.id, "document_status", { id: documentId, status: "review" });
    token = roundActors.approvingOwner.token;
    await projectCommand(firstProject.id, "document_status", { id: documentId, status: "approved" });
    await projectCommand(firstProject.id, "publish_document", { id: documentId, published: true });
    token = projectOperatorToken;
    const siteTask = installation.data.tasks.find((item: { packageId: string; location: string }) =>
      item.packageId === workPackage.id && item.location === "site");
    assert(siteTask, "The handover package must contain inspected site work");
    const snagId = randomUUID();
    await projectCommand(firstProject.id, "snag", { snag: {
      id: snagId, title: "QA alignment correction", taskId: siteTask.id, area: siteTask.area,
      ownerId: projectMember.id, severity: "minor", dueDate: productionDay,
      evidence: `Site inspection note ${suffix}`,
    } });
    const unresolvedSnag = await projectCommand(firstProject.id, "handover_status", {
      id: handoverId, status: "ready", confirmed: true, clientApproverId: handoverClient.approverId,
    }, 409);
    assert.match(JSON.stringify(unresolvedSnag), /open defects/i);
    await projectCommand(firstProject.id, "snag_status", {
      id: snagId, status: "ready", note: "Alignment corrected with site photo",
    });
    token = roundActors.approvingOwner.token;
    await projectCommand(firstProject.id, "snag_status", {
      id: snagId, status: "closed", note: "Independent verification of corrected alignment",
    });
    const ready = await projectCommand(firstProject.id, "handover_status", {
      id: handoverId, status: "ready", confirmed: true, clientApproverId: handoverClient.approverId,
      clientReviewDueDate: productionDay,
    });
    assert.equal(ready.data.handovers.find((item: { id: string }) => item.id === handoverId)?.status, "ready");
    token = projectOperatorToken;
  }
  const snagging = await projectCommand(firstProject.id, "workflow_transition", {
    toStageKey: "snagging", note: "QC-passed work and reviewed handover packs await client sign-off",
  });
  assert.equal(snagging.data.workflow.currentStageKey, "snagging");
  const beforeClientSignoff = await projectCommand(firstProject.id, "complete_project", {
    note: "Client has not accepted the handover pack",
  }, 409);
  assert.match(JSON.stringify(beforeClientSignoff), /handover|accept/i);
  for (const handoverId of handoverIds) {
    const challenge = await portalCommand("challenge", {
      phone: handoverClient.mobile,
      purpose: `handover-decision:${designCase}:${firstProject.id}:${handoverId}:accept`,
    }, handoverClient.clientToken);
    await portalCommand("action", {
      caseId: designCase, action: "handover-decision", projectId: firstProject.id,
      handoverId, decision: "accept", note: "", challengeId: challenge.challengeId, code: "123456",
    }, handoverClient.clientToken);
  }
  const acceptedHandovers = (await projectState(firstProject.id)).data.handovers;
  assert(acceptedHandovers.length > 0 && acceptedHandovers.every((item: { status: string; decisionSource: string }) =>
    item.status === "accepted" && item.decisionSource === "client_portal"));
  token = roundActors.approvingOwner.token;
  const financialClose = await projectCommand(firstProject.id, "commercial", {
    budget: releasedProject.scope.value, forecast: releasedProject.scope.value,
    financeClosed: true, financeEvidence: `Reconciled Palm QA final account ${suffix}`,
    note: "Client-accepted handover and closed supplier commitments",
  });
  assert.equal(financialClose.data.financeClosed, true);
  const finished = await projectCommand(firstProject.id, "complete_project", {
    note: "Client portal sign-off, inspected work and final account complete",
  });
  assert.equal(finished.data.phase, "completed");
  assert.equal(finished.data.workflow.currentStageKey, "completed");
  assert.equal((await state(designCase)).data.dealFile.id, firstDealFileId);
  const completedProjects = await tenantQuery<{ id: string }>(
    "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2", [workspaceId, designCase],
  );
  assert.equal(completedProjects.rowCount, 1);
  assert.equal(completedProjects.rows[0].id, firstProject.id);
  token = projectOperatorToken;

  const designOnlyCase = await createCase("Moodboards-only QA");
  await command(designOnlyCase, "set_palm_flow", { scope: {
    design: true, mainQuotation: false, materialSelection: false, procurement: false,
    manufacturing: false, siteWorks: false, installation: false,
  } });
  const designOnlyQuoteId = (await command(designOnlyCase, "create")).data.quotes.at(-1).id;
  const designOnlyActors = await approveDesignRoundThroughApi(designOnlyCase, designOnlyQuoteId);
  const designOnlyProjects = await tenantQuery<{ id: string }>(
    "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2", [workspaceId, designOnlyCase],
  );
  assert.equal(designOnlyProjects.rowCount, 1);
  const designOnlyProjectId = designOnlyProjects.rows[0].id;
  const designOnlyWorkflow = (await projectState(designOnlyProjectId)).data.workflow;
  assert.deepEqual(designOnlyWorkflow.template.stages.map((stage: { key: string }) => stage.key),
    ["deal_file", "site_visit", "design_specifications", "completed"],
    "Moodboards-only work must not acquire a main quote or delivery stages");
  await projectCommand(designOnlyProjectId, "workflow_transition", { toStageKey: "site_visit" });
  await projectCommand(designOnlyProjectId, "record_site_visit", {
    visitedOn: "2026-09-24", scopeSummary: "Moodboard rooms and brief confirmed",
    evidenceReference: "Moodboards QA visit", feeReviewNote: "No fee variation",
  });
  const holdOwner = (await tenantQuery<{ id: string }>(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceId, ownerId],
  )).rows[0];
  assert(holdOwner, "The project hold needs an active owner");
  const beforeHold = await projectState(designOnlyProjectId);
  await projectCommand(designOnlyProjectId, "project_controls", { controls: {
    ...beforeHold.data.controls, onHold: true, holdReason: "Awaiting client access", holdOwnerId: holdOwner.id,
  } });
  const heldTransition = await projectCommand(designOnlyProjectId, "workflow_transition",
    { toStageKey: "design_specifications" }, 409);
  assert.match(JSON.stringify(heldTransition), /hold/i);
  const heldState = await projectState(designOnlyProjectId);
  assert.equal(heldState.data.workflow.currentStageKey, "site_visit");
  assert.equal(heldState.data.siteVisit.evidenceReference, "Moodboards QA visit");
  await projectCommand(designOnlyProjectId, "project_controls", { controls: {
    ...heldState.data.controls, onHold: false, holdReason: "", holdOwnerId: "",
  } });
  await projectCommand(designOnlyProjectId, "workflow_transition", { toStageKey: "design_specifications" });
  await projectCommand(designOnlyProjectId, "complete_project", { note: "Client decision is still pending" }, 409);
  await approveDesignDeliverableThroughApi(designOnlyCase, designOnlyActors);
  const designOnlyCompleted = await projectCommand(designOnlyProjectId, "complete_project", {
    note: "Client-approved moodboards delivered",
  });
  assert.equal(designOnlyCompleted.data.workflow.currentStageKey, "completed");
  assert.equal(designOnlyCompleted.data.phase, "completed");
  assert.equal((await state(designOnlyCase)).data.quotes.length, 1);

  const furnitureCase = await createCase("Ready-made furniture QA");
  await command(furnitureCase, "set_palm_flow", { scope: { design: false, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: false, installation: true } });
  const furnitureCreated = await command(furnitureCase, "create");
  const furnitureQuoteId = furnitureCreated.data.quotes.at(-1).id;
  const furnitureActors = { ...roundActors, ...await enrollClientApprover(furnitureCase) };
  await approveMainRoundThroughApi(furnitureCase, furnitureQuoteId, furnitureActors, true);
  const furnitureCommercial = (await state(furnitureCase)).data as CommercialData;
  assert.equal(furnitureCommercial.designRound, undefined, "Furniture-only must not invent a design quote round");
  assert.equal(furnitureCommercial.materialApprovals.length, 0,
    "Ready-made furniture must not require a separate material meeting");
  const furnitureProjects = await tenantQuery<{ id: string }>(
    "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2", [workspaceId, furnitureCase],
  );
  assert.equal(furnitureProjects.rowCount, 1, "The first main payment must open one furniture project");
  const furnitureProjectId = furnitureProjects.rows[0].id;
  assert.deepEqual((await projectState(furnitureProjectId)).data.workflow.template.stages
    .map((stage: { key: string }) => stage.key),
    ["deal_file", "procurement", "installation", "snagging", "completed"],
    "Ready-made furniture must skip design, material selection and factory stages");
  const released = await command(furnitureCase, "release", { note: "Verified ready-made scope" });
  assert(released.data.release?.projectId, "Ready-made furniture must release into the existing project");
  assert.equal(released.data.release.projectId, furnitureProjectId);
  const execution = (await tenantQuery<{ content: { workflow: { currentStageKey: string; template: { stages: { key: string }[] } } } }>(`SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2`, [workspaceId, released.data.release.projectId])).rows[0].content;
  assert.equal(execution.workflow.currentStageKey, "procurement");
  assert(!execution.workflow.template.stages.some(stage => stage.key === "factory_production"));
  console.log("PASS: Two Palm quote rounds keep one Deal/project through client-approved material sign-off, inspected procurement receipts, booked factory and site work, independent QC, signed site delivery, snag closure, client portal handover and final account; design-only and ready-made routes skip inapplicable work.");
} finally {
  await admin.end();
}
