import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import pg from "pg";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const databaseUrl = process.env.MFA_TEST_DATABASE_URL;
assert.ok(databaseUrl, "MFA_TEST_DATABASE_URL is required");

async function request(path, { body, headers = {}, method = body ? "POST" : "GET", expected = 200 } = {}) {
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

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase()) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const step = Math.floor(Date.now() / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function claims(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();

try {
  const initialLogin = await request("/auth/login", {
    expected: 201,
    body: {
      email: "admin@igloarchitects.com",
      password: "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    },
  });
  assert.ok(initialLogin.accessToken);
  assert.equal(claims(initialLogin.accessToken).mfa, false);
  assert.equal(claims(initialLogin.accessToken).mfa_enrollment_required, true);
  const workspaceId = initialLogin.selectedWorkspaceId;
  const initialHeaders = { authorization: `Bearer ${initialLogin.accessToken}` };

  const initialStatus = await request(`/security/mfa/status?workspaceId=${workspaceId}`, {
    headers: initialHeaders,
  });
  assert.equal(initialStatus.enabled, false);
  assert.equal(initialStatus.required, true);
  assert.ok(initialStatus.enrollmentDeadline);

  await database.query(
    `UPDATE auth_refresh_sessions SET mfa_enrollment_deadline = now() - interval '1 minute'
     WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
    [initialLogin.refreshToken],
  );
  await request("/me", { headers: initialHeaders, expected: 403 });
  await request(`/security/mfa/status?workspaceId=${workspaceId}`, { headers: initialHeaders });
  await database.query(
    `UPDATE auth_refresh_sessions SET mfa_enrollment_deadline = now() + interval '7 days'
     WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
    [initialLogin.refreshToken],
  );

  const setup = await request("/security/mfa/totp/setup", {
    headers: initialHeaders,
    body: { refreshToken: initialLogin.refreshToken, workspaceId },
  });
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);

  const confirmationCode = totp(setup.secret);
  const confirmed = await request("/security/mfa/totp/confirm", {
    headers: initialHeaders,
    body: { refreshToken: initialLogin.refreshToken, workspaceId, code: confirmationCode },
  });
  assert.equal(confirmed.enabled, true);
  assert.equal(confirmed.recoveryCodes.length, 10);
  assert.equal(claims(confirmed.accessToken).mfa, true);
  assert.deepEqual(claims(confirmed.accessToken).amr, ["pwd", "totp"]);

  await request(`/security/mfa/status?workspaceId=${workspaceId}`, {
    headers: initialHeaders,
    expected: 401,
  });
  const confirmedHeaders = { authorization: `Bearer ${confirmed.accessToken}` };
  await request("/security/mfa/step-up", {
    headers: confirmedHeaders,
    expected: 401,
    body: { refreshToken: initialLogin.refreshToken, workspaceId, code: confirmationCode },
  });
  const steppedUp = await request("/security/mfa/step-up", {
    headers: confirmedHeaders,
    body: { refreshToken: initialLogin.refreshToken, workspaceId, code: confirmed.recoveryCodes[0] },
  });
  assert.deepEqual(claims(steppedUp.accessToken).amr, ["pwd", "recovery_code"]);
  await request("/security/mfa/step-up", {
    headers: { authorization: `Bearer ${steppedUp.accessToken}` },
    expected: 401,
    body: { refreshToken: initialLogin.refreshToken, workspaceId, code: confirmed.recoveryCodes[0] },
  });

  const enabledStatus = await request(`/security/mfa/status?workspaceId=${workspaceId}`, {
    headers: { authorization: `Bearer ${steppedUp.accessToken}` },
  });
  assert.equal(enabledStatus.enabled, true);
  assert.equal(enabledStatus.recoveryCodesRemaining, 9);

  const challengedLogin = await request("/auth/login", {
    expected: 201,
    body: {
      email: "admin@igloarchitects.com",
      password: "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    },
  });
  assert.equal(challengedLogin.mfaRequired, true);
  assert.ok(challengedLogin.challengeToken);
  assert.equal(challengedLogin.accessToken, undefined);

  const verifiedLogin = await request("/auth/mfa/verify", {
    expected: 201,
    body: {
      challengeToken: challengedLogin.challengeToken,
      code: confirmed.recoveryCodes[1],
    },
  });
  assert.equal(claims(verifiedLogin.accessToken).mfa, true);
  await request("/auth/mfa/verify", {
    expected: 410,
    body: {
      challengeToken: challengedLogin.challengeToken,
      code: confirmed.recoveryCodes[2],
    },
  });

  const refreshed = await request("/auth/refresh", {
    expected: 201,
    body: { refreshToken: verifiedLogin.refreshToken },
  });
  assert.equal(claims(refreshed.accessToken).mfa, true);
  assert.deepEqual(claims(refreshed.accessToken).amr, ["pwd", "recovery_code"]);

  const rotated = await request("/security/mfa/recovery-codes/regenerate", {
    headers: { authorization: `Bearer ${refreshed.accessToken}` },
    body: { refreshToken: refreshed.refreshToken, workspaceId },
  });
  assert.equal(rotated.recoveryCodes.length, 10);
  assert.notDeepEqual(rotated.recoveryCodes, confirmed.recoveryCodes);

  await request("/security/mfa/disable", {
    headers: { authorization: `Bearer ${refreshed.accessToken}` },
    expected: 409,
    body: { refreshToken: refreshed.refreshToken, workspaceId },
  });

  const lockChallenge = await request("/auth/login", {
    expected: 201,
    body: {
      email: "admin@igloarchitects.com",
      password: "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    },
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await request("/auth/mfa/verify", {
      expected: attempt === 5 ? 429 : 401,
      body: { challengeToken: lockChallenge.challengeToken, code: "invalid-factor" },
    });
  }

  const stored = await database.query(
    `SELECT encrypted_totp_secret, encryption_nonce, encryption_auth_tag
     FROM user_mfa_credentials WHERE user_id = (
       SELECT id FROM users WHERE primary_email = 'admin@igloarchitects.com'
     )`,
  );
  assert.equal(stored.rowCount, 1);
  assert.doesNotMatch(JSON.stringify(stored.rows[0]), new RegExp(setup.secret));
  const recoveryHashes = await database.query(
    `SELECT code_hash FROM user_mfa_recovery_codes WHERE user_id = (
       SELECT id FROM users WHERE primary_email = 'admin@igloarchitects.com'
     )`,
  );
  assert.equal(recoveryHashes.rowCount, 10);
  assert.ok(recoveryHashes.rows.every((row) => /^[0-9a-f]{64}$/.test(row.code_hash)));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    safeguards: [
      "admin enrollment policy and grace deadline",
      "expired-grace route restriction with enrollment escape",
      "encrypted TOTP enrollment",
      "TOTP replay rejection",
      "single-use recovery codes",
      "old access-token invalidation",
      "password login MFA challenge",
      "challenge replay rejection",
      "refresh assurance preservation",
      "recent-MFA recovery rotation",
      "required-policy disable denial",
      "bounded factor-attempt lock",
      "no plaintext factors in PostgreSQL",
    ],
  }, null, 2)}\n`);
} finally {
  await database.end();
}
