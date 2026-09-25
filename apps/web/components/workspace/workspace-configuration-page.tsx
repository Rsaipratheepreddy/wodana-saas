"use client";

import { useState } from "react";
import { DesignSystemProvider, SettingsPage } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
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
  const t = useT();
  const content = copy[view];

  return <DesignSystemProvider className={styles.provider} currency={initialData.workspace.defaultCurrency} locale={initialData.workspace.defaultLocale} timeZone={initialData.workspace.defaultTimezone}>
    <SettingsPage aria-label={content.title} title={view === "legal-entities" ? t("Business records") : view === "language" ? t("Workspace language") : t("Manage workspaces")}>
      <div className={styles.content}>
        {view === "legal-entities" ? <LegalEntitiesPanel canManage={canManage} initialEntities={entities} onChange={setEntities} standalone workspace={initialData.workspace} /> : null}
        {view === "language" ? <TerminologyPanel canManage={canManage} data={terminology} onChange={setTerminology} standalone unavailable={terminologyUnavailable} workspaceId={initialData.workspace.id} /> : null}
        {view === "organizations" ? <OrganizationAccountPanel account={organizationAccount} canManage={canManage} initialRequests={organizationRequests} profile={initialData} standalone unavailable={organizationAccountUnavailable} /> : null}
      </div>
    </SettingsPage>
  </DesignSystemProvider>;
}
