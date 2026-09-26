import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";
import { classifyTenantHost } from "@/lib/auth/tenant-host";

export const metadata: Metadata = {
  title: "Wodana — One connected flow for interior businesses",
  description: "Run enquiries, planning, quotations, project delivery, people, and client handover in one connected Wodana workspace.",
};

export default async function Home() {
  const host = (await headers()).get("host");
  const route = classifyTenantHost(host);
  if (route.kind === "invalid") notFound();
  if (route.kind !== "generic") redirect("/login");
  return <LandingPage />;
}
