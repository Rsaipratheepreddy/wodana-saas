"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  Container,
  DataGrid,
  Form,
  IconButton,
  InspectorSheet,
  MultiSelectField,
  PageHeader,
  SelectField,
  TextAreaField,
  TextInput,
  type DataGridColumn,
} from "@/design-system";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import type {
  ProjectWorkflowGate,
  ProjectWorkflowPhase,
  ProjectWorkflowRole,
  ProjectWorkflowStage,
  ProjectWorkflowTemplate,
  ProjectWorkflowTemplatesResponse,
} from "@/lib/projects/workflow-templates";
import styles from "./project-workflow-templates.module.css";

const phases: Array<{ id: ProjectWorkflowPhase; label: string }> = [
  { id: "planning", label: "Planning" },
  { id: "active", label: "In progress" },
  { id: "handover", label: "Handover" },
  { id: "completed", label: "Completed" },
];

const roles: Array<{ id: ProjectWorkflowRole | "none"; label: string }> = [
  { id: "none", label: "No fixed owner" },
  { id: "project_manager", label: "Project manager" },
  { id: "senior_designer", label: "Senior designer" },
  { id: "junior_designer", label: "Junior designer" },
  { id: "technical_designer", label: "Technical designer" },
  { id: "visualizer", label: "Visualizer" },
  { id: "creative_director", label: "Creative director" },
  { id: "procurement_production", label: "Procurement & production" },
  { id: "finance", label: "Finance" },
  { id: "surveyor", label: "Surveyor" },
  { id: "sales_manager", label: "Sales manager" },
  { id: "sales_assistant", label: "Sales assistant" },
  { id: "crm_owner", label: "CRM owner" },
];

const gateLabels: Record<ProjectWorkflowGate, string> = {
  project_manager_assigned: "Project manager assigned",
  tasks_planned: "Tasks planned",
  production_plan_ready: "Production packages ready",
  all_tasks_closed: "All tasks closed",
  all_snags_closed: "All snags closed",
  all_handovers_accepted: "Handover accepted",
  finance_closed: "Finance closed",
};

const phaseLabel = (phase: ProjectWorkflowPhase) => phases.find((item) => item.id === phase)?.label ?? phase;
const cloneTemplate = (template: ProjectWorkflowTemplate): ProjectWorkflowTemplate => ({
  ...template,
  stages: template.stages.map((stage) => ({ ...stage, exitGates: [...stage.exitGates] })),
});

function draftFrom(template: ProjectWorkflowTemplate): ProjectWorkflowTemplate {
  const draft = cloneTemplate(template);
  if (template.source === "workspace") return draft;
  return {
    ...draft,
    id: crypto.randomUUID(),
    version: 0,
    code: `${template.code}_custom`,
    name: `${template.name} copy`,
    source: "workspace",
    updatedAt: null,
  };
}

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? fallback;
}

