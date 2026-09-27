"use client";

import Link from "next/link";
import { Route } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Callout, Checkbox, EmptyState, SelectField, Skeleton, Surface, Switch } from "@/design-system";
import { crmRequest, rows } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-smart-rules.module.css";

type Channel = "in_app" | "email" | "whatsapp" | "push";
type Rule = {
  code: string;
  name: string;
  description: string;
  setupHref: string;
  availableChannels: Channel[];
  enabled: boolean;
  status: string;
  version: number;
  channels: Channel[];
  weekday: string;
};

const weekdays = [
  { id: "monday", label: tKey("Monday") },
  { id: "tuesday", label: tKey("Tuesday") },
  { id: "wednesday", label: tKey("Wednesday") },
  { id: "thursday", label: tKey("Thursday") },
  { id: "friday", label: tKey("Friday") },
  { id: "saturday", label: tKey("Saturday") },
  { id: "sunday", label: tKey("Sunday") },
];

function safeSetupHref(value: unknown) {
  return typeof value === "string" && value.startsWith("/workspace/")
    ? value
    : "/workspace/crm";
}

/** Rules that belong to Sales; the rest (client decisions, project progress) live in Settings → Reminders. */
export const SALES_RULES = ["enquiry_ownership", "response_escalation"];
export const DELIVERY_RULES = ["decision_reminders", "weekly_progress"];

export function CrmSmartRules({ initialData, codes = SALES_RULES, title, embedded = false }: { initialData: CrmScreenPageData; codes?: string[]; title?: string; embedded?: boolean }) {
  const t = useT();
  const [rules, setRules] = useState(() => (initialData.items as unknown as Rule[]).filter((rule) => codes.includes(rule.code)));
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  const save = async (rule: Rule, patch: Partial<Pick<Rule, "enabled" | "channels" | "weekday">>) => {
    const next = { ...rule, ...patch };
    setSaving(rule.code);
    setFailure("");
    setRules((current) => current.map((item) => item.code === rule.code ? next : item));
    try {
      await crmRequest(initialData.workspaceId, `automation-presets/${rule.code}`, "PATCH", {
        enabled: next.enabled,
        channels: next.channels,
        weekday: next.weekday,
      });
    } catch (error) {
      setRules((current) => current.map((item) => item.code === rule.code ? rule : item));
      setFailure(error instanceof Error ? error.message : t("The smart rule could not be saved."));
    } finally {
      setSaving(null);
    }
  };

  const body = <div className={styles.page}>
      {failure ? <Callout title={t("Could not save the rule")} tone="danger">{failure}</Callout> : null}
      <section aria-label={t("Rules")} className={styles.ruleList}>
        {rules.map((rule) => <Surface as="article" className={styles.rule} key={rule.code}>
          <div className={styles.ruleCopy}>
            <span className={styles.ruleIcon}><Route aria-hidden="true" size={17} /></span>
            <div><h3>{rule.name}</h3><p>{rule.description}</p><Link href={safeSetupHref(rule.setupHref)}>{t("Review settings")}</Link></div>
          </div>
          <div className={styles.ruleControls}>
            {rule.code === "weekly_progress" ? <>
              <SelectField aria-label={t("Weekly progress day")} isDisabled={saving === rule.code} items={weekdays.map((day) => ({ ...day, label: t(day.label) }))} label={t("Send on")} onSelectionChange={(key) => key && void save(rule, { weekday: String(key) })} selectedKey={rule.weekday} />
              <Checkbox isDisabled={saving === rule.code} isSelected={rule.channels.includes("email")} onChange={(selected) => void save(rule, { channels: selected ? ["in_app", "email"] : ["in_app"] })}>{t("Email opted-in team members")}</Checkbox>
            </> : null}
            <Switch aria-label={rule.enabled ? t("Turn off {name}", { name: rule.name }) : t("Turn on {name}", { name: rule.name })} isDisabled={saving === rule.code} isSelected={rule.enabled} onChange={(enabled) => void save(rule, { enabled })}>{saving === rule.code ? t("Saving") : rule.enabled ? t("On") : t("Off")}</Switch>
          </div>
        </Surface>)}
      </section>
    </div>;
  return embedded ? body : <CrmProductShell title={title ?? t("Automations")} description="" canView={initialData.canView} useWorkspaceColors>{body}</CrmProductShell>;
}

/** Sales → Settings → Automations, inside the Sales page like the other settings tabs. */
export function SalesAutomations({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<CrmScreenPageData | null>(null);
  const [failure, setFailure] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<unknown>(workspaceId, "automation-presets", "GET", undefined, controller.signal)
      .then((payload) => { setData({ canView: true, id: "automations", items: rows(payload) as CrmScreenPageData["items"], nextCursor: null, referenceTime: new Date().toISOString(), supporting: {}, workspaceId }); setFailure(""); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, reload]);
  if (failure) return <EmptyState illustration="error" title={t("Automations didn't load")} description={failure} action={<Button size="compact" onPress={() => setReload((value) => value + 1)}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={3} />;
  return <CrmSmartRules initialData={data} embedded />;
}
