"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSection } from "@/lib/navigation/use-section";
import { ErrorState, InlineNotice, InspectorSheet, PageSkeleton, Tabs, useMediaQuery } from "@/design-system";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectSection } from "@/lib/project-core/sections";
import type { ProjectDetail } from "@/lib/project-core/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { CancelProjectDialog, ReopenProjectDialog } from "./project-close";
import { DatesDialog, HoldDialog, RenameDialog, ResumeDialog } from "./project-dialogs";
import { ProjectDetails } from "./project-details";
import { ProjectHeader, useNextAction, type ProjectDialog } from "./project-header";
import { ProjectOverview } from "./project-overview";
import { ProjectPlan } from "./project-plan";
import { ProjectScope } from "./project-scope";
import { ProjectHandoverTab, ProjectMoneyTab } from "./project-tab-views";
import { ProjectTeam } from "./project-team";
import { ProjectUpdates } from "./project-updates";
import { ProjectSite } from "../site/project-site";
import styles from "./project-core.module.css";

const PANEL_KEY = "wodana.project.details";
/** Wide enough for the details beside the work (the work keeps three quarters or more). */
const INLINE = "(min-width: 75rem)";
/** Wide enough to open the details by default. */
const ROOMY = "(min-width: 90rem)";

/** The details panel: open by default on a wide screen, remembered once someone opens or closes it. */
function useDetailsPanel() {
  const inline = useMediaQuery(INLINE);
  const roomy = useMediaQuery(ROOMY);
  const [choice, setChoice] = useState<"open" | "closed" | null>(null);
  useEffect(() => {
    queueMicrotask(() => { try { const saved = window.localStorage.getItem(PANEL_KEY); if (saved === "open" || saved === "closed") setChoice(saved); } catch { /* per-viewer convenience only */ } });
  }, []);
  const open = inline ? (choice ? choice === "open" : roomy) : choice === "open";
  const toggle = () => {
    const next = open ? "closed" : "open";
    setChoice(next);
    // On a narrow screen the panel is an overlay: opening it there isn't a lasting choice.
    if (inline) try { window.localStorage.setItem(PANEL_KEY, next); } catch { /* ignore */ }
  };
  const close = () => setChoice("closed");
  return { inline, open, toggle, close };
}

/**
 * One project: a one-line header with the next action, the work in tabs (Overview, Scope, Plan, Money, Site,
 * Handover, Updates) and the details in a side panel. Other people's changes on this project show without a
 * reload; a clash with someone else's change reloads it and says so.
 */
