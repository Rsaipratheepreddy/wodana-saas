"use client";

import { useCallback, useEffect, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, ErrorState, InlineNotice, InspectorSheet, MenuButton, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { ReleaseCheck, WorkOrderState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber } from "./factory-labels";
import { WorkOrderMaterials } from "./work-order-materials";
import styles from "./factory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type Dialog = "schedule" | "drawing" | "revise" | "quantity" | "report" | "check" | "hold" | "cancel" | "short_close" | { refuse: string } | null;

/**
 * One work order: what it makes and where, whether it can be released (each check with what's missing),
 * the output reported and who approved it, and the quality checks. The next step is the primary action.
 */
export function WorkOrderSheet({ api, orderId, onChanged, onClose }: { api: FactoryApi; orderId: string; onChanged: () => void; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<WorkOrderState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.order(orderId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The work order didn't load.")); }
  }, [api, orderId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
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
  const unit = (value: string) => `${quantityText(value) || "0"} ${order?.unit ?? ""}`.trim();
  const checkLabel: Record<ReleaseCheck["key"], string> = {
    running: t("Project running"), scope: t("Scope unchanged"), drawing: t("Drawing approved"), payment: t("Payment before production verified"), materials: t("Materials in"), schedule: t("Workcenter and dates"),
  };
  const open = order ? ["planned", "released", "in_production", "on_hold"].includes(order.status) : false;
  const blocked = Boolean(state?.releaseChecks.some((check) => !check.passed));
  const more = !order || !state?.canManage ? [] : [
    ...(open ? [{ id: "quantity", label: t("Change quantity") }] : []),
    ...(["released", "in_production", "on_hold"].includes(order.status) ? [{ id: "revise", label: t("Drawing changed") }] : []),
    ...(["planned", "released", "in_production"].includes(order.status) ? [{ id: "hold", label: t("Put on hold") }] : []),
    ...(open && !(Number(order.made) + Number(order.pending) + Number(order.scrapped)) ? [{ id: "cancel", label: t("Cancel work order") }] : []),
    ...(open && Number(order.made) + Number(order.pending) + Number(order.scrapped) > 0 ? [{ id: "short_close", label: t("Close short") }] : []),
  ];
  const primary = !order || !state ? null
    : order.status === "planned" && state.canManage ? <Button variant="primary" isLoading={busy} isDisabled={blocked} onPress={() => void run("release")}>{t("Release")}</Button>
    : order.status === "released" && state.canManage ? <Button variant="primary" isLoading={busy} onPress={() => void run("start")}>{t("Start")}</Button>
    : order.status === "on_hold" && (order.holdKind === "drawing" ? state.canApprove : state.canManage)
      ? <Button variant="primary" isLoading={busy} onPress={() => void run("resume")}>{order.holdKind === "drawing" ? t("Go on with the new drawing") : t("Resume")}</Button>
    : null;
  const producing = order?.status === "in_production";
  const canCheck = Boolean(state?.canApprove && state.settings.requireCheck && producing && Number(order?.toCheck) > 0);

  return <InspectorSheet isOpen size="lg" title={order ? `${orderNumber(order.number)} · ${order.title}` : t("Work order")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state && order && (primary || more.length || producing) ? <div className="wd-dialog-actions">
      {more.length ? <MenuButton size="compact" label={t("More")} onAction={(id) => setDialog(id as Dialog)} items={more} /> : null}
      <span className={styles.spacer} />
      {canCheck ? <Button onPress={() => setDialog("check")}>{t("Check quality")}</Button> : null}
      {producing && state.canReport && Number(order.left) > 0 ? <Button variant="primary" onPress={() => setDialog("report")}>{t("Report output")}</Button> : primary}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !order ? <Skeleton lines={8} /> : <div className={styles.sheet}>
      <div className={styles.headRow}><WorkOrderStatusLabel status={order.status} /><span className={styles.muted}>{`${order.projectReference} · ${order.projectName}`}</span></div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {order.status === "on_hold" ? <InlineNotice tone="info" message={t("On hold: {reason}", { reason: order.holdReason ?? "" })} /> : null}
      {open && order.lineStatus === "omitted" ? <InlineNotice tone="error" message={t("A variation removed its scope line: cancel it, or close it short.")} />
        : open && Number(order.scopeOver) > 0 ? <InlineNotice tone="error" message={t("A variation reduced its scope line: {quantity} more are on work orders than it needs.", { quantity: unit(order.scopeOver) })} /> : null}
      {order.status === "cancelled" || order.status === "short_closed" ? <InlineNotice tone="info" message={`${order.status === "cancelled" ? t("Cancelled") : t("Closed short")}: ${order.closeReason ?? ""}`} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Makes")}</dt><dd>{[unit(order.quantity), order.packageName, order.specification].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Ready")}</dt><dd>
          <span>{t("{ready} of {quantity}", { ready: quantityText(order.passed) || "0", quantity: unit(order.quantity) })}</span>
          {Number(order.scrapped) ? <span className={styles.muted}>{t("{quantity} scrapped", { quantity: unit(order.scrapped) })}</span> : null}
          {Number(order.left) && order.status !== "planned" ? <span className={styles.muted}>{t("{quantity} still to make", { quantity: unit(order.left) })}</span> : null}
        </dd></div>
        <div><dt>{t("Where and when")}</dt><dd>
          <span>{[order.workcenterName, [format.day(order.plannedStart), format.day(order.plannedEnd)].filter(Boolean).join(" – "),
            order.plannedHours ? t("{hours} h", { hours: Number(order.plannedHours) }) : "", order.batchName ? t("Batch {number}: {name}", { number: order.batchNumber ?? 0, name: order.batchName }) : ""]
            .filter(Boolean).join(" · ") || "—"}</span>
          {state.canManage && ["planned", "released", "on_hold"].includes(order.status) ? <Button size="compact" variant="quiet" onPress={() => setDialog("schedule")}>{t("Change")}</Button> : null}
        </dd></div>
        <div><dt>{t("Drawing")}</dt><dd>
          <span>{order.drawingApprovedAt ? t("{reference}, approved by {name} on {date}", { reference: order.drawingRef, name: order.drawingApprovedByName ?? "", date: format.when(order.drawingApprovedAt) })
            : t("Not approved yet")}</span>
          {state.canManage && ["planned", "on_hold"].includes(order.status) ? <Button size="compact" variant="quiet" onPress={() => setDialog("drawing")}>
            {order.drawingApprovedAt ? t("Change") : t("Record approval")}</Button> : null}
        </dd></div>
        {order.notes ? <div><dt>{t("Notes")}</dt><dd>{order.notes}</dd></div> : null}
      </dl>

      <WorkOrderMaterials state={state} run={run} busy={busy} />

      {state.releaseChecks.length ? <section className={styles.stack} aria-label={t("Before it's released")}>
        <h3 className={styles.subhead}>{t("Before it's released")}</h3>
        <ul className={styles.list}>{state.releaseChecks.map((check) => <li key={check.key} className={styles.check} data-passed={check.passed}>
          <span>{checkLabel[check.key]}</span>
          <small>{check.passed ? t("Done") : check.key === "materials" && check.detail?.length ? t("Not in: {items}", { items: check.detail.join(", ") }) : t("Missing")}</small>
        </li>)}</ul>
      </section> : null}

      {state.reports.length ? <section className={styles.stack} aria-label={t("Output")}>
        <h3 className={styles.subhead}>{t("Output")}</h3>
        <ul className={styles.list}>{state.reports.map((report) => <li key={report.id}>
          <span className={styles.nameCell}>
            <span>{[Number(report.good) ? t("{quantity} made", { quantity: unit(report.good) }) : "",
              Number(report.scrap) ? t("{quantity} scrapped: {reason}", { quantity: unit(report.scrap), reason: report.scrapReason }) : ""].filter(Boolean).join(" · ")}</span>
            <small>{[report.reportedByName, format.when(report.reportedAt), report.note,
              report.status === "approved" ? t("Approved by {name}", { name: report.decidedByName ?? "" }) : report.status === "refused" ? t("Refused by {name}: {note}", { name: report.decidedByName ?? "", note: report.decisionNote }) : ""]
              .filter(Boolean).join(" · ")}</small>
          </span>
          {report.status === "pending" ? state.canApprove && report.reportedBy !== state.me ? <span className={styles.filters}>
            <Button size="compact" variant="primary" isLoading={busy} onPress={() => void run("decide_report", { reportId: report.id, decision: "approve" })}>{t("Approve")}</Button>
            <Button size="compact" variant="quiet" onPress={() => setDialog({ refuse: report.id })}>{t("Refuse")}</Button>
          </span> : <small className={styles.muted}>{t("Waiting for approval")}</small> : null}
        </li>)}</ul>
      </section> : null}

      {state.checks.length ? <section className={styles.stack} aria-label={t("Quality checks")}>
        <h3 className={styles.subhead}>{t("Quality checks")}</h3>
        <ul className={styles.list}>{state.checks.map((check) => <li key={check.id}>
          <span className={styles.nameCell}>
            <span>{[Number(check.passed) ? t("{quantity} passed", { quantity: unit(check.passed) }) : "",
              Number(check.failed) ? t("{quantity} failed: {reason}", { quantity: unit(check.failed), reason: check.failReason }) : ""].filter(Boolean).join(" · ")}</span>
            <small>{[check.checkedByName, format.when(check.checkedAt)].join(" · ")}</small>
          </span>
        </li>)}</ul>
      </section> : null}
    </div>}

    {state && order && dialog === "schedule" ? <ScheduleDialog state={state} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("update", input)) setDialog(null); }} /> : null}
    {state && order && dialog === "drawing" ? <TextDialog title={t("Drawing approval")} label={t("Approved drawing (number or revision)")} action={t("Save")} initial={order.drawingRef}
      onClose={() => setDialog(null)} onSave={async (reference) => { if (await run("approve_drawing", { reference })) setDialog(null); }} /> : null}
    {state && order && dialog === "report" ? <ReportDialog unit={order.unit} left={order.left} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("report", { id: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {state && order && dialog === "check" ? <CheckDialog unit={order.unit} waiting={order.toCheck} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("check", { id: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {state && order && dialog === "revise" ? <ReviseDialog onClose={() => setDialog(null)}
      onSave={async (reference, note) => { if (await run("revise_drawing", { reference, note })) setDialog(null); }} /> : null}
    {state && order && dialog === "quantity" ? <QuantityDialog unit={order.unit} current={order.quantity}
      floor={String(Number(order.passed) + Number(order.toCheck) + Number(order.pending))} onClose={() => setDialog(null)}
      onSave={async (quantity) => { if (await run("set_quantity", { quantity })) setDialog(null); }} /> : null}
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

function TextDialog({ title, label, action, initial = "", onClose, onSave }: { title: string; label: string; action: string; initial?: string; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!value.trim()} onPress={async () => { setBusy(true); await onSave(value.trim()); setBusy(false); }}>{action}</Button></div>}>
    <TextAreaField label={label} isRequired value={value} onChange={setValue} />
  </ControlledModalDialog>;
}

function ScheduleDialog({ state, onClose, onSave }: { state: WorkOrderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [workcenterId, setWorkcenterId] = useState(state.order.workcenterId ?? "");
  const [start, setStart] = useState(state.order.plannedStart);
  const [end, setEnd] = useState(state.order.plannedEnd);
  const [notes, setNotes] = useState(state.order.notes);
  const [hours, setHours] = useState(state.order.plannedHours ? quantityText(state.order.plannedHours) : "");
  const [busy, setBusy] = useState(false);
  const valid = !start || !end || end >= start;
  return <ControlledModalDialog isOpen size="md" title={t("Where and when")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ workcenterId: workcenterId || null, plannedStart: start, plannedEnd: end, plannedHours: hours || null, notes: notes.trim() }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
        items={state.workcenters.map((center) => ({ id: center.id, label: center.name }))} />
      <div className={styles.pair}>
        <DateField label={t("Start")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
        <DateField label={t("Finish")} value={end ? parseDate(end) : null} onChange={(value) => setEnd(value ? value.toString() : null)}
          isInvalid={!valid} errorMessage={valid ? undefined : t("The finish can't be before the start.")} />
      </div>
      <TextInput label={t("Hours it takes")} inputMode="decimal" suffix={t("h")} value={hours} onChange={(value) => setHours(numeric(value))} />
      <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
    </div>
  </ControlledModalDialog>;
}

/** What was made and scrapped since the last report; never more good than is still to make. */
function ReportDialog({ unit, left, onClose, onSave }: { unit: string; left: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(good) > Number(left);
  const valid = Number(good || 0) + Number(scrap || 0) > 0 && !over && (!Number(scrap) || scrapReason.trim());
  return <ControlledModalDialog isOpen size="md" title={t("Report output")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ good: good || "0", scrap: scrap || "0", scrapReason: scrapReason.trim(), note: note.trim() }); setBusy(false);
      }}>{t("Report output")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <TextInput label={t("Made")} inputMode="decimal" suffix={unit || undefined} value={good} onChange={(value) => setGood(numeric(value))}
          isInvalid={over} errorMessage={over ? t("Only {quantity} is still to make.", { quantity: `${quantityText(left)} ${unit}`.trim() }) : undefined} />
        <TextInput label={t("Scrapped")} inputMode="decimal" suffix={unit || undefined} value={scrap} onChange={(value) => setScrap(numeric(value))} />
      </div>
      {Number(scrap) ? <TextInput label={t("Why it was scrapped")} isRequired value={scrapReason} onChange={setScrapReason} /> : null}
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

/** A quality check of approved output: what passed goes into stock; what failed says why and is made again. */
function CheckDialog({ unit, waiting, onClose, onSave }: { unit: string; waiting: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [passed, setPassed] = useState(quantityText(waiting));
  const [failed, setFailed] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(passed || 0) + Number(failed || 0) > Number(waiting);
  const valid = Number(passed || 0) + Number(failed || 0) > 0 && !over && (!Number(failed) || failReason.trim());
  return <ControlledModalDialog isOpen size="md" title={t("Check quality")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ passed: passed || "0", failed: failed || "0", failReason: failReason.trim() }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <p className={styles.muted}>{t("{quantity} waiting to be checked.", { quantity: `${quantityText(waiting)} ${unit}`.trim() })}</p>
      <div className={styles.pair}>
        <TextInput label={t("Passed")} inputMode="decimal" suffix={unit || undefined} value={passed} onChange={(value) => setPassed(numeric(value))} isInvalid={over}
          errorMessage={over ? t("Only {quantity} is waiting.", { quantity: `${quantityText(waiting)} ${unit}`.trim() }) : undefined} />
        <TextInput label={t("Failed")} inputMode="decimal" suffix={unit || undefined} value={failed} onChange={(value) => setFailed(numeric(value))} />
      </div>
      {Number(failed) ? <TextInput label={t("Why it failed")} isRequired value={failReason} onChange={setFailReason} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** A new drawing for work already released: it stops until someone else lets it go on. */
function ReviseDialog({ onClose, onSave }: { onClose: () => void; onSave: (reference: string, note: string) => Promise<void> }) {
  const t = useT();
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Drawing changed")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reference.trim() || !note.trim()} onPress={async () => { setBusy(true); await onSave(reference.trim(), note.trim()); setBusy(false); }}>
        {t("Put on hold")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("New drawing (number or revision)")} isRequired value={reference} onChange={setReference} />
      <TextAreaField label={t("What changed")} isRequired value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

/** How many the work order makes: never below what's made or waiting, never past its line. */
function QuantityDialog({ unit, current, floor, onClose, onSave }: { unit: string; current: string; floor: string; onClose: () => void; onSave: (quantity: string) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(current));
  const [busy, setBusy] = useState(false);
  const under = Number(quantity) < Number(floor);
  return <ControlledModalDialog isOpen size="md" title={t("Change quantity")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!(Number(quantity) > 0) || under} onPress={async () => { setBusy(true); await onSave(quantity); setBusy(false); }}>{t("Save")}</Button></div>}>
    <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
      isInvalid={under} errorMessage={under ? t("{quantity} is already made or waiting.", { quantity: `${quantityText(floor)} ${unit}`.trim() }) : undefined} />
  </ControlledModalDialog>;
}
