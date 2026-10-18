import type { Metadata } from "next";
import { LegalDocument, PRIVACY_SECTIONS, legalUpdatedLabel } from "@/components/landing/legal";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerLanguage, getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Privacy policy · Wodana"), description: t("How Wodana collects, uses and protects personal data.") };
}

export default async function PrivacyPage() {
  await requirePublicHost();
  const t = await getServerT();
  const language = await getServerLanguage();
  return <MarketingFrame>
    <MarketingIntro lead={t("How Wodana handles the information firms and their people trust us with.")} title={t("Privacy policy")} />
    <MarketingPanel label={t("Policy")}>
      <LegalDocument sections={PRIVACY_SECTIONS} t={t} updated={legalUpdatedLabel(language)} />
    </MarketingPanel>
  </MarketingFrame>;
}
