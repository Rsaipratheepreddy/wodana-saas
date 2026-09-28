import { BadRequestException, ForbiddenException, HttpException, Logger, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export const CODE_SECONDS = 300;
export const MAX_ATTEMPTS = 5;
/** How long before another code can be sent to the same number (plan §6.2). */
export const RESEND_SECONDS = 30;
/** A session ends after 30 days without use, and never lasts longer than 90 days. */
export const SESSION_IDLE_DAYS = 30;
export const SESSION_MAX_DAYS = 90;
const PER_NUMBER = 6;
const PER_REQUESTER = 20;
const PER_WORKSPACE = 300;

export type Channel = "whatsapp" | "email";
/** `demo`: the contact signs in with a fixed demonstration code set by a workspace admin; nothing is sent to them. */
export type Grant = { id: string; caseId: string; name: string; role: "approver" | "viewer"; email: string | null; confirmed: boolean; demo: boolean };
export type PortalContact = { sessionId: string; phone: string; name: string; nameConfirmed: boolean; grants: Grant[] };

export type Delivery = {
  whatsapp(input: { workspaceId: string; challengeId: string; phone: string; code: string }): Promise<void>;
  email(input: { workspaceId: string; to: string; code: string; purpose: "sign_in" | "decision" }): Promise<boolean>;
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const logger = new Logger("ClientPortalAuth");

/** A mobile number in international form: + country code and number, spaces and dashes dropped. */
export function mobileNumber(value: unknown) {
  const raw = typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) throw new BadRequestException("Enter your mobile number with its country code.");
  return raw;
}

/** Codes are stored only as an HMAC bound to their challenge; a contact's demonstration code is bound to their grant. */
export class PortalCodes {
  constructor(private readonly secret: string, readonly demo: boolean) {}
  hash(challengeId: string, code: string) { return createHmac("sha256", this.secret).update(`${challengeId}:${code}`).digest("hex"); }
  demoHash(grantId: string, code: string) { return createHmac("sha256", this.secret).update(`demo:${grantId}:${code}`).digest("hex"); }
  next() { return this.demo ? "123456" : String(randomInt(0, 1_000_000)).padStart(6, "0"); }
  requester(address: string | undefined) { return address ? createHmac("sha256", this.secret).update(`requester:${address}`).digest("hex") : null; }
}

/** The portal's code secret from configuration: stable in production, the local auth secret otherwise. */
export function portalCodes(config: { get<T = string>(key: string): T | undefined }) {
  const production = config.get("NODE_ENV") === "production";
  const secret = config.get<string>("PORTAL_OTP_SECRET") ?? "";
  return new PortalCodes(secret || config.get<string>("LOCAL_AUTH_JWT_SECRET") || randomBytes(32).toString("hex"), config.get("PORTAL_DEMO_OTP") === "true" && !production);
}

/** A demonstration code as an admin types it: exactly six digits. */
export function demoCodeInput(value: unknown) {
  const code = typeof value === "string" ? value.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) throw new BadRequestException("Enter a six-digit code.");
  return code;
}

/**
 * Sets or clears the demonstration code on one contact. The same code again changes nothing; clearing ends the
 * contact's sessions. Returns whether anything changed.
 */
export async function setDemoCode(db: Db, workspaceId: string, codes: PortalCodes, input: { grantId: string; code: string | null; userId: string }) {
  const grant = (await db.query<{ phone: string; hash: string | null }>(
    `SELECT phone, demo_code_hash AS hash FROM client_portal_grants WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, input.grantId])).rows[0];
  if (!grant) return null;
  const hash = input.code === null ? null : codes.demoHash(input.grantId, input.code);
  if (hash === grant.hash) return { changed: false, demo: hash !== null, ended: 0 };
  await db.query(
    `UPDATE client_portal_grants SET demo_code_hash = $3, demo_code_set_by = $4, demo_code_set_at = $5, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.grantId, hash, hash ? input.userId : null, hash ? new Date() : null]);
  const ended = hash ? 0 : await endSessions(db, workspaceId, grant.phone, "demo_code_cleared");
  return { changed: true, demo: hash !== null, ended };
}

/** The contact whose demonstration code this is, if a grant of the number has one. */
async function demoGrantFor(db: Db, workspaceId: string, codes: PortalCodes, phone: string, code: string) {
  const grants = (await db.query<{ id: string; hash: string }>(
    `SELECT id, demo_code_hash AS hash FROM client_portal_grants WHERE workspace_id = $1 AND phone = $2 AND active AND demo_code_hash IS NOT NULL ORDER BY created_at`,
    [workspaceId, phone])).rows;
  return grants.find((grant) => timingSafeEqual(Buffer.from(grant.hash, "hex"), Buffer.from(codes.demoHash(grant.id, code), "hex"))) ?? null;
}

/** An email address shown without giving it away: the first letter and the domain. */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}

