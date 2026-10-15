"use client";

import { RecordHistory } from "../history/record-history";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CircleCheck, Flag, ListChecks, TriangleAlert, Wallet } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, IconMenuButton, KpiStrip, KpiTile, Skeleton, StateChip, type ItemState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { BlockerKey, HealthReason, ProjectDetail, ProjectOverview as Overview } from "@/lib/project-core/types";
import { projectPeople, projectStrip, projectTimeline, stageLateDays, type ProjectStep } from "@/lib/project-core/project-record";
import { nextStepText } from "@/lib/project-core/next-step";
import { NextStepCard, RecordColumns, RecordFrame, RecordPanel, SideSection } from "@/components/record/record-layout";
import { ActivityList, FactList, FileList, PeopleList, PersonChip, PersonRow, RecordTimeline } from "@/components/record/record-parts";
import { SiteLocation } from "@/components/ui/site-location";
import { SiteUpdates } from "@/components/site/site-updates";
import { PRODUCTION_TONE, useProductionStepLabel } from "../factory/factory-labels";
import { useWindowText } from "../factory/production-schedule";
import { useProjectFormat } from "./format";
import type { NextAction } from "./project-header";
import { CheckRow, CloseOutList, ReasonDialog } from "./project-stages";
import coreStyles from "./project-core.module.css";
import styles from "./project-overview.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

const DELIVERY_STATE: Record<"not_booked" | "booked" | "part_delivered" | "delivered", ItemState> = { not_booked: "upcoming", booked: "in_progress", part_delivered: "in_progress", delivered: "done" };
const INSTALLATION_STATE: Record<"not_started" | "in_progress" | "done", ItemState> = { not_started: "upcoming", in_progress: "in_progress", done: "done" };

/** Who goes on a booking, the lead first, as one fact. */
function crewFact(label: string, crew: { people: Array<{ name: string; lead: boolean }>; crew: { name: string } | null } | null | undefined) {
  if (!crew || (!crew.people.length && !crew.crew)) return null;
  const people = crew.people.map((person) => person.name);
  return { label, value: <>{people.length ? people.join(", ") : crew.crew!.name}{crew.crew && people.length ? <small>{crew.crew.name}</small> : null}</> };
}

