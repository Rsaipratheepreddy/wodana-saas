"use client";

import Link from "next/link";
import { BellRing, CheckCircle2, Mail, MessageCircle, MonitorSmartphone, Route, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge, Callout, Checkbox, SelectField, Surface, Switch } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
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
type Provider = {
  channel: Channel;
  connected: boolean;
  delivered: number;
  failed: number;
  lastDeliveredAt: string | null;
  pricing: string;
  receiptState: "built_in" | "verified" | "awaiting_test_receipt" | "not_connected";
};

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
  .map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)}` }));
const providerCopy: Record<Channel, { label: string; Icon: typeof BellRing }> = {
  in_app: { label: "In-app", Icon: BellRing },
  email: { label: "Email", Icon: Mail },
  whatsapp: { label: "WhatsApp", Icon: MessageCircle },
  push: { label: "Mobile push", Icon: MonitorSmartphone },
};

function providerStatus(provider: Provider) {
  if (provider.receiptState === "built_in") return { label: "Built in", tone: "success" as const };
  if (provider.receiptState === "verified") return { label: "Delivery verified", tone: "success" as const };
  if (provider.receiptState === "awaiting_test_receipt") return { label: "Needs delivery test", tone: "warning" as const };
  return { label: "Not connected", tone: "neutral" as const };
}

function safeSetupHref(value: unknown) {
  return typeof value === "string" && value.startsWith("/workspace/")
    ? value
    : "/workspace/crm";
}

export function CrmSmartRules({ initialData }: { initialData: CrmScreenPageData }) {
  const [rules, setRules] = useState(initialData.items as unknown as Rule[]);
  const providers = (initialData.supporting.providers ?? []) as Provider[];
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
      setFailure(error instanceof Error ? error.message : "The smart rule could not be saved.");
    } finally {
      setSaving(null);
    }
  };

  return <CrmProductShell
    title="Smart rules"
    description="Turn on the everyday follow-through your team needs. Wodana keeps the technical workflow details out of the way."
    canView={initialData.canView}
    useWorkspaceColors
  >
    <div className={styles.page}>
      {failure ? <Callout title="Could not save the rule" tone="danger">{failure}</Callout> : null}
      <section aria-labelledby="smart-rules-heading" className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><h2 id="smart-rules-heading">Rules</h2><p>Each rule uses the settings already defined in its linked workspace area.</p></div>
          <Badge tone="info"><ShieldCheck size={13} /> Permission controlled</Badge>
        </div>
        <div className={styles.ruleList}>
          {rules.map((rule) => <Surface as="article" className={styles.rule} key={rule.code}>
            <div className={styles.ruleCopy}>
              <span className={styles.ruleIcon}><Route aria-hidden="true" size={17} /></span>
              <div><h3>{rule.name}</h3><p>{rule.description}</p><Link href={safeSetupHref(rule.setupHref)}>Review settings</Link></div>
            </div>
            <div className={styles.ruleControls}>
              {rule.code === "weekly_progress" ? <>
                <SelectField
                  aria-label="Weekly progress day"
                  isDisabled={saving === rule.code}
                  items={weekdays}
                  label="Send on"
                  onSelectionChange={(key) => key && void save(rule, { weekday: String(key) })}
                  selectedKey={rule.weekday}
                />
                <Checkbox
                  isDisabled={saving === rule.code}
                  isSelected={rule.channels.includes("email")}
                  onChange={(selected) => void save(rule, { channels: selected ? ["in_app", "email"] : ["in_app"] })}
                >Email opted-in team members</Checkbox>
              </> : null}
              <Switch
                aria-label={`${rule.enabled ? "Turn off" : "Turn on"} ${rule.name}`}
                isDisabled={saving === rule.code}
                isSelected={rule.enabled}
                onChange={(enabled) => void save(rule, { enabled })}
              >{saving === rule.code ? "Saving" : rule.enabled ? "On" : "Off"}</Switch>
            </div>
          </Surface>)}
        </div>
      </section>

      <section aria-labelledby="delivery-heading" className={styles.section}>
        <div className={styles.sectionHeading}><div><h2 id="delivery-heading">Delivery channels</h2><p>A connection is not marked verified until Wodana records a successful delivery receipt.</p></div></div>
        <div className={styles.providerGrid}>
          {providers.map((provider) => {
            const { Icon, label } = providerCopy[provider.channel];
            const status = providerStatus(provider);
            return <Surface as="article" className={styles.provider} key={provider.channel} tone="subtle">
              <div className={styles.providerTitle}><span><Icon aria-hidden="true" size={16} />{label}</span><Badge tone={status.tone}>{status.label}</Badge></div>
              <p>{provider.pricing}</p>
              {provider.receiptState === "built_in" ? <small><CheckCircle2 aria-hidden="true" size={13} /> Delivered inside the workspace.</small> : provider.lastDeliveredAt ? <small><CheckCircle2 aria-hidden="true" size={13} /> Last verified {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(provider.lastDeliveredAt))}</small> : <small>No successful provider receipt recorded yet.</small>}
            </Surface>;
          })}
        </div>
      </section>
    </div>
  </CrmProductShell>;
}
