import { randomUUID } from "node:crypto";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_CRM_SEED !== "true") {
  throw new Error("Refusing to seed CRM data in production without ALLOW_PRODUCTION_CRM_SEED=true");
}

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const workspaceSlug = process.env.IGLO_WORKSPACE_SLUG ?? "iglo-architects";
const bearerToken = process.env.CRM_SEED_TOKEN;
const actorHeaders = bearerToken
  ? { authorization: `Bearer ${bearerToken}` }
  : {
      "x-wodana-user-subject": process.env.CRM_SEED_USER_SUBJECT ?? "demo-owner",
      "x-wodana-user-email": process.env.CRM_SEED_USER_EMAIL ?? "admin@igloarchitects.com",
      "x-wodana-user-name": process.env.CRM_SEED_USER_NAME ?? "Iglo Administrator",
    };

async function request(path, { body, method = body === undefined ? "GET" : "POST", headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...actorHeaders, ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

const daysFromNow = (days, hour = 10) => {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const workspaces = await request("/workspaces");
const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
if (!workspace) throw new Error(`Workspace '${workspaceSlug}' is not available to the seed actor`);
const workspaceId = workspace.id;
const base = `/workspaces/${workspaceId}`;
const crm = `${base}/crm`;

const detail = await request(base);
const legalEntity = detail.legalEntities.find((candidate) => candidate.status === "active");
if (!legalEntity) throw new Error("Iglo workspace needs an active legal entity before CRM can be seeded");
const units = Object.fromEntries(detail.businessUnits.map((unit) => [unit.code, unit]));
const members = await request(`${base}/members`);
const ownerMembership = members.find((member) => member.status === "active" && member.roles.includes("owner"));
if (!ownerMembership) throw new Error("Iglo workspace needs an active owner membership before CRM can be seeded");

const existingQueues = await request(`${crm}/queues`);
let queue = existingQueues.find((candidate) => candidate.code === "design-enquiries");
if (!queue) {
  queue = await request(`${crm}/queues`, {
    body: { code: "design-enquiries", name: "Design enquiries", businessUnitId: units.INTERIORS?.id, isFallback: true },
  });
}
await request(`${crm}/queues/${queue.id}/members`, {
  method: "PUT",
  body: {
    membershipId: ownerMembership.id,
    capacity: 40,
    weight: 2,
    isAvailable: true,
    skills: ["architecture", "interior_design", "fit_out"],
    languages: ["en", "ar", "hi"],
    territories: ["Dubai", "Abu Dhabi", "Ras Al Khaimah"],
  },
});

const policies = await request(`${crm}/assignment-policies`);
if (!policies.some((policy) => policy.name === "Iglo design enquiry routing")) {
  await request(`${crm}/assignment-policies`, {
    body: {
      name: "Iglo design enquiry routing",
      priority: 10,
      fallbackQueueId: queue.id,
      preserveRelationshipOwner: true,
      rules: [
        { name: "Interior and fit-out enquiries", priority: 10, queueId: queue.id, conditions: { serviceType: ["interior_design", "fit_out"] } },
        { name: "Architecture enquiries", priority: 20, queueId: queue.id, conditions: { serviceType: "architecture" } },
      ],
    },
  });
}

const slaPolicies = await request(`${crm}/sla-policies`);
if (!slaPolicies.some((policy) => policy.eventType === "first_response")) {
  await request(`${crm}/sla-policies`, {
    body: {
      name: "New enquiry first response",
      eventType: "first_response",
      warningAfterMinutes: 30,
      breachAfterMinutes: 120,
      schedule: { timezone: "Asia/Dubai", weekdays: [1, 2, 3, 4, 5], startsAt: "09:00", endsAt: "18:00" },
    },
  });
}

const pipelines = await request(`${crm}/pipelines`);
let pipeline = pipelines.find((candidate) => candidate.code === "design-sales");
if (!pipeline) {
  pipeline = await request(`${crm}/pipelines`, {
    body: {
      code: "design-sales",
      name: "Design & build sales",
      isDefault: true,
      stages: [
        { code: "discovery", name: "Discovery", position: 10, probability: 15, forecastCategory: "pipeline", entryRequirements: { nextAction: true } },
        { code: "site-visit", name: "Site visit", position: 20, probability: 30, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
        { code: "proposal", name: "Proposal", position: 30, probability: 55, forecastCategory: "best_case", entryRequirements: { amount: true, expectedCloseAt: true, owner: true } },
        { code: "negotiation", name: "Negotiation", position: 40, probability: 80, forecastCategory: "commit", entryRequirements: { amount: true, expectedCloseAt: true, owner: true, stakeholders: true } },
        { code: "won", name: "Won", position: 50, probability: 100, forecastCategory: "closed", entryRequirements: { amount: true, expectedCloseAt: true, owner: true } },
        { code: "closed-lost", name: "Closed lost", position: 60, probability: 0, forecastCategory: "closed", entryRequirements: {} },
      ],
    },
  });
}
const pipelineStages = Object.fromEntries(pipeline.stages.map((stage) => [stage.code, stage]));

const settings = await request(`${crm}/settings`);
async function ensureTaxonomy(code, name, options) {
  const existing = settings.taxonomies.find((taxonomy) => taxonomy.code === code);
  if (existing) return existing;
  const created = await request(`${crm}/taxonomies`, { body: { code, name, options } });
  settings.taxonomies.push(created);
  return created;
}
async function ensureField(entityType, key, label, dataType, configuration = {}, extra = {}) {
  const existing = settings.customFields.find((field) => field.entityType === entityType && field.key === key);
  if (existing) return existing;
  const created = await request(`${crm}/custom-fields`, { body: { entityType, key, label, dataType, configuration, ...extra } });
  settings.customFields.push(created);
  return created;
}

await ensureTaxonomy("project_type", "Project type", [
  { code: "villa", label: "Villa", position: 10 },
  { code: "apartment", label: "Apartment", position: 20 },
  { code: "hospitality", label: "Hospitality", position: 30 },
  { code: "workplace", label: "Workplace", position: 40 },
  { code: "retail", label: "Retail", position: 50 },
]);
await ensureTaxonomy("lead_source", "Lead source", [
  { code: "referral", label: "Referral", position: 10 },
  { code: "instagram", label: "Instagram", position: 20 },
  { code: "website", label: "Website", position: 30 },
  { code: "developer", label: "Developer network", position: 40 },
  { code: "repeat", label: "Repeat client", position: 50 },
]);
const styleField = await ensureField("party", "preferred_style", "Preferred design style", "select", { options: ["Contemporary", "Minimal", "Warm modern", "Luxury", "Biophilic"] }, { searchable: true });
const areaField = await ensureField("opportunity", "project_area_sqm", "Project area (m²)", "number", {}, { searchable: true });
await ensureField("opportunity", "plot_reference", "Plot / unit reference", "text", {}, { searchable: true });

if (!settings.qualificationForms.some((form) => form.code === "design-enquiry")) {
  await request(`${crm}/qualification-forms`, {
    body: {
      code: "design-enquiry",
      name: "Design enquiry qualification",
      questions: [
        { key: "property_type", label: "What type of property is this?", dataType: "select", required: true, position: 10, configuration: { options: ["Villa", "Apartment", "Hospitality", "Workplace", "Retail"] } },
        { key: "project_area_sqm", label: "Approximate area in square metres", dataType: "number", required: false, position: 20 },
        { key: "budget_confirmed", label: "Has the client confirmed a working budget?", dataType: "boolean", required: true, position: 30, scoring: { true: 20, false: 0 } },
        { key: "target_handover", label: "Target handover date", dataType: "date", required: false, position: 40 },
        { key: "decision_maker", label: "Are we speaking with the decision maker?", dataType: "boolean", required: true, position: 50, scoring: { true: 15, false: 0 } },
      ],
    },
  });
}

const templates = await request(`${crm}/notification-templates`);
async function ensureApprovedTemplate(definition) {
  let template = templates.find((candidate) => candidate.code === definition.code && candidate.channel === definition.channel && candidate.locale === definition.locale && candidate.status === "approved");
  if (template) return template;
  template = await request(`${crm}/notification-templates`, { body: definition });
  template = await request(`${crm}/notification-templates/${template.id}/approve`, { body: { versionNumber: template.versionNumber } });
  templates.push(template);
  return template;
}
await ensureApprovedTemplate({ code: "design_consultation_confirmed", channel: "email", locale: "en-AE", subjectTemplate: "Your Iglo design consultation", bodyTemplate: "Hello {{name}}, your design consultation is confirmed for {{date}}. — Iglo Architects", variables: ["name", "date"] });
await ensureApprovedTemplate({ code: "proposal_follow_up", channel: "email", locale: "en-AE", subjectTemplate: "Following up on your Iglo proposal", bodyTemplate: "Hello {{name}}, we would be happy to walk you through the proposal and next steps.", variables: ["name"] });
const notificationPolicies = await request(`${crm}/notification-policies`);
if (!notificationPolicies.some((policy) => policy.name === "Client communication guardrails")) {
  await request(`${crm}/notification-policies`, { body: { eventType: "client_follow_up", name: "Client communication guardrails", channels: ["email", "whatsapp"], quietHours: { start: "20:00", end: "08:00", timezone: "Asia/Dubai" }, frequencyLimit: { max: 3, windowMinutes: 1440 } } });
}

const sequences = await request(`${crm}/sequences`);
if (!sequences.some((sequence) => sequence.name === "Proposal follow-up")) {
  await request(`${crm}/sequences`, {
    body: {
      name: "Proposal follow-up",
      exitConditions: { customerReply: true, opportunityClosed: true },
      steps: [
        { type: "email", delayMinutes: 1440, configuration: { templateCode: "proposal_follow_up", eventType: "client_follow_up", locale: "en-AE", variables: { name: "Client" } } },
        { type: "task", delayMinutes: 2880, configuration: { title: "Call client about proposal", priority: "high" } },
        { type: "email", delayMinutes: 7200, configuration: { templateCode: "proposal_follow_up", eventType: "client_follow_up", locale: "en-AE", variables: { name: "Client" } } },
      ],
    },
  });
}

const customerSeeds = [
  { key: "amira-villa", name: "Amira Al Mansoori", email: "amira.almansoori@example.ae", phone: "+971501110101", source: "instagram", channel: "web", campaign: "dubai-villa-collection", title: "Emirates Hills villa interior renovation", summary: "Full interior architecture for a six-bedroom family villa, including joinery, lighting, and landscape interfaces.", serviceType: "interior_design", unit: "INTERIORS", style: "Warm modern", area: 1180, amount: 1850000, target: "proposal", opportunityStatus: "open" },
  { key: "khalid-office", name: "Khalid Rahman", email: "khalid.rahman@example.ae", phone: "+971501110102", source: "referral", channel: "email", campaign: "client-referral", title: "DIFC executive office fit-out", summary: "Design and delivery of a 1,650 m² executive workplace with client suite and boardroom.", serviceType: "fit_out", unit: "DESIGN", style: "Contemporary", area: 1650, amount: 3200000, target: "negotiation", opportunityStatus: "open" },
  { key: "sara-penthouse", name: "Sara Al Nuaimi", email: "sara.alnuaimi@example.ae", phone: "+971501110103", source: "repeat", channel: "phone", campaign: "repeat-client", title: "Palm Jumeirah penthouse redesign", summary: "Turnkey redesign of a waterfront penthouse with bespoke furniture and art coordination.", serviceType: "interior_design", unit: "INTERIORS", style: "Luxury", area: 720, amount: 2450000, target: "won", opportunityStatus: "won" },
  { key: "yousef-majlis", name: "Yousef Al Shamsi", email: "yousef.alshamsi@example.ae", phone: "+971501110104", source: "website", channel: "web", campaign: "majlis-design", title: "Al Ain residence and majlis extension", summary: "Architectural extension and majlis interiors for an occupied family residence.", serviceType: "architecture", unit: "ARCH", style: "Warm modern", area: 940, amount: 1320000, target: "closed-lost", opportunityStatus: "lost" },
  { key: "leena-cafe", name: "Leena Mathew", email: "leena.mathew@example.ae", phone: "+971501110105", source: "instagram", channel: "web", campaign: "hospitality-stories", title: "Jumeirah neighbourhood café concept", summary: "Brand-led concept design and authority-ready interior package for a 180 m² café.", serviceType: "interior_design", unit: "CREATIVE", style: "Biophilic", desiredLeadStatus: "connected" },
  { key: "hassan-villa", name: "Hassan Qureshi", email: "hassan.qureshi@example.ae", phone: "+971501110106", source: "developer", channel: "email", campaign: "developer-network", title: "Tilal Al Ghaf villa customization", summary: "Layout modifications, interiors, and procurement support before handover.", serviceType: "interior_design", unit: "INTERIORS", style: "Minimal", desiredLeadStatus: "nurturing" },
  { key: "maya-clinic", name: "Dr Maya Nair", email: "maya.nair@example.ae", phone: "+971501110107", source: "referral", channel: "phone", campaign: "professional-referral", title: "Dubai wellness clinic design", summary: "Patient-focused clinic planning, interiors, signage, and tender documentation.", serviceType: "fit_out", unit: "DESIGN", style: "Minimal", desiredLeadStatus: "attempting_contact" },
  { key: "noura-apartment", name: "Noura Haddad", email: "noura.haddad@example.ae", phone: "+971501110108", source: "website", channel: "web", campaign: "apartment-refresh", title: "Bluewaters apartment refresh", summary: "Furniture, lighting, and styling refresh for a three-bedroom apartment.", serviceType: "interior_design", unit: "INTERIORS", style: "Contemporary", desiredLeadStatus: "paused", pauseReason: "Client travelling until next month" },
];

for (const seed of customerSeeds) {
  await request(`${crm}/intake-events`, {
    headers: { "idempotency-key": `iglo-seed-${seed.key}`, "x-correlation-id": randomUUID() },
    body: {
      legalEntityId: legalEntity.id,
      businessUnitId: units[seed.unit]?.id,
      source: seed.source,
      channel: seed.channel,
      intakeMethod: seed.channel === "web" ? "form" : "manual",
      externalEventId: `iglo-demo-${seed.key}`,
      party: { displayName: seed.name, email: seed.email, phone: seed.phone, phoneCountryCode: "AE", preferredLocale: "en-AE", preferredTimezone: "Asia/Dubai" },
      title: seed.title,
      summary: seed.summary,
      serviceType: seed.serviceType,
      originalPayload: { seeded: true, sourceDetail: seed.campaign, requestedService: seed.serviceType },
      attribution: [{ source: seed.source, medium: seed.channel, campaign: seed.campaign }],
      consents: [
        { purpose: "service", channel: "email", status: "granted", evidence: { method: "seeded_customer_request" }, jurisdiction: "AE" },
        { purpose: "service", channel: "whatsapp", status: "granted", evidence: { method: "seeded_customer_request" }, jurisdiction: "AE" },
      ],
    },
  });
}

const partiesResponse = await request(`${crm}/parties?limit=100`);
const partiesByName = new Map(partiesResponse.data.map((party) => [party.displayName, party]));
for (const seed of customerSeeds) {
  const party = partiesByName.get(seed.name);
  if (party) await request(`${crm}/custom-fields/${styleField.id}/value`, { body: { entityType: "party", entityId: party.id, value: seed.style } });
}

async function ensureOrganization(definition) {
  const search = await request(`${crm}/parties?type=organization&search=${encodeURIComponent(definition.displayName)}&limit=25`);
  const existing = search.data.find((party) => party.displayName === definition.displayName);
  if (existing) return existing;
  return request(`${crm}/parties`, { body: definition });
}
const organizations = [
  await ensureOrganization({ type: "organization", displayName: "Al Noor Developments LLC", legalName: "Al Noor Developments LLC", industry: "Real estate development", websiteDomain: "alnoor-demo.example", legalEntityId: legalEntity.id, ownerMembershipId: ownerMembership.id, contacts: [{ type: "email", value: "projects@alnoor-demo.example", label: "Projects", isPrimary: true }], addresses: [{ label: "Head office", locality: "Dubai", region: "Dubai", countryCode: "AE", isPrimary: true }] }),
  await ensureOrganization({ type: "organization", displayName: "Pearl Hospitality Group", legalName: "Pearl Hospitality Group LLC", industry: "Hospitality", websiteDomain: "pearlhospitality-demo.example", legalEntityId: legalEntity.id, ownerMembershipId: ownerMembership.id, contacts: [{ type: "email", value: "development@pearlhospitality-demo.example", label: "Development", isPrimary: true }], addresses: [{ label: "Head office", locality: "Abu Dhabi", region: "Abu Dhabi", countryCode: "AE", isPrimary: true }] }),
  await ensureOrganization({ type: "organization", displayName: "Mira Retail Holdings", legalName: "Mira Retail Holdings FZ-LLC", industry: "Retail", websiteDomain: "miraretail-demo.example", legalEntityId: legalEntity.id, ownerMembershipId: ownerMembership.id, contacts: [{ type: "email", value: "expansion@miraretail-demo.example", label: "Expansion", isPrimary: true }], addresses: [{ label: "Office", locality: "Ras Al Khaimah", region: "Ras Al Khaimah", countryCode: "AE", isPrimary: true }] }),
];

const relationshipPairs = [
  [organizations[0], partiesByName.get("Khalid Rahman"), "works_for", "Project sponsor"],
  [organizations[1], partiesByName.get("Dr Maya Nair"), "advisor", "Wellness advisor"],
  [organizations[2], partiesByName.get("Leena Mathew"), "partner", "Retail concept partner"],
];
for (const [organization, person, type, label] of relationshipPairs) {
  if (!organization || !person) continue;
  const aggregate = await request(`${crm}/parties/${organization.id}`);
  if (!aggregate.relationships.some((relationship) => relationship.toPartyId === person.id && relationship.type === type)) {
    await request(`${crm}/relationships`, { body: { fromPartyId: organization.id, toPartyId: person.id, type, label, isPrimary: true } });
  }
}

let leads = (await request(`${crm}/leads?limit=100`)).data;
for (const seed of customerSeeds) {
  let lead = leads.find((candidate) => candidate.title === seed.title);
  if (!lead) continue;
  if (!lead.ownerMembershipId && !["qualified", "disqualified"].includes(lead.status)) {
    lead = await request(`${crm}/leads/${lead.id}/auto-assign?version=${lead.version}`, { body: {} });
  }
  if (seed.amount) {
    const opportunities = (await request(`${crm}/opportunities?limit=100`)).data;
    let opportunity = opportunities.find((candidate) => candidate.lead_id === lead.id || candidate.leadId === lead.id || candidate.title === seed.title);
    if (!opportunity && lead.status !== "qualified") {
      const refreshed = await request(`${crm}/leads/${lead.id}`);
      opportunity = await request(`${crm}/leads/${lead.id}/qualify`, {
        body: {
          leadVersion: refreshed.version,
          partyId: refreshed.partyId,
          pipelineId: pipeline.id,
          ownerMembershipId: ownerMembership.id,
          legalEntityId: legalEntity.id,
          businessUnitId: units[seed.unit]?.id,
          title: seed.title,
          description: seed.summary,
          amount: seed.amount,
          currencyCode: "AED",
          expectedCloseAt: daysFromNow(seed.opportunityStatus === "won" ? -14 : 45),
          nextActionAt: daysFromNow(seed.opportunityStatus === "won" ? -21 : 3),
        },
      });
      await request(`${crm}/opportunities/${opportunity.id}/stakeholders`, { body: { partyId: refreshed.partyId, role: "decision_maker", influence: "high", isPrimary: true } });
      await request(`${crm}/opportunities/${opportunity.id}/team/${ownerMembership.id}`, { method: "PUT", body: { role: "account_owner" } });
      await request(`${crm}/custom-fields/${areaField.id}/value`, { body: { entityType: "opportunity", entityId: opportunity.id, value: seed.area } });
      const targetStage = pipelineStages[seed.target];
      if (targetStage && (opportunity.stage_id !== targetStage.id && opportunity.stageId !== targetStage.id || seed.opportunityStatus !== "open")) {
        opportunity = await request(`${crm}/opportunities/${opportunity.id}/transition`, {
          body: { version: opportunity.version, stageId: targetStage.id, status: seed.opportunityStatus, reason: seed.opportunityStatus === "won" ? "Design appointment signed" : seed.opportunityStatus === "lost" ? "Client postponed the project" : "Seeded pipeline progression" },
        });
      }
    }
  } else if (seed.desiredLeadStatus && lead.status !== seed.desiredLeadStatus && !["qualified", "disqualified"].includes(lead.status)) {
    const refreshed = await request(`${crm}/leads/${lead.id}`);
    lead = await request(`${crm}/leads/${lead.id}/status`, {
      body: { version: refreshed.version, status: seed.desiredLeadStatus, reason: seed.pauseReason, nextActionAt: seed.desiredLeadStatus === "paused" ? undefined : daysFromNow(2) },
    });
  }
}

leads = (await request(`${crm}/leads?limit=100`)).data;
for (const seed of customerSeeds) {
  const lead = leads.find((candidate) => candidate.title === seed.title);
  if (!lead) continue;
  const existingActivities = (await request(`${crm}/activities?partyId=${lead.partyId}&limit=100`)).data;
  const activityTitle = seed.amount ? `Follow up: ${seed.title}` : `Review enquiry: ${seed.title}`;
  if (!existingActivities.some((activity) => activity.title === activityTitle)) {
    await request(`${crm}/activities`, { body: { partyId: lead.partyId, leadId: lead.id, type: seed.amount ? "meeting" : "task", title: activityTitle, description: seed.amount ? "Review scope, commercial position, and the next client decision." : "Confirm brief, site status, budget range, and decision timeline.", ownerMembershipId: ownerMembership.id, priority: seed.amount >= 2_000_000 ? "high" : "normal", dueAt: daysFromNow(seed.amount ? 3 : 1), isNextAction: !["qualified", "disqualified"].includes(lead.status) } });
  }
  const existingConversations = (await request(`${crm}/conversations?partyId=${lead.partyId}&limit=100`)).data;
  if (!existingConversations.some((conversation) => conversation.subject === seed.title)) {
    const conversation = await request(`${crm}/conversations`, { body: { partyId: lead.partyId, leadId: lead.id, channel: "internal", subject: seed.title, ownerMembershipId: ownerMembership.id, participantPartyIds: [lead.partyId], participantMembershipIds: [ownerMembership.id] } });
    await request(`${crm}/conversations/${conversation.id}/messages`, { body: { direction: "internal", bodyText: `Seed note: ${seed.summary}`, metadata: { seeded: true } } });
  }
}

const finalParties = await request(`${crm}/parties?limit=100`);
const finalLeads = await request(`${crm}/leads?limit=100`);
const finalOpportunities = await request(`${crm}/opportunities?limit=100`);
const finalActivities = await request(`${crm}/activities?limit=100`);
const finalConversations = await request(`${crm}/conversations?limit=100`);

console.log(JSON.stringify({
  ok: true,
  workspace: { id: workspaceId, slug: workspaceSlug },
  seeded: {
    parties: finalParties.data.length,
    leads: finalLeads.data.length,
    opportunities: finalOpportunities.data.length,
    activities: finalActivities.data.length,
    conversations: finalConversations.data.length,
    organizations: organizations.length,
  },
  pipeline: pipeline.name,
  queue: queue.name,
  repeatable: true,
}, null, 2));
