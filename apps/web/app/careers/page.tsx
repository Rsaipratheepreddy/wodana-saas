import type { Metadata } from "next";
import { OPEN_ROLES, OpenRoles } from "@/components/landing/company";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Careers · Wodana"), description: t("Open roles at Wodana, the workspace for interior, fit-out and joinery firms.") };
}

export default async function CareersPage() {
  await requirePublicHost();
  const t = await getServerT();
  return <MarketingFrame>
    <MarketingIntro lead={t("Help build the tools interior firms run on.")} title={t("Careers")} />
    <MarketingPanel label={t("Open roles")}>
      <OpenRoles roles={OPEN_ROLES} t={t} />
    </MarketingPanel>
  </MarketingFrame>;
}
