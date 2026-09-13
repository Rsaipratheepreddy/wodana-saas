"use client";
import { useState } from "react";
import { Badge, Button } from "@/design-system";
import { label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

const stageFields: FieldSpec[] = [
  { key: "name", label: "Stage name", required: true },
  { key: "position", label: "Order", type: "number", min: 1, required: true },
  { key: "probability", label: "Probability (%)", type: "number", min: 0, max: 100, required: true },
  { key: "forecastCategory", label: "Forecast category", options: choice(["pipeline", "best_case", "commit", "closed"]), required: true },
  ...["amount", "expectedCloseAt", "nextAction", "owner", "stakeholders"].map((key) => ({ key, label: key === "owner" ? "Require lead manager" : `Require ${label(key.replace(/([A-Z])/g, " $1")).toLowerCase()}`, type: "checkbox" as const })),
];

export function PipelineSettings({ workspaceId }: { workspaceId: string }) {
  const resource = useCrmResource<unknown>(workspaceId, "pipelines");
  const [action, setAction] = useState<ActionSpec | null>(null);
  return <div className={styles.workbench}>
    <div className={styles.toolbar}><div><h3>Pipelines & stage rules</h3><p>Require the right information before a deal advances. Existing opportunities protect stages from accidental archival.</p></div><Button size="compact" onPress={() => setAction({ title: "Create pipeline", path: "pipelines", initial: { isDefault: !rows(resource.data).length }, fields: [{ key: "name", label: "Name", required: true }, { key: "code", label: "Unique code", required: true }, { key: "isDefault", label: "Default pipeline", type: "checkbox" }], transform: (v) => ({ ...v, stages: [{ code: "qualified", name: "Qualified", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } }] }) })}>Create pipeline</Button></div>
    <ResourceState {...resource} retry={resource.refresh} />
    {rows(resource.data).map((pipeline) => <section className={styles.section} key={pipeline.id}>
      <div className={styles.toolbar}><h3>{String(pipeline.name)} {pipeline.isDefault ? <Badge tone="neutral">Default</Badge> : null}</h3><div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: "Edit pipeline", path: `pipelines/${pipeline.id}`, method: "PATCH", initial: { version: pipeline.version, name: pipeline.name, isDefault: pipeline.isDefault, status: pipeline.status }, fields: [{ key: "name", label: "Name", required: true }, { key: "isDefault", label: "Default pipeline", type: "checkbox" }, { key: "status", label: "Status", options: choice(["active", "archived"]), required: true }] })}>Edit pipeline</Button><Button size="compact" isDisabled={pipeline.status !== "active"} onPress={() => setAction({ title: "Add stage", path: `pipelines/${pipeline.id}/stages`, initial: { position: Math.max(0, ...((pipeline.stages ?? []) as RecordData[]).map((s) => Number(s.position))) + 1, probability: 50, forecastCategory: "pipeline" }, fields: [{ key: "code", label: "Unique stage code", required: true }, ...stageFields], transform: stageBody })}>Add stage</Button></div></div>
      <div className={styles.tableWrap}><table data-record-table="" className={styles.table}><thead><tr><th>Stage</th><th>Probability</th><th>Entry requirements</th><th>Status</th><th><span className="wd-sr-only">Actions</span></th></tr></thead><tbody>{((pipeline.stages ?? []) as RecordData[]).map((stage) => <tr key={stage.id}><td>{String(stage.position)}. {String(stage.name)}</td><td>{String(stage.probability)}%</td><td>{Object.entries((stage.entryRequirements ?? {}) as Record<string, boolean>).filter(([, enabled]) => enabled).map(([key]) => label(key.replace(/([A-Z])/g, " $1"))).join(", ") || "No additional requirements"}</td><td>{label(stage.status)}</td><td><Button size="compact" onPress={() => setAction({ title: "Edit stage", path: `pipelines/${pipeline.id}/stages/${stage.id}`, method: "PATCH", initial: { version: stage.version, name: stage.name, position: stage.position, probability: stage.probability, forecastCategory: stage.forecastCategory, status: stage.status, ...(stage.entryRequirements as Record<string, unknown>) }, fields: [...stageFields, { key: "status", label: "Status", options: choice(["active", "archived"]), required: true }], transform: stageBody })}>Edit stage</Button></td></tr>)}</tbody></table></div>
    </section>)}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={resource.refresh} /> : null}
  </div>;
}

function stageBody(v: Record<string, unknown>) {
  const { amount, expectedCloseAt, nextAction, owner, stakeholders, ...rest } = v;
  return { ...rest, entryRequirements: { amount: Boolean(amount), expectedCloseAt: Boolean(expectedCloseAt), nextAction: Boolean(nextAction), owner: Boolean(owner), stakeholders: Boolean(stakeholders) } };
}
