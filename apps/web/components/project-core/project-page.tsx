"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Avatar, AvatarGroup, Button, Callout, ControlledModalDialog, DateField, ErrorState, IconMenuButton, InlineNotice, MenuButton, Skeleton, Tabs, TextAreaField, TextInput } from "@/design-system";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectSection } from "@/lib/project-core/sections";
import type { Priority, ProjectDetail } from "@/lib/project-core/types";
import { useProjectFormat, useStatusLabel } from "./format";
import { ProjectPlan } from "./project-plan";
import { ProjectScope } from "./project-scope";
import { ProjectStages } from "./project-stages";
import { ProjectTeam } from "./project-team";
import { ProjectUpdates } from "./project-updates";
import styles from "./project-core.module.css";


/**
 * One project: its name and properties at the top (like a Notion page), then one thing per tab —
 * the stages and what each needs (Overview), the sealed scope (Scope), the work (Plan) and the lead's
 * updates (Updates).
 */
export function ProjectPage({ workspaceId, projectId, section }: { workspaceId: string; projectId: string; section: ProjectSection }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const statusLabel = useStatusLabel();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"team" | "hold" | "dates" | "rename" | null>(null);
  useWorkspaceBreadcrumb(detail ? detail.project.name : undefined);

  const load = useCallback(async () => {
    try { setDetail(await api.get(projectId)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("The project didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  /** Runs one change; a clash with someone else's change reloads the project and says so. */
  const run = useCallback(async (action: string, input: Record<string, unknown> = {}) => {
    if (!detail) return false;
    setNotice("");
    try { setDetail(await api.command(projectId, detail.project.version, action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  }, [api, detail, load, projectId, t]);

  if (error && !detail) return <div className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!detail) return <div className={styles.page}><Skeleton lines={8} /></div>;
  const { project } = detail;
  const status = statusLabel(project.status, project.health);
  const lead = detail.team.find((role) => role.role === "project_manager")?.member ?? null;
  const people = detail.team.filter((role) => role.member);
  const until = project.status === "active" ? format.until(project.promiseDate) : null;
  const current = detail.stages.find((stage) => stage.status === "current");
  const manage = detail.canManage;
  const priorityLabel: Record<Priority, string> = { normal: t("Normal"), high: t("High"), critical: t("Critical") };
  const go = (next: ProjectSection) => router.replace(`/workspace/projects/${projectId}${next === "overview" ? "" : `/${next}`}`, { scroll: false });

  return <div className={styles.page}>
    <header className={styles.projectHead}>
      <h1>{project.name}</h1>
      {manage ? <IconMenuButton ariaLabel={t("Project actions")} onAction={(id) => setDialog(id as "rename" | "hold")}
        items={[{ id: "rename", label: t("Rename") }, ...(project.status === "active" ? [{ id: "hold", label: t("Put on hold") }] : [])]} /> : null}
    </header>

    {project.status === "on_hold" ? <Callout tone="warning" title={t("On hold")}
      actions={manage ? <Button size="compact" onPress={() => void run("resume")}>{t("Resume")}</Button> : null}>
      {project.holdReason}{project.holdReviewOn ? ` · ${t("Review on {date}", { date: format.day(project.holdReviewOn) })}` : ""}
    </Callout> : null}

    <dl className={styles.properties}>
      <div><dt>{t("Client")}</dt><dd>{project.clientName}</dd></div>
      <div><dt>{t("Project number")}</dt><dd>{project.reference}</dd></div>
      <div><dt>{t("Stage")}</dt><dd>{current ? <>{current.name} <span className={styles.muted}>{t("{position} of {count}", { position: current.position + 1, count: detail.stages.length })}</span></> : status.label}</dd></div>
      <div><dt>{t("Status")}</dt><dd><button type="button" className={styles.propertyButton} onClick={() => go("updates")}><span className={styles.status} data-tone={status.tone}>{status.label}</span></button></dd></div>
      <div><dt>{t("Priority")}</dt><dd>{manage
        ? <MenuButton size="compact" label={priorityLabel[project.priority]} onAction={(id) => void run("set_priority", { priority: id })}
            items={(["normal", "high", "critical"] as const).map((id) => ({ id, label: priorityLabel[id] }))} />
        : priorityLabel[project.priority]}</dd></div>
      <div><dt>{t("Project manager")}</dt><dd><button type="button" className={styles.propertyButton} onClick={() => setDialog("team")}>{lead?.name ?? t("Not named")}</button></dd></div>
      <div><dt>{t("Team")}</dt><dd><button type="button" className={styles.propertyButton} onClick={() => setDialog("team")} aria-label={t("Team, {count} people", { count: people.length })}>
        <AvatarGroup label={t("Team")}>{people.slice(0, 5).map((role) => <Avatar key={role.role} name={role.member!.name} size="sm" />)}</AvatarGroup>
        <span className={styles.muted}>{t("{count} roles", { count: people.length })}</span>
      </button></dd></div>
      <div><dt>{t("Handover")}</dt><dd><button type="button" className={styles.propertyButton} disabled={!manage} onClick={() => setDialog("dates")}>
        {project.promiseDate ? <>{format.day(project.promiseDate)}{until ? <span className={styles.muted} data-late={until.late || undefined}> · {until.text}</span> : null}</> : <span className={styles.muted}>{t("Not set")}</span>}
      </button></dd></div>
      <div><dt>{t("Agreed value")}</dt><dd><button type="button" className={styles.propertyButton} onClick={() => go("scope")}>
        {format.money(project.total, project.currency)}{detail.seal ? <span className={styles.muted}> · {t("Sealed {revision}", { revision: detail.seal.revisionLabel })}</span> : null}
      </button></dd></div>
    </dl>

    {notice ? <InlineNotice tone="error" message={notice} /> : null}

    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as ProjectSection)} items={[
      { id: "overview", label: t("Overview"), panel: <ProjectStages detail={detail} run={run} caseHref={(part) => `/workspace/pre-projects/cases/${project.caseId}/${part}`} onTeam={() => setDialog("team")} /> },
      { id: "scope", label: t("Scope"), panel: <ProjectScope workspaceId={workspaceId} projectId={projectId} version={project.version} run={run} /> },
      { id: "plan", label: t("Plan"), panel: <ProjectPlan workspaceId={workspaceId} projectId={projectId} /> },
      { id: "updates", label: t("Updates"), panel: <ProjectUpdates detail={detail} run={run} /> },
    ]} />

    {dialog === "team" ? <ProjectTeam detail={detail} run={run} onClose={() => setDialog(null)} /> : null}
    {dialog === "hold" ? <HoldDialog onClose={() => setDialog(null)} onSave={async (reason, reviewOn) => { if (await run("hold", { reason, reviewOn })) setDialog(null); }} /> : null}
    {dialog === "dates" ? <DatesDialog startDate={project.startDate} promiseDate={project.promiseDate} onClose={() => setDialog(null)}
      onSave={async (startDate, promiseDate) => { if (await run("set_dates", { startDate, promiseDate })) setDialog(null); }} /> : null}
    {dialog === "rename" ? <RenameDialog name={project.name} onClose={() => setDialog(null)} onSave={async (name) => { if (await run("rename", { name })) setDialog(null); }} /> : null}
  </div>;
}

function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string, reviewOn: string | null) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [reviewOn, setReviewOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Put on hold")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim(), reviewOn); setBusy(false); }}>{t("Put on hold")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextAreaField label={t("Why")} isRequired value={reason} onChange={setReason} />
      <DateField label={t("Review on")} value={reviewOn ? parseDate(reviewOn) : null} onChange={(value) => setReviewOn(value ? value.toString() : null)} />
    </div>
  </ControlledModalDialog>;
}

function DatesDialog({ startDate, promiseDate, onClose, onSave }: { startDate: string | null; promiseDate: string | null; onClose: () => void; onSave: (start: string | null, promise: string | null) => Promise<void> }) {
  const t = useT();
  const [start, setStart] = useState(startDate);
  const [promise, setPromise] = useState(promiseDate);
  const [busy, setBusy] = useState(false);
  const valid = !start || !promise || promise >= start;
  return <ControlledModalDialog isOpen size="md" title={t("Dates")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true); await onSave(start, promise); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.pair}>
      <DateField label={t("Start date")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
      <DateField label={t("Handover date")} value={promise ? parseDate(promise) : null} onChange={(value) => setPromise(value ? value.toString() : null)}
        isInvalid={!valid} errorMessage={valid ? undefined : t("The handover date can't be before the start date.")} />
    </div>
  </ControlledModalDialog>;
}

function RenameDialog({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Rename")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!value.trim()} onPress={async () => { setBusy(true); await onSave(value.trim()); setBusy(false); }}>{t("Save")}</Button></div>}>
    <TextInput label={t("Project name")} value={value} onChange={setValue} isRequired autoFocus />
  </ControlledModalDialog>;
}
