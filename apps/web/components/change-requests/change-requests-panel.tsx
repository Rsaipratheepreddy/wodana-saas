"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  Badge, Button, EmptyState, ErrorState, FormDialog, FormRow, FormSection, IconButton, InlineNotice, MoneyField, NumericInput, RecordTable, SelectField, Skeleton, TextAreaField,
  TextInput, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest } from "@/lib/pre-project/content";
import {
  ACTION_LABEL, EVENT_LABEL, KIND_LABEL, STATUS_LABEL, STATUS_TONE,
  type ChangeKind, type ChangeLine, type ChangeRequest, type ChangeRequestsView, type ChangeSources, type LineAction, type LineSource,
} from "@/lib/change-requests/types";
import { CaseModal } from "../pre-project/case-controls";
import styles from "../pre-project/design-decisions.module.css";

/**
 * Change requests after the contract (plan §6.20, R11), for the team: the client's own requests and the team's,
 * each assessed line by line (from the accepted quotation, a material changed after sign-off, an allowance, or new
 * work) with its price and handover impact; approved inside the firm on E3, then sent to the client to sign by link
 * (no login) or decide in their portal. History, the approval's steps and the open orders an approved change touches
 * (M-5) stay on the change.
 */
export function ChangeRequestsPanel({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<ChangeRequestsView | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  // A notice links here with ?change=<id>: that change opens.
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("change")));
  const [editing, setEditing] = useState<ChangeRequest | "new" | null>(null);
  const load = useCallback(() => caseRequest<ChangeRequestsView>(workspaceId, caseId, "change-requests").then((next) => { setView(next); setFailure(""); })
    .catch((error: Error) => setFailure(error.message)), [workspaceId, caseId]);
  useEffect(() => { void load(); }, [load]);
  if (failure && !view) return <ErrorState title={t("Change requests didn't load")} description={failure} onRetry={() => void load()} />;
  if (!view) return <Skeleton lines={4} shape="rows" />;
  const day = (iso: string | null) => { if (!iso) return ""; try { return new Intl.DateTimeFormat(locale, { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso)); } catch { return iso; } };
  const money = (value: string, currency: string) => `${value.startsWith("-") ? "" : "+"}${value} ${currency}`;
  const saved = (message: string) => (next: ChangeRequestsView) => { setView((current) => ({ ...next, canEdit: current?.canEdit })); setNotice(message); setEditing(null); };
  const open = view.changes.find((change) => change.id === openId) ?? null;
  const columns: DataGridColumn<ChangeRequest>[] = [
    { id: "change", header: t("Change"), accessorFn: (row) => `${row.reference} ${row.title}`, meta: { primary: true }, cell: ({ row }: { row: { original: ChangeRequest } }) => <span className={styles.cell}>
      <span>{row.original.reference} · {row.original.title}</span>
      <small>{[t(KIND_LABEL[row.original.kind]), row.original.raisedByClient ? t("Asked by {name}", { name: row.original.raisedByName ?? "" }) : null].filter(Boolean).join(" · ")}</small>
    </span> },
    { id: "impact", header: t("Impact"), accessorFn: (row) => row.priceImpact, meta: { align: "end" }, cell: ({ row }: { row: { original: ChangeRequest } }) => <span className={styles.cell}>
      <bdi className={styles.amount} dir="ltr">{money(row.original.priceImpact, row.original.currency)}</bdi>
      {row.original.timeImpactDays ? <small>{t("{count} days", { count: `${row.original.timeImpactDays > 0 ? "+" : ""}${row.original.timeImpactDays}` })}</small> : null}
    </span> },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, cell: ({ row }: { row: { original: ChangeRequest } }) => <span className={styles.cell}>
      <Badge tone={STATUS_TONE[row.original.status]}>{t(STATUS_LABEL[row.original.status])}</Badge>
      {row.original.status === "pending_approval" && row.original.approval?.waitingFor.length ? <small>{t("Waiting for {names}", { names: row.original.approval.waitingFor.join(", ") })}</small> : null}
    </span> },
    { id: "updated", header: t("Updated"), accessorFn: (row) => row.updatedAt, meta: { priority: "low" }, cell: ({ row }: { row: { original: ChangeRequest } }) => <span>{day(row.original.updatedAt)}</span> },
  ];
  return <section className={styles.section} aria-label={t("Change requests")}>
    <div className={styles.bar}>
      <span className={styles.spacer} />
      {view.canEdit ? <Button size="compact" variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New change")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {view.changes.length ? <RecordTable ariaLabel={t("Change requests")} data={view.changes} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText
      onRowAction={(row) => setOpenId(row.id)} />
      : <EmptyState illustration="empty" title={t("No change requests")} description={t("A change after the contract is priced here, approved, and signed by the client.")}
        action={view.canEdit ? <Button variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New change")}</Button> : undefined} />}
    {open ? <ChangeDetail change={open} canEdit={Boolean(view.canEdit)} day={day} money={money} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)}
      run={async (path, body, message) => { const next = await caseRequest<ChangeRequestsView>(workspaceId, caseId, `change-requests/${open.id}/${path}`, "POST", body); saved(message)(next); return next; }} /> : null}
    {editing ? <ChangeEditor change={editing === "new" ? null : editing} sources={view.sources} onClose={() => setEditing(null)}
      onSubmit={async (body) => {
        const next = editing === "new" ? await caseRequest<ChangeRequestsView>(workspaceId, caseId, "change-requests", "POST", body)
          : await caseRequest<ChangeRequestsView>(workspaceId, caseId, `change-requests/${editing.id}`, "PUT", { ...body, version: editing.version });
        saved(t("Change saved."))(next);
        setOpenId(String(body.id ?? (editing === "new" ? "" : editing.id)) || null);
      }} /> : null}
  </section>;
}

