import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import type { PoolClient } from "pg";
import { countryFromLocale } from "../crm/intake/intake-phone";
import { endSessions } from "./portal-auth";
import type { PortalSettings, ProjectAccess } from "./portal-settings";

type Db = Pick<PoolClient, "query">;

/** An invitation link lasts two weeks; one can be sent again after two minutes, at most five a day. */
export const INVITE_DAYS = 14;
export const INVITE_RESEND_SECONDS = 120;
export const INVITES_PER_DAY = 5;

export type InviteDelivery = "sent" | "not_configured" | "failed" | "suppressed";
export type AccessStatus = "not_invited" | "invited" | "active" | "revoked";
/** Why the client can't be invited right now, in the order staff can fix it. */
export type InviteBlock = "portal_off" | "paused" | "no_client" | "no_phone" | "no_email";

/**
 * The project's client and their place in the portal, as the project record shows it: who they are (from the
 * case's client, or the contact already granted), whether they were invited, when they last visited, and what
 * stops an invitation.
 */
export type ClientAccess = {
  name: string | null; phone: string | null; email: string | null; grantId: string | null; partyId: string | null;
  status: AccessStatus; invitedAt: string | null; expiresAt: string | null; delivery: InviteDelivery | null; lastVisitAt: string | null;
  version: number; resendAfter: number; blocked: InviteBlock | null;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MOBILE = /^\+[1-9]\d{7,14}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export const inviteTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newInviteToken = () => randomBytes(32).toString("base64url");

/** A client's number in international form, from how the CRM holds it (with or without its country). */
export function e164(value: string | null | undefined, country: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = parsePhoneNumberFromString(value.trim(), { defaultCountry: (country?.toUpperCase() || undefined) as CountryCode | undefined, extract: false });
  const number = parsed ? (parsed.isPossible() ? parsed.number : null) : value.trim().startsWith("+") ? value.replace(/[\s().-]/g, "") : null;
  return number && MOBILE.test(number) ? number : null;
}

/** The case's client as the CRM knows them: their name, mobile number (a landline when that's all there is) and email. */
export async function projectClient(db: Db, workspaceId: string, caseId: string) {
  const row = (await db.query<{ partyId: string; name: string; email: string | null; phone: string | null; country: string | null; locale: string }>(
    `SELECT party.id AS "partyId", party.display_name AS name, workspace.default_locale AS locale, mobile.raw_value AS phone, mobile.country_code AS country,
            (SELECT lower(point.raw_value) FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id
              AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC, point.created_at DESC LIMIT 1) AS email
       FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN LATERAL (SELECT point.raw_value, point.country_code FROM crm_contact_points point WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id
              AND point.type = 'phone' AND point.status = 'active' ORDER BY (point.label = 'mobile') DESC NULLS LAST, point.is_primary DESC, point.created_at DESC LIMIT 1) mobile ON true
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
  if (!row) return null;
  return { partyId: row.partyId, name: row.name, phone: e164(row.phone, row.country ?? countryFromLocale(row.locale)), email: row.email && EMAIL.test(row.email) ? row.email : null };
}

type GrantRow = { id: string; name: string; phone: string; email: string | null; active: boolean; version: number; lastVisitAt: Date | null };
type InvitationRow = { id: string; email: string; sentAt: Date; expiresAt: Date; delivery: InviteDelivery; revokedAt: Date | null };

/** The grant that is this client: the one with the client's number, else the one last invited on this project. */
async function grantOf(db: Db, workspaceId: string, projectId: string, caseId: string, phone: string | null) {
  return (await db.query<GrantRow>(
    `SELECT grant_row.id, coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.phone, grant_row.email, grant_row.active, grant_row.version,
            coalesce((SELECT max(session.last_seen_at) FROM client_portal_sessions session WHERE session.workspace_id = grant_row.workspace_id AND session.phone = grant_row.phone),
                     grant_row.last_signed_in_at) AS "lastVisitAt"
       FROM client_portal_grants grant_row
      WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2
        AND (grant_row.phone = $3 OR grant_row.id = (SELECT invitation.grant_id FROM client_portal_invitations invitation
                                                       WHERE invitation.workspace_id = $1 AND invitation.project_id = $4 ORDER BY invitation.sent_at DESC LIMIT 1))
      ORDER BY (grant_row.phone = $3) DESC NULLS LAST, grant_row.created_at LIMIT 1`, [workspaceId, caseId, phone, projectId])).rows[0];
}

async function latestInvitation(db: Db, workspaceId: string, grantId: string) {
  return (await db.query<InvitationRow>(
    `SELECT id, email, sent_at AS "sentAt", expires_at AS "expiresAt", delivery, revoked_at AS "revokedAt" FROM client_portal_invitations
      WHERE workspace_id = $1 AND grant_id = $2 ORDER BY sent_at DESC LIMIT 1`, [workspaceId, grantId])).rows[0];
}

const seconds = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

export async function readClientAccess(db: Db, input: { workspaceId: string; projectId: string; caseId: string; settings: PortalSettings; access: ProjectAccess }): Promise<ClientAccess> {
  const client = await projectClient(db, input.workspaceId, input.caseId);
  const grant = await grantOf(db, input.workspaceId, input.projectId, input.caseId, client?.phone ?? null);
  const invitation = grant ? await latestInvitation(db, input.workspaceId, grant.id) : undefined;
  const open = invitation && !invitation.revokedAt ? invitation : undefined;
  const phone = grant?.phone ?? client?.phone ?? null;
  const email = grant?.email ?? client?.email ?? null;
  const blocked: InviteBlock | null = !input.settings.enabled ? "portal_off" : input.access.paused ? "paused" : !client && !grant ? "no_client" : !phone ? "no_phone" : !email ? "no_email" : null;
  // Active means they have been in since the last invitation; invited again (or after a revoke) waits for their next visit.
  const visited = Boolean(grant?.active && grant.lastVisitAt && (!open || grant.lastVisitAt > open.sentAt));
  return {
    name: grant?.name ?? client?.name ?? null, phone, email, grantId: grant?.id ?? null, partyId: client?.partyId ?? null,
    status: !grant ? "not_invited" : !grant.active ? "revoked" : visited ? "active" : open ? "invited" : "not_invited",
    invitedAt: open?.sentAt.toISOString() ?? null, expiresAt: open?.expiresAt.toISOString() ?? null, delivery: open?.delivery ?? null,
    lastVisitAt: grant?.active && grant.lastVisitAt ? grant.lastVisitAt.toISOString() : null,
    version: grant?.version ?? 0, resendAfter: open ? seconds(open.sentAt.getTime() + INVITE_RESEND_SECONDS * 1000) : 0, blocked,
  };
}

const BLOCKED: Record<InviteBlock, () => HttpException> = {
  portal_off: () => new ConflictException("The portal is off for the workspace. Turn it on in Settings first."),
  paused: () => new ConflictException("The portal is paused for this project. Resume it first."),
  no_client: () => new UnprocessableEntityException("This project has no client to invite."),
  no_phone: () => new UnprocessableEntityException("Add the client's mobile number first."),
  no_email: () => new UnprocessableEntityException("Add an email to the client first."),
};

export type InviteSend = (input: { to: string; name: string; phone: string; token: string; expiresAt: Date }) => Promise<InviteDelivery>;

/**
 * Invites the project's client: their portal identity for this case is created (or reused, and turned back on
 * after a revoke), an invitation with a fresh link is recorded, and the email goes out through `send`. Version-
 * checked against the client's grant; a second invite waits two minutes and stops at five a day.
 */
export async function inviteClient(db: Db, input: {
  workspaceId: string; projectId: string; caseId: string; userId: string; settings: PortalSettings; access: ProjectAccess; version: number; send: InviteSend;
}) {
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [input.workspaceId, input.caseId]);
  const current = await readClientAccess(db, input);
  if (input.version !== current.version) throw new ConflictException("Someone else changed the client's access. Reload to see their change.");
  if (current.blocked) throw BLOCKED[current.blocked]();
  if (current.resendAfter > 0) throw new HttpException({ message: "An invite was just sent. You can send another in a couple of minutes.", retryAfter: current.resendAfter }, 429);
  const { name, phone, email } = current as ClientAccess & { name: string; phone: string; email: string };
  let grantId = current.grantId;
  if (grantId) {
    const day = (await db.query<{ count: number; oldest: Date | null }>(
      `SELECT count(*)::int AS count, min(sent_at) AS oldest FROM client_portal_invitations WHERE workspace_id = $1 AND grant_id = $2 AND sent_at > now() - interval '24 hours'`,
      [input.workspaceId, grantId])).rows[0];
    if (day.count >= INVITES_PER_DAY)
      throw new HttpException({ message: "Five invites were sent today. Copy the portal link instead, or try again tomorrow.", retryAfter: seconds(day.oldest!.getTime() + 86_400_000) }, 429);
    await db.query(`UPDATE client_portal_grants SET active = true, email = coalesce(email, $3), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [input.workspaceId, grantId, email]);
  } else {
    grantId = randomUUID();
    await db.query(`INSERT INTO client_portal_grants (id, workspace_id, case_id, name, phone, email, role, active) VALUES ($1, $2, $3, $4, $5, $6, 'approver', true)`,
      [grantId, input.workspaceId, input.caseId, name.slice(0, 160), phone, email]);
  }
  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const delivery = await input.send({ to: email, name, phone, token, expiresAt });
  const invitationId = randomUUID();
  await db.query(
    `INSERT INTO client_portal_invitations (workspace_id, id, grant_id, project_id, email, token_hash, delivery, sent_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.workspaceId, invitationId, grantId, input.projectId, email, inviteTokenHash(token), delivery, input.userId, expiresAt]);
  return { grantId, invitationId, email, delivery, reused: Boolean(current.grantId) };
}

/** Takes the client's access away: they can't sign in, their sessions end, and every open invitation link stops working. */
export async function revokeClient(db: Db, input: { workspaceId: string; projectId: string; caseId: string; userId: string; settings: PortalSettings; access: ProjectAccess; version: number }) {
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [input.workspaceId, input.caseId]);
  const current = await readClientAccess(db, input);
  if (input.version !== current.version) throw new ConflictException("Someone else changed the client's access. Reload to see their change.");
  if (!current.grantId) throw new NotFoundException("This client isn't on the portal.");
  if (current.status === "revoked") return { grantId: current.grantId, ended: 0, changed: false };
  await db.query(`UPDATE client_portal_grants SET active = false, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, current.grantId]);
  await db.query(`UPDATE client_portal_invitations SET revoked_at = now(), revoked_by = $3 WHERE workspace_id = $1 AND grant_id = $2 AND revoked_at IS NULL`,
    [input.workspaceId, current.grantId, input.userId]);
  const ended = await endSessions(db, input.workspaceId, current.phone!, "access_revoked");
  return { grantId: current.grantId, ended, changed: true };
}

/** What an invitation link opens: the client's number ready to sign in, or nothing when the link has expired or access ended. */
export async function openInvitation(db: Db, workspaceId: string, token: string) {
  if (!TOKEN.test(token)) return null;
  const row = (await db.query<{ name: string; phone: string; usable: boolean }>(
    `SELECT coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.phone,
            (invitation.expires_at > now() AND invitation.revoked_at IS NULL AND grant_row.active) AS usable
       FROM client_portal_invitations invitation
       JOIN client_portal_grants grant_row ON grant_row.workspace_id = invitation.workspace_id AND grant_row.id = invitation.grant_id
      WHERE invitation.workspace_id = $1 AND invitation.token_hash = $2`, [workspaceId, inviteTokenHash(token)])).rows[0];
  if (!row) return null;
  return row.usable ? { status: "valid" as const, name: row.name, phone: row.phone } : { status: "expired" as const };
}
