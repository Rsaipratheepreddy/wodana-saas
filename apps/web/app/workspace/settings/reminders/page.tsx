import { redirect, unstable_rethrow } from "next/navigation";
import { SettingsSection } from "@/design-system";
import { CrmSmartRules } from "@/components/crm/crm-smart-rules";
import { ReminderSettingsPage } from "@/components/reminders/reminder-settings-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getCrmScreenPageData } from "@/lib/crm/screens.server";
import { getServerT } from "@/lib/i18n/server";

const SUMMARY_RULES = ["weekly_progress"];

/** Settings › Reminders: the reminder engine's firm defaults and one row per reminder kind; the weekly progress summary stays below. */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string | string[] }> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const [{ kind }, t] = await Promise.all([searchParams, getServerT()]);
  // The weekly progress summary is a scheduled notice, not a reminder: it keeps its own rule (Sales automations).
  let summaries: Awaited<ReturnType<typeof getCrmScreenPageData>> | null = null;
  try { summaries = await getCrmScreenPageData("automations"); } catch (error) { unstable_rethrow(error); }
  const summary = summaries?.canView && summaries.items.some((item) => SUMMARY_RULES.includes(String((item as { code?: unknown }).code)))
    ? <SettingsSection id="reminders-summaries" title={t("Summaries")}><CrmSmartRules initialData={summaries} codes={SUMMARY_RULES} title={t("Summaries")} embedded /></SettingsSection> : null;
  return <ReminderSettingsPage workspaceId={membership.workspaceId} focusKind={typeof kind === "string" ? kind : undefined} extra={summary} />;
}
