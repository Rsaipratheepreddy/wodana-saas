import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8120/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "test-internal-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const owner = {
  "x-wodana-user-subject": `crm-owner-${runId}`,
  "x-wodana-user-email": `crm-owner-${runId}@example.com`,
  "x-wodana-user-name": "CRM Owner",
};

async function request(path, { body, method = body ? "POST" : "GET", expected, headers = owner, internal = false } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(internal ? { "x-wodana-internal-token": internalToken } : headers),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  const wanted = expected ?? (method === "POST" ? 201 : 200);
  assert.equal(response.status, wanted, `${method} ${path}: expected ${wanted}, got ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

const workspace = await request("/workspaces", {
  body: {
    name: "Global CRM Verification",
    slug: `global-crm-${runId}`,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "GLOBAL",
      displayName: "Global CRM Verification",
      registeredName: "Global CRM Verification LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
const workspaceId = workspace.workspace.id;
const members = await request(`/workspaces/${workspaceId}/members`);
const ownerMembershipId = members.find((member) => member.roles.includes("owner")).id;
const defaultAutomations = await request(`/workspaces/${workspaceId}/crm/automations`);
assert.equal(defaultAutomations.length, 6);
assert.equal(defaultAutomations.every((item) => item.status === "draft"), true);

const queue = await request(`/workspaces/${workspaceId}/crm/queues`, { body: { code: "global-inbox", name: "Global inbox", isFallback: true } });
await request(`/workspaces/${workspaceId}/crm/queues/${queue.id}/members`, { method: "PUT", expected: 200, body: { membershipId: ownerMembershipId, capacity: 50, weight: 1, isAvailable: true, skills: ["interior_design"], languages: ["en", "ar"] } });
const updatedQueue = await request(`/workspaces/${workspaceId}/crm/queues/${queue.id}`, { method: "PATCH", expected: 200, body: { version: queue.version, name: "Global enquiries", isFallback: true } });
assert.equal(updatedQueue.name, "Global enquiries");
const assignmentPolicy = await request(`/workspaces/${workspaceId}/crm/assignment-policies`, { body: { name: "Balanced global assignment", priority: 1, fallbackQueueId: queue.id, preserveRelationshipOwner: true, rules: [{ name: "Interior design", priority: 1, queueId: queue.id, conditions: { serviceType: "interior_design" } }] } });
const updatedAssignmentPolicy = await request(`/workspaces/${workspaceId}/crm/assignment-policies/${assignmentPolicy.id}`, { method: "PATCH", expected: 200, body: { version: assignmentPolicy.version, name: "Balanced global routing", rules: [{ name: "Interior design", priority: 1, queueId: queue.id, conditions: { serviceType: ["interior_design", "fit_out"] } }] } });
assert.equal(updatedAssignmentPolicy.rules.length, 1);
const slaPolicy = await request(`/workspaces/${workspaceId}/crm/sla-policies`, { body: { name: "First response", eventType: "first_response", warningAfterMinutes: 0, breachAfterMinutes: 30, schedule: { timezone: "workspace" } } });
const updatedSlaPolicy = await request(`/workspaces/${workspaceId}/crm/sla-policies/${slaPolicy.id}`, { method: "PATCH", expected: 200, body: { version: slaPolicy.version, name: "First response SLA", warningAfterMinutes: 0, breachAfterMinutes: 45 } });
assert.equal(updatedSlaPolicy.breachAfterMinutes, 45);

const pipeline = await request(`/workspaces/${workspaceId}/crm/pipelines`, { body: { code: "sales", name: "Sales", isDefault: true, stages: [{ code: "qualified", name: "Qualified", position: 1, probability: 30, forecastCategory: "pipeline", entryRequirements: { nextAction: true } }, { code: "commit", name: "Commit", position: 2, probability: 80, forecastCategory: "commit", entryRequirements: { amount: true, expectedCloseAt: true, owner: true } }] } });
assert.equal(pipeline.stages.length, 2);
const updatedPipeline = await request(`/workspaces/${workspaceId}/crm/pipelines/${pipeline.id}`, { method: "PATCH", expected: 200, body: { version: pipeline.version, name: "Global sales", isDefault: true } });
assert.equal(updatedPipeline.name, "Global sales");
const testStage = await request(`/workspaces/${workspaceId}/crm/pipelines/${pipeline.id}/stages`, { body: { code: "future", name: "Future", position: 99, probability: 5, forecastCategory: "pipeline", entryRequirements: {} } });
const archivedTestStage = await request(`/workspaces/${workspaceId}/crm/pipelines/${pipeline.id}/stages/${testStage.id}`, { method: "PATCH", expected: 200, body: { version: testStage.version, name: "Future work", status: "archived" } });
assert.equal(archivedTestStage.status, "archived");

const taxonomy = await request(`/workspaces/${workspaceId}/crm/taxonomies`, { body: { code: "lead_source", name: "Lead source", options: [{ code: "referral", label: "Referral" }, { code: "web", label: "Web" }] } });
const updatedTaxonomy = await request(`/workspaces/${workspaceId}/crm/taxonomies/${taxonomy.id}`, { method: "PATCH", expected: 200, body: { version: taxonomy.version, name: "Enquiry source", options: [{ code: "referral", label: "Client referral", position: 1 }, { code: "web", label: "Website", position: 2 }] } });
assert.equal(updatedTaxonomy.options.filter((option) => option.status === "active").length, 2);
const customField = await request(`/workspaces/${workspaceId}/crm/custom-fields`, { body: { entityType: "party", key: "preferred_style", label: "Preferred style", dataType: "select", configuration: { options: ["modern", "classic"] } } });
const updatedCustomField = await request(`/workspaces/${workspaceId}/crm/custom-fields/${customField.id}`, { method: "PATCH", expected: 200, body: { version: customField.version, label: "Preferred design style", searchable: true, configuration: { options: ["modern", "classic", "transitional"] } } });
assert.equal(updatedCustomField.searchable, true);
const qualificationForm = await request(`/workspaces/${workspaceId}/crm/qualification-forms`, { body: { code: "global_qualification", name: "Global qualification", questions: [{ key: "budget_confirmed", label: "Budget confirmed", dataType: "boolean", required: true, position: 1 }] } });
const updatedQualificationForm = await request(`/workspaces/${workspaceId}/crm/qualification-forms/${qualificationForm.id}`, { method: "PATCH", expected: 200, body: { version: qualificationForm.version, status: "active", questions: [{ key: "budget_confirmed", label: "Budget is confirmed", dataType: "boolean", required: true, position: 1 }, { key: "timeline", label: "Project timeline", dataType: "text", required: false, position: 2 }] } });
assert.equal(updatedQualificationForm.questions.length, 2);
const savedView = await request(`/workspaces/${workspaceId}/crm/saved-views`, { body: { entityType: "leads", name: "My open leads", isShared: false, definition: { status: ["new", "connected"] } } });
const updatedSavedView = await request(`/workspaces/${workspaceId}/crm/saved-views/${savedView.id}`, { method: "PATCH", expected: 200, body: { version: savedView.version, name: "My active leads", definition: { status: ["new", "connected", "nurturing"] } } });
assert.equal(updatedSavedView.name, "My active leads");

let lifecycleParty = await request(`/workspaces/${workspaceId}/crm/parties`, { body: { type: "person", displayName: "Lifecycle customer", givenName: "Life", familyName: "Cycle", contacts: [{ type: "email", value: `lifecycle-${runId}@example.com`, isPrimary: true }], addresses: [{ label: "Home", locality: "Dubai", countryCode: "AE", isPrimary: true }] } });
lifecycleParty = await request(`/workspaces/${workspaceId}/crm/parties/${lifecycleParty.id}`, { method: "PATCH", expected: 200, body: { version: lifecycleParty.version, displayName: "Lifecycle Customer", jobTitle: "Design client" } });
assert.equal(lifecycleParty.person.job_title, "Design client");
const lifecycleContact = lifecycleParty.contacts[0];
const updatedContact = await request(`/workspaces/${workspaceId}/crm/parties/${lifecycleParty.id}/contact-points/${lifecycleContact.id}`, { method: "PATCH", expected: 200, body: { version: lifecycleContact.version, label: "Preferred", isVerified: true } });
assert.equal(updatedContact.isVerified, true);
const secondAddress = await request(`/workspaces/${workspaceId}/crm/parties/${lifecycleParty.id}/addresses`, { body: { label: "Site", line1: "Verification Street", locality: "Dubai", countryCode: "AE", isPrimary: true } });
const updatedAddress = await request(`/workspaces/${workspaceId}/crm/parties/${lifecycleParty.id}/addresses/${secondAddress.id}`, { method: "PATCH", expected: 200, body: { version: secondAddress.version, region: "Dubai" } });
assert.equal(updatedAddress.region, "Dubai");
let erasureParty = await request(`/workspaces/${workspaceId}/crm/parties`, { body: { type: "person", displayName: "Privacy customer", contacts: [{ type: "email", value: `privacy-${runId}@example.com`, isPrimary: true }], addresses: [{ locality: "Dubai", countryCode: "AE" }] } });
const relationship = await request(`/workspaces/${workspaceId}/crm/relationships`, { body: { fromPartyId: lifecycleParty.id, toPartyId: erasureParty.id, type: "household", label: "Primary contact", isPrimary: true } });
const endedRelationship = await request(`/workspaces/${workspaceId}/crm/relationships/${relationship.id}`, { method: "PATCH", expected: 200, body: { version: relationship.version, label: "Former household", endedAt: new Date().toISOString() } });
assert.ok(endedRelationship.endedAt);
const csvExport = await request(`/workspaces/${workspaceId}/crm/parties/export`, { body: { format: "csv" } });
assert.ok(csvExport.content.includes("Lifecycle Customer"));
const archivedParty = await request(`/workspaces/${workspaceId}/crm/parties/${lifecycleParty.id}/archive`, { body: { version: lifecycleParty.version, reason: "Lifecycle verification" } });
assert.equal(archivedParty.archived, true);
erasureParty = await request(`/workspaces/${workspaceId}/crm/parties/${erasureParty.id}/privacy-erasure`, { body: { version: erasureParty.version, reason: "Privacy workflow verification" } });
assert.equal(erasureParty.erased, true);

const intakeBody = {
  source: "website",
  channel: "web",
  intakeMethod: "form",
  externalEventId: `web-${runId}`,
  party: { displayName: "مريم أحمد", email: `maryam-${runId}@example.com`, phone: "+971501234567", preferredLocale: "ar-AE", preferredTimezone: "Asia/Dubai" },
  title: "Full home interior enquiry",
  summary: "Arabic and English customer data verification",
  serviceType: "interior_design",
  originalPayload: { form: "website", campaign: "global-launch" },
  attribution: [{ source: "instagram", medium: "social", campaign: "global-launch" }],
  consents: [{ purpose: "service", channel: "email", status: "granted", evidence: { method: "checkbox" }, jurisdiction: "AE" }],
};
const intake = await request(`/workspaces/${workspaceId}/crm/intake-events`, { headers: { ...owner, "idempotency-key": `intake-${runId}`, "x-correlation-id": randomUUID() }, body: intakeBody });
assert.equal(intake.status, "ready");
const replay = await request(`/workspaces/${workspaceId}/crm/intake-events`, { headers: { ...owner, "idempotency-key": `intake-${runId}`, "x-correlation-id": randomUUID() }, body: intakeBody });
assert.equal(replay.id, intake.id);
const enquiries = await request(`/workspaces/${workspaceId}/crm/enquiries`);
assert.equal(enquiries.data.length, 1);
const enquiry = await request(`/workspaces/${workspaceId}/crm/enquiries/${intake.enquiryId}`);
assert.equal(enquiry.partyId, intake.partyId);
assert.equal(enquiry.attribution[0].campaign, "global-launch");

const leads = await request(`/workspaces/${workspaceId}/crm/leads`);
assert.equal(leads.data.length, 1);
const lead = leads.data[0];
await request(`/workspaces/${workspaceId}/crm/custom-fields/${customField.id}/value`, { body: { entityType: "party", entityId: lead.partyId, value: "modern" } });
const assignment = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/auto-assign?version=${lead.version}`, { body: {} });
assert.equal(assignment.ownerMembershipId, ownerMembershipId);
assert.equal(assignment.assignment.explanation.selected.membershipId, ownerMembershipId);
const processedSlas = await request(`/internal/crm/slas/workspaces/${workspaceId}/process`, { internal: true, body: { limit: 100 } });
assert.equal(processedSlas.warnings.length, 1);
const warnedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`);
const warnedList = await request(`/workspaces/${workspaceId}/crm/leads`);
assert.equal(warnedList.data[0].slaStatus, "warning");
await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/auto-assign?version=${warnedLead.version}`, { body: {} });
const reassignedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`);
assert.equal(reassignedLead.sla.length, warnedLead.sla.length, "Reassignment must preserve the SLA clock");
assert.equal(reassignedLead.sla[0].dueAt, warnedLead.sla[0].dueAt);
await request(`/workspaces/${workspaceId}/crm/activities`, { body: { leadId: lead.id, type: "note", title: "Discovery note" } });
assert.equal((await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`)).nextActionAt, reassignedLead.nextActionAt, "A note must not erase the follow-up");
await request(`/workspaces/${workspaceId}/crm/activities`, { expected: 422, body: { leadId: lead.id, type: "task", title: "Missing date", isNextAction: true } });
await request(`/workspaces/${workspaceId}/crm/activities`, { expected: 422, body: { leadId: lead.id, type: "note", title: "Not a commitment", dueAt: new Date().toISOString(), isNextAction: true } });