export function ProjectPage({ workspaceId, projectId, section: initialSection }: { workspaceId: string; projectId: string; section: ProjectSection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [refresh, setRefresh] = useState(0);
  const panel = useDetailsPanel();
  useWorkspaceBreadcrumb(detail ? detail.project.name : undefined);

  const load = useCallback(async () => {
    try { setDetail(await api.get(projectId)); setError(""); setRefresh((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("The project didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Someone else's change on this project (a stage, a report, a decision in the portal) shows without a reload.
  useLiveInvalidate(workspaceId, [`project:${projectId}`], () => { if (!dialog) void load(); });

  /** Runs one change; a clash with someone else's change reloads the project and says so. */
  const run = useCallback(async (action: string, input: Record<string, unknown> = {}) => {
    if (!detail) return false;
    setNotice("");
    try { setDetail(await api.command(projectId, detail.project.version, action, input)); setRefresh((value) => value + 1); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  }, [api, detail, load, projectId, t]);
  const next = useNextAction(detail ?? placeholder, run, (value) => setDialog(value));

  if (error && !detail) return <div className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!detail) return <div className={styles.page}><PageSkeleton variant="detail" tabs={7} /></div>;
  const { project } = detail;
  const rights = detail.money ?? { costs: detail.canSeeMoney, margin: detail.canSeeMoney, client: detail.canSeeMoney };
  const go = (value: ProjectSection) => move(value, `/workspace/projects/${projectId}${value === "overview" ? "" : `/${value}`}`);
  const details = <ProjectDetails detail={detail} run={run} onDialog={setDialog} />;

  return <div className={styles.page} data-details={panel.open && panel.inline ? "open" : undefined}>
    <ProjectHeader detail={detail} next={next} detailsOpen={panel.open && panel.inline} onToggleDetails={panel.toggle} onDialog={setDialog} />
    <div className={styles.layout}>
      <div className={styles.work}>
        {notice ? <InlineNotice tone="error" message={notice} /> : null}
        <Tabs tour="project-tab" selectedKey={section} onSelectionChange={(key) => go(key as ProjectSection)} items={[
          { id: "overview", label: t("Overview"), panel: <ProjectOverview api={api} detail={detail} run={run} onTeam={() => setDialog("team")} refreshKey={refresh} /> },
          { id: "scope", label: t("Scope"), panel: <ProjectScope workspaceId={workspaceId} projectId={projectId} version={project.version} run={run} /> },
          { id: "plan", label: t("Plan"), panel: <ProjectPlan workspaceId={workspaceId} projectId={projectId} /> },
          { id: "money", label: t("Money"), panel: <ProjectMoneyTab workspaceId={workspaceId} projectId={projectId} rights={rights} /> },
          { id: "site", label: t("Site"), panel: <ProjectSite workspaceId={workspaceId} projectId={projectId} projectName={[project.reference, project.name].filter(Boolean).join(" · ")} /> },
          { id: "handover", label: t("Handover"), panel: <ProjectHandoverTab workspaceId={workspaceId} projectId={projectId} detail={detail} /> },
          { id: "updates", label: t("Updates"), panel: <ProjectUpdates detail={detail} run={run} workspaceId={workspaceId} projectId={projectId} /> },
        ]} />
      </div>
      {panel.inline && panel.open ? <aside className={styles.details} aria-label={t("Details")}>{details}</aside> : null}
    </div>
    {!panel.inline ? <InspectorSheet isOpen={panel.open} title={t("Details")} size="sm" onOpenChange={(open) => { if (!open) panel.close(); }}>{details}</InspectorSheet> : null}

    {dialog === "team" ? <ProjectTeam detail={detail} run={run} onClose={() => setDialog(null)} /> : null}
    {dialog === "hold" ? <HoldDialog onClose={() => setDialog(null)} onSave={async (reason, reviewOn) => { if (await run("hold", { reason, reviewOn })) setDialog(null); }} /> : null}
    {dialog === "resume" ? <ResumeDialog hold={detail.hold ?? null} onClose={() => setDialog(null)} onSave={async (shiftDates) => { if (await run("resume", { shiftDates })) setDialog(null); }} /> : null}
    {dialog === "dates" ? <DatesDialog startDate={project.startDate} promiseDate={project.promiseDate} onClose={() => setDialog(null)}
      onSave={async (startDate, promiseDate) => { if (await run("set_dates", { startDate, promiseDate })) setDialog(null); }} /> : null}
    {dialog === "cancel" ? <CancelProjectDialog api={api} projectId={projectId} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run("cancel", { reason })) setDialog(null); }} /> : null}
    {dialog === "reopen" ? <ReopenProjectDialog onClose={() => setDialog(null)} onSave={async (reason) => { if (await run("reopen", { reason })) setDialog(null); }} /> : null}
    {dialog === "rename" ? <RenameDialog name={project.name} onClose={() => setDialog(null)} onSave={async (name) => { if (await run("rename", { name })) setDialog(null); }} /> : null}
  </div>;
}

/** Hooks run before the project has loaded; nothing is shown for it. */
const placeholder = {
  project: { id: "", status: "archived", caseId: "", promiseDate: null }, stages: [], team: [], roles: [], canManage: false, canClose: false,
} as unknown as ProjectDetail;
