"use client";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CalendarDays,
} from "lucide-react";
import { money } from "@/lib/commercial/client";
import { quantityToSource } from "@/lib/projects/purchasing";
import {
  projectActionRoute,
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

type DeliveryStageState = "complete" | "current" | "attention" | "upcoming";

function deliveryState(total: number, done: number, attention = false): DeliveryStageState {
  if (attention) return "attention";
  if (!total) return "upcoming";
  if (done === total) return "complete";
  return "current";
}

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
    nextActions = state.pulse.nextActions,
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
  const packages = (d.workPackages ?? []).filter((item) => item.status !== "cancelled");
  const completedPackages = packages.filter((item) => item.status === "completed").length;
  const packageAttention = packages.some((item) => ["blocked", "on_hold"].includes(item.status));
  const activeOrders = d.orders.filter((order) => order.status !== "cancelled");
  const closedOrders = activeOrders.filter((order) => order.status === "closed").length;
  const overdueOrders = activeOrders.filter((order) => order.status !== "closed" && order.promisedDate < today).length;
  const materialsReady = d.materials.length > 0
    && d.materials.every((material) => quantityToSource(material, d.orders) === 0)
    && activeOrders.every((order) => order.status === "closed");
  const factoryTasks = leaf.filter((task) => task.location === "factory");
  const factoryDone = factoryTasks.filter((task) => task.status === "completed").length;
  const factoryAttention = factoryTasks.some((task) => ["blocked", "on_hold"].includes(task.status));
  const siteTasks = leaf.filter((task) => task.location === "site");
  const siteDone = siteTasks.filter((task) => task.status === "completed").length;
  const siteAttention = siteTasks.some((task) => ["blocked", "on_hold"].includes(task.status));
  const openSnags = d.snags.filter((snag) => snag.status !== "closed");
  const acceptedHandovers = d.handovers.filter((handover) => handover.status === "accepted").length;
  const qualityAttention = openSnags.some((snag) => snag.severity === "critical" || snag.dueDate < today)
    || d.handovers.some((handover) => handover.status === "returned");
  const deliveryStages: Array<{ href: string; label: string; detail: string; state: DeliveryStageState }> = [
    {
      href: `${root}/plan-teams`,
      label: "Plan",
      detail: packages.length ? `${completedPackages}/${packages.length} packages complete` : "No work packages yet",
      state: deliveryState(packages.length, completedPackages, packageAttention),
    },
    {
      href: `${root}/material-planning`,
      label: "Materials & orders",
      detail: d.materials.length || activeOrders.length ? `${d.materials.length} requirements · ${activeOrders.length - closedOrders} open orders` : "No material demand yet",
      state: materialsReady ? "complete" : deliveryState(activeOrders.length || d.materials.length, 0, overdueOrders > 0),
    },
    {
      href: `${root}/production`,
      label: "Production",
      detail: factoryTasks.length ? `${factoryDone}/${factoryTasks.length} factory tasks complete` : "No factory work yet",
      state: deliveryState(factoryTasks.length, factoryDone, factoryAttention),
    },
    {
      href: `${root}/site-work`,
      label: "Onsite",
      detail: siteTasks.length ? `${siteDone}/${siteTasks.length} site tasks complete` : "No site work yet",
      state: deliveryState(siteTasks.length, siteDone, siteAttention),
    },
    {
      href: `${root}/${openSnags.length ? "snagging" : "handover"}`,
      label: "Quality & close",
      detail: d.snags.length || d.handovers.length ? `${openSnags.length} open snags · ${acceptedHandovers}/${d.handovers.length} handovers accepted` : "No quality or handover records yet",
      state: qualityAttention
        ? "attention"
        : d.handovers.length && acceptedHandovers === d.handovers.length && !openSnags.length
          ? "complete"
          : d.handovers.length || d.snags.length
            ? "current"
            : "upcoming",
    },
  ];
  const mentions = d.comments.filter((comment) => comment.mentions?.includes(state.memberId) && !comment.resolved).slice(-2);
  const showAside = Boolean(d.scope || mentions.length || d.audit.length);
  const person = (id: string) =>
    state.members.find((m) => m.id === id)?.name ?? "Unassigned";
  return (
    <div className={v.overview}>
      {leaf.length || upcoming[0] ? <div className={v.projectSummary}>
        {leaf.length ? <span><strong>{progress}%</strong> approved work · {done} of {leaf.length} tasks complete</span> : null}
        {upcoming[0] ? <span>Next milestone · {upcoming[0].title} · {shortDate(upcoming[0].dueDate)}</span> : null}
      </div> : null}
      <section aria-labelledby="delivery-flow-title">
        <div className={v.flowHeading}>
          <div><span className={v.eyebrow}>LIVE DELIVERY FLOW</span><h2 id="delivery-flow-title">Plan to handover</h2></div>
          <p>Verified project records, not AI estimates. Open any stage to continue.</p>
        </div>
        <nav className={v.stageRail} aria-label="Project delivery flow">
          <ol>
            {deliveryStages.map((stage, index) => <li key={stage.href} data-state={stage.state}>
              <Link href={stage.href}>
                <span className={v.stageNode} aria-hidden="true">
                  {stage.state === "complete" ? <CircleCheck size={15} /> : stage.state === "attention" ? <CircleAlert size={15} /> : stage.state === "current" ? <CircleDot size={15} /> : index + 1}
                </span>
                <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
              </Link>
            </li>)}
          </ol>
        </nav>
      </section>
      <div className={v.overviewColumns} data-single={!showAside || undefined}>
        <div>
          <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>Next actions <span>{nextActions.length}</span></h2>
              <Link href={`${root}/plan-teams`}>
                View work plan <ArrowUpRight size={13} />
              </Link>
            </div>
            {nextActions.slice(0, 5).map((action) => (
              <Link
                className={v.attentionRow}
                href={projectActionRoute(state.id, action)}
                key={action.id}
              >
                <span className={v.priorityDot} data-priority={action.priority} />
                <div>
                  <strong>{action.title}</strong>
                  <small>
                    {action.detail}{action.ownerId ? ` · ${person(action.ownerId)}` : ""}
                  </small>
                </div>
                {action.priority !== "normal" ? <span className={s.status} data-state={action.priority === "critical" ? "blocked" : "returned"}>{label(action.priority)}</span> : null}
                <ArrowUpRight size={14} />
              </Link>
            ))}
            {!nextActions.length && (
              <p className={v.quietState}>
                <CircleCheck size={18} /> No project decisions are waiting.
              </p>
            )}
          </section>
          {last ? <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>Latest from the field</h2>
              <Link href={`${root}/daily-progress`}>
                Site diary <ArrowUpRight size={13} />
              </Link>
            </div>
            <button className={v.latestReport} onClick={() => open(last.id)}>
                {photos[0] ? (
                  <Image
                    src={`/api/project-files/${state.id}/${photos[0].id}?workspaceId=${state.workspaceId}`}
                    alt={`Site evidence · ${photos[0].name}`}
                    width={84}
                    height={80}
                    unoptimized
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
          </section> : null}
          {deliveryTimeline.length ? <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>Delivery timeline</h2>
              <Link href={`${root}/plan-teams?view=schedule`}>
                Schedule <ArrowUpRight size={13} />
              </Link>
            </div>
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
          </section> : null}
        </div>
        {showAside ? <aside>
          {d.scope ? <section className={v.scopePanel}>
            <span className={v.eyebrow}>Agreed scope</span>
            <strong>
              {money(d.scope.value + (d.variations ?? []).reduce((n, x) => n + x.value, 0), d.scope.currency)}
            </strong>
            <p>{d.scope.lines.length} BOQ lines · Quotation V{d.scope.quoteNumber}</p>
            <Link
              href={`/workspace/pre-projects/cases/${state.caseId}/quotations?quote=${d.scope.quoteId}`}
            >
              View quotation <ArrowUpRight size={14} />
            </Link>
          </section> : null}
          {mentions.length || d.audit.length ? <section className={v.section}>
            <div className={v.sectionHeading}>
              <h2>Team activity</h2>
            </div>
            {mentions.map((c) => (
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
          </section> : null}
        </aside> : null}
      </div>
    </div>
  );
}
