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

/** The client's side of the portal (plan §6.22): its own session token, never a staff one. */
async function portalRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>, portalToken?: string) {
  const response = await fetch(`${api}/client-portal/${workspaceSlug}/${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(portalToken ? { authorization: `Bearer ${portalToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, method === "GET" ? 200 : 201, `Client portal ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

/** A client decision: a fresh code bound to the exact record and choice, then one idempotent command. */
async function portalDecision(portalToken: string, action: string, purpose: string, body: Record<string, unknown>) {
  const challenge = await portalRequest("challenge", "POST", { purpose }, portalToken);
  const result = await portalRequest("command", "POST", { commandId: randomUUID(), action, ...body, challengeId: challenge.challengeId, code: "123456" }, portalToken);
  assert.equal(result.ok, true, `Client portal ${action} must succeed`);
  return result;
}

async function portalProject(portalToken: string, caseId: string) {
  const view = await portalRequest("view", "GET", undefined, portalToken);
  const project = view.projects.find((item: { id: string }) => item.id === caseId);
  assert(project, "The case must be shared with this client");
  return project;
}

async function enrollClientApprover(caseId: string) {
  const portalPath = `/workspaces/${workspaceId}/client-portal`;
  const current = await request(`${portalPath}/settings`);
  assert.equal(current.demo, true, "Synthetic client codes must run in local test mode");
  if (!current.settings.enabled)
    await request(`${portalPath}/settings`, "PUT", { version: current.settings.version, enabled: true });
  const mobile = `+9715${randomInt(10_000_000, 100_000_000)}`;
  await request(`${portalPath}/cases/${caseId}/contacts`, "PUT",
    { name: "Palm QA client", phone: mobile, role: "approver", active: true, testContact: true });
  const approver = (await state(caseId)).contacts.find((contact: { phone: string }) => contact.phone === mobile);
  assert(approver, "The client approver must be linked to this case");
  const loginChallenge = await portalRequest("challenge", "POST", { phone: mobile });
  const session = await portalRequest("login", "POST", { challengeId: loginChallenge.challengeId, code: "123456" });
  assert(session.token, "The client portal must open a session");
  return { mobile, approverId: approver.id as string, clientToken: session.token as string };
}

/** The issued revision as the client reads it, accepted with its code; the case records the decision. */
async function clientAcceptsQuote(portalToken: string, caseId: string, quoteId: string) {
  const issued = (await portalProject(portalToken, caseId)).decisions.quotes.find((item: { id: string }) => item.id === quoteId);
  assert.equal(issued?.canDecide, true, "The issued quotation must wait for the client's decision");
  await portalDecision(portalToken, "quote_decision", `quote:${caseId}:${quoteId}:accept`,
    { caseId, quoteId, decision: "accept", selectedOptionLineIds: [], note: "", hash: issued.hash });
  assert.equal((await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId)?.status, "accepted");
}

/** Quote lines and payment terms are written through the quotation builder (version-checked ops), never the case JSON. */
async function buildQuote(caseId: string, quoteId: string, line: Record<string, unknown>, term: Record<string, unknown>) {
  const path = `/workspaces/${workspaceId}/quotation/cases/${caseId}/quotes/${quoteId}`;
  const lineId = randomUUID();
  await request(`${path}/lines`, "POST", { ops: [{ op: "upsert", line: { id: lineId, ...line } }] }, 201);
  await request(`${path}/payment-terms`, "PUT", { terms: [{ id: randomUUID(), ...term }] });
  const built = (await state(caseId)).data.quotes.find((item: Quote) => item.id === quoteId) as Quote;
  assert.deepEqual(built.lines.map((item) => item.id), [lineId], "The builder's line must be the quote's only line");
  assert.equal(Number(built.lines[0].rate), Number(line.rate));
  assert.equal(built.paymentTerms.length, 1);
}

async function approveDesignRoundThroughApi(caseId: string, quoteId: string) {
  const submitterToken = token;
  await buildQuote(caseId, quoteId,
    { title: "Interior design package", description: "Moodboards and measured design scope", quantity: "1", unit: "package", unitCost: "9000", rate: "15000" },
    { title: "Design deposit", percent: 100, trigger: "Signed design agreement", requiredForRelease: true, requiredForProduction: false });
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
  await clientAcceptsQuote(client.clientToken, caseId, quoteId);

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
  const shared = (await portalProject(actors.clientToken, caseId)).decisions.designs.find((item: { id: string }) => item.id === versionId);
  assert.equal(shared?.canDecide, true, "The design shared for review must wait for the client's decision");
  await portalDecision(actors.clientToken, "design_decision", `design:${caseId}:${versionId}:accept`,
    { caseId, versionId, decision: "accept", note: "" });
  const designs = await request(`/workspaces/${workspaceId}/pre-projects/${caseId}/designs`);
  assert.equal(designs.items.find((item: { id: string }) => item.id === designId)?.versions?.[0]?.status, "approved");
}

async function approveMainRoundThroughApi(caseId: string, quoteId: string, actors: RoundActors, readyMade = false) {
  const submitterToken = token;
  await buildQuote(caseId, quoteId, {
    title: readyMade ? "Ready-made sofa and table" : "Fitout and furniture package",
    description: readyMade ? "Catalog furniture; no design or factory work" : "Fitted joinery and selected furniture",
    material: readyMade ? "Supplier finished" : "Mixed", quantity: "1", unit: "package",
    unitCost: readyMade ? "5000" : "40000", rate: readyMade ? "9000" : "70000",
  }, { title: "Main agreement payment", percent: 100, trigger: "Signed main agreement", requiredForRelease: true, requiredForProduction: true });
  await command(caseId, "submit", { quoteId });
  token = actors.qs.token;
  const estimated = await command(caseId, "qs_approve", { quoteId });
  assert.equal(estimated.data.quotes.find((item: Quote) => item.id === quoteId)?.qsEstimate?.reviewedById, actors.qs.id);
  token = submitterToken;
  await command(caseId, "issue", { quoteId, approverId: actors.approverId });
  await clientAcceptsQuote(actors.clientToken, caseId, quoteId);
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
  await tenantQuery(`SELECT commercial_case_save($1,$2,$4,$3::jsonb)`, [workspaceId, caseId, JSON.stringify(data), data.revision]);
  // The real issue command hashes JSONB-canonical line keys. This fixture
  // mirrors that by hashing only after the first database round-trip.
  const canonical = (await state(caseId)).data as CommercialData;
  const canonicalQuote = canonical.quotes.find(item => item.id === quoteId)!;
  canonicalQuote.hash = freezeHash(canonicalQuote);
  canonicalQuote.clientDecision!.quoteHash = canonicalQuote.hash;
  canonical.agreement!.quoteHash = canonicalQuote.hash;
  canonical.ownerReview!.quoteHash = canonicalQuote.hash;
  await tenantQuery(`SELECT commercial_case_save($1,$2,$4,$3::jsonb)`, [workspaceId, caseId, JSON.stringify(canonical), canonical.revision]);
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

  // The minimum design deposit is workspace configuration (Palm: AED 15,000), not a constant.
  await request(`/workspaces/${workspaceId}/design/settings`, "PUT", { minimumDeposit: { amount: "15000.00", currency: "AED" } });
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
  // A paid design round opens design work in Planning; it never starts the project.
  assert.equal((await tenantQuery(`SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, designCase])).rowCount, 0,
    "Owner approval of the design round must not start a project");
  const approvedCommercial = (await state(designCase)).data as CommercialData;
  const firstDealFileId = approvedCommercial.dealFile?.id;
  assert(firstDealFileId, "First paid round must create the Deal File");
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
  // The old release step is gone: a project starts from the accepted quotation.
  const oldRelease = await command(designCase, "release", { note: "Old path" }, 409);
  assert.match(JSON.stringify(oldRelease), /accepted quotation/);

  // Start the project from the accepted main quotation: one project, a sealed scope, the route's stages.
  const projectMember = (await tenantQuery<{ id: string }>(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceId, ownerId],
  )).rows[0];
  assert(projectMember, "The project manager must be an active member");
  const projects = `/workspaces/${workspaceId}/project-core`;
  const readiness = await request(`${projects}/start/${designCase}`);
  assert.equal(readiness.quote.id, mainQuoteId, "The main quotation, not the design fee, starts the project");
  assert(readiness.canStart, `Start rules must pass: ${JSON.stringify(readiness.checks)}`);
  const started = await request(`${projects}/start/${designCase}`, "POST", {
    quoteId: mainQuoteId, leadMembershipId: projectMember.id, name: "Design and furniture QA", promiseDate: "2027-03-31",
  }, 201);
  const startedAgain = await request(`${projects}/start/${designCase}`, "POST", { quoteId: mainQuoteId, leadMembershipId: projectMember.id }, 201);
  assert.deepEqual(startedAgain, { projectId: started.projectId, existing: true }, "Starting twice must return the same project");
  let project = await request(`${projects}/projects/${started.projectId}`);
  assert.match(project.project.reference, /^PRJ-\d{4}$/);
  const acceptedMain = afterMain.data.quotes.find((quote: { id: string }) => quote.id === mainQuoteId);
  assert(Math.abs(Number(project.project.total) - acceptedMain.clientDecision.acceptedTotal) < 0.01, "The sealed total must equal the accepted total");
  const live = await request(`${projects}/projects/${started.projectId}/scope`);
  assert(live.lines.length > 0 && live.lines.every((line: { packageId: string | null }) => line.packageId), "The live BOQ starts from the sealed scope, grouped into packages");
  const sealed = await request(`${projects}/projects/${started.projectId}/seals/${live.seals[0].id}`);
  assert.equal(sealed.intact, true, "The sealed scope must verify against its fingerprint");
  assert.equal(project.stages[0].status, "current");
  assert.equal((await tenantQuery<{ status: string }>(`SELECT status FROM pre_project_cases WHERE workspace_id=$1 AND id=$2`, [workspaceId, designCase])).rows[0].status, "released",
    "Planning is read-only once the project starts");

  // Material List Sign-off: the project's list, sent as a revision, decided by the client in the portal.
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "save_material", name: "Oak veneer", specification: "Crown cut, matt lacquer",
    quantity: "12", unit: "sheet", boqLineIds: [live.lines[0].id], version: project.project.version }, 201);
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "send_materials", version: project.project.version }, 201);
  const materials = (await portalProject(roundActors.clientToken, designCase)).decisions.materials;
  assert.equal(materials?.canDecide, true, "The sent material list must wait for the client's decision");
  await portalDecision(roundActors.clientToken, "materials_decision", `materials:${designCase}:${materials.id}:submit`, {
    caseId: designCase, revisionId: materials.id, decisions: materials.items.map((item: { id: string }) => ({ itemId: item.id, decision: "approved" })),
  });
  assert.equal((await tenantQuery<{ status: string }>(`SELECT status FROM project_material_revisions WHERE workspace_id=$1 AND id=$2`, [workspaceId, materials.id])).rows[0].status,
    "signed_off", "Every material approved signs the list off");
  project = await request(`${projects}/projects/${started.projectId}`);
  const kickoff = project.stages[0];
  const meeting = kickoff.checks.find((check: { kind: string }) => check.kind === "confirm");
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "confirm_check", stageId: kickoff.id, checkKey: meeting.key, version: project.project.version }, 201);
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "complete_stage", stageId: kickoff.id, version: project.project.version }, 201);
  assert.equal(project.stages[1].status, "current");
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "hold", reason: "Client travelling", version: project.project.version }, 201);
  const held = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "complete_stage", stageId: project.stages[1].id, version: project.project.version }, 409);
  assert.match(JSON.stringify(held), /on hold/);
  project = await request(`${projects}/projects/${started.projectId}`, "POST", { action: "resume", version: project.project.version }, 201);
  assert.equal(project.project.status, "active");

  // Design-only work stays in Planning: its design fee never starts a project.
  const designOnlyCase = await createCase("Moodboards-only QA");
  await command(designOnlyCase, "set_palm_flow", { scope: {
    design: true, mainQuotation: false, materialSelection: false, procurement: false,
    manufacturing: false, siteWorks: false, installation: false,
  } });
  const designOnlyQuoteId = (await command(designOnlyCase, "create")).data.quotes.at(-1).id;
  const designOnlyActors = await approveDesignRoundThroughApi(designOnlyCase, designOnlyQuoteId);
  await approveDesignDeliverableThroughApi(designOnlyCase, designOnlyActors);
  assert.equal((await tenantQuery(`SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, designOnlyCase])).rowCount, 0);
  assert.equal((await request(`${projects}/start/${designOnlyCase}`)).quote, null, "A design fee quotation must not offer to start a project");

  // Ready-made furniture: one main round, then the project starts from it.
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
  assert.equal((await tenantQuery(`SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, furnitureCase])).rowCount, 0,
    "Owner approval alone must not start the project");
  const furnitureStarted = await request(`${projects}/start/${furnitureCase}`, "POST", { quoteId: furnitureQuoteId, leadMembershipId: projectMember.id }, 201);
  const list = await request(`${projects}/projects`);
  assert.deepEqual(new Set(list.projects.map((row: { id: string }) => row.id)), new Set([started.projectId, furnitureStarted.projectId]));
  console.log("PASS: Design fee rounds stay in Planning; accepted main quotations start one project each with a sealed scope, the client's material list sign-off in the portal, the route's stages, stage checks and holds.");
} finally {
  await admin.end();
}
