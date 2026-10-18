import type { Metadata } from "next";
import { LegalDocument, TERMS_SECTIONS, legalUpdatedLabel } from "@/components/landing/legal";
import { MarketingFrame, MarketingIntro, MarketingPanel } from "@/components/landing/marketing-frame";
import { requirePublicHost } from "@/components/landing/public-host";
import { getServerLanguage, getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Terms of service · Wodana"), description: t("The terms on which firms use Wodana.") };
}

export default async function TermsPage() {
  await requirePublicHost();
  const t = await getServerT();
  const language = await getServerLanguage();
  return <MarketingFrame>
    <MarketingIntro lead={t("The terms on which firms use Wodana.")} title={t("Terms of service")} />
    <MarketingPanel label={t("Terms")}>
      <LegalDocument sections={TERMS_SECTIONS} t={t} updated={legalUpdatedLabel(language)} />
    </MarketingPanel>
  </MarketingFrame>;
}
