"use client";
import { useState } from "react";
import { Button } from "@/design-system";
import { label, rows, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { ActionDialog, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

export function SequenceEditor({ workspaceId, row, onChanged }: { workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const [action, setAction] = useState<ActionSpec | null>(null);
  const templates = useCrmResource<unknown>(workspaceId, "notification-templates");
  const steps = (row.steps ?? []) as RecordData[];
  const clean = (step: RecordData) => ({ type: step.type, delayMinutes: step.delayMinutes ?? 0, configuration: step.configuration ?? {} });
  const base = { version: row.version, name: row.name, exitConditions: row.exitConditions, steps: steps.map(clean) };
  const fields: FieldSpec[] = [{ key: "type", label: t("Action"), options: choice(["task", "delay", "email", "whatsapp"]).map((option) => ({ ...option, label: translateKnown(t, option.label) })), required: true }, { key: "delayMinutes", label: t("Wait (minutes)"), type: "number", min: 0, max: 525600, required: true }, { key: "title", label: t("Task title") }, { key: "templateCode", label: t("Approved message template"), options: rows(templates.data).filter((template) => template.status === "approved").map((template) => ({ id: String(template.code), label: `${template.code} · ${translateKnown(t, label(template.channel))}` })) }];
  const stepValue = (v: Record<string, unknown>, original?: RecordData) => {
    if (v.type === "task" && !v.title) throw new Error(t("Enter the follow-up task title."));
    if (["email", "whatsapp"].includes(String(v.type)) && !v.templateCode) throw new Error(t("Choose an approved template for customer outreach."));
    return { type: v.type, delayMinutes: v.delayMinutes, configuration: { ...(original?.configuration as Record<string, unknown> ?? {}), ...(v.title ? { title: v.title } : {}), ...(v.templateCode ? { templateCode: v.templateCode } : {}) } };
  };
  return <div className={styles.stack}>
    <p>{t("Pause before editing. Publishing starts the revised follow-up plan; existing customer history is preserved.")}</p>
    {steps.map((step, index) => <section key={step.id ?? index} className={styles.section}><div className={styles.row}><div><strong>{index + 1}. {translateKnown(t, label(step.type))}</strong><small>{t("Wait {count} minutes", { count: String(step.delayMinutes ?? 0) })}{(step.configuration as RecordData)?.title ? ` · ${(step.configuration as RecordData).title}` : ""}</small></div><div className={styles.actions}><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: t("Edit sequence step"), path: `sequences/${row.id}`, method: "PATCH", initial: { type: step.type, delayMinutes: step.delayMinutes ?? 0, ...(step.configuration as Record<string, unknown>) }, fields, transform: (v) => ({ ...base, steps: steps.map((s, i) => i === index ? stepValue(v, step) : clean(s)) }) })}>{t("Edit step")}</Button><Button size="compact" isDisabled={row.status === "active" || steps.length < 2} onPress={() => setAction({ title: t("Remove sequence step"), description: t("Remove step {number} from the draft.", { number: index + 1 }), path: `sequences/${row.id}`, method: "PATCH", initial: { ...base, steps: steps.filter((_, i) => i !== index).map(clean) }, fields: [], submit: t("Remove step") })}>{t("Remove")}</Button></div></div></section>)}
    <div className={styles.actions}><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: t("Edit sequence name"), path: `sequences/${row.id}`, method: "PATCH", initial: base, fields: [{ key: "name", label: t("Name"), required: true }] })}>{t("Rename")}</Button><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: t("Add sequence step"), path: `sequences/${row.id}`, method: "PATCH", initial: { type: "task", delayMinutes: 1440 }, fields, transform: (v) => ({ ...base, steps: [...steps.map(clean), stepValue(v)] }) })}>{t("Add step")}</Button></div>
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={onChanged} /> : null}
  </div>;
}
