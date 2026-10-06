import { BadRequestException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PortalContact } from "./portal-auth";

type Db = Pick<PoolClient, "query">;

/** Where push tokens are kept (the same secure store as staff phones); only a reference and a hash reach the database. */
export type TokenStore = { put(workspaceId: string, owner: string, token: string): Promise<string>; delete(reference: string | null | undefined): Promise<void> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

export type DeviceInput = { requestId: string; installationId: string; platform: "ios" | "android"; token: string; locale: string; timezone: string };

/**
 * The client app's registration, read strictly: the client said yes in the app (`consent: true`), the phone allowed
 * notifications (otherwise there is no token), and every field is in the shape the push sender needs.
 */
export function deviceInput(body: Record<string, unknown>): DeviceInput {
  if (body.consent !== true) throw new BadRequestException("Turn on notifications in the app first.");
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const requestId = text(body.requestId);
  const installationId = text(body.installationId);
  const platform = text(body.platform);
  const token = text(body.token);
  const locale = text(body.locale) || "en";
  const timezone = text(body.timezone) || "UTC";
  if (!UUID.test(requestId) || !UUID.test(installationId)) throw new BadRequestException("Try that again.");
  if (platform !== "ios" && platform !== "android") throw new BadRequestException("Notifications work on iPhone and Android phones.");
  if (!EXPO_TOKEN.test(token)) throw new BadRequestException("This phone's notification address isn't valid.");
  if (!LOCALE.test(locale) || locale.length > 35) throw new BadRequestException("Try that again.");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new BadRequestException("Try that again."); }
  return { requestId, installationId, platform, token, locale, timezone: timezone.slice(0, 64) };
}

/** Which state a phone is in for this contact: what the app shows under Notifications. */
export async function deviceState(db: Db, workspaceId: string, contact: PortalContact, installationId: string) {
  if (!UUID.test(installationId)) return { registered: false, consentedAt: null, optedOutAt: null };
  const row = (await db.query<{ consentedAt: Date; optedOutAt: Date | null; live: boolean }>(
    `SELECT consented_at AS "consentedAt", opted_out_at AS "optedOutAt", token_hash IS NOT NULL AS live
       FROM client_portal_devices WHERE workspace_id = $1 AND phone = $2 AND installation_id = $3`, [workspaceId, contact.phone, installationId])).rows[0];
  return { registered: Boolean(row?.live && !row.optedOutAt), consentedAt: row?.consentedAt ?? null, optedOutAt: row?.optedOutAt ?? null };
}

/**
 * Registers (or refreshes) this phone for the signed-in client's push notices, under their current session. The same
 * request id again changes nothing; a token another install held moves here; the first consent is kept as given.
 */
