import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";
import { classifyTenantHost } from "@/lib/auth/tenant-host";
import { businessApiUrl } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { loadPublicSalesForm } from "@/lib/sales/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("Wodana — every job, from enquiry to handover"),
    description: t("Wodana runs sales, projects, purchasing and site work for interior and fit-out firms."),
  };
}

export default async function Home() {
  const host = (await headers()).get("host");
  const route = classifyTenantHost(host);
  if (route.kind === "invalid") notFound();
  if (route.kind !== "generic") redirect("/login");
  const form = await loadPublicSalesForm(businessApiUrl("/public/sales/contact-form"));
  return <LandingPage form={form} />;
}
