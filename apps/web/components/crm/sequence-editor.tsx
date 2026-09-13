"use client";
import { useState } from "react";
import { Button } from "@/design-system";
import { label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

export function SequenceEditor({ workspaceId, row, onChanged }: { workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const [action, setAction] = useState<ActionSpec | null>(null);
  const templates = useCrmResource<unknown>(workspaceId, "notification-templates");
  const steps = (row.steps ?? []) as RecordData[];
  const clean = (step: RecordData) => ({ type: step.type, delayMinutes: step.delayMinutes ?? 0, configuration: step.configuration ?? {} });
  const base = { version: row.version, name: row.name, exitConditions: row.exitConditions, steps: steps.map(clean) };
  const fields: FieldSpec[] = [{ key: "type", label: "Action", options: choice(["task", "delay", "email", "whatsapp"]), required: true }, { key: "delayMinutes", label: "Wait (minutes)", type: "number", min: 0, max: 525600, required: true }, { key: "title", label: "Task title" }, { key: "templateCode", label: "Approved message template", options: rows(templates.data).filter((template) => template.status === "approved").map((template) => ({ id: String(template.code), label: `${template.code} · ${label(template.channel)}` })) }];
  const stepValue = (v: Record<string, unknown>, original?: RecordData) => {
    if (v.type === "task" && !v.title) throw new Error("Enter the follow-up task title.");
    if (["email", "whatsapp"].includes(String(v.type)) && !v.templateCode) throw new Error("Choose an approved template for customer outreach.");
    return { type: v.type, delayMinutes: v.delayMinutes, configuration: { ...(original?.configuration as Record<string, unknown> ?? {}), ...(v.title ? { title: v.title } : {}), ...(v.templateCode ? { templateCode: v.templateCode } : {}) } };
  };
  return <div className={styles.stack}>
    <p>Pause before editing. Publishing starts the revised follow-up plan; existing customer history is preserved.</p>
    {steps.map((step, index) => <section key={step.id ?? index} className={styles.section}><div className={styles.row}><div><strong>{index + 1}. {label(step.type)}</strong><small>Wait {String(step.delayMinutes ?? 0)} minutes{(step.configuration as RecordData)?.title ? ` · ${(step.configuration as RecordData).title}` : ""}</small></div><div className={styles.actions}><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: "Edit sequence step", path: `sequences/${row.id}`, method: "PATCH", initial: { type: step.type, delayMinutes: step.delayMinutes ?? 0, ...(step.configuration as Record<string, unknown>) }, fields, transform: (v) => ({ ...base, steps: steps.map((s, i) => i === index ? stepValue(v, step) : clean(s)) }) })}>Edit step</Button><Button size="compact" isDisabled={row.status === "active" || steps.length < 2} onPress={() => setAction({ title: "Remove sequence step", description: `Remove step ${index + 1} from the draft.`, path: `sequences/${row.id}`, method: "PATCH", initial: { ...base, steps: steps.filter((_, i) => i !== index).map(clean) }, fields: [], submit: "Remove step" })}>Remove</Button></div></div></section>)}
    <div className={styles.actions}><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: "Edit sequence name", path: `sequences/${row.id}`, method: "PATCH", initial: base, fields: [{ key: "name", label: "Name", required: true }] })}>Rename</Button><Button size="compact" isDisabled={row.status === "active"} onPress={() => setAction({ title: "Add sequence step", path: `sequences/${row.id}`, method: "PATCH", initial: { type: "task", delayMinutes: 1440 }, fields, transform: (v) => ({ ...base, steps: [...steps.map(clean), stepValue(v)] }) })}>Add step</Button></div>
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={onChanged} /> : null}
  </div>;
}
