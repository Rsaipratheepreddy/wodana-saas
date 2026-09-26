import { CrmSmartRules, DELIVERY_RULES } from "@/components/crm/crm-smart-rules";
import { getCrmScreenPageData } from "@/lib/crm/screens.server";

/** Settings → Reminders: client-decision reminders and the weekly project progress summary. */
export default async function Page() {
  return <CrmSmartRules initialData={await getCrmScreenPageData("automations")} codes={DELIVERY_RULES} title="Reminders" embedded />;
}
