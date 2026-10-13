"use client";

import { RecordHistory } from "../history/record-history";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Copy, FileText } from "lucide-react";
import {
  Badge, Button, EmptyState, ErrorState, FormDialog, IconButton, IconMenuButton, InlineNotice, NumericInput, PageHeader, PageSkeleton, RecordTable, Tabs, TextAreaField, TextInput,
  type DataGridColumn,
} from "@/design-system";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import { useT } from "@/lib/i18n/i18n-provider";
import {
  CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, LINE_OP_LABEL, NEXT_STEP_LABEL, REASON_LABEL, projectChangesApi, signedMoney,
  type ChangeRecord as Record_, type PricedLine, type ProjectChangesApi, type RaisedLine, type SchedulePreview,
} from "@/lib/change-requests/project";
import { useProjectFormat } from "../project-core/format";
import { RaiseChangeDialog } from "./raise-change-dialog";
import styles from "./project-changes.module.css";

type Tab = "scope" | "price" | "timeline" | "approvals" | "history";
const TABS: Tab[] = ["scope", "price", "timeline", "approvals", "history"];
type Dialog = "edit" | "withdraw" | "return" | null;

/**
 * One change on a project: its name is the title, its status one chip, and one primary action that is always its next
 * step for this person (Price it, Send to QS, Send for approval, Approve, Send to client, Apply). Tabs: Scope (what and
 * why, photos), Price (the variation as priced), Timeline impact (days per stage, the stages that move and the new
 * handover), Approvals (inside the firm and the client), Activity.
 */