export async function registerDevice(db: Db, workspaceId: string, contact: PortalContact, store: TokenStore, input: DeviceInput) {
  const replay = (await db.query(`SELECT 1 FROM client_portal_devices WHERE workspace_id = $1 AND phone = $2 AND installation_id = $3 AND last_request_id = $4`,
    [workspaceId, contact.phone, input.installationId, input.requestId])).rowCount;
  if (replay) return { ...(await deviceState(db, workspaceId, contact, input.installationId)), replayed: true };
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const reference = await store.put(workspaceId, "portal", input.token);
  try {
    const displaced = (await db.query<{ reference: string | null }>(
      `UPDATE client_portal_devices device SET token_hash = NULL, encrypted_token_reference = NULL, version = device.version + 1, updated_at = now()
         FROM (SELECT id, encrypted_token_reference AS reference FROM client_portal_devices
                WHERE workspace_id = $1 AND token_hash = $2 AND NOT (phone = $3 AND installation_id = $4) FOR UPDATE) prior
        WHERE device.id = prior.id RETURNING prior.reference`,
      [workspaceId, tokenHash, contact.phone, input.installationId])).rows;
    const prior = (await db.query<{ reference: string | null }>(
      `SELECT encrypted_token_reference AS reference FROM client_portal_devices WHERE workspace_id = $1 AND phone = $2 AND installation_id = $3 FOR UPDATE`,
      [workspaceId, contact.phone, input.installationId])).rows;
    await db.query(
      `INSERT INTO client_portal_devices (id, workspace_id, phone, session_id, installation_id, platform, token_hash, encrypted_token_reference, locale, timezone, consented_at, last_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
       ON CONFLICT (workspace_id, phone, installation_id) DO UPDATE SET session_id = EXCLUDED.session_id, platform = EXCLUDED.platform, token_hash = EXCLUDED.token_hash,
         encrypted_token_reference = EXCLUDED.encrypted_token_reference, locale = EXCLUDED.locale, timezone = EXCLUDED.timezone, opted_out_at = NULL,
         -- Turning notices back on is a new consent; a refresh of a live registration keeps the first.
         consented_at = CASE WHEN client_portal_devices.opted_out_at IS NULL THEN client_portal_devices.consented_at ELSE now() END,
         last_request_id = EXCLUDED.last_request_id, last_seen_at = now(), version = client_portal_devices.version + 1, updated_at = now()`,
      [randomUUID(), workspaceId, contact.phone, contact.sessionId, input.installationId, input.platform, tokenHash, reference, input.locale, input.timezone, input.requestId]);
    await Promise.all([...displaced, ...prior].map((row) => row.reference).filter((value) => value && value !== reference).map((value) => store.delete(value)));
    return { ...(await deviceState(db, workspaceId, contact, input.installationId)), replayed: false };
  } catch (error) {
    await store.delete(reference);
    throw error;
  }
}

/** The client turned notices off on this phone (or signed out of it): the token goes and the opt-out is remembered. */
export async function optOutDevice(db: Db, workspaceId: string, contact: PortalContact, store: TokenStore | undefined, installationId: unknown) {
  const id = typeof installationId === "string" ? installationId.trim() : "";
  if (!UUID.test(id)) throw new BadRequestException("Try that again.");
  const rows = (await db.query<{ reference: string | null }>(
    `UPDATE client_portal_devices device SET opted_out_at = coalesce(device.opted_out_at, now()), token_hash = NULL, encrypted_token_reference = NULL,
            version = device.version + 1, updated_at = now()
       FROM (SELECT id, encrypted_token_reference AS reference FROM client_portal_devices WHERE workspace_id = $1 AND phone = $2 AND installation_id = $3 FOR UPDATE) prior
      WHERE device.id = prior.id RETURNING prior.reference`, [workspaceId, contact.phone, id])).rows;
  await Promise.all(rows.map((row) => store?.delete(row.reference)));
  return deviceState(db, workspaceId, contact, id);
}

/**
 * The phones a client contact can be told on right now: consented, not opted out, holding a token, and registered under a
 * session that is still live (signing out, staff ending their sessions or removing their access stops pushes at once).
 */
export async function deliverableDevices(db: Db, workspaceId: string, phone: string) {
  return (await db.query<{ id: string; platform: "ios" | "android"; tokenReference: string; locale: string }>(
    `SELECT device.id, device.platform, device.encrypted_token_reference AS "tokenReference", device.locale
       FROM client_portal_devices device
       JOIN client_portal_sessions session ON session.workspace_id = device.workspace_id AND session.id = device.session_id
      WHERE device.workspace_id = $1 AND device.phone = $2 AND device.opted_out_at IS NULL AND device.encrypted_token_reference IS NOT NULL
        AND session.revoked_at IS NULL AND session.expires_at > now()
        AND EXISTS (SELECT 1 FROM client_portal_grants grant_row WHERE grant_row.workspace_id = device.workspace_id AND grant_row.phone = device.phone AND grant_row.active)
      ORDER BY device.last_seen_at DESC`, [workspaceId, phone])).rows;
}
