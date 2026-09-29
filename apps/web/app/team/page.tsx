import type { Metadata } from "next";
import { TEAM, TeamGrid } from "@/components/landing/company";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Team · Wodana"), description: t("The people building Wodana, the workspace for interior, fit-out and joinery firms.") };
}

export default async function TeamPage() {
  await requirePublicHost();
  const t = await getServerT();
  return <MarketingFrame>
    <MarketingIntro lead={t("The people building Wodana.")} title={t("Team")} />
    <MarketingPanel label={t("Team")}>
      <TeamGrid members={TEAM} t={t} />
    </MarketingPanel>
  </MarketingFrame>;
}
