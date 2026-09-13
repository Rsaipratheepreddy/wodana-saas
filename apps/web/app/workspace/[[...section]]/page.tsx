import { AuditLogPage, BillingPage, CompanyProfile, IntegrationsPage, MembersPage, OrganizationStructurePage, RolesPermissionsPage, SecurityPage, workspaceScreens } from "@/components/workspace";
import { CrmScreenPage, LeadsPage } from "@/components/crm";
import { PRE_PROJECT_ROOT, listSearch } from "@/lib/pre-project/types";
import { getPreProjectRedirect } from "@/lib/pre-project/routes";
import { getLeadsPageData } from "@/lib/crm/leads.server";
import { getCrmScreenPageData } from "@/lib/crm/screens.server";
import type { CrmScreenId } from "@/lib/crm/screens";
import { getAuditLogPageData } from "@/lib/workspace/audit-log.server";
import { getCompanyProfilePageData } from "@/lib/workspace/company-profile.server";
import { getMembersPageData } from "@/lib/workspace/members.server";
import { getOrganizationStructurePageData } from "@/lib/workspace/organization-structure.server";
import { getRolesPermissionsPageData } from "@/lib/workspace/roles-permissions.server";
import { getIntegrationsPageData } from "@/lib/workspace/integrations.server";
import { getSecurityPageData } from "@/lib/workspace/security.server";
import { getBillingPageData } from "@/lib/workspace/billing.server";
import { notFound, redirect } from "next/navigation";
import styles from "./workspace-screen.module.css";

export default async function WorkspaceScreen({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const pathname = section?.length ? `/workspace/${section.join("/")}` : "/workspace";
  if (pathname === "/workspace/audit-log") redirect("/workspace/settings/audit-logs");
  if (pathname === "/workspace/security") redirect("/workspace/settings/security");
  if (pathname === "/workspace/projects/installation") redirect("/workspace/projects/site-work");
  if (getPreProjectRedirect(pathname)) {
    redirect(getPreProjectRedirect(pathname, await searchParams)!);
  }
  const screen = workspaceScreens.find((item) => item.href === pathname);

  if (!screen) notFound();

  if (pathname === "/workspace/pre-projects" || pathname.startsWith("/workspace/pre-projects/")) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
    query.set("section", pathname.split("/").at(-1) ?? "overview");
    const state = listSearch(query);
    redirect(`${PRE_PROJECT_ROOT}${state.size ? `?${state}` : ""}`);
  }

  if (screen.id === "company") {
    const { canManage, profile } = await getCompanyProfilePageData();
    return <CompanyProfile canManage={canManage} initialData={profile} />;
  }

  if (screen.id === "members") {
    return <MembersPage initialData={await getMembersPageData()} />;
  }

  if (screen.id === "teams") {
    return <OrganizationStructurePage initialData={await getOrganizationStructurePageData()} />;
  }

  if (screen.id === "roles") {
    return <RolesPermissionsPage initialData={await getRolesPermissionsPageData()} />;
  }

  if (screen.id === "integrations") {
    const query = await searchParams;
    return <IntegrationsPage
      initialData={await getIntegrationsPageData()}
      oauthResult={{
        code: typeof query.code === "string" ? query.code : undefined,
        result: typeof query.integration === "string" ? query.integration : typeof query.google === "string" ? query.google : undefined,
      }}
    />;
  }

  if (screen.id === "audit-log") {
    return <AuditLogPage initialData={await getAuditLogPageData()} />;
  }

  if (screen.id === "security") {
    return <SecurityPage initialData={await getSecurityPageData()} />;
  }

  if (screen.id === "billing") {
    return <BillingPage data={await getBillingPageData()} />;
  }

  if (screen.id === "leads") {
    const query = await searchParams;
    return <LeadsPage key={String(query.lead ?? "leads")} initialCreate={query.create === "true"} initialData={await getLeadsPageData()} initialLeadId={typeof query.lead === "string" && /^[\da-f-]{36}$/i.test(query.lead) ? query.lead : undefined} />;
  }

  const crmScreens = new Set<CrmScreenId>([
    "crm-overview",
    "follow-ups",
    "calendar",
    "customers",
    "organizations",
    "opportunities",
    "activities",
    "conversations",
    "sequences",
    "automations",
    "crm-reports",
  ]);

  if (crmScreens.has(screen.id as CrmScreenId)) {
    const query = await searchParams;
    return <CrmScreenPage key={`${screen.id}-${query.record ?? "list"}-${query.view ?? "table"}`} initialCalendar={query.view === "calendar"} initialData={await getCrmScreenPageData(screen.id as CrmScreenId)} initialRecordId={typeof query.record === "string" && /^[\da-f-]{36}$/i.test(query.record) ? query.record : undefined} />;
  }

  return (
    <section aria-label={`${screen.label} workspace`} className={styles.screen}>
      <h1 className={styles.visuallyHidden}>{screen.label}</h1>
    </section>
  );
}
