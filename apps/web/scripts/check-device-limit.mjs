import assert from 'node:assert/strict';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';

const base = process.env.DEVICE_TEST_WEB_URL ?? 'http://localhost:8130';
const dbUrl = process.env.DEVICE_TEST_DATABASE_URL;
if (!dbUrl || !['localhost', '127.0.0.1'].includes(new URL(dbUrl).hostname) || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Provide local DEVICE_TEST_DATABASE_URL and DEVICE_TEST_WEB_URL only.');
}
const db = new Pool({ connectionString: dbUrl });
const userId = randomUUID(), email = `device-check-${userId}@example.com`, password = `Check#${randomBytes(18).toString('hex')}`;
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
let browser, workspaceId;
try {
  workspaceId = (await db.query("SELECT workspace_id FROM tenant_login_branding WHERE login_slug='iglo-architects'")).rows[0]?.workspace_id;
  assert.ok(workspaceId, 'Local demo workspace is required');
  await db.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Device flow verification')", [userId, email]);
  await db.query('INSERT INTO local_auth_credentials(user_id,password_hash,password_salt) VALUES($1,$2,$3)', [userId, hash, salt]);
  await db.query("INSERT INTO user_identities(user_id,provider,provider_subject,email_at_provider) VALUES($1,'local',$2,$3)", [userId, `local:${userId}`, email]);
  const memberId = (await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,status) VALUES($1,$2,'active') RETURNING id", [workspaceId, userId])).rows[0].id;
  await db.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) SELECT $1,$2,id FROM roles WHERE workspace_id=$1 AND code='owner'", [workspaceId, memberId]);
  browser = await chromium.launch({ headless: true });
  const agents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
  ];
  const contexts = await Promise.all(agents.map(userAgent => browser.newContext({ userAgent, reducedMotion: "reduce", viewport: { width: 1365, height: 980 } })));
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  for (let i=0; i<pages.length; i++) {
    const page = pages[i];
    await page.goto(`${base}/login?next=/workspace/settings/security`);
    await page.getByRole('textbox', { name: 'Work email', exact: true }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    console.log(`Submitted browser ${i + 1}`);
    if (i < 2) await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible({ timeout: 45000 });
  }
  await expect(pages[2].getByRole('dialog', { name: 'Device limit reached' })).toBeVisible({ timeout: 15000 });
  assert.equal((await contexts[2].cookies()).some(c => c.name === 'wodana_access'), false, 'Third browser must not receive an access token');
  assert.equal(await pages[2].getByRole('button', { name: 'Log out device', exact: true }).count(), 2);
  await fs.mkdir('.artifacts/device-limit', { recursive: true });
  await pages[2].screenshot({ path: '.artifacts/device-limit/third-device.png', fullPage: true });
  await pages[2].setViewportSize({ width: 390, height: 844 });
  await pages[2].screenshot({ path: '.artifacts/device-limit/third-device-mobile.png', fullPage: true });
  assert.equal(await pages[2].evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await pages[2].setViewportSize({ width: 1365, height: 980 });
  // Free the first device and prove that an open tab exits without user navigation.
  await pages[2].getByRole('listitem').filter({ hasText: 'Google Chrome on Mac' }).getByRole('button', { name: 'Log out device' }).click();
  await expect(pages[2].getByRole('heading', { name: 'Account', exact: true })).toBeVisible({ timeout: 45000 });
  await expect(pages[0]).toHaveURL(/\/login/, { timeout: 20000 });
  assert.equal((await contexts[0].cookies()).some(c => c.name === 'wodana_access'), false);
  const nav = pages[2].getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Audit history', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Security', exact: true })).toHaveCount(0);
  const settingsTabs=pages[2].getByRole('navigation', { name: 'Account sections' });
  await expect(settingsTabs.getByRole('link')).toHaveCount(2);
  await expect(settingsTabs.getByRole('link', { name: 'Active Sessions' })).toHaveAttribute('aria-current', 'page');
  await expect(pages[2].getByRole('table', { name: 'Active sessions', exact: true }).getByRole('row')).toHaveCount(3);
  await pages[2].screenshot({ path: '.artifacts/device-limit/user-settings-security.png', fullPage: true });
  await pages[2].getByRole('button', { name: 'Sign out Microsoft Edge on Windows computer' }).click();
  await pages[2].getByRole('dialog').getByRole('button', { name: 'Sign out session', exact: true }).click();
  await expect(pages[1]).toHaveURL(/\/login/, { timeout: 20000 });
  await pages[2].getByRole('navigation', { name: 'Account sections' }).getByRole('link', { name: 'Audit history' }).click();
  await expect(pages[2].getByRole('table', { name: 'Workspace audit log' })).toBeVisible({ timeout: 15000 });
  await pages[2].screenshot({ path: '.artifacts/device-limit/user-settings-audit.png', fullPage: true, animations: 'disabled' });
  await pages[2].setViewportSize({ width: 390, height: 844 });
  await pages[2].screenshot({ path: '.artifacts/device-limit/user-settings-audit-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await pages[2].evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Audit settings should not overflow the mobile viewport');
  await pages[2].setViewportSize({ width: 1365, height: 980 });
  await pages[2].goto(`${base}/workspace/audit-log`);
  await expect(pages[2]).toHaveURL(/\/workspace\/settings\/audit-logs/);
  await pages[2].goto(`${base}/workspace/security`);
  await expect(pages[2]).toHaveURL(/\/workspace\/settings\/security/);
  await pages[2].setViewportSize({ width: 390, height: 844 });
  await pages[2].screenshot({ path: '.artifacts/device-limit/user-settings-mobile.png', fullPage: true });
  assert.equal(await pages[2].evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Settings should not overflow the mobile viewport');
  const finalCount = Number((await db.query('SELECT count(DISTINCT family_id) AS count FROM auth_refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()', [userId])).rows[0].count);
  assert.equal(finalCount, 1);
  console.log('PASS: three browsers, blocked admission, device replacement, automatic logout, settings logout, audit navigation, legacy redirects, and mobile layout.');
} finally {
  await browser?.close();
  await db.query('UPDATE auth_refresh_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [userId]);
  if (workspaceId) {
    await db.query('DELETE FROM member_roles WHERE membership_id IN (SELECT id FROM workspace_memberships WHERE user_id=$1)', [userId]);
    await db.query('DELETE FROM workspace_memberships WHERE user_id=$1', [userId]);
  }
  // Keep the inactive actor so the audit trail retains its attribution.
  await db.query("UPDATE users SET status='suspended' WHERE id=$1", [userId]);
  await db.query('DELETE FROM local_auth_credentials WHERE user_id=$1', [userId]);
  await db.end();
}
