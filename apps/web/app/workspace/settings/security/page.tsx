import { EmptyState } from "@/design-system";
import { SecurityPage } from "@/components/workspace";
import { UserSettingsFrame } from "@/components/workspace/user-settings-frame";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { getSecurityPageData } from "@/lib/workspace/security.server";
import { getViewAsActivity } from "@/lib/workspace/view-as.server";

export default async function Page() {
  const profile = await getAuthenticatedProfile();
  // A person's security settings and sessions stay private, even from an owner viewing as them.
  if (profile.viewAs) {
    const t = await getServerT();
    return <UserSettingsFrame active="security"><EmptyState illustration="locked" title={t("Security stays private to {name}", { name: profile.viewAs.subjectName })} /></UserSettingsFrame>;
  }
  const data = await getSecurityPageData();
  return <UserSettingsFrame active="security"><SecurityPage initialData={data} viewAsActivity={await getViewAsActivity(data.workspaceId, false)} /></UserSettingsFrame>;
}
