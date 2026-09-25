import { cookies } from "next/headers";
import { CrmOverview } from "@/components/crm/crm-overview";
import { CrmAttachments } from "@/components/crm/crm-attachments";
import { WorkspaceHome } from "@/components/workspace/workspace-home";
import { AuditLogPage, BillingPage, CompanyProfile, IntegrationsPage, MembersPage, OrganizationStructurePage, RolesPermissionsPage, SecurityPage, WorkspaceConfigurationPage, workspaceModules, workspaceScreens } from "@/components/workspace";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { visibleWorkspaceModules } from "@/lib/workspace/module-rollout";
import { CrmCustomers, CrmOpportunities, CrmReports, CrmScreenPage, LeadsPage, type EnquirySection } from "@/components/crm";
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
    const [crmData, setupSources] = await Promise.all([
      crmEnabled ? getCrmScreenPageData("crm-overview").catch((error: unknown) => { unstable_rethrow(error); return null; }) : Promise.resolve(null),
      ownerAccess ? Promise.allSettled([getCompanyProfilePageData(), getMembersPageData(), getIntegrationsPageData()]) : Promise.resolve(null),
    ]);
    const company = setupSources?.[0].status === "fulfilled" ? setupSources[0].value.profile : null;
    const people = setupSources?.[1].status === "fulfilled" ? setupSources[1].value : null;
    const connections = setupSources?.[2].status === "fulfilled" ? setupSources[2].value : null;
    const readiness = ownerAccess ? {
      company: company ? Boolean(company.legalEntities[0]?.registeredName && company.legalEntities[0]?.address?.line1) : null,
      regional: company ? Boolean(company.workspace.defaultCurrency && company.workspace.defaultTimezone && company.workspace.unitSystem) : null,
      people: people ? people.members.length > 1 || people.invitations.some(item => item.status === "pending") : null,
      connections: connections && !connections.loadError ? connections.connections.some(item => item.status === "connected") : null,
    } : undefined;
    return <WorkspaceHome canManage={ownerAccess} workspaceId={membership.workspaceId} userId={profile.id}
      workspaceName={membership.workspaceName} modules={available.map(module => module.id)} initialData={crmData} readiness={readiness} />;

  }
  if (pathname === "/workspace/audit-log") redirect("/workspace/settings/audit-logs");
  if (pathname === "/workspace/security") redirect("/workspace/settings/security");
  if (pathname === "/workspace/projects/installation") redirect("/workspace/projects/site-work");
  // Workflow authoring, run history and provider setup are platform operations.
  // Tenant teams use the resulting SLA, routing and follow-up controls in their
  // normal CRM flow instead of maintaining technical automations themselves.
  if (pathname === "/workspace/crm/sequences") redirect("/workspace/crm");
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
    const enquirySection = typeof query.section === "string" && ["forms", "sources", "options", "reports", "sla", "assignment"].includes(query.section)
      ? query.section as Exclude<EnquirySection, "leads">
      : undefined;
    const [leadsData, integrationsData, companyData] = await Promise.all([getLeadsPageData(), enquirySection === "sources" ? getIntegrationsPageData() : Promise.resolve(undefined), enquirySection === "forms" ? getCompanyProfilePageData().catch((error: unknown) => { unstable_rethrow(error); return undefined; }) : Promise.resolve(undefined)]);
    const formBranding = companyData ? { ...companyData.profile.branding, workspaceName: companyData.profile.workspace.name, canManage: companyData.canManage } : undefined;
    return <LeadsPage key={`${String(query.lead ?? "leads")}-${enquirySection ?? "leads"}`} initialCreate={query.create === "true"} initialData={leadsData} integrationsData={integrationsData} formBranding={formBranding} initialLeadId={typeof query.lead === "string" && /^[\da-f-]{36}$/i.test(query.lead) ? query.lead : undefined} initialSection={enquirySection} />;
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
  if (screen.id === "crm-reports") {
    return <CrmReports initialData={await getCrmScreenPageData("crm-reports")} />;
  }

  const crmScreens = new Set<CrmScreenId>([
    "follow-ups",
    "calendar",
    "customers",
    "organizations",
    "opportunities",
    "activities",
    "conversations",
    "automations",
    "crm-reports",
  ]);

  if (crmScreens.has(screen.id as CrmScreenId)) {
    const query = await searchParams;
    return <CrmScreenPage key={`${screen.id}-${query.record ?? "list"}-${query.view ?? "table"}`} initialFollowUpList={query.view === "activity"} initialCalendar={query.view === "calendar" || query.view === "schedule"} initialData={await getCrmScreenPageData(screen.id as CrmScreenId)} initialRecordId={typeof query.record === "string" && /^[\da-f-]{36}$/i.test(query.record) ? query.record : undefined} />;
  }

  return (
    <section aria-label={`${screen.label} workspace`} className={styles.screen}>
      <h1 className={styles.visuallyHidden}>{screen.label}</h1>
    </section>
  );
}
