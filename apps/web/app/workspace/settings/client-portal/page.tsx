import { getPortalSettings } from "@/lib/commercial/server";
import { PortalSettingsPage } from "@/components/commercial/portal-settings";
export default async function Page() {
  return <PortalSettingsPage initial={await getPortalSettings()} />;
}
