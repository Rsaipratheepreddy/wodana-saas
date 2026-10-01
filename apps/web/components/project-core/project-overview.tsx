"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { ErrorState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { ActivityRow, Blocker, BlockerKey, ProjectDetail, ProjectOverview as Overview } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { ProjectStages } from "./project-stages";
import styles from "./project-overview.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

/**
 * A project at a glance: what's next and who acts, what holds it up (each blocker opens its filtered list),
 * the stage journey with each stage's planned dates, the key dates and money, and the latest activity.
 */
export function ProjectOverview({ api, detail, run, onTeam, refreshKey }: { api: ProjectApi; detail: ProjectDetail; run: Run; onTeam: () => void; refreshKey: number }) {
  const t = useT();
  const format = useProjectFormat();
  const projectId = detail.project.id;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setOverview(await api.overview(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The overview didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey, detail.project.version]);
  const blockerLabel = useBlockerLabels();
  const running = detail.project.status === "active";
  const current = detail.stages.find((stage) => stage.status === "current");
  const next = detail.next;
  const plan = current && overview ? overview.stagePlan[current.id] : undefined;
  const lateBy = plan?.end && overview && plan.open > 0 && plan.end < overview.today ? Math.round((Date.parse(`${overview.today}T00:00:00Z`) - Date.parse(`${plan.end}T00:00:00Z`)) / 86_400_000) : 0;

  return <div className={styles.overview}>
    {running && next ? <section className={styles.next} aria-label={t("Next")}>
      <span className={styles.nextLabel}>{t("Next")}</span>
      <span className={styles.nextText}>{t(next.text as never)}</span>
      <span className={styles.nextWho}>{next.owner ?? (next.role ? t("{role} · not named", { role: t((detail.roles.find((role) => role.key === next.role)?.label ?? next.role) as never) }) : next.kind === "payment_verified" ? t("Finance") : "")}</span>
      {lateBy ? <span className={styles.late}>{t("{stage} is {count} days past its plan", { stage: t(next.stage as never), count: lateBy })}</span> : null}
    </section> : null}

    {error && !overview ? <ErrorState description={error} onRetry={() => void load()} /> : !overview ? <Skeleton lines={2} shape="rows" />
      : running || detail.project.status === "on_hold" ? <section className={styles.blockers} aria-label={t("Needs attention")}>
        <h2>{t("Needs attention")}</h2>
        {overview.blockers.length ? <ul>{overview.blockers.map((blocker) => <BlockerRow key={blocker.key} label={blockerLabel(blocker.key, blocker.count)}
          blocker={blocker.key === "reports_missing" ? { ...blocker, items: blocker.items.map((day) => format.short(day)) } : blocker} />)}</ul>
          : <p className={styles.clear}><CircleCheck aria-hidden="true" size={16} />{t("Nothing is holding the project up.")}</p>}
      </section> : null}

    <section className={styles.section} aria-label={t("Stages")}>
      <h2>{t("Stages")}</h2>
      <ProjectStages detail={detail} run={run} onTeam={onTeam} plan={overview?.stagePlan} today={overview?.today} api={api} />
    </section>

    {overview ? <div className={styles.glance}>
      <section aria-label={t("Dates")}>
        <h2>{t("Dates")}</h2>
        <dl>
          <div><dt>{t("Start")}</dt><dd>{overview.dates.start ? format.day(overview.dates.start) : <span className={styles.muted}>{t("Not set")}</span>}</dd></div>
          <div><dt>{t("Handover")}</dt><dd>{overview.dates.promise ? format.day(overview.dates.promise) : <span className={styles.muted}>{t("Not set")}</span>}</dd></div>
          <div><dt>{t("Plan ends")}</dt><dd data-late={overview.dates.planEnd && overview.dates.promise && overview.dates.planEnd > overview.dates.promise || undefined}>
            {overview.dates.planEnd ? format.day(overview.dates.planEnd) : <span className={styles.muted}>{t("Nothing planned")}</span>}</dd></div>
          <div><dt>{t("Site work")}</dt><dd>{overview.dates.siteStarted ? format.day(overview.dates.siteStarted) : <span className={styles.muted}>{t("Not started")}</span>}</dd></div>
        </dl>
      </section>
      {overview.money ? <section aria-label={t("Money")}>
        <h2><Link href={`/workspace/projects/${projectId}/money`}>{t("Money")}<ArrowRight aria-hidden="true" size={13} /></Link></h2>
        <dl>
          <div><dt>{t("Agreed")}</dt><dd>{format.money(overview.money.agreed, overview.money.currency)}</dd></div>
          <div><dt>{t("Received")}</dt><dd>{format.money(overview.money.received, overview.money.currency)}</dd></div>
          <div><dt>{t("Still due")}</dt><dd>{format.money(overview.money.due, overview.money.currency)}</dd></div>
          {overview.money.next ? <div><dt>{t("Next payment")}</dt><dd>{overview.money.next.title} · {format.money(overview.money.next.amount, overview.money.currency)}
            {overview.money.next.dueDate ? <small>{format.day(overview.money.next.dueDate)}</small> : null}</dd></div> : null}
          {overview.money.available !== null && overview.money.costCurrency ? <div><dt>{t("Cash in hand")}</dt>
            <dd data-late={Number(overview.money.available) < 0 || undefined}>{format.money(overview.money.available, overview.money.costCurrency)}</dd></div> : null}
        </dl>
      </section> : null}
    </div> : null}

    {overview?.activity.length ? <section className={styles.activity} aria-label={t("Recent activity")}>
      <h2>{t("Recent activity")}</h2>
      <ol>{overview.activity.map((row) => <li key={row.id}><ActivityText row={row} /><time dateTime={row.at}>{format.when(row.at)}</time></li>)}</ol>
    </section> : null}
  </div>;
}

