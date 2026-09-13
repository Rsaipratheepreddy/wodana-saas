"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
const CrmFlowCanvas = dynamic(() => import("./crm-flow-canvas").then((module) => module.CrmFlowCanvas), { ssr: false, loading: () => <p role="status">Loading workflow canvas…</p> });
import { ArrowDown, ArrowLeft, Play, Plus, Search, Workflow, X, Settings2, Undo2, Redo2, PanelLeftClose, Save } from "lucide-react";
import { Badge, Button, Callout, Tabs, ConfirmationDialog, IconButton, SelectField } from "@/design-system";
import { crmRequest, label, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell, crmTime } from "./crm-product-shell";
import { ActionDialog, ResourceState, useCrmResource, type ActionSpec } from "./crm-workbench";
import { CrmCreateDialog } from "./crm-record-workbench";
import { AutomationApprovals } from "./automation-approvals";
import styles from "./crm-product.module.css";

import { connectFlow, edgePort, flowConnectionIssues, flowPorts, recordFlowChange, redoFlow, undoFlow, type FlowDefinition as Definition, type FlowEdge as Edge, type FlowStep as Node, type FlowHistory } from "@/lib/crm/flow-editor";
import editor from "./crm-workflow-editor.module.css";
const events = [{ id: "crm.enquiry.ready.v1", name: "An enquiry is ready" }, { id: "crm.customer.replied.v1", name: "A customer replies" }, { id: "crm.sla.breached.v1", name: "A response SLA is breached" }, { id: "crm.opportunity.won.v1", name: "An opportunity is won" }];

