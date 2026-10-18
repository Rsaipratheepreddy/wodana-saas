import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateTenantPage } from "@/components/control-plane/create-tenant-page";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { consoleT, requireOperator } from "@/lib/internal/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Create tenant")} · ${t("Wodana Control")}` };
}

export default async function InternalCreateTenantPage() {
  const operator = await requireOperator();
  if (!operator.permissions.includes("tenants.provision")) redirect("/internal");
  return <OperatorShell operator={operator}><CreateTenantPage /></OperatorShell>;
}
