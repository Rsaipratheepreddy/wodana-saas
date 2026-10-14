"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InlineNotice, MultiSelectField, PillTabs, SaveBar, SelectField, SettingsPage, SettingsRow, SettingsSection, InspectorSheet, Skeleton, Switch, TextInput, TimeField, isNoAccessError, NoAccessState } from "@/design-system";
import { parseTime } from "@internationalized/date";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import { reminderHref } from "@/lib/reminders/contract";
import type { CheckKind, KeepInformedEvent, ProjectRole, ProjectRoute, RouteStage, SettingsState, StageCheck, TemplateTask, WorkTemplate } from "@/lib/project-core/types";
import { useSupplyLabels } from "./project-scope";
import { WarrantySettingsSection } from "../site/project-warranty";
import { LabourRatesSection } from "./labour-rates";
import styles from "./project-settings.module.css";

type Tab = "start" | "roles" | "informed" | "routes" | "work" | "warranty" | "labour";
const LEAD = "project_manager";

/**
 * Settings → Projects: what must be true before a project starts, the roles on a project team, the
 * routes (stages, who owns each, what each needs) and the standard tasks for each way a package is
 * delivered. Nothing here is fixed in code.
 */
export function ProjectSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<SettingsState | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("start");
  const [editing, setEditing] = useState<ProjectRoute | "new" | null>(null);
  const [editingWork, setEditingWork] = useState<WorkTemplate | null>(null);
  const supplies = useSupplyLabels();
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Projects")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} shape="form" />;
  const save = async (work: () => Promise<SettingsState>) => {
    setError("");
    try { setData(await work()); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  return <SettingsPage title={t("Projects")}>
    <PillTabs ariaLabel={t("Project settings")} selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)}
      items={[{ id: "start", label: t("Starting a project") }, { id: "roles", label: t("Team roles") }, { id: "informed", label: t("Keep informed") }, { id: "routes", label: t("Routes") }, { id: "work", label: t("Standard tasks") },
        { id: "warranty", label: t("Warranty") }, { id: "labour", label: t("Labour rates") }]} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {tab === "start" ? <StartRules key={data.settings.version} data={data} onSave={(input) => save(() => api.saveSettings(input))} /> : null}
    {tab === "roles" ? <Roles key={data.settings.version} data={data} onSave={(roles) => save(() => api.saveSettings({ version: data.settings.version, roles }))} /> : null}
    {tab === "informed" ? <KeepInformed key={`informed-${data.settings.version}`} data={data} onSave={(keepInformed) => save(() => api.saveSettings({ version: data.settings.version, keepInformed }))} /> : null}
    {/* The open tab names the section, so its heading is for screen readers only. */}
    {tab === "routes" ? <SettingsSection id="routes" title={<span className="wd-visually-hidden">{t("Routes")}</span>} actions={data.canManage ? <Button size="compact" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New route")}</Button> : null}>
      <ul className={styles.routes}>{data.templates.map((route) => <li key={route.id}>
        <button type="button" onClick={() => setEditing(route)}>
          <span className={styles.routeName}>{route.name}{route.isDefault ? <Badge tone="neutral">{t("Default")}</Badge> : null}</span>
          <span className={styles.muted}>{route.stages.map((stage) => stage.name).join(" → ")}</span>
        </button>
      </li>)}</ul>
    </SettingsSection> : null}
    {tab === "work" ? <section id="work" aria-label={t("Standard tasks")}>
      <ul className={styles.routes}>{data.workTemplates.map((template) => <li key={template.supply}>
        <button type="button" onClick={() => setEditingWork(template)}>
          <span className={styles.routeName}>{supplies[template.supply]}</span>
          <span className={styles.muted}>{template.tasks.length ? template.tasks.map((task) => task.title).join(" → ") : t("No tasks")}</span>
        </button>
      </li>)}</ul>
    </section> : null}
    {tab === "warranty" ? <WarrantySettingsSection workspaceId={workspaceId} supplies={supplies} /> : null}
    {tab === "labour" ? <LabourRatesSection workspaceId={workspaceId} /> : null}
    {editingWork ? <WorkTemplateEditor template={editingWork} title={supplies[editingWork.supply]} roles={data.settings.roles} stages={routeStages(data.templates)}
      readOnly={!data.canManage} onClose={() => setEditingWork(null)}
      onSave={async (tasks) => { if (await save(() => api.saveWorkTemplate(editingWork.supply, { version: editingWork.version, tasks }))) setEditingWork(null); }} /> : null}
    {editing ? <RouteEditor route={editing === "new" ? null : editing} roles={data.settings.roles} readOnly={!data.canManage} onClose={() => setEditing(null)}
      onSave={async (input) => { if (await save(() => api.saveRoute(input))) setEditing(null); }}
      onArchive={async (id) => { if (await save(() => api.archiveRoute(id))) setEditing(null); }} /> : null}
  </SettingsPage>;
}

