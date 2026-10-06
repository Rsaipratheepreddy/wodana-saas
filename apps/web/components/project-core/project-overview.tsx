"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CircleCheck, Flag, HeartPulse, ListChecks, Wallet } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, IconMenuButton, Progress, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { ActivityRow, Blocker, BlockerKey, Health, HealthReason, ProjectDetail, ProjectOverview as Overview } from "@/lib/project-core/types";
import { projectPeople, projectStrip, projectTimeline, stageLateDays } from "@/lib/project-core/project-record";
import { NextStepCard, RecordColumns, RecordFrame, RecordPanel, RecordStrip, SideSection, StripItem } from "@/components/record/record-layout";
import { ActivityList, FactList, FileList, PeopleList, PersonChip, PersonRow, RecordTimeline } from "@/components/record/record-parts";
import { SiteLocation } from "@/components/ui/site-location";
import { PRODUCTION_TONE, useProductionStepLabel } from "../factory/factory-labels";
import { useWindowText } from "../factory/production-schedule";
import { useProjectFormat } from "./format";
import type { NextAction } from "./project-header";
import { CheckRow, CloseOutList, ReasonDialog } from "./project-stages";
import coreStyles from "./project-core.module.css";
import styles from "./project-overview.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

/** A health word and its tone, the same on the strip and the header. */
export function useHealthLabel() {
  const t = useT();
  return (health: Health) => health === "off_track" ? { label: t("Off track"), tone: "danger" as const } : health === "at_risk" ? { label: t("At risk"), tone: "warning" as const } : { label: t("On track"), tone: "success" as const };
}

/** Why the health is what it is, in words. */
/** Who goes on a booking, the lead first, as one fact. */
function crewFact(label: string, crew: { people: Array<{ name: string; lead: boolean }>; crew: { name: string } | null } | null | undefined) {
  if (!crew || (!crew.people.length && !crew.crew)) return null;
  const people = crew.people.map((person) => person.name);
  return { label, value: <>{people.length ? people.join(", ") : crew.crew!.name}{crew.crew && people.length ? <small>{crew.crew.name}</small> : null}</> };
}

function useReasonText() {
  const t = useT();
  return (reason: HealthReason) => {
    switch (reason.key) {
      case "past_handover": return reason.days === 1 ? t("1 day past the handover date") : t("{count} days past the handover date", { count: reason.days });
      case "plan_after_handover": return t("The plan ends {count} days after the handover", { count: reason.days });
      case "late_work": return reason.count === 1 ? t("1 task late") : t("{count} tasks late", { count: reason.count });
      case "late_orders": return reason.count === 1 ? t("1 order late") : t("{count} orders late", { count: reason.count });
      case "critical_snags": return reason.count === 1 ? t("1 critical snag") : t("{count} critical snags", { count: reason.count });
      default: return t("Set by the project manager");
    }
  };
}

/**
 * A project's Overview (§5c D.7): where it stands in one strip (health from the records, stage, handover, work
 * done, budget, payments); the next step as the action card with what the current stage needs; the stages as a
 * timeline; what holds it up; the latest site reports and activity; and the sidebar's Overview (team with ways
 * to reach them, site, key dates, money) · Details · Files.
 */