const activity = await request(`/workspaces/${workspaceId}/crm/activities`, { body: { partyId: lead.partyId, leadId: lead.id, type: "task", title: "Call customer", ownerMembershipId, dueAt: new Date(Date.now() + 3_600_000).toISOString(), isNextAction: true } });
const appointmentInput = { startsAt: new Date(Date.now() + 7200000).toISOString(), endsAt: new Date(Date.now() + 10800000).toISOString(), timezone: "Asia/Dubai" };
const meeting = await request(`/workspaces/${workspaceId}/crm/activities`, { body: { partyId: lead.partyId, leadId: lead.id, type: "meeting", title: "Calendar consultation", ownerMembershipId, appointment: appointmentInput } });
assert.equal(meeting.appointment.startsAt, meeting.dueAt, "Meeting and appointment save atomically with the same start");
const movedMeeting = await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}/appointment`, { method: "PATCH", body: { ...appointmentInput, version: meeting.appointment.version, startsAt: new Date(Date.now() + 14400000).toISOString(), endsAt: new Date(Date.now() + 18000000).toISOString() } });
assert.equal((await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}`)).dueAt, movedMeeting.startsAt);
const beforeActivityMove = await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}`);
const shiftedStart = new Date(Date.now() + 21600000).toISOString();
await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}`, { method: "PATCH", body: { version: beforeActivityMove.version, dueAt: shiftedStart } });
const afterActivityMove = await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}`);
assert.equal(afterActivityMove.appointment.startsAt, shiftedStart, "Activity rescheduling must also move its appointment");
assert.equal(Date.parse(afterActivityMove.appointment.endsAt) - Date.parse(afterActivityMove.appointment.startsAt), 3600000, "Rescheduling must preserve duration");
await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}`, { method: "PATCH", expected: 422, body: { version: afterActivityMove.version, dueAt: null } });
await request(`/workspaces/${workspaceId}/crm/activities/${meeting.id}/appointment`, { method: "PATCH", expected: 409, body: { ...appointmentInput, version: meeting.appointment.version } });
await request(`/workspaces/${workspaceId}/crm/activities`, { expected: 422, body: { partyId: lead.partyId, type: "meeting", title: "Invalid meeting", appointment: { ...appointmentInput, timezone: "Not/AZone" } } });
const calendar = await request(`/workspaces/${workspaceId}/crm/activities?limit=100&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
assert.equal(calendar.data.some((item) => item.id === meeting.id), true);
assert.equal(calendar.data.some((item) => item.title === "Invalid meeting"), false, "Failed appointments must roll back their activity");
assert.equal((await request(`/workspaces/${workspaceId}/crm/activities/${activity.id}`)).title, "Call customer");
const concurrentActions = await Promise.all([1, 2].map((i) => request(`/workspaces/${workspaceId}/crm/activities`, { body: { leadId: lead.id, type: "task", title: `Concurrent ${i}`, dueAt: new Date(Date.now() + i * 3600000).toISOString(), isNextAction: true } })));
const commitments = await request(`/workspaces/${workspaceId}/crm/activities?leadId=${lead.id}`);
assert.equal(commitments.data.filter((a) => a.isNextAction).length, 1, "Concurrent scheduling must leave only one next action");
const currentActivity = await request(`/workspaces/${workspaceId}/crm/activities/${activity.id}`);
const completedActivity = await request(`/workspaces/${workspaceId}/crm/activities/${activity.id}/complete`, { body: { version: currentActivity.version, outcome: "Customer contacted" } });
await request(`/workspaces/${workspaceId}/crm/activities/${activity.id}`, { method: "PATCH", expected: 409, body: { version: completedActivity.version, title: "Cannot edit completed activity" } });

const conversation = await request(`/workspaces/${workspaceId}/crm/conversations`, { body: { partyId: lead.partyId, leadId: lead.id, channel: "email", subject: "Design consultation", ownerMembershipId, participantPartyIds: [lead.partyId] } });
const emailTemplate = await request(`/workspaces/${workspaceId}/crm/notification-templates`, { body: { code: "consultation_followup", channel: "email", locale: "ar-AE", subjectTemplate: "{{subject}}", bodyTemplate: "مرحباً {{name}}", variables: ["subject", "name"] } });
await request(`/workspaces/${workspaceId}/crm/notification-templates/${emailTemplate.id}/approve`, { body: { versionNumber: emailTemplate.versionNumber } });
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/messages`, { body: { direction: "outbound", bodyText: "Welcome to Wodana", templateId: emailTemplate.id, purpose: "service" } });

