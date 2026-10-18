import type { Metadata } from "next";
import { ContactDetails } from "@/components/landing/legal";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Contact · Wodana"), description: t("Support, sales and company details for Wodana.") };
}

export default async function ContactPage() {
  await requirePublicHost();
  const t = await getServerT();
  return <MarketingFrame>
    <MarketingIntro lead={t("Help with the Wodana web app, client portal and mobile app.")} title={t("Contact and support")} />
    <MarketingPanel label={t("Contact details")}>
      <ContactDetails t={t} />
    </MarketingPanel>
  </MarketingFrame>;
}
