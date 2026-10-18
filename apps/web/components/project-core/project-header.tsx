"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Badge, Button, EditableField, IconButton, IconMenuButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Health, ProjectDetail } from "@/lib/project-core/types";
import { useProjectFormat, useStatusLabel } from "./format";
import styles from "./project-core.module.css";

export type ProjectDialog = "team" | "hold" | "resume" | "dates" | "rename" | "cancel" | "reopen" | "finish_stage" | "confirm_check" | "factory_slot" | "installation" | "permit" | "delivery_crew" | "installation_crew";
type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

/** The one thing to do next on this project, for this person: a command, a dialog, or a link to where it's done. */
export type NextAction = { label: string; ariaLabel?: string; href?: string; press?: () => void };

export function useNextAction(detail: ProjectDetail, run: Run, open: (dialog: ProjectDialog) => void): NextAction | null {
  const t = useT();
  const { project } = detail;
  const base = `/workspace/projects/${project.id}`;
  if (project.status === "on_hold") return detail.canManage ? { label: t("Resume"), press: () => open("resume") } : null;
  if (project.status !== "active") return null;
  const current = detail.stages.find((stage) => stage.status === "current");
  if (!current) return null;
  // The same words as the stage's own button on the Overview, so one action never has two names.
  if (current.ready && current.canWork) return { label: t("Finish {stage}", { stage: t(current.name as never) }), press: () => open("finish_stage") };
  const check = current.checks.find((item) => !item.passed);
  if (!check) return null;
  switch (check.kind) {
    // Named for what it confirms, so the button reads on its own.
    case "confirm": return current.canWork ? { label: t("Confirm: {check}", { check: t(check.label as never) }), press: () => open("confirm_check") } : null;
    case "lead_assigned": case "role_assigned": return detail.canManage ? { label: t("Name someone"), press: () => open("team") } : null;
    case "payment_verified": return { label: t("Open payments"), href: `${base}/money?view=client` };
    case "material_list_signed_off": return { label: t("Material list"), href: `${base}/scope?view=materials` };
    case "everything_ordered": return { label: t("To order"), href: `/workspace/purchasing?project=${project.id}` };
    case "everything_made": return { label: t("Open factory"), href: `/workspace/factory?project=${project.id}` };
    case "snags_closed": case "no_critical_snags": return { label: t("Open snags"), href: `${base}/plan?filter=snags` };
    case "handover_accepted": return { label: t("Open handover"), href: `${base}/handover` };
    case "drawings_uploaded": case "drawings_site_checked": case "drawings_design_checked": case "drawings_client_approved": case "technical_measure_done":
      return { label: t("Open the drawings"), href: `${base}/scope?view=drawings` };
    case "factory_slot_booked": return detail.canBookSlot ? { label: t("Book the factory slot"), press: () => open("factory_slot") } : null;
    case "installation_scheduled": return detail.canScheduleInstallation ? { label: t("Schedule delivery and installation"), press: () => open("installation") } : null;
    case "permit_collected": return detail.canScheduleInstallation ? { label: t("Record the building permit"), press: () => open("permit") } : null;
    case "goods_delivered": return { label: t("Open stock"), href: `/workspace/inventory?project=${project.id}` };
    case "installation_done": return { label: t("Open the site"), href: `${base}/site` };
    default: return null;
  }
}

/**
 * The project in one line: its name, number, status, stage and handover — and, while the details panel is
 * closed, its client, project manager and agreed value. One primary action (what's next for this person),
 * the details toggle and the project's other actions in ⋯. A second line only when it's on hold or closed.
 */
