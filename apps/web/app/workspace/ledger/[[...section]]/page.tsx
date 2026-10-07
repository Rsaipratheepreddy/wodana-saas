import { notFound, redirect } from "next/navigation";
import { LedgerArea } from "@/components/books/reports/ledger-area";
import { NoAccessState } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { LEDGER_REPORTS, LEDGER_SECTIONS, type LedgerSection } from "@/lib/books/reports-client";
import { serverTranslator } from "@/lib/i18n/server";
import { canOpen } from "@/lib/workspace/access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Ledger (engine books, plan §6.21b): Overview · Reports · Journals · Accounts · Needs attention.
 * /workspace/ledger/reports/<report>, /accounts/<account> (its ledger) and /journals/<journal> (its sheet) are the
 * drill-down addresses; the company and period are in the query (?entity=&from=&to=).
 */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (!canOpen("ledger", { permissions: membership.allowedPermissions, roles: membership.roles })) return <NoAccessState area={(await serverTranslator())("Ledger")} />;
  const [first = "overview", sub, ...rest] = section ?? [];
  if (rest.length || !(LEDGER_SECTIONS as readonly string[]).includes(first) || (first === "overview" && section?.length)) notFound();
  const area = first as LedgerSection;
  if (sub !== undefined) {
    const valid = area === "reports" ? (LEDGER_REPORTS as readonly string[]).includes(sub) : (area === "journals" || area === "accounts") && UUID.test(sub);
    if (!valid) notFound();
  }
  return <LedgerArea workspaceId={membership.workspaceId} section={area} sub={sub ?? null} />;
}
