import { redirect } from "next/navigation";
import { LedgerSettings } from "@/components/books/settings/ledger-settings";
import { NoAccessState } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";

const READ = ["books.manage", "books.view"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settings › Ledger: per company, the chart template, dates, accounts, tax codes and payment accounts (plan §6.21b). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (!READ.some((code) => (membership.allowedPermissions ?? []).includes(code))) return <NoAccessState area={(await serverTranslator())("Ledger")} />;
  const company = (await searchParams).company;
  return <LedgerSettings workspaceId={membership.workspaceId} companyId={typeof company === "string" && UUID.test(company) ? company : null} />;
}
