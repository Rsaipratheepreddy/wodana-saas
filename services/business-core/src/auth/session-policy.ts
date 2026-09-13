export const MAX_ACTIVE_DEVICES = 2;

/** Server-configured test accounts only; this never bypasses authentication or revocation. */
export function sessionDeviceLimit(userId: string, exemptUserIds = ""): number | null {
  const exempt = exemptUserIds.split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
  return exempt.includes(userId.toLowerCase()) ? null : MAX_ACTIVE_DEVICES;
}