export function ProjectHeader({ detail, next, detailsOpen, onToggleDetails, onDialog, onAction, onRename, onReload, health, record = false }: {
  detail: ProjectDetail; next: NextAction | null; detailsOpen: boolean; onToggleDetails: () => void; onDialog: (dialog: ProjectDialog) => void; onAction?: () => void;
  /** The health from the records (late work, a missed handover), when the Overview's read has it. */
  health?: Health;
  /** On the Overview the record's strip and sidebar carry the facts and the details: the header keeps the title, number, status and ⋯. */
  record?: boolean;
  /** Renames the project in place (the name is its title); throws the reason back to the title. */
  onRename?: (name: string) => Promise<void>; onReload?: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const statusLabel = useStatusLabel();
  const { project } = detail;
  const status = statusLabel(project.status, health ?? project.health);
  const tone = status.tone === "ok" ? "success" : status.tone === "risk" ? "warning" : status.tone === "off" ? "danger" : status.tone === "done" ? "info" : "neutral";
  const current = detail.stages.find((stage) => stage.status === "current");
  const until = project.status === "active" || project.status === "on_hold" ? format.until(project.promiseDate) : null;
  const lead = detail.team.find((role) => role.role === "project_manager")?.member ?? null;
  const open = project.status === "active" || project.status === "on_hold";
  const manage = detail.canManage;
  const actions = [
    ...(open && manage ? [{ id: "dates", label: t("Change dates") }] : []),
    ...(project.status === "active" && manage ? [{ id: "hold", label: t("Put on hold") }] : []),
    ...(project.status === "on_hold" && manage ? [{ id: "resume", label: t("Resume") }] : []),
    ...(open && detail.canClose ? [{ id: "cancel", label: t("Cancel the project") }] : []),
    ...(project.status === "completed" && detail.canClose ? [{ id: "reopen", label: t("Reopen") }] : []),
  ];
  // The second line: only when the project is on hold or closed, with why, when and by whom.
  const closed = [project.closedAt ? format.when(project.closedAt) : null, project.closedByName];
  const state = project.status === "on_hold" ? { tone: "hold", title: t("On hold"), text: [project.holdReason, project.holdReviewOn ? t("Review on {date}", { date: format.day(project.holdReviewOn) }) : null].filter(Boolean).join(" · ") }
    : project.status === "cancelled" ? { tone: "closed", title: t("Cancelled"), text: [project.cancelReason, ...closed].filter(Boolean).join(" · ") }
    : project.status === "completed" ? { tone: "done", title: t("Completed"), text: closed.filter(Boolean).join(" · ") } : null;
  const priority = project.priority === "critical" ? t("Critical") : project.priority === "high" ? t("High") : null;
  const facts = [
    current ? <span key="stage" className={styles.headFact}>{t("{stage} · {position} of {count}", { stage: t(current.name as never), position: current.position + 1, count: detail.stages.length })}</span> : null,
    project.promiseDate ? <span key="handover" className={styles.headFact}>{t("Handover {date}", { date: format.short(project.promiseDate) })}
      {until ? <span className={styles.muted} data-late={until.late || undefined}> · {until.text}</span> : null}</span> : null,
    ...(detailsOpen ? [] : [
      <span key="client" className={styles.headFact} data-extra>{project.clientName}</span>,
      lead ? <span key="lead" className={styles.headFact} data-extra>{lead.name}</span> : null,
      project.total !== null ? <span key="value" className={`${styles.headFact} ${styles.number}`} data-extra>{format.money(project.total, project.currency)}</span> : null,
    ]),
  ].filter(Boolean);
  const shownFacts = record ? [] : facts;

  return <header className={styles.head} data-tour="project-properties" data-record={record || undefined}>
    <div className={styles.headLine}>
      <div className={styles.headTitle}>
        <EditableField canEdit={Boolean(onRename) && open && manage} heading="h1" isRequired label={t("Project name")} maxLength={240} onReload={onReload} onSave={(name) => onRename?.(name)} value={project.name} />
        <span className={styles.reference}>{project.reference}</span>
        <Badge tone={tone}>{status.label}</Badge>
        {priority ? <Badge tone={project.priority === "critical" ? "danger" : "warning"}>{priority}</Badge> : null}
        {shownFacts.length ? <span className={styles.headFacts}>{shownFacts}</span> : null}
      </div>
      <div className={styles.headActions}>
        {next ? next.href
          ? <Link className="wd-button" data-variant="primary" data-size="compact" href={next.href} aria-label={next.ariaLabel}>{next.label}</Link>
          : <Button size="compact" variant="primary" aria-label={next.ariaLabel} onPress={() => { next.press?.(); onAction?.(); }}>{next.label}</Button> : null}
        {record ? null : <IconButton aria-label={detailsOpen ? t("Hide details") : t("Show details")} aria-pressed={detailsOpen} onPress={onToggleDetails}><Info aria-hidden="true" size={16} /></IconButton>}
        {actions.length ? <IconMenuButton ariaLabel={t("Project actions")} onAction={(id) => onDialog(id as ProjectDialog)} items={actions} /> : null}
      </div>
    </div>
    {/* On the Overview the next-step card says why it's on hold or how it closed. */}
    {state && !record ? <p className={styles.headState} data-tone={state.tone}><strong>{state.title}</strong><span>{state.text}</span></p> : null}
  </header>;
}