export function ChangeRecord({ workspaceId, projectId, changeId, initial }: { workspaceId: string; projectId: string; changeId: string; initial?: Record_ }) {
  const t = useT();
  const router = useRouter();
  const requested = useSearchParams().get("tab") as Tab | null;
  const api = useMemo(() => projectChangesApi(workspaceId, projectId), [workspaceId, projectId]);
  const [record, setRecord] = useState<Record_ | null>(initial ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : "scope");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [link, setLink] = useState<string | null>(null);
  useWorkspaceBreadcrumb(record ? record.project.name : undefined);

  const load = useCallback(async () => {
    try { setRecord(await api.get(changeId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The change didn't load.")); }
  }, [api, changeId, t]);
  useEffect(() => { if (!initial) queueMicrotask(() => void load()); }, [initial, load]);

  /** One step; a clash with someone else's change reloads and says so. */
  const run = useCallback(async (work: () => Promise<Record_>, done: string) => {
    setBusy(true); setNotice(null);
    try {
      const next = await work();
      setRecord(next);
      if (next.link) setLink(next.link);
      setNotice({ tone: "success", message: next.emailed ? t("{done} The signing link went to {email}.", { done, email: next.emailed }) : done });
      return true;
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("Could not save.") });
      return false;
    } finally { setBusy(false); }
  }, [load, t]);

  if (error && !record) return <div className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!record) return <div className={styles.page}><PageSkeleton variant="detail" tabs={5} /></div>;
  const { change } = record;
  const version = change.version;
  const priceHref = `/workspace/projects/${projectId}/changes/${change.id}/price`;
  const next = record.next;
  // QA-007: the QS prices the change that is with them in the builder (and confirms it there).
  const primary = !next ? (record.qsPricing ? <Link className="wd-button" data-variant="primary" data-size="compact" href={priceHref}>{t("Price it")}</Link> : null) : next === "send_to_qs"
    ? <Link className="wd-button" data-variant="primary" data-size="compact" href={priceHref}>{t(NEXT_STEP_LABEL[next])}</Link>
    : <Button size="compact" variant="primary" isLoading={busy} onPress={() => void (next === "price" ? run(() => api.step(change.id, "price", { version }), t("Priced. Finish the price in the builder."))
      : next === "submit" ? run(() => api.step(change.id, "submit", { version }), t("Sent for approval."))
      : next === "approve" ? run(() => api.step(change.id, "decide", { decision: "approve", approvalVersion: record.approval?.version, commandId: crypto.randomUUID() }), t("Approved."))
      : next === "send" ? run(() => api.step(change.id, "send", { version, commandId: crypto.randomUUID() }), t("Sent to the client."))
      : run(() => api.step(change.id, "apply", { version }), t("Applied to the project.")))}>{t(NEXT_STEP_LABEL[next])}</Button>;
  const menu = [
    ...(record.actions.includes("edit") ? [{ id: "edit", label: t("Edit") }] : []),
    ...(record.price && change.status === "pricing" ? [{ id: "price", label: t("Open the price") }] : []),
    ...(record.actions.includes("return") ? [{ id: "return", label: t("Return") }] : []),
    ...(record.actions.includes("send_link") ? [{ id: "send_link", label: t("Send a new link") }] : []),
    ...(record.actions.includes("withdraw") ? [{ id: "withdraw", label: t("Withdraw") }] : []),
  ];
  const onMenu = (id: string) => {
    if (id === "price") router.push(priceHref);
    else if (id === "send_link") void run(() => api.step(change.id, "send-link", { commandId: crypto.randomUUID() }), t("A new signing link was sent."));
    else setDialog(id as Dialog);
  };

  return <div className={styles.page}>
    <PageHeader title={`${change.reference} · ${change.title}`}
      eyebrow={record.canOpenProject === false ? <span className={styles.back}>{record.project.reference}</span>
        : <Link className={styles.back} href={`/workspace/projects/${projectId}/scope?view=changes`}>{record.project.reference}</Link>}
      actions={<div className={styles.actions}>
        <Badge tone={CHANGE_STATUS_TONE[change.status]}>{t(CHANGE_STATUS_LABEL[change.status])}</Badge>
        {primary}
        {menu.length ? <IconMenuButton ariaLabel={t("Change actions")} items={menu} onAction={onMenu} /> : null}
      </div>} />
    {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}
    {change.status === "approved" && change.applyProblem ? <InlineNotice tone="error" title={t("Not applied yet")} message={change.applyProblem} /> : null}
    {link ? <div className={styles.row}><TextInput label={t("Signing link")} value={link} isReadOnly /><IconButton aria-label={t("Copy")} onPress={() => void navigator.clipboard?.writeText(link)}><Copy size={14} /></IconButton></div> : null}
    <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)} items={[
      { id: "scope", label: t("Scope"), panel: <ScopeTab api={api} record={record} onChanged={setRecord} /> },
      { id: "price", label: t("Price"), panel: <PriceTab record={record} priceHref={priceHref} /> },
      { id: "timeline", label: t("Timeline impact"), panel: <TimelineTab api={api} record={record} onSaved={(next) => { setRecord(next); setNotice({ tone: "success", message: t("Days saved.") }); }} /> },
      { id: "approvals", label: t("Approvals"), panel: <ApprovalsTab record={record} /> },
      { id: "history", label: t("History"), panel: <RecordHistory workspaceId={workspaceId} recordType="change_request" recordId={changeId} /> },
    ]} />
    {dialog === "edit" ? <RaiseChangeDialog api={api} change={change} onClose={() => setDialog(null)} onSaved={(next) => { setRecord(next); setDialog(null); setNotice({ tone: "success", message: t("Change saved.") }); }} /> : null}
    {dialog === "withdraw" || dialog === "return" ? <NoteDialog title={dialog === "withdraw" ? t("Withdraw {reference}", { reference: change.reference }) : t("Return {reference}", { reference: change.reference })}
      label={t("Why")} submitLabel={dialog === "withdraw" ? t("Withdraw") : t("Return")} onClose={() => setDialog(null)}
      onSubmit={async (note) => {
        const ok = await run(() => dialog === "withdraw" ? api.step(change.id, "withdraw", { version, reason: note })
          : api.step(change.id, "decide", { decision: "return", note, approvalVersion: record.approval?.version, commandId: crypto.randomUUID() }),
        dialog === "withdraw" ? t("Change withdrawn.") : t("Returned for changes."));
        if (ok) setDialog(null);
      }} /> : null}
  </div>;
}

function NoteDialog({ title, label, submitLabel, onClose, onSubmit }: { title: string; label: string; submitLabel: string; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(note)} submitLabel={submitLabel} isSubmitDisabled={!note.trim()} onSubmit={() => onSubmit(note.trim())}>
    <TextAreaField isRequired autoFocus label={label} maxLength={2000} value={note} onChange={setNote} />
  </FormDialog>;
}