/** The number's active grants. In local demo mode only test contacts and contacts with a demonstration code count. */
async function grantsFor(db: Db, workspaceId: string, phone: string, demo: boolean): Promise<Grant[]> {
  return (await db.query<Grant>(
    `SELECT id, case_id AS "caseId", coalesce(confirmed_name, name) AS name, role, email, name_confirmed_at IS NOT NULL AS confirmed, demo_code_hash IS NOT NULL AS demo
       FROM client_portal_grants WHERE workspace_id = $1 AND phone = $2 AND active AND ($3::boolean = false OR test_contact OR demo_code_hash IS NOT NULL)
      ORDER BY created_at`, [workspaceId, phone, demo])).rows;
}

/**
 * Sends a sign-in (or decision) code. The answer is the same whether or not the number has access, so the
 * portal never tells a stranger who is a client. A code is 6 digits, lasts 5 minutes and allows 5 tries; a
 * number gets one every 30 seconds and at most 6 in 10 minutes; a requester at most 20.
 * WhatsApp that fails falls back to the contact's email.
 */
export async function sendCode(db: Db, workspaceId: string, codes: PortalCodes, delivery: Delivery, input: {
  phone: string; channel: Channel; purpose: string; requester: string | null; session?: PortalContact;
}) {
  const { phone, channel, purpose } = input;
  if (purpose !== "sign_in" && (!input.session || input.session.phone !== phone)) throw new ForbiddenException("Use the number you signed in with.");
  // One lock per number: counters hold across retries and servers.
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`portal:${workspaceId}:${phone}`]);
  const recent = (await db.query<{ number: number; requester: number; total: number; last: Date | null }>(
    `SELECT count(*) FILTER (WHERE phone = $2)::int AS number, count(*) FILTER (WHERE requester = $3)::int AS requester, count(*)::int AS total,
            max(created_at) FILTER (WHERE phone = $2 AND purpose = $4) AS last
       FROM client_portal_challenges WHERE workspace_id = $1 AND created_at > now() - interval '10 minutes'`,
    [workspaceId, phone, input.requester, purpose])).rows[0];
  if (recent.last && Date.now() - new Date(recent.last).getTime() < RESEND_SECONDS * 1000)
    throw new HttpException({ message: "A code is on its way. You can ask for another in a few seconds.", retryAfter: RESEND_SECONDS }, 429);
  if (recent.number >= PER_NUMBER || recent.requester >= PER_REQUESTER || recent.total >= PER_WORKSPACE)
    throw new HttpException({ message: "Too many codes were requested. Wait a few minutes, then try again.", retryAfter: 600 }, 429);
  const grants = await grantsFor(db, workspaceId, phone, codes.demo);
  const email = grants.find((grant) => grant.email)?.email ?? null;
  const id = randomUUID();
  // A number without access gets an unguessable code nobody receives; so does a demonstration contact, who
  // signs in with the code their admin set instead (checked against the same challenge, tries and expiry).
  const demonstration = grants.some((grant) => grant.demo);
  const code = grants.length && !demonstration ? codes.next() : randomBytes(24).toString("hex");
  await db.query(`UPDATE client_portal_challenges SET consumed_at = now() WHERE workspace_id = $1 AND phone = $2 AND purpose = $3 AND consumed_at IS NULL`,
    [workspaceId, phone, purpose]);
  await db.query(
    `INSERT INTO client_portal_challenges (id, workspace_id, phone, purpose, code_hash, expires_at, channel, requester)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7, $8)`,
    [id, workspaceId, phone, purpose.slice(0, 200), codes.hash(id, code), CODE_SECONDS, channel, input.requester]);
  if (grants.length && !demonstration && !codes.demo) {
    const reason = purpose === "sign_in" ? "sign_in" as const : "decision" as const;
    let sent = false;
    if (channel === "whatsapp") {
      try { await delivery.whatsapp({ workspaceId, challengeId: id, phone, code }); sent = true; }
      catch (error) { logger.warn(`WhatsApp code delivery failed (${error instanceof Error ? error.name : "unknown"}); trying email.`); }
    }
    if (!sent && email) sent = await delivery.email({ workspaceId, to: email, code, purpose: reason }).catch(() => false);
    // A signed-in client asking for a decision code learns at once that it didn't go; a stranger never does.
    if (!sent && purpose !== "sign_in")
      throw new HttpException({ message: email || channel === "email" ? "We couldn't send your code. Try again in a minute." : "We couldn't send your code by WhatsApp. Ask your project team to add your email." }, 503);
  }
  return { challengeId: id, channel, expiresIn: CODE_SECONDS, resendAfter: RESEND_SECONDS,
    // The address is only shown to the signed-in client it belongs to.
    ...(input.session && channel === "email" && email ? { sentTo: maskEmail(email) } : {}) };
}

