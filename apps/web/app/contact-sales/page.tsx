import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ContactSection, MarketingFrame } from "@/components/landing/landing-page";
import { classifyTenantHost } from "@/lib/auth/tenant-host";
import { businessApiUrl } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { loadPublicSalesForm } from "@/lib/sales/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Contact sales · Wodana"), description: t("Tell us about your firm. We'll show you Wodana with work like yours.") };
}

/** The "Contact sales" form on its own page, for links from emails, ads and the footer. */
export default async function ContactSalesPage() {
  const route = classifyTenantHost((await headers()).get("host"));
  if (route.kind === "invalid") notFound();
  if (route.kind !== "generic") redirect("/login");
  const form = await loadPublicSalesForm(businessApiUrl("/public/sales/contact-form"));
  return <MarketingFrame onLanding={false}>
    <ContactSection form={form} headingLevel={1} source="contact_sales" />
  </MarketingFrame>;
}
