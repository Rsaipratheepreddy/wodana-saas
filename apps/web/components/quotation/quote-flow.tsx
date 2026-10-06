"use client";

import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type CalendarDate, parseDate, today } from "@internationalized/date";
import { Button, Checkbox, DataGrid, type DataGridColumn, DateField, EmptyState, FieldCaption, FileUploader, FormDialog, FormRow, FormSection, IconButton, InlineNotice, PercentageInput, SelectField, TextAreaField, TextInput, useConfirmationDialog, useDesignSystem, VisuallyHidden } from "@/design-system";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { StartProjectDialog } from "@/components/project-core/start-project-dialog";
import { caseRequest, type CaseAsset } from "@/lib/pre-project/content";
import { SendQuoteDialog, deliveryMessage } from "./send-quote-dialog";
import { ShareQuote } from "./share-quote";
import { QsActions, qsBlocks, useQs } from "./quote-qs";
import { projectApi } from "@/lib/project-core/client";
import Link from "next/link";
import { money, plain } from "@/lib/quotation/format";
import type { BuilderLine, BuilderState, PaymentMilestone } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

type Api = ReturnType<typeof quoteApi>;

/**
 * The one next step for this quote, by its state: send for review → approve → send to the client →
 * record the client's decision → start the project. Returned, declined or changed quotes start a new revision.
 */