type Run = (path: string, body: Record<string, unknown>, message: string) => Promise<ChangeRequestsView>;

function ChangeDetail({ change, canEdit, day, money, onClose, onEdit, run }: {
  change: ChangeRequest; canEdit: boolean; day: (iso: string | null) => string; money: (value: string, currency: string) => string; onClose: () => void; onEdit: () => void; run: Run;
}) {
  const t = useT();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const act = async (path: string, body: Record<string, unknown>, message: string) => {
    setBusy(path); setError("");
    try { await run(path.split(":")[0], { ...body, commandId: crypto.randomUUID() }, message); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(""); }
  };
  // R11: the PDF and a signing link by email; the link is also shown here in case the email doesn't arrive.
  const send = async () => {
    setBusy("send"); setError("");
    try { const next = await run("send", { commandId: crypto.randomUUID() }, t("Signing link sent to the client.")); setLink(next.link ?? null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(""); }
  };
  const approval = change.approval;
  return <CaseModal title={`${change.reference} · ${change.title}`} size="md" layout="sheet" onClose={onClose}
    footer={<div className={styles.bar}>
      {canEdit && ["draft", "pending_approval", "with_client"].includes(change.status) ? <Button size="compact" variant="quiet" isDisabled={!note.trim()} isLoading={busy === "withdraw"}
        onPress={() => void act("withdraw", { version: change.version, reason: note.trim() }, t("Change withdrawn."))}>{t("Withdraw")}</Button> : null}
      <span className={styles.spacer} />
      {change.status === "draft" && canEdit ? <>
        <Button size="compact" onPress={onEdit}>{t("Edit")}</Button>
        <Button size="compact" variant="primary" isLoading={busy === "submit"} onPress={() => void act("submit", { version: change.version }, t("Sent for approval."))}>{t("Send for approval")}</Button>
      </> : null}
      {change.status === "pending_approval" ? <>
        <Button size="compact" variant="quiet" isDisabled={!note.trim()} isLoading={busy === "decide:return"}
          onPress={() => void act("decide:return", { decision: "return", note: note.trim(), approvalVersion: approval?.version }, t("Returned for changes."))}>{t("Return")}</Button>
        <Button size="compact" variant="primary" isLoading={busy === "decide"}
          onPress={() => void act("decide", { decision: "approve", note: note.trim() || null, approvalVersion: approval?.version }, t("Approved. It now waits for the client."))}>{t("Approve")}</Button>
      </> : null}
      {change.status === "with_client" && canEdit ? <Button size="compact" variant="primary" isLoading={busy === "send"} onPress={() => void send()}>
        {change.signing ? t("Send a new link") : t("Send to sign")}</Button> : null}
    </div>}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className={styles.inline}><Badge tone={STATUS_TONE[change.status]}>{t(STATUS_LABEL[change.status])}</Badge><span className={styles.muted}>{t(KIND_LABEL[change.kind])}</span></div>
    {change.description ? <p>{change.description}</p> : null}
    <dl className={styles.facts}>
      <dt>{t("Price")}</dt><dd className={styles.amount}><bdi dir="ltr">{money(change.priceImpact, change.currency)}</bdi>
        {change.allowanceDraw !== "0.00" ? <small> · {t("{amount} from allowances", { amount: change.allowanceDraw })}</small> : null}</dd>
      <dt>{t("Handover")}</dt><dd>{change.timeImpactDays && change.handoverAfter ? `${day(change.handoverBefore)} → ${day(change.handoverAfter)}` : day(change.handoverBefore) || t("No change")}</dd>
      {change.designImpact ? <><dt>{t("Design")}</dt><dd>{change.designImpact}</dd></> : null}
      {change.decidedAt ? <><dt>{change.status === "declined" ? t("Declined by") : t("Approved by")}</dt><dd>{change.decidedByName} · {day(change.decidedAt)}
        {change.decisionMethod === "signed_link" ? ` · ${t("Signed")}` : change.decisionMethod === "portal" ? ` · ${t("Client portal")}` : ""}</dd></> : null}
      {change.declineNote ? <><dt>{t("Reason")}</dt><dd>{change.declineNote}</dd></> : null}
      {change.withdrawReason ? <><dt>{t("Reason")}</dt><dd>{change.withdrawReason}</dd></> : null}
      {change.signing ? <><dt>{t("Signing link")}</dt><dd>{change.signing.signerName} · {change.signing.state === "signed" ? t("Signed {date}", { date: day(change.signing.signedAt) })
        : change.signing.state === "open" ? t("Open until {date}", { date: day(change.signing.expiresAt) }) : t(change.signing.state === "expired" ? "Expired" : "Withdrawn")}</dd></> : null}
    </dl>
    {change.lines.length ? <ul className={styles.checks} aria-label={t("Lines")}>{change.lines.map((line) => <li key={line.id}>
      <span className={styles.cell}><strong>{t(ACTION_LABEL[line.action])}: {line.title}</strong>
        <small>{[line.roomName, line.quantity ? `${line.quantity} ${line.unit}`.trim() : "", line.unitPrice ? `${line.unitPrice} ${change.currency}` : ""].filter(Boolean).join(" · ")}</small></span>
      <bdi className={styles.amount} dir="ltr">{money(line.amount, change.currency)}</bdi>
    </li>)}</ul> : null}
    {approval ? <div className={styles.stack}><strong>{t("Approval")}</strong>
      <ol className={styles.checks}>{approval.steps.map((step) => <li key={step.position} data-ok={step.state === "done" || undefined}>
        <span className={styles.cell}><span>{step.label}</span>{step.decidedBy ? <small>{step.decidedBy} · {day(step.decidedAt)}</small> : step.state === "current" && approval.waitingFor.length
          ? <small>{t("Waiting for {names}", { names: approval.waitingFor.join(", ") })}</small> : null}</span>
      </li>)}</ol></div> : null}
    {change.purchaseOrders.length ? <InlineNotice tone="info" title={t("Open orders to check")} message={change.purchaseOrders.map((order) => `${order.number} (${order.matchedOn})`).join(", ")} /> : null}
    {link ? <div className={styles.inline}><TextInput label={t("Signing link")} value={link} isReadOnly /><IconButton aria-label={t("Copy")} onPress={() => void navigator.clipboard?.writeText(link)}><Copy size={14} /></IconButton></div> : null}
    {["draft", "pending_approval", "with_client"].includes(change.status) ? <TextAreaField label={t("Note")} description={t("Needed to return or withdraw it.")} maxLength={2000} value={note} onChange={setNote} /> : null}
    <ol className={styles.history} aria-label={t("History")}>{change.events.map((item, index) => <li key={`${item.event}-${index}`}>
      <span className={styles.cell}><span>{t(EVENT_LABEL[item.event] ?? item.event as never)}</span>
        <small>{[item.actorName, day(item.at)].filter(Boolean).join(" · ")}</small>{item.note ? <small>{item.note}</small> : null}</span>
    </li>)}</ol>
  </CaseModal>;
}

type DraftLine = { id: string; source: LineSource; action: LineAction; ref: string; title: string; quantity: string; unit: string; unitPrice: string; amount: string };

function ChangeEditor({ change, sources, onClose, onSubmit }: { change: ChangeRequest | null; sources: ChangeSources; onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [id] = useState(() => change?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(change?.title ?? "");
  const [kind, setKind] = useState<ChangeKind>(change?.kind ?? "addition");
  const [description, setDescription] = useState(change?.description ?? "");
  const [designImpact, setDesignImpact] = useState(change?.designImpact ?? "");
  const [days, setDays] = useState(change?.timeImpactDays ?? 0);
  const [lines, setLines] = useState<DraftLine[]>(() => (change?.lines ?? []).map((line: ChangeLine) => ({ id: line.id, source: line.source, action: line.action,
    ref: line.source === "ledger" ? `${line.ledgerEntryId}:${line.ledgerVersionId}` : line.quoteLineId ? `${line.quoteId}:${line.quoteLineId}` : "", title: line.title,
    quantity: line.quantity ?? "", unit: line.unit, unitPrice: line.unitPrice ?? "", amount: line.action === "replace" ? line.amount : "" })));
  const set = (index: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  const allowances = sources.quoteLines.filter((line) => line.kind === "allowance");
  const refs = (source: LineSource) => source === "ledger" ? sources.ledgerChanges.map((item) => ({ id: `${item.entryId}:${item.versionId}`, label: `${item.title} · V${item.number}` }))
    : (source === "allowance" ? allowances : sources.quoteLines.filter((line) => line.kind !== "allowance")).map((line) => ({ id: `${line.quoteId}:${line.id}`, label: [line.title, line.room].filter(Boolean).join(" · ") }));
  const pick = (index: number, line: DraftLine, ref: string) => {
    if (line.source === "ledger") { const item = sources.ledgerChanges.find((change0) => `${change0.entryId}:${change0.versionId}` === ref); return set(index, { ref, title: item?.title ?? line.title }); }
    const item = sources.quoteLines.find((quoteLine) => `${quoteLine.quoteId}:${quoteLine.id}` === ref);
    set(index, { ref, title: item?.title ?? line.title, unit: item?.unit ?? line.unit, unitPrice: line.source === "allowance" ? line.unitPrice : item?.rate ?? line.unitPrice, quantity: line.source === "allowance" ? line.quantity || "1" : item?.quantity ?? line.quantity });
  };
  const body = () => ({
    id, title: title.trim(), kind, description: description.trim(), designImpact: designImpact.trim(), timeImpactDays: days,
    lines: lines.map((line) => {
      const [first, second] = line.ref.split(":");
      return { id: line.id, source: line.source, action: line.source === "allowance" ? "draw" : line.action, title: line.title.trim(), quantity: line.quantity || null, unit: line.unit, unitPrice: line.unitPrice || null,
        amount: line.action === "replace" ? line.amount : null,
        ...(line.source === "ledger" ? { ledgerEntryId: first, ledgerVersionId: second } : line.source === "custom" ? {} : { quoteId: first, quoteLineId: second }) };
    }),
  });
  const sourceItems = [{ id: "custom", label: t("New work") }, { id: "quote_line", label: t("Quoted line") }, ...(allowances.length ? [{ id: "allowance", label: t("Allowance") }] : []),
    ...(sources.ledgerChanges.length ? [{ id: "ledger", label: t("Material changed after sign-off") }] : [])];
  return <FormDialog title={change ? t("Edit {reference}", { reference: change.reference }) : t("New change")} onClose={onClose} isDirty submitLabel={t("Save")} size="lg"
    isSubmitDisabled={!title.trim()} onSubmit={() => onSubmit(body())}>
    <FormSection title={t("Change")}>
      <TextInput isRequired autoFocus label={t("Name")} maxLength={240} value={title} onChange={setTitle} />
      <SelectField label={t("Type")} items={(Object.keys(KIND_LABEL) as ChangeKind[]).map((item) => ({ id: item, label: t(KIND_LABEL[item]) }))} selectedKey={kind} onSelectionChange={(key) => setKind(String(key) as ChangeKind)} />
      <TextAreaField label={t("What changes")} maxLength={4000} value={description} onChange={setDescription} />
      <TextAreaField label={t("Design impact")} maxLength={2000} value={designImpact} onChange={setDesignImpact} />
      <NumericInput label={t("Handover impact (working days)")} minValue={-365} maxValue={365} step={1} value={days} onChange={(value) => setDays(Number.isFinite(value) ? Math.trunc(value) : 0)} />
    </FormSection>
    <FormSection title={t("Lines")}>
      {lines.map((line, index) => <div className={styles.stack} key={line.id}>
        <FormRow>
          <SelectField label={t("From")} items={sourceItems} selectedKey={line.source} onSelectionChange={(key) => set(index, { source: String(key) as LineSource, ref: "", action: String(key) === "allowance" ? "draw" : line.action === "draw" ? "add" : line.action })} />
          {line.source !== "allowance" && line.source !== "ledger" ? <SelectField label={t("Action")} items={(["add", "omit", "replace"] as const).map((item) => ({ id: item, label: t(ACTION_LABEL[item]) }))}
            selectedKey={line.action} onSelectionChange={(key) => set(index, { action: String(key) as LineAction })} /> : null}
          <IconButton aria-label={t("Remove line {number}", { number: index + 1 })} onPress={() => setLines((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></IconButton>
        </FormRow>
        {line.source !== "custom" ? <SelectField label={line.source === "ledger" ? t("Material") : line.source === "allowance" ? t("Allowance") : t("Quoted line")} items={refs(line.source)} selectedKey={line.ref || null}
          onSelectionChange={(key) => pick(index, line, String(key))} /> : null}
        <TextInput label={t("Line")} maxLength={240} value={line.title} onChange={(value) => set(index, { title: value })} />
        {line.source === "ledger" ? null : line.action === "replace" ? <MoneyField label={t("Adds (or saves, negative)")} value={line.amount} onChange={(value) => set(index, { amount: value })} />
          : <FormRow>
            <TextInput label={t("Quantity")} inputMode="decimal" value={line.quantity} onChange={(value) => set(index, { quantity: value.replace(/[^\d.]/g, "") })} />
            <TextInput label={t("Unit")} maxLength={40} value={line.unit} onChange={(value) => set(index, { unit: value })} />
            <MoneyField label={t("Unit price")} value={line.unitPrice} onChange={(value) => set(index, { unitPrice: value })} />
          </FormRow>}
      </div>)}
      <Button size="compact" onPress={() => setLines((current) => [...current, { id: crypto.randomUUID(), source: "custom", action: "add", ref: "", title: "", quantity: "", unit: "", unitPrice: "", amount: "" }])}>
        <Plus aria-hidden="true" size={14} />{t("Add line")}</Button>
    </FormSection>
  </FormDialog>;
}
