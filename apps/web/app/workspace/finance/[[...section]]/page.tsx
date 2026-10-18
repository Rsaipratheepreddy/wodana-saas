import { notFound, redirect } from "next/navigation";
import { FinancePage } from "@/components/finance/finance-page";
import { NoAccessState } from "@/design-system";
import { FINANCE_SECTIONS, type FinanceSection } from "@/lib/payables/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";
import { FINANCE_TAB_ACCESS, meetsRule } from "@/lib/workspace/access";

/** Finance: supplier invoices (default), payments to suppliers, what each supplier is owed, and petty cash to reimburse. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  // Only the tabs whose records the person's role can read; older sessions without a permission list keep them all.
  const access = { permissions: membership.allowedPermissions, roles: membership.roles };
  const sections = FINANCE_SECTIONS.filter((item) => !Array.isArray(membership.allowedPermissions) || meetsRule(FINANCE_TAB_ACCESS[item], access));
  if (!sections.length) return <NoAccessState area={(await serverTranslator())("Finance")} />;
  const requested = section?.[0] ?? sections[0];
  if (!FINANCE_SECTIONS.includes(requested as FinanceSection)) notFound();
  if (!sections.includes(requested as FinanceSection)) redirect(sections[0] === "bills" ? "/workspace/finance" : `/workspace/finance/${sections[0]}`);
  // A supplier opens at /workspace/finance/suppliers/<id>.
  if ((section?.length ?? 0) > (requested === "suppliers" ? 2 : 1)) notFound();
  return <FinancePage workspaceId={membership.workspaceId} section={requested as FinanceSection} sections={sections} supplierId={requested === "suppliers" ? section?.[1] ?? null : null} />;
}