export function FlowActions({ state, api, workspaceId, caseId, onDone, onError, onRevision, onNotice }: {
  state: BuilderState; api: Api; workspaceId: string; caseId: string;
  onDone: () => Promise<unknown>; onError: (message: string) => void; onRevision: (quoteId: string) => void;
  /** What a step actually did, in one line (who the quote went to, and how). */
  onNotice?: (notice: { tone: "success" | "info"; message: string } | null) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [extending, setExtending] = useState(false);
  const { status } = state.quote;
  const { flow } = state;
  const qs = useQs(workspaceId, caseId, state.quote.id, state.quote.revision, state.quote.kind);
  const { confirmationDialog } = useConfirmationDialog();
  // What must be fixed first blocks sending (the "to fix" count beside the button says what).
  const blocking = state.checks.filter((check) => check.tone === "danger").length;
  // Sending to the client is the one step they see at once: it asks who decides first.
  const [sending, setSending] = useState<{ label: string; steps: Array<[string, Record<string, unknown>?]> } | null>(null);
  const confirmSend = (label: string, steps: Array<[string, Record<string, unknown>?]>) => setSending({ label, steps });
  const run = async (label: string, steps: Array<[string, Record<string, unknown>?]>) => {
    setBusy(label); onError(""); onNotice?.(null);
    try {
      let revision = state.quote.revision;
      let created: string | null = null;
      for (const [action, extra] of steps) {
        const result = await api.step(action, revision, extra);
        revision = result.data.revision;
        if (action === "revise") created = [...result.data.quotes].sort((a, b) => b.number - a.number)[0]?.id ?? null;
        if (action === "issue" && result.sent) onNotice?.(deliveryMessage(result.sent, t));
      }
      if (created) onRevision(created); else await onDone();
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); await onDone(); }
    finally { setBusy(null); }
  };
  const newRevision = <Button size="compact" isLoading={busy === "revise"} onPress={() => void run("revise", [["revise"]])}>{t("New revision")}</Button>;
  let actions: React.ReactNode = null;
  // PLM-082/084: where a QS prices quotations, the QS step comes first and holds sending until it's confirmed.
  const qsStep = qs.qs && status === "draft" ? <QsActions workspaceId={workspaceId} caseId={caseId} quoteId={state.quote.id} qs={qs.qs} onError={onError}
    onChanged={async (next) => { qs.setQs(next); await onDone(); }} /> : null;
  if (status === "draft" && qsBlocks(qs.qs)) {
    actions = qsStep;
  } else if (status === "draft" && state.canEdit) {
    const direct = !flow.internalReview && flow.canReview;
    actions = <>{qsStep}<Button data-tour="quote-send" size="compact" variant="primary" isLoading={Boolean(busy)} isDisabled={!state.lines.length || blocking > 0}
      onPress={() => (direct ? confirmSend("send", [["submit"], [flow.reviewAction], ["issue"]]) : void run("send", [["submit"]]))}>{direct ? t("Send to client") : t("Send for review")}</Button></>;
  } else if (status === "internal_review") {
    actions = flow.canReview ? <>
      <Button size="compact" isLoading={busy === "return"} onPress={() => setReturning(true)}>{t("Return")}</Button>
      <Button size="compact" variant="primary" isLoading={busy === "approve"} onPress={() => void run("approve", [[flow.reviewAction]])}>{t("Approve")}</Button>
    </> : <span className={styles.waiting}>{t("Waiting for review")}</span>;
  } else if (status === "internal_approved") {
    actions = <>
      {flow.canReview ? <Button size="compact" isLoading={busy === "return"} onPress={() => setReturning(true)}>{t("Return")}</Button> : null}
      <Button size="compact" variant="primary" isLoading={busy === "issue"} onPress={() => confirmSend("issue", [["issue"]])}>{t("Send to client")}</Button>
    </>;
  } else if (status === "issued" || status === "expired") {
    // A sent quote can be kept open longer; an expired one sent again with the same content (Q-7).
    const extend = state.canEditValidity ? <Button size="compact" variant={status === "expired" ? "primary" : "secondary"} onPress={() => setExtending(true)}>{t("Extend validity")}</Button> : null;
    actions = status === "expired" ? <>{newRevision}{extend}</> : <>
      {newRevision}
      {extend}
      <ShareQuote api={api} onNotice={onNotice} />
      {flow.canRecordDecision ? <Button size="compact" variant="primary" onPress={() => setDeciding(true)}>{t("Record client decision")}</Button> : <span className={styles.waiting}>{t("Waiting for the client")}</span>}
    </>;
  } else if (["changes_requested", "declined", "withdrawn", "superseded"].includes(status)) {
    actions = newRevision;
  } else if (status === "accepted" && state.quote.kind === "variation" && state.project) {
    // An accepted variation changes the project's scope once it's applied (sealed as VO-n).
    actions = state.project.appliedAs
      ? <Link className="wd-button" data-size="compact" data-variant="quiet" href={`/workspace/projects/${state.project.id}/scope`}>{t("Applied as {label}", { label: state.project.appliedAs })}</Link>
      : <Button size="compact" variant="primary" isLoading={busy === "apply"} onPress={async () => {
          setBusy("apply"); onError("");
          try {
            const projects = projectApi(workspaceId);
            const detail = await projects.get(state.project!.id);
            await projects.command(state.project!.id, detail.project.version, "apply_variation", { quoteId: state.quote.id });
            await onDone();
          } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not apply the variation.")); }
          finally { setBusy(null); }
        }}>{t("Apply to project")}</Button>;
  } else if (status === "accepted" && state.quote.kind === "quotation" && state.quote.round !== "design") {
    // The accepted quotation starts the project; the dialog shows what the firm's start rules still need.
    actions = <Button size="compact" variant="primary" onPress={() => setStarting(true)}>{t("Start project")}</Button>;
  }
  return <>
    {actions}
    {confirmationDialog}
    {sending ? <SendQuoteDialog workspaceId={workspaceId} caseId={caseId} quoteLabel={t("Q-{number}", { number: state.quote.number })} clientName={state.client.name}
      busy={Boolean(busy)} onClose={() => setSending(null)}
      onSend={async (approverId) => {
        // The issue step goes to the chosen decision-maker.
        await run(sending.label, sending.steps.map(([action, extra]) => (action === "issue" ? [action, { ...extra, approverId }] : [action, extra])));
        setSending(null);
      }} /> : null}
    {starting ? <StartProjectDialog workspaceId={workspaceId} caseId={caseId} onClose={() => setStarting(false)} /> : null}
    {returning ? <ReturnDialog busy={busy === "return"} onClose={() => setReturning(false)}
      onSave={async (note) => { await run("return", [["return", { note }]]); setReturning(false); }} /> : null}
    {extending ? <ExtendValidityDialog current={state.quote.validUntil} busy={busy === "extend"} onClose={() => setExtending(false)}
      onSave={async (validUntil) => { await run("extend", [["extend_validity", { validUntil }]]); setExtending(false); }} /> : null}
    {deciding ? <DecisionDialog state={state} workspaceId={workspaceId} caseId={caseId} onClose={() => setDeciding(false)}
      onSave={async (input) => { await run("decide", [["record_decision", input]]); setDeciding(false); }} busy={busy === "decide"} /> : null}
  </>;
}

