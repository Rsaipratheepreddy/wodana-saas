import { ForbiddenException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { normalizeName } from "./crm-types";

/**
 * A client's primary identity — their name and phone numbers — is locked for everyone who manages records
 * but does not hold this permission (Sales edits the opportunity, not who the client is). Owners and
 * administrators hold every permission; a firm gives it to its Sales admins through their role.
 */
export const CLIENT_IDENTITY_PERMISSION = "crm.parties.identity";
export const CLIENT_IDENTITY_LOCKED = "Only Sales admins can change the client's name or phone";

type Access = { hasPermission(client: PoolClient, workspaceId: string, userId: string, permission: string): Promise<boolean> };

/** A name changes when a stored one exists and the new one differs beyond spacing and case. Filling an empty name is not a change. */
export function nameChanged(before: string | null | undefined, next: string | null | undefined) {
  if (!before?.trim() || next === undefined || next === null) return false;
  return normalizeName(before) !== normalizeName(next);
}

/**
 * A phone changes when a stored one exists and the new value is another number (or clears it). The same number
 * written another way (spaces, a leading 0 or the country code) is not a change; adding a missing phone is not either.
 */
export function phoneChanged(before: string | null | undefined, next: string | null | undefined) {
  const stored = (before ?? "").replace(/\D/g, "");
  if (!stored) return false;
  const given = (next ?? "").replace(/\D/g, "");
  if (!given) return true;
  return stored !== given && stored.slice(-9) !== given.slice(-9);
}

/** Refuses a change to the client's name or phone unless the actor may change it. */
export async function assertClientIdentityChange(access: Access, client: PoolClient, workspaceId: string, userId: string, changed: boolean) {
  if (!changed) return;
  if (!(await access.hasPermission(client, workspaceId, userId, CLIENT_IDENTITY_PERMISSION))) {
    throw new ForbiddenException(CLIENT_IDENTITY_LOCKED);
  }
}
