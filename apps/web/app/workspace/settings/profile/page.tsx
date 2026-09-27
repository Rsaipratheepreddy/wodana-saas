import { redirect } from "next/navigation";
import { ProfileAppearance } from "@/components/workspace/profile-appearance";
import { UserSettingsFrame } from "@/components/workspace/user-settings-frame";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getMyProfile } from "@/lib/workspace/profile.server";

export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) redirect("/login");
  const appearance = await getMyProfile(workspaceId) ?? { avatarPreset: null, photoUrl: null, version: 0 };
  return <UserSettingsFrame active="profile"><ProfileAppearance email={profile.primaryEmail} initial={appearance} name={profile.displayName} roles={profile.memberships[0]?.roles ?? []} userId={profile.id} workspaceId={workspaceId} /></UserSettingsFrame>;
}