// Shared inbox: real version conflicts, assignment, resolution, provider-only inbound and pagination.
let thread = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`);
assert.equal(thread.partyId, lead.partyId);
assert.equal(thread.ownerName, "CRM Owner");
assert.ok(thread.messages.length > 0);
const resolved = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`, { method: "PATCH", body: { version: thread.version, status: "closed", ownerMembershipId: null } });
assert.equal(resolved.status, "closed");
assert.equal(resolved.ownerMembershipId, null);
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`, { method: "PATCH", expected: 409, body: { version: thread.version, status: "open" } });
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/messages`, { expected: 409, body: { direction: "outbound", bodyText: "Must reopen first", purpose: "service" } });
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/messages`, { expected: 422, body: { direction: "inbound", bodyText: "Must not impersonate a customer" } });
const inboundId = `inbox-smoke-${runId}`;
const incoming = await request(`/internal/crm/workspaces/${workspaceId}/conversations/${conversation.id}/inbound-messages`, { internal: true, body: { direction: "inbound", bodyText: "Please call tomorrow", providerMessageId: inboundId } });
await request(`/internal/crm/workspaces/${workspaceId}/conversations/${conversation.id}/inbound-messages`, { internal: true, body: { direction: "inbound", bodyText: "Please call tomorrow", providerMessageId: inboundId } });
thread = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`);
assert.equal(thread.status, "open", "Customer reply must reopen a resolved thread");
assert.equal(thread.unreadCount, 1, "Provider retry must not duplicate unread counts");
assert.equal(thread.messages.filter((message) => message.id === incoming.id).length, 1);
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/read`, { body: {} });
thread = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`);
assert.equal(thread.unreadCount, 0);
const messagePage = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/messages?limit=1`);
assert.equal(messagePage.data.length, 1);
assert.ok(messagePage.nextCursor);
const olderMessages = await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}/messages?limit=1&cursor=${encodeURIComponent(messagePage.nextCursor)}`);
assert.equal(olderMessages.data.length, 1);
assert.notEqual(olderMessages.data[0].id, messagePage.data[0].id);
await request(`/workspaces/${workspaceId}/crm/conversations/${conversation.id}`, { method: "PATCH", body: { version: thread.version, ownerMembershipId } });
const unreadThreads = await request(`/workspaces/${workspaceId}/crm/conversations?unread=true`);
assert.equal(unreadThreads.data.some((item) => item.id === conversation.id), false);
const emptyThreadIds = [];
for (let index = 0; index < 3; index++) {
  const emptyThread = await request(`/workspaces/${workspaceId}/crm/conversations`, { body: { leadId: lead.id, channel: "internal", subject: `Empty paging ${index}` } });
  assert.equal(emptyThread.partyId, lead.partyId, "Lead-only thread must retain its customer link");
  emptyThreadIds.push(emptyThread.id);
}
const pagedIds = [];
let threadCursor;
do {
  const page = await request(`/workspaces/${workspaceId}/crm/conversations?search=Empty%20paging&limit=1${threadCursor ? `&cursor=${encodeURIComponent(threadCursor)}` : ""}`);
  pagedIds.push(...page.data.map((item) => item.id)); threadCursor = page.nextCursor;
  assert.ok(pagedIds.length <= 3, "Null message timestamps must not loop pagination");
} while (threadCursor);
assert.deepEqual(pagedIds.sort(), emptyThreadIds.sort());

