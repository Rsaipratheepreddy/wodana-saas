import { cookies } from "next/headers";
import { CrmOverview } from "@/components/crm/crm-overview";
import { CrmAttachments } from "@/components/crm/crm-attachments";
import { WorkspaceHome } from "@/components/workspace/workspace-home";
import { AuditLogPage, BillingPage, CompanyProfile, IntegrationsPage, MembersPage, OrganizationStructurePage, RolesPermissionsPage, SecurityPage, WorkspaceConfigurationPage, workspaceModules, workspaceScreens } from "@/components/workspace";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { visibleWorkspaceModules } from "@/lib/workspace/module-rollout";
import { CrmCustomers, CrmOpportunities, CrmScreenPage, LeadsPage, type EnquirySection } from "@/components/crm";
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
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import styles from "./workspace-screen.module.css";
import { NoAccessState } from "@/design-system";
import { canOpen, SALES_SECTION_ACCESS } from "@/lib/workspace/access";
import { getServerT, serverTranslator } from "@/lib/i18n/server";
import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";

export default async function WorkspaceScreen({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const pathname = section?.length ? `/workspace/${section.join("/")}` : "/workspace";
  if (pathname === "/workspace") {
    const profile = await getAuthenticatedProfile();
    const membership = profile.memberships[0];
    const ownerAccess = membership?.roles.some((role) => role === "owner" || role === "administrator") ?? false;
    const allowed = ownerAccess
      ? (["workspace", "crm", "pre-project", "projects", "hrms"] as const)
      : membership?.allowedModules ?? (["workspace"] as const);
    const available = visibleWorkspaceModules(workspaceModules, membership?.workspaceSlug ?? "", allowed);
    if (!membership) redirect("/login");
    const crmEnabled = available.some(module => module.id === "crm");
    // Workspace setup progress lives in the account menu (see /api/workspace/setup-readiness), not on Home.
    const crmData = crmEnabled ? await getCrmScreenPageData("crm-overview").catch((error: unknown) => { unstable_rethrow(error); return null; }) : null;
    return <WorkspaceHome canManage={ownerAccess} workspaceId={membership.workspaceId} userId={profile.id}
      workspaceName={membership.workspaceName} modules={available.map(module => module.id)} initialData={crmData}
      firstName={profile.displayName?.trim().split(/\s+/)[0] || undefined} permissions={membership.allowedPermissions ?? undefined} />;

  }
  if (pathname === "/workspace/audit-log") redirect("/workspace/settings/audit-logs");
  if (pathname === "/workspace/security") redirect("/workspace/settings/security");
  if (pathname === "/workspace/projects/installation") redirect("/workspace/projects/site-work");
  // Workflow authoring, run history and provider setup are platform operations.
  // Tenant teams use the resulting SLA, routing and follow-up controls in their
  // normal CRM flow instead of maintaining technical automations themselves.
  if (pathname === "/workspace/crm/sequences") redirect("/workspace/crm");
  if (pathname === "/workspace/crm/automations") redirect("/workspace/crm/leads?section=automations");
  if (pathname === "/workspace/crm/leads" && (await searchParams).section === "design") redirect("/workspace/settings/design-packages");
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
    const record = query.get("record");
    if (record) state.set("record", record);
    redirect(`${PRE_PROJECT_ROOT}${state.size ? `?${state}` : ""}`);
  }

  // A page the person's role can't open says so plainly, before loading data the service would refuse.
  const membership = (await getAuthenticatedProfile()).memberships[0];
  const access = { permissions: membership?.allowedPermissions, roles: membership?.roles };
  const checkAccess = Array.isArray(membership?.allowedPermissions);
  // Sales opens on the first of its pages the person can use (Enquiries for most, the Pipeline for estimators).
  if (screen.id === "crm-overview" && checkAccess && !canOpen("leads", access)) {
    const first = [["opportunities", "/workspace/crm/opportunities"], ["follow-ups", "/workspace/crm/follow-ups"]].find(([id]) => canOpen(id, access));
    if (first) redirect(first[1]);
  }
  if (checkAccess && !canOpen(screen.id, access)) {
    const t = await serverTranslator();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
    // Named as the route map names the page (Calendar, Campaigns…), like its breadcrumb.
    return <NoAccessState area={t(resolveWorkspaceRoute(pathname, query).label as never)} />;
  }

  if (screen.id === "company") {
    const data = await getCompanyProfilePageData();
    return <CompanyProfile
      canManage={data.canManage}
      initialData={data.profile}
    />;
  }

  if (screen.id === "business-records" || screen.id === "workspace-language" || screen.id === "organizations-account") {
    const data = await getCompanyProfilePageData();
    return <WorkspaceConfigurationPage
      canManage={data.canManage}
      initialData={data.profile}
      initialTerminology={data.terminology}
      terminologyUnavailable={data.terminologyUnavailable}
      organizationAccount={data.organizationAccount}
      organizationAccountUnavailable={data.organizationAccountUnavailable}
      organizationRequests={data.organizationRequests}
      view={screen.id === "business-records" ? "legal-entities" : screen.id === "organizations-account" ? "organizations" : "language"}
    />;
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
    const callbackQuery = await searchParams;
    if ((callbackQuery.integration || callbackQuery.google) && (await cookies()).get("wodana_onboarding_connect")?.value === "1") {
      const query = new URLSearchParams();
      for (const key of ["integration", "google", "code"]) if (typeof callbackQuery[key] === "string") query.set(key, callbackQuery[key]);
      redirect(`/onboarding?${query}`);
    }
    const query = await searchParams;
    return <IntegrationsPage
      initialData={await getIntegrationsPageData()}
      connectProvider={query.connect === "google_workspace" ? "google_workspace" : undefined}
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

  if (screen.id === "crm-attachments") return <CrmAttachments initialData={await getLeadsPageData()} />;

  if (screen.id === "leads") {
    const query = await searchParams;
    const enquirySection = typeof query.section === "string" && ["forms", "sources", "options", "reports", "sla", "assignment", "automations"].includes(query.section)
      ? query.section as Exclude<EnquirySection, "leads">
      : undefined;
    // Campaigns, Reports, Settings and Automations are sections of Enquiries with rules of their own.
    const sectionItem = enquirySection ? SALES_SECTION_ACCESS[enquirySection] : undefined;
    const sectionDenied = checkAccess && Boolean(sectionItem) && !canOpen(sectionItem!, access);
    // Lead sources list the workspace's connections, which need the organization's details.
    const integrationsDenied = enquirySection === "sources" && checkAccess && !canOpen("integrations", access);
    const [leadsData, integrationsData, companyData] = await Promise.all([getLeadsPageData(), enquirySection === "sources" && !sectionDenied && !integrationsDenied ? getIntegrationsPageData().catch((error: unknown) => { unstable_rethrow(error); return undefined; }) : Promise.resolve(undefined), enquirySection === "forms" && !sectionDenied ? getCompanyProfilePageData().catch((error: unknown) => { unstable_rethrow(error); return undefined; }) : Promise.resolve(undefined)]);
    const formBranding = companyData ? { ...companyData.profile.branding, workspaceName: companyData.profile.workspace.name, canManage: companyData.canManage } : undefined;
    return <LeadsPage key={`${String(query.lead ?? "leads")}-${enquirySection ?? "leads"}`} initialCreate={query.create === "true"} initialData={leadsData} integrationsData={integrationsData} integrationsDenied={integrationsDenied} formBranding={formBranding} initialLeadId={typeof query.lead === "string" && /^[\da-f-]{36}$/i.test(query.lead) ? query.lead : undefined} initialSection={enquirySection} sectionDenied={sectionDenied} />;
  }

  // Sales opens on Enquiries; one address per view keeps the breadcrumb and tabs truthful.
  if (screen.id === "crm-overview") redirect("/workspace/crm/leads");

  if (screen.id === "opportunities") {
    const query = await searchParams;
    return <CrmOpportunities
      initialData={await getCrmScreenPageData("opportunities")}
      initialRecordId={typeof query.record === "string" && /^[\da-f-]{36}$/i.test(query.record) ? query.record : undefined}
    />;
  }

  if (screen.id === "customers") {
    const query = await searchParams;
    const view = query.type === "company" ? "organization" : query.type === "person" ? "person" : "all";
    return <CrmCustomers
      initialData={await getCrmScreenPageData("customers")}
      initialRecordId={typeof query.record === "string" && /^[\da-f-]{36}$/i.test(query.record) ? query.record : undefined}
      initialView={view}
    />;
  }

  if (screen.id === "organizations") redirect("/workspace/crm/customers?type=company");
  if (screen.id === "activities") redirect("/workspace/crm/follow-ups");
  if (screen.id === "crm-reports") redirect("/workspace/crm/leads?section=reports");

  const crmScreens = new Set<CrmScreenId>([
    "follow-ups",
    "calendar",
    "customers",
    "organizations",
    "opportunities",
    "activities",
    "conversations",
    "automations",
  ]);

  if (crmScreens.has(screen.id as CrmScreenId)) {
    const query = await searchParams;
    return <CrmScreenPage key={`${screen.id}-${query.record ?? "list"}-${query.view ?? "table"}`} initialFollowUpList={query.view === "activity"} initialCalendar={query.view === "calendar" || query.view === "schedule"} initialData={await getCrmScreenPageData(screen.id as CrmScreenId)} initialRecordId={typeof query.record === "string" && /^[\da-f-]{36}$/i.test(query.record) ? query.record : undefined} />;
  }

  const t = await getServerT();
  const label = t(screen.label as never);
  return (
    <section aria-label={t("{name} workspace", { name: label })} className={styles.screen}>
      <h1 className={styles.visuallyHidden}>{label}</h1>
    </section>
  );
}
