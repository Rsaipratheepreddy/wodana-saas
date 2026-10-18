"use client";

import { useState } from "react";
import { Banknote, Check, Circle, Lock, MessageSquareText, Pencil, Plus, Route, UserRound, UserRoundCheck } from "lucide-react";
import { Badge, Button, EditableFieldList, FactRow, FileUploader, FormDialog, MoneyField, ReviewDialog, SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { crmRequest, dateText } from "@/lib/crm/client";
import { flowCapabilities, proofHref, type OpportunityFlowView, type ProofReading } from "@/lib/crm/opportunity-flow";
import { amountText } from "@/lib/approvals/policies";
import { evidenceFiles, type EvidenceFile } from "@/lib/evidence/evidence";
import { EvidenceField } from "@/components/evidence/evidence-field";
import { useCrmResource } from "./crm-workbench";
import { FactCard } from "./opportunity-sections";
import styles from "./opportunity-proposals.module.css";

export type ProposalKind = "design" | "main";
export type ValueApproval = {
  id: string; version: number; step: number; steps: number; label: string; fromAmount: string | null; toAmount: string | null; currency: string | null;
  waitingFor: string[]; canDecide: boolean; via: string | null; reason: string | null;
};
export type Proposal = {
  id: string; kind: ProposalKind; amount: string | null; currencyCode: string | null; valueStatus: "empty" | "entered" | "verified" | "approved";
  enteredBy: string | null; verifiedBy: string | null; approvedAt: string | null; approvedBy: string | null; wonAt: string | null; version: number; approval: ValueApproval | null;
  /** §0.3 P0: Proposal 2 withdrawn by the client (requested, then confirmed by whoever approves deals). */
  withdrawal?: Withdrawal | null;
  /** Guide J: the quotation the value comes from (linked, never typed). */
  source?: { quoteId: string; number: number; caseId: string } | null;
};
export type Withdrawal = { status: "requested" | "confirmed"; reason: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; note: string | null;
  /** The client's message (a photo or PDF). */
  files?: EvidenceFile[] };
export type ValueEvent = { id: string; kind: ProposalKind; action: "entered" | "changed" | "verified" | "approved" | "returned" | "won"; fromAmount: string | null; toAmount: string | null; currencyCode: string | null; note: string | null; actor: string | null; at: string };
export type DealClosingView = { event: string | null; closed: boolean; closedAt: string | null; checks: Array<{ key: string; done: boolean; at: string | null }> };
export type Fulfilment = { id: string; event: "collected" | "delivered" | "installed"; receivedBy: string; note: string; recordedBy: string | null; recordedAt: string;
  /** Guide J: the delivery's photo, its proof. */ hasProof?: boolean; proofIsImage?: boolean };
export type ProposalsView = {
  proposals: Proposal[]; events: ValueEvent[]; valueHidden: boolean; can: { enter: boolean; fulfil: boolean; withdraw?: boolean; confirmWithdrawal?: boolean };
  /** The job prices its proposals with quotations: each value comes from its round's sent quotation. */
  quoted?: boolean;
  closing: DealClosingView | null; fulfilment: Fulfilment[];
};

const KIND_LABEL: Record<ProposalKind, MessageKey> = { design: tKey("Proposal 1 · Design fee"), main: tKey("Proposal 2 · Main quotation") };
const STATUS: Record<Proposal["valueStatus"], { label: MessageKey; tone: "neutral" | "info" | "success" }> = {
  empty: { label: tKey("Not entered"), tone: "neutral" }, entered: { label: tKey("With Finance"), tone: "neutral" },
  verified: { label: tKey("Verified by Finance"), tone: "info" }, approved: { label: tKey("Approved · locked"), tone: "success" },
};
const ACTION: Record<ValueEvent["action"], MessageKey> = {
  entered: tKey("entered"), changed: tKey("changed"), verified: tKey("verified"), approved: tKey("approved and locked"), returned: tKey("sent back"), won: tKey("won"),
};
const EVENT: Record<Fulfilment["event"], MessageKey> = { collected: tKey("Collected"), delivered: tKey("Delivered"), installed: tKey("Installed") };
const CLOSING: Record<string, MessageKey> = {
  collected: tKey("Closes when the client collects it"), delivered: tKey("Closes on delivery"), collected_or_delivered: tKey("Closes on collection or delivery"),
  design_handover: tKey("Closes at design handover"), all_produced_delivered_installed: tKey("Closes when everything is produced, delivered and installed"),
  completion_handover: tKey("Closes at the signed completion and handover"),
};
const CHECK: Record<string, MessageKey> = {
  collected: tKey("Collected"), delivered: tKey("Delivered"), collected_or_delivered: tKey("Collected or delivered"), installed: tKey("Installed"), produced: tKey("Produced"),
  design_approved: tKey("Design approved"), handover_accepted: tKey("Handover accepted"),
};

/** The payment proof's AI reading next to the proposal it pays, and whether the two agree (exact decimals). */
export function proofMatch(reading: Pick<ProofReading, "amount" | "currency"> | null | undefined, proposal: Pick<Proposal, "amount" | "currencyCode"> | undefined): "match" | "mismatch" | "unknown" {
  if (!reading?.amount || !proposal?.amount) return "unknown";
  if (reading.currency && proposal.currencyCode && reading.currency !== proposal.currencyCode) return "mismatch";
  const minor = (value: string) => { const [whole, fraction = ""] = value.split("."); return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(4, "0").slice(0, 4)}`; };
  return minor(reading.amount) === minor(proposal.amount) ? "match" : "mismatch";
}

/** Which proposals the opportunity shows: Proposal 1 when its flow has a design package round or when it exists; Proposal 2 always. */
export function visibleKinds(flow: Pick<OpportunityFlowView, "flow" | "capabilities"> | null, proposals: Array<Pick<Proposal, "kind">>): ProposalKind[] {
  return (flow && flowCapabilities(flow).designPackage) || proposals.some((proposal) => proposal.kind === "design") ? ["design", "main"] : ["main"];
}

/** A day as people read it (no time of day). */
const day = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

const money = (amount: string | null, currency: string | null, locale: string, t: Translate) => (amount && currency ? amountText(amount, currency, locale) : t("Not entered"));

/**
 * PLM-101 / PLM-103 / PLM-009: the value of each proposal — entered by the Account Manager or Finance, verified by
 * Finance, approved and locked by the Deal File approver (the E3 engine decides who) — with its Won date and every
 * change; a change after the lock waits for approval, showing old → new. The proof's AI reading is a proposal.
 */
export function OpportunityProposals({ workspaceId, opportunityId, flow, closed, won, open, onToggle, onChanged, onSecondProof }: {
  workspaceId: string; opportunityId: string; flow: OpportunityFlowView | null; closed: boolean; won: boolean; open: boolean; onToggle: () => void;
  onChanged?: () => Promise<void> | void; onSecondProof?: () => void;
}) {
  const t = useT();
  const { locale, currency: regionCurrency } = useDesignSystem();
  const resource = useCrmResource<ProposalsView>(workspaceId, `opportunities/${opportunityId}/proposals`);
  const [dialog, setDialog] = useState<{ kind: ProposalKind; amount: string; currency: string; note: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reviewing, setReviewing] = useState<ProposalKind | null>(null);
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Only a proposals answer counts (an older API or a stand-in answers something else).
  const view = Array.isArray(resource.data?.proposals) ? resource.data : null;
  const proposals = view?.proposals ?? [];
  const kinds = visibleKinds(flow, proposals);
  const readProof = flow?.proofs?.find((proof) => proof.reading?.amount) ?? null;
  const reading = readProof?.reading ?? null;
  const decide = async (kind: ProposalKind, decision: "approve" | "return", note = "") => {
    const proposal = proposals.find((item) => item.kind === kind);
    setBusy(`${decision}-${kind}`); setError("");
    try {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/proposals/${kind}/decide`, "POST", { decision, note: note || undefined, version: proposal?.approval?.version, commandId: crypto.randomUUID() });
      resource.refresh(); await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(null); }
  };
  const decideWithdrawal = async (decision: "confirm" | "return", note: string) => {
    await crmRequest(workspaceId, `opportunities/${opportunityId}/proposals/main/withdrawal-decision`, "POST", { decision, note: note || undefined });
    setReviewingWithdrawal(false); resource.refresh(); await onChanged?.();
  };
  const done = proposals.filter((proposal) => proposal.valueStatus === "approved").length;
  const design = proposals.find((proposal) => proposal.kind === "design");
  const main = proposals.find((proposal) => proposal.kind === "main");
  const secondWon = won && Boolean(design?.wonAt) && !main?.wonAt && !closed && !main?.withdrawal;
  // §0.3 P0: the client may withdraw from Proposal 2 once Proposal 1 is won.
  const canWithdraw = Boolean(view?.can.withdraw) && Boolean(design?.wonAt) && !main?.wonAt && !main?.withdrawal;
  // The proposal the read proof pays: the one it names, else the one it won.
  const readingKind: ProposalKind = readProof?.proposal ?? (main?.wonAt ? "main" : design?.wonAt ? "design" : kinds[0]);
  return <FactCard id="proposals" title={t("Proposals")} open={open} onToggle={onToggle} status={view ? t("{done} of {total}", { done, total: kinds.length }) : null} tone={view && done === kinds.length ? "success" : "neutral"}>
    {!view ? (resource.failure ? <p className={styles.missing}>{resource.failure}</p> : <Skeleton lines={3} shape="facts" />) : <div className={styles.body}>
      <EditableFieldList layout="stacked">
        {kinds.map((kind) => {
          const proposal = proposals.find((item) => item.kind === kind);
          const status = STATUS[proposal?.valueStatus ?? "empty"];
          const locked = proposal?.valueStatus === "approved";
          const approval = proposal?.approval ?? null;
          const canEnter = view.can.enter && !(locked && approval) && !proposal?.source;
          // Guide J: a value with its quotation says where it comes from; a quoted job without one waits for it.
          const fromQuote = proposal?.source ? <a className={styles.by} href={`/workspace/pre-projects/cases/${proposal.source.caseId}/quotations`}>{t("From Q-{number}", { number: proposal.source.number })}</a>
            : view.quoted && !proposal?.amount ? <small className={styles.by}>{t("Comes from the quotation once it is sent")}</small> : null;
          const match = proofMatch(reading, proposal);
          return <FactRow key={kind} label={t(KIND_LABEL[kind])} action={canEnter ? <Button size="compact" variant="quiet" isDisabled={busy !== null}
            onPress={() => setDialog({ kind, amount: proposal?.amount ?? "", currency: proposal?.currencyCode ?? regionCurrency, note: "" })}>
            {proposal?.amount ? <><Pencil aria-hidden="true" size={13} />{t("Change value")}</> : <><Plus aria-hidden="true" size={13} />{t("Enter value")}</>}
          </Button> : null}>
            <div className={styles.value}>
            <span className={styles.row}>
              <strong className={styles.amount}>{view.valueHidden ? t("Hidden") : proposal?.amount ? money(proposal.amount, proposal.currencyCode ?? null, locale, t) : "—"}</strong>
              {proposal?.amount ? <Badge tone={status.tone}>{locked ? <Lock aria-hidden="true" size={11} /> : null}{t(status.label)}</Badge> : null}
              {proposal?.wonAt ? <Badge tone="success">{t("Won · {date}", { date: day(proposal.wonAt, locale) })}</Badge> : null}
              {proposal?.withdrawal ? <Badge tone={proposal.withdrawal.status === "confirmed" ? "neutral" : "warning"}>{proposal.withdrawal.status === "confirmed" ? t("Withdrawn") : t("Withdrawal to confirm")}</Badge> : null}
            </span>
            {fromQuote}
            {proposal?.withdrawal ? <span className={styles.approval}>
              <small className={styles.by}>{[proposal.withdrawal.reason, proposal.withdrawal.status === "confirmed" && proposal.withdrawal.decidedBy
                ? t("Confirmed by {name} · {date}", { name: proposal.withdrawal.decidedBy, date: proposal.withdrawal.decidedAt ? day(proposal.withdrawal.decidedAt, locale) : "" })
                : proposal.withdrawal.requestedBy ? t("Recorded by {name} · {date}", { name: proposal.withdrawal.requestedBy, date: day(proposal.withdrawal.requestedAt, locale) }) : ""].filter(Boolean).join(" · ")}</small>
              {proposal.withdrawal.status === "requested" && view.can.confirmWithdrawal ? <span className={styles.actions}>
                <Button size="compact" variant="primary" onPress={() => setReviewingWithdrawal(true)}>{t("Review")}</Button>
              </span> : null}
            </span> : null}
            {locked && proposal?.approvedBy ? <small className={styles.by}>{t("Approved by {name} · {date}", { name: proposal.approvedBy, date: proposal.approvedAt ? day(proposal.approvedAt, locale) : "" })}</small> : null}
            {approval ? <span className={styles.approval}>
              {approval.fromAmount !== null && !view.valueHidden ? <span>{t("Change to approve: {from} → {to}", { from: money(approval.fromAmount, approval.currency, locale, t), to: money(approval.toAmount, approval.currency, locale, t) })}</span> : null}
              <span className={styles.by}>{approval.waitingFor.length ? t("{step} · waiting for {names}", { step: approval.label || t("Approval"), names: approval.waitingFor.join(", ") }) : approval.label}</span>
              {/* §0.3 P0: verifying or locking a value is a review of the value and its evidence, never one click. */}
              {approval.canDecide ? <span className={styles.actions}>
                <Button size="compact" variant="primary" isDisabled={busy !== null} onPress={() => setReviewing(kind)}>{t("Review")}</Button>
              </span> : null}
            </span> : null}
            {reading && !view.valueHidden && match !== "match" && kind === readingKind ? <span className={styles.reading} data-match={match}>
              <span>{t("Proof reads {amount}", { amount: [reading.currency, reading.amount].filter(Boolean).join(" ") })}{reading.date ? ` · ${day(`${reading.date}T12:00:00Z`, locale)}` : ""}{reading.reference ? ` · ${reading.reference}` : ""}</span>
              {match === "mismatch" ? <Badge tone="warning">{t("Differs from the value")}</Badge> : null}
              {canEnter && reading.amount ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind, amount: reading.amount!, currency: reading.currency ?? proposal?.currencyCode ?? regionCurrency, note: t("From the payment proof") })}>{t("Use this value")}</Button> : null}
            </span> : null}
            </div>
          </FactRow>;
        })}
      </EditableFieldList>
      {secondWon && onSecondProof || canWithdraw ? <div className={styles.actions}>
        {secondWon && onSecondProof ? <Button size="compact" onPress={onSecondProof}><Plus aria-hidden="true" size={13} />{t("Attach Proposal 2 payment proof")}</Button> : null}
        {canWithdraw ? <Button size="compact" variant="quiet" onPress={() => setWithdrawing(true)}>{t("Client withdrew from Proposal 2")}</Button> : null}
      </div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {view.events.length ? <details className={styles.history}>
        <summary>{t("Value history")}</summary>
        <ol>{view.events.slice(0, 10).map((event) => <li key={event.id}>
          <span>{t(KIND_LABEL[event.kind])} {t(ACTION[event.action])}{event.toAmount && event.currencyCode ? ` · ${event.fromAmount && event.fromAmount !== event.toAmount ? `${amountText(event.fromAmount, event.currencyCode, locale)} → ` : ""}${amountText(event.toAmount, event.currencyCode, locale)}` : ""}</span>
          <small>{[event.actor, dateText(event.at, { locale }), event.note].filter(Boolean).join(" · ")}</small>
        </li>)}</ol>
      </details> : null}
    </div>}
    {dialog ? <FormDialog title={proposals.find((item) => item.kind === dialog.kind)?.amount ? t("Change value") : t("Enter value")} description={t(KIND_LABEL[dialog.kind])} submitLabel={t("Save")}
      isDirty={Boolean(dialog.amount)} isSubmitDisabled={!dialog.amount} onClose={() => setDialog(null)} onSubmit={async () => {
        await crmRequest(workspaceId, `opportunities/${opportunityId}/proposals/${dialog.kind}/value`, "PUT",
          { amount: dialog.amount, currencyCode: dialog.currency, note: dialog.note || undefined, version: proposals.find((item) => item.kind === dialog.kind)?.version });
        setDialog(null); resource.refresh(); await onChanged?.();
      }}>
      <MoneyField autoFocus isRequired label={t("Value")} currency={dialog.currency} value={dialog.amount} onChange={(amount) => setDialog({ ...dialog, amount })} />
      <TextAreaField label={t("Note")} value={dialog.note} onChange={(note) => setDialog({ ...dialog, note })} maxLength={1000} />
    </FormDialog> : null}
    {withdrawing ? <WithdrawDialog workspaceId={workspaceId} onClose={() => setWithdrawing(false)} onSave={async (reason, evidenceFileIds) => {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/proposals/main/withdrawal`, "POST", { reason, evidenceFileIds });
      setWithdrawing(false); resource.refresh(); await onChanged?.();
    }} /> : null}
    {reviewingWithdrawal && main?.withdrawal ? <ReviewDialog title={t("Review the withdrawal")} description={t(KIND_LABEL.main)} confirmLabel={t("Confirm withdrawal")}
      facts={[{ icon: <MessageSquareText />, label: t("Reason"), value: main.withdrawal.reason }, { icon: <UserRound />, label: t("Recorded by"), value: [main.withdrawal.requestedBy, day(main.withdrawal.requestedAt, locale)].filter(Boolean).join(" · ") }]}
      files={evidenceFiles(workspaceId, main.withdrawal.files)}
      onClose={() => setReviewingWithdrawal(false)}
      onConfirm={async (note) => { await decideWithdrawal("confirm", note); }} onReturn={async (note) => { await decideWithdrawal("return", note); }} /> : null}
    {reviewing ? (() => {
      const proposal = proposals.find((item) => item.kind === reviewing);
      const approval = proposal?.approval;
      if (!proposal || !approval) return null;
      const lock = approval.step >= approval.steps;
      const match = proofMatch(reading, proposal);
      return <ReviewDialog title={lock ? t("Approve and lock") : t("Verify")} description={t(KIND_LABEL[reviewing])} confirmLabel={lock ? t("Approve and lock") : t("Verify")}
        onClose={() => setReviewing(null)}
        facts={[
          { icon: <Banknote />, label: t("Value"), value: view?.valueHidden ? t("Hidden") : approval.fromAmount !== null && approval.fromAmount !== approval.toAmount
            ? t("Change to approve: {from} → {to}", { from: money(approval.fromAmount, approval.currency, locale, t), to: money(approval.toAmount, approval.currency, locale, t) })
            : money(proposal.amount, proposal.currencyCode, locale, t) },
          ...(proposal.enteredBy ? [{ icon: <UserRound />, label: t("Entered by"), value: proposal.enteredBy }] : []),
          ...(proposal.verifiedBy ? [{ icon: <UserRoundCheck />, label: t("Verified by"), value: proposal.verifiedBy }] : []),
          { icon: <Route />, label: t("Step"), value: approval.label || t("Approval") },
        ]}
        // §0.3 P0: the payment proof behind the value, beside the decision.
        files={(flow?.proofs ?? []).filter((proof) => !proof.proposal || proof.proposal === reviewing).map((proof) => ({ id: proof.id, name: proof.fileName,
          href: proofHref(workspaceId, opportunityId, proof.id), previewHref: proof.hasPreview ? `${proofHref(workspaceId, opportunityId, proof.id)}&preview=1` : null }))}
        evidence={reading && !view?.valueHidden ? <p className={styles.reading} data-match={match}>
          {t("Proof reads {amount}", { amount: [reading.currency, reading.amount].filter(Boolean).join(" ") })}{reading.date ? ` · ${day(`${reading.date}T12:00:00Z`, locale)}` : ""}{reading.reference ? ` · ${reading.reference}` : ""}
          {match === "mismatch" ? <> <Badge tone="warning">{t("Differs from the value")}</Badge></> : null}
        </p> : undefined}
        onConfirm={async (note) => { await decide(reviewing, "approve", note); setReviewing(null); }}
        onReturn={async (note) => { await decide(reviewing, "return", note); setReviewing(null); }} />;
    })() : null}
  </FactCard>;
}

/** §0.3 P0: the account manager records that the client withdrew from Proposal 2, with the reason. */
function WithdrawDialog({ workspaceId, onClose, onSave }: { workspaceId: string; onClose: () => void; onSave: (reason: string, evidenceFileIds: string[]) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  return <FormDialog size="md" title={t("Client withdrew from Proposal 2")} submitLabel={t("Send for confirmation")} isDirty={Boolean(reason.trim() || files.length)}
    isSubmitDisabled={!reason.trim() || !files.length || uploading} onClose={onClose} onSubmit={() => onSave(reason.trim(), files.map((file) => file.id))}>
    <TextAreaField autoFocus isRequired label={t("Reason")} value={reason} onChange={setReason} maxLength={500} />
    <EvidenceField workspaceId={workspaceId} kind="proposal_withdrawal" isRequired label={t("The client's message")} value={files} onChange={setFiles} onBusy={setUploading} />
  </FormDialog>;
}



/**
 * PLM-102: when the deal closes. The event comes from the enquiry type (Settings); Deal Closed is read from the
 * records — collection, delivery and installation recorded here, design approval, production, the handover.
 */
export function OpportunityClosing({ workspaceId, opportunityId, won, open, onToggle }: { workspaceId: string; opportunityId: string; won: boolean; open: boolean; onToggle: () => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const resource = useCrmResource<ProposalsView>(workspaceId, `opportunities/${opportunityId}/proposals`);
  const [recording, setRecording] = useState(false);
  const view = Array.isArray(resource.data?.proposals) ? resource.data : null;
  const closing = view?.closing ?? null;
  if (!view) return null;
  return <FactCard id="closing" title={t("Deal closed")} open={open} onToggle={onToggle} status={closing?.closed ? t("Closed") : closing?.event ? t("Open") : null} tone={closing?.closed ? "success" : "neutral"}
    action={won && view.can.fulfil && closing?.event && !closing.closed ? <Button size="compact" variant="quiet" onPress={() => setRecording(true)}><Plus aria-hidden="true" size={13} />{t("Record handover")}</Button> : null}>
    <div className={styles.body}>
      <p className={styles.closing}>{closing?.closed && closing.closedAt ? t("Deal closed · {date}", { date: dateText(closing.closedAt, { locale }) })
        : closing?.event ? t(CLOSING[closing.event] ?? tKey("Deal closed")) : t("No closing event for this enquiry type")}</p>
      {closing?.checks.length ? <ul className={styles.checks}>{closing.checks.map((item) => <li key={item.key} data-done={item.done || undefined}>
        {item.done ? <Check aria-hidden="true" size={13} /> : <Circle aria-hidden="true" size={13} />}{t(CHECK[item.key] ?? tKey("Deal closed"))}
      </li>)}</ul> : null}
      {view.fulfilment.length ? <ol className={styles.fulfilment}>{view.fulfilment.map((item) => <li key={item.id}>
        <span>{t(EVENT[item.event])} · {item.receivedBy}</span>
        <small>{[item.recordedBy, dateText(item.recordedAt, { locale }), item.note].filter(Boolean).join(" · ")}</small>
        {item.hasProof ? <a className={styles.by} href={`/api/workspace/crm/deal-fulfilment/${opportunityId}/${item.id}?workspaceId=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">{t("Proof of delivery")}</a> : null}
      </li>)}</ol> : null}
    </div>
    {recording ? <FulfilmentDialog event={closing?.event ?? "delivered"} onClose={() => setRecording(false)} onSave={async (input) => {
      const body = new FormData();
      body.set("event", input.event); body.set("receivedBy", input.receivedBy); body.set("commandId", crypto.randomUUID());
      if (input.note) body.set("note", input.note);
      if (input.file) body.set("file", input.file);
      const response = await fetch(`/api/workspace/crm/deal-fulfilment/${opportunityId}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", body });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? t("The handover could not be recorded."));
      setRecording(false); resource.refresh();
    }} /> : null}
  </FactCard>;
}

function FulfilmentDialog({ event, onClose, onSave }: { event: string; onClose: () => void; onSave: (input: { event: string; receivedBy: string; note?: string; file?: File }) => Promise<void> }) {
  const t = useT();
  const [kind, setKind] = useState<Fulfilment["event"]>(event === "collected" ? "collected" : "delivered");
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Guide J: a delivery or an installation needs its photo; a collection at the counter doesn't.
  const needsProof = kind !== "collected";
  const options = (event === "all_produced_delivered_installed" ? ["delivered", "installed"] : event === "collected_or_delivered" ? ["collected", "delivered"]
    : event === "collected" ? ["collected"] : ["delivered", "installed"]) as Fulfilment["event"][];
  return <FormDialog size="md" title={t("Record handover")} submitLabel={t("Save")} isDirty={Boolean(receivedBy.trim() || file)} isSubmitDisabled={!receivedBy.trim() || (needsProof && !file)} onClose={onClose}
    onSubmit={() => onSave({ event: kind, receivedBy: receivedBy.trim(), note: note.trim() || undefined, file: file ?? undefined })}>
    <SelectField isRequired label={t("What happened")} selectedKey={kind} onSelectionChange={(key) => setKind(key as Fulfilment["event"])} items={options.map((id) => ({ id, label: t(EVENT[id]) }))} />
    <TextInput autoFocus isRequired label={t("Received by")} value={receivedBy} onChange={setReceivedBy} maxLength={200} />
    {needsProof ? <FileUploader label={file ? file.name : t("Proof of delivery")} accept="image/*,application/pdf" multiple={false} onFiles={(files) => setFile(files[0] ?? null)} /> : null}
    <TextAreaField label={t("Note")} value={note} onChange={setNote} maxLength={1000} />
  </FormDialog>;
}
