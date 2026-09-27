export const MAX_ACTIVE_DEVICES = 2;

/** The deployment's device limit: AUTH_MAX_ACTIVE_DEVICES as a whole number, or "unlimited" (e.g. a trial where many testers share logins). */
export function configuredDeviceLimit(value = ""): number | null {
  const text = value.trim().toLowerCase();
  if (text === "unlimited") return null;
  const limit = Number(text);
  return text && Number.isInteger(limit) && limit > 0 ? limit : MAX_ACTIVE_DEVICES;
}

/** Server-configured test accounts only; this never bypasses authentication or revocation. */
export function sessionDeviceLimit(userId: string, exemptUserIds = "", limit: number | null = MAX_ACTIVE_DEVICES): number | null {
  const exempt = exemptUserIds.split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
  return exempt.includes(userId.toLowerCase()) ? null : limit;
}
