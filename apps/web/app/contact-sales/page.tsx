import type { Metadata } from "next";
import { ContactSection, MarketingFrame } from "@/components/landing/landing-page";
import { requirePublicHost } from "@/components/landing/public-host";
import { businessApiUrl } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { loadPublicSalesForm } from "@/lib/sales/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Contact sales · Wodana"), description: t("Tell us about your firm. We'll show you Wodana with work like yours.") };
}

/** The "Contact sales" form on its own page, for links from emails, ads and the footer. */
export default async function ContactSalesPage() {
  await requirePublicHost();
  const form = await loadPublicSalesForm(businessApiUrl("/public/sales/contact-form"));
  return <MarketingFrame>
    <ContactSection form={form} headingLevel={1} source="contact_sales" />
  </MarketingFrame>;
}
