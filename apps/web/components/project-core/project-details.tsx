"use client";

import Link from "next/link";
import { Avatar, MenuButton, Progress } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Priority, ProjectDetail } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import type { ProjectDialog } from "./project-header";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;

/**
 * The project's details, one click from the work: client, team by role, value, dates, plan progress, site
 * work, route and priority. The project manager edits them in place (the team and dates open their dialog).
 */
export function ProjectDetails({ detail, run, onDialog, planEnd }: { detail: ProjectDetail; run: Run; onDialog: (dialog: ProjectDialog) => void; planEnd?: string | null }) {
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
  const missing = detail.team.filter((role) => !role.member);
  const late = planEnd && project.promiseDate && planEnd > project.promiseDate;
  return <div className={styles.detailsPanel}>
    <dl className={styles.detailList}>
      <div><dt>{t("Client")}</dt><dd>{project.clientName}</dd></div>
      <div><dt>{t("Agreed value")}</dt><dd>
        <Link className={styles.detailLink} href={`/workspace/projects/${project.id}/scope`}>{format.money(project.total, project.currency)}</Link>
        {detail.seal ? <small>{t("Sealed {revision} · {date}", { revision: detail.seal.revisionLabel, date: format.when(detail.seal.acceptedAt) })}</small> : null}
      </dd></div>
      <div><dt>{t("Dates")}</dt><dd>
        {manage ? <button type="button" className={styles.propertyButton} onClick={() => onDialog("dates")}>{dateRange()}</button> : dateRange()}
        {late ? <small data-late>{t("The plan ends {date}", { date: format.short(planEnd) })}</small> : null}
      </dd></div>
      {/* A closed project's status says where it ended; the plan's share done is for work still going on. */}
      {detail.progress !== null && !["completed", "cancelled"].includes(project.status) ? <div><dt>{t("Progress")}</dt><dd>
        <Link className={styles.detailLink} href={`/workspace/projects/${project.id}/plan`}>{t("{percent}% done", { percent: detail.progress })}</Link>
        <Progress label={t("Progress")} value={detail.progress} />
      </dd></div> : null}
      <div><dt>{t("Site work")}</dt><dd>{project.siteStartedOn
        ? project.siteFinishedOn ? t("{from} – {to}", { from: format.short(project.siteStartedOn), to: format.short(project.siteFinishedOn) }) : t("Since {date}", { date: format.short(project.siteStartedOn) })
        : <span className={styles.muted}>{t("Not started")}</span>}</dd></div>
      <div><dt>{t("Priority")}</dt><dd>{manage
        ? <MenuButton size="compact" label={priorityLabel[project.priority]} onAction={(id) => void run("set_priority", { priority: id })}
            items={(["normal", "high", "critical"] as const).map((id) => ({ id, label: priorityLabel[id] }))} />
        : priorityLabel[project.priority]}</dd></div>
      {project.templateName ? <div><dt>{t("Route")}</dt><dd>{project.templateName}</dd></div> : null}
      <div><dt>{t("Planning")}</dt><dd><Link className={styles.detailLink} href={`/workspace/pre-projects/cases/${project.caseId}/overview`}>{project.opportunityReference ?? t("Open")}</Link></dd></div>
    </dl>
    <section className={styles.detailTeam} aria-label={t("Team")}>
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
    </section>
  </div>;

  function dateRange() {
    if (!project.startDate && !project.promiseDate) return <span className={styles.muted}>{t("Not set")}</span>;
    return t("{from} – {to}", { from: project.startDate ? format.short(project.startDate) : "…", to: project.promiseDate ? format.short(project.promiseDate) : "…" });
  }
}