/** The reviewer says what needs to change; the preparer reads it in the notice and the case history. */
function ReturnDialog({ onClose, onSave, busy }: { onClose: () => void; onSave: (note: string) => Promise<void>; busy: boolean }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog title={t("Return for changes")} onClose={onClose} isSubmitting={busy} isDirty={Boolean(note.trim())}
    isSubmitDisabled={!note.trim()} submitLabel={t("Return")} onSubmit={() => onSave(note.trim())}>
    <TextAreaField label={t("What needs to change")} isRequired value={note} onChange={setNote} maxLength={3000} />
  </FormDialog>;
}

/** Same content, a new date: the client is told it's open again (Q-7). */
function ExtendValidityDialog({ current, onClose, onSave, busy }: { current: string | null; onClose: () => void; onSave: (validUntil: string) => Promise<void>; busy: boolean }) {
  const t = useT();
  // The earliest date is tomorrow on the workspace's calendar (its region's zone).
  const { timeZone } = useDesignSystem();
  const minimum = today(timeZone).add({ days: 1 });
  const [initial] = useState<CalendarDate>(() => {
    const start = current ? parseDate(current) : null;
    return start && start.compare(minimum) >= 0 ? start.add({ days: 14 }) : minimum.add({ days: 13 });
  });
  const [value, setValue] = useState<CalendarDate | null>(initial);
  const valid = Boolean(value && value.compare(minimum) >= 0);
  return <FormDialog title={t("Extend validity")} onClose={onClose} isSubmitting={busy} isDirty={value?.toString() !== initial.toString()}
    isSubmitDisabled={!valid} submitLabel={t("Extend")} onSubmit={() => (value ? onSave(value.toString()) : undefined)}>
    <DateField label={t("Valid until")} isRequired minValue={minimum} value={value} onChange={(next) => setValue(next as CalendarDate | null)} />
  </FormDialog>;
}

const METHODS = [["signed_document", tKey("Signed copy")], ["email", tKey("Email")], ["in_person", tKey("In person")], ["phone", tKey("Phone")], ["message", tKey("Message")]] as const;
/** The file the client decided in: an image or a PDF, up to 20 MB. */
const EVIDENCE_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,application/pdf";
const EVIDENCE_BYTES = 20 * 1024 * 1024;

