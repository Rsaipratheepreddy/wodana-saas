import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/internal/auth";
import { TenantOperationsPage } from "./tenant-operations-page";

export const metadata: Metadata = { title: "Tenant operations · Wodana Control" };

export default async function OperationsPage(context: { params: Promise<{ externalTenantId: string }> }) {
  const session = await getOperatorSession();
  if (!session) redirect("/internal/sign-in");
  const { externalTenantId } = await context.params;
  return <TenantOperationsPage externalTenantId={externalTenantId} permissions={session.operator.permissions} />;
}
