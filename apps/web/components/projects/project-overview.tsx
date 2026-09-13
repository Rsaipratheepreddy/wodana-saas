"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  Clock3,
  TriangleAlert,
  Users,
  ClipboardCheck,
  CalendarDays,
  MessageSquare,
  Camera,
  Layers3,
} from "lucide-react";
import { money } from "@/lib/commercial/client";
import {
  taskProgress,
  label,
  type ProjectState,
} from "@/lib/projects/execution";
import s from "./project-workspace.module.css";
import v from "./project-visual.module.css";
export const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export const shortDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export function ProjectOverview({
  state,
  today,
  open,
  conversation,
}: {
  state: ProjectState;
  today: string;
  open: (id: string) => void;
  conversation: (id: string) => void;
}) {
  const d = state.data,
    root = `/workspace/projects/${state.id}`,
    progress = Math.round(taskProgress(d)),
    live = d.tasks.filter((t) => t.status !== "cancelled"),
    leaf = live.filter((t) => !live.some((c) => c.parentId === t.id)),
    done = leaf.filter((t) => t.status === "completed").length,
    attention = live.filter(
      (t) =>
        t.status === "blocked" ||
        (!["completed", "cancelled"].includes(t.status) && t.end < today),
    ),
    reports = d.reports.filter((r) => r.status === "submitted"),
    last = [...d.reports].sort((a, b) => b.date.localeCompare(a.date))[0],
    upcoming = [...(d.milestones ?? [])]
      .filter((m) => !m.acceptedAt)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    deliveryTimeline = [...(d.milestones ?? [])].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    ),
    photos = last
      ? (d.files ?? []).filter(
          (f) => f.recordId === last.id && f.mimeType.startsWith("image/"),
        )
      : [];
  const approvedDesigns = d.documents.filter((document) => document.status === "approved").length;
  const supplyComplete =
    d.orders.length > 0 &&
    d.orders.every((order) => ["closed", "cancelled"].includes(order.status));
  const siteTasks = leaf.filter((task) => task.location === "site");
  const siteComplete =
    siteTasks.length > 0 && siteTasks.every((task) => task.status === "completed");
  const openSnags = d.snags.filter((snag) => snag.status !== "closed").length;
  const snaggingComplete = siteComplete && openSnags === 0;
  const handoverComplete =
    d.phase === "completed" ||
    (d.handovers.length > 0 && d.handovers.every((handover) => handover.status === "accepted"));
  const operatingStages = [
    { label: "New project", range: "03", detail: "Created", href: root, state: "complete" },
    {
      label: "Design",
      range: "04–09",
      detail: `${approvedDesigns} approved`,
      href: `${root}/documents`,
      state: approvedDesigns > 0 ? "complete" : "current",
    },
    {
      label: "Costing & supply",
      range: "10–13",
      detail: `${d.scope?.lines.length ?? 0} BOQ · ${d.orders.filter((order) => !["closed", "cancelled"].includes(order.status)).length} open`,
      href: `${root}/procurement`,
      state: approvedDesigns === 0 ? "pending" : supplyComplete ? "complete" : "current",
    },
    {
      label: "Site & installation",
      range: "14–15",
      detail: `${siteTasks.filter((task) => task.status === "completed").length}/${siteTasks.length} complete`,
      href: `${root}/site-work`,
      state: !supplyComplete ? "pending" : siteComplete ? "complete" : "current",
    },
    {
      label: "Snagging",
      range: "16",
      detail: `${openSnags} open`,
      href: `${root}/snagging`,
      state: !siteComplete ? "pending" : snaggingComplete ? "complete" : "current",
    },
    {
      label: "Handover",
      range: "17",
      detail: `${d.handovers.filter((handover) => handover.status === "accepted").length}/${d.handovers.length} accepted`,
      href: `${root}/handover`,
      state: !snaggingComplete ? "pending" : handoverComplete ? "complete" : "current",
    },
  ];
  const person = (id: string) =>
    state.members.find((m) => m.id === id)?.name ?? "Unassigned";
  return (
    <div className={v.overview}>
      <div className={v.projectPulse}>
        <div className={v.pulseCopy}>
          <span className={v.eyebrow}>
            <Layers3 size={14} /> PROJECT PULSE
          </span>
          <h2>
            {attention.length
              ? `${attention.length} ${attention.length === 1 ? "task needs" : "tasks need"} a closer look`
              : "A clear view of the work ahead"}
          </h2>
          <p>
            {upcoming[0]
              ? `Next milestone · ${upcoming[0].title} · ${shortDate(upcoming[0].dueDate)}`
              : "Keep teams, materials and site updates moving together."}
          </p>
          <Link href={`${root}/plan-teams`} className={s.button}>
            Open work plan <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className={v.pulseProgress}>
          <div className={v.progressSummary}>
            <strong>{progress}%</strong>
            <span>{done} of {leaf.length} tasks complete</span>
          </div>
          <span className={v.pulseTrack} aria-label={`${progress}% approved`}>
            <span style={{ width: `${progress}%` }} />
          </span>
        </div>
      </div>
      <nav className={v.stageRail} aria-label="Project operating stages">
        <ol>
          {operatingStages.map((stage) => (
            <li key={stage.range} data-state={stage.state}>
              <Link href={stage.href}>
                <span className={v.stageNode} aria-hidden="true">
                  {stage.state === "complete" ? <Check size={12} /> : stage.range}
                </span>
                <span>
                  <strong>{stage.label}</strong>
                  <small>{stage.range} · {stage.detail}</small>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className={v.quickMetrics}>
        {[
          {
            title: "Work in progress",
            value: leaf.filter((t) => t.status === "in_progress").length,
            hint: "Live tasks",
            icon: Clock3,
            to: "plan-teams",
            tone: "lilac",
          },
          {
            title: "Updates to review",
            value: reports.length,
            hint: "Awaiting a manager",
            icon: ClipboardCheck,
            to: "daily-progress",
            tone: "peach",
          },
          {
            title: "Open snags",
            value: d.snags.filter((t) => t.status !== "closed").length,
            hint: "Quality follow-up",
            icon: TriangleAlert,
            to: "snagging",
            tone: "rose",
          },
          {
            title: "Teams booked",
            value: new Set(
              state.bookings
                .filter(
                  (b) =>
                    b.projectId === state.id &&
                    b.start <= today &&
                    b.end >= today,
                )
                .map((b) => b.resourceId),
            ).size,
            hint: "On the plan today",
            icon: Users,
            to: "plan-teams",
            tone: "lilac",
          },
        ].map((m) => (
          <Link
            key={m.title}
            className={v.quickMetric}
            href={`${root}/${m.to}`}
          >
            <span className={v.metricIcon} data-tone={m.tone}>
              <m.icon size={18} />
            </span>
            <div>
              <span>{m.title}</span>
              <strong>{m.value}</strong>
              <small>{m.hint}</small>
            </div>
            <ArrowUpRight className={v.metricArrow} size={14} />
          </Link>
        ))}
      </div>
      <div className={v.overviewColumns}>
        <div>
          <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>
                <TriangleAlert size={16} /> Needs attention{" "}
                <span>{attention.length}</span>
              </h2>
              <Link href={`${root}/plan-teams`}>
                View work plan <ArrowUpRight size={13} />
              </Link>
            </div>
            {attention.slice(0, 5).map((t) => (
              <button
                className={v.attentionRow}
                key={t.id}
                onClick={() => open(t.id)}
              >
                <span className={v.priorityDot} />
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    {t.blocker || `Planned finish ${shortDate(t.end)}`} ·{" "}
                    {person(t.ownerId)}
                  </small>
                </div>
                <span
                  className={s.status}
                  data-state={t.status === "blocked" ? "blocked" : "returned"}
                >
                  {t.status === "blocked" ? "Blocked" : "Overdue"}
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            {!attention.length && (
              <p className={v.quietState}>
                <CircleCheck size={18} /> No blocked or overdue work.
              </p>
            )}
          </section>
          <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>
                <Camera size={16} /> Latest from the field
              </h2>
              <Link href={`${root}/daily-progress`}>
                Site diary <ArrowUpRight size={13} />
              </Link>
            </div>
            {last ? (
              <button className={v.latestReport} onClick={() => open(last.id)}>
                {photos[0] ? (
                  <img
                    src={`/api/project-files/${state.id}/${photos[0].id}?workspaceId=${state.workspaceId}`}
                    alt={`Site evidence · ${photos[0].name}`}
                  />
                ) : (
                  <span className={v.reportDate}>
                    <strong>{last.date.slice(8)}</strong>
                    {shortDate(last.date)
                      .split(" ")
                      .filter((x) => !/^[0-9]+$/.test(x))
                      .join(" ")}
                  </span>
                )}
                <div>
                  <div className={v.inline}>
                    <strong>
                      {last.summary ||
                        `${label(last.location)} · ${last.shift}`}
                    </strong>
                    <span className={s.status} data-state={last.status}>
                      {label(last.status)}
                    </span>
                  </div>
                  <p>
                    {last.entries
                      .slice(0, 2)
                      .map(
                        (e) =>
                          `${d.tasks.find((t) => t.id === e.taskId)?.title ?? "Work"} · ${e.quantity} ${d.tasks.find((t) => t.id === e.taskId)?.unit ?? ""}`,
                      )
                      .join(" / ") ||
                      last.issues ||
                      "Site conditions and team update"}
                  </p>
                  <small>
                    {last.author} · {shortDate(last.date)} · {photos.length}{" "}
                    photos
                  </small>
                </div>
                <ArrowUpRight size={16} />
              </button>
            ) : (
              <p className={v.quietState}>
                The first site report will appear here.
              </p>
            )}
          </section>
          <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>
                <CalendarDays size={16} /> Delivery timeline
              </h2>
              <Link href={`${root}/plan-teams?view=schedule`}>
                Schedule <ArrowUpRight size={13} />
              </Link>
            </div>
            {deliveryTimeline.length ? (
              <ol className={v.deliveryTimeline}>
                {deliveryTimeline.slice(0, 5).map((milestone) => {
                  const complete = milestone.taskIds.filter(
                    (id) => d.tasks.find((task) => task.id === id)?.status === "completed",
                  ).length;
                  const milestoneState = milestone.acceptedAt
                    ? "accepted"
                    : milestone.dueDate < today
                      ? "overdue"
                      : "upcoming";
                  return (
                    <li key={milestone.id} data-state={milestoneState}>
                      <span className={v.deliveryNode} aria-hidden="true">
                        {milestone.acceptedAt ? <CircleCheck size={13} /> : <CalendarDays size={13} />}
                      </span>
                      <time dateTime={milestone.dueDate}>{shortDate(milestone.dueDate)}</time>
                      <div>
                        <strong>{milestone.title}</strong>
                        <small>{person(milestone.ownerId)} · {complete}/{milestone.taskIds.length} tasks complete</small>
                      </div>
                      <span
                        className={s.status}
                        data-state={milestoneState === "overdue" ? "returned" : milestoneState}
                      >
                        {milestoneState === "accepted" ? "Accepted" : milestoneState === "overdue" ? "Overdue" : "Upcoming"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={v.quietState}>No milestones added yet.</p>
            )}
          </section>
        </div>
        <aside>
          <section className={v.decisionPanel}>
            <div className={v.sectionHeading}>
              <h2>Ready for your decision</h2>
            </div>
            {[
              {
                name: "Daily reports",
                n: reports.length,
                to: "daily-progress",
                icon: ClipboardCheck,
              },
              {
                name: "Inspection checks",
                n: d.tasks.filter((t) => t.status === "awaiting_inspection")
                  .length,
                to: "site-work",
                icon: CircleCheck,
              },
              {
                name: "Purchase orders",
                n: d.orders.filter((o) => o.status === "submitted").length,
                to: "procurement",
                icon: Layers3,
              },
            ].map((x) => (
              <Link
                key={x.name}
                className={v.decisionRow}
                href={`${root}/${x.to}`}
              >
                <x.icon size={17} />
                <span>{x.name}</span>
                <strong>{x.n}</strong>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </section>
          <section className={v.scopePanel}>
            <span className={v.eyebrow}>AGREED SCOPE</span>
            <strong>
              {d.scope
                ? money(
                    d.scope.value +
                      (d.variations ?? []).reduce((n, x) => n + x.value, 0),
                    d.scope.currency,
                  )
                : "Awaiting release"}
            </strong>
            <p>
              {d.scope
                ? `${d.scope.lines.length} BOQ lines · Quotation V${d.scope.quoteNumber}`
                : "Scope appears after commercial release."}
            </p>
            <Link
              href={`/workspace/pre-projects/cases/${state.caseId}/quotations${d.scope ? `?quote=${d.scope.quoteId}` : ""}`}
            >
              View quotation <ArrowUpRight size={14} />
            </Link>
          </section>
          <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>
                <MessageSquare size={16} /> Team activity
              </h2>
            </div>
            {d.comments
              .filter(
                (c) => c.mentions?.includes(state.memberId) && !c.resolved,
              )
              .slice(-2)
              .map((c) => (
                <button
                  className={v.mention}
                  key={c.id}
                  onClick={() => conversation(c.recordId)}
                >
                  <strong>{c.author} mentioned you</strong>
                  <span>{c.text}</span>
                </button>
              ))}
            <ol className={v.activity}>
              {d.audit
                .slice(-5)
                .reverse()
                .map((a) => (
                  <li key={a.id}>
                    <span className={v.avatar}>{initials(a.author)}</span>
                    <div>
                      <strong>{label(a.action)}</strong>
                      <small>
                        {a.author} ·{" "}
                        {new Date(a.at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        })}
                      </small>
                      {a.note && <p>{a.note}</p>}
                    </div>
                  </li>
                ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