export function ProjectOverview({ api, detail, overview, error, onRetry, run, onTeam, onInstallation, onCrew, onPermit, next, details }: {
  api: ProjectApi; detail: ProjectDetail; overview: Overview | null; error?: string; onRetry?: () => void; run: Run; onTeam: () => void;
  /** Opens the delivery and installation days (PLM-069). */
  onInstallation?: () => void;
  /** Books who goes on the delivery or the installation: people by name, the vehicle and the driver (Palm, 6 Oct). */
  onCrew?: (kind: "delivery" | "installation") => void;
  /** Records the building permit the delivery needs. */
  onPermit?: () => void;
  /** The one thing to do next for this person (the page's own next action). */
  next: NextAction | null;
  /** The Details tab: the project's editable details. */
  details: ReactNode;
}) {
  const t = useT();
  const format = useProjectFormat();
  const healthLabel = useHealthLabel();
  const reasonText = useReasonText();
  const blockerLabel = useBlockerLabels();
  const { project } = detail;
  const projectId = project.id;
  const running = project.status === "active";
  const strip = projectStrip(detail, overview);
  const steps = projectTimeline(detail, overview);
  const people = projectPeople(detail);
  const health = healthLabel(strip.health);
  const until = strip.handover && (running || project.status === "on_hold") ? format.until(strip.handover.date) : null;
  const money = overview?.money ?? null;
  const roleLabel = (key: string | null) => t((detail.roles.find((role) => role.key === key)?.label ?? key ?? "") as never);
  const stepLabel = useProductionStepLabel();
  const windowText = useWindowText();
  const production = detail.production ?? null;
  const installation = detail.installation ?? null;
  const days = (count: number | null) => (count === null ? "" : count === 1 ? t("1 day") : t("{count} days", { count }));
  const deliveryLabel = { not_booked: t("Not booked"), booked: t("Booked"), part_delivered: t("Part delivered"), delivered: t("Delivered") };
  const installationLabel = { not_started: t("Not started"), in_progress: t("In progress"), done: t("Done") };

  const overviewPanel = <RecordPanel>
    <SideSection title={t("Team")} action={detail.canManage && (running || project.status === "on_hold") ? <Button size="compact" variant="quiet" onPress={onTeam}>{t("Edit")}</Button> : null}>
      <PeopleList label={t("Team")}>
        <PersonRow id={`client-${project.id}`} name={project.clientName} role={t("Client")} phone={overview?.contacts?.client.phone} email={overview?.contacts?.client.email} />
        {overview?.contacts?.sales && !people.named.some((person) => person.name === overview.contacts!.sales!.name)
          ? <PersonRow id={`sales-${overview.contacts.sales.name}`} name={overview.contacts.sales.name} role={t("Sales")} email={overview.contacts.sales.email} /> : null}
        {people.named.map((person) => <PersonRow key={person.id} id={person.id} name={person.name} email={person.email}
          role={[...(overview?.contacts?.sales?.name === person.name ? [t("Sales")] : []), ...person.roles.map((role) => t(role as never))].join(" · ")} />)}
        {overview?.workforce ? <li className={styles.crew}>
          <span>{t("{count} workers on site", { count: overview.workforce.people })}</span>
          <small>{[overview.workforce.trades.map((trade) => `${trade.trade} ${trade.people}`).join(" · "), format.short(overview.workforce.date)].join(" · ")}</small>
        </li> : null}
      </PeopleList>
      {people.missing.length ? <p className={styles.muted}>{t("Not named: {roles}", { roles: people.missing.map((role) => t(role as never)).join(", ") })}</p> : null}
    </SideSection>
    {overview?.site ? <SideSection title={t("Site")}><SiteLocation address={overview.site.address} latitude={overview.site.latitude} longitude={overview.site.longitude} /></SideSection> : null}
    {overview ? <SideSection title={t("Key dates")}>
      <FactList facts={[
        overview.dates.start ? { label: t("Start"), value: format.short(overview.dates.start) } : null,
        overview.dates.promise ? { label: t("Handover"), value: format.short(overview.dates.promise) } : null,
        overview.dates.planEnd ? { label: t("Plan ends"), value: format.short(overview.dates.planEnd), tone: overview.dates.promise && overview.dates.planEnd > overview.dates.promise ? "danger" : undefined } : null,
        overview.dates.siteStarted ? { label: t("Site work"), value: overview.dates.siteFinished ? t("{from} – {to}", { from: format.short(overview.dates.siteStarted), to: format.short(overview.dates.siteFinished) }) : t("Since {date}", { date: format.short(overview.dates.siteStarted) }) } : null,
        project.closedAt ? { label: project.status === "cancelled" ? t("Cancelled") : t("Completed"), value: format.short(format.dayOf(project.closedAt)) } : null,
      ]} />
    </SideSection> : null}
    {/* PLM-063: production as the factory works it, planned against actual. */}
    {production ? <SideSection title={t("Production")} action={<Link className={styles.sideLink} href={`/workspace/factory/orders?project=${projectId}`}>{t("Open")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link>}>
      <FactList facts={[
        { label: t("Status"), value: production.step ? <Badge tone={PRODUCTION_TONE[production.step.kind]}>{stepLabel(production.step)}</Badge> : t("Not scheduled") },
        production.planned.start ? { label: t("Planned"), value: <>{windowText(production.planned)}{production.planned.days ? <small>{days(production.planned.days)}</small> : null}</> } : null,
        production.actual.start ? { label: t("Actual"), tone: production.late || production.overTarget ? "danger" : undefined,
          value: <>{windowText(production.actual, production.step?.kind !== "ready")}<small>{[days(production.actual.days), production.late ? t("Late") : ""].filter(Boolean).join(" · ")}</small></> } : null,
      ]} />
    </SideSection> : null}
    {/* PLM-069: delivery and installation, scheduled by the project manager or the installation team. */}
    {installation && ((installation.inRoute && detail.areas?.delivery !== false) || installation.installationOn || installation.deliveryOn) ? <SideSection title={t("Delivery and installation")}
      action={detail.canScheduleInstallation && onInstallation ? <Button size="compact" variant="quiet" onPress={onInstallation}>{installation.installationOn ? t("Change") : t("Schedule")}</Button> : null}>
      <FactList facts={[
        { label: t("Delivery"), value: <>{deliveryLabel[installation.delivery]}{installation.deliveryOn ? <small>{format.short(installation.deliveryOn)}</small> : null}</> },
        { label: t("Installation"), tone: installation.late ? "danger" : undefined, value: <>{installationLabel[installation.installation]}
          {installation.installationOn ? <small>{[format.short(installation.installationOn), installation.late ? t("Late") : ""].filter(Boolean).join(" · ")}</small> : null}</> },
        installation.permit?.required || installation.permit?.collected ? { label: t("Building permit"), tone: installation.permit.valid ? undefined : "danger",
          value: <>{installation.permit.valid ? t("Collected") : installation.permit.collected ? t("Doesn't cover the delivery day") : t("Missing")}
            <small>{[installation.permit.validTo ? t("Valid until {date}", { date: format.short(installation.permit.validTo) }) : "",
              installation.permit.valid && installation.permit.reminderOn ? t("Reminder on {date}", { date: format.short(installation.permit.reminderOn) }) : "",
              installation.permit.collectOn && !installation.permit.valid ? t("Collection on {date}", { date: format.short(installation.permit.collectOn) }) : ""].filter(Boolean).join(" · ")}</small></> } : null,
        crewFact(t("Delivery crew"), installation.deliveryCrew),
        installation.deliveryCrew?.vehicle || installation.deliveryCrew?.driver ? { label: t("Vehicle"), value: <>{installation.deliveryCrew.vehicle?.name ?? t("Not set")}
          {installation.deliveryCrew.driver ? <small>{t("Driver: {name}", { name: installation.deliveryCrew.driver.name })}</small> : null}</> } : null,
        crewFact(t("Installation crew"), installation.installationCrew),
        installation.note ? { label: t("Note"), value: installation.note } : null,
      ]} />
      {detail.canScheduleInstallation && (onCrew || onPermit) ? <div className={styles.sideActions}>
        {onCrew && installation.deliveryOn ? <Button size="compact" variant="quiet" onPress={() => onCrew("delivery")}>{t("Delivery crew and vehicle")}</Button> : null}
        {onCrew && installation.installationOn ? <Button size="compact" variant="quiet" onPress={() => onCrew("installation")}>{t("Installation crew")}</Button> : null}
        {onPermit && (installation.permit?.required || installation.permit?.collected) ? <Button size="compact" variant="quiet" onPress={onPermit}>{t("Record the building permit")}</Button> : null}
      </div> : null}
    </SideSection> : null}
    {money ? <SideSection title={t("Money")} action={detail.canSeeMoney ? <Link className={styles.sideLink} href={`/workspace/projects/${projectId}/money`}>{t("Open")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link> : null}>
      <FactList facts={[
        { label: t("Agreed"), value: format.money(money.agreed, money.currency) },
        { label: t("Received"), value: format.money(money.received, money.currency), tone: "success" },
        Number(money.due) > 0 ? { label: t("Still due"), value: format.money(money.due, money.currency) } : null,
        money.next ? { label: t("Next payment"), value: <>{format.money(money.next.amount, money.currency)}<small>{[money.next.title, money.next.dueDate ? format.short(money.next.dueDate) : null].filter(Boolean).join(" · ")}</small></> } : null,
        money.spent !== null && money.costCurrency ? { label: t("Spent"), value: format.money(money.spent, money.costCurrency) } : null,
        money.available !== null && money.costCurrency ? { label: t("Cash in hand"), value: format.money(money.available, money.costCurrency), tone: Number(money.available) < 0 ? "danger" : undefined } : null,
      ]} />
      {strip.paid !== null ? <Progress label={t("{percent}% paid", { percent: strip.paid })} value={Math.min(100, strip.paid)} /> : null}
    </SideSection> : null}
  </RecordPanel>;

  const files = [
    ...(detail.seal ? [{ id: "seal", name: t("Accepted quotation {revision}", { revision: detail.seal.revisionLabel }), meta: format.when(detail.seal.acceptedAt), href: `/workspace/projects/${projectId}/scope` }] : []),
    { id: "case", name: t("Planning record {reference}", { reference: project.opportunityReference ?? "" }).trim(), meta: t("Quotations, agreement and designs"), href: `/workspace/pre-projects/cases/${project.caseId}/overview` },
  ];

  return <div className={styles.overview}>
    <RecordFrame tour="project-record">
      <RecordStrip label={t("Where the project stands")}>
        <StripItem icon={<HeartPulse aria-hidden="true" size={13} />} label={t("Health")}>
          {running ? <span className={styles.health}><Badge tone={health.tone}>{health.label}</Badge>{strip.reasons.length ? <small>{strip.reasons.slice(0, 2).map(reasonText).join(" · ")}</small> : null}</span>
            : <Badge tone={project.status === "on_hold" ? "warning" : "info"}>{project.status === "on_hold" ? t("On hold") : project.status === "completed" ? t("Completed") : t("Cancelled")}</Badge>}
        </StripItem>
        {strip.stage ? <StripItem icon={<Flag aria-hidden="true" size={13} />} label={t("Stage")}>{t("{stage} · {position} of {count}", { stage: t(strip.stage.name as never), position: strip.stage.position, count: strip.stage.count })}</StripItem> : null}
        {strip.handover ? <StripItem icon={<CalendarClock aria-hidden="true" size={13} />} label={t("Handover")}>{format.short(strip.handover.date)}{until ? <>&nbsp;·&nbsp;<span className={until.late ? styles.late : styles.muted}>{until.text}</span></> : null}</StripItem> : null}
        {strip.progress !== null ? <StripItem label={t("Progress")}>{t("{percent}% done", { percent: strip.progress })}</StripItem> : null}
        {strip.work ? <StripItem icon={<ListChecks aria-hidden="true" size={13} />} label={t("Tasks")}>{t("{done}/{total} done", strip.work)}</StripItem> : null}
        {strip.budgetUsed !== null ? <StripItem icon={<Wallet aria-hidden="true" size={13} />} label={t("Budget used")}><span className={strip.budgetUsed > 100 ? styles.late : undefined}>{t("{percent}%", { percent: strip.budgetUsed })}</span></StripItem>
          : strip.paid !== null ? <StripItem icon={<Wallet aria-hidden="true" size={13} />} label={t("Paid")}>{t("{percent}%", { percent: strip.paid })}</StripItem> : null}
      </RecordStrip>
      <RecordColumns sideLabel={t("Project overview")} tabs={[
        { id: "overview", label: t("Overview"), panel: overviewPanel },
        { id: "details", label: t("Details"), panel: <RecordPanel>{details}</RecordPanel> },
        { id: "files", label: t("Files"), panel: <RecordPanel><FileList label={t("Files")} items={files} /></RecordPanel> },
      ]}
        next={<>
          <ProjectNextStep api={api} detail={detail} overview={overview} next={next} run={run} onTeam={onTeam} roleLabel={roleLabel} />
          <SideSection title={t("Stages")}>
            <RecordTimeline label={t("Stages")} steps={steps.map((step) => ({
              id: step.id, label: t(step.name as never), state: step.state,
              date: step.doneAt ? format.short(format.dayOf(step.doneAt)) : step.plannedStart ? (step.plannedEnd && step.plannedEnd !== step.plannedStart ? t("{from} – {to}", { from: format.short(step.plannedStart), to: format.short(step.plannedEnd) }) : format.short(step.plannedStart)) : null,
              late: step.lateDays ? (step.lateDays === 1 ? t("1 day late") : t("{count} days late", { count: step.lateDays })) : null,
              detail: !step.person && step.role && step.state !== "done" && step.state !== "skipped" ? t("{role} · not named", { role: roleLabel(step.role) }) : null,
              people: step.person ? [step.person] : [],
            }))} />
          </SideSection>
          {error && !overview ? <ErrorState description={error} onRetry={onRetry} /> : !overview ? <Skeleton lines={2} shape="rows" />
            : running || project.status === "on_hold" ? <section className={styles.blockers} aria-label={t("Needs attention")}>
              <h4>{t("Needs attention")}</h4>
              {overview.blockers.length ? <ul>{overview.blockers.map((blocker) => <BlockerRow key={blocker.key} label={blockerLabel(blocker.key, blocker.count)}
                blocker={blocker.key === "reports_missing" ? { ...blocker, items: blocker.items.map((day) => format.short(day)) } : blocker} />)}</ul>
                : <p className={styles.clear}><CircleCheck aria-hidden="true" size={16} />{t("Nothing is holding the project up.")}</p>}
            </section> : null}
        </>}
        activity={overview && (overview.siteReports?.length || overview.activity.length) ? <>
          {overview.siteReports?.length ? <SideSection title={t("Site updates")} action={<Link className={styles.sideLink} href={`/workspace/projects/${projectId}/site`}>{t("Open")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link>}>
            <ActivityList label={t("Site updates")} items={overview.siteReports.map((report) => ({ id: report.id, text: report.text || t("Site report"), meta: report.byName, at: format.short(report.date) }))} />
          </SideSection> : null}
          {overview.activity.length ? <section className={styles.activity} aria-label={t("Recent activity")}>
            <h4>{t("Recent activity")}</h4>
            <ol>{overview.activity.slice(0, 6).map((row) => <li key={row.id}><ActivityText row={row} /><time dateTime={row.at}>{format.when(row.at)}</time></li>)}</ol>
          </section> : null}
        </> : null} />
    </RecordFrame>
  </div>;
}

/**
 * The next step as the action card: what the current stage needs now, its stage and lateness, who does it and
 * the one action; under it every check of the stage (ticked, or read from the records with where to fix it).
 */
function ProjectNextStep({ api, detail, overview, next, run, onTeam, roleLabel }: {
  api: ProjectApi; detail: ProjectDetail; overview: Overview | null; next: NextAction | null; run: Run; onTeam: () => void; roleLabel: (key: string | null) => string;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [reason, setReason] = useState<"skip_stage" | "reopen_stage" | null>(null);
  const { project } = detail;
  const running = project.status === "active";
  const current = detail.stages.find((stage) => stage.status === "current");
  // The card's title already names the check, so its button says only "Confirm" (its accessible name stays whole).
  const short = next && detail.next?.kind === "confirm" && current?.canWork ? { label: t("Confirm"), ariaLabel: next.ariaLabel ?? next.label } : null;
  const action = next ? next.href
    ? <Link className="wd-button" data-variant="primary" data-size="compact" href={next.href} aria-label={next.ariaLabel}>{next.label}</Link>
    : <Button size="compact" variant="primary" aria-label={short?.ariaLabel ?? next.ariaLabel} onPress={() => next.press?.()}>{short?.label ?? next.label}</Button> : null;

  if (project.status === "on_hold") return <NextStepCard title={t("On hold")} why={project.holdReason} status="attention"
    meta={<>{project.holdReviewOn ? <Badge tone="warning">{t("Review on {date}", { date: format.short(project.holdReviewOn) })}</Badge> : null}{action}</>} />;
  if (project.status === "completed" || project.status === "cancelled") return <NextStepCard status="done"
    title={project.status === "completed" ? t("Project completed") : t("Project cancelled")}
    why={[project.status === "cancelled" ? project.cancelReason : null, project.closedAt ? format.when(project.closedAt) : null, project.closedByName].filter(Boolean).join(" · ") || null} />;
  if (!current || !detail.next) return <EmptyState illustration={null} title={t("Nothing to do on the stages")} />;

  const late = stageLateDays(current, overview?.stagePlan, overview?.today);
  const who = detail.next.owner ?? (detail.next.role ? t("{role} · not named", { role: roleLabel(detail.next.role) }) : detail.next.kind === "payment_verified" ? t("Finance") : null);
  const missing = current.checks.filter((check) => !check.passed).length;
  const last = detail.stages.at(-1);
  return <>
    <NextStepCard tour="project-next" status={late ? "attention" : undefined}
      title={t(detail.next.text as never)}
      why={[t("{stage} · {position} of {count}", { stage: t(current.name as never), position: current.position + 1, count: detail.stages.length }),
        missing ? (missing === 1 ? t("1 still needed") : t("{count} still needed", { count: missing })) : t("Ready to finish")].join(" · ")}
      meta={<>
        {who ? detail.next.owner ? <PersonChip id={current.owner?.membershipId ?? `owner-${who}`} name={who} /> : <span className={styles.muted}>{who}</span> : null}
        {late ? <Badge tone="danger">{late === 1 ? t("1 day past its plan") : t("{count} days past its plan", { count: late })}</Badge> : null}
        {action}
        {detail.canManage && running ? <IconMenuButton ariaLabel={t("Stage actions")} onAction={(id) => setReason(id as "skip_stage" | "reopen_stage")}
          items={[{ id: "skip_stage", label: t("Skip this stage") }, ...(current.position > 0 ? [{ id: "reopen_stage", label: t("Go back a stage") }] : [])]} /> : null}
      </>}>
      {/* The stage's checks; a single open one is the card's own title and button. */}
      {current.checks.length > 1 || current.checks.some((check) => check.passed) ? <ul className={`${coreStyles.checks} ${styles.cardChecks}`} aria-label={t("What {stage} needs", { stage: current.name })}>
        {current.checks.map((check) => <CheckRow key={check.key} check={check} stage={current} run={run} projectId={project.id} onTeam={onTeam} roleLabel={(key) => detail.roles.find((role) => role.key === key)?.label ?? ""} running={running} />)}
      </ul> : null}
      {current === last && detail.canClose ? <CloseOutList api={api} projectId={project.id} /> : null}
    </NextStepCard>
    {reason ? <ReasonDialog title={reason === "skip_stage" ? t("Skip {stage}", { stage: current.name }) : t("Go back a stage")}
      label={reason === "skip_stage" ? t("Why doesn't it apply") : t("Why")}
      onClose={() => setReason(null)}
      onSave={async (text) => { await run(reason, { stageId: current.id, reason: text }, { inDialog: true }); setReason(null); }} /> : null}
  </>;
}

function BlockerRow({ blocker, label }: { blocker: Blocker; label: string }) {
  return <li data-key={blocker.key}>
    <Link href={blocker.href} aria-label={[`${blocker.count} ${label}`, ...blocker.items].join(" · ")}>
      <span className={styles.blockerHead}><span className={styles.blockerCount}>{blocker.count}</span><span className={styles.blockerLabel}>{label}</span>
        <ArrowRight aria-hidden="true" size={14} className={styles.blockerGo} data-directional="true" /></span>
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