function DecisionDialog({ state, workspaceId, caseId, onClose, onSave, busy }: { state: BuilderState; workspaceId: string; caseId: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  // The file the client decided in: a signed copy, the email or a screenshot of the message (required from Sales, Q-24).
  const [evidence, setEvidence] = useState<CaseAsset | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const evidenceLabel = useId();
  const evidenceRequired = Boolean(state.flow.decisionEvidenceRequired);
  const [decision, setDecision] = useState("accept");
  const [method, setMethod] = useState("signed_document");
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const optional = state.lines.filter((line) => line.optional);
  const priced = new Map(state.pricing.lines.map((line) => [line.id, line.total]));
  // Each file goes to the case first; the decision then carries its id.
  const attach = async (file?: File) => {
    setUploadError("");
    if (!file) return;
    if (file.size > EVIDENCE_BYTES) { setUploadError(t("{name} is larger than 20 MB.", { name: file.name })); return; }
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      setEvidence(await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body));
    } catch (failure) { setUploadError(failure instanceof Error ? translateKnown(t, failure.message) : t("Upload failed.")); }
    finally { setUploading(false); }
  };
  return <FormDialog title={t("Record client decision")} onClose={onClose} isSubmitting={busy} submitLabel={t("Save")}
    isDirty={Boolean(clientName.trim() || note.trim() || options.length || evidence)}
    isSubmitDisabled={uploading || !clientName.trim() || (decision !== "accept" && !note.trim()) || (evidenceRequired && !evidence)}
    onSubmit={() => onSave({ decision, method, clientName: clientName.trim(), note: note.trim(), selectedOptionLineIds: decision === "accept" ? options : [], ...(evidence ? { evidenceAssetId: evidence.id } : {}) })}>
    <FormRow>
      <SelectField label={t("Decision")} isRequired selectedKey={decision} onSelectionChange={(key) => setDecision(String(key))}
        items={[{ id: "accept", label: t("Accepted") }, { id: "changes", label: t("Wants changes") }, { id: "decline", label: t("Declined") }]} />
      <SelectField label={t("How")} isRequired selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} items={METHODS.map(([id, label]) => ({ id, label: t(label) }))} />
    </FormRow>
    <TextInput label={t("Decided by")} isRequired value={clientName} onChange={setClientName} maxLength={160} />
    {decision === "accept" && optional.length ? <FormSection title={t("Options the client chose")}>
      {optional.map((line) => <Checkbox key={line.id} isSelected={options.includes(line.id)} onChange={(on) => setOptions((current) => on ? [...current, line.id] : current.filter((id) => id !== line.id))}>
        {line.title} · {money(priced.get(line.id) ?? null, state.quote.currency, state.quote.decimals, locale)}
      </Checkbox>)}
    </FormSection> : null}
    <TextAreaField label={decision === "accept" ? t("Note") : t("What they asked for")} isRequired={decision !== "accept"} value={note} onChange={setNote} />
    <div className={styles.evidence} role="group" aria-labelledby={evidenceLabel}>
      <FieldCaption id={evidenceLabel} isRequired={evidenceRequired}>{t("Evidence")}</FieldCaption>
      {evidence ? <div className={styles.evidenceFile}><span>{evidence.name}</span><Button size="compact" variant="quiet" onPress={() => setEvidence(null)}>{t("Remove")}</Button></div>
        : uploading ? <InlineNotice message={t("Uploading…")} />
        : <FileUploader accept={EVIDENCE_TYPES} appearance="button" label={t("Attach the signed copy, email or message")} multiple={false} onFiles={(files) => void attach(files[0])} />}
      {uploadError ? <InlineNotice tone="error" message={uploadError} /> : null}
    </div>
  </FormDialog>;
}

type Milestone = PaymentMilestone & { text: string };

/**
 * The payment milestones: each one's share of the total, when it's due and whether it must be paid
 * before the project starts. Edited in place; the shares must add up to 100%.
 */