function BlockerRow({ blocker, label }: { blocker: Blocker; label: string }) {
  return <li data-key={blocker.key}>
    <Link href={blocker.href} aria-label={[`${blocker.count} ${label}`, ...blocker.items].join(" · ")}>
      <span className={styles.blockerHead}><span className={styles.blockerCount}>{blocker.count}</span><span className={styles.blockerLabel}>{label}</span>
        <ArrowRight aria-hidden="true" size={14} className={styles.blockerGo} /></span>
      {blocker.items.length ? <span className={styles.blockerItems}>{blocker.items.join(" · ")}</span> : null}
    </Link>
  </li>;
}

function useBlockerLabels() {
  const t = useT();
  return (key: BlockerKey, count: number) => {
    const one = count === 1;
    switch (key) {
      case "late_work": return one ? t("task late") : t("tasks late");
      case "blocked_work": return one ? t("task blocked") : t("tasks blocked");
      case "materials_not_in": return one ? t("task waiting for materials") : t("tasks waiting for materials");
      case "late_to_order": return t("to order, late");
      case "late_orders": return one ? t("order late") : t("orders late");
      case "work_orders_waiting": return one ? t("work order waiting") : t("work orders waiting");
      case "reports_missing": return one ? t("site report missing") : t("site reports missing");
      case "client_decisions": return t("waiting on the client");
      case "critical_snags": return one ? t("critical snag") : t("critical snags");
      case "funds_short": return t("spent beyond what the client paid");
      default: return key;
    }
  };
}

/** One line of activity: who did what, in words. The client appears as "The client". */
function ActivityText({ row }: { row: ActivityRow }) {
  const t = useT();
  const who = row.source === "client_portal" || !row.actor ? t("The client") : row.actor;
  const subject = row.subject;
  const text = (() => {
    // Steps the system took by itself (Settings → Projects → Finish by itself).
    if (row.source === "internal" && row.action === "project.complete_stage") return t("{subject} finished by itself", { subject: t(subject as never) });
    if (row.source === "internal" && row.action === "project.completed") return t("The project finished by itself");
    switch (row.action) {
      case "project.started": return t("{who} started the project", { who });
      case "project.complete_stage": return t("{who} finished {subject}", { who, subject: t(subject as never) });
      case "project.skip_stage": return t("{who} skipped {subject}", { who, subject: t(subject as never) });
      case "project.reopen_stage": return t("{who} went back to {subject}", { who, subject: t(subject as never) });
      case "project.hold": return t("{who} put the project on hold", { who });
      case "project.resume": return t("{who} resumed the project", { who });
      case "project.cancel": return t("{who} cancelled the project", { who });
      case "project.completed": return t("{who} completed the project", { who });
      case "project.reopen": return t("{who} reopened the project", { who });
      case "project.post_update": return subject ? t("{who}: {note}", { who, note: subject }) : t("{who} posted an update", { who });
      case "project.set_member": return subject ? t("{who} named {person}", { who, person: subject }) : t("{who} changed the team", { who });
      case "project.send_materials": return t("{who} sent the material list to the client", { who });
      case "project.record_materials_decision": case "client_portal.materials_decision": return t("{who} decided on the material list", { who });
      case "project.apply_variation": return t("{who} applied a variation", { who });
      case "project.approve_client_update": return t("{who} sent the client update", { who });
      case "client_portal.handover_decision": return t("{who} decided on the handover", { who });
      case "client_portal.warranty_claim": return t("{who} raised a warranty claim", { who });
      case "client_portal.issue": return t("{who} reported an issue", { who });
      case "work.create": return t("{who} added {subject}", { who, subject });
      case "work.update": return t("{who} finished {subject}", { who, subject });
      case "work.plan_package": return t("{who} planned a package", { who });
      case "work.start_sprint": return t("{who} started a sprint", { who });
      case "work.close_sprint": return t("{who} closed a sprint", { who });
      case "site.submit": return t("{who} submitted the site report", { who });
      case "site.approve": return t("{who} approved a site report", { who });
      case "site.return": return t("{who} sent back a site report", { who });
      case "handover.issue": return t("{who} issued {subject}", { who, subject });
      case "handover.accept": return t("{who} recorded the handover accepted", { who });
      case "handover.refuse": return t("{who} recorded the handover refused", { who });
      case "warranty.record_claim": return t("{who} recorded a warranty claim", { who });
      case "warranty.decide_claim": return t("{who} decided a warranty claim", { who });
      default: return `${who} · ${row.action}`;
    }
  })();
  return <span className={styles.activityText}>{text}</span>;
}
