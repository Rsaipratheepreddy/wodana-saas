"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Breadcrumbs, Button, ErrorState, PageHeader, PageSkeleton, SelectField, Tabs, type TabItem } from "@/design-system";
import type { OperatorPermission } from "@/lib/internal/auth";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type AccountSummary, type LifecycleOverview } from "@/lib/internal/console";
import { ActivityTab } from "./activity-tab";
import { BillingTab } from "./billing-tab";
import { DomainsTab } from "./domains-tab";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import { OrganizationsTab } from "./organizations-tab";
import { OverviewTab, TransitionDialog } from "./overview-tab";
import { PlanTab } from "./plan-tab";
import { SeatsTab } from "./seats-tab";
import { SupportTab } from "./support-tab";
import styles from "./control-plane.module.css";

const TABS = ["overview", "organizations", "plan", "seats", "domains", "billing", "support", "activity"] as const;
export type AccountTab = typeof TABS[number];

/** Account inspector (§6.1): one account, its organizations, and each organization's control records. */
export function AccountPage({ accountId, permissions, operatorUserId }: { accountId: string; permissions: OperatorPermission[]; operatorUserId: string }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleOverview | null>(null);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const can = (permission: OperatorPermission) => permissions.includes(permission);

  const requestedTab = params.get("tab");
  const tab: AccountTab = (TABS as readonly string[]).includes(requestedTab ?? "") ? requestedTab as AccountTab : "overview";
  const organization = account?.organizations.find((org) => org.key === params.get("org") || org.workspaceId === params.get("org"))
    ?? account?.organizations[0] ?? null;
  const orgKey = organization?.key ?? "";

  const load = useCallback(async () => {
    try { setAccount(await consoleApi.account(accountId)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("The account didn't load.")); }
  }, [accountId, t]);
  const loadLifecycle = useCallback(async () => {
    if (!orgKey) return;
    try { setLifecycle(await consoleApi.lifecycle(orgKey)); }
    catch (cause) { setError((cause as Error).message || t("The account didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => { queueMicrotask(() => void loadLifecycle()); }, [loadLifecycle]);
  const refresh = useCallback(() => { void load(); void loadLifecycle(); }, [load, loadLifecycle]);

  const go = (next: { tab?: AccountTab; org?: string }) => {
    const query = new URLSearchParams(params.toString());
    if (next.tab) { if (next.tab === "overview") query.delete("tab"); else query.set("tab", next.tab); }
    if (next.org) query.set("org", next.org);
    router.replace(`/internal/accounts/${accountId}${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  if (error && !account) return <div className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!account || !organization) return <div className={styles.page}><PageSkeleton variant="detail" tabs={8} /></div>;
  const current = lifecycle?.workspaceId === organization.workspaceId ? lifecycle : null;
  const state = labels.state[current?.state ?? organization.state];
  const owner = labels.invitation(organization.owner.invitationStatus, organization.owner.deliveryStatus);
  const changeState = can("lifecycle.manage") && current?.nextStates.length
    ? <Button variant="primary" onPress={() => setChanging(true)}>{t("Change state")}</Button> : null;

  const items: TabItem[] = [
    { id: "overview", label: t("Overview"), panel: <OverviewTab orgKey={orgKey} organization={organization} lifecycle={current}
      permissions={permissions} onChanged={refresh} /> },
    { id: "organizations", label: t("Organizations"), panel: <OrganizationsTab account={account} selected={organization.workspaceId}
      onSelect={(key) => go({ org: key, tab: "overview" })} /> },
    { id: "plan", label: t("Plan"), panel: <PlanTab orgKey={orgKey} organization={organization} canManage={can("entitlements.manage")} /> },
    { id: "seats", label: t("Seats"), panel: <SeatsTab orgKey={orgKey} canManage={can("billing.manage")} onChanged={refresh} /> },
    { id: "domains", label: t("Domains"), panel: <DomainsTab orgKey={orgKey} canManage={can("domains.manage")} /> },
    { id: "billing", label: t("Billing"), panel: <BillingTab orgKey={orgKey} /> },
    { id: "support", label: t("Support"), panel: <SupportTab orgKey={orgKey} permissions={permissions} operatorUserId={operatorUserId} /> },
    { id: "activity", label: t("Activity"), panel: <ActivityTab accountId={accountId} notices={current?.notices ?? []} /> },
  ];

  return <div className={styles.page}>
    <Breadcrumbs items={[{ href: "/internal", label: t("Accounts") }]} />
    <PageHeader title={account.name} actions={changeState} />
    <dl className={styles.properties}>
      {account.organizations.length > 1 ? <div><dt>{t("Organization")}</dt><dd>
        <SelectField label={t("Organization")} accent="neutral" selectedKey={organization.workspaceId}
          items={account.organizations.map((org) => ({ id: org.workspaceId, label: org.name }))}
          onSelectionChange={(key) => { const next = account.organizations.find((org) => org.workspaceId === key); if (next) go({ org: next.key }); }} />
      </dd></div> : null}
      <div><dt>{t("State")}</dt><dd><Badge tone={state.tone}>{state.label}</Badge>
        {current?.state === "grace" && current.graceEndsAt ? <span className={styles.muted}>{t("Ends {date}", { date: format.date(current.graceEndsAt) })}</span> : null}
      </dd></div>
      <div><dt>{t("Address")}</dt><dd><span dir="ltr">{organization.address}</span></dd></div>
      <div><dt>{t("Plan")}</dt><dd>{organization.plan ? organization.plan.code : <span className={styles.muted}>{t("Not set")}</span>}</dd></div>
      <div><dt>{t("Seats")}</dt><dd className={styles.number}>{organization.seats.limit === null ? format.number(organization.seats.members)
        : t("{used} of {allowed}", { used: format.number(organization.seats.members), allowed: format.number(organization.seats.limit) })}</dd></div>
      <div><dt>{t("Owner")}</dt><dd>{organization.owner.email ?? <span className={styles.muted}>{t("Not invited")}</span>}
        <Badge tone={owner.tone}>{owner.label}</Badge></dd></div>
      <div><dt>{t("Created")}</dt><dd>{format.date(organization.createdAt)}</dd></div>
    </dl>
    <Tabs selectedKey={tab} onSelectionChange={(key) => go({ tab: key as AccountTab })} items={items} />
    {changing && current ? <TransitionDialog orgKey={orgKey} lifecycle={current} onClose={() => setChanging(false)}
      onDone={() => { setChanging(false); refresh(); }} /> : null}
  </div>;
}
