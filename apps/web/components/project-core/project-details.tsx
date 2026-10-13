"use client";

import Link from "next/link";
import { Avatar, EditableField, Progress } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Priority, ProjectDetail } from "@/lib/project-core/types";
import { projectPercent } from "@/lib/project-core/project-record";
import { useProjectFormat } from "./format";
import type { ProjectDialog } from "./project-header";
import styles from "./project-core.module.css";

/** One in-place change through the project's command (throws the reason back to the field). */
type Save = (action: string, input: Record<string, unknown>) => Promise<void>;

/**
 * The project's details, one click from the work: client, team by role, value, dates, plan progress, site
 * work, route and priority. The project manager edits dates and priority in place; the team opens its dialog.
 */
export function ProjectDetails({ detail, save, onReload, onDialog, planEnd, compact = false }: {
  detail: ProjectDetail; save: Save; onReload: () => void; onDialog: (dialog: ProjectDialog) => void; planEnd?: string | null;
  /** In the record's Details tab: only what isn't on its Overview (client, team, progress and site work are). */
  compact?: boolean;
}) {
  const t = useT();
  const format = useProjectFormat();
  const { project } = detail;
  const open = project.status === "active" || project.status === "on_hold";
  const manage = detail.canManage && open;
  const priorityLabel: Record<Priority, string> = { normal: t("Normal"), high: t("High"), critical: t("Critical") };
  // One line per person, with every role they hold.
  const named = [...detail.team.filter((role) => role.member).reduce((people, role) => {
    const entry = people.get(role.member!.membershipId) ?? { name: role.member!.name, roles: [] as string[] };
    entry.roles.push(t(role.label as never));
    return people.set(role.member!.membershipId, entry);
  }, new Map<string, { name: string; roles: string[] }>())];
  const missing = detail.team.filter((role) => !role.member && !role.notApplicable);
  const late = planEnd && project.promiseDate && planEnd > project.promiseDate;
  // The plan's measure, never below the stages already behind the project.
  const percent = projectPercent(detail);
  return <div className={styles.detailsPanel}>
    <dl className={styles.detailList} data-layout="stacked">
      {compact ? null : <div><dt>{t("Client")}</dt><dd>{project.clientName}</dd></div>}
      {/* QA-006: the agreed value only for the people who see it (the server sends none to the rest). */}
      {project.total !== null ? <div><dt>{t("Agreed value")}</dt><dd>
        <Link className={styles.detailLink} href={`/workspace/projects/${project.id}/scope`}>{format.money(project.total, project.currency)}</Link>
        {detail.seal ? <small>{t("Sealed {revision} · {date}", { revision: detail.seal.revisionLabel, date: format.when(detail.seal.acceptedAt) })}</small> : null}
      </dd></div> : null}
      <EditableField canEdit={manage} display={project.startDate ? format.short(project.startDate) : undefined} kind="date" label={t("Start")} onReload={onReload}
        onSave={(startDate) => save("set_dates", { startDate: startDate || null })} placeholder={t("Not set")} value={project.startDate ?? ""} />
      <EditableField canEdit={manage} display={project.promiseDate ? format.short(project.promiseDate) : undefined} kind="date" label={t("Handover")} onReload={onReload}
        onSave={(promiseDate) => save("set_dates", { promiseDate: promiseDate || null })} placeholder={t("Not set")}
        validate={(promiseDate) => promiseDate && project.startDate && promiseDate < project.startDate ? t("Handover can't be before the start.") : null} value={project.promiseDate ?? ""} />
      {late ? <div><dt className="wd-visually-hidden">{t("Plan")}</dt><dd><small data-late>{t("The plan ends {date}", { date: format.short(planEnd) })}</small></dd></div> : null}
      {/* A closed project's status says where it ended; the plan's share done is for work still going on. */}
      {!compact && percent !== null && !["completed", "cancelled"].includes(project.status) ? <div><dt>{t("Progress")}</dt><dd>
        <Link className={styles.detailLink} href={`/workspace/projects/${project.id}/plan`}>{t("{percent}% done", { percent })}</Link>
        <Progress label={t("Progress")} value={percent} />
      </dd></div> : null}
      {compact ? null : <div><dt>{t("Site work")}</dt><dd>{project.siteStartedOn
        ? project.siteFinishedOn ? t("{from} – {to}", { from: format.short(project.siteStartedOn), to: format.short(project.siteFinishedOn) }) : t("Since {date}", { date: format.short(project.siteStartedOn) })
        : <span className={styles.muted}>{t("Not started")}</span>}</dd></div>}
      <EditableField canEdit={manage} items={(["normal", "high", "critical"] as const).map((id) => ({ id, label: priorityLabel[id] }))} kind="select" label={t("Priority")}
        onReload={onReload} onSave={(priority) => save("set_priority", { priority })} value={project.priority} />
      {/* PLM-068: the factory slot, when the route asks for one or a slot is booked. */}
      {detail.drawings?.factorySlot || detail.factorySlot ? <div><dt>{t("Factory slot")}</dt><dd>
        {detail.factorySlot ? format.short(detail.factorySlot.date) : <span className={styles.muted}>{t("Not booked")}</span>}
        {detail.factorySlot?.note ? <small>{detail.factorySlot.note}</small> : null}
        {detail.canBookSlot ? <button type="button" className={styles.panelAction} onClick={() => onDialog("factory_slot")}>{detail.factorySlot ? t("Change") : t("Book the factory slot")}</button> : null}
      </dd></div> : null}
      {project.templateName ? <div><dt>{t("Route")}</dt><dd>{project.templateName}</dd></div> : null}
      <div><dt>{t("Planning")}</dt><dd><Link className={styles.detailLink} href={`/workspace/pre-projects/cases/${project.caseId}/overview`}>{project.opportunityReference ?? t("Open")}</Link></dd></div>
    </dl>
    {compact ? null : <section className={styles.detailTeam} aria-label={t("Team")}>
      <div className={styles.detailHeading}>
        <h2>{t("Team")}</h2>
        {manage ? <button type="button" className={styles.panelAction} onClick={() => onDialog("team")}>{t("Edit")}</button> : null}
      </div>
      <ul>
        {named.map(([id, person]) => <li key={id}>
          <Avatar name={person.name} seed={person.name} size="sm" />
          <span><span>{person.name}</span><small>{person.roles.join(", ")}</small></span>
        </li>)}
      </ul>
      {missing.length ? <p className={styles.muted}>{t("Not named: {roles}", { roles: missing.map((role) => t(role.label as never)).join(", ") })}</p> : null}
    </section>}
  </div>;
}
