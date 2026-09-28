"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, Button, ErrorState, InlineNotice, InspectorSheet, MenuButton, Skeleton, StageTracker, Tabs, type WorkflowStage } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { ReleaseCheck, WorkOrderState } from "@/lib/factory/types";
import { Cell, NextStep, ProjectLinks, Section, operationsStyles as ops, projectHref } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber, useFactoryLabels } from "./factory-labels";
import { CheckDialog, DispatchDialog, DrawingDialog, QuantityDialog, ReportDialog, ScheduleDialog, SendOutDialog, TextDialog } from "./work-order-dialogs";
import { WorkOrderHistory } from "./work-order-history";
import { WorkOrderMaterials } from "./work-order-materials";
import styles from "./factory.module.css";

type Dialog = "schedule" | "drawing" | "revise" | "quantity" | "report" | "check" | "hold" | "cancel" | "short_close" | "send_out" | "dispatch" | { refuse: string } | null;
/** An action a list asks the opened work order to start with (its row's Next button). */
export type WorkOrderIntent = "report" | "check" | "dispatch" | "drawing" | null;
type Tab = "work" | "output" | "site" | "history";

/**
 * One work order: its state and stage, the one next step, then what it makes (with what's missing before
 * it's released and where to fix it), its output and checks, its trips to site, and its history.
 */
