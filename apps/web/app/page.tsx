import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";
import { classifyTenantHost } from "@/lib/auth/tenant-host";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("Wodana — One connected flow for interior businesses"),
    description: t("Run enquiries, planning, quotations, project delivery, people, and client handover in one connected Wodana workspace."),
  };
}

export default async function Home() {
  const host = (await headers()).get("host");
  const route = classifyTenantHost(host);
  if (route.kind === "invalid") notFound();
  if (route.kind !== "generic") redirect("/login");
  return <LandingPage />;
}
