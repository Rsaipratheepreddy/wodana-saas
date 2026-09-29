import type { Metadata } from "next";
import { EmptyState } from "@/design-system";
import { NextStep } from "@/components/landing/company";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("About · Wodana"), description: t("Wodana is the workspace interior, fit-out and joinery firms run every job on, from enquiry to handover.") };
}

export default async function AboutPage() {
  await requirePublicHost();
  const t = await getServerT();
  return <MarketingFrame>
    <MarketingIntro lead={t("We build one calm place for every job an interior firm takes on, from the first enquiry to the final handover.")}
      title={t("About Wodana")} />
    <MarketingPanel label={t("Our story")}>
      <EmptyState action={<NextStep href="/#product" label={t("Take the tour")} />} illustration="empty" title={t("Our story is coming soon")} />
    </MarketingPanel>
  </MarketingFrame>;
}
