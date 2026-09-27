"use client";
import { useState } from "react";
import { Badge, Button, DataGrid, type DataGridColumn } from "@/design-system";
import { label, rows, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

const REQUIREMENTS: Array<[string, MessageKey, MessageKey]> = [
  ["amount", tKey("Amount"), tKey("Require amount")],
  ["expectedCloseAt", tKey("Expected close at"), tKey("Require expected close at")],
  ["nextAction", tKey("Next action"), tKey("Require next action")],
  ["owner", tKey("Owner"), tKey("Require sales owner")],
  ["stakeholders", tKey("Stakeholders"), tKey("Require stakeholders")],
  ["discovery", tKey("Discovery"), tKey("Require discovery")],
];
const translatedChoice = (t: Translate, values: string[]) => choice(values).map((option) => ({ ...option, label: translateKnown(t, option.label) }));
const stageFields = (t: Translate): FieldSpec[] => [
  { key: "name", label: t("Stage name"), required: true },
  { key: "position", label: t("Order"), type: "number", min: 1, required: true },
  { key: "probability", label: t("Probability (%)"), type: "number", min: 0, max: 100, required: true },
  { key: "forecastCategory", label: t("Forecast category"), options: translatedChoice(t, ["pipeline", "best_case", "commit", "closed"]), required: true },
  ...REQUIREMENTS.map(([key, , require]) => ({ key, label: t(require), type: "checkbox" as const })),
];

function stageColumns(pipeline: RecordData, edit: (action: ActionSpec) => void, t: Translate): DataGridColumn<RecordData>[] {
  const requirement = (key: string) => { const known = REQUIREMENTS.find(([id]) => id === key); return known ? t(known[1]) : label(key.replace(/([A-Z])/g, " $1")); };
  return [
    { id: "stage", accessorFn: (stage) => `${stage.position}. ${stage.name}`, header: t("Stage"), size: 180, meta: { primary: true } },
    { accessorKey: "probability", header: t("Probability"), size: 120, cell: ({ row }) => `${row.original.probability}%` },
    { id: "requirements", accessorFn: (stage) => Object.entries((stage.entryRequirements ?? {}) as Record<string, boolean>).filter(([, enabled]) => enabled).map(([key]) => requirement(key)).join(", ") || t("No additional requirements"), header: t("Entry requirements"), size: 280 },
    { accessorKey: "status", header: t("Status"), size: 100, cell: ({ row }) => translateKnown(t, label(row.original.status)) },
    { id: "action", header: t("Action"), size: 100, enableSorting: false, cell: ({ row }) => <Button size="compact" onPress={() => { const stage = row.original; edit({ title: t("Edit stage"), path: `pipelines/${pipeline.id}/stages/${stage.id}`, method: "PATCH", initial: { version: stage.version, name: stage.name, position: stage.position, probability: stage.probability, forecastCategory: stage.forecastCategory, status: stage.status, ...(stage.entryRequirements as Record<string, unknown>) }, fields: [...stageFields(t), { key: "status", label: t("Status"), options: translatedChoice(t, ["active", "archived"]), required: true }], transform: stageBody }); }}>{t("Edit stage")}</Button> },
  ];
}

export function PipelineSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const resource = useCrmResource<unknown>(workspaceId, "pipelines");
  const [action, setAction] = useState<ActionSpec | null>(null);
  return <div className={styles.workbench}>
    <div className={styles.toolbar}><div><h3>{t("Pipelines & stage rules")}</h3><p>{t("Require the right information before an opportunity advances. Existing opportunities protect stages from accidental archival.")}</p></div><Button size="compact" onPress={() => setAction({ title: t("Create pipeline"), path: "pipelines", initial: { isDefault: !rows(resource.data).length }, fields: [{ key: "name", label: t("Name"), required: true }, { key: "code", label: t("Unique code"), required: true }, { key: "isDefault", label: t("Default pipeline"), type: "checkbox" }], transform: (v) => ({ ...v, stages: [
      { code: "qualified", name: "New Opportunity", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
      { code: "proposal", name: "Proposal", position: 2, probability: 50, forecastCategory: "best_case", entryRequirements: {} },
      { code: "negotiation", name: "Negotiation", position: 3, probability: 75, forecastCategory: "commit", entryRequirements: {} },
      { code: "won", name: "Won", position: 4, probability: 100, forecastCategory: "closed", entryRequirements: {} },
      { code: "lost", name: "Lost", position: 5, probability: 0, forecastCategory: "closed", entryRequirements: {} },
    ] }) })}>{t("Create pipeline")}</Button></div>
    <ResourceState {...resource} retry={resource.refresh} />
    {rows(resource.data).map((pipeline) => <section className={styles.section} key={pipeline.id}>
      <div className={styles.toolbar}><h3>{String(pipeline.name)} {pipeline.isDefault ? <Badge tone="neutral">{t("Default")}</Badge> : null}</h3><div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: t("Edit pipeline"), path: `pipelines/${pipeline.id}`, method: "PATCH", initial: { version: pipeline.version, name: pipeline.name, isDefault: pipeline.isDefault, status: pipeline.status }, fields: [{ key: "name", label: t("Name"), required: true }, { key: "isDefault", label: t("Default pipeline"), type: "checkbox" }, { key: "status", label: t("Status"), options: translatedChoice(t, ["active", "archived"]), required: true }] })}>{t("Edit pipeline")}</Button><Button size="compact" isDisabled={pipeline.status !== "active"} onPress={() => setAction({ title: t("Add stage"), path: `pipelines/${pipeline.id}/stages`, initial: { position: Math.max(0, ...((pipeline.stages ?? []) as RecordData[]).map((s) => Number(s.position))) + 1, probability: 50, forecastCategory: "pipeline" }, fields: [{ key: "code", label: t("Unique stage code"), required: true }, ...stageFields(t)], transform: stageBody })}>{t("Add stage")}</Button></div></div>
      <DataGrid ariaLabel={t("{name} stages", { name: String(pipeline.name) })} appearance="flush" columns={stageColumns(pipeline, setAction, t)} data={(pipeline.stages ?? []) as RecordData[]} getRowId={(stage) => String(stage.id)} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle={t("No stages yet")} emptyDescription={t("Add a stage to organize this pipeline.")} />
    </section>)}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={resource.refresh} /> : null}
  </div>;
}

function stageBody(v: Record<string, unknown>) {
  const { amount, expectedCloseAt, nextAction, owner, stakeholders, discovery, ...rest } = v;
  return { ...rest, entryRequirements: { amount: Boolean(amount), expectedCloseAt: Boolean(expectedCloseAt), nextAction: Boolean(nextAction), owner: Boolean(owner), stakeholders: Boolean(stakeholders), discovery: Boolean(discovery) } };
}
