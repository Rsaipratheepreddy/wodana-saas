/**
 * What the calendar may read for this person, from their membership, so it only asks for what they can see: the
 * member list (to pick someone's calendar) and the integrations (Google calendars) need their own permissions, which a
 * designer, say, doesn't have. Booking pages are managed with the Sales settings permission. The services check each
 * of these too.
 */
export const MEMBER_LIST_PERMISSIONS = ["module.members.read", "module.members.write", "module.members.edit", "module.members.delete", "workspace.members.manage"];
export const CONNECTION_PERMISSIONS = ["module.integrations.read", "integrations.view"];

export type CalendarRights = { canManageBooking: boolean; canListMembers: boolean; canReadConnections: boolean };

export function calendarRights(membership: { roles: string[]; allowedPermissions?: string[] }): CalendarRights {
  const admin = membership.roles.some((role) => role === "owner" || role === "administrator");
  const any = (codes: string[]) => admin || codes.some((code) => membership.allowedPermissions?.includes(code));
  return { canManageBooking: any(["crm.settings.manage"]), canListMembers: any(MEMBER_LIST_PERMISSIONS), canReadConnections: any(CONNECTION_PERMISSIONS) };
}