function StartRules({ data, onSave }: { data: SettingsState; onSave: (input: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const [form, setForm] = useState(data.settings);
  const [busy, setBusy] = useState(false);
  const readOnly = !data.canManage;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  return <>
    <SettingsSection id="start" title={t("Before a project starts")}>
      <SettingsRow label={t("Signed agreement")} hint={t("The agreement for the accepted quotation is signed.")}>
        <Switch aria-label={t("Signed agreement")} isDisabled={readOnly} isSelected={form.requireAgreement} onChange={(value) => setForm({ ...form, requireAgreement: value })} />
      </SettingsRow>
      <SettingsRow label={t("First payment verified")} hint={t("The payments marked \"before the project starts\" are verified by finance.")}>
        <Switch aria-label={t("First payment verified")} isDisabled={readOnly} isSelected={form.requirePayment} onChange={(value) => setForm({ ...form, requirePayment: value })} />
      </SettingsRow>
      <SettingsRow label={t("Deal approved")} hint={t("The owner approved the deal.")}>
        <Switch aria-label={t("Deal approved")} isDisabled={readOnly} isSelected={form.requireApproval} onChange={(value) => setForm({ ...form, requireApproval: value })} />
      </SettingsRow>
      <SettingsRow label={t("Project numbers")} hint={t("{example} and onwards.", { example: `${form.referencePrefix || "PRJ"}-0001` })}>
        <TextInput aria-label={t("Project numbers")} label={null} isReadOnly={readOnly} value={form.referencePrefix} onChange={(value) => setForm({ ...form, referencePrefix: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="variations" title={t("Changes")}>
      <SettingsRow label={t("Variations are paid")}>
        <SelectField aria-label={t("Variations are paid")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.variationPaymentRule ?? "before_work"}
          onSelectionChange={(key) => setForm({ ...form, variationPaymentRule: key === "next_milestone" ? "next_milestone" : "before_work" })}
          items={[{ id: "before_work", label: t("All before the work starts") }, { id: "next_milestone", label: t("With the next milestone") }]} />
      </SettingsRow>
      <SettingsRow label={t("Work waits for the payment")} hint={t("Added work isn't made or bought until the variation's payment is verified.")}>
        <Switch aria-label={t("Work waits for the payment")} isDisabled={readOnly} isSelected={form.requireVariationPayment} onChange={(value) => setForm({ ...form, requireVariationPayment: value })} />
      </SettingsRow>
      {/* When a change waiting for the client is chased is its reminder rule (Settings › Reminders). */}
      <SettingsRow label={t("Reminders")}>
        <Link href={reminderHref.settings("change_request.client_decision")}>{t("Open reminder settings")}</Link>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="drawings" title={t("Technical drawings")}>
      {/* PLM-149: who talks to the client about the drawings (the technical team doesn't), and when the technical measure is due. */}
      <SettingsRow label={t("Sent to the client by")} hint={t("Checks they match the design, sends them and records the client's approval.")}>
        <SelectField aria-label={t("Sent to the client by")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.drawingsClientRole ?? LEAD}
          onSelectionChange={(key) => setForm({ ...form, drawingsClientRole: key === LEAD ? null : String(key) })}
          items={form.roles.map((role) => ({ id: role.key, label: t(role.label as never) }))} />
      </SettingsRow>
      <SettingsRow label={t("Technical measure due in")}>
        <SelectField aria-label={t("Technical measure due in")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={String(form.technicalMeasureDays ?? "none")}
          onSelectionChange={(key) => setForm({ ...form, technicalMeasureDays: key === "none" ? null : Number(key) })}
          items={[{ id: "none", label: t("No due date") }, ...[...new Set([2, 3, 5, 7, 10, ...(form.technicalMeasureDays ? [form.technicalMeasureDays] : [])])].sort((a, b) => a - b)
            .map((days) => ({ id: String(days), label: t("{count} working days", { count: days }) }))]} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="finish" title={t("When a project finishes")}>
      <SettingsRow label={t("Finish by itself")} hint={t("When the client accepts the handover and nothing is left open.")}>
        <Switch aria-label={t("Finish by itself")} isDisabled={readOnly} isSelected={form.autoFinish} onChange={(value) => setForm({ ...form, autoFinish: value })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="client-updates" title={t("Client updates")}>
      <SettingsRow label={t("Daily report due")} hint={t("The supervisor is reminded then if there's no report, and the project manager an hour later.")}>
        <TimeField aria-label={t("Daily report due")} label={undefined} hourCycle={24} isDisabled={readOnly} value={parseTime(form.reportDueTime ?? "18:00")}
          onChange={(value) => { if (value) setForm({ ...form, reportDueTime: value.toString().slice(0, 5) }); }} />
      </SettingsRow>
      <SettingsRow label={t("Send by itself")} hint={t("A daily report approved but not sent, and the week's drafted update, go to the client if nobody sends them in time. Reports kept internal never do.")}>
        <Switch aria-label={t("Send by itself")} isDisabled={readOnly} isSelected={form.clientUpdateAutoSendHours !== null}
          onChange={(value) => setForm({ ...form, clientUpdateAutoSendHours: value ? 24 : null, autoSendPendingReports: value ? form.autoSendPendingReports : false })} />
      </SettingsRow>
      {form.clientUpdateAutoSendHours !== null ? <>
        <SettingsRow label={t("After")}>
          <SelectField aria-label={t("After")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={String(form.clientUpdateAutoSendHours)}
            items={[...new Set([12, 24, 48, 72, form.clientUpdateAutoSendHours])].sort((a, b) => a - b).map((hours) => ({ id: String(hours), label: t("{count} hours", { count: hours }) }))}
            onSelectionChange={(key) => setForm({ ...form, clientUpdateAutoSendHours: Number(key) })} />
        </SettingsRow>
        <SettingsRow label={t("Also reports nobody reviewed")} hint={t("A submitted daily report goes as written after the same hours; it still waits for the project manager's approval.")}>
          <Switch aria-label={t("Also reports nobody reviewed")} isDisabled={readOnly} isSelected={Boolean(form.autoSendPendingReports)}
            onChange={(value) => setForm({ ...form, autoSendPendingReports: value })} />
        </SettingsRow>
      </> : null}
      <SettingsRow label={t("Weekly roll-up")} hint={t("On the last working day of the week, the days sent to the client that week go as one digest. It replaces the week's drafted update.")}>
        <Switch aria-label={t("Weekly roll-up")} isDisabled={readOnly} isSelected={Boolean(form.weeklyRollup)} onChange={(value) => setForm({ ...form, weeklyRollup: value })} />
      </SettingsRow>
    </SettingsSection>
    {readOnly ? null : <SaveBar isDirty={dirty} isSaving={busy} isDisabled={!/^[A-Z]/.test(form.referencePrefix)} onDiscard={() => setForm(data.settings)}
      onSave={async () => { setBusy(true); await onSave({ version: data.settings.version, requireAgreement: form.requireAgreement, requirePayment: form.requirePayment, requireApproval: form.requireApproval, requireVariationPayment: form.requireVariationPayment,
        variationPaymentRule: form.variationPaymentRule ?? "before_work", autoFinish: form.autoFinish, clientUpdateAutoSendHours: form.clientUpdateAutoSendHours, referencePrefix: form.referencePrefix,
        reportDueTime: form.reportDueTime ?? "18:00", autoSendPendingReports: Boolean(form.autoSendPendingReports), weeklyRollup: Boolean(form.weeklyRollup),
        drawingsClientRole: form.drawingsClientRole ?? null, technicalMeasureDays: form.technicalMeasureDays ?? null }); setBusy(false); }} />}
  </>;
}

function Roles({ data, onSave }: { data: SettingsState; onSave: (roles: ProjectRole[]) => Promise<boolean> }) {
  const t = useT();
  const [roles, setRoles] = useState<ProjectRole[]>(data.settings.roles);
  const [busy, setBusy] = useState(false);
  const readOnly = !data.canManage;
  const dirty = JSON.stringify(roles) !== JSON.stringify(data.settings.roles);
  return <>
    <SettingsSection id="roles" title={t("Team roles")}>
      <ul className={styles.roles}>{roles.map((role, index) => <li key={role.key || index}>
        <TextInput aria-label={t("Role name")} label={null} isReadOnly={readOnly} value={role.label} onChange={(label) => setRoles(roles.map((item, at) => (at === index ? { ...item, label } : item)))} />
        {role.key === LEAD ? <span className={styles.muted}>{t("Leads the project")}</span>
          : readOnly ? null : <IconButton aria-label={t("Remove {name}", { name: role.label })} size="compact" variant="quiet" onPress={() => setRoles(roles.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={14} /></IconButton>}
      </li>)}</ul>
      {readOnly ? null : <Button size="compact" variant="quiet" onPress={() => setRoles([...roles, { key: "", label: "" }])}><Plus aria-hidden="true" size={14} />{t("Add role")}</Button>}
    </SettingsSection>
    {readOnly ? null : <SaveBar isDirty={dirty} isSaving={busy} isDisabled={roles.some((role) => !role.label.trim())} onDiscard={() => setRoles(data.settings.roles)}
      onSave={async () => { setBusy(true); await onSave(roles.map((role) => ({ key: role.key, label: role.label.trim() }))); setBusy(false); }} />}
  </>;
}

const CHECK_KINDS: CheckKind[] = ["confirm", "lead_assigned", "role_assigned", "payment_verified", "material_list_signed_off", "everything_ordered", "everything_made", "snags_closed",
  "no_critical_snags", "handover_accepted", "technical_measure_done", "drawings_uploaded", "drawings_site_checked", "drawings_design_checked", "drawings_client_approved",
  "factory_slot_booked", "installation_scheduled", "permit_collected", "goods_delivered", "installation_done"];

const MOMENTS: KeepInformedEvent[] = ["drawings_started", "production_started", "installation_scheduled"];

/** PLM-055: the roles told at a project's key moments (the designer, so the design is followed to handover). */
function KeepInformed({ data, onSave }: { data: SettingsState; onSave: (keepInformed: Record<KeepInformedEvent, string[]>) => Promise<boolean> }) {
  const t = useT();
  const stored = data.settings.keepInformed ?? { drawings_started: [], production_started: [], installation_scheduled: [] };
  const [value, setValue] = useState(stored);
  const [busy, setBusy] = useState(false);
  const readOnly = !data.canManage;
  const dirty = JSON.stringify(value) !== JSON.stringify(stored);
  const label: Record<KeepInformedEvent, string> = { drawings_started: t("Technical drawings started"), production_started: t("Production started"),
    installation_scheduled: t("Installation scheduled") };
  const items = data.settings.roles.map((role) => ({ id: role.key, label: t(role.label as never) }));
  return <>
    <SettingsSection id="keep-informed" title={t("Keep informed")}>
      {MOMENTS.map((moment) => <SettingsRow key={moment} label={label[moment]}>
        <MultiSelectField label={label[moment]} isDisabled={readOnly} items={items} selectedKeys={new Set(value[moment])}
          onSelectionChange={(keys) => setValue({ ...value, [moment]: items.map((item) => item.id).filter((id) => keys.has(id)) })} />
      </SettingsRow>)}
    </SettingsSection>
    {readOnly ? null : <SaveBar isDirty={dirty} isSaving={busy} onDiscard={() => setValue(stored)}
      onSave={async () => { setBusy(true); await onSave(value); setBusy(false); }} />}
  </>;
}

function RouteEditor({ route, roles, readOnly, onClose, onSave, onArchive }: {
  route: ProjectRoute | null; roles: ProjectRole[]; readOnly: boolean; onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>; onArchive: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(route?.name ?? "");
  const [isDefault, setIsDefault] = useState(route?.isDefault ?? false);
  const [stages, setStages] = useState<RouteStage[]>(route?.stages ?? [{ key: "", name: "", ownerRole: LEAD, checks: [] }, { key: "", name: "", ownerRole: LEAD, checks: [] }]);
  const [busy, setBusy] = useState(false);
  const kindLabel: Record<CheckKind, string> = { confirm: t("Someone confirms"), lead_assigned: t("Project manager named"), role_assigned: t("A role is named"), payment_verified: t("Production payment verified"), material_list_signed_off: t("Client signed off the material list"), everything_ordered: t("Everything is ordered"),
    everything_made: t("Everything is made and checked"), snags_closed: t("All snags closed"), no_critical_snags: t("No critical snag open"),
    handover_accepted: t("The client accepted the handover"), drawings_uploaded: t("Technical drawings uploaded"), drawings_site_checked: t("Technical site check passed"),
    drawings_client_approved: t("Client approved the drawings"), factory_slot_booked: t("Factory slot booked"),
    installation_scheduled: t("Installation scheduled"), goods_delivered: t("Everything delivered"), installation_done: t("Installation signed off"),
    permit_collected: t("Building permit collected"), technical_measure_done: t("Technical site measure done"), drawings_design_checked: t("Drawings match the design") };
  const roleItems = roles.map((role) => ({ id: role.key, label: role.label }));
  const update = (index: number, patch: Partial<RouteStage>) => setStages(stages.map((stage, at) => (at === index ? { ...stage, ...patch } : stage)));
  const move = (index: number, step: number) => { const next = [...stages]; const [item] = next.splice(index, 1); next.splice(index + step, 0, item); setStages(next); };
  const setCheck = (index: number, checkIndex: number, patch: Partial<StageCheck>) =>
    update(index, { checks: stages[index].checks.map((check, at) => (at === checkIndex ? { ...check, ...patch } : check)) });
  const valid = name.trim() && stages.length >= 2 && stages.every((stage) => stage.name.trim()
    && stage.checks.every((check) => (check.kind !== "confirm" || check.label?.trim()) && (check.kind !== "role_assigned" || check.role)));
  return <InspectorSheet isOpen size="lg" title={route ? route.name : t("New route")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={readOnly ? null : <div className="wd-dialog-actions">
      {route && !route.isDefault ? <Button variant="quiet" onPress={() => void onArchive(route.id)}>{t("Archive")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true); await onSave({ id: route?.id, version: route?.version, name: name.trim(), isDefault, stages }); setBusy(false); }}>{t("Save")}</Button>
    </div>}>
    <div className={styles.editor}>
      <TextInput label={t("Route name")} isRequired isReadOnly={readOnly} value={name} onChange={setName} />
      <Switch isDisabled={readOnly || route?.isDefault} isSelected={isDefault} onChange={setIsDefault}>{t("Use for new projects")}</Switch>
      <ol className={styles.stageList} aria-label={t("Stages")}>
        {stages.map((stage, index) => <li key={index}>
          <div className={styles.stageRow}>
            <span className={styles.stageNumber}>{index + 1}</span>
            <TextInput aria-label={t("Stage name")} label={null} placeholder={t("Stage name")} isReadOnly={readOnly} value={stage.name} onChange={(value) => update(index, { name: value })} />
            <SelectField aria-label={t("Owner")} label={null} accent="neutral" isDisabled={readOnly} placeholder={t("Owner")} selectedKey={stage.ownerRole ?? ""}
              onSelectionChange={(key) => update(index, { ownerRole: key ? String(key) : null })} items={[{ id: "", label: t("No owner") }, ...roleItems]} />
            {readOnly ? null : <span className={styles.rowTools}>
              <IconButton aria-label={t("Move up")} size="compact" variant="quiet" isDisabled={index === 0} onPress={() => move(index, -1)}><ArrowUp aria-hidden="true" size={14} /></IconButton>
              <IconButton aria-label={t("Move down")} size="compact" variant="quiet" isDisabled={index === stages.length - 1} onPress={() => move(index, 1)}><ArrowDown aria-hidden="true" size={14} /></IconButton>
              <IconButton aria-label={t("Remove {name}", { name: stage.name || t("stage") })} size="compact" variant="quiet" isDisabled={stages.length <= 2} onPress={() => setStages(stages.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={14} /></IconButton>
            </span>}
          </div>
          <ul className={styles.checkList} aria-label={t("What {stage} needs", { stage: stage.name || t("this stage") })}>
            {stage.checks.map((check, checkIndex) => <li key={checkIndex} data-wide={check.kind !== "confirm" && check.kind !== "role_assigned" || undefined}>
              <SelectField aria-label={t("Check")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={check.kind}
                onSelectionChange={(key) => setCheck(index, checkIndex, { kind: key as CheckKind, label: key === "confirm" ? check.label ?? "" : undefined, role: key === "role_assigned" ? check.role : undefined })}
                items={CHECK_KINDS.map((kind) => ({ id: kind, label: kindLabel[kind] }))} />
              {check.kind === "confirm" ? <TextInput aria-label={t("What they confirm")} label={null} placeholder={t("e.g. Client approved the drawings")} isReadOnly={readOnly} value={check.label ?? ""} onChange={(value) => setCheck(index, checkIndex, { label: value })} /> : null}
              {check.kind === "role_assigned" ? <SelectField aria-label={t("Role")} label={null} accent="neutral" isDisabled={readOnly} placeholder={t("Role")} selectedKey={check.role ?? null} onSelectionChange={(key) => setCheck(index, checkIndex, { role: String(key) })} items={roleItems} /> : null}
              {readOnly ? null : <IconButton aria-label={t("Remove check")} size="compact" variant="quiet" onPress={() => update(index, { checks: stage.checks.filter((_, at) => at !== checkIndex) })}><Trash2 aria-hidden="true" size={14} /></IconButton>}
            </li>)}
            {readOnly ? null : <li><Button size="compact" variant="quiet" onPress={() => update(index, { checks: [...stage.checks, { key: "", kind: "confirm", label: "" }] })}><Plus aria-hidden="true" size={14} />{t("Add check")}</Button></li>}
          </ul>
        </li>)}
      </ol>
      {readOnly ? null : <Button size="compact" variant="quiet" onPress={() => setStages([...stages, { key: "", name: "", ownerRole: null, checks: [] }])}><Plus aria-hidden="true" size={14} />{t("Add stage")}</Button>}
    </div>
  </InspectorSheet>;
}

/** Every stage the firm's routes use, by key, so a task can land in the project's matching stage. */
function routeStages(routes: ProjectRoute[]) {
  const seen = new Map<string, string>();
  for (const route of routes) for (const stage of route.stages) if (stage.key && !seen.has(stage.key)) seen.set(stage.key, stage.name);
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** The standard work for one way of delivering a package: each task's working days, role and stage. */
function WorkTemplateEditor({ template, title, roles, stages, readOnly, onClose, onSave }: {
  template: WorkTemplate; title: string; roles: ProjectRole[]; stages: Array<{ id: string; label: string }>; readOnly: boolean;
  onClose: () => void; onSave: (tasks: TemplateTask[]) => Promise<void>;
}) {
  const t = useT();
  const [tasks, setTasks] = useState<TemplateTask[]>(template.tasks);
  const [busy, setBusy] = useState(false);
  const update = (index: number, patch: Partial<TemplateTask>) => setTasks(tasks.map((task, at) => (at === index ? { ...task, ...patch } : task)));
  const move = (index: number, step: number) => { const next = [...tasks]; const [item] = next.splice(index, 1); next.splice(index + step, 0, item); setTasks(next.map((task, at) => (at === 0 ? { ...task, withPrevious: false } : task))); };
  const valid = tasks.every((task) => task.title.trim() && Number.isInteger(task.days) && task.days >= 1 && task.days <= 365);
  return <InspectorSheet isOpen size="lg" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={readOnly ? null : <div className="wd-dialog-actions">
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true); await onSave(tasks.map((task) => ({ ...task, title: task.title.trim() }))); setBusy(false); }}>{t("Save")}</Button>
    </div>}>
    <div className={styles.editor}>
      <ol className={styles.stageList} aria-label={t("Tasks")}>
        {tasks.map((task, index) => <li key={index}>
          <div className={styles.taskRow}>
            <span className={styles.stageNumber}>{index + 1}</span>
            <TextInput aria-label={t("Task")} label={null} placeholder={t("Task")} isReadOnly={readOnly} value={task.title} onChange={(value) => update(index, { title: value })} />
            <TextInput aria-label={t("Working days")} label={null} inputMode="numeric" isReadOnly={readOnly} value={String(task.days || "")} suffix={t("days")}
              onChange={(value) => update(index, { days: Number(value.replace(/\D/g, "").slice(0, 3)) })} />
            {readOnly ? null : <span className={styles.rowTools}>
              <IconButton aria-label={t("Move up")} size="compact" variant="quiet" isDisabled={index === 0} onPress={() => move(index, -1)}><ArrowUp aria-hidden="true" size={14} /></IconButton>
              <IconButton aria-label={t("Move down")} size="compact" variant="quiet" isDisabled={index === tasks.length - 1} onPress={() => move(index, 1)}><ArrowDown aria-hidden="true" size={14} /></IconButton>
              <IconButton aria-label={t("Remove {name}", { name: task.title || t("task") })} size="compact" variant="quiet" onPress={() => setTasks(tasks.filter((_, at) => at !== index).map((item, at) => (at === 0 ? { ...item, withPrevious: false } : item)))}><Trash2 aria-hidden="true" size={14} /></IconButton>
            </span>}
          </div>
          <div className={styles.taskDetails}>
            <SelectField aria-label={t("Who does it")} label={null} accent="neutral" isDisabled={readOnly} placeholder={t("Who does it")} selectedKey={task.role ?? ""}
              onSelectionChange={(key) => update(index, { role: key ? String(key) : null })} items={[{ id: "", label: t("No one yet") }, ...roles.map((role) => ({ id: role.key, label: role.label }))]} />
            <SelectField aria-label={t("Stage")} label={null} accent="neutral" isDisabled={readOnly} placeholder={t("Stage")} selectedKey={task.stage ?? ""}
              onSelectionChange={(key) => update(index, { stage: key ? String(key) : null })} items={[{ id: "", label: t("No stage") }, ...stages]} />
            {index > 0 ? <Switch isDisabled={readOnly} isSelected={task.withPrevious} onChange={(value) => update(index, { withPrevious: value })}>{t("Starts with the task before")}</Switch> : <span />}
            <Switch isDisabled={readOnly} isSelected={task.needsMaterials === true} onChange={(value) => update(index, { needsMaterials: value })}>{t("Needs the materials")}</Switch>
          </div>
        </li>)}
      </ol>
      {readOnly || tasks.length >= 30 ? null : <Button size="compact" variant="quiet" onPress={() => setTasks([...tasks, { title: "", days: 1, role: null, stage: null, withPrevious: false }])}><Plus aria-hidden="true" size={14} />{t("Add task")}</Button>}
    </div>
  </InspectorSheet>;
}
