// Sales intake rules against a real API: referrer required (PLM-035), duplicates (PLM-093),
// returning customers (PLM-037). Run through scripts/smoke-funnel-isolated.sh.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8164/api/v1";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(api).hostname)) throw new Error("Local test API only.");
const run = randomUUID();
const owner = { "x-wodana-user-subject": `sales-rules-${run}`, "x-wodana-user-email": `sales-rules-${run}@example.com`, "x-wodana-user-name": "Rules Owner" };
async function req(path, { body, method = body ? "POST" : "GET", expected = method === "POST" ? 201 : 200, key } = {}) {
  const response = await fetch(api + path, { method, headers: { ...owner, ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
let failed = 0;
async function check(name, work) { try { await work(); console.log("PASS", name); } catch (error) { failed += 1; console.log("FAIL", name, error.message); } }

const ws = await req("/workspaces", { body: { name: "Sales rules QA", slug: `rules-${run.slice(0, 8)}`, defaultCurrency: "AED", defaultLocale: "en-AE", defaultTimezone: "Asia/Dubai", unitSystem: "metric", weekStartsOn: 1,
  firstLegalEntity: { code: "QA", displayName: "Rules QA", registeredName: "Rules QA", countryCode: "AE", baseCurrency: "AED", locale: "en-AE", timezone: "Asia/Dubai" } } });
const base = `/workspaces/${ws.workspace.id}/crm`;
const choices = await req(`${base}/lead-options`);
await req(`${base}/taxonomies`, { body: { code: "lead_source", name: "Lead source", options: [...choices.sources.map((option, position) => ({ code: option.id, label: option.label, position })), { code: "returning_customer", label: "Returning Customer", position: 99 }] } });
await req(`${base}/taxonomies`, { body: { code: "lead_channel_returning_customer", name: "Returning channels", options: [{ code: "old_leads", label: "Old Leads" }] } });
await req(`${base}/taxonomies`, { body: { code: "lead_channel_referral", name: "Referral channels", options: [{ code: "external", label: "External" }, { code: "partner", label: "Partner" }] } });
await req(`${base}/taxonomies`, { body: { code: "referral_partner", name: "Referral partners", options: [{ code: "odg", label: "ODG" }] } });

const mobile = () => `+97150${String(Math.floor(1000000 + Math.random() * 8999999))}`;
const payload = (party, extra = {}) => ({ source: "company", channel: "call", intakeMethod: "manual", party, serviceType: "not_sure", details: { emirate: "dubai" }, assignment: { mode: "unassigned" }, originalPayload: { qa: run }, ...extra });
const add = (body, expected) => req(`${base}/intake-events`, { body, key: randomUUID(), expected });
const attach = async (result) => {
  if (result.status !== "duplicate_candidate") return result;
  const intake = await req(`${base}/intake-events/${result.intakeEventId}`);
  const candidate = intake.candidates[0];
  return req(`${base}/duplicate-candidates/${candidate.id}/review`, { body: { decision: "attach", partyId: candidate.partyId, version: candidate.version, reason: "Same customer" } });
};

await check("A referral needs who referred it; the referrer is stored", async () => {
  await add(payload({ displayName: "No referrer", mobile: mobile() }, { source: "referral", channel: "external" }), 422);
  await add(payload({ displayName: "Bad partner", mobile: mobile() }, { source: "referral", channel: "partner", referral: { option: "nobody" } }), 422);
  const external = await add(payload({ displayName: "Referred A", mobile: mobile() }, { source: "referral", channel: "external", referral: { name: "Omar Haddad", contact: "+971 50 111 2222" } }));
  const partner = await add(payload({ displayName: "Referred B", mobile: mobile() }, { source: "referral", channel: "partner", referral: { option: "odg" } }));
  assert.deepEqual((await req(`${base}/leads/${external.leadId}`)).enquiry.referral, { kind: "external", name: "Omar Haddad", contact: "+971 50 111 2222", membershipId: null, option: null, memberName: null });
  assert.equal((await req(`${base}/leads/${partner.leadId}`)).enquiry.referral.option, "odg");
});

let original, contact;
await check("The same client enquiring on another channel becomes a duplicate of the open enquiry", async () => {
  contact = { displayName: "Repeat Client", mobile: mobile() };
  original = await add(payload(contact));
  const second = await attach(await add(payload({ displayName: "Repeat Client", mobile: contact.mobile }, { channel: "whatsapp" })));
  const lead = await req(`${base}/leads/${second.leadId}`);
  assert.equal(lead.status, "duplicate");
  assert.equal(lead.duplicateOfLeadId ?? lead.duplicate_of_lead_id, original.leadId);
});

await check("A known client with no open enquiry comes back as a returning customer, keeping the chosen source", async () => {
  const lead = await req(`${base}/leads/${original.leadId}`);
  await req(`${base}/leads/${original.leadId}/status`, { body: { version: lead.version, status: "disqualified", reason: "Not interested now" } });
  const back = await attach(await add(payload({ displayName: "Repeat Client", mobile: contact.mobile }, { channel: "whatsapp" })));
  const detail = await req(`${base}/leads/${back.leadId}`);
  assert.equal(detail.status, "new");
  assert.equal(detail.enquiry.source, "returning_customer");
  assert.equal(detail.enquiry.channel, "old_leads");
});

await check("Logging contact moves the enquiry through the salesperson's lists (PLM-042, PLM-076)", async () => {
  const members = await req(`/workspaces/${ws.workspace.id}/members`);
  const me = members.find((member) => member.roles.includes("owner")).id;
  const queue = await req(`${base}/queues`, { body: { name: "Sales", code: `sales-${run.slice(0, 6)}`, isFallback: true } });
  await req(`${base}/queues/${queue.id}/members`, { method: "PUT", body: { membershipId: me, capacity: 100, weight: 1, isAvailable: true } });
  const created = await add(payload({ displayName: "Funnel Client", mobile: mobile() }, { assignment: { mode: "manual", ownerMembershipId: me, queueId: queue.id } }));
  const inList = async (funnel) => (await req(`${base}/leads?mine=true&funnel=${funnel}&limit=100`)).data.some((row) => row.id === created.leadId);
  assert.equal(await inList("new"), true);
  let lead = await req(`${base}/leads/${created.leadId}`);
  await req(`${base}/leads/${created.leadId}/contacts`, { body: { version: lead.version, channel: "call", outcome: "no_answer", note: "" }, expected: 422 });
  await req(`${base}/leads/${created.leadId}/contacts`, { body: { version: lead.version, channel: "call", outcome: "no_answer", note: "Rang twice" } });
  assert.equal(await inList("contacted"), true);
  lead = await req(`${base}/leads/${created.leadId}`);
  await req(`${base}/leads/${created.leadId}/contacts`, { body: { version: lead.version, channel: "whatsapp", outcome: "come_back_later", note: "Needs time to think" }, expected: 422 });
  const followUp = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await req(`${base}/leads/${created.leadId}/contacts`, { body: { version: lead.version, channel: "whatsapp", outcome: "come_back_later", note: "Needs time to think", nextActionAt: followUp } });
  lead = await req(`${base}/leads/${created.leadId}`);
  assert.equal(lead.status, "paused");
  assert.equal(new Date(lead.nextActionAt).toISOString(), followUp);
  assert.equal(await inList("come_back"), true);
  await req(`${base}/leads/${created.leadId}/contacts`, { body: { version: lead.version, channel: "call", outcome: "not_interested", note: "Went with another firm" }, expected: 422 });
});

console.log(failed ? `${failed} failed` : "All sales rule checks passed");
process.exit(failed ? 1 : 0);