export function CrmAutomations({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const [items, setItems] = useState(initialData.items);
  const [tab, setTab] = useState("workflows");
  const [selected, setSelected] = useState(initialRecordId ?? "");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const refresh = async () => { setBusy(true); setFailure(""); try { setItems(rows(await crmRequest(initialData.workspaceId, "automations"))); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } };
  const visible = items.filter((item) => (!status || item.status === status) && `${item.name} ${item.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  if (initialData.canView && selected && tab === "workflows") return <CrmProductShell title="Automations" description="Visual workflow builder" canView compact><WorkflowDetail key={selected} workspaceId={initialData.workspaceId} id={selected} onBack={() => setSelected("")} onChanged={refresh} /></CrmProductShell>;
  return <CrmProductShell title="Automations" description="Build explicit trigger → action workflows, publish deliberately, and review what actually ran." canView={initialData.canView} actions={<><Button size="compact" isLoading={busy} onPress={() => void refresh()}>Refresh workflows</Button><Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus size={14} /> New workflow</Button></>}>
    {failure ? <Callout title="Could not refresh workflows" tone="warning">{failure}</Callout> : null}
    <Tabs selectedKey={tab} onSelectionChange={setTab} items={[{ id: "workflows", label: "Workflows", panel: null }, { id: "runs", label: "Run history", panel: <AutomationRuns workspaceId={initialData.workspaceId} definitions={items} /> }, { id: "approvals", label: "Approvals", panel: <AutomationApprovals workspaceId={initialData.workspaceId} /> }]} />
    {tab === "workflows" ? selected ? <WorkflowDetail key={selected} workspaceId={initialData.workspaceId} id={selected} onBack={() => setSelected("")} onChanged={refresh} /> : <>
      <div className={styles.toolbar}><label className={styles.search}><Search size={16} /><input aria-label="Search workflows" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows…" /></label><select aria-label="Workflow status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All states</option>{["active", "draft", "paused"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div>
      <section aria-label="Automation workflows" className={styles.workflows}>{visible.map((item) => <button type="button" className={styles.workflowCard} key={item.id} onClick={() => setSelected(item.id)}><span className={styles.threadTop}><Workflow size={20} /><Badge tone="neutral">{label(item.status)}</Badge></span><h2>{String(item.name)}</h2><p>{String(item.description ?? "Open this workflow to review its trigger, steps, and publishing state.")}</p><div className={styles.threadTop}><small>{item.activeVersionNumber ? `Published v${item.activeVersionNumber}` : "Not published"} · {item.runOncePerAggregate ? "Once per record" : "Every matching event"}</small><span>Open workflow →</span></div></button>)}</section>
      {!visible.length ? <div className={styles.empty}><Workflow size={28} /><h2>No workflows in this view</h2><p>Create a draft to define what happens when a CRM event occurs.</p></div> : null}
      <p className={styles.muted}>Drafts do not run. Published workflows need the event worker running. Messaging and external actions also require their provider integrations.</p>
    </> : null}
    {creating ? <CrmCreateDialog workspaceId={initialData.workspaceId} id="automations" onClose={() => setCreating(false)} onSaved={async (result) => { if (result?.id) { setSelected(result.id); setTab("workflows"); } await refresh(); }} /> : null}
  </CrmProductShell>;
}

function WorkflowDetail({ workspaceId, id, onBack, onChanged }: { workspaceId: string; id: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const resource = useCrmResource<RecordData>(workspaceId, `automations/${id}`);
  return <section className={editor.detail} aria-label="Workflow editor">{!resource.data ? <Button size="compact" onPress={onBack}><ArrowLeft size={14} /> All workflows</Button> : null}<ResourceState {...resource} retry={resource.refresh} />{resource.data ? <WorkflowEditor key={`${id}/${resource.data.version}`} workspaceId={workspaceId} workflow={resource.data} onBack={onBack} onSaved={async () => { resource.refresh(); await onChanged(); }} /> : null}</section>;
}

function WorkflowEditor({ workspaceId, workflow, onSaved, onBack }: { workspaceId: string; workflow: RecordData; onSaved: () => Promise<void>; onBack: () => void }) {
  const original = workflow.definition as Definition;
  const [history, setHistory] = useState<FlowHistory>({ past: [], present: structuredClone(original), future: [] });
  const definition = history.present;
  const setDefinition = (value: Definition | ((old: Definition) => Definition)) => setHistory((old) => recordFlowChange(old, typeof value === "function" ? value(old.present) : value));
  const [name, setName] = useState(String(workflow.name));
  const [description, setDescription] = useState(String(workflow.description ?? ""));
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [canvasMode, setCanvasMode] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nodeKey, setNodeKey] = useState("");
  const [preview, setPreview] = useState<RecordData | null>(null);
  const [failure, setFailure] = useState("");
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const node = definition.nodes.find((item) => item.key === nodeKey);
  const conditional = (edge: Edge) => Boolean(edge.condition) || edge.when !== undefined || edge.default === true;
  const dirty = name !== workflow.name || description !== String(workflow.description ?? "") || JSON.stringify(definition) !== JSON.stringify(original);
  const connectionIssues = flowConnectionIssues(definition);
  const validation = workflow.validation as { valid: boolean; errors: string[]; warnings: string[] } | undefined;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const link = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") as HTMLAnchorElement | null : null;
      if (!target || target.target === "_blank" || target.origin !== location.origin || target.href === location.href || event.metaKey || event.ctrlKey) return;
      if (!window.confirm("Discard unsaved workflow changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); };
  }, [dirty]);
  const selectNode = (key: string) => { setNodeKey(key); setSettingsOpen(Boolean(key)); setFailure(""); };
  const update = (configuration: Record<string, unknown>) => setDefinition((old) => ({ ...old, nodes: old.nodes.map((item) => item.key === nodeKey ? { ...item, configuration } : item) }));
  const addStep = (after: string) => {
    const outgoing = definition.edges.filter((edge) => edge.from === after);
    if (outgoing.length !== 1 || conditional(outgoing[0]) || definition.nodes.length >= 200) return;
    const key = `step_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    setDefinition((old) => ({ ...old, nodes: [...old.nodes, { key, type: "create_task", configuration: { title: "Follow up with customer", priority: "normal", delayMinutes: 60, isNextAction: true } }], edges: [...old.edges.filter((edge) => edge !== outgoing[0]), { from: after, to: key }, { ...outgoing[0], from: key }] })); selectNode(key);
  };
  const ordered: Node[] = []; const seen = new Set<string>();
  const walk = (key: string) => { if (seen.has(key)) return; seen.add(key); const item = definition.nodes.find((value) => value.key === key); if (item) ordered.push(item); definition.edges.filter((edge) => edge.from === key).forEach((edge) => walk(edge.to)); };
  definition.nodes.filter((item) => item.type === "trigger").forEach((item) => walk(item.key)); definition.nodes.forEach((item) => walk(item.key));
  return <div className={editor.editor}>
    <header className={editor.toolbar}>
      <Button size="compact" variant="quiet" onPress={() => dirty ? setLeaving(true) : onBack()}><ArrowLeft size={14} /> All workflows</Button>
      <div className={editor.identity}><h1>{name || "Untitled workflow"}</h1><span><Badge tone="neutral">{label(workflow.status)}</Badge>v{String(workflow.draftVersionNumber ?? 1)} · {dirty ? "Unsaved changes" : "Saved"}</span></div>
      <div className={editor.tools}>
        <Button size="compact" aria-pressed={paletteOpen && canvasMode} onPress={() => { setCanvasMode(true); setPaletteOpen(!paletteOpen || !canvasMode); }}><Plus size={14} /> Add steps</Button>
        <Button size="compact" onPress={() => { setCanvasMode((value) => !value); setSettingsOpen(false); }}>{canvasMode ? "Step list" : "Flow canvas"}</Button>
        <IconButton aria-label="Workflow settings" size="compact" onPress={() => { setNodeKey(""); setSettingsOpen((value) => !value || Boolean(nodeKey)); }}><Settings2 size={16} /></IconButton>
        <IconButton aria-label="Undo canvas change" size="compact" isDisabled={!history.past.length} onPress={() => setHistory(undoFlow)}><Undo2 size={16} /></IconButton>
        <IconButton aria-label="Redo canvas change" size="compact" isDisabled={!history.future.length} onPress={() => setHistory(redoFlow)}><Redo2 size={16} /></IconButton>
        <Button size="compact" isDisabled={!dirty || !name.trim() || connectionIssues.length > 0} onPress={() => setAction({ title: "Save workflow draft", description: workflow.status === "active" ? "Saving pauses new runs until you publish this draft. Existing runs keep their original version." : "Save the connected graph, step settings and canvas positions. This does not publish or run it.", path: `automations/${workflow.id}`, method: "PATCH", initial: { version: workflow.version, name: name.trim(), description: description.trim(), definition }, fields: [], submit: "Save draft" })}><Save size={14} /> Save draft{dirty ? " *" : ""}</Button>
        <IconButton aria-label="Preview saved steps" size="compact" isDisabled={dirty} isLoading={checking} onPress={async () => { setChecking(true); setFailure(""); try { setPreview(await crmRequest(workspaceId, `automations/${workflow.id}/dry-run`, "POST", { context: {} })); } catch (error) { setFailure((error as Error).message); } finally { setChecking(false); } }}><Play size={16} /></IconButton>
        <Button size="compact" variant="primary" isDisabled={dirty || (workflow.status !== "active" && !validation?.valid)} onPress={() => setAction({ title: workflow.status === "active" ? "Pause workflow" : "Publish workflow", description: workflow.status === "active" ? "Stops new runs. In-progress runs keep their recorded version." : "Enables this version for future matching events. Review the trigger and every action before publishing.", path: `automations/${workflow.id}/${workflow.status === "active" ? "pause" : "publish"}`, initial: { version: workflow.version }, fields: [], submit: workflow.status === "active" ? "Pause" : "Publish" })}>{workflow.status === "active" ? "Pause" : "Publish"}</Button>
      </div>
    </header>
    <div className={editor.stage} data-list={!canvasMode || undefined}>
      {canvasMode ? <CrmFlowCanvas definition={definition} selectedKey={nodeKey} onSelect={selectNode} onChange={setDefinition} paletteOpen={paletteOpen} onPaletteClose={() => setPaletteOpen(false)} /> : <section aria-label="Workflow steps" className={editor.stepList}>{ordered.map((item, index) => <div key={item.key}><button type="button" className={styles.step} aria-pressed={nodeKey === item.key} onClick={() => selectNode(item.key)}><span className={styles.stepNumber}>{index + 1}</span><span><strong>{label(item.type)}</strong><small>{String(item.configuration.title ?? (item.type === "trigger" ? (item.configuration.eventTypes as string[] ?? []).map((event) => events.find((value) => value.id === event)?.name ?? event).join(", ") : item.key))}</small></span></button><div className={styles.connections}>{definition.edges.filter((edge) => edge.from === item.key).map((edge, edgeIndex) => <span key={`${edge.to}/${edgeIndex}`}><ArrowDown size={13} /> {String(edge.when ?? (edge.default ? "Otherwise" : edge.condition ? "Condition" : "Next"))}: {label(definition.nodes.find((value) => value.key === edge.to)?.type ?? edge.to)}</span>)}{item.type !== "end" && definition.edges.filter((edge) => edge.from === item.key).length === 1 && !conditional(definition.edges.find((edge) => edge.from === item.key)!) ? <button type="button" className={styles.textButton} onClick={() => addStep(item.key)}><Plus size={12} /> Add step</button> : null}</div></div>)}</section>}
      {settingsOpen ? <aside aria-label="Step settings" className={editor.settings}>
        <header><h2>{node ? label(node.type) : "Workflow settings"}</h2><IconButton aria-label="Close step settings" size="compact" onPress={() => setSettingsOpen(false)}><X size={16} /></IconButton></header>
        <div className={styles.stepSettings}>{node ? <>
          <NodeSettings key={node.key} workspaceId={workspaceId} node={node} onChange={update} onTypeChange={(type) => setDefinition((old) => ({ ...old, nodes: old.nodes.map((item) => item.key === node.key ? { ...item, type, configuration: type === "create_task" ? { title: "Follow up with customer", priority: "normal", delayMinutes: 60, isNextAction: true } : { delayMinutes: 60 } } : item) }))} />
          {flowPorts(definition, node).length ? <section className={editor.connectionSettings} aria-label="Step connections"><h3>Connections</h3>{flowPorts(definition, node).map((port) => {
            const edgeIndex = definition.edges.findIndex((edge, index) => edge.from === node.key && edgePort(definition, edge, index) === port.id);
            const existing = definition.edges[edgeIndex];
            return <SelectField key={port.id} label={`${port.label} connects to`} selectedKey={existing?.to ?? "unconnected"} items={[...(node.type === "branch" ? [] : [{ id: "unconnected", label: "Not connected" }]), ...definition.nodes.filter((value) => value.key !== node.key && value.type !== "trigger").map((value) => ({ id: value.key, label: `${String(value.configuration.title ?? label(value.type))} · ${value.key}` }))]} onSelectionChange={(key) => {
              if (!key) return;
              if (key === "unconnected") { setDefinition({ ...definition, edges: definition.edges.filter((_, index) => index !== edgeIndex) }); return; }
              const result = connectFlow(definition, node.key, String(key), port.id);
              if (result.error) { setFailure(result.error); return; } setFailure(""); setDefinition(result.definition);
            }} />;
          })}</section> : null}
          {node.type !== "trigger" ? <Button size="compact" variant="quiet" onPress={() => setRemoving(true)}>Remove step</Button> : null}
        </> : <><label>Name<input maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><p className={styles.muted}>{workflow.runOncePerAggregate ? "Runs once per CRM record." : "Runs for each matching event."} Draft changes do not run until published.</p></>}</div>
      </aside> : null}
      {failure || preview || validation?.errors?.length ? <div className={editor.feedback}><IconButton aria-label="Dismiss workflow notice" size="compact" onPress={() => { setFailure(""); setPreview(null); }}><X size={14} /></IconButton>{failure ? <p role="alert">{failure}</p> : preview ? <p role="status">{preview.valid ? "Saved structure is valid." : "Saved structure needs attention."} Preview does not execute actions or send messages.</p> : <p>{validation?.errors.join(" · ")}</p>}</div> : null}
    </div>
    <footer className={editor.footer}><span>{definition.nodes.length} steps · {definition.edges.length} connections</span>{connectionIssues.length ? <details><summary>{connectionIssues.length} connection{connectionIssues.length === 1 ? "" : "s"} to finish before saving</summary><ul>{connectionIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details> : <span>All steps connected · Save before publishing</span>}<button type="button" onClick={() => { setPaletteOpen(false); setSettingsOpen(false); setCanvasMode(true); }}><PanelLeftClose size={13} /> Focus canvas</button></footer>
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={onSaved} /> : null}
    <ConfirmationDialog isOpen={leaving} onOpenChange={setLeaving} title="Discard workflow changes?" body="Your unsaved steps, connections and settings will be discarded." confirmLabel="Discard changes" onConfirm={onBack} />
    <ConfirmationDialog isOpen={removing} onOpenChange={setRemoving} title="Remove this step?" body="This removes the step and its attached connections from the draft. Connect the remaining steps before saving. Undo can restore it." confirmLabel="Remove step" onConfirm={() => { if (node && node.type !== "trigger") setDefinition({ ...definition, nodes: definition.nodes.filter((item) => item.key !== node.key), edges: definition.edges.filter((edge) => edge.from !== node.key && edge.to !== node.key) }); setRemoving(false); selectNode(""); }} />
  </div>;
}

function NodeSettings({ workspaceId, node, onChange, onTypeChange }: { workspaceId: string; node: Node; onChange: (value: Record<string, unknown>) => void; onTypeChange: (type: string) => void }) {
  const config = node.configuration;
  const queues = useCrmResource<unknown>(workspaceId, node.type === "assign" ? "queues" : null);
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  if (node.type === "trigger") {
    const selected = Array.isArray(config.eventTypes) ? config.eventTypes as string[] : [];
    return <fieldset className={styles.eventChoices}><legend>Start when any selected event occurs</legend>{[...events, ...selected.filter((id) => !events.some((event) => event.id === id)).map((id) => ({ id, name: id }))].map((event) => <label key={event.id}><input type="checkbox" checked={selected.includes(event.id)} onChange={(e) => set("eventTypes", e.target.checked ? [...selected, event.id] : selected.filter((value) => value !== event.id))} />{event.name}</label>)}</fieldset>;
  }
  if (node.type === "end") return <p className={styles.muted}>The workflow completes when this step is reached.</p>;
  if (node.type === "filter") {
    const condition = (config.condition && typeof config.condition === "object" ? config.condition : {}) as Record<string, unknown>;
    if (condition.all || condition.any || Array.isArray(condition.value)) return <><p className={styles.muted}>This existing compound condition is preserved. Connect its Yes and No outputs below.</p><pre>{JSON.stringify(condition, null, 2)}</pre></>;
    const change = (key: string, value: unknown) => set("condition", { ...condition, [key]: value });
    const valueType = typeof condition.value === "number" ? "number" : typeof condition.value === "boolean" ? "boolean" : "text";
    return <><label>Event field path<input value={String(condition.path ?? "")} maxLength={200} placeholder="event.leadId" onChange={(event) => change("path", event.target.value)} /></label>
      <SelectField label="Check" selectedKey={String(condition.operator ?? "equals")} onSelectionChange={(key) => { if (key) change("operator", String(key)); }} items={[{ id: "exists", label: "Has a value" }, { id: "equals", label: "Equals" }, { id: "not_equals", label: "Does not equal" }, { id: "contains", label: "Contains" }, { id: "gt", label: "Greater than" }, { id: "gte", label: "Greater than or equal" }, { id: "lt", label: "Less than" }, { id: "lte", label: "Less than or equal" }]} />
      {(condition.operator ?? "equals") !== "exists" ? <><SelectField label="Value type" selectedKey={valueType} onSelectionChange={(key) => change("value", key === "number" ? 0 : key === "boolean" ? true : "")} items={[{ id: "text", label: "Text" }, { id: "number", label: "Number" }, { id: "boolean", label: "True / false" }]} />{valueType === "boolean" ? <SelectField label="Compare to" selectedKey={String(condition.value)} onSelectionChange={(key) => change("value", key === "true")} items={[{ id: "true", label: "True" }, { id: "false", label: "False" }]} /> : <label>Compare to<input type={valueType === "number" ? "number" : "text"} value={String(condition.value ?? "")} onChange={(event) => change("value", valueType === "number" ? Number(event.target.value) : event.target.value)} /></label>}</> : null}
      <p className={styles.muted}>Uses the triggering event’s data, not a live customer lookup. For example, event.leadId checks for a linked lead. Yes runs when the check matches; No runs otherwise.</p>
    </>;
  }
  if (node.type === "create_task" || node.type === "delay_until") return <><label>Action<select value={node.type} onChange={(e) => onTypeChange(e.target.value)}><option value="create_task">Create follow-up task</option><option value="delay_until">Wait before continuing</option></select></label>{node.type === "create_task" ? <><label>Task title<input maxLength={300} value={String(config.title ?? "")} onChange={(e) => set("title", e.target.value)} /></label><label>Priority<select value={String(config.priority ?? "normal")} onChange={(e) => set("priority", e.target.value)}>{["low", "normal", "high", "urgent"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label><label className={styles.checkbox}><input type="checkbox" checked={Boolean(config.isNextAction)} onChange={(e) => set("isNextAction", e.target.checked)} /> Make this the next commitment</label></> : null}{config.dueAt ? <p className={styles.muted}>Scheduled using {String(config.dueAt)}. This existing schedule is preserved.</p> : <label>{node.type === "create_task" ? "Task due in (minutes)" : "Wait (minutes)"}<input type="number" min={0} max={525600} value={Number(config.delayMinutes ?? 0)} onChange={(e) => set("delayMinutes", Math.max(0, Number(e.target.value)))} /></label>}</>;
  if (node.type === "assign") return <><ResourceState {...queues} retry={queues.refresh} /><label>Assignment queue<select value={String(config.queueId ?? "")} onChange={(e) => { const next = { ...config }; if (e.target.value) next.queueId = e.target.value; else delete next.queueId; onChange(next); }}><option value="">Use lead’s current queue</option>{rows(queues.data).map((queue) => <option key={queue.id} value={queue.id}>{String(queue.name)}</option>)}</select></label><p>Uses the queue’s configured assignment policy and eligible lead managers.</p></>;
  return <><p className={styles.muted}>This advanced step is preserved exactly. Review its current settings below; use the specialized CRM section to configure the referenced resource.</p><dl className={styles.configFacts}>{Object.entries(config).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}</dl></>;
}

function AutomationRuns({ workspaceId, definitions }: { workspaceId: string; definitions: RecordData[] }) {
  const [definitionId, setDefinitionId] = useState("");
  const [status, setStatus] = useState("");
  const resource = useCrmResource<unknown>(workspaceId, `automation-runs${definitionId ? `?definitionId=${definitionId}` : ""}`);
  const runs = rows(resource.data).filter((item) => !status || item.status === status);
  return <section className={styles.runHistory} aria-label="Automation run history"><div className={styles.toolbar}><select aria-label="Run workflow" value={definitionId} onChange={(e) => setDefinitionId(e.target.value)}><option value="">All workflows</option>{definitions.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select><select aria-label="Run status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All results</option>{["queued", "running", "waiting", "approval_required", "completed", "failed", "cancelled"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><Button size="compact" onPress={resource.refresh}>Refresh runs</Button></div><p className={styles.muted}>Latest 200 runs. A run appears only after a published workflow receives a matching event.</p><ResourceState {...resource} retry={resource.refresh} />{runs.map((run) => <details className={styles.run} key={run.id}><summary><span><strong>{String(definitions.find((item) => item.id === run.definitionId)?.name ?? "Workflow run")}</strong><small>{crmTime(run.createdAt)} · {label(run.currentStepKey, "Waiting to start")}</small></span><Badge tone={run.status === "failed" ? "danger" : "neutral"}>{label(run.status)}</Badge></summary><dl className={styles.configFacts}><div><dt>Run ID</dt><dd>{run.id}</dd></div><div><dt>Record</dt><dd>{label(run.aggregateType)} · {String(run.aggregateId)}</dd></div><div><dt>Completed</dt><dd>{run.completedAt ? crmTime(run.completedAt) : "Not completed"}</dd></div></dl>{run.failureMessage || run.failureCode ? <Callout title="Execution failed" tone="warning">{String(run.failureMessage ?? run.failureCode)}</Callout> : null}</details>)}{!resource.loading && !resource.failure && !runs.length ? <div className={styles.empty}><Workflow size={28} /><h3>No runs match this view</h3><p>Check that the workflow is published and the event worker is running.</p></div> : null}</section>;
}