export function ProjectWorkflowTemplatesPage({
  initialData,
  workspaceId,
}: {
  initialData: ProjectWorkflowTemplatesResponse;
  workspaceId: string;
}) {
  const router = useRouter();
  const rows = initialData.templates.length ? initialData.templates : [initialData.defaultTemplate];
  const [draft, setDraft] = useState<ProjectWorkflowTemplate | null>(null);
  const [historyTemplate, setHistoryTemplate] = useState<ProjectWorkflowTemplate | null>(null);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<ProjectWorkflowTemplate | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<WorkspaceConfigurationRevision | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const columns: DataGridColumn<ProjectWorkflowTemplate>[] = [
    {
      accessorKey: "name",
      header: "Workflow",
      size: 280,
      meta: {
        primary: true,
        renderCell: (item) => (
          <span className={styles.name}>
            <strong>{item.name}</strong>
            <small>{item.description || "No description"}</small>
          </span>
        ),
      },
    },
    { id: "stages", header: "Stages", size: 90, accessorFn: (item) => item.stages.length },
    {
      id: "flow",
      header: "Flow",
      size: 280,
      accessorFn: (item) => item.stages.map((stage) => stage.visibleName).join(" → "),
      meta: { mobileHidden: true },
    },
    {
      id: "default",
      header: "Use",
      size: 120,
      accessorFn: (item) => (item.isDefault ? "Default" : "Alternative"),
      meta: {
        renderCell: (item) => item.isDefault ? <Badge tone="success">Default</Badge> : <Badge tone="neutral">Alternative</Badge>,
      },
    },
    {
      id: "source",
      header: "Source",
      size: 120,
      accessorFn: (item) => item.source === "built_in" ? "Wodana" : "Workspace",
      meta: { mobileHidden: true },
    },
  ];

  const setField = <K extends keyof ProjectWorkflowTemplate>(key: K, value: ProjectWorkflowTemplate[K]) =>
    setDraft((current) => current ? { ...current, [key]: value } : current);

  const setStage = (index: number, change: Partial<ProjectWorkflowStage>) =>
    setDraft((current) => current ? {
      ...current,
      stages: current.stages.map((stage, stageIndex) => stageIndex === index
        ? { ...stage, ...change, ...(change.phase && change.phase !== "active" ? { releaseStart: false } : {}) }
        : stage),
    } : current);

  const setReleaseStart = (index: number, enabled: boolean) =>
    setDraft((current) => current ? {
      ...current,
      stages: current.stages.map((stage, stageIndex) => ({
        ...stage,
        releaseStart: enabled && stageIndex === index,
      })),
    } : current);

  const addStage = () => setDraft((current) => {
    if (!current || current.stages.length >= 18) return current;
    const completedIndex = Math.max(1, current.stages.findIndex((stage) => stage.phase === "completed"));
    const stage: ProjectWorkflowStage = {
      key: `stage_${current.stages.length}`,
      visibleName: "New stage",
      description: "",
      phase: "active",
      ownerRole: "project_manager",
      exitGates: [],
    };
    const stages = [...current.stages];
    stages.splice(completedIndex, 0, stage);
    return { ...current, stages };
  });

  const removeStage = (index: number) => setDraft((current) => current && current.stages.length > 2
    ? { ...current, stages: current.stages.filter((_, stageIndex) => stageIndex !== index) }
    : current);

  const save = async () => {
    if (!draft?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace/projects/workflow-templates/${draft.id}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: draft.version,
            code: draft.code,
            name: draft.name,
            description: draft.description,
            isDefault: draft.isDefault,
            stages: draft.stages,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response, "Workflow could not be saved."));
      setDraft(null);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Workflow could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (template: ProjectWorkflowTemplate) => {
    if (!template.id) return;
    setDraft(null);
    setHistoryTemplate(template);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace/projects/workflow-templates/${template.id}/history?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (!response.ok) throw new Error(await responseMessage(response, "Workflow history could not be loaded."));
      setRevisions(await response.json() as WorkspaceConfigurationRevision[]);
    } catch (failure) {
      setRevisions([]);
      setError(failure instanceof Error ? failure.message : "Workflow history could not be loaded.");
    }
  };

  const archive = async () => {
    if (!archiveTarget?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace/projects/workflow-templates/${archiveTarget.id}/archive?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: archiveTarget.version }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response, "Workflow could not be archived."));
      setArchiveTarget(null);
      setDraft(null);
      router.refresh();
    } catch (failure) {
      setArchiveTarget(null);
      setError(failure instanceof Error ? failure.message : "Workflow could not be archived.");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!historyTemplate?.id || !rollbackTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace/projects/workflow-templates/${historyTemplate.id}/rollback?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: historyTemplate.version, revisionId: rollbackTarget.id }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response, "Workflow revision could not be restored."));
      setRollbackTarget(null);
      setHistoryTemplate(null);
      router.refresh();
    } catch (failure) {
      setRollbackTarget(null);
      setError(failure instanceof Error ? failure.message : "Workflow revision could not be restored.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container as="section" className={styles.page} size="full">
      <PageHeader
        actions={<Button onPress={() => setDraft(draftFrom(initialData.defaultTemplate))} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />Create template</Button>}
        description="Set the reusable stages, owners and checks applied when a project starts. Existing projects keep the workflow version they began with."
        eyebrow="Projects"
        title="Workflow setup"
      />
      {error && !draft && !historyTemplate ? <Callout tone="danger" title="The action could not be completed">{error}</Callout> : null}
      <DataGrid gridLines
        ariaLabel="Project workflow templates"
        columns={columns}
        data={rows}
        emptyDescription="Create a workflow for new projects."
        emptyTitle="No workflow templates"
        getRowId={(item) => item.id ?? "built-in"}
        onRowAction={(item) => setDraft(draftFrom(item))}
        rowNumbers={false}
        searchLabel="Search workflow templates"
        selectable={false}
      />

      <InspectorSheet
        description="One editor for the whole workflow. Changes apply only to projects started after saving."
        footer={draft ? <div className={styles.footer}>
          {draft.version > 0 ? <><Button onPress={() => void openHistory(draft)} variant="quiet"><History aria-hidden="true" size={14} />History</Button><Button onPress={() => setArchiveTarget(draft)} variant="quiet"><Archive aria-hidden="true" size={14} />Archive</Button></> : null}
          <span />
          <Button onPress={() => setDraft(null)}>Cancel</Button>
          <Button isLoading={busy} onPress={() => void save()} variant="primary">Save workflow</Button>
        </div> : undefined}
        isDirty={Boolean(draft)}
        isOpen={Boolean(draft)}
        onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}
        size="lg"
        title={draft?.version ? `Edit ${draft.name}` : "Create workflow template"}
      >
        {draft ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {error ? <Callout tone="danger" title="Workflow could not be saved">{error}</Callout> : null}
          <div className={styles.details}>
            <TextInput isRequired label="Template name" onChange={(value) => setField("name", value)} value={draft.name} />
            <TextInput description="Lowercase letters, numbers and underscores." isDisabled={draft.version > 0} isRequired label="Template code" onChange={(value) => setField("code", value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} value={draft.code} />
            <div className={styles.wide}><TextAreaField label="Description" onChange={(value) => setField("description", value)} value={draft.description} /></div>
            <div className={styles.wide}><Checkbox isSelected={draft.isDefault} onChange={(value) => setField("isDefault", value)}>Use for new projects by default</Checkbox></div>
          </div>
          <div className={styles.stageHeading}><div><h2>Stages</h2><p>Projects move forward in this order. The first stage must be Planning and the last Completed.</p></div><Button isDisabled={draft.stages.length >= 18} onPress={addStage} size="compact"><Plus aria-hidden="true" size={14} />Add stage</Button></div>
          <ol className={styles.stages}>
            {draft.stages.map((stage, index) => <li key={`${stage.key}-${index}`}>
              <div className={styles.stageTop}><span>{index + 1}</span><strong>{stage.visibleName || "Untitled stage"}</strong><IconButton aria-label={`Remove ${stage.visibleName || `stage ${index + 1}`}`} isDisabled={draft.stages.length <= 2 || index === 0 || index === draft.stages.length - 1} onPress={() => removeStage(index)} size="compact"><Trash2 aria-hidden="true" size={14} /></IconButton></div>
              <div className={styles.stageFields}>
                <TextInput isRequired label="Stage name" onChange={(value) => setStage(index, { visibleName: value })} value={stage.visibleName} />
                <TextInput description="Stable internal name." isDisabled={draft.version > 0} isRequired label="Stage key" onChange={(value) => setStage(index, { key: value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={stage.key} />
                <SelectField isRequired items={phases} label="Project phase" onSelectionChange={(key) => key && setStage(index, { phase: String(key) as ProjectWorkflowPhase })} selectedKey={stage.phase} />
                <SelectField items={roles} label="Default owner" onSelectionChange={(key) => setStage(index, { ownerRole: key === "none" ? null : String(key) as ProjectWorkflowRole })} selectedKey={stage.ownerRole ?? "none"} />
                {stage.phase === "active" ? <div className={styles.wide}><Checkbox isSelected={stage.releaseStart === true} onChange={(enabled) => setReleaseStart(index, enabled)}>Start here after approved planning and commercial release</Checkbox></div> : null}
                <div className={styles.wide}><TextAreaField label="What happens here" onChange={(value) => setStage(index, { description: value })} value={stage.description} /></div>
                <div className={styles.wide}><MultiSelectField items={initialData.supportedExitGates.map((gate) => ({ id: gate, label: gateLabels[gate] }))} label="Checks required before moving forward" onSelectionChange={(keys) => setStage(index, { exitGates: [...keys].map(String) as ProjectWorkflowGate[] })} selectedKeys={new Set(stage.exitGates)} /></div>
              </div>
            </li>)}
          </ol>
        </Form> : null}
      </InspectorSheet>

      <InspectorSheet
        description="Restoring creates a new revision. No change history is deleted."
        isOpen={Boolean(historyTemplate)}
        onOpenChange={(open) => { if (!open && !busy) setHistoryTemplate(null); }}
        size="sm"
        title={historyTemplate ? `${historyTemplate.name} history` : "Workflow history"}
      >
        {error ? <Callout tone="danger" title="History unavailable">{error}</Callout> : null}
        {!error && !revisions.length ? <p className={styles.muted}>No saved changes yet.</p> : null}
        {revisions.length ? <ol className={styles.history}>
          {revisions.map((revision, index) => <li key={revision.id}>
            <div><strong>Revision {revision.revisionNumber}</strong>{index === 0 ? <Badge tone="neutral">Current</Badge> : null}</div>
            <small>{new Date(revision.createdAt).toLocaleString()} · {revision.changes.length} changed {revision.changes.length === 1 ? "field" : "fields"}</small>
            {index > 0 ? <Button isDisabled={busy} onPress={() => setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw aria-hidden="true" size={14} />Restore</Button> : null}
          </li>)}
        </ol> : null}
      </InspectorSheet>

      <ConfirmationDialog body="The template will stop appearing for new projects. Existing projects and revision history remain unchanged." confirmLabel={busy ? "Archiving…" : "Archive workflow"} isOpen={Boolean(archiveTarget)} onConfirm={() => void archive()} onOpenChange={(open) => { if (!open && !busy) setArchiveTarget(null); }} title="Archive this workflow?" />
      <ConfirmationDialog body="The selected stages, owners and checks will become the current template. The current version remains in history." confirmLabel={busy ? "Restoring…" : "Restore revision"} isOpen={Boolean(rollbackTarget)} onConfirm={() => void rollback()} onOpenChange={(open) => { if (!open && !busy) setRollbackTarget(null); }} title="Restore this workflow revision?" />
    </Container>
  );
}