export function QuotePayments({ state, api, onState, onError }: { state: BuilderState; api: Api; onState: (state: BuilderState) => void; onError: (message: string) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const initial = () => state.quote.paymentTerms.map((term) => ({ ...term, text: String(term.percent) }));
  const [rows, setRows] = useState<Milestone[]>(initial);
  const [busy, setBusy] = useState(false);
  const total = Number(state.pricing.total);
  const sum = rows.reduce((acc, row) => acc + (Number(row.text) || 0), 0);
  const update = (id: string, patch: Partial<Milestone>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const complete = rows.every((row) => row.title.trim() && row.trigger.trim() && Number(row.text) > 0);
  // No milestones is allowed (clearing them); otherwise every one is complete and the shares make 100%.
  const valid = rows.length === 0 || (Math.abs(sum - 100) < 0.001 && complete);
  const dirty = JSON.stringify(rows.map(({ text, ...row }) => ({ ...row, percent: Number(text) }))) !== JSON.stringify(state.quote.paymentTerms);
  const amount = (percent: string) => money((total * (Number(percent) || 0)) / 100, state.quote.currency, state.quote.decimals, locale);
  const number = (id: string) => rows.findIndex((row) => row.id === id) + 1;
  const columns: DataGridColumn<Milestone>[] = [
    { id: "title", header: t("Milestone"), size: 220, accessorFn: (row) => row.title, meta: { renderCell: (row) =>
      <TextInput label={<VisuallyHidden>{t("Milestone {number}", { number: number(row.id) })}</VisuallyHidden>} maxLength={160} placeholder={t("Advance")} value={row.title} onChange={(title) => update(row.id, { title })} /> } },
    { id: "percent", header: t("Share"), size: 110, accessorFn: (row) => Number(row.text), meta: { align: "end", renderCell: (row) =>
      <PercentageInput label={<VisuallyHidden>{t("Share of milestone {number}", { number: number(row.id) })}</VisuallyHidden>} formatOptions={{ maximumFractionDigits: 2 }}
        value={row.text === "" ? Number.NaN : Number(row.text)} onChange={(value) => update(row.id, { text: Number.isFinite(value) ? String(value) : "" })} /> } },
    { id: "amount", header: t("Amount"), size: 140, accessorFn: (row) => Number(row.text), meta: { align: "end", renderCell: (row) => amount(row.text) } },
    { id: "trigger", header: t("When"), size: 220, accessorFn: (row) => row.trigger, meta: { renderCell: (row) =>
      <TextInput label={<VisuallyHidden>{t("When milestone {number} is due", { number: number(row.id) })}</VisuallyHidden>} maxLength={300} placeholder={t("On acceptance")} value={row.trigger} onChange={(trigger) => update(row.id, { trigger })} /> } },
    { id: "release", header: t("Before the project starts"), size: 150, accessorFn: (row) => row.requiredForRelease, meta: { renderCell: (row) =>
      <Checkbox aria-label={t("Milestone {number} before the project starts", { number: number(row.id) })} isSelected={row.requiredForRelease} onChange={(value) => update(row.id, { requiredForRelease: value })} /> } },
    { id: "remove", header: "", size: 56, enableSorting: false, meta: { renderCell: (row) =>
      <IconButton aria-label={t("Remove milestone {number}", { number: number(row.id) })} size="compact" variant="quiet" onPress={() => setRows((current) => current.filter((item) => item.id !== row.id))}><Trash2 aria-hidden="true" size={14} /></IconButton> } },
  ];
  const save = async () => {
    setBusy(true);
    try { onState(await api.paymentTerms(rows.map(({ text, ...row }) => ({ ...row, percent: Number(text) })))); }
    catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  if (!state.canEdit) return <section className={styles.payments} aria-label={t("Payments")}>
    {rows.length ? <ol>{rows.map((row) => <li key={row.id}>
      <span><strong>{plain(row.percent, locale, 2)}%</strong> {row.title}<small>{row.trigger}</small></span><span>{amount(row.text)}</span>
    </li>)}</ol> : <EmptyState title={t("No payment milestones")} />}
  </section>;
  return <section className={styles.paymentEditor} aria-label={t("Payments")}>
    {state.paymentTemplates.length ? <div className={styles.paymentTemplate}><SelectField label={t("Start from a template")} placeholder={t("Choose a template")} selectedKey={null}
      onSelectionChange={(key) => { const template = state.paymentTemplates.find((item) => item.id === key); if (template) setRows(template.milestones.map((term) => ({ ...term, id: crypto.randomUUID(), text: String(term.percent) }))); }}
      items={state.paymentTemplates.map((template) => ({ id: template.id, label: template.name }))} /></div> : null}
    {rows.length ? <DataGrid ariaLabel={t("Payment milestones")} data={rows} getRowId={(row) => row.id} columns={columns}
      showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} /> : <EmptyState title={t("No payment milestones yet")} action={<Button size="compact" variant="primary" onPress={() => setRows((current) => [...current, { id: crypto.randomUUID(), title: "", percent: 0, text: String(Math.max(0, Math.round((100 - sum) * 100) / 100)), trigger: "", requiredForRelease: current.length === 0 }])}><Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button>} />}
    {rows.length || dirty ? <div className={styles.formActions}>
      {rows.length ? <Button size="compact" variant="quiet" onPress={() => setRows((current) => [...current, { id: crypto.randomUUID(), title: "", percent: 0, text: String(Math.max(0, Math.round((100 - sum) * 100) / 100)), trigger: "", requiredForRelease: current.length === 0 }])}><Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button> : null}
      <span className={styles.spacer} />
      {rows.length && !complete ? <span className={styles.mutedText} data-alert>{t("Each milestone needs a name, a share and when it's due")}</span> : null}
      <span className={styles.mutedText} data-alert={(rows.length && Math.abs(sum - 100) >= 0.001) || undefined}>{t("Total {percent}%", { percent: Math.round(sum * 100) / 100 })}</span>
      {dirty ? <Button size="compact" onPress={() => setRows(initial())}>{t("Cancel")}</Button> : null}
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!valid || !dirty} onPress={() => void save()}>{t("Save")}</Button>
    </div> : null}
    {rows.length && !rows.some((row) => row.requiredForRelease) ? <InlineNotice tone="info" message={t("Mark at least one milestone to be paid before the project starts.")} /> : null}
  </section>;
}

/** What changed since the previous revision: lines added, removed and changed, and the total's move. */
export function RevisionChanges({ state, api }: { state: BuilderState; api: Api }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const index = state.family.findIndex((item) => item.id === state.quote.id);
  const previous = index > 0 ? { ...state.family[index - 1], number: index } : null;
  const [other, setOther] = useState<BuilderState | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!previous) return;
    let alive = true;
    api.loadOther(previous.id).then((value) => { if (alive) setOther(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [api, previous]);
  if (!previous || !other || !Array.isArray(other.lines) || !other.pricing) return null;
  const before = new Map(other.lines.map((line) => [line.id, line]));
  const after = new Map(state.lines.map((line) => [line.id, line]));
  const added = state.lines.filter((line) => !before.has(line.id));
  const removed = other.lines.filter((line) => !after.has(line.id));
  const differs = (a: BuilderLine, b: BuilderLine) => a.title !== b.title || Number(a.quantity) !== Number(b.quantity) || Number(a.rate) !== Number(b.rate) || a.areaId !== b.areaId || Boolean(a.optional) !== Boolean(b.optional);
  const changed = state.lines.filter((line) => before.has(line.id) && differs(line, before.get(line.id)!));
  const delta = Number(state.pricing.total) - Number(other.pricing.total);
  if (!added.length && !removed.length && !changed.length && !delta) return null;
  const m = (value: number) => money(Math.abs(value), state.quote.currency, state.quote.decimals, locale);
  return <section className={styles.changes} aria-label={t("Changes since R{number}", { number: previous.number })}>
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <strong>{t("Changes since R{number}", { number: previous.number })}</strong>
      <span>{[added.length ? t("{count} added", { count: added.length }) : "", removed.length ? t("{count} removed", { count: removed.length }) : "", changed.length ? t("{count} changed", { count: changed.length }) : ""].filter(Boolean).join(" · ")}</span>
      <span className={styles.delta} data-direction={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>{delta ? `${delta > 0 ? "+" : "−"}${m(delta)}` : ""}</span>
    </button>
    {open ? <ul>
      {added.map((line) => <li key={`a-${line.id}`} data-kind="added">{t("Added")} · {line.title}</li>)}
      {removed.map((line) => <li key={`r-${line.id}`} data-kind="removed">{t("Removed")} · {line.title}</li>)}
      {changed.map((line) => { const old = before.get(line.id)!; return <li key={`c-${line.id}`} data-kind="changed">{line.title}: {[
        old.title !== line.title ? `${old.title} → ${line.title}` : "",
        Number(old.quantity) !== Number(line.quantity) ? `${t("Qty")} ${plain(old.quantity, locale)} → ${plain(line.quantity, locale)}` : "",
        Number(old.rate) !== Number(line.rate) ? `${t("Rate")} ${plain(old.rate, locale)} → ${plain(line.rate, locale)}` : "",
        old.areaId !== line.areaId ? t("moved area") : "", Boolean(old.optional) !== Boolean(line.optional) ? (line.optional ? t("now optional") : t("now included")) : "",
      ].filter(Boolean).join(", ")}</li>; })}
    </ul> : null}
  </section>;
}
