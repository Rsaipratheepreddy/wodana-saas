"use client";
import { useState } from "react";
import { Badge, Button, DataGrid, type DataGridColumn } from "@/design-system";
import { label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

const stageFields: FieldSpec[] = [
  { key: "name", label: "Stage name", required: true },
  { key: "position", label: "Order", type: "number", min: 1, required: true },
  { key: "probability", label: "Probability (%)", type: "number", min: 0, max: 100, required: true },
  { key: "forecastCategory", label: "Forecast category", options: choice(["pipeline", "best_case", "commit", "closed"]), required: true },
  ...["amount", "expectedCloseAt", "nextAction", "owner", "stakeholders"].map((key) => ({ key, label: key === "owner" ? "Require sales owner" : `Require ${label(key.replace(/([A-Z])/g, " $1")).toLowerCase()}`, type: "checkbox" as const })),
];

function stageColumns(pipeline: RecordData, edit: (action: ActionSpec) => void): DataGridColumn<RecordData>[] {
  return [
    { id: "stage", accessorFn: (stage) => `${stage.position}. ${stage.name}`, header: "Stage", size: 180, meta: { primary: true } },
    { accessorKey: "probability", header: "Probability", size: 120, cell: ({ row }) => `${row.original.probability}%` },
    { id: "requirements", accessorFn: (stage) => Object.entries((stage.entryRequirements ?? {}) as Record<string, boolean>).filter(([, enabled]) => enabled).map(([key]) => label(key.replace(/([A-Z])/g, " $1"))).join(", ") || "No additional requirements", header: "Entry requirements", size: 280 },
    { accessorKey: "status", header: "Status", size: 100, cell: ({ row }) => label(row.original.status) },
    { id: "action", header: "Action", size: 100, enableSorting: false, cell: ({ row }) => <Button size="compact" onPress={() => { const stage = row.original; edit({ title: "Edit stage", path: `pipelines/${pipeline.id}/stages/${stage.id}`, method: "PATCH", initial: { version: stage.version, name: stage.name, position: stage.position, probability: stage.probability, forecastCategory: stage.forecastCategory, status: stage.status, ...(stage.entryRequirements as Record<string, unknown>) }, fields: [...stageFields, { key: "status", label: "Status", options: choice(["active", "archived"]), required: true }], transform: stageBody }); }}>Edit stage</Button> },
  ];
}

export function PipelineSettings({ workspaceId }: { workspaceId: string }) {
  const resource = useCrmResource<unknown>(workspaceId, "pipelines");
  const [action, setAction] = useState<ActionSpec | null>(null);
  return <div className={styles.workbench}>
    <div className={styles.toolbar}><div><h3>Pipelines & stage rules</h3><p>Require the right information before an opportunity advances. Existing opportunities protect stages from accidental archival.</p></div><Button size="compact" onPress={() => setAction({ title: "Create pipeline", path: "pipelines", initial: { isDefault: !rows(resource.data).length }, fields: [{ key: "name", label: "Name", required: true }, { key: "code", label: "Unique code", required: true }, { key: "isDefault", label: "Default pipeline", type: "checkbox" }], transform: (v) => ({ ...v, stages: [
      { code: "qualified", name: "New Opportunity", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
      { code: "proposal", name: "Proposal", position: 2, probability: 50, forecastCategory: "best_case", entryRequirements: {} },
      { code: "negotiation", name: "Negotiation", position: 3, probability: 75, forecastCategory: "commit", entryRequirements: {} },
      { code: "won", name: "Won", position: 4, probability: 100, forecastCategory: "closed", entryRequirements: {} },
      { code: "lost", name: "Lost", position: 5, probability: 0, forecastCategory: "closed", entryRequirements: {} },
    ] }) })}>Create pipeline</Button></div>
    <ResourceState {...resource} retry={resource.refresh} />
    {rows(resource.data).map((pipeline) => <section className={styles.section} key={pipeline.id}>
      <div className={styles.toolbar}><h3>{String(pipeline.name)} {pipeline.isDefault ? <Badge tone="neutral">Default</Badge> : null}</h3><div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: "Edit pipeline", path: `pipelines/${pipeline.id}`, method: "PATCH", initial: { version: pipeline.version, name: pipeline.name, isDefault: pipeline.isDefault, status: pipeline.status }, fields: [{ key: "name", label: "Name", required: true }, { key: "isDefault", label: "Default pipeline", type: "checkbox" }, { key: "status", label: "Status", options: choice(["active", "archived"]), required: true }] })}>Edit pipeline</Button><Button size="compact" isDisabled={pipeline.status !== "active"} onPress={() => setAction({ title: "Add stage", path: `pipelines/${pipeline.id}/stages`, initial: { position: Math.max(0, ...((pipeline.stages ?? []) as RecordData[]).map((s) => Number(s.position))) + 1, probability: 50, forecastCategory: "pipeline" }, fields: [{ key: "code", label: "Unique stage code", required: true }, ...stageFields], transform: stageBody })}>Add stage</Button></div></div>
      <DataGrid ariaLabel={`${String(pipeline.name)} stages`} appearance="flush" columns={stageColumns(pipeline, setAction)} data={(pipeline.stages ?? []) as RecordData[]} getRowId={(stage) => String(stage.id)} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle="No stages yet" emptyDescription="Add a stage to organize this pipeline." />
    </section>)}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={resource.refresh} /> : null}
  </div>;
}

function stageBody(v: Record<string, unknown>) {
  const { amount, expectedCloseAt, nextAction, owner, stakeholders, ...rest } = v;
  return { ...rest, entryRequirements: { amount: Boolean(amount), expectedCloseAt: Boolean(expectedCloseAt), nextAction: Boolean(nextAction), owner: Boolean(owner), stakeholders: Boolean(stakeholders) } };
}
