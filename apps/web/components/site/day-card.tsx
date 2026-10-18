"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { AlertTriangle, ArrowRight, Check, CircleDot, Eye, EyeOff, HardHat, Package, ShieldAlert } from "lucide-react";
import { Badge, Button, DateField, FormDialog, IconMenuButton, SelectField, Switch, TextAreaField, useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { quantityText } from "../purchasing/order-labels";
import type { DayCard as DayCardData, DayIssue, DayReport, SiteReportStatus } from "@/lib/site/types";
import { PhotoLightbox } from "./progress-card";
import styles from "./day-card.module.css";

type T = ReturnType<typeof useT>;
type PhotoUrl = (id: string, preview?: boolean) => string;
/** One site command (update an issue, raise from it, client visibility); true when it saved. */
export type DayCommand = (action: string, input: Record<string, unknown>) => Promise<boolean>;

const STRIP = 8;
const COMPACT_STRIP = 4;
const COMPACT_WORK = 3;

/** A day's state as one chip. */
export function dayStatusChip(status: SiteReportStatus, t: T): { label: string; tone: StatusTone } {
  if (status === "approved") return { label: t("Approved"), tone: "success" };
  if (status === "submitted") return { label: t("To review"), tone: "warning" };
  if (status === "returned") return { label: t("Returned"), tone: "danger" };
  return { label: t("Draft"), tone: "neutral" };
}

function severityChip(severity: DayIssue["severity"], t: T): { label: string; tone: StatusTone } {
  return severity === "critical" ? { label: t("Critical"), tone: "danger" } : severity === "major" ? { label: t("Major"), tone: "warning" } : { label: t("Minor"), tone: "neutral" };
}

/** The day ("Mon, 12 Oct") and a moment's time of day ("18:42"), in the workspace's locale and time zone. */
function useDayFormat() {
  const { locale, timeZone } = useDesignSystem();
  return useMemo(() => ({
    day: (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)),
    short: (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)),
    time: (value: string | null) => (value ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : ""),
  }), [locale, timeZone]);
}

/**
 * A project's day on site — the unit everyone reads. The day and who reported it when; the photos (open full size);
 * the work done (the plan's tasks with their stage, and what was installed); the issues with their owner, due date and
 * state, each a tap from a snag, a change request or a material request; the crew by trade; materials received and
 * used; what's next; and each report's approval and whether the client sees it. `compact` is the same card for the
 * Overview and Home: the day, its photos and the first of the work, with a link to the whole card.
 */