export function WorkOrderSheet({ api, orderId, intent = null, onChanged, onClose }: {
  api: FactoryApi; orderId: string; intent?: WorkOrderIntent; onChanged: () => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useFactoryLabels();
  const [state, setState] = useState<WorkOrderState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<Tab>(intent === "report" || intent === "check" ? "output" : intent === "dispatch" ? "site" : "work");
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);
  const load = useCallback(async () => {
    try { setState(await api.order(orderId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The work order didn't load.")); }
  }, [api, orderId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // A row's Next button opens the work order straight into its dialog, once it has loaded.
  useEffect(() => {
    if (!state || opened.current || !intent) return;
    opened.current = true;
    queueMicrotask(() => setDialog(intent));
  }, [state, intent]);
  /** Runs one change; a clash with someone else's change reloads the work order and says so. */
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    if (!state) return false;
    setBusy(true); setNotice("");
    try { setState(await api.command(orderId, action, { version: state.order.version, ...input })); onChanged(); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    } finally { setBusy(false); }
  };
  const order = state?.order;
  const unit = (value: string | null | undefined) => `${quantityText(value ?? "0") || "0"} ${order?.unit ?? ""}`.trim();
  const open = order ? ["planned", "released", "in_production", "on_hold"].includes(order.status) : false;
  const failing = state?.releaseChecks.filter((check) => !check.passed) ?? [];
  const pendingReports = state?.reports.filter((report) => report.status === "pending") ?? [];
  const canSend = Boolean(state && (state.canManage || state.canIssue) && Number(state.atFactory) > 0);
  const producing = order?.status === "in_production";
  const canCheck = Boolean(state?.canApprove && state.settings.requireCheck && order && ["in_production", "ready"].includes(order.status) && Number(order.toCheck) > 0);
  const canReport = Boolean(producing && state?.canReport && Number(order?.left) > 0);
  const drawingDecider = Boolean(state?.canApprove);

  // Where the work order is: planned, released, in production, checked, at site.
  const stages = (): WorkflowStage[] => {
    if (!order || !state) return [];
    const steps = [t("Planned"), t("Released"), t("In production"), state.settings.requireCheck ? t("Checked") : t("Approved"), t("At site")];
    const sent = state.dispatches.some((trip) => trip.status !== "cancelled");
    const started = Boolean(order.releasedAt) && Number(order.made) + Number(order.pending) + Number(order.scrapped) > 0;
    const at = order.status === "planned" ? 0 : order.status === "released" ? 1 : order.status === "in_production" ? 2
      : order.status === "ready" ? (sent && Number(state.atFactory) === 0 ? 5 : 3)
      : order.status === "on_hold" ? (!order.releasedAt ? 0 : started ? 2 : 1) : 5;
    return steps.map((label, index) => ({ id: String(index), label,
      state: index < at ? "complete" : index === at ? (order.status === "on_hold" ? "blocked" : "current") : "upcoming" }));
  };

  /** Where to fix a release check that fails: the project's orders, the drawing, its schedule, the project. */
  const fix = (check: ReleaseCheck): ReactNode => {
    if (!order || !state) return null;
    switch (check.key) {
      case "materials": return <Link className={ops.projectLink} href={`/workspace/purchasing?project=${order.projectId}`}>{t("Order materials")}</Link>;
      case "drawing": return state.canManage ? <Button size="compact" variant="quiet" onPress={() => setDialog("drawing")}>{t("Record approval")}</Button> : null;
      case "schedule": return state.canManage ? <Button size="compact" variant="quiet" onPress={() => setDialog("schedule")}>{t("Set where and when")}</Button> : null;
      case "payment": return <Link className={ops.projectLink} href={projectHref(order.projectId, "money")}>{t("Open the project's money")}</Link>;
      case "scope": return <Link className={ops.projectLink} href={projectHref(order.projectId, "scope")}>{t("Open the scope")}</Link>;
      case "running": return <Link className={ops.projectLink} href={projectHref(order.projectId)}>{t("Open the project")}</Link>;
      default: return null;
    }
  };

  // The one next step, in words: what happens next and whose it is.
  const nextStep = (): { title: string; detail?: string | null; tone?: "danger" | "warning"; actions?: ReactNode } | null => {
    if (!order || !state) return null;
    const until = format.until(order.plannedEnd);
    switch (state.next) {
      case "fix": return { title: t("Can't be released yet"), detail: failing.map((check) => labels.blocked[check.key]).join(" · "), tone: "warning" };
      case "release": return { title: t("Ready to release"), detail: order.plannedStart ? t("Starts {date}", { date: format.day(order.plannedStart) }) : null };
      case "start": return { title: t("Released: start it when the work begins"), detail: order.workcenterName };
      case "approve": return { title: t("{quantity} made waits for approval", { quantity: unit(pendingReports.reduce((sum, report) => sum + Number(report.good), 0).toString()) }),
        detail: state.canApprove ? null : t("Waiting for someone who approves factory work."), tone: "warning" };
      case "check": return { title: t("{quantity} to check", { quantity: unit(order.toCheck) }), detail: state.canApprove ? null : t("Waiting for someone who approves factory work."), tone: "warning" };
      case "report": return { title: t("{quantity} still to make", { quantity: unit(order.left) }),
        detail: order.plannedEnd ? t("Due {date} · {until}", { date: format.day(order.plannedEnd), until: until?.text ?? "" }) : null, tone: until?.late ? "danger" : undefined };
      case "send": return { title: t("{quantity} ready at the factory: send it to site", { quantity: unit(state.atFactory) }) };
      case "resume": return { title: t("On hold: {reason}", { reason: order.holdReason ?? "" }), tone: "warning" };
      case "decide_drawing": return { title: order.drawingNewer ? t("A newer drawing (R{number}) is in", { number: order.drawingNewer }) : t("The drawing changed: decide whether it goes on"),
        detail: order.drawingNewer ? t("Record the new drawing, then someone who approves factory work lets it go on.") : drawingDecider ? order.holdReason : t("Waiting for someone who approves factory work."),
        tone: "warning" };
      default:
        if (order.status === "ready") return { title: t("Made and at site") };
        return null;
    }
  };

  const more = !order || !state?.canManage ? [] : [
    ...(open ? [{ id: "quantity", label: t("Change quantity") }] : []),
    ...(["released", "in_production", "on_hold"].includes(order.status) ? [{ id: "revise", label: t("Drawing changed") }] : []),
    ...(["released", "in_production"].includes(order.status) ? [{ id: "send_out", label: t("Send a step out") }] : []),
    ...(["planned", "released", "in_production"].includes(order.status) ? [{ id: "hold", label: t("Put on hold") }] : []),
    ...(open && !(Number(order.made) + Number(order.pending) + Number(order.scrapped)) ? [{ id: "cancel", label: t("Cancel work order") }] : []),
    ...(open && Number(order.made) + Number(order.pending) + Number(order.scrapped) > 0 ? [{ id: "short_close", label: t("Close short") }] : []),
  ];
  // Reports someone else made, which this viewer can approve.
  const approvable = pendingReports.filter((report) => state?.canApprove && report.reportedBy !== state.me);
  // The one primary action: the next step when it's the viewer's to do (fixing a release check happens where it's missing).
  type Act = "release" | "start" | "resume" | "use_drawing" | "decide_drawing" | "approve" | "check" | "report" | "send" | null;
  const act: Act = !order || !state ? null
    : state.next === "release" && state.canManage ? "release"
    : state.next === "start" && state.canManage ? "start"
    : state.next === "resume" && state.canManage ? "resume"
    : state.next === "decide_drawing" && order.drawingNewer && state.canManage ? "use_drawing"
    : state.next === "decide_drawing" && !order.drawingNewer && drawingDecider ? "decide_drawing"
    : state.next === "approve" && approvable.length ? "approve"
    : canCheck ? "check" : canReport ? "report" : canSend ? "send" : null;
  const primary = act === "release" ? <Button variant="primary" isLoading={busy} onPress={() => void run("release")}>{t("Release")}</Button>
    : act === "start" ? <Button variant="primary" isLoading={busy} onPress={() => void run("start")}>{t("Start")}</Button>
    : act === "resume" ? <Button variant="primary" isLoading={busy} onPress={() => void run("resume")}>{t("Resume")}</Button>
    : act === "use_drawing" ? <Button variant="primary" onPress={() => setDialog("revise")}>{t("Use the new drawing")}</Button>
    : act === "decide_drawing" ? <Button variant="primary" isLoading={busy} onPress={() => void run("resume")}>{t("Go on with the new drawing")}</Button>
    // One report waiting: approve it here; more: open them to decide each.
    : act === "approve" ? <Button variant="primary" isLoading={busy} onPress={() => { if (approvable.length === 1) void run("decide_report", { reportId: approvable[0].id, decision: "approve" }); else setTab("output"); }}>
      {t("Approve output")}</Button>
    : act === "check" ? <Button variant="primary" onPress={() => setDialog("check")}>{t("Check quality")}</Button>
    : act === "report" ? <Button variant="primary" onPress={() => setDialog("report")}>{t("Report output")}</Button>
    : act === "send" ? <Button variant="primary" onPress={() => setDialog("dispatch")}>{t("Send to site")}</Button>
    : null;
  // Reporting and checking go on side by side while it's made.
  const secondary = <>
    {canReport && act !== "report" ? <Button onPress={() => setDialog("report")}>{t("Report output")}</Button> : null}
    {canCheck && act !== "check" ? <Button onPress={() => setDialog("check")}>{t("Check quality")}</Button> : null}
  </>;
  const step = nextStep();
  const reworks = state?.reworks ?? [];
  const outputCount = pendingReports.length + (canCheck ? 1 : 0);

  const workPanel = !state || !order ? null : <div className={styles.sheet}>
    {failing.length ? <Section title={t("Before it's released")}>
      <ul className={ops.list}>{state.releaseChecks.map((check) => <li key={check.key}>
        <Cell title={labels.check[check.key]} tone={check.passed ? "success" : "danger"}
          meta={check.passed ? t("Done") : check.key === "materials" && check.detail?.length ? t("Not in: {items}", { items: check.detail.join(", ") }) : check.missing} />
        {check.passed ? null : fix(check)}
      </li>)}</ul>
    </Section> : null}
    <dl className={styles.facts}>
      <div><dt>{t("Makes")}</dt><dd>{[unit(order.quantity), order.packageName, order.specification].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>{t("Where and when")}</dt><dd>
        <span>{[order.workcenterName, [format.day(order.plannedStart), format.day(order.plannedEnd)].filter(Boolean).join(" – "),
          order.plannedHours ? t("{hours} h", { hours: Number(order.plannedHours) }) : "", order.batchName ? t("Batch {number}: {name}", { number: order.batchNumber ?? 0, name: order.batchName }) : ""]
          .filter(Boolean).join(" · ") || "—"}</span>
        {state.canManage && ["planned", "released", "on_hold"].includes(order.status) ? <Button size="compact" variant="quiet" onPress={() => setDialog("schedule")}>{t("Change")}</Button> : null}
      </dd></div>
      <div><dt>{t("Drawing")}</dt><dd>
        <span>{order.drawingApprovedAt ? t("{reference}, approved by {name} on {date}", { reference: order.drawingRef, name: order.drawingApprovedByName ?? "", date: format.when(order.drawingApprovedAt) })
          : t("Not approved yet")}</span>
        {order.drawingNewer ? <Badge tone="warning">{t("R{number} is newer", { number: order.drawingNewer })}</Badge> : null}
        {state.canManage && ["planned", "on_hold"].includes(order.status) && !failing.some((check) => check.key === "drawing") ? <Button size="compact" variant="quiet" onPress={() => setDialog(order.status === "on_hold" && order.drawingApprovedAt ? "revise" : "drawing")}>
          {order.drawingApprovedAt ? t("Change") : t("Record approval")}</Button> : null}
      </dd></div>
      {order.notes ? <div><dt>{t("Notes")}</dt><dd>{order.notes}</dd></div> : null}
    </dl>
    <WorkOrderMaterials state={state} run={run} busy={busy} />
    {state.operations.length ? <Section title={t("Done outside")}>
      <ul className={ops.list}>{state.operations.map((operation) => <li key={operation.id}>
        <Cell title={t("{step} at {supplier}", { step: operation.name, supplier: operation.supplierName })}
          meta={<Link className={ops.projectLink} href={`/workspace/purchasing/orders?order=${operation.orderId}`}>{operation.orderNumber}</Link>} />
        <Badge tone={operation.out ? "info" : "success"}>{operation.out ? t("{back} of {quantity} back", { back: quantityText(operation.back) || "0", quantity: unit(operation.quantity) }) : t("Back")}</Badge>
      </li>)}</ul>
    </Section> : null}
  </div>;

  const outputPanel = !state || !order ? null : <div className={styles.sheet}>
    <dl className={styles.facts}>
      <div><dt>{t("Ready")}</dt><dd>
        <span>{t("{ready} of {quantity}", { ready: quantityText(order.passed) || "0", quantity: unit(order.quantity) })}</span>
        {Number(order.toCheck) ? <Badge tone="warning">{t("{quantity} to check", { quantity: unit(order.toCheck) })}</Badge> : null}
        {Number(order.scrapped) ? <span className={styles.muted}>{t("{quantity} scrapped", { quantity: unit(order.scrapped) })}</span> : null}
        {Number(order.left) && order.status !== "planned" ? <span className={styles.muted}>{t("{quantity} still to make", { quantity: unit(order.left) })}</span> : null}
      </dd></div>
    </dl>
    <Section title={t("Reports")}>
      {state.reports.length ? <ul className={ops.list}>{state.reports.map((report) => <li key={report.id}>
        <Cell title={[Number(report.good) ? t("{quantity} made", { quantity: unit(report.good) }) : "",
            Number(report.scrap) ? t("{quantity} scrapped: {reason}", { quantity: unit(report.scrap), reason: report.scrapReason }) : "",
            report.hours ? t("{hours} hours", { hours: quantityText(report.hours) }) : ""].filter(Boolean).join(" · ")}
          meta={[report.reportedByName, format.when(report.reportedAt), report.note,
            report.status === "approved" ? t("Approved by {name}", { name: report.decidedByName ?? "" }) : report.status === "refused" ? t("Refused by {name}: {note}", { name: report.decidedByName ?? "", note: report.decisionNote }) : ""]
            .filter(Boolean).join(" · ")} tone={report.status === "refused" ? "danger" : undefined} />
        {report.status === "pending" ? state.canApprove && report.reportedBy !== state.me ? <span className={styles.filters}>
          <Button size="compact" variant="primary" isLoading={busy} onPress={() => void run("decide_report", { reportId: report.id, decision: "approve" })}>{t("Approve")}</Button>
          <Button size="compact" variant="quiet" onPress={() => setDialog({ refuse: report.id })}>{t("Refuse")}</Button>
        </span> : <Badge tone="warning">{t("Waiting for approval")}</Badge> : null}
      </li>)}</ul> : <p className={ops.empty}>{t("Nothing reported yet.")}</p>}
    </Section>
    {state.checks.length ? <Section title={t("Quality checks")}>
      <ul className={ops.list}>{state.checks.map((check) => <li key={check.id}>
        <Cell title={[Number(check.passed) ? t("{quantity} passed", { quantity: unit(check.passed) }) : "",
          Number(check.failed) ? t("{quantity} failed: {reason}", { quantity: unit(check.failed), reason: check.failReason }) : ""].filter(Boolean).join(" · ")}
          meta={[check.checkedByName, format.when(check.checkedAt)].join(" · ")} tone={Number(check.failed) ? "danger" : undefined} />
      </li>)}</ul>
    </Section> : null}
    {reworks.length ? <Section title={t("Made again")}>
      <ul className={ops.list}>{reworks.map((rework) => <li key={rework.id}>
        <Cell title={t("{quantity} sent back from site", { quantity: unit(rework.quantity) })} meta={[rework.reason, rework.byName, format.when(rework.at)].filter(Boolean).join(" · ")} tone="danger" />
      </li>)}</ul>
    </Section> : null}
  </div>;

  const sitePanel = !state || !order ? null : <div className={styles.sheet}>
    <Section title={t("At the factory")} action={canSend ? <Button size="compact" onPress={() => setDialog("dispatch")}>{t("Send to site")}</Button> : null}>
      <p className={ops.empty}>{Number(state.atFactory) > 0 ? t("{quantity} ready to go", { quantity: unit(state.atFactory) }) : t("Nothing waiting at the factory.")}</p>
    </Section>
    <Section title={t("Trips to site")}>
      {state.dispatches.length ? <ul className={ops.list}>{state.dispatches.map((trip) => <li key={trip.id}>
        <Cell title={<Link className={ops.projectLink} href={`/workspace/inventory/moves?move=${trip.id}`}>{t("Move {number}", { number: trip.number })}</Link>}
          meta={[unit(trip.quantity), format.day(trip.sentOn), Number(trip.rejected) ? t("{quantity} refused: {reason}", { quantity: unit(trip.rejected), reason: trip.rejectReason ?? "" }) : ""]
            .filter(Boolean).join(" · ")} tone={Number(trip.rejected) ? "danger" : undefined}>
          {trip.returnId ? <small><Link className={ops.projectLink} href={`/workspace/inventory/moves?move=${trip.returnId}`}>
            {trip.returnStatus === "received" ? t("Back at the factory on move {number}", { number: trip.returnNumber ?? 0 }) : t("Coming back on move {number}", { number: trip.returnNumber ?? 0 })}</Link></small> : null}
        </Cell>
        <Badge tone={trip.status === "in_transit" ? "info" : trip.status === "cancelled" ? "neutral" : Number(trip.rejected) || trip.short ? "warning" : "success"}>
          {trip.status === "in_transit" ? t("On its way") : trip.status === "cancelled" ? t("Cancelled") : Number(trip.rejected) ? t("Partly refused")
            : trip.short ? t("Arrived short: {quantity}", { quantity: unit(trip.received ?? "0") }) : t("Arrived")}</Badge>
      </li>)}</ul> : <p className={ops.empty}>{t("Nothing sent to site yet.")}</p>}
    </Section>
  </div>;

  return <InspectorSheet isOpen size="lg" title={order ? `${orderNumber(order.number)} · ${order.title}` : t("Work order")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state && order && (primary || more.length || canReport || canCheck) ? <div className="wd-dialog-actions">
      {more.length ? <MenuButton size="compact" label={t("More")} onAction={(id) => setDialog(id as Dialog)} items={more} /> : null}
      <span className={styles.spacer} />
      {secondary}
      {primary}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !order ? <Skeleton lines={8} shape="facts" /> : <div className={styles.sheet}>
      <div className={ops.recordHead}>
        <div className={ops.recordFacts}>
          <WorkOrderStatusLabel status={order.status} />
          <ProjectLinks projects={[{ id: order.projectId, reference: order.projectReference, name: order.projectName }]} />
          <span>{[order.projectName, order.packageName].filter(Boolean).join(" · ")}</span>
        </div>
        {!["cancelled", "short_closed"].includes(order.status) ? <StageTracker ariaLabel={t("Where the work order is")} stages={stages()} /> : null}
        {step ? <NextStep title={step.title} detail={step.detail} tone={step.tone} actions={step.actions} /> : null}
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {state.projectStatus === "on_hold" && open ? <InlineNotice tone="info" message={t("{project} is on hold.", { project: order.projectReference })} /> : null}
      {open && order.lineStatus === "omitted" ? <InlineNotice tone="error" message={t("A variation removed its scope line: cancel it, or close it short.")} />
        : open && Number(order.scopeOver) > 0 ? <InlineNotice tone="error" message={t("A variation reduced its scope line: {quantity} more are on work orders than it needs.", { quantity: unit(order.scopeOver) })} /> : null}
      {order.status === "cancelled" || order.status === "short_closed" ? <InlineNotice tone="info" message={`${order.status === "cancelled" ? t("Cancelled") : t("Closed short")}: ${order.closeReason ?? ""}`} /> : null}
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)} items={[
        { id: "work", label: t("Work"), count: failing.length || undefined, panel: workPanel },
        { id: "output", label: t("Output"), count: outputCount || undefined, panel: outputPanel },
        { id: "site", label: t("To site"), count: state.dispatches.length || undefined, panel: sitePanel },
        { id: "history", label: t("History"), panel: <WorkOrderHistory state={state} /> },
      ]} />
    </div>}

    {state && order && dialog === "schedule" ? <ScheduleDialog state={state} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("update", input)) setDialog(null); }} /> : null}
    {state && order && dialog === "drawing" ? <DrawingDialog state={state} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("approve_drawing", input)) setDialog(null); }} /> : null}
    {state && order && dialog === "revise" ? <DrawingDialog state={state} revise onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("revise_drawing", input)) setDialog(null); }} /> : null}
    {state && order && dialog === "report" ? <ReportDialog unit={order.unit} left={order.left} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("report", { id: crypto.randomUUID(), ...input })) { setDialog(null); setTab("output"); } }} /> : null}
    {state && order && dialog === "check" ? <CheckDialog unit={order.unit} waiting={order.toCheck} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("check", { id: crypto.randomUUID(), ...input })) { setDialog(null); setTab("output"); } }} /> : null}
    {state && order && dialog === "quantity" ? <QuantityDialog unit={order.unit} current={order.quantity}
      floor={String(Number(order.passed) + Number(order.toCheck) + Number(order.pending))} onClose={() => setDialog(null)}
      onSave={async (quantity) => { if (await run("set_quantity", { quantity })) setDialog(null); }} /> : null}
    {state && order && dialog === "send_out" ? <SendOutDialog state={state} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("send_out", { operationId: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {state && order && dialog === "dispatch" ? <DispatchDialog unit={order.unit} available={state.atFactory} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("dispatch", { id: crypto.randomUUID(), ...input })) { setDialog(null); setTab("site"); } }} /> : null}
    {dialog === "hold" ? <TextDialog title={t("Put on hold")} label={t("Why")} action={t("Put on hold")} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run("hold", { reason })) setDialog(null); }} /> : null}
    {dialog === "cancel" ? <TextDialog title={t("Cancel work order")} label={t("Why it's cancelled")} action={t("Cancel work order")} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run("cancel", { reason })) setDialog(null); }} /> : null}
    {dialog === "short_close" ? <TextDialog title={t("Close short")} label={t("Why the rest won't be made")} action={t("Close short")} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run("short_close", { reason })) setDialog(null); }} /> : null}
    {dialog && typeof dialog === "object" ? <TextDialog title={t("Refuse the report")} label={t("Why it's refused")} action={t("Refuse")} onClose={() => setDialog(null)}
      onSave={async (note) => { if (await run("decide_report", { reportId: dialog.refuse, decision: "refuse", note })) setDialog(null); }} /> : null}
  </InspectorSheet>;
}
