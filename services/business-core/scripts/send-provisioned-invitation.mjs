import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Operator-only delivery of the one-time owner invitation returned by tenant
// provisioning. The token is read from a root-only file and never logged.
const [responsePath, origin, expectedEmail] = process.argv.slice(2);
assert.ok(responsePath && origin && expectedEmail, "Provision response, origin, and recipient are required");
const publicOrigin = new URL(origin);
assert.equal(publicOrigin.protocol, "https:");
assert.equal(publicOrigin.hostname, "plm.wodana.ai");

const provision = JSON.parse(await readFile(responsePath, "utf8"));
const invitation = provision.ownerInvitation;
assert.equal(provision.workspace?.slug, "plm");
assert.equal(invitation?.email?.toLowerCase(), expectedEmail.toLowerCase());
assert.equal(invitation?.status, "pending");
assert.ok(invitation.invitationToken, "The original invitation token is unavailable");
assert.ok(new Date(invitation.expiresAt).getTime() > Date.now(), "Invitation has expired");

const apiKey = process.env.MAILGUN_API_KEY;
const domain = process.env.MAILGUN_DOMAIN;
assert.ok(apiKey && domain, "Mailgun is not configured");
const baseUrl = (process.env.MAILGUN_BASE_URL || "https://api.mailgun.net").replace(/\/+$/, "");
assert.equal(new URL(baseUrl).protocol, "https:");
const from = process.env.MAILGUN_FROM || `Wodana <postmaster@${domain}>`;
const activation = new URL("/login", publicOrigin);
activation.searchParams.set("invitation", invitation.invitationToken);
const expires = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(invitation.expiresAt));

const form = new FormData();
form.set("from", from);
form.set("to", invitation.email);
form.set("subject", "Your Palm Living workspace is ready");
form.set("text", `Hello Palm Living team,\n\nYour Wodana workspace is ready for UAT. Activate your access here:\n${activation}\n\nThe secure invitation expires on ${expires} (UTC). CRM is available now; project and pre-execution areas are being released in stages.\n\nWodana team`);
form.set("html", `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#1d1d1b;background:#f7f7f5;padding:32px"><main style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:12px"><h1 style="font-size:24px">Your Palm Living workspace is ready</h1><p>Activate your access to begin UAT of the CRM.</p><p><a href="${activation.toString().replaceAll("&", "&amp;")}" style="display:inline-block;background:#1d1d1b;color:white;padding:12px 20px;border-radius:6px;text-decoration:none">Activate workspace</a></p><p style="font-size:13px;color:#666">This secure invitation expires on ${expires} (UTC). Project and pre-execution areas will be released in stages.</p></main></body></html>`);

const response = await fetch(`${baseUrl}/v3/${encodeURIComponent(domain)}/messages`, {
  method: "POST",
  headers: { authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}` },
  body: form,
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Mailgun rejected the invitation (HTTP ${response.status})`);
process.stdout.write(JSON.stringify({ status: "accepted", recipient: invitation.email, messageId: result.id ?? null }) + "\n");