export function DayCard({ card, projectId, photoUrl, density = "full", me, canApprove = false, canManage = false, onTeam = false, canReport = false, members = [],
  highlighted = false, href, onOpenReport, onCommand }: {
  card: DayCardData; projectId: string; photoUrl: PhotoUrl; density?: "full" | "compact";
  me?: string; canApprove?: boolean; canManage?: boolean; onTeam?: boolean; canReport?: boolean; members?: Array<{ membershipId: string; name: string }>;
  highlighted?: boolean;
  /** Compact: where the whole card is (the project's Site tab, on this day). */
  href?: string;
  /** Opens a report: its review (manager), its form (its author's draft), or as it is. */
  onOpenReport?: (report: DayReport) => void;
  onCommand?: DayCommand;
}) {
  const t = useT();
  const format = useDayFormat();
  const [viewing, setViewing] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<DayIssue | null>(null);
  const [resolving, setResolving] = useState<DayIssue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const compact = density === "compact";
  const status = dayStatusChip(card.status, t);
  const several = card.reports.length > 1;
  const author = (reportId: string | null) => (several && reportId ? card.reports.find((report) => report.id === reportId)?.authorName ?? null : null);
  const photos = card.photos;
  const strip = photos.slice(0, compact ? COMPACT_STRIP : STRIP);
  const caption = (photo: DayCardData["photos"][number]) => [photo.area, photo.phase === "before" ? t("Before") : photo.phase === "after" ? t("After") : null].filter(Boolean).join(" · ");
  const work = compact ? card.work.slice(0, COMPACT_WORK) : card.work;
  const openIssues = card.issues.filter((issue) => issue.status === "open");
  const noWork = card.reports.filter((report) => report.noWorkReason).map((report) => report.noWorkReason);
  const run = async (key: string, action: string, input: Record<string, unknown>) => {
    if (!onCommand) return false;
    setBusy(key);
    try { return await onCommand(action, input); } finally { setBusy(null); }
  };
  const reportOf = (issue: DayIssue) => card.reports.find((report) => report.id === issue.reportId);
  const editable = (issue: DayIssue) => onTeam && Boolean(onCommand) && !["draft", "returned"].includes(reportOf(issue)?.status ?? "draft");

  const workLine = (item: DayCardData["work"][number]) => {
    if (item.kind === "installed") return t("{item}: {quantity} installed", { item: item.title, quantity: `${quantityText(item.quantity ?? "0")} ${item.unit}`.trim() });
    return item.title;
  };

  const issueLink = (issue: DayIssue) => {
    if (issue.raised === "change_request" && issue.changeRequestId)
      return <Link className={styles.link} href={`/workspace/projects/${projectId}/changes/${issue.changeRequestId}`}>{issue.changeRequestReference ?? t("Change request")}</Link>;
    if (issue.raised && issue.workItemId)
      return <Link className={styles.link} href={`/workspace/projects/${projectId}/plan?item=${encodeURIComponent(issue.workItemId)}`}>
        {issue.raised === "snag" ? t("Snag #{number}", { number: issue.workItemNumber ?? "" }) : t("Material request #{number}", { number: issue.workItemNumber ?? "" })}</Link>;
    return null;
  };

  const issueRow = (issue: DayIssue) => {
    const severity = severityChip(issue.severity, t);
    const canEdit = editable(issue);
    const actions = [
      { id: "assign", label: t("Owner and due date") },
      ...(issue.raised ? [] : [{ id: "snag", label: t("Raise a snag") }, { id: "change_request", label: t("Raise a change request") }, { id: "material", label: t("Request material") }]),
      ...(issue.status === "resolved" ? [{ id: "reopen", label: t("Reopen") }] : []),
    ];
    return <li key={issue.id} className={styles.issue} data-status={issue.status}>
      <div className={styles.issueMain}>
        <Badge tone={issue.status === "resolved" ? "success" : severity.tone}>{issue.status === "resolved" ? t("Resolved") : severity.label}</Badge>
        <span className={styles.issueText} dir="auto">{issue.description}</span>
      </div>
      <div className={styles.issueMeta}>
        {issue.status === "resolved"
          ? <span>{[issue.resolvedByName ? t("Resolved by {name}", { name: issue.resolvedByName }) : null, issue.resolution || null].filter(Boolean).join(" · ")}</span>
          : <span data-overdue={issue.overdue || undefined}>{[issue.ownerName ?? t("No owner"), issue.dueOn ? t("Due {date}", { date: format.short(issue.dueOn) }) : null].filter(Boolean).join(" · ")}</span>}
        {!issue.internal ? <span>{t("Shared with the client")}</span> : null}
        {author(issue.reportId) ? <span>{author(issue.reportId)}</span> : null}
        {issueLink(issue)}
        {canEdit && !compact ? <span className={styles.issueActions}>
          {issue.status === "open" ? <Button size="compact" variant="quiet" isLoading={busy === `resolve:${issue.id}`} onPress={() => setResolving(issue)}>{t("Resolve")}</Button> : null}
          <IconMenuButton ariaLabel={t("More for {item}", { item: issue.description })} items={actions} onAction={(id) => {
            if (id === "assign") setAssigning(issue);
            else if (id === "reopen") void run(`resolve:${issue.id}`, "update_issue", { issueId: issue.id, version: issue.version, status: "open" });
            else void run(`raise:${issue.id}`, "raise_issue", { issueId: issue.id, kind: id });
          }} />
        </span> : null}
      </div>
    </li>;
  };

  const reportRow = (report: DayReport) => {
    const chip = dayStatusChip(report.status, t);
    const own = report.authorId === me;
    const reviewable = canApprove && !own && report.status === "submitted";
    const continuing = own && canReport && ["draft", "returned"].includes(report.status);
    const shown = report.delivery === "sent" && !report.hidden;
    return <li key={report.id} className={styles.report}>
      <span className={styles.reportWho}>
        <strong>{report.authorName}</strong>
        <span className={styles.muted}>{[report.submittedAt ? format.time(report.submittedAt) : null, report.backdated ? t("Added later") : null].filter(Boolean).join(" · ")}</span>
      </span>
      {several ? <Badge tone={chip.tone}>{chip.label}</Badge> : null}
      {report.late ? <Badge tone="warning">{t("Late")}</Badge> : null}
      <span className={styles.spacer} />
      {canManage && report.status === "approved" && onCommand ? <Switch isSelected={shown} isDisabled={busy === `visible:${report.id}`}
        onChange={(visible) => void run(`visible:${report.id}`, "set_client_visibility", { reportId: report.id, version: report.version, visible })}>{t("Client sees this")}</Switch>
        : shown ? <span className={styles.clientSees}><Eye aria-hidden="true" size={14} />{t("Client sees this")}</span> : null}
      {onOpenReport ? <Button size="compact" variant={reviewable || continuing ? "primary" : "secondary"} onPress={() => onOpenReport(report)}>
        {reviewable ? t("Review") : continuing ? t("Continue") : t("Open")}</Button> : null}
    </li>;
  };

  const returned = card.reports.filter((report) => report.status === "returned" && report.decisionNote);
  const safety = card.reports.filter((report) => report.safety !== "none");
  const outlook = card.reports.filter((report) => report.forecast !== "none");
  const hidden = card.reports.some((report) => report.delivery === "sent" && report.hidden);

  return <article className={styles.card} data-density={density} data-highlighted={highlighted || undefined} id={`day-${card.date}`}
    aria-label={t("Site day {date}", { date: format.day(card.date) })}>
    <header className={styles.head}>
      <time dateTime={card.date} className={styles.date}>{format.day(card.date)}</time>
      <Badge tone={status.tone}>{status.label}</Badge>
      {card.clientVisible ? <span className={styles.clientSees} title={t("Client sees this")}><Eye aria-hidden="true" size={14} />{compact ? null : t("Client sees this")}</span>
        : hidden ? <span className={styles.muted}><EyeOff aria-hidden="true" size={14} /> {t("Off the client's page")}</span> : null}
      <span className={styles.byline}>{card.reports.map((report) => report.authorName).join(", ")}</span>
    </header>

    {returned.map((report) => <p key={report.id} className={styles.returned}>{t("Sent back by {name}: {note}", { name: report.decidedByName ?? "", note: report.decisionNote })}</p>)}

    {strip.length ? <ul className={styles.strip} aria-label={t("Photos")}>{strip.map((photo, index) => <li key={photo.id}>
      <button type="button" className={styles.thumb} onClick={() => setViewing(index)} aria-label={t("Open photo {number}", { number: index + 1 })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
        <img src={photoUrl(photo.id, true)} alt={caption(photo) || t("Site photo {number}, {date}", { number: index + 1, date: format.day(card.date) })} loading="lazy"
          onError={(event) => { event.currentTarget.closest("li")?.setAttribute("hidden", ""); }} />
        {index === strip.length - 1 && photos.length > strip.length ? <span className={styles.more}>{t("+{count}", { count: photos.length - strip.length })}</span> : null}
      </button>
    </li>)}</ul> : null}

    {noWork.length ? <p className={styles.noWork}>{noWork.map((reason) => t("No work: {reason}", { reason })).join(" · ")}</p> : null}

    {work.length ? <section className={styles.part} aria-label={t("Work done")}>
      <h4 className={styles.partTitle}>{t("Work done")}</h4>
      <ul className={styles.items}>{work.map((item) => <li key={item.id}>
        {item.kind === "task" && (item.progress ?? 0) < 100 ? <CircleDot aria-hidden="true" size={14} className={styles.moving} /> : <Check aria-hidden="true" size={15} className={styles.done} />}
        <span className={styles.itemText} dir="auto">{workLine(item)}</span>
        <span className={styles.itemMeta}>{[item.kind === "task" && item.progress !== null && item.progress < 100 ? t("{percent}%", { percent: item.progress }) : null,
          item.stageName, item.area, author(item.reportId)].filter(Boolean).join(" · ")}</span>
      </li>)}</ul>
      {compact && card.work.length > work.length ? <span className={styles.muted}>{t("{count} more", { count: card.work.length - work.length })}</span> : null}
    </section> : null}

    {compact ? <div className={styles.summaryRow}>
      {openIssues.length ? <span className={styles.alert}><AlertTriangle aria-hidden="true" size={14} />{openIssues.length === 1 ? t("1 open issue") : t("{count} open issues", { count: openIssues.length })}</span> : null}
      {card.people ? <span><HardHat aria-hidden="true" size={14} />{t("{count} on site", { count: card.people })}</span> : null}
      <span className={styles.spacer} />
      {href ? <Link className={styles.open} href={href}>{t("Open")}<ArrowRight aria-hidden="true" size={13} data-directional="true" /></Link> : null}
    </div> : <>
      {card.issues.length ? <section className={styles.part} aria-label={t("Issues")}>
        <h4 className={styles.partTitle}>{t("Issues")}</h4>
        <ul className={styles.issues}>{card.issues.map(issueRow)}</ul>
      </section> : null}

      {card.crew.length ? <section className={styles.part} aria-label={t("Crew on site")}>
        <h4 className={styles.partTitle}>{t("Crew on site")}</h4>
        <p className={styles.crew}>{card.crew.map((row) => <span key={row.trade} className={styles.trade}>{t("{trade} {people}", { trade: row.trade, people: row.people })}</span>)}
          <span className={styles.muted}>{t("{count} on site", { count: card.people })}</span></p>
      </section> : null}

      {card.materials.length ? <section className={styles.part} aria-label={t("Materials")}>
        <h4 className={styles.partTitle}>{t("Materials")}</h4>
        <ul className={styles.items}>{card.materials.map((item) => <li key={item.id}>
          <Package aria-hidden="true" size={14} className={styles.quiet} />
          <span className={styles.itemText} dir="auto">{[item.direction === "received" ? t("Received") : t("Used"), item.description,
            item.quantity ? `${quantityText(item.quantity)} ${item.unit}`.trim() : null].filter(Boolean).join(" · ")}</span>
          <span className={styles.itemMeta}>{[item.source === "report" ? item.reference : item.source === "delivery" ? t("Delivery") : t("From stock"), author(item.reportId)].filter(Boolean).join(" · ")}</span>
        </li>)}</ul>
      </section> : null}

      {safety.length || outlook.length ? <section className={styles.part} aria-label={t("Safety and outlook")}>
        <ul className={styles.items}>
          {safety.map((report) => <li key={`safety-${report.id}`} className={report.safety === "incident" ? styles.alert : undefined}>
            <ShieldAlert aria-hidden="true" size={14} /><span className={styles.itemText} dir="auto">{`${report.safety === "incident" ? t("Incident") : t("Safety observation")}: ${report.safetyNote}`}</span></li>)}
          {outlook.map((report) => <li key={`outlook-${report.id}`} className={report.forecast === "blocked" ? styles.alert : undefined}>
            <AlertTriangle aria-hidden="true" size={14} /><span className={styles.itemText} dir="auto">{t("{state}: {impact} ({owner} by {date})", {
              state: report.forecast === "blocked" ? t("Blocked") : t("At risk"), impact: report.impact, owner: report.recoveryOwnerName ?? "", date: report.recoveryOn ? format.short(report.recoveryOn) : "" })}</span></li>)}
        </ul>
      </section> : null}

      {card.next.length ? <section className={styles.part} aria-label={t("Next")}>
        <h4 className={styles.partTitle}>{t("Next")}</h4>
        <ul className={styles.items}>{card.next.map((item) => <li key={item.id}><ArrowRight aria-hidden="true" size={14} className={styles.quiet} data-directional="true" />
          <span className={styles.itemText} dir="auto">{item.title}</span></li>)}</ul>
      </section> : null}

      {card.reports.some((report) => report.notes) ? <section className={styles.part} aria-label={t("Notes for the team")}>
        <h4 className={styles.partTitle}>{t("Notes for the team")}</h4>
        {card.reports.filter((report) => report.notes).map((report) => <p key={report.id} className={styles.note} dir="auto">{several ? `${report.authorName}: ${report.notes}` : report.notes}</p>)}
      </section> : null}

      <ul className={styles.reports} aria-label={t("Reports")}>{card.reports.map(reportRow)}</ul>
    </>}

    {viewing !== null ? <PhotoLightbox photos={photos.map((photo) => ({ id: photo.id, caption: caption(photo) }))} start={viewing}
      photoUrl={(id, preview) => photoUrl(id, preview)} title={format.day(card.date)} onClose={() => setViewing(null)} /> : null}
    {assigning ? <IssueOwnerDialog issue={assigning} members={members} onClose={() => setAssigning(null)}
      onSave={async (ownerId, dueOn) => { if (await run(`assign:${assigning.id}`, "update_issue", { issueId: assigning.id, version: assigning.version, ownerId, dueOn })) setAssigning(null); }} /> : null}
    {resolving ? <ResolveDialog issue={resolving} onClose={() => setResolving(null)}
      onSave={async (resolution) => { if (await run(`resolve:${resolving.id}`, "update_issue", { issueId: resolving.id, version: resolving.version, status: "resolved", resolution })) setResolving(null); }} /> : null}
  </article>;
}

/** Who owns an issue, and by when. */
function IssueOwnerDialog({ issue, members, onClose, onSave }: { issue: DayIssue; members: Array<{ membershipId: string; name: string }>; onClose: () => void;
  onSave: (ownerId: string | null, dueOn: string | null) => Promise<void> }) {
  const t = useT();
  const [owner, setOwner] = useState(issue.ownerId ?? "");
  const [due, setDue] = useState<string | null>(issue.dueOn);
  return <FormDialog size="md" title={t("Owner and due date")} onClose={onClose} submitLabel={t("Save")} isDirty={owner !== (issue.ownerId ?? "") || due !== issue.dueOn}
    onSubmit={() => onSave(owner || null, due)}>
    <SelectField label={t("Owner")} placeholder={t("Choose")} selectedKey={owner} onSelectionChange={(key) => setOwner(key ? String(key) : "")}
      items={[{ id: "", label: t("No owner") }, ...members.map((member) => ({ id: member.membershipId, label: member.name }))]} />
    <DateField label={t("Due")} value={due ? parseDate(due) : null} onChange={(value) => setDue(value ? value.toString() : null)} />
  </FormDialog>;
}

/** Resolving an issue: how it was resolved (optional). */
function ResolveDialog({ issue, onClose, onSave }: { issue: DayIssue; onClose: () => void; onSave: (resolution: string) => Promise<void> }) {
  const t = useT();
  const [resolution, setResolution] = useState("");
  return <FormDialog size="md" title={t("Resolve issue")} onClose={onClose} submitLabel={t("Resolve")} isDirty={Boolean(resolution.trim())} onSubmit={() => onSave(resolution.trim())}>
    <p className={styles.dialogText} dir="auto">{issue.description}</p>
    <TextAreaField label={t("How it was resolved")} value={resolution} onChange={setResolution} maxLength={500} />
  </FormDialog>;
}
