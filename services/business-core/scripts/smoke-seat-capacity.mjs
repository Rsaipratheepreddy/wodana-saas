import assert from "node:assert/strict";
import pg from "pg";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const databaseUrl = process.env.PLATFORM_TEST_DATABASE_URL;
assert.ok(databaseUrl, "PLATFORM_TEST_DATABASE_URL is required");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname), "Use a local test database only");
const database = new pg.Client({ connectionString: databaseUrl });
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
    seatLimit: billing.usage.seatLimit,
  },
  { members: 2, pendingInvitations: 3, reservedSeats: 5, seatLimit: 5 },
);

const expiringInvitationId = acceptedInvitations[2].payload.id;
await database.connect();
try {
  await database.query(`UPDATE workspace_invitations SET expires_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2`, [workspaceId, expiringInvitationId]);
  const expiredReplacement = await request(`/workspaces/${workspaceId}/invitations`, {
    body: { email: `seat-expiry-replacement-${runId}@example.com`, roleCodes: ["member"] },
    expected: 201,
  });
  assert.equal(expiredReplacement.email, `seat-expiry-replacement-${runId}@example.com`);
  const invitations = await request(`/workspaces/${workspaceId}/invitations`);
  assert.equal(invitations.find((invitation) => invitation.id === expiringInvitationId)?.status, "expired");
  const billingAfterExpiry = await request(`/workspaces/${workspaceId}/billing`);
  assert.deepEqual(
    {
      members: billingAfterExpiry.usage.members,
      pendingInvitations: billingAfterExpiry.usage.pendingInvitations,
      reservedSeats: billingAfterExpiry.usage.reservedSeats,
      seatLimit: billingAfterExpiry.usage.seatLimit,
    },
    { members: 2, pendingInvitations: 3, reservedSeats: 5, seatLimit: 5 },
  );

  // Accepting an invitation tells the person who sent it, from the workspace's default template.
  const joined = await database.query(
    `SELECT subject FROM notifications WHERE workspace_id=$1 AND event_type='workspace.member_joined' AND channel='in_app'`,
    [workspaceId],
  );
  assert.equal(joined.rowCount, 1, "The inviter is notified exactly once");
  assert.match(joined.rows[0].subject, /joined Seat Capacity Test/);

  // The workspace is full (5 of 5). Edge cases around re-inviting and changing seats.
  const reserved = async () => (await request(`/workspaces/${workspaceId}/billing`)).usage.reservedSeats;
  const pending = (await request(`/workspaces/${workspaceId}/invitations`)).filter((invitation) => invitation.status === "pending");
  const full = await rawRequest(`/workspaces/${workspaceId}/invitations`, { body: { email: `seat-over-${runId}@example.com`, roleCodes: ["member"] } });
  assert.equal(full.status, 409);
  assert.equal(full.payload?.message, "Workspace seat limit reached");

  const duplicate = await rawRequest(`/workspaces/${workspaceId}/invitations`, { body: { email: pending[0].email.toUpperCase(), roleCodes: ["member"] } });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.payload));
  const existingMember = await rawRequest(`/workspaces/${workspaceId}/invitations`, { body: { email: acceptedCandidate.email, roleCodes: ["member"] } });
  assert.equal(existingMember.status, 409, JSON.stringify(existingMember.payload));
  assert.equal(existingMember.payload?.message, "This person is already a workspace member");

  await request(`/workspaces/${workspaceId}/invitations/${pending[0].id}/resend`, { body: {}, expected: 201 });
  assert.equal(await reserved(), 5, "Resending keeps the same single seat");

  // An invitation past its expiry frees its seat; someone else takes it; reviving the old one needs a free seat.
  await database.query(`UPDATE workspace_invitations SET expires_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2`, [workspaceId, pending[1].id]);
  await request(`/workspaces/${workspaceId}/invitations`, { body: { email: `seat-takes-freed-${runId}@example.com`, roleCodes: ["member"] }, expected: 201 });
  const revived = await rawRequest(`/workspaces/${workspaceId}/invitations/${pending[1].id}/resend`, { body: {} });
  assert.notEqual(revived.status, 201, "An expired invitation cannot be revived into a full workspace");
  assert.equal(await reserved(), 5);

  // Lowering the limit below usage keeps everyone but blocks new invitations until seats are freed.
  await database.query(`UPDATE workspace_subscriptions SET seat_limit=3 WHERE workspace_id=$1`, [workspaceId]);
  const overLimit = await rawRequest(`/workspaces/${workspaceId}/invitations`, { body: { email: `seat-after-downgrade-${runId}@example.com`, roleCodes: ["member"] } });
  assert.equal(overLimit.status, 409);
  assert.equal((await request(`/workspaces/${workspaceId}/members`)).filter((member) => member.status === "active").length, 2);
  await database.query(`UPDATE workspace_subscriptions SET seat_limit=5 WHERE workspace_id=$1`, [workspaceId]);
} finally {
  await database.end();
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  workspaceId,
  safeguards: [
    "concurrent-seat-reservation",
    "acceptance-keeps-reservation",
    "suspension-releases-seat",
    "reactivation-enforces-capacity",
    "cancellation-releases-seat",
    "expiry-releases-seat",
    "billing-reports-reserved-seats",
    "full-workspace-rejects-invitation",
    "duplicate-invitation-any-case-rejected",
    "existing-member-not-reinvited",
    "resend-keeps-one-seat",
    "expired-invitation-revival-needs-free-seat",
    "lowered-limit-blocks-new-invitations",
    "inviter-notified-on-join",
  ],
}, null, 2)}\n`);
