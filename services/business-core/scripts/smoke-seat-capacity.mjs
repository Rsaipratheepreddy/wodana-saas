import assert from "node:assert/strict";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const owner = {
  "x-wodana-user-subject": `seat-owner-${runId}`,
  "x-wodana-user-email": `seat-owner-${runId}@example.com`,
  "x-wodana-user-name": "Seat Test Owner",
};

async function rawRequest(path, { actor = owner, body, method = body ? "POST" : "GET" } = {}) {
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

async function request(path, options = {}) {
  const expected = options.expected ?? 200;
  const result = await rawRequest(path, options);
  assert.equal(
    result.status,
    expected,
    `${options.method ?? (options.body ? "POST" : "GET")} ${path}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  return result.payload;
}

const workspace = await request("/workspaces", {
  expected: 201,
  body: {
    name: "Seat Capacity Test",
    slug: `seat-capacity-${runId}`,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: `S${runId.replaceAll("-", "").slice(-7)}`,
      displayName: "Seat Capacity Test",
      registeredName: "Seat Capacity Test LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
const workspaceId = workspace.workspace.id;

const candidates = Array.from({ length: 5 }, (_, index) => ({
  actor: {
    "x-wodana-user-subject": `seat-member-${index}-${runId}`,
    "x-wodana-user-email": `seat-member-${index}-${runId}@example.com`,
    "x-wodana-user-name": `Seat Member ${index + 1}`,
  },
  email: `seat-member-${index}-${runId}@example.com`,
}));
const invitationAttempts = await Promise.all(candidates.map((candidate) =>
  rawRequest(`/workspaces/${workspaceId}/invitations`, {
    body: { email: candidate.email, roleCodes: ["member"] },
  }),
));
const acceptedInvitations = invitationAttempts.filter(({ status }) => status === 201);
const rejectedInvitation = invitationAttempts.find(({ status }) => status === 409);
assert.equal(acceptedInvitations.length, 4, JSON.stringify(invitationAttempts));
assert.equal(rejectedInvitation?.payload?.message, "Workspace seat limit reached");

const accepted = acceptedInvitations[0].payload;
const acceptedCandidate = candidates.find(({ email }) => email === accepted.email);
assert.ok(acceptedCandidate);
await request(`/workspaces/invitations/${accepted.id}/accept`, {
  actor: acceptedCandidate.actor,
  expected: 201,
  method: "POST",
});

const members = await request(`/workspaces/${workspaceId}/members`);
const activated = members.find((member) => member.email === acceptedCandidate.email);
assert.ok(activated);
await request(`/workspaces/${workspaceId}/members/${activated.id}`, {
  body: { version: activated.version, status: "suspended" },
  method: "PATCH",
});

const rejectedIndex = invitationAttempts.findIndex(({ status }) => status === 409);
const replacement = await request(`/workspaces/${workspaceId}/invitations`, {
  body: { email: candidates[rejectedIndex].email, roleCodes: ["member"] },
  expected: 201,
});
assert.equal(replacement.email, candidates[rejectedIndex].email);

await request(`/workspaces/${workspaceId}/members/${activated.id}`, {
  body: { version: activated.version + 1, status: "active" },
  expected: 409,
  method: "PATCH",
});

await request(
  `/workspaces/${workspaceId}/invitations/${acceptedInvitations[1].payload.id}`,
  { method: "DELETE" },
);
await request(`/workspaces/${workspaceId}/members/${activated.id}`, {
  body: { version: activated.version + 1, status: "active" },
  method: "PATCH",
});

const billing = await request(`/workspaces/${workspaceId}/billing`);
assert.deepEqual(
  {
    members: billing.usage.members,
    pendingInvitations: billing.usage.pendingInvitations,
    reservedSeats: billing.usage.reservedSeats,
    seatLimit: billing.subscription.seatLimit,
  },
  { members: 2, pendingInvitations: 3, reservedSeats: 5, seatLimit: 5 },
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  workspaceId,
  safeguards: [
    "concurrent-seat-reservation",
    "acceptance-keeps-reservation",
    "suspension-releases-seat",
    "reactivation-enforces-capacity",
    "cancellation-releases-seat",
    "billing-reports-reserved-seats",
  ],
}, null, 2)}\n`);
