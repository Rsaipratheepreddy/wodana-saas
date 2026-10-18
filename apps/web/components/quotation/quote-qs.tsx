"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, FormDialog, FormNotSaved, ReasonDialog, SelectField, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { proposalApi, type QsReason, type QsState } from "@/lib/proposals/client";
import styles from "./quote-builder.module.css";

/** The quote's QS step, reloaded whenever the quote changes (a price change makes a confirmation stale). */
export function useQs(workspaceId: string, caseId: string, quoteId: string, revision: number, kind: string) {
  const [qs, setQs] = useState<QsState | null>(null);
  const load = useCallback(async () => {
    if (kind !== "quotation" && kind !== "variation") return;
    try { setQs(await proposalApi(workspaceId, caseId).qs(quoteId)); } catch { setQs(null); }
  }, [workspaceId, caseId, quoteId, kind]);
  useEffect(() => { void load(); }, [load, revision]);
  return { qs, setQs, reload: load };
}

/** The catalogue kinds a firm can mark for QS review, named as in the catalogue. */
export const qsItemTypeLabels = (t: Translate): Record<string, string> => ({
  product: t("Product"), material: t("Material"), assembly: t("Assembly"), service: t("Service"), package: t("Package"), ready_made: t("Ready-made"),
});

/** Why the QS step is there or not, where the firm's QS rules decided it ("QS review: needed because of joinery lines"). */
export function qsReasonText(reason: QsReason | undefined, t: Translate): string | null {
  if (!reason) return null;
  if (reason.code === "lines") {
    const kinds = qsItemTypeLabels(t);
    const names = [...reason.workPackages, ...reason.itemTypes.map((type) => kinds[type] ?? type)].join(", ");
    return t("QS review: needed because of {names} lines", { names });
  }
  if (reason.code === "boq_required") return t("QS review: needed because this order needs a BOQ");
  if (reason.code === "design_fee") return t("QS review: not needed for a Design Fee proposal");
  if (reason.code === "standard_only") return t("QS review: not needed for standard items");
  if (reason.code === "no_boq") return t("QS review: not needed, this order needs no BOQ");
  if (reason.code === "variation_amount") return t("QS review: needed for a variation this size");
  return null;
}

/** Whether the QS step holds sending back: required and not confirmed at the current pricing. */
export const qsBlocks = (qs: QsState | null) => Boolean(qs?.required && qs.stage !== "confirmed");

/**
 * PLM-082/084, in the quote's header: Sales sends the quotation to a named QS ("With QS"); the QS confirms the
 * pricing or returns it with a note. Sending to the client waits until the QS has confirmed the current pricing.
 */
export function QsActions({ workspaceId, caseId, quoteId, qs, onChanged, onError }: {
  workspaceId: string; caseId: string; quoteId: string; qs: QsState; onChanged: (next: QsState) => Promise<void> | void; onError: (message: string) => void;
}) {
  const t = useT();
  const api = proposalApi(workspaceId, caseId);
  const [sending, setSending] = useState(false);
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const why = qsReasonText(qs.reason, t);
  const reason = why ? <span className={styles.waiting}>{why}</span> : null;
  // Not needed: one quiet chip in the header; the firm's rule that decided it is its tooltip.
  if (!qs.required && !qs.review) return why ? <Badge title={why}>{t("No QS review")}</Badge> : null;
  const holder = qs.review?.assigneeName ?? t("the QS");
  const confirm = async () => {
    setBusy(true); onError("");
    try { await onChanged(await api.decideQs(quoteId, { decision: "confirm", version: qs.review!.version, commandId: crypto.randomUUID() })); }
    catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  let content: React.ReactNode = null;
  if (qs.stage === "with_qs") {
    content = <>
      <Badge tone="info">{t("With QS · {name}", { name: holder })}</Badge>
      {qs.canDecide ? <>
        <Button size="compact" onPress={() => setReturning(true)}>{t("Return")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => void confirm()}>{t("Confirm pricing")}</Button>
      </> : null}
    </>;
  } else if (qs.stage === "confirmed" && qs.review) {
    content = <Badge tone="success">{t("Priced by {name}", { name: qs.review.decidedByName ?? holder })}</Badge>;
  } else if (["to_send", "returned", "stale"].includes(qs.stage)) {
    content = <>
      {qs.stage === "returned" ? <Badge tone="warning">{t("Returned by QS")}</Badge> : qs.stage === "stale" ? <Badge tone="warning">{t("Pricing changed since the QS confirmed")}</Badge> : null}
      {qs.canSend ? <Button size="compact" variant="primary" onPress={() => setSending(true)}>{t("Send to QS")}</Button> : <span className={styles.waiting}>{t("Waiting for QS pricing")}</span>}
    </>;
  }
  return <>
    {qs.stage === "confirmed" ? null : reason}
    {content}
    {sending ? <SendToQsDialog people={qs.people} current={qs.review?.status === "with_qs" ? qs.review.assigneeUserId : null} onClose={() => setSending(false)}
      onSend={async (assignee, note) => {
        try { await onChanged(await api.sendToQs(quoteId, assignee, note)); setSending(false); }
        catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); throw new FormNotSaved(); }
      }} /> : null}
    {returning ? <ReturnToSalesDialog onClose={() => setReturning(false)} onReturn={async (note) => {
      try { await onChanged(await api.decideQs(quoteId, { decision: "return", note, version: qs.review!.version, commandId: crypto.randomUUID() })); setReturning(false); }
      catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); throw new FormNotSaved(); }
    }} /> : null}
  </>;
}

function SendToQsDialog({ people, current, onClose, onSend }: { people: QsState["people"]; current: string | null; onClose: () => void; onSend: (assignee: string, note: string) => Promise<void> }) {
  const t = useT();
  const [assignee, setAssignee] = useState<string | null>(current ?? (people.length === 1 ? people[0].userId : null));
  const [note, setNote] = useState("");
  return <FormDialog title={t("Send to QS")} onClose={onClose} submitLabel={t("Send")} isDirty={Boolean(assignee || note.trim())} isSubmitDisabled={!assignee}
    onSubmit={() => onSend(assignee!, note.trim())}>
    <SelectField label={t("QS")} isRequired placeholder={people.length ? t("Choose") : t("Nobody prices quotations yet")} selectedKey={assignee}
      onSelectionChange={(key) => setAssignee(key ? String(key) : null)} items={people.map((person) => ({ id: person.userId, label: person.name }))} />
    <TextAreaField label={t("Note for the QS")} maxLength={2000} value={note} onChange={setNote} />
  </FormDialog>;
}

function ReturnToSalesDialog({ onClose, onReturn }: { onClose: () => void; onReturn: (note: string) => Promise<void> }) {
  const t = useT();
  return <ReasonDialog title={t("Return for changes")} label={t("What needs to change")} confirmLabel={t("Return")} maxLength={2000} onClose={onClose} onConfirm={onReturn} />;
}
