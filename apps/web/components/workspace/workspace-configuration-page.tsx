"use client";

import { useState } from "react";
import { DesignSystemProvider } from "@/design-system";
import type { CompanyProfileData, LegalEntityRecord, WorkspaceTerminologyData } from "@/lib/workspace/company-profile";
import { LegalEntitiesPanel } from "./legal-entities-panel";
import { OrganizationAccountPanel } from "./organization-account-panel";
import { TerminologyPanel } from "./terminology-panel";
import type { CustomerAccount, OrganizationRequest } from "@/lib/workspace/customer-account";
import styles from "./workspace-configuration-page.module.css";

type ConfigurationView = "legal-entities" | "language" | "organizations";

const copy: Record<ConfigurationView, { title: string }> = {
  "legal-entities": {
    title: "Business records",
  },
  language: {
    title: "Workspace language",
  },
  organizations: {
    title: "Manage workspaces",
  },
};

export function WorkspaceConfigurationPage({
  canManage,
  initialData,
  initialTerminology,
  organizationAccount = null,
  organizationAccountUnavailable = false,
  organizationRequests = [],
  terminologyUnavailable,
  view,
}: {
  canManage: boolean;
  initialData: CompanyProfileData;
  initialTerminology: WorkspaceTerminologyData | null;
  organizationAccount?: CustomerAccount | null;
  organizationAccountUnavailable?: boolean;
  organizationRequests?: OrganizationRequest[];
  terminologyUnavailable?: boolean;
  view: ConfigurationView;
}) {
  const [entities, setEntities] = useState<LegalEntityRecord[]>(initialData.legalEntities);
  const [terminology, setTerminology] = useState(initialTerminology);
  const content = copy[view];

  return <DesignSystemProvider className={styles.provider} currency={initialData.workspace.defaultCurrency} locale={initialData.workspace.defaultLocale} timeZone={initialData.workspace.defaultTimezone}>
    <section aria-label={content.title} className={styles.page}>
      <h1 className="wd-visually-hidden">{content.title}</h1>
      <div className={styles.content}>
        {view === "legal-entities" ? <LegalEntitiesPanel canManage={canManage} initialEntities={entities} onChange={setEntities} standalone workspace={initialData.workspace} /> : null}
        {view === "language" ? <TerminologyPanel canManage={canManage} data={terminology} onChange={setTerminology} standalone unavailable={terminologyUnavailable} workspaceId={initialData.workspace.id} /> : null}
        {view === "organizations" ? <OrganizationAccountPanel account={organizationAccount} canManage={canManage} initialRequests={organizationRequests} profile={initialData} standalone unavailable={organizationAccountUnavailable} /> : null}
      </div>
    </section>
  </DesignSystemProvider>;
}
