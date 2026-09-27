import { CrmSmartRules, DELIVERY_RULES } from "@/components/crm/crm-smart-rules";
import { getCrmScreenPageData } from "@/lib/crm/screens.server";
import { getServerT } from "@/lib/i18n/server";

/** Settings → Reminders: client-decision reminders and the weekly project progress summary. */
export default async function Page() {
  return <CrmSmartRules initialData={await getCrmScreenPageData("automations")} codes={DELIVERY_RULES} title={(await getServerT())("Reminders")} embedded />;
}
