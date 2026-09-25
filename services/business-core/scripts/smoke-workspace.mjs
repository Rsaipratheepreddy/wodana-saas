import assert from "node:assert/strict";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8010/api/v1";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const actorHeaders = (subject, email, name) => ({
  "x-wodana-user-subject": subject,
  "x-wodana-user-email": email,
  "x-wodana-user-name": name,
});

const owner = actorHeaders(`owner-${runId}`, `owner-${runId}@palmlivingae.com`, "Operations Owner");
const member = actorHeaders(`designer-${runId}`, `designer-${runId}@palmlivingae.com`, "Lead Designer");
const secondOwner = actorHeaders(`owner-two-${runId}`, `owner-two-${runId}@odginteriors.com`, "Second Owner");
const outsider = actorHeaders(`outsider-${runId}`, `outsider-${runId}@example.com`, "Other Owner");

async function request(path, { actor, body, method = body ? "POST" : "GET", expected = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...actor,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function rawRequest(path, { actor, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...actor,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}

const workspacePayload = (name, slug, code, currency = "AED") => ({
  name,
  slug,
  defaultCurrency: currency,
  defaultLocale: currency === "AED" ? "en-AE" : "en-US",
  defaultTimezone: currency === "AED" ? "Asia/Dubai" : "America/New_York",
  unitSystem: currency === "AED" ? "metric" : "imperial",
  weekStartsOn: 1,
  firstLegalEntity: {
    code,
    displayName: name,
    registeredName: `${name} LLC`,
    countryCode: currency === "AED" ? "AE" : "US",
    baseCurrency: currency,
    locale: currency === "AED" ? "en-AE" : "en-US",
    timezone: currency === "AED" ? "Asia/Dubai" : "America/New_York",
  },
});

await request("/workspaces", { expected: 401 });
const created = await request("/workspaces", {
  actor: owner,
  expected: 201,
  body: workspacePayload("Palm Living Test", `palm-${runId}`, "PALM"),
});
const workspaceId = created.workspace.id;
const legalEntityId = created.legalEntities[0].id;
const profile = await request("/me", { actor: owner });
assert.equal(profile.memberships[0].workspaceId, workspaceId);
assert.equal(profile.memberships[0].onboarding.status, "not_started");
assert.equal(profile.nextAction, "start_onboarding");
const onboardingInProgress = await request(`/workspaces/${workspaceId}/onboarding`, {
  actor: owner,
  method: "PATCH",
  body: {
    version: 1,
    currentStep: "organization",
    completedSteps: ["workspace_profile"],
  },
});
assert.equal(onboardingInProgress.status, "in_progress");
await request(`/workspaces/${workspaceId}/onboarding/complete`, {
  actor: owner,
  expected: 422,
  body: { version: 2 },
});
const onboardingReady = await request(`/workspaces/${workspaceId}/onboarding`, {
  actor: owner,
  method: "PATCH",
  body: {
    version: 2,
    currentStep: "team",
    completedSteps: ["workspace_profile", "organization"],
  },
});
const completedOnboarding = await request(`/workspaces/${workspaceId}/onboarding/complete`, {
  actor: owner,
  expected: 201,
  body: { version: onboardingReady.version },
});
assert.equal(completedOnboarding.status, "completed");
const completedProfile = await request("/me", { actor: owner });
assert.equal(completedProfile.nextAction, "enter_workspace");

const defaultTerminology = await request(`/workspaces/${workspaceId}/terminology`, { actor: owner });
const defaultBusinessUnitTerm = defaultTerminology.items.find((item) => item.key === "business_unit");
assert.deepEqual(defaultTerminology.map.lead, { visibleName: "Lead", visibleNamePlural: "Leads" });
assert.deepEqual(defaultBusinessUnitTerm, {
  key: "business_unit",
  defaultVisibleName: "Business unit",
  defaultVisibleNamePlural: "Business units",
  visibleName: "Business unit",
  visibleNamePlural: "Business units",
  overridden: false,
  version: 0,
  updatedAt: null,
});
const departmentTerm = await request(`/workspaces/${workspaceId}/terminology/business_unit`, {
  actor: owner,
  method: "PUT",
  body: { version: 0, visibleName: "Department", visibleNamePlural: "Departments" },
});
assert.equal(departmentTerm.version, 1);
assert.equal(departmentTerm.visibleName, "Department");
const divisionTerm = await request(`/workspaces/${workspaceId}/terminology/business_unit`, {
  actor: owner,
  method: "PUT",
  body: { version: 1, visibleName: "Division", visibleNamePlural: "Divisions" },
});
assert.equal(divisionTerm.version, 2);
await request(`/workspaces/${workspaceId}/terminology/business_unit`, {
  actor: owner,
  method: "PUT",
  expected: 409,
  body: { version: 1, visibleName: "Department", visibleNamePlural: "Departments" },
});
await request(`/workspaces/${workspaceId}/terminology/not_a_term`, {
  actor: owner,
  method: "PUT",
  expected: 400,
  body: { version: 0, visibleName: "Unknown", visibleNamePlural: "Unknowns" },
});

const renamedWorkspace = await request(`/workspaces/${workspaceId}`, {
  actor: owner,
  method: "PATCH",
  body: { version: 1, name: "Palm Living & ODG Test" },
});
assert.equal(renamedWorkspace.version, 2);

const odg = await request(`/workspaces/${workspaceId}/legal-entities`, {
  actor: owner,
  expected: 201,
  body: {
    code: "ODG",
    displayName: "ODG Interiors",
    registeredName: "ODG Interiors LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
  },
});
const updatedOdg = await request(`/workspaces/${workspaceId}/legal-entities/${odg.id}`, {
  actor: owner,
  method: "PATCH",
  body: { version: 1, displayName: "ODG Design Studio" },
});
assert.equal(updatedOdg.version, 2);

const temporaryEntity = await request(`/workspaces/${workspaceId}/legal-entities`, {
  actor: owner,
  expected: 201,
  body: {
    code: "TEMP",
    displayName: "Temporary Entity",
    registeredName: "Temporary Entity LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
  },
});
await request(`/workspaces/${workspaceId}/legal-entities/${temporaryEntity.id}/archive`, {
  actor: owner,
  expected: 201,
  body: { version: 1 },
});

const businessUnit = await request(`/workspaces/${workspaceId}/business-units`, {
  actor: owner,
  expected: 201,
  body: {
    legalEntityId,
    code: "DESIGN",
    name: "Design Studio",
    type: "studio",
    timezone: "Asia/Dubai",
    color: "#dc2626",
  },
});
assert.equal(businessUnit.color, "#DC2626");
assert.equal(businessUnit.visibleName, "Design Studio");
await request(`/workspaces/${workspaceId}/business-units/${businessUnit.id}`, {
  actor: owner,
  method: "PATCH",
  expected: 400,
  body: { version: 1, color: "red" },
});
const updatedBusinessUnit = await request(
  `/workspaces/${workspaceId}/business-units/${businessUnit.id}`,
  {
    actor: owner,
    method: "PATCH",
    body: { version: 1, name: "Interior Design Studio", color: "#7c3aed" },
  },
);
assert.equal(updatedBusinessUnit.version, 2);
assert.equal(updatedBusinessUnit.color, "#7C3AED");
assert.equal(updatedBusinessUnit.visibleName, "Interior Design Studio");
const childBusinessUnit = await request(`/workspaces/${workspaceId}/business-units`, {
  actor: owner,
  expected: 201,
  body: {
    legalEntityId,
    parentBusinessUnitId: businessUnit.id,
    code: "DESIGN-CHILD",
    name: "Residential Design Team",
    type: "team",
    timezone: "Asia/Dubai",
  },
});
await request(`/workspaces/${workspaceId}/business-units/${businessUnit.id}`, {
  actor: owner,
  method: "PATCH",
  expected: 409,
  body: { version: 2, legalEntityId: odg.id },
});
await request(`/workspaces/${workspaceId}/business-units/${childBusinessUnit.id}/archive`, {
  actor: owner,
  expected: 201,
  body: { version: 1 },
});
await request(`/workspaces/${workspaceId}/business-units/${businessUnit.id}/archive`, {
  actor: owner,
  expected: 201,
  body: { version: 2 },
});
await request(`/workspaces/${workspaceId}/business-units`, {
  actor: owner,
  expected: 422,
  body: {
    legalEntityId,
    parentBusinessUnitId: businessUnit.id,
    code: "ORPHAN",
    name: "Invalid archived-parent team",
    type: "team",
    timezone: "Asia/Dubai",
  },
});

const customRole = await request(`/workspaces/${workspaceId}/roles`, {
  actor: owner,
  expected: 201,
  body: {
    code: "lead_designer",
    name: "Lead Designer",
    description: "Interior-design delivery access",
    permissionCodes: ["legal_entities.view", "integrations.view"],
  },
});
const updatedRole = await request(`/workspaces/${workspaceId}/roles/${customRole.id}`, {
  actor: owner,
  method: "PATCH",
  body: {
    version: 1,
    description: "Interior-design delivery and integration visibility",
    permissionCodes: ["legal_entities.view", "integrations.view"],
  },
});
assert.equal(updatedRole.version, 2);

const invitation = await request(`/workspaces/${workspaceId}/invitations`, {
  actor: owner,
  expected: 201,
  body: { email: member["x-wodana-user-email"], roleCodes: ["lead_designer"] },
});
const rolesWithPendingInvite = await request(`/workspaces/${workspaceId}/roles`, { actor: owner });
assert.equal(rolesWithPendingInvite.find((role) => role.id === customRole.id)?.pendingInvitationCount, 1);
await request(`/workspaces/${workspaceId}/roles/${customRole.id}?version=2`, {
  actor: owner,
  method: "DELETE",
  expected: 409,
});
const concurrentInvitation = await request(`/workspaces/${workspaceId}/invitations`, {
  actor: owner,
  expected: 201,
  body: { email: secondOwner["x-wodana-user-email"], roleCodes: ["viewer"] },
});
const pendingInvitation = await request(`/workspaces/${workspaceId}/invitations`, {
  actor: owner,
  expected: 201,
  body: { email: `pending-${runId}@palmlivingae.com`, roleCodes: ["viewer"] },
});
await request(`/workspaces/${workspaceId}/invitations`, {
  actor: owner,
  expected: 409,
  body: { email: `pending-${runId}@palmlivingae.com`, roleCodes: ["viewer"] },
});
const resentInvitation = await request(
  `/workspaces/${workspaceId}/invitations/${pendingInvitation.id}/resend`,
  { actor: owner, method: "POST", expected: 201 },
);
assert.notEqual(resentInvitation.invitationToken, pendingInvitation.invitationToken);
await request(`/workspaces/${workspaceId}/invitations/${pendingInvitation.id}`, {
  actor: owner,
  method: "DELETE",
});
const invitedProfile = await request("/me", { actor: member });
assert.equal(invitedProfile.nextAction, "accept_invitation");
assert.ok(invitedProfile.pendingInvitations.some((candidate) => candidate.id === invitation.id));
await request(`/workspaces/invitations/${invitation.id}/accept`, {
  actor: member,
  expected: 201,
  method: "POST",
});
const rolesWithMember = await request(`/workspaces/${workspaceId}/roles`, { actor: owner });
const assignedDesignerRole = rolesWithMember.find((role) => role.id === customRole.id);
assert.equal(assignedDesignerRole?.memberCount, 1);
assert.equal(assignedDesignerRole?.pendingInvitationCount, 0);
await request(`/workspaces/${workspaceId}/roles/${customRole.id}?version=2`, {
  actor: owner,
  method: "DELETE",
  expected: 409,
});
const concurrentAccepts = await Promise.all([
  rawRequest("/workspaces/invitations/accept", {
    actor: secondOwner,
    body: { token: concurrentInvitation.invitationToken },
  }),
  rawRequest("/workspaces/invitations/accept", {
    actor: secondOwner,
    body: { token: concurrentInvitation.invitationToken },
  }),
]);
assert.deepEqual(concurrentAccepts.map(({ status }) => status).sort(), [201, 409]);

let members = await request(`/workspaces/${workspaceId}/members`, { actor: owner });
const ownerMembership = members.find((candidate) => candidate.roles.includes("owner"));
const designerMembership = members.find((candidate) => candidate.email === member["x-wodana-user-email"]);
await request(`/workspaces/${workspaceId}/members/${ownerMembership.id}`, {
  actor: owner,
  method: "PATCH",
  expected: 409,
  body: { version: ownerMembership.version, status: "suspended" },
});
const updatedMember = await request(`/workspaces/${workspaceId}/members/${designerMembership.id}`, {
  actor: owner,
  method: "PATCH",
  body: { version: designerMembership.version, roleCodes: ["viewer"] },
});
assert.deepEqual(updatedMember.roles, ["viewer"]);
members = await request(`/workspaces/${workspaceId}/members`, { actor: owner });
const secondOwnerMembership = members.find(
  (candidate) => candidate.email === secondOwner["x-wodana-user-email"],
);
const promotedOwner = await request(
  `/workspaces/${workspaceId}/members/${secondOwnerMembership.id}`,
  {
    actor: owner,
    method: "PATCH",
    body: { version: secondOwnerMembership.version, roleCodes: ["owner"] },
  },
);
assert.deepEqual(promotedOwner.roles, ["owner"]);
const ownerRemovalAttempts = await Promise.all([
  rawRequest(`/workspaces/${workspaceId}/members/${ownerMembership.id}`, {
    actor: owner,
    method: "PATCH",
    body: { version: ownerMembership.version, status: "suspended" },
  }),
  rawRequest(`/workspaces/${workspaceId}/members/${secondOwnerMembership.id}`, {
    actor: secondOwner,
    method: "PATCH",
    body: { version: promotedOwner.version, status: "suspended" },
  }),
]);
assert.deepEqual(ownerRemovalAttempts.map(({ status }) => status).sort(), [200, 409]);
const suspendedOwnerIndex = ownerRemovalAttempts.findIndex(({ status }) => status === 200);
const suspendedOwnerActor = suspendedOwnerIndex === 0 ? owner : secondOwner;
const activeOwnerActor = suspendedOwnerIndex === 0 ? secondOwner : owner;
const suspendedOwnerMembership = ownerRemovalAttempts[suspendedOwnerIndex].payload;
await request(`/workspaces/${workspaceId}`, { actor: suspendedOwnerActor, expected: 404 });
await request(`/workspaces/${workspaceId}/members/${suspendedOwnerMembership.id}`, {
  actor: activeOwnerActor,
  method: "PATCH",
  body: { version: suspendedOwnerMembership.version, status: "active" },
});
await request(`/workspaces/${workspaceId}/roles/${customRole.id}?version=2`, {
  actor: owner,
  method: "DELETE",
});

const createdConnections = [];
for (const connection of [
  [legalEntityId, "Palm Living Google Workspace", "palmlivingae.com"],
  [odg.id, "ODG Google Workspace", "odginteriors.com"],
]) {
  createdConnections.push(await request(`/workspaces/${workspaceId}/integration-connections`, {
    actor: owner,
    expected: 201,
    body: {
      provider: "google_workspace",
      legalEntityId: connection[0],
      displayName: connection[1],
      externalDomain: connection[2],
      configuration: { calendarDiscovery: true, driveDiscovery: true },
    },
  }));
}
await request(`/workspaces/${workspaceId}/integration-connections`, {
  actor: owner,
  expected: 409,
  body: {
    provider: "google_workspace",
    legalEntityId,
    displayName: "Duplicate Palm Workspace",
    externalDomain: "palmlivingae.com",
  },
});
await request(`/workspaces/${workspaceId}/integration-connections`, {
  actor: owner,
  expected: 422,
  body: {
    provider: "google_workspace",
    legalEntityId,
    displayName: "Unsafe Connection",
    externalDomain: "safe.example.com",
    configuration: { accessToken: "must-not-be-stored-here" },
  },
});

const revisedConnection = await request(
  `/workspaces/${workspaceId}/integration-connections/${createdConnections[0].id}`,
  {
    actor: owner,
    method: "PATCH",
    body: { version: 1, displayName: "Palm Living Workspace" },
  },
);
const pendingConnection = await request(
  `/workspaces/${workspaceId}/integration-connections/${revisedConnection.id}/connect`,
  { actor: owner, expected: 201, body: { version: 2 } },
);
const revokedConnection = await request(
  `/workspaces/${workspaceId}/integration-connections/${revisedConnection.id}?version=3`,
  { actor: owner, method: "DELETE" },
);
assert.equal(revokedConnection.status, "revoked");
const replacementConnection = await request(
  `/workspaces/${workspaceId}/integration-connections`,
  {
    actor: owner,
    expected: 201,
    body: {
      provider: "google_workspace",
      legalEntityId,
      displayName: "Replacement Palm Workspace",
      externalDomain: "palmlivingae.com",
      configuration: { calendarDiscovery: true },
    },
  },
);
await request(`/workspaces/${workspaceId}/integration-connections/${revisedConnection.id}/connect`, {
  actor: owner,
  expected: 409,
  body: { version: 4 },
});
await request(
  `/workspaces/${workspaceId}/integration-connections/${replacementConnection.id}?version=1`,
  { actor: owner, method: "DELETE" },
);
await request(`/workspaces/${workspaceId}/integration-connections/${revisedConnection.id}/connect`, {
  actor: owner,
  expected: 201,
  body: { version: 4 },
});
assert.equal(pendingConnection.status, "pending");

await request(`/workspaces/${workspaceId}/legal-entities/${odg.id}/archive`, {
  actor: owner,
  expected: 409,
  body: { version: 2 },
});
const revokedOdgConnection = await request(
  `/workspaces/${workspaceId}/integration-connections/${createdConnections[1].id}?version=1`,
  { actor: owner, method: "DELETE" },
);
await request(`/workspaces/${workspaceId}/legal-entities/${odg.id}/archive`, {
  actor: owner,
  expected: 201,
  body: { version: 2 },
});
await request(`/workspaces/${workspaceId}/integration-connections/${createdConnections[1].id}/connect`, {
  actor: owner,
  expected: 404,
  body: { version: revokedOdgConnection.version },
});

const updated = await request(`/workspaces/${workspaceId}/settings`, {
  actor: owner,
  method: "PATCH",
  body: { version: 2, weekStartsOn: 0 },
});
assert.equal(updated.version, 3);
await request(`/workspaces/${workspaceId}/settings`, {
  actor: owner,
  method: "PATCH",
  expected: 409,
  body: { version: 2, weekStartsOn: 1 },
});

await request(`/workspaces/${workspaceId}/legal-entities`, {
  actor: member,
  expected: 403,
  body: {
    code: "DENIED",
    displayName: "Denied Entity",
    registeredName: "Denied Entity LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
  },
});

const other = await request("/workspaces", {
  actor: outsider,
  expected: 201,
  body: workspacePayload("Other Tenant", `other-${runId}`, "OTHER", "USD"),
});
const otherTerminology = await request(`/workspaces/${other.workspace.id}/terminology`, { actor: outsider });
assert.deepEqual(otherTerminology.map.business_unit, {
  visibleName: "Business unit",
  visibleNamePlural: "Business units",
});
const primaryTerminology = await request(`/workspaces/${workspaceId}/terminology`, { actor: owner });
assert.deepEqual(primaryTerminology.map.business_unit, { visibleName: "Division", visibleNamePlural: "Divisions" });
await request(`/workspaces/${workspaceId}/terminology/business_unit`, {
  actor: member,
  method: "PUT",
  expected: 403,
  body: { version: 2, visibleName: "Unauthorized", visibleNamePlural: "Unauthorized" },
});
const restoredTerminology = await request(`/workspaces/${workspaceId}/terminology/business_unit?version=2`, {
  actor: owner,
  method: "DELETE",
});
assert.deepEqual(restoredTerminology, defaultBusinessUnitTerm);
const otherSecondEntity = await request(`/workspaces/${other.workspace.id}/legal-entities`, {
  actor: outsider,
  expected: 201,
  body: {
    code: "OTHER2",
    displayName: "Other Tenant Two",
    registeredName: "Other Tenant Two LLC",
    countryCode: "US",
    baseCurrency: "USD",
    locale: "en-US",
    timezone: "America/New_York",
  },
});
const concurrentEntityArchives = await Promise.all([
  rawRequest(
    `/workspaces/${other.workspace.id}/legal-entities/${other.legalEntities[0].id}/archive`,
    { actor: outsider, body: { version: 1 } },
  ),
  rawRequest(
    `/workspaces/${other.workspace.id}/legal-entities/${otherSecondEntity.id}/archive`,
    { actor: outsider, body: { version: 1 } },
  ),
]);
assert.deepEqual(concurrentEntityArchives.map(({ status }) => status).sort(), [201, 409]);
const otherAfterArchiveRace = await request(`/workspaces/${other.workspace.id}`, {
  actor: outsider,
});
assert.equal(otherAfterArchiveRace.legalEntities.length, 1);
await request(`/workspaces/${workspaceId}`, { actor: outsider, expected: 404 });
await request(`/workspaces/${workspaceId}/business-units`, {
  actor: owner,
  expected: 404,
  body: {
    legalEntityId: other.legalEntities[0].id,
    code: "BADREF",
    name: "Cross-tenant reference",
    type: "studio",
    timezone: "Asia/Dubai",
  },
});

const memberWorkspaces = await request("/workspaces", { actor: member });
members = await request(`/workspaces/${workspaceId}/members`, { actor: owner });
const invitations = await request(`/workspaces/${workspaceId}/invitations`, { actor: owner });
const connections = await request(`/workspaces/${workspaceId}/integration-connections`, { actor: owner });
const audits = await request(`/workspaces/${workspaceId}/audit-events?limit=100`, { actor: owner });
const firstAuditPage = await request(`/workspaces/${workspaceId}/audit-events?limit=5`, { actor: owner });
assert.equal(firstAuditPage.items.length, 5);
assert.ok(firstAuditPage.nextCursor);
const secondAuditPage = await request(
  `/workspaces/${workspaceId}/audit-events?limit=5&cursor=${encodeURIComponent(firstAuditPage.nextCursor)}`,
  { actor: owner },
);
assert.equal(secondAuditPage.items.length, 5);
assert.equal(
  firstAuditPage.items.some((first) => secondAuditPage.items.some((second) => second.id === first.id)),
  false,
);
await request(`/workspaces/${workspaceId}/audit-events?cursor=invalid`, {
  actor: owner,
  expected: 400,
});
assert.equal(memberWorkspaces.length, 1);
assert.equal(members.length, 3);
assert.ok(invitations.some((candidate) => candidate.status === "cancelled"));
assert.equal(connections.length, 3);
assert.ok(audits.items.length >= 8);

process.stdout.write(`${JSON.stringify({
  ok: true,
  workspaceId,
  memberCount: members.length,
  googleDomains: connections.map((connection) => connection.externalDomain).sort(),
  auditEventCount: audits.items.length,
  safeguards: [
    "authentication",
    "rbac",
    "last-owner-protection",
    "concurrent-invitation-acceptance",
    "ownership-transfer",
    "concurrent-last-owner-protection",
    "concurrent-last-legal-entity-protection",
    "optimistic-locking",
    "tenant-isolation",
    "cross-reference-guard",
    "archive-dependency-guard",
    "hierarchy-entity-guard",
    "archived-parent-guard",
    "integration-reconnect-collision",
    "archived-entity-reconnect-guard",
    "terminology-default-fallback",
    "terminology-optimistic-locking",
    "terminology-tenant-isolation",
    "terminology-restore-default",
  ],
}, null, 2)}\n`);
