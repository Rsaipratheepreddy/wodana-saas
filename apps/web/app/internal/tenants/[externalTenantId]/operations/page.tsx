import { redirect } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { getOperatorSession } from "@/lib/internal/auth";

/** The organization's controls moved into its account record; old links land there. */
export default async function OperationsPage(context: { params: Promise<{ externalTenantId: string }> }) {
  const session = await getOperatorSession();
  if (!session) redirect("/internal/sign-in");
  const { externalTenantId } = await context.params;
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  const response = token ? await fetch(businessApiUrl("/internal/operator/accounts"), {
    headers: { "x-wodana-internal-token": token, "x-wodana-operator-session": session.token }, cache: "no-store",
  }).catch(() => null) : null;
  const listed = response?.ok ? await response.json().catch(() => null) as { accounts?: Array<{ id: string; organizations: Array<{ key: string; workspaceId: string }> }> } | null : null;
  const account = listed?.accounts?.find((item) => item.organizations.some((org) => org.key === externalTenantId || org.workspaceId === externalTenantId));
  redirect(account ? `/internal/accounts/${account.id}?org=${encodeURIComponent(externalTenantId)}` : "/internal");
}
