import assert from "node:assert/strict";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8010/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-test-internal-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const actor = {
  "x-wodana-user-subject": `google-owner-${runId}`,
  "x-wodana-user-email": `google-owner-${runId}@palmlivingae.com`,
  "x-wodana-user-name": "Google Integration Owner",
};

async function request(path, { headers = actor, body, method = body ? "POST" : "GET", expected = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
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

const created = await request("/workspaces", {
  expected: 201,
  body: {
    name: "Google Integration Smoke",
    slug: `google-${runId}`,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "PALM",
      displayName: "Palm Living",
      registeredName: "Palm Living LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
const workspaceId = created.workspace.id;
const legalEntityId = created.legalEntities[0].id;
const connection = await request(`/workspaces/${workspaceId}/integration-connections`, {
  expected: 201,
  body: {
    provider: "google_workspace",
    legalEntityId,
    displayName: "Palm Living Google Workspace",
    externalDomain: "palmlivingae.com",
    configuration: { privacy: "free_busy" },
  },
});
const pending = await request(
  `/workspaces/${workspaceId}/integration-connections/${connection.id}/connect`,
  { expected: 201, body: { version: connection.version } },
);

await request(`/internal/integrations/${connection.id}/google/complete`, {
  headers: { "x-wodana-internal-token": "wrong-token" },
  expected: 401,
  body: {
    workspaceId,
    expectedVersion: pending.version,
    externalAccountId: "operations@palmlivingae.com",
    externalDomain: "palmlivingae.com",
    grantedScopes: ["https://www.googleapis.com/auth/calendar.events.freebusy"],
    secretReference: `redis:google:${workspaceId}:${connection.id}`,
    resources: [],
  },
});

const completed = await request(`/internal/integrations/${connection.id}/google/complete`, {
  headers: { "x-wodana-internal-token": internalToken },
  expected: 201,
  body: {
    workspaceId,
    expectedVersion: pending.version,
    externalAccountId: "operations@palmlivingae.com",
    externalDomain: "palmlivingae.com",
    grantedScopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
    ],
    secretReference: `redis:google:${workspaceId}:${connection.id}`,
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    resources: [
      {
        externalId: "operations@palmlivingae.com",
        displayName: "Operations",
        enabled: true,
        direction: "inbound",
        configuration: {
          primary: true,
          available: true,
          accessRole: "owner",
          timeZone: "Asia/Dubai",
        },
      },
      {
        externalId: "design@palmlivingae.com",
        displayName: "Design team",
        enabled: false,
        direction: "inbound",
        configuration: {
          primary: false,
          available: true,
          accessRole: "writer",
          timeZone: "Asia/Dubai",
        },
      },
      {
        externalId: "shared-view@palmlivingae.com",
        displayName: "Shared view-only calendar",
        enabled: false,
        direction: "inbound",
        configuration: {
          primary: false,
          available: true,
          accessRole: "reader",
          timeZone: "Asia/Dubai",
        },
      },
    ],
  },
});
assert.equal(completed.status, "connected");

const publicConnection = await request(
  `/workspaces/${workspaceId}/integration-connections/${connection.id}`,
);
assert.equal(publicConnection.status, "connected");
assert.equal("secretReference" in publicConnection, false);
assert.equal("connectedBy" in publicConnection, false);

const resources = await request(
  `/workspaces/${workspaceId}/integration-connections/${connection.id}/resources`,
);
assert.equal(resources.length, 3);
const updated = await request(
  `/workspaces/${workspaceId}/integration-connections/${connection.id}/resources`,
  {
    method: "PATCH",
    body: {
      version: publicConnection.version,
      resources: resources.map((resource) => ({
        resourceId: resource.id,
        enabled: resource.configuration.accessRole !== "reader",
        direction: "inbound",
      })),
    },
  },
);
assert.equal(updated.resources.filter((resource) => resource.enabled).length, 2);

const readOnlyCalendar = updated.resources.find(
  (resource) => resource.externalId === "shared-view@palmlivingae.com",
);
await request(
  `/workspaces/${workspaceId}/integration-connections/${connection.id}/resources`,
  {
    method: "PATCH",
    expected: 422,
    body: {
      version: updated.version,
      resources: [{
        resourceId: readOnlyCalendar.id,
        enabled: true,
        direction: "bidirectional",
      }],
    },
  },
);

const runtime = await request(
  `/internal/integrations/${workspaceId}/${connection.id}/runtime`,
  { headers: { "x-wodana-internal-token": internalToken } },
);
assert.equal(runtime.secretReference, `redis:google:${workspaceId}:${connection.id}`);

await request(`/internal/integrations/${connection.id}/activity`, {
  headers: { "x-wodana-internal-token": internalToken },
  expected: 201,
  body: {
    workspaceId,
    action: "calendar.event_created",
    externalId: "google-event-1",
    metadata: { calendarId: "operations@palmlivingae.com" },
  },
});

await request(`/internal/integrations/${connection.id}/activity`, {
  headers: { "x-wodana-internal-token": internalToken },
  expected: 422,
  body: {
    workspaceId,
    action: "calendar.event_created",
    externalId: "google-event-secret-rejection",
    metadata: { nested: { accessToken: "must-not-enter-audit-history" } },
  },
});

const audit = await request(`/workspaces/${workspaceId}/audit-events?limit=100`);
assert.equal(
  audit.items.some((event) => event.action === "calendar.event_created"),
  true,
);

console.log(JSON.stringify({
  ok: true,
  workspaceId,
  connectionId: connection.id,
  discoveredCalendars: updated.resources.length,
  selectedCalendars: updated.resources.filter((resource) => resource.enabled).length,
  safeguards: [
    "internal-service-authentication",
    "public-secret-redaction",
    "optimistic-calendar-selection",
    "read-only-calendar-direction-guard",
    "integration-audit-history",
    "audit-secret-rejection",
  ],
}, null, 2));
