import { notFound, redirect } from "next/navigation";
import { FinancePage } from "@/components/finance/finance-page";
import { FINANCE_SECTIONS, type FinanceSection } from "@/lib/payables/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Finance: supplier invoices (default), payments to suppliers, what each supplier is owed, and petty cash to reimburse. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "bills";
  if (!FINANCE_SECTIONS.includes(requested as FinanceSection)) notFound();
  // A supplier opens at /workspace/finance/suppliers/<id>.
  if ((section?.length ?? 0) > (requested === "suppliers" ? 2 : 1)) notFound();
  return <FinancePage workspaceId={membership.workspaceId} section={requested as FinanceSection} supplierId={requested === "suppliers" ? section?.[1] ?? null : null} />;
}