/** Why the health is what it is, in words. */
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
 * A project's Overview (§5c D.7), each fact once: KPI tiles say where it stands (stage, handover, progress,
 * money, what needs attention; the health is the header's badge); then titled section cards: the one next step
 * with its checks, what needs attention (most severe first), every stage as a step, the latest site updates and
 * the history. The sidebar: Overview (team, the roles nobody holds, site, key dates, production, delivery,
 * money) · Details · Files.
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
  const attentionRows = useAttentionRows();
  const { project } = detail;
  const projectId = project.id;
  const running = project.status === "active";
  const open = running || project.status === "on_hold";
  const strip = projectStrip(detail, overview);
  const steps = projectTimeline(detail, overview);
  const people = projectPeople(detail);
  const until = strip.handover && open ? format.until(strip.handover.date) : null;
  const money = overview?.money ?? null;
  const stepLabel = useProductionStepLabel();
  const windowText = useWindowText();
  const production = detail.production ?? null;
  const installation = detail.installation ?? null;
  const days = (count: number | null) => (count === null ? "" : count === 1 ? t("1 day") : t("{count} days", { count }));
  const deliveryLabel = { not_booked: t("Not booked"), booked: t("Booked"), part_delivered: t("Part delivered"), delivered: t("Delivered") };
  const installationLabel = { not_started: t("Not started"), in_progress: t("In progress"), done: t("Done") };
  // The next step's own action lives on its card; the sidebar doesn't offer it a second time.
  const nextKind = running && next ? detail.next?.kind ?? null : null;
  const canEditTeam = detail.canManage && open;

  const stepDate = (step: ProjectStep) => step.doneAt ? format.short(format.dayOf(step.doneAt))
    : step.plannedStart ? (step.plannedEnd && step.plannedEnd !== step.plannedStart ? t("{from} – {to}", { from: format.short(step.plannedStart), to: format.short(step.plannedEnd) }) : format.short(step.plannedStart)) : null;
  const stepLate = (step: ProjectStep) => step.lateDays ? (step.lateDays === 1 ? t("1 day late") : t("{count} days late", { count: step.lateDays })) : null;

  const rows = overview ? attentionRows(detail, overview) : [];
  const attentionTone = rows.some((row) => row.tone === "danger") ? "danger" : rows.length ? "warning" : "success";

  // The few numbers that matter, each a tile that opens where it is worked: the stage, the handover, the work done,
  // the money and what needs attention. The health is the header's badge.
  const kpis = [
    strip.stage ? <KpiTile key="stage" icon={<Flag size={13} />} label={t("Stage")} value={t(strip.stage.name as never)}
      detail={t("Stage {number} of {total}", { number: strip.stage.position, total: strip.stage.count })} href="#project-stages" /> : null,
    strip.handover ? <KpiTile key="handover" icon={<CalendarClock size={13} />} label={t("Handover")} value={format.short(strip.handover.date)}
      detail={until?.text} tone={until?.late ? "danger" : undefined} /> : null,
    strip.progress !== null ? <KpiTile key="progress" icon={<ListChecks size={13} />} label={t("Progress")} value={t("{percent}% done", { percent: strip.progress })}
      detail={strip.work ? t("{done} of {total} tasks", { done: strip.work.done, total: strip.work.total }) : null} href={`/workspace/projects/${projectId}/plan`} /> : null,
    strip.budgetUsed !== null ? <KpiTile key="budget" icon={<Wallet size={13} />} label={t("Budget used")} value={t("{percent}%", { percent: strip.budgetUsed })}
      tone={strip.budgetUsed > 100 ? "danger" : undefined} href={detail.canSeeMoney ? `/workspace/projects/${projectId}/money` : undefined} />
      : strip.paid !== null ? <KpiTile key="paid" icon={<Wallet size={13} />} label={t("Paid")} value={t("{percent}%", { percent: strip.paid })}
        href={detail.canSeeMoney ? `/workspace/projects/${projectId}/money` : undefined} /> : null,
    // How many things wait (a late task counts once per task); the one kind under it when there is only one.
    overview && open ? <KpiTile key="attention" icon={<TriangleAlert size={13} />} label={t("Needs attention")} value={rows.length ? rows.reduce((sum, row) => sum + (row.count ?? 1), 0) : t("None")}
      detail={rows.length === 1 ? rows[0].label : null} tone={attentionTone} href="#project-attention" /> : null,
  ].filter(Boolean);

  // Every stage as a step (done, now, to come) with its date, owner and lateness.
  const stages = steps.length ? <SideSection id="project-stages" title={t("Stages")}>
    <RecordTimeline layout="list" label={t("Stages")} steps={steps.map((step) => ({
      id: step.id, label: t(step.name as never), state: step.state, date: stepDate(step), late: stepLate(step), people: step.person ? [step.person] : [],
    }))} />
  </SideSection> : null;

  const attention = error && !overview ? <ErrorState description={error} onRetry={onRetry} /> : !overview ? <Skeleton lines={2} shape="rows" />
    : open ? <SideSection id="project-attention" title={t("Needs attention")}>
      {rows.length ? <ul className={styles.attention}>{rows.map((row) => <AttentionItem key={row.key} row={row} />)}</ul>
        : <p className={styles.clear}><CircleCheck aria-hidden="true" size={16} />{t("Nothing is holding the project up.")}</p>}
    </SideSection> : null;

  const keyDates = overview ? [
    overview.dates.start ? { label: t("Start"), value: format.short(overview.dates.start) } : null,
    overview.dates.planEnd ? { label: t("Plan ends"), value: format.short(overview.dates.planEnd) } : null,
    overview.dates.siteStarted ? { label: t("Site work"), value: overview.dates.siteFinished ? t("{from} – {to}", { from: format.short(overview.dates.siteStarted), to: format.short(overview.dates.siteFinished) }) : t("Since {date}", { date: format.short(overview.dates.siteStarted) }) } : null,
    project.closedAt ? { label: project.status === "cancelled" ? t("Cancelled") : t("Completed"), value: format.short(format.dayOf(project.closedAt)) } : null,
  ].filter((fact) => fact !== null) : [];

  const installationActions = installation && detail.canScheduleInstallation ? [
    onCrew && installation.deliveryOn ? <Button key="delivery" size="compact" variant="quiet" onPress={() => onCrew("delivery")}>{t("Delivery crew and vehicle")}</Button> : null,
    onCrew && installation.installationOn ? <Button key="installation" size="compact" variant="quiet" onPress={() => onCrew("installation")}>{t("Installation crew")}</Button> : null,
    onPermit && (installation.permit?.required || installation.permit?.collected) && nextKind !== "permit_collected" ? <Button key="permit" size="compact" variant="quiet" onPress={onPermit}>{t("Record the building permit")}</Button> : null,
  ].filter(Boolean) : [];

  const overviewPanel = <RecordPanel>
    <SideSection title={t("Team")} action={canEditTeam ? <Button size="compact" variant="quiet" onPress={onTeam}>{t("Edit")}</Button> : null}>
      <PeopleList label={t("Team")} compact>
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
      {/* The roles nobody holds, here only (not on the stages or the next step). */}
      {people.missing.length ? <div className={styles.unnamed}>
        <span>{t("Not named: {roles}", { roles: people.missing.map((role) => t(role as never)).join(", ") })}</span>
        {canEditTeam && nextKind !== "lead_assigned" && nextKind !== "role_assigned" ? <Button size="compact" variant="quiet" onPress={onTeam}>{t("Name someone")}</Button> : null}
      </div> : null}
    </SideSection>
    {overview?.site ? <SideSection title={t("Site")}><SiteLocation address={overview.site.address} latitude={overview.site.latitude} longitude={overview.site.longitude} /></SideSection> : null}
    {/* The handover date is on the strip. */}
    {keyDates.length ? <SideSection title={t("Key dates")}><FactList facts={keyDates} /></SideSection> : null}
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
      action={detail.canScheduleInstallation && onInstallation && (installation.installationOn || nextKind !== "installation_scheduled")
        ? <Button size="compact" variant="quiet" onPress={onInstallation}>{installation.installationOn ? t("Change") : t("Schedule")}</Button> : null}>
      <FactList facts={[
        { label: t("Delivery"), value: <><StateChip state={DELIVERY_STATE[installation.delivery]} label={deliveryLabel[installation.delivery]} />{installation.deliveryOn ? <small>{format.short(installation.deliveryOn)}</small> : null}</> },
        { label: t("Installation"), value: <><StateChip state={installation.late && installation.installation !== "done" ? "late" : INSTALLATION_STATE[installation.installation]} label={installationLabel[installation.installation]} />
          {installation.installationOn ? <small>{[format.short(installation.installationOn), installation.late ? t("Late") : ""].filter(Boolean).join(" · ")}</small> : null}</> },
        installation.permit?.required || installation.permit?.collected ? { label: t("Building permit"),
          value: <>{installation.permit.valid ? <StateChip state="done" label={t("Collected")} /> : installation.permit.collected ? <StateChip state="blocked" label={t("Doesn't cover the delivery day")} /> : <StateChip state="missing" />}
            <small>{[installation.permit.validTo ? t("Valid until {date}", { date: format.short(installation.permit.validTo) }) : "",
              installation.permit.valid && installation.permit.reminderOn ? t("Reminder on {date}", { date: format.short(installation.permit.reminderOn) }) : "",
              installation.permit.collectOn && !installation.permit.valid ? t("Collection on {date}", { date: format.short(installation.permit.collectOn) }) : ""].filter(Boolean).join(" · ")}</small></> } : null,
        crewFact(t("Delivery crew"), installation.deliveryCrew),
        installation.deliveryCrew?.vehicle || installation.deliveryCrew?.driver ? { label: t("Vehicle"), value: <>{installation.deliveryCrew.vehicle?.name ?? t("Not set")}
          {installation.deliveryCrew.driver ? <small>{t("Driver: {name}", { name: installation.deliveryCrew.driver.name })}</small> : null}</> } : null,
        crewFact(t("Installation crew"), installation.installationCrew),
        installation.note ? { label: t("Note"), value: installation.note } : null,
      ]} />
      {installationActions.length ? <div className={styles.sideActions}>{installationActions}</div> : null}
    </SideSection> : null}
    {/* The share paid (or the budget used) is on the strip; here the amounts behind it. */}
    {money ? <SideSection title={t("Money")} action={detail.canSeeMoney ? <Link className={styles.sideLink} href={`/workspace/projects/${projectId}/money`}>{t("Open")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link> : null}>
      <FactList facts={[
        { label: t("Agreed"), value: format.money(money.agreed, money.currency) },
        { label: t("Received"), value: format.money(money.received, money.currency), tone: "success" },
        Number(money.due) > 0 ? { label: t("Still due"), value: format.money(money.due, money.currency) } : null,
        money.next ? { label: t("Next payment"), value: <>{format.money(money.next.amount, money.currency)}<small>{[money.next.title, money.next.dueDate ? format.short(money.next.dueDate) : null].filter(Boolean).join(" · ")}</small></> } : null,
        money.spent !== null && money.costCurrency ? { label: t("Spent"), value: format.money(money.spent, money.costCurrency) } : null,
        money.available !== null && money.costCurrency ? { label: t("Cash in hand"), value: format.money(money.available, money.costCurrency), tone: Number(money.available) < 0 ? "danger" : undefined } : null,
      ]} />
    </SideSection> : null}
  </RecordPanel>;

  const files = [
    ...(detail.seal ? [{ id: "seal", name: t("Accepted quotation {revision}", { revision: detail.seal.revisionLabel }), meta: format.when(detail.seal.acceptedAt), href: `/workspace/projects/${projectId}/scope` }] : []),
    { id: "case", name: t("Planning record {reference}", { reference: project.opportunityReference ?? "" }).trim(), meta: t("Quotations, agreement and designs"), href: `/workspace/pre-projects/cases/${project.caseId}/overview` },
  ];

  // The latest only: three site updates (every one on the Site tab) and three steps of activity (the rest on request).
  const reports = overview?.siteReports?.slice(0, LATEST) ?? [];

  return <div className={styles.overview}>
    <RecordFrame tour="project-record">
      {kpis.length ? <KpiStrip label={t("Where the project stands")}>{kpis}</KpiStrip> : null}
      <RecordColumns sideLabel={t("Project overview")} tabs={[
        { id: "overview", label: t("Overview"), panel: overviewPanel },
        { id: "details", label: t("Details"), panel: <RecordPanel>{details}</RecordPanel> },
        { id: "files", label: t("Files"), panel: <RecordPanel><FileList label={t("Files")} items={files} /></RecordPanel> },
      ]}
        next={<>
          <ProjectNextStep api={api} detail={detail} overview={overview} next={next} run={run} onTeam={onTeam} />
          {attention}
          {stages}
        </>}
        activity={<>
          {reports.length ? <SideSection title={t("Site updates")} action={<Link className={styles.sideLink} href={`/workspace/projects/${projectId}/site`}>{t("View all")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link>}>
            {/* The same day cards as the Site tab (compact); the summary lines until they load. */}
            <SiteUpdates workspaceId={api.workspaceId} projectId={projectId} latest={LATEST}
              fallback={<ActivityList label={t("Site updates")} items={reports.map((report) => ({ id: report.id, text: report.text || t("Site report"), meta: report.byName, at: format.short(report.date) }))} />} />
          </SideSection> : null}
          <SideSection title={t("History")}>
            <RecordHistory workspaceId={api.workspaceId} recordType="project" recordId={projectId} />
          </SideSection>
        </>} />
    </RecordFrame>
  </div>;
}

/** How many site updates and activity steps the Overview shows before "View all" / "Show all". */
const LATEST = 3;

/**
 * The next step as the action card: what the current stage needs now, who does it, its lateness and the one
 * action; under it every check of the stage (ticked, or read from the records with where to fix it). The
 * stage itself is on the strip and the roles nobody holds are on the team, so the card repeats neither.
 */
function ProjectNextStep({ api, detail, overview, next, run, onTeam }: {
  api: ProjectApi; detail: ProjectDetail; overview: Overview | null; next: NextAction | null; run: Run; onTeam: () => void;
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
  const owner = detail.next.owner;
  // The card's button works the first open check; that check's row doesn't offer the same fix again.
  const firstOpen = current.checks.find((check) => !check.passed);
  const last = detail.stages.at(-1);
  return <>
    <NextStepCard tour="project-next" status={late ? "attention" : undefined}
      title={nextStepText(t, detail.next)}
      meta={<>
        {owner ? <PersonChip id={current.owner?.membershipId ?? `owner-${owner}`} name={owner} /> : detail.next.kind === "payment_verified" ? <span className={styles.muted}>{t("Finance")}</span> : null}
        {late ? <Badge tone="danger">{late === 1 ? t("1 day past its plan") : t("{count} days past its plan", { count: late })}</Badge> : null}
        {action}
        {detail.canManage && running ? <IconMenuButton ariaLabel={t("Stage actions")} onAction={(id) => setReason(id as "skip_stage" | "reopen_stage")}
          items={[{ id: "skip_stage", label: t("Skip this stage") }, ...(current.position > 0 ? [{ id: "reopen_stage", label: t("Go back a stage") }] : [])]} /> : null}
      </>}>
      {/* The stage's checks; a single open one is the card's own title and button. */}
      {current.checks.length > 1 || current.checks.some((check) => check.passed) ? <ul className={`${coreStyles.checks} ${styles.cardChecks}`} aria-label={t("What {stage} needs", { stage: current.name })}>
        {current.checks.map((check) => <CheckRow key={check.key} check={check} stage={current} run={run} projectId={project.id} onTeam={onTeam} roleLabel={(key) => detail.roles.find((role) => role.key === key)?.label ?? ""} running={running}
          showFix={!(action && check.key === firstOpen?.key)} />)}
      </ul> : null}
      {current === last && detail.canClose ? <CloseOutList api={api} projectId={project.id} /> : null}
    </NextStepCard>
    {reason ? <ReasonDialog title={reason === "skip_stage" ? t("Skip {stage}", { stage: current.name }) : t("Go back a stage")}
      label={reason === "skip_stage" ? t("Why doesn't it apply") : t("Why")}
      onClose={() => setReason(null)}
      onSave={async (text) => { await run(reason, { stageId: current.id, reason: text }, { inDialog: true }); setReason(null); }} /> : null}
  </>;
}

/** One thing that needs attention: how many (or a dot), what, the first few records, and where it's fixed. */
type AttentionRow = { key: string; tone: "danger" | "warning"; count: number | null; label: string; items: string[]; href: string };

/** Most severe first: what's late, unsafe or past the handover (danger), then what waits (warning); a fixed order within each. */
const ATTENTION_ORDER = ["critical_snags", "funds_short", "plan_after_handover", "late_orders", "late_work", "stated",
  "late_to_order", "blocked_work", "materials_not_in", "client_decisions", "work_orders_waiting", "reports_missing"];
const DANGER = new Set(["critical_snags", "funds_short", "plan_after_handover", "late_orders", "late_work"]);

/**
 * What needs attention, as one list: every blocker from the records, plus what the health stands on that no
 * blocker shows (the plan ending after the handover, or the project manager's own call). Late work, late
 * orders and critical snags are blockers already; a handover already passed is on the strip.
 */
function useAttentionRows() {
  const format = useProjectFormat();
  const blockerLabel = useBlockerLabels();
  const reasonText = useReasonText();
  return (detail: ProjectDetail, overview: Overview): AttentionRow[] => {
    const base = `/workspace/projects/${detail.project.id}`;
    const rows: AttentionRow[] = overview.blockers.map((blocker) => ({
      key: blocker.key, tone: DANGER.has(blocker.key) ? "danger" : "warning", count: blocker.count, label: blockerLabel(blocker.key, blocker.count),
      items: blocker.key === "reports_missing" ? blocker.items.map((day) => format.short(day)) : blocker.items, href: blocker.href,
    }));
    if (detail.project.status === "active") for (const reason of overview.health?.reasons ?? []) {
      if (reason.key === "plan_after_handover") rows.push({ key: reason.key, tone: "danger", count: null, label: reasonText(reason), items: [], href: `${base}/plan` });
      if (reason.key === "stated") {
        const note = detail.updates.find((update) => !update.draft && update.kind !== "client_update")?.note.trim();
        rows.push({ key: reason.key, tone: overview.health?.stated === "off_track" ? "danger" : "warning", count: null, label: reasonText(reason), items: note ? [note] : [], href: `${base}/updates` });
      }
    }
    const order = (key: string) => { const index = ATTENTION_ORDER.indexOf(key); return index < 0 ? ATTENTION_ORDER.length : index; };
    const rank = (row: AttentionRow) => (row.tone === "danger" ? 0 : ATTENTION_ORDER.length + 1) + order(row.key);
    return rows.sort((a, b) => rank(a) - rank(b));
  };
}

function AttentionItem({ row }: { row: AttentionRow }) {
  const items = row.items.join(" · ");
  return <li data-key={row.key} data-tone={row.tone}>
    <Link href={row.href} aria-label={[row.count !== null ? `${row.count} ${row.label}` : row.label, ...row.items].join(" · ")}>
      <span className={styles.attentionMark} aria-hidden="true">{row.count ?? <span className={styles.attentionDot} />}</span>
      <span className={styles.attentionLabel}>{row.label}</span>
      {items ? <span className={styles.attentionItems} title={items} dir="auto">{items}</span> : null}
      <ArrowRight aria-hidden="true" size={14} className={styles.attentionGo} data-directional="true" />
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

