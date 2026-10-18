"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, ControlledModalDialog, ErrorState, InlineNotice, Skeleton, Switch, TextAreaField, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type AccountOrganization, type TenantBillingOverview, type TenantModuleCode, type TenantOperationsOverview } from "@/lib/internal/console";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

const MODULES: TenantModuleCode[] = ["workspace", "crm", "pre-project", "projects", "hrms"];

/**
 * Plan and modules. A module turned off keeps its data; the product hides it and the API refuses it with
 * "This module is not included for the organization" (403) until it is turned on again.
 */
export function PlanTab({ orgKey, organization, canManage }: { orgKey: string; organization: AccountOrganization; canManage: boolean }) {
  const t = useT();
  const format = useConsoleFormat();
  const [overview, setOverview] = useState<TenantOperationsOverview | null>(null);
  const [billing, setBilling] = useState<TenantBillingOverview | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Set<TenantModuleCode> | null>(null);
  const [saving, setSaving] = useState(false);
  const moduleLabel: Record<TenantModuleCode, string> = {
    workspace: t("Workspace"), crm: t("CRM"), "pre-project": t("Planning"), projects: t("Projects"), hrms: t("People"),
  };

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextBilling] = await Promise.all([consoleApi.operations(orgKey), consoleApi.billing(orgKey).catch(() => null)]);
      setOverview(nextOverview); setBilling(nextBilling); setDraft(null); setError("");
    } catch (cause) { setError((cause as Error).message || t("The plan didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const entitlement = overview?.entitlements;
  const versioned = billing && "planCode" in billing.contract ? billing.contract : null;
  const contract = organization.contract;
  const enabled = useMemo(() => new Set<TenantModuleCode>(entitlement?.status === "active" || entitlement?.status === "scheduled"
    ? ["workspace", ...(entitlement.modules ?? [])] : entitlement?.status === "not_configured" ? MODULES : ["workspace"]), [entitlement]);
  const sold = new Set<TenantModuleCode>(entitlement?.soldModules?.length ? entitlement.soldModules : MODULES);
  const selected = draft ?? enabled;
  const removed = MODULES.filter((module) => enabled.has(module) && !selected.has(module));
  const changed = MODULES.some((module) => enabled.has(module) !== selected.has(module));
  const planCode = entitlement?.planCode ?? organization.plan?.code ?? null;
  const planVersion = entitlement?.planVersion ?? organization.plan?.version ?? null;

  if (error && !overview) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!overview) return <div className={styles.panel}><Skeleton shape="facts" lines={4} /></div>;
  return <div className={styles.panel}>
    <dl className={styles.properties}>
      <div><dt>{t("Contract")}</dt><dd>{contract ? <Badge tone={contract.status === "contracted" ? "success" : contract.status === "expired" ? "danger" : "info"}>
        {contract.status === "contracted" ? t("Signed") : contract.status === "expired" ? t("Expired") : t("Trial")}</Badge> : <span className={styles.muted}>{t("Not set")}</span>}</dd></div>
      {contract?.trialEndsAt ? <div><dt>{t("Trial ends")}</dt><dd>{format.date(contract.trialEndsAt)}</dd></div> : null}
      {versioned ? <div><dt>{t("Price")}</dt><dd>{format.money(versioned.recurringAmount, versioned.currency)}</dd></div> : null}
    </dl>
    <section className={styles.section} aria-label={t("Modules")}>
      <div className={styles.sectionHead}>
        <h2 className={styles.subhead}>{t("Modules")}</h2>
        {canManage ? <Button size="compact" variant="primary" isDisabled={!changed} onPress={() => setSaving(true)}>{t("Save")}</Button> : null}
      </div>
      <div className={styles.switches}>
        {MODULES.map((module) => <Switch key={module} isSelected={selected.has(module)}
          isDisabled={!canManage || module === "workspace" || (!sold.has(module) && !selected.has(module))}
          onChange={(on) => setDraft(() => { const next = new Set(selected); if (on) next.add(module); else next.delete(module); return next; })}>
          {moduleLabel[module]}{!sold.has(module) ? <span className={styles.muted}> · {t("Not in plan")}</span> : null}
        </Switch>)}
      </div>
    </section>
    {saving && planCode && planVersion ? <ModulesDialog removed={removed.map((module) => moduleLabel[module])} onClose={() => setSaving(false)}
      onSave={async (reason) => {
        await consoleApi.updateEntitlements(orgKey, { expectedVersion: entitlement?.version ?? 0, planCode, planVersion, status: "active",
          modules: MODULES.filter((module) => selected.has(module)), limits: {}, reason });
        setSaving(false); await load();
      }} /> : null}
    {saving && (!planCode || !planVersion) ? <ControlledModalDialog isOpen size="md" title={t("Modules")} onOpenChange={(open) => { if (!open) setSaving(false); }}
      footer={<div className="wd-dialog-actions"><Button onPress={() => setSaving(false)}>{t("Close")}</Button></div>}>
      <InlineNotice tone="error" message={t("Set the account's plan before choosing modules.")} />
    </ControlledModalDialog> : null}
  </div>;
}

function ModulesDialog({ removed, onClose, onSave }: { removed: string[]; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return <FormDialog size="md" title={t("Change modules")} onClose={onClose} error={error || undefined} isSubmitDisabled={reason.trim().length < 10} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave(reason.trim()); } catch (cause) { setError((cause as Error).message || t("The modules could not be saved.")); }
        finally { }
      }}>
      {removed.length ? <Callout tone="warning" title={t("Turning off {modules}", { modules: removed.join(", ") })}>
        {t("Their data stays. People lose access until they're turned on again.")}</Callout> : null}
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} description={t("At least 10 characters.")} />
  </FormDialog>;
}
