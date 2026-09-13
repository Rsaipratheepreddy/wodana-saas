import { AuditLogPage } from "@/components/workspace";
import { UserSettingsFrame } from "@/components/workspace/user-settings-frame";
import { getAuditLogPageData } from "@/lib/workspace/audit-log.server";

export default async function Page() {
  return <UserSettingsFrame active="audit-logs"><AuditLogPage initialData={await getAuditLogPageData()} /></UserSettingsFrame>;
}
