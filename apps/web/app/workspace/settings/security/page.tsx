import { SecurityPage } from "@/components/workspace";
import { UserSettingsFrame } from "@/components/workspace/user-settings-frame";
import { getSecurityPageData } from "@/lib/workspace/security.server";

export default async function Page() {
  return <UserSettingsFrame active="security"><SecurityPage initialData={await getSecurityPageData()} /></UserSettingsFrame>;
}
