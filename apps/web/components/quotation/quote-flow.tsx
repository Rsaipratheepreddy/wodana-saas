"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, IconButton, InlineNotice, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { StartProjectDialog } from "@/components/project-core/start-project-dialog";
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
export function FlowActions({ state, api, workspaceId, caseId, onDone, onError, onRevision }: {
  state: BuilderState; api: Api; workspaceId: string; caseId: string;
  onDone: () => Promise<unknown>; onError: (message: string) => void; onRevision: (quoteId: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [starting, setStarting] = useState(false);
  const { status } = state.quote;
  const { flow } = state;
  const run = async (label: string, steps: Array<[string, Record<string, unknown>?]>) => {
    setBusy(label); onError("");
    try {
      let revision = state.quote.revision;
      let created: string | null = null;
      for (const [action, extra] of steps) {
        const result = await api.step(action, revision, extra);
        revision = result.data.revision;
        if (action === "revise") created = [...result.data.quotes].sort((a, b) => b.number - a.number)[0]?.id ?? null;
      }
      if (created) onRevision(created); else await onDone();
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); await onDone(); }
    finally { setBusy(null); }
  };
  const newRevision = <Button size="compact" isLoading={busy === "revise"} onPress={() => void run("revise", [["revise"]])}>{t("New revision")}</Button>;
  let actions: React.ReactNode = null;
  if (status === "draft" && state.canEdit) {
    const direct = !flow.internalReview && flow.canReview;
    actions = <Button size="compact" variant="primary" isLoading={Boolean(busy)} isDisabled={!state.lines.length}
      onPress={() => void run("send", direct ? [["submit"], [flow.reviewAction], ["issue"]] : [["submit"]])}>{direct ? t("Send to client") : t("Send for review")}</Button>;
  } else if (status === "internal_review") {
    actions = flow.canReview ? <>
      <Button size="compact" isLoading={busy === "return"} onPress={() => void run("return", [["return"]])}>{t("Return")}</Button>
      <Button size="compact" variant="primary" isLoading={busy === "approve"} onPress={() => void run("approve", [[flow.reviewAction]])}>{t("Approve")}</Button>
    </> : <span className={styles.waiting}>{t("Waiting for review")}</span>;
  } else if (status === "internal_approved") {
    actions = <>
      {flow.canReview ? <Button size="compact" isLoading={busy === "return"} onPress={() => void run("return", [["return"]])}>{t("Return")}</Button> : null}
      <Button size="compact" variant="primary" isLoading={busy === "issue"} onPress={() => void run("issue", [["issue"]])}>{t("Send to client")}</Button>
    </>;
  } else if (status === "issued") {
    actions = <>
      {newRevision}
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
    {starting ? <StartProjectDialog workspaceId={workspaceId} caseId={caseId} onClose={() => setStarting(false)} /> : null}
    {deciding ? <DecisionDialog state={state} onClose={() => setDeciding(false)}
      onSave={async (input) => { await run("decide", [["record_decision", input]]); setDeciding(false); }} busy={busy === "decide"} /> : null}
  </>;
}

const METHODS = [["signed_document", "Signed copy"], ["email", "Email"], ["in_person", "In person"], ["phone", "Phone"], ["message", "Message"]] as const;

function DecisionDialog({ state, onClose, onSave, busy }: { state: BuilderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [decision, setDecision] = useState("accept");
  const [method, setMethod] = useState("signed_document");
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const optional = state.lines.filter((line) => line.optional);
  const priced = new Map(state.pricing.lines.map((line) => [line.id, line.total]));
  return <ControlledModalDialog isOpen size="md" title={t("Record client decision")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!clientName.trim() || (decision !== "accept" && !note.trim())}
        onPress={() => void onSave({ decision, method, clientName: clientName.trim(), note: note.trim(), selectedOptionLineIds: decision === "accept" ? options : [] })}>{t("Save")}</Button></div>}>
    <div className={styles.dialogForm}>
      <div className={styles.pair}>
        <SelectField label={t("Decision")} selectedKey={decision} onSelectionChange={(key) => setDecision(String(key))}
          items={[{ id: "accept", label: t("Accepted") }, { id: "changes", label: t("Wants changes") }, { id: "decline", label: t("Declined") }]} />
        <SelectField label={t("How")} selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} items={METHODS.map(([id, label]) => ({ id, label: t(label as never) }))} />
      </div>
      <TextInput label={t("Decided by")} isRequired value={clientName} onChange={setClientName} />
      {decision === "accept" && optional.length ? <fieldset className={styles.options}>
        <legend>{t("Options the client chose")}</legend>
        {optional.map((line) => <Checkbox key={line.id} isSelected={options.includes(line.id)} onChange={(on) => setOptions((current) => on ? [...current, line.id] : current.filter((id) => id !== line.id))}>
          {line.title} · {money(priced.get(line.id) ?? null, state.quote.currency, state.quote.decimals, locale)}
        </Checkbox>)}
      </fieldset> : null}
      <TextAreaField label={decision === "accept" ? t("Note · optional") : t("What they asked for")} isRequired={decision !== "accept"} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

/** Payment milestones in the totals panel: each one's share of the total, edited in a dialog. */
export function PaymentsPanel({ state, api, onState, onError }: { state: BuilderState; api: Api; onState: (state: BuilderState) => void; onError: (message: string) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [editing, setEditing] = useState(false);
  const terms = state.quote.paymentTerms;
  const total = Number(state.pricing.total);
  return <section className={styles.payments} aria-label={t("Payments")}>
    <div className={styles.paymentsHead}>
      <h3>{t("Payments")}</h3>
      {state.canEdit ? <IconButton aria-label={t("Edit payments")} size="compact" variant="quiet" onPress={() => setEditing(true)}><Pencil aria-hidden="true" size={13} /></IconButton> : null}
    </div>
    {terms.length ? <ol>{terms.map((term) => <li key={term.id}>
      <span><strong>{plain(term.percent, locale, 2)}%</strong> {term.title}<small>{term.trigger}</small></span>
      <span>{money((total * term.percent) / 100, state.quote.currency, state.quote.decimals, locale)}</span>
    </li>)}</ol> : <p className={styles.mutedText}>{state.canEdit ? t("Add the payment milestones before sending.") : t("No payment milestones.")}</p>}
    {editing ? <PaymentsDialog state={state} onClose={() => setEditing(false)} onSave={async (next) => {
      try { onState(await api.paymentTerms(next)); setEditing(false); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    }} /> : null}
  </section>;
}

function PaymentsDialog({ state, onClose, onSave }: { state: BuilderState; onClose: () => void; onSave: (terms: PaymentMilestone[]) => Promise<void> }) {
  const t = useT();
  const [rows, setRows] = useState<Array<PaymentMilestone & { text: string }>>(() => state.quote.paymentTerms.map((term) => ({ ...term, text: String(term.percent) })));
  const [busy, setBusy] = useState(false);
  const sum = rows.reduce((acc, row) => acc + (Number(row.text) || 0), 0);
  const update = (id: string, patch: Partial<PaymentMilestone & { text: string }>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const valid = rows.length > 0 && Math.abs(sum - 100) < 0.001 && rows.every((row) => row.title.trim() && row.trigger.trim() && Number(row.text) > 0);
  return <ControlledModalDialog isOpen size="lg" title={t("Payments")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}>
      <span className={styles.mutedText} data-alert={Math.abs(sum - 100) >= 0.001 || undefined}>{t("Total {percent}%", { percent: Math.round(sum * 100) / 100 })}</span>
      <span className={styles.spacer} />
      <Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true); await onSave(rows.map(({ text, ...row }) => ({ ...row, percent: Number(text) }))); setBusy(false); }}>{t("Save")}</Button>
    </div>}>
    <div className={styles.dialogForm}>
      {state.paymentTemplates.length ? <SelectField label={t("Start from a template")} placeholder={t("Choose a template")} selectedKey={null}
        onSelectionChange={(key) => { const template = state.paymentTemplates.find((item) => item.id === key); if (template) setRows(template.milestones.map((term) => ({ ...term, id: crypto.randomUUID(), text: String(term.percent) }))); }}
        items={state.paymentTemplates.map((template) => ({ id: template.id, label: template.name }))} /> : null}
      <table className={styles.milestones}>
        <thead><tr><th>{t("Milestone")}</th><th>{t("%")}</th><th>{t("When")}</th><th>{t("Before the project starts")}</th><th><span className={styles.srOnly}>{t("Remove")}</span></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td><input aria-label={t("Milestone")} value={row.title} onChange={(event) => update(row.id, { title: event.target.value })} placeholder={t("Advance")} /></td>
          <td><input aria-label={t("%")} inputMode="decimal" value={row.text} onChange={(event) => update(row.id, { text: event.target.value.replace(/[^\d.]/g, "") })} /></td>
          <td><input aria-label={t("When")} value={row.trigger} onChange={(event) => update(row.id, { trigger: event.target.value })} placeholder={t("On acceptance")} /></td>
          <td><Checkbox aria-label={t("Before the project starts")} isSelected={row.requiredForRelease} onChange={(value) => update(row.id, { requiredForRelease: value })} /></td>
          <td><IconButton aria-label={t("Remove {name}", { name: row.title })} size="compact" variant="quiet" onPress={() => setRows((current) => current.filter((item) => item.id !== row.id))}><Trash2 aria-hidden="true" size={14} /></IconButton></td>
        </tr>)}</tbody>
      </table>
      <Button size="compact" variant="quiet" onPress={() => setRows((current) => [...current, { id: crypto.randomUUID(), title: "", percent: 0, text: String(Math.max(0, Math.round((100 - sum) * 100) / 100)), trigger: "", requiredForRelease: current.length === 0 }])}><Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button>
      {rows.length && !rows.some((row) => row.requiredForRelease) ? <InlineNotice tone="info" message={t("Mark at least one milestone to be paid before the project starts.")} /> : null}
    </div>
  </ControlledModalDialog>;
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