let sequence = await request(`/workspaces/${workspaceId}/crm/sequences`, { body: { name: "Consultation follow-up", exitConditions: { customerReply: true }, steps: [{ type: "email", delayMinutes: 0, configuration: { templateCode: "consultation_followup", eventType: "service", locale: "ar-AE", variables: { subject: "Consultation", name: "مريم" } } }, { type: "task", delayMinutes: 1440, configuration: { title: "Review customer response" } }] } });
sequence = await request(`/workspaces/${workspaceId}/crm/sequences/${sequence.id}`, { method: "PATCH", expected: 200, body: { version: sequence.version, name: "Consultation follow-up sequence", exitConditions: { customerReply: true }, steps: [{ type: "email", delayMinutes: 0, configuration: { templateCode: "consultation_followup", eventType: "service", locale: "ar-AE", variables: { subject: "Consultation", name: "مريم" } } }, { type: "task", delayMinutes: 1440, configuration: { title: "Review customer response" } }] } });
await request(`/workspaces/${workspaceId}/crm/sequences/${sequence.id}/enrollments`, { expected: 404, body: { partyId: lead.partyId, leadId: lead.id } });
const publishedSequence = await request(`/workspaces/${workspaceId}/crm/sequences/${sequence.id}/publish`, { body: { version: sequence.version } });
assert.equal(publishedSequence.status, "active");
const enrollment = await request(`/workspaces/${workspaceId}/crm/sequences/${sequence.id}/enrollments`, { body: { partyId: lead.partyId, leadId: lead.id } });
assert.equal(enrollment.status, "active");
const processedSequences = await request(`/internal/crm/workspaces/${workspaceId}/sequences/process`, { internal: true, body: { limit: 10 } });
assert.equal(processedSequences.processed, 1);
assert.equal(processedSequences.items[0].currentStep, 1);
const sequenceList = await request(`/workspaces/${workspaceId}/crm/sequences`);
assert.equal(sequenceList.some((item) => item.id === sequence.id && item.steps.length === 2), true);
const sequenceEnrollments = await request(`/workspaces/${workspaceId}/crm/sequences/${sequence.id}/enrollments`);
assert.equal(sequenceEnrollments[0].currentStep, 1);
const disposableSequence = await request(`/workspaces/${workspaceId}/crm/sequences`, { body: { name: "Disposable sequence", exitConditions: {}, steps: [{ type: "delay", delayMinutes: 5, configuration: {} }] } });
const archivedSequence = await request(`/workspaces/${workspaceId}/crm/sequences/${disposableSequence.id}/archive`, { body: { version: disposableSequence.version } });
assert.equal(archivedSequence.status, "archived");

const refreshedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`);
let opportunity = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}/qualify`, { body: { leadVersion: refreshedLead.version, partyId: lead.partyId, pipelineId: pipeline.id, ownerMembershipId, title: "مريم — full home interiors", amount: 250000, currencyCode: "AED", expectedCloseAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), nextActionAt: new Date(Date.now() + 86_400_000).toISOString() } });
const convertedLead = await request(`/workspaces/${workspaceId}/crm/leads/${lead.id}`);
assert.equal(convertedLead.nextActionAt, null);
assert.equal(convertedLead.sla.every((timer) => timer.status === "stopped"), true);
assert.equal(convertedLead.opportunities[0].id, opportunity.id);
const carriedActivities = await request(`/workspaces/${workspaceId}/crm/activities?opportunityId=${opportunity.id}`);
assert.ok(carriedActivities.data.some((a) => a.id === concurrentActions[0].id));
assert.equal(carriedActivities.data.filter((a) => a.isNextAction).length, 1);
const nextCommitment = new Date(Date.now() + 2 * 86400000).toISOString();
opportunity = await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}`, { method: "PATCH", body: { version: opportunity.version, amount: 250000, currencyCode: "AED", nextActionAt: nextCommitment } });
assert.equal((await request(`/workspaces/${workspaceId}/crm/activities?opportunityId=${opportunity.id}`)).data.find((a) => a.isNextAction).dueAt, nextCommitment, "Opportunity edits must update the actual follow-up activity");
assert.equal((await request(`/workspaces/${workspaceId}/crm/opportunities?partyId=${lead.partyId}`)).data.every((item) => item.partyId === lead.partyId), true);
await request(`/workspaces/${workspaceId}/crm/activities`, { expected: 422, body: { leadId: lead.id, type: "task", title: "Closed lead follow-up", dueAt: new Date().toISOString(), isNextAction: true } });
await request(`/workspaces/${workspaceId}/crm/opportunities`, { expected: 422, body: { leadId: lead.id, partyId: lead.partyId, pipelineId: pipeline.id, title: "Duplicate conversion", nextActionAt: new Date().toISOString() } });
await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/stakeholders`, { body: { partyId: lead.partyId, role: "decision_maker", isPrimary: true } });
await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/team/${ownerMembershipId}`, { method: "PUT", expected: 200, body: { role: "account_owner" } });
const won = await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/transition`, { body: { version: opportunity.version, stageId: pipeline.stages[1].id, status: "won", reason: "Client accepted" } });
assert.equal(won.status, "won");
assert.equal(Number(won.probability), 100);
assert.equal(won.next_action_at, null);
assert.equal((await request(`/workspaces/${workspaceId}/crm/parties/${lead.partyId}`)).lifecycle, "customer");
const currentForecast = await request(`/workspaces/${workspaceId}/crm/reports/forecast`);
assert.equal(currentForecast.rows.find((row) => row.status === "won").count, 1, "Repeated snapshots must not inflate the forecast");
assert.equal(Number(currentForecast.rows.find((row) => row.status === "won").amount), 250000);
await request(`/workspaces/${workspaceId}/crm/activities`, { expected: 422, body: { opportunityId: opportunity.id, type: "task", title: "Closed deal follow-up", dueAt: new Date().toISOString(), isNextAction: true } });
const projectLink = await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/project-link`, { body: { projectId: randomUUID(), mode: "delivery" } });
assert.equal(projectLink.mode, "delivery");
await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/team/${ownerMembershipId}?role=account_owner`, { method: "DELETE", expected: 200 });
await request(`/workspaces/${workspaceId}/crm/opportunities/${opportunity.id}/stakeholders/${lead.partyId}?role=decision_maker`, { method: "DELETE", expected: 200 });

