import assert from 'node:assert/strict';
import { AuthClient } from '../src/auth/client.ts';

const baseUrl = process.env.EXPO_PUBLIC_AUTH_API_URL;
const email = process.env.MOBILE_AUTH_SMOKE_EMAIL;
const password = process.env.MOBILE_AUTH_SMOKE_PASSWORD;
if (!baseUrl || !email || !password) throw new Error('Set the API URL and a dedicated test account in MOBILE_AUTH_SMOKE_EMAIL / MOBILE_AUTH_SMOKE_PASSWORD.');
let saved = null;
const storage = { read: async () => saved, write: async (value) => { saved = value; }, clear: async () => { saved = null; } };
const create = () => new AuthClient({ baseUrl, tenantSlug: process.env.EXPO_PUBLIC_AUTH_TENANT_SLUG ?? 'iglo-architects', storage });
const first = create();
let current = first;
try {
  await first.restore();
  assert.equal(first.getSnapshot().status, 'signedOut');
  await assert.rejects(first.signIn(`mobile-nonexistent-${Date.now()}@example.invalid`, 'invalid'), /incorrect/);
  await first.signIn(email, password);
  assert.equal(first.getSnapshot().status, 'signedIn');
  const previousToken = JSON.parse(saved).refreshToken;
  const resumed = create();
  current = resumed;
  await resumed.restore();
  assert.equal(resumed.getSnapshot().status, 'signedIn');
  const rotatedToken = JSON.parse(saved).refreshToken;
  assert.notEqual(previousToken, rotatedToken);
  assert.equal((await resumed.get('/me')).primaryEmail, email);
  await resumed.signOut();
  assert.equal(saved, null);
  const revoked = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rotatedToken }),
  });
  assert.equal(revoked.status, 401);
  await create().restore();
  console.log('PASS: rejected invalid credentials, signed in, verified profile, restored and rotated session, signed out, confirmed server revocation.');
} finally { await current.signOut(); }
