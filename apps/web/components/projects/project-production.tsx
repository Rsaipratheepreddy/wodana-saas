"use client";
import Link from "next/link";
import {
  ArrowRight,
  Factory,
  ClipboardCheck,
  Truck,
  CircleCheck,
  Circle,
  Users,
  TriangleAlert,
} from "lucide-react";
import {
  label,
  taskProgress,
  type ProjectState,
  type Task,
} from "@/lib/projects/execution";
import s from "./project-workspace.module.css";
import f from "./project-flow.module.css";
export function productionReadiness(state: ProjectState, t: Task) {
  const d = state.data,
    resource = state.resources.find((r) => r.id === t.resourceId),
    orders = d.orders.filter(
      (o) =>
        o.taskId === t.id && o.kind === "factory" && o.status !== "cancelled",
    ),
    external = resource?.kind === "vendor" || orders.length > 0;
  return {
    external,
    resource,
    orders,
    checks: [
      {
        title: "Commercial release",
        ready: state.commercialReady,
        href: `/workspace/pre-projects/cases/${state.caseId}/execution-release`,
      },
      { title: "Scope & measurements", ready: t.readiness.scope },
      {
        title: "Approved drawing",
        ready: d.documents.some(
          (x) => x.id === t.drawingId && x.status === "approved",
        ),
        href: `/workspace/projects/${state.id}/documents?record=${t.drawingId}`,
      },
      {
        title: "Materials ready",
        ready: t.readiness.materials,
        href: `/workspace/projects/${state.id}/material-planning`,
      },
      {
        title: "Owner & access",
        ready: Boolean(t.ownerId) && t.readiness.access,
      },
      {
        title: "Preceding work",
        ready: t.predecessors.every((id) =>
          d.tasks.some((x) => x.id === id && x.status === "completed"),
        ),
      },
      {
        title: "Capacity confirmed",
        ready:
          resource?.active === true &&
          state.bookings.some(
            (b) =>
              b.taskId === t.id &&
              b.projectId === state.id &&
              b.status === "confirmed",
          ),
      },
      ...(external
        ? [
            {
              title: "Factory order confirmed",
              ready:
                orders.some((o) =>
                  ["acknowledged", "closed"].includes(o.status),
                ) &&
                orders
                  .filter((o) => o.status !== "enquiry")
                  .every((o) => ["acknowledged", "closed"].includes(o.status)),
              href: `/workspace/projects/${state.id}/procurement${orders[0] ? `?record=${orders[0].id}` : ""}`,
            },
          ]
        : []),
    ],
  };
}
export function ProjectProduction({
  state,
  tasks,
  busy,
  onOpen,
  onStart,
  onReport,
  onDispatch,
  onOrder,
}: {
  state: ProjectState;
  tasks: Task[];
  busy: boolean;
  onOpen: (t: Task) => void;
  onStart: (t: Task) => void;
  onReport: (t: Task) => void;
  onDispatch: (t: Task) => void;
  onOrder: (t: Task) => void;
}) {
  const jobs = tasks.filter(
    (t) =>
      !state.data.tasks.some(
        (c) => c.parentId === t.id && c.status !== "cancelled",
      ),
  );
  return (
    <div className={f.flowWorkspace}>
      <div className={f.flowIntro}>
        <Factory size={22} />
        <div>
          <h2>From approved drawing to site delivery</h2>
          <p>
            Workshop jobs and outside-factory orders, linked to the same work
            plan.
          </p>
        </div>
        <Link
          className={s.button}
          href={`/workspace/projects/${state.id}/plan-teams`}
        >
          Plan & teams <ArrowRight size={14} />
        </Link>
      </div>
      <div className={f.flowSteps}>
        {[
          "Prepare & release",
          "Make & report",
          "Inspect output",
          "Dispatch to site",
        ].map((step, i) => (
          <div key={step}>
            <span>{i + 1}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
      <div className={f.jobGrid}>
        {jobs.map((t) => {
          const { external, resource, orders, checks } = productionReadiness(
              state,
              t,
            ),
            missing = checks.filter((c) => !c.ready),
            progress = taskProgress(state.data, t),
            dispatches =
              state.data.dispatches?.filter(
                (x) => x.taskId === t.id && x.status !== "cancelled",
              ) ?? [],
            lastReport = [...state.data.reports]
              .reverse()
              .find((r) => r.entries.some((e) => e.taskId === t.id)),
            scope = [
              ...(state.data.scope?.lines ?? []),
              ...(state.data.variations ?? []).flatMap((v) => v.lines),
            ].filter((l) => t.scopeIds.includes(l.id));
          return (
            <article key={t.id} className={f.jobCard}>
              <header>
                <span className={f.route}>
                  <Factory size={13} />
                  {external
                    ? "Outside factory"
                    : resource
                      ? "Own workshop"
                      : "Production route needed"}
                </span>
                <span className={s.status} data-state={t.status}>
                  {label(t.status)}
                </span>
              </header>
              <button className={f.jobTitle} onClick={() => onOpen(t)}>
                {t.title}
                <ArrowRight size={16} />
              </button>
              <p className={f.caption}>
                {t.area || "General"} · {t.quantity} {t.unit} · Due {t.end}
              </p>
              <div className={f.jobTeam}>
                <Users size={16} />
                <div>
                  <strong>
                    {resource?.name ?? "Assign workshop or factory"}
                  </strong>
                  <small>
                    {state.members.find((m) => m.id === t.ownerId)?.name ??
                      "Owner needed"}
                  </small>
                </div>
              </div>
              <div className={f.output}>
                <span>
                  <strong>{t.approved}</strong> / {t.quantity} {t.unit} reviewed
                </span>
                <span>{Math.round(progress)}%</span>
                <progress max={100} value={progress} />
              </div>
              {!["completed", "cancelled"].includes(t.status) && (
                <details
                  className={f.readiness}
                  open={missing.length > 0 && t.status !== "in_progress"}
                >
                  <summary>
                    {missing.length ? (
                      <>
                        <TriangleAlert size={14} />
                        {missing.length} checks need attention
                      </>
                    ) : (
                      <>
                        <CircleCheck size={14} />
                        Ready to work
                      </>
                    )}
                  </summary>
                  <div>
                    {checks.map((c) => (
                      <div key={c.title} data-ready={c.ready}>
                        {c.ready ? (
                          <CircleCheck size={13} />
                        ) : (
                          <Circle size={13} />
                        )}{" "}
                        {c.href ? (
                          <Link href={c.href}>{c.title}</Link>
                        ) : (
                          <button onClick={() => onOpen(t)}>{c.title}</button>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className={f.connections}>
                {scope.length > 0 && (
                  <Link
                    href={`/workspace/pre-projects/cases/${state.caseId}/boq`}
                  >
                    Released scope · {scope.map((l) => l.title).join(", ")}
                  </Link>
                )}
                {orders.map((o) => (
                  <Link
                    key={o.id}
                    href={`/workspace/projects/${state.id}/procurement?record=${o.id}`}
                  >
                    {o.number} · {o.vendor} <span>{label(o.status)}</span>
                  </Link>
                ))}
                {dispatches.map((x) => (
                  <Link
                    key={x.id}
                    href={`/workspace/projects/${state.id}/production?view=dispatch&record=${x.id}`}
                  >
                    <Truck size={13} />
                    {x.quantity} {x.unit} → {state.data.tasks.find(
                      (task) => task.id === x.receivingTaskId,
                    )?.title ?? x.destination}
                    <span>{label(x.status)}</span>
                  </Link>
                ))}
                {lastReport && (
                  <Link
                    href={`/workspace/projects/${state.id}/daily-progress?record=${lastReport.id}`}
                  >
                    <ClipboardCheck size={13} />
                    Latest report · {lastReport.date}
                    <span>{label(lastReport.status)}</span>
                  </Link>
                )}
              </div>
              <footer>
                <button className={s.button} onClick={() => onOpen(t)}>
                  {t.status === "awaiting_inspection"
                    ? "Review inspection"
                    : "Job details"}
                </button>
                {external && !orders.length && state.canBuy ? (
                  <button className={s.primary} onClick={() => onOrder(t)}>
                    Request factory offer
                  </button>
                ) : t.status === "in_progress" && state.canReport ? (
                  <button className={s.primary} onClick={() => onReport(t)}>
                    Add progress report
                  </button>
                ) : t.status === "completed" && state.canManage ? (
                  <button className={s.primary} onClick={() => onDispatch(t)}>
                    Plan dispatch
                  </button>
                ) : (
                  state.canManage &&
                  ["planned", "blocked", "on_hold"].includes(t.status) && (
                    <button
                      className={s.primary}
                      disabled={busy || missing.length > 0}
                      title={missing.map((c) => c.title).join(", ")}
                      onClick={() => onStart(t)}
                    >
                      Start job
                    </button>
                  )
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {!jobs.length && (
        <div className={s.empty}>
          <Factory size={30} />
          <h2>No manufacturing jobs in this view</h2>
          <p>
            Add the items that need to be made, choose your workshop or an
            outside factory, and link the approved BOQ.
          </p>
        </div>
      )}
    </div>
  );
}
