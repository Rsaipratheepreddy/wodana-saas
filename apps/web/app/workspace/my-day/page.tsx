import { redirect } from "next/navigation";
import type { MyDayUrgency, ReminderModule } from "@wodana/contracts";
import { MyDayPage, type MyDayFilter } from "@/components/reminders/my-day-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { isWorkspaceAdministrator } from "@/lib/workspace/access";
import { MY_DAY_URGENCIES, REMINDER_MODULES, REMINDER_PERMISSIONS } from "@/lib/reminders/contract";

const oneOf = <T extends string>(values: readonly T[], value: string | string[] | undefined): T | undefined =>
  typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : undefined;

/** Home › My day: what is due on the person (or, with reminders.team, their team), with its toolbar state in the address. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const params = await searchParams;
  const canTeam = isWorkspaceAdministrator(membership.roles) || Boolean(membership.allowedPermissions?.includes(REMINDER_PERMISSIONS.team));
  const filter: MyDayFilter = {
    scope: params.scope === "team" && canTeam ? "team" : "me",
    urgency: oneOf<MyDayUrgency>(MY_DAY_URGENCIES, params.urgency),
    module: oneOf<ReminderModule>(REMINDER_MODULES, params.module),
  };
  return <MyDayPage workspaceId={membership.workspaceId} canTeam={canTeam} initialFilter={filter} />;
}