/** What and why: the reason, who raised it, its words, the lines as raised, and its photos and files. */
function ScopeTab({ api, record, onChanged }: { api: ProjectChangesApi; record: Record_; onChanged: (record: Record_) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const input = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState("");
  const { change } = record;
  const columns: DataGridColumn<RaisedLine>[] = [
    { id: "what", header: t("What"), accessorFn: (row) => row.title, meta: { primary: true }, cell: ({ row: { original } }: { row: { original: RaisedLine } }) =>
      <span className={styles.cell}><span>{t(LINE_OP_LABEL[original.action])}: {original.title}</span>
        <small>{original.source === "catalog" ? t("Catalogue") : original.source === "boq_line" ? t("In the scope") : t("New work")}</small></span> },
    { id: "room", header: t("Room"), accessorFn: (row) => row.roomName ?? "", cell: ({ row: { original } }: { row: { original: RaisedLine } }) => <span>{original.roomName ?? t("General")}</span> },
    { id: "quantity", header: t("Qty"), accessorFn: (row) => row.quantity ?? "", meta: { align: "end" }, cell: ({ row: { original } }: { row: { original: RaisedLine } }) =>
      <span className={styles.number}>{original.quantity ? `${Number(original.quantity).toLocaleString()} ${original.unit}`.trim() : "—"}</span> },
  ];
  const upload = async (files: FileList | null) => {
    setFailure("");
    for (const file of Array.from(files ?? []).slice(0, 10)) {
      try { onChanged(await api.upload(change.id, crypto.randomUUID(), file)); } catch (cause) { setFailure(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
    }
    if (input.current) input.current.value = "";
  };
  return <div className={styles.tab}>
    <dl className={styles.facts}>
      <dt>{t("Reason")}</dt><dd>{t(REASON_LABEL[change.reason])}</dd>
      <dt>{t("Raised by")}</dt><dd>{[change.raisedByName, format.when(change.createdAt)].filter(Boolean).join(" · ")}</dd>
      {change.description ? <><dt>{t("What changes")}</dt><dd>{change.description}</dd></> : null}
    </dl>
    {change.lines.length ? <RecordTable ariaLabel={t("Lines")} data={change.lines} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText />
      : <p className={styles.muted}>{change.status === "draft" ? t("No lines yet. Add them when you edit it, or when it's priced.") : t("The price holds what changes.")}</p>}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {record.files.length ? <ul className={styles.files} aria-label={t("Photos and files")}>{record.files.map((file) => <li key={file.id}>
      <a href={api.fileUrl(file.id)} target="_blank" rel="noreferrer">
        <span className={styles.thumb}>{file.hasPreview ? <img src={api.fileUrl(file.id, true)} alt="" /> : <FileText aria-hidden="true" size={20} />}</span>
        <span>{file.name}</span>
      </a></li>)}</ul> : null}
    {record.actions.includes("upload") ? <div>
      <input ref={input} className={styles.hiddenInput} type="file" accept="image/*,application/pdf" multiple aria-label={t("Add photos")} onChange={(event) => void upload(event.target.files)} />
      <Button size="compact" onPress={() => input.current?.click()}><Camera aria-hidden="true" size={14} />{t("Add photos")}</Button>
    </div> : null}
  </div>;
}

/** The variation as priced by the shared engine: each line (what it does), net, tax, total, credits, payment terms, the QS. */
function PriceTab({ record, priceHref }: { record: Record_; priceHref: string }) {
  const t = useT();
  const format = useProjectFormat();
  const { price, change } = record;
  if (!price) return <div className={styles.tab}><EmptyState illustration={null} title={t("Not priced yet")}
    description={record.next === "price" ? t("Pricing it makes a variation of the sealed quotation.") : t("Sales or the QS prices it.")} /></div>;
  const money = (value: string) => format.money(value, price.currency);
  const columns: DataGridColumn<PricedLine>[] = [
    { id: "item", header: t("Item"), accessorFn: (row) => row.title, meta: { primary: true }, cell: ({ row: { original } }: { row: { original: PricedLine } }) =>
      <span className={styles.cell}><span>{original.title}</span><small>{t(LINE_OP_LABEL[original.op])}{original.op === "move" && original.fromArea ? ` · ${original.fromArea} → ${original.area ?? t("General")}` : ""}</small></span> },
    { id: "area", header: t("Room"), accessorFn: (row) => row.area ?? "", cell: ({ row: { original } }: { row: { original: PricedLine } }) => <span>{original.area ?? t("General")}</span> },
    { id: "quantity", header: t("Qty"), accessorFn: (row) => row.quantity, meta: { align: "end" }, cell: ({ row: { original } }: { row: { original: PricedLine } }) =>
      <span className={styles.number}>{Number(original.quantity).toLocaleString()} {original.unit}</span> },
    { id: "total", header: t("Amount"), accessorFn: (row) => row.total, meta: { align: "end" }, cell: ({ row: { original } }: { row: { original: PricedLine } }) =>
      <bdi className={styles.number} dir="ltr">{money(original.total)}</bdi> },
  ];
  const terms = price.paymentTerms.map((term) => `${term.title} · ${term.percent}%`).join(" · ");
  return <div className={styles.tab}>
    {price.lines.length ? <RecordTable ariaLabel={t("Priced lines")} data={price.lines} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText />
      : <p className={styles.muted}>{t("No lines on the price.")}</p>}
    <dl className={styles.totals}>
      <dt>{t("Net")}</dt><dd>{money(price.net)}</dd>
      <dt>{t("Tax")}</dt><dd>{money(price.tax)}</dd>
      {price.credit && Number(price.credit) !== 0 ? <><dt>{t("Of which credits")}</dt><dd>{money(price.credit)}</dd></> : null}
      <dt data-total>{t("Total")}</dt><dd data-total><bdi dir="ltr">{signedMoney(price.total, format.money, price.currency)}</bdi></dd>
    </dl>
    <dl className={styles.facts}>
      <dt>{t("Payment")}</dt><dd>{terms || t("Credited to the client")}{price.holdsWork && price.paymentTerms.some((term) => term.requiredForRelease) ? ` · ${t("work waits for it")}` : ""}</dd>
      {record.qs !== "not_needed" ? <><dt>{t("QS")}</dt><dd>{record.qs === "confirmed" ? t("Confirmed") : record.qs === "with_qs" ? t("With the QS") : t("Needed")}</dd></> : null}
    </dl>
    <div><Link className="wd-button" data-size="compact" href={priceHref}>{change.status === "pricing" && record.actions.includes("edit") ? t("Open the price") : t("View the price")}</Link></div>
  </div>;
}

/** The days the change adds per stage (editable while it's priced), and what they do to the real plan and the handover. */
function TimelineTab({ api, record, onSaved }: { api: ProjectChangesApi; record: Record_; onSaved: (record: Record_) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const { change, timeline } = record;
  const editable = record.actions.includes("edit");
  const [days, setDays] = useState<Record<string, number>>(() => Object.fromEntries(timeline.impacts.map((impact) => [impact.stageId, impact.days])));
  const [preview, setPreview] = useState<SchedulePreview | null>(timeline.preview);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const impacts = Object.entries(days).filter(([, value]) => value > 0).map(([stageId, value]) => ({ stageId, days: value }));
  const dirty = JSON.stringify(impacts) !== JSON.stringify(timeline.impacts.map(({ stageId, days: value }) => ({ stageId, days: value })));
  useEffect(() => {
    if (!editable || !dirty) return;
    let alive = true;
    const timer = window.setTimeout(() => { api.preview(impacts).then((next) => { if (alive) setPreview(next); }).catch(() => undefined); }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, editable, JSON.stringify(impacts)]);
  // Once sent: the timeline the client saw; once applied: what moved.
  const shown: Partial<SchedulePreview> | null = timeline.applied ?? timeline.sent ?? preview;
  const before = shown?.handoverBefore ?? change.handoverBefore, after = shown?.handoverAfter ?? change.handoverAfter;
  const stages = (shown?.stages ?? []) as SchedulePreview["stages"];
  const columns: DataGridColumn<SchedulePreview["stages"][number]>[] = [
    { id: "stage", header: t("Stage"), accessorFn: (row) => row.name, meta: { primary: true }, cell: ({ row: { original } }: { row: { original: SchedulePreview["stages"][number] } }) => <span>{t(original.name as never)}</span> },
    { id: "days", header: t("Days added"), accessorFn: (row) => row.days, meta: { align: "end" }, cell: ({ row: { original } }: { row: { original: SchedulePreview["stages"][number] } }) =>
      <span className={styles.number}>{original.days ? `+${original.days}` : "—"}</span> },
    { id: "finish", header: t("Finishes"), accessorFn: (row) => row.toEnd ?? "", cell: ({ row: { original } }: { row: { original: SchedulePreview["stages"][number] } }) =>
      <span className={styles.number}>{original.fromEnd && original.toEnd ? `${format.short(original.fromEnd)} → ${format.short(original.toEnd)}` : t("Not planned yet")}</span> },
    { id: "delay", header: t("Moves"), accessorFn: (row) => row.delay, meta: { align: "end" }, cell: ({ row: { original } }: { row: { original: SchedulePreview["stages"][number] } }) =>
      <span className={styles.number}>{t("+{count} days", { count: original.delay })}</span> },
  ];
  const save = async () => {
    setBusy(true); setFailure("");
    try { onSaved(await api.save(change.id, { title: change.title, reason: change.reason, description: change.description, stageImpacts: impacts, version: change.version,
      ...(change.status === "draft" ? { lines: change.lines } : {}) })); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  return <div className={styles.tab}>
    <p className={styles.handover}>
      {before && after && before !== after ? <>{t("Handover")} <strong>{format.day(before)}</strong> → <strong data-late>{format.day(after)}</strong></>
        : before ? <>{t("Handover")} <strong>{format.day(before)}</strong> <span className={styles.muted}>{t("No change")}</span></> : <span className={styles.muted}>{t("No handover date yet")}</span>}
    </p>
    {shown && shown.planned === false && (shown.finishDelay ?? 0) > 0 ? <p className={styles.muted}>{t("No dated plan yet: the handover moves by the days, on the work calendar.")}</p> : null}
    {editable ? <div className={styles.days}>
      {timeline.stages.filter((stage) => stage.status !== "done" && stage.status !== "skipped").map((stage) => <NumericInput key={stage.id} label={t(stage.name as never)} minValue={0} maxValue={365} step={1}
        value={days[stage.id] ?? 0} onChange={(value) => setDays((current) => ({ ...current, [stage.id]: Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0 }))} suffix={t("days")} />)}
    </div> : null}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {editable && dirty ? <div className={styles.row}><span className={styles.spacer} /><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></div> : null}
    {stages.length ? <RecordTable ariaLabel={t("Stages that move")} data={stages} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText />
      : <p className={styles.muted}>{t("No stage moves.")}</p>}
    {timeline.applied?.items?.length ? <p className={styles.muted}>{t("{count} tasks moved.", { count: timeline.applied.items.length })}</p>
      : preview?.items.length ? <p className={styles.muted}>{t("{count} tasks will move.", { count: preview.items.length })}</p> : null}
  </div>;
}

/** Inside the firm (each step of the approval) and the client's decision (who, when, how). */
function ApprovalsTab({ record }: { record: Record_ }) {
  const t = useT();
  const format = useProjectFormat();
  const { approval, change, signing } = record;
  return <div className={styles.tab}>
    {approval ? <ol className={styles.steps} aria-label={t("Approval")}>{approval.steps.map((step) => <li key={step.position} data-done={step.state === "done" || undefined}>
      <span>{step.label}</span>
      <span className={styles.muted}>{step.decidedBy ? `${step.decidedBy} · ${format.when(step.decidedAt)}` : step.state === "current" && approval.waitingFor.length
        ? t("Waiting for {names}", { names: approval.waitingFor.join(", ") }) : step.state === "returned" ? t("Returned") : ""}</span>
    </li>)}</ol> : <p className={styles.muted}>{t("Not sent for approval yet.")}</p>}
    <dl className={styles.facts}>
      <dt>{t("Client")}</dt>
      <dd>{change.decidedAt ? `${change.status === "declined" ? t("Declined by {name}", { name: change.decidedByName ?? "" }) : t("Approved by {name}", { name: change.decidedByName ?? "" })} · ${format.when(change.decidedAt)} · ${change.decisionMethod === "signed_link" ? t("Signed") : t("Client portal")}`
        : change.status === "with_client" ? t("Waiting for the client") : t("Not sent yet")}</dd>
      {change.declineNote ? <><dt>{t("Why")}</dt><dd>{change.declineNote}</dd></> : null}
      {change.withdrawReason ? <><dt>{t("Withdrawn")}</dt><dd>{change.withdrawReason}</dd></> : null}
      {signing ? <><dt>{t("Signing link")}</dt><dd>{signing.signerName} · {signing.state === "signed" ? t("Signed {date}", { date: format.when(signing.signedAt) })
        : signing.state === "open" ? t("Open until {date}", { date: format.when(signing.expiresAt) }) : t(signing.state === "expired" ? "Expired" : "Withdrawn")}</dd></> : null}
      {record.purchaseOrders.length ? <><dt>{t("Orders to check")}</dt><dd>{record.purchaseOrders.map((order) => order.number).join(", ")}</dd></> : null}
    </dl>
  </div>;
}

