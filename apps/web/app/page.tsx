import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { requirePublicHost } from "@/components/landing/public-host";
import { businessApiUrl } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { loadPublicSalesForm } from "@/lib/sales/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("Wodana: every job, from enquiry to handover"),
    description: t("Wodana runs sales, projects, purchasing and site work for interior and fit-out firms."),
  };
}

export default async function Home() {
  await requirePublicHost();
  const form = await loadPublicSalesForm(businessApiUrl("/public/sales/contact-form"));
  return <LandingPage form={form} />;
}