/** Checks a code for its purpose (and number); a right code is used once. Wrong codes count against the challenge. */
export async function useCode(db: Db, workspaceId: string, codes: PortalCodes, input: { challengeId: string; code: string; purpose: string; phone?: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.challengeId) || !/^\d{6}$/.test(input.code)) return null;
  const challenge = (await db.query<{ phone: string; purpose: string; code_hash: string; attempts: number; expires_at: Date; consumed_at: Date | null }>(
    `SELECT phone, purpose, code_hash, attempts, expires_at, consumed_at FROM client_portal_challenges WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, input.challengeId])).rows[0];
  if (!challenge || challenge.purpose !== input.purpose || (input.phone && input.phone !== challenge.phone) || challenge.consumed_at
    || challenge.attempts >= MAX_ATTEMPTS || new Date(challenge.expires_at).getTime() <= Date.now()) return null;
  await db.query(`UPDATE client_portal_challenges SET attempts = attempts + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.challengeId]);
  // The delivered code, or the demonstration code of a contact of this number; either way the same challenge is used once.
  const delivered = timingSafeEqual(Buffer.from(challenge.code_hash, "hex"), Buffer.from(codes.hash(input.challengeId, input.code), "hex"));
  if (!delivered && !(await demoGrantFor(db, workspaceId, codes, challenge.phone, input.code))) return null;
  await db.query(`UPDATE client_portal_challenges SET consumed_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.challengeId]);
  return challenge.phone;
}

/**
 * Signs a client in with their code: a session for this number, whether they still need to confirm their name,
 * and the projects they open for the first time (the team hears about those).
 */
export async function signIn(db: Db, workspaceId: string, codes: PortalCodes, input: { challengeId: string; code: string }) {
  const phone = await useCode(db, workspaceId, codes, { ...input, purpose: "sign_in" });
  const grants = phone ? await grantsFor(db, workspaceId, phone, codes.demo) : [];
  if (!phone || !grants.length) return null;
  const token = randomBytes(48).toString("base64url");
  await db.query(
    `INSERT INTO client_portal_sessions (id, workspace_id, phone, token_hash, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), now())`,
    [randomUUID(), workspaceId, phone, digest(token), SESSION_MAX_DAYS]);
  const firstSignIns = (await db.query<{ id: string; caseId: string; name: string; first: boolean }>(
    `WITH never AS (SELECT id FROM client_portal_grants WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND last_signed_in_at IS NULL)
     UPDATE client_portal_grants grant_row SET last_signed_in_at = now() WHERE grant_row.workspace_id = $1 AND grant_row.id = ANY($2::uuid[])
     RETURNING grant_row.id, grant_row.case_id AS "caseId", coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.id IN (SELECT id FROM never) AS first`,
    [workspaceId, grants.map((grant) => grant.id)])).rows.filter((row) => row.first).map(({ id, caseId, name }) => ({ id, caseId, name }));
  return { token, expiresIn: SESSION_MAX_DAYS * 86_400, needsName: !grants.some((grant) => grant.confirmed), firstSignIns };
}

/** The signed-in client: their session (kept alive while used) and the projects they have access to. */
export async function openSession(db: Db, workspaceId: string, token: string, demo: boolean): Promise<PortalContact> {
  if (!token || token.length > 200) throw new UnauthorizedException("Sign in to continue.");
  const session = (await db.query<{ id: string; phone: string; stale: boolean }>(
    `SELECT id, phone, last_seen_at < now() - interval '1 hour' AS stale FROM client_portal_sessions
      WHERE workspace_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
        AND last_seen_at > now() - make_interval(days => $3)`, [workspaceId, digest(token), SESSION_IDLE_DAYS])).rows[0];
  if (!session) throw new UnauthorizedException("You were signed out. Sign in again to continue.");
  if (session.stale) await db.query(`UPDATE client_portal_sessions SET last_seen_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, session.id]);
  const grants = await grantsFor(db, workspaceId, session.phone, demo);
  if (!grants.length) throw new ForbiddenException("Your access to this portal has ended. Contact your project team.");
  const confirmed = grants.find((grant) => grant.confirmed);
  return { sessionId: session.id, phone: session.phone, name: (confirmed ?? grants[0]).name, nameConfirmed: Boolean(confirmed), grants };
}

export async function signOut(db: Db, workspaceId: string, token: string) {
  await db.query(`UPDATE client_portal_sessions SET revoked_at = now(), revoked_reason = 'signed_out' WHERE workspace_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
    [workspaceId, digest(token)]);
}

/** Ends every session of a number (staff took access away, or changed it). */
export async function endSessions(db: Db, workspaceId: string, phone: string, reason: string) {
  return (await db.query(`UPDATE client_portal_sessions SET revoked_at = now(), revoked_reason = $3 WHERE workspace_id = $1 AND phone = $2 AND revoked_at IS NULL`,
    [workspaceId, phone, reason.slice(0, 40)])).rowCount ?? 0;
}

/** The first time they sign in, the client confirms the name the team has for them (on every project they're on). */
export async function confirmName(db: Db, workspaceId: string, contact: PortalContact, value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 160) throw new BadRequestException("Enter your name.");
  await db.query(
    `UPDATE client_portal_grants SET confirmed_name = $3, name_confirmed_at = now(), version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, contact.grants.map((grant) => grant.id), name]);
  return name;
}