for (const [index, currency] of ["INR", "USD"].entries()) {
  const party = await request(`/workspaces/${workspaceId}/crm/parties`, { body: { type: "organization", displayName: `${currency} customer ${runId}`, legalName: `${currency} customer`, contacts: [{ type: "email", value: `${currency.toLowerCase()}-${runId}@example.com`, isVerified: true }] } });
  const created = await request(`/workspaces/${workspaceId}/crm/opportunities`, { body: { partyId: party.id, pipelineId: pipeline.id, ownerMembershipId, title: `${currency} opportunity`, amount: 1000 + index, currencyCode: currency, expectedCloseAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), nextActionAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
  assert.equal(created.currency_code, currency);
}

const mergeA = await request(`/workspaces/${workspaceId}/crm/parties`, { body: { type: "person", displayName: "Merge survivor" } });
const mergeB = await request(`/workspaces/${workspaceId}/crm/parties`, { body: { type: "person", displayName: "Merge source" } });
const merged = await request(`/workspaces/${workspaceId}/crm/parties/merge`, { body: { survivorPartyId: mergeA.id, mergedPartyId: mergeB.id, fieldDecisions: {}, reason: "Verification" } });
const mergedParty = await request(`/workspaces/${workspaceId}/crm/parties/${mergeB.id}`);
await request(`/workspaces/${workspaceId}/crm/party-merges/${merged.operationId}/reverse`, { body: { survivorVersion: merged.survivor.version, mergedVersion: mergedParty.version, reason: "Verification reversal" } });

const automation = await request(`/workspaces/${workspaceId}/crm/automations`, { body: { code: "new_enquiry_owner_alert", name: "New enquiry owner alert", runOncePerAggregate: true, definition: { nodes: [{ key: "start", type: "trigger", configuration: { eventTypes: ["crm.enquiry.ready.v1"] } }, { key: "followup", type: "create_task", configuration: { title: "Automation follow-up", priority: "high", delayMinutes: 60 } }, { key: "finish", type: "end", configuration: {} }], edges: [{ from: "start", to: "followup" }, { from: "followup", to: "finish" }] } } });
const dryRun = await request(`/workspaces/${workspaceId}/crm/automations/${automation.id}/dry-run`, { body: { context: { score: 91, locale: "ar-AE" } } });
const workflowDetail = await request(`/workspaces/${workspaceId}/crm/automations/${automation.id}`);
assert.equal(workflowDetail.validation.valid, true);
assert.equal(workflowDetail.definition.nodes.length, 3);
assert.equal(workflowDetail.draftVersionNumber, 1);
assert.deepEqual(dryRun.context, { score: 91, locale: "ar-AE" });
await request(`/workspaces/${workspaceId}/crm/automations/${automation.id}/publish`, { body: { version: automation.version } });
const matches = await request(`/internal/crm/automations/workspaces/${workspaceId}/matches?eventType=crm.enquiry.ready.v1`, { internal: true, expected: 200 });
assert.equal(matches.items.length, 1);
const run = await request(`/internal/crm/automations/${automation.id}/runs`, { internal: true, body: { workspaceId, triggerEventId: randomUUID(), aggregateType: "crm_lead", aggregateId: lead.id, correlationId: randomUUID(), context: { smoke: true } } });
const aggregateReplay = await request(`/internal/crm/automations/${automation.id}/runs`, { internal: true, body: { workspaceId, triggerEventId: randomUUID(), aggregateType: "crm_lead", aggregateId: lead.id, correlationId: randomUUID(), context: { smoke: true, replay: true } } });
assert.equal(aggregateReplay.id, run.id);
assert.equal(aggregateReplay.replayReason, "run_once_per_aggregate");
const executed = await request(`/internal/crm/automations/runs/${run.id}/steps/execute`, { internal: true, body: { workspaceId, stepKey: "followup", attempt: 1 } });
assert.equal(executed.status, "completed");
assert.equal(executed.output.ownerMembershipId, ownerMembershipId);
const replayedStep = await request(`/internal/crm/automations/runs/${run.id}/steps/execute`, { internal: true, body: { workspaceId, stepKey: "followup", attempt: 1 } });
assert.equal(replayedStep.idempotentReplay, true);
await request(`/internal/crm/automations/runs/${run.id}/advance`, { internal: true, body: { workspaceId, stepKey: "finish", attempt: 1, status: "completed", output: { smoke: true } } });

await request(`/workspaces/${workspaceId}/crm/notification-policies`, { body: { eventType: "service", name: "One service email per hour", channels: ["email"], frequencyLimit: { max: 1, windowMinutes: 60 } } });
const notification = await request(`/internal/crm/notifications/enqueue`, { internal: true, body: { workspaceId, recipientType: "party", recipientId: lead.partyId, channel: "email", templateCode: "consultation_followup", locale: "ar-AE", eventType: "service", variables: { subject: "Consultation", name: "مريم" }, idempotencyKey: `notification-${runId}`, correlationId: randomUUID() } });
const notificationReplay = await request(`/internal/crm/notifications/enqueue`, { internal: true, body: { workspaceId, recipientType: "party", recipientId: lead.partyId, channel: "email", templateCode: "consultation_followup", locale: "ar-AE", eventType: "service", variables: { subject: "Consultation", name: "مريم" }, idempotencyKey: `notification-${runId}`, correlationId: randomUUID() } });
assert.equal(notificationReplay.id, notification.id);
assert.equal(notificationReplay.idempotentReplay, true);
const rateLimited = await request(`/internal/crm/notifications/enqueue`, { internal: true, body: { workspaceId, recipientType: "party", recipientId: lead.partyId, channel: "email", templateCode: "consultation_followup", locale: "ar-AE", eventType: "service", variables: { subject: "Second", name: "مريم" }, idempotencyKey: `notification-rate-${runId}`, correlationId: randomUUID() } });
assert.equal(rateLimited.status, "suppressed");
assert.equal(rateLimited.suppressedReason, "frequency_limit");
const claimed = await request(`/internal/crm/notifications/claim`, { internal: true, body: { workspaceId, limit: 10 } });
assert.equal(claimed.items.some((item) => item.id === notification.id), true);
for (const item of claimed.items) await request(`/internal/crm/notifications/${item.id}/result`, { internal: true, body: { workspaceId, attempt: item.attempt, provider: "smoke-test", result: "delivered", providerMessageId: `message-${item.id}` } });

const lateConsent = await request(`/internal/crm/notifications/enqueue`, { internal: true, body: { workspaceId, recipientType: "party", recipientId: lead.partyId, channel: "email", templateCode: "consultation_followup", locale: "ar-AE", eventType: "late_consent_test", variables: { subject: "Consent", name: "مريم" }, idempotencyKey: `notification-consent-${runId}`, correlationId: randomUUID() } });
assert.equal(lateConsent.status, "pending");
await request(`/workspaces/${workspaceId}/crm/parties/${lead.partyId}/consents`, { body: { purpose: "service", channel: "email", status: "withdrawn", evidence: { method: "customer_request" }, jurisdiction: "AE" } });
const afterWithdrawal = await request(`/internal/crm/notifications/claim`, { internal: true, body: { workspaceId, limit: 10 } });
assert.equal(afterWithdrawal.items.some((item) => item.id === lateConsent.id), false);

for (const report of ["funnel", "sla", "sources", "assignment", "pipeline", "forecast"]) {
  const result = await request(`/workspaces/${workspaceId}/crm/reports/${report}`);
  assert.equal(result.report, report);
}
const today = await request(`/workspaces/${workspaceId}/crm/today`);
assert.ok(Array.isArray(today.items));
assert.equal(typeof today.summary.activeLeads, "number");
assert.equal(typeof today.summary.openOpportunities, "number");
assert.equal(typeof today.total, "number");

const otherOwner = { "x-wodana-user-subject": `other-${runId}`, "x-wodana-user-email": `other-${runId}@example.com`, "x-wodana-user-name": "Other owner" };
const other = await request("/workspaces", { headers: otherOwner, body: { name: "Isolated CRM", slug: `isolated-${runId}`, defaultCurrency: "USD", defaultLocale: "en-US", defaultTimezone: "America/New_York", unitSystem: "imperial", weekStartsOn: 0, firstLegalEntity: { code: "ISO", displayName: "Isolated CRM", registeredName: "Isolated CRM Inc", countryCode: "US", baseCurrency: "USD", locale: "en-US", timezone: "America/New_York" } } });
assert.ok(other.workspace.id);
await request(`/workspaces/${workspaceId}/crm/parties`, { headers: otherOwner, expected: 404 });

console.log(JSON.stringify({ ok: true, workspaceId, partyId: lead.partyId, leadId: lead.id, opportunityId: opportunity.id, projectHandoff: projectLink.id, currencies: ["AED", "INR", "USD"], reports: 6, enquiries: "queryable", sequences: "executing", tenantIsolation: true, automationReplaySafe: true, notificationDelivery: "simulated receipt verified; no external message sent" }, null, 2));
