"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { ClientCredits } from "./client-credits";
import { PaymentInvoice } from "./payment-invoice";
import { AgreementFiles } from "./agreement-files";
import { useEffect, useState } from "react";
import { parseDate } from "@internationalized/date";
import Link from "next/link";
import Image from "next/image";
import { Check, Circle, Plus, X } from "lucide-react";
import {
  Button,
  Checkbox,
  DataGrid,
  DateField,
  EditableField,
  EditableFieldList,
  EmptyState,
  FileUploader,
  Form,
  FormDialog,
  FormNotSaved,
  FormRow,
  FormSection,
  IconButton,
  MoneyField,
  MoreDetails,
  NumericInput,
  PercentageInput,
  PillTabs,
  SelectField,
  TextAreaField,
  TextInput,
  useDesignSystem,
} from "@/design-system";
import { acceptedQuoteTotals, acceptedQuoteValue, money, statusLabel } from "@/lib/commercial/client";
import { smallestAmount } from "@/lib/money-exact";
import {
  activeDeliveryQuote,
  agreementIsOperational,
  agreementMatchesAcceptedQuote,
  commercialReleaseInputsReady,
  financeGatePaymentsReady,
  materialApprovalsComplete,
  palmMaterialListSignedOff,
} from "@/lib/commercial/release";
import type { CommercialState, ChangeRequest, ControlledChangeKind, MaterialApproval } from "@/lib/commercial/types";
import { availableContractLines, changeKinds } from "@/lib/commercial/change-cases";
import { decisionPolicySummary } from "@/lib/commercial/decision-requests";
import { ControlledChangeCase } from "./controlled-change-case";
import { ClientReportCell, ClientReportDialog, useClientPaymentReports } from "./client-payment-reports";
import { ClientFiles } from "@/components/client-activity/client-files";
import { SeenByClient, useClientThreads } from "@/components/client-activity/client-threads";
import s from "./commercial.module.css";
import tableStyles from "../workspace/workspace.module.css";
type Props = {
  state: CommercialState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error?: string;
};
/** A commission line as it is typed: the value is exact decimal text until it is sent. */
type CommissionDraft = { recipientName: string; type: "sales" | "designer" | "referral"; basis: "amount" | "percent"; value: string };
type CommissionLine = { recipientName: string; type: CommissionDraft["type"]; basis: CommissionDraft["basis"]; value: number };
const newCommissionLine = (): CommissionDraft => ({ recipientName: "", type: "sales", basis: "amount", value: "" });
const draftOf = ({ recipientName, type, basis, value }: CommissionLine): CommissionDraft => ({ recipientName, type, basis, value: value ? String(value) : "" });
const sent = (line: CommissionDraft): CommissionLine => ({ ...line, value: Number(line.value || 0) });
const commissionReady = (line: CommissionDraft) => Boolean(line.recipientName.trim()) && Number(line.value || 0) > 0;
const commissionTypes = [
  { id: "sales", label: tKey("Sales") },
  { id: "designer", label: tKey("Designer") },
  { id: "referral", label: tKey("Referral") },
] as const;
const checklistLabel: Record<string, string> = {
  agreement: tKey("Agreement"),
  boq: tKey("BOQ"),
  documents: tKey("Documents"),
  margin: tKey("Margin"),
  materials: tKey("Materials"),
  payment: tKey("Payment"),
};
const requestStatuses = ["open", "under_review", "awaiting_decision", "resolved", "declined", "withdrawn"] as const;
const dateValue = (value: string) => { try { return value ? parseDate(value.slice(0, 10)) : null; } catch { return null; } };
const blankDecision = { title: "", detail: "", targetKey: "", dueDate: "", firstChoice: "Approve", secondChoice: "Request changes", remindersEnabled: true, email: false, whatsapp: false, escalationMinutes: 1440 };
const blankChange = { kind: "addition" as ControlledChangeKind, sourceLineIds: [] as string[], title: "", detail: "", owner: "", dueDate: "" };

/** `openRequestId` (from a notification's link) opens that request's thread as the page loads. */
export function CommercialRequests({ state, run, busy, error, openRequestId }: Props & { openRequestId?: string }) {
  const t = useT();
  const opened = openRequestId ? state.data.requests.find((r) => r.id === openRequestId) : undefined;
  const [selected, setSelected] = useState(opened?.id ?? ""),
    [create, setCreate] = useState(false),
    [createDecision, setCreateDecision] = useState(false),
    [draft, setDraft] = useState({ title: "", detail: "" }),
    [decisionDraft, setDecisionDraft] = useState(blankDecision),
    [changeDraft, setChangeDraft] = useState(blankChange),
    [comment, setComment] = useState(""),
    [internal, setInternal] = useState(false);
  const request = state.data.requests.find((r) => r.id === selected);
  const accepted = state.data.quotes.some((quote) => quote.kind === "quotation" && quote.status === "accepted");
  // The client's files on each conversation, and whether they've read the team's replies; opening a thread tells them it was seen.
  const threads = useClientThreads(state.workspaceId, state.caseId);
  const { markRead } = threads;
  const conversation = request && !request.decisionRequest ? request.id : null;
  useEffect(() => { if (conversation) markRead(conversation); }, [conversation, markRead]);
  const fromClient = (comment: ChangeRequest["comments"][number]) => Boolean((comment as { fromClient?: boolean }).fromClient);
  const lastReplyAt = request?.comments.filter((comment) => comment.visibility === "client" && !fromClient(comment)).map((comment) => comment.at).sort().at(-1) ?? null;
  const contractLines = availableContractLines(state.data);
  const decisionTargets = [
    ...state.data.quotes.filter((quote) => Boolean(quote.issuedAt) && Boolean(quote.approverId) && !["superseded", "withdrawn"].includes(quote.status)).map((quote) => ({ id: `quotation:${quote.id}:${quote.number}`, label: t("Quotation V{number}", { number: quote.number }) })),
    ...(state.data.materialApprovals ?? []).filter((material) => material.status === "client_review" && Boolean(material.approverId)).map((material) => ({ id: `material:${material.id}:${material.revision}`, label: t("{name} · Revision {revision}", { name: material.name, revision: material.revision }) })),
  ];
  const linesRequired = accepted && ["removal", "replacement"].includes(changeDraft.kind);
  const newTitle = accepted ? t("New change request") : t("New request");
  // One field of the request changes; the others are sent as they are.
  const saveRequest = async (changes: Partial<Pick<ChangeRequest, "owner" | "dueDate" | "status" | "resolution">>) => {
    if (!request) return;
    const saved = await run("update_request", { requestId: request.id, owner: request.owner, dueDate: request.dueDate, status: request.status, resolution: request.resolution, ...changes });
    if (!saved) throw new FormNotSaved();
  };
  return (
    <>
      <div className={s.toolbar}>
        <span className={s.muted}>
          {t("{count} open requests", { count: state.data.requests.filter((r) => !["resolved", "withdrawn", "declined"].includes(r.status)).length })}
        </span>
        {state.canEdit && <div className={s.actions}>{decisionTargets.length > 0 && <Button size="compact" onPress={() => setCreateDecision(true)}>{t("Request client decision")}</Button>}<Button size="compact" variant="primary" onPress={() => setCreate(true)}><Plus size={15} />{newTitle}</Button></div>}
      </div>
      {!state.data.requests.length ? (
        <EmptyState title={t("No change requests yet")} description={t("Client changes and your team’s clarifications appear here, each with an owner and a resolution.")} />
      ) : (
        <div className={tableStyles.recordTablePanel}><DataGrid selectable={false} compactToolbar ariaLabel={t("Change requests")} data={state.data.requests} getRowId={row => row.id} searchLabel={t("Search change requests")} exportFileName="change-requests.csv" onRowAction={r => setSelected(r.id)} columns={[
          { id: "title", header: t("Request"), size: 320, accessorFn: (r) => `CR-${String(r.number).padStart(3, "0")} ${r.title}`, cell: ({ row: { original: r } }) => <button type="button" className={s.requestButton} onClick={() => setSelected(r.id)}><span className={s.muted}>{t("CR-")}{String(r.number).padStart(3, "0")} · </span>{r.title}</button> },
          { id: "owner", header: t("Owner"), size: 180, accessorFn: (r) => r.owner || t("Unassigned"), cell: ({ row: { original: r } }) => <>{r.owner || t("Unassigned")}</> },
          { id: "due", header: t("Due"), size: 140, accessorFn: (r) => r.dueDate, cell: ({ row: { original: r } }) => <>{r.dueDate || "—"}</> },
          { id: "status", header: t("Status"), size: 160, accessorFn: (r) => translateKnown(t, statusLabel[r.status] ?? r.status), cell: ({ row: { original: r } }) => <span className={s.status} data-status={r.status}>{translateKnown(t, statusLabel[r.status] ?? r.status)}</span> },
        ]} /></div>
      )}
      <FormDialog
        isOpen={createDecision}
        onClose={() => setCreateDecision(false)}
        title={t("Request a client decision")}
        size="lg"
        error={error || undefined}
        isSubmitting={busy}
        isDirty={Boolean(decisionDraft.title || decisionDraft.detail || decisionDraft.targetKey)}
        submitLabel={t("Send decision request")}
        onSubmit={async () => {
          const [targetType, targetId, revision] = decisionDraft.targetKey.split(":");
          const saved = await run("request", {
            decisionRequest: true,
            title: decisionDraft.title,
            detail: decisionDraft.detail,
            targetType,
            targetId,
            targetRevision: Number(revision),
            dueDate: decisionDraft.dueDate,
            allowedChoices: [decisionDraft.firstChoice, decisionDraft.secondChoice],
            remindersEnabled: decisionDraft.remindersEnabled,
            reminderChannels: ["in_app", ...(decisionDraft.email ? ["email"] : []), ...(decisionDraft.whatsapp ? ["whatsapp"] : [])],
            escalationMinutes: decisionDraft.escalationMinutes,
          });
          if (!saved) throw new FormNotSaved();
          setCreateDecision(false);
          setDecisionDraft(blankDecision);
        }}
      >
        <TextInput label={t("Question")} isRequired maxLength={160} value={decisionDraft.title} onChange={(title) => setDecisionDraft({ ...decisionDraft, title })} />
        <TextAreaField label={t("What does the client need to decide?")} isRequired value={decisionDraft.detail} onChange={(detail) => setDecisionDraft({ ...decisionDraft, detail })} />
        <SelectField label={t("Exact revision")} isRequired items={decisionTargets} selectedKey={decisionDraft.targetKey || null} onSelectionChange={(key) => setDecisionDraft({ ...decisionDraft, targetKey: String(key ?? "") })} />
        <DateField label={t("Due date")} isRequired value={dateValue(decisionDraft.dueDate)} onChange={(date) => setDecisionDraft({ ...decisionDraft, dueDate: date?.toString() ?? "" })} />
        <FormRow>
          <TextInput label={t("First choice")} isRequired value={decisionDraft.firstChoice} onChange={(firstChoice) => setDecisionDraft({ ...decisionDraft, firstChoice })} />
          <TextInput label={t("Second choice")} isRequired value={decisionDraft.secondChoice} onChange={(secondChoice) => setDecisionDraft({ ...decisionDraft, secondChoice })} />
        </FormRow>
        <MoreDetails label={t("Reminders")}>
          <Checkbox isSelected={decisionDraft.remindersEnabled} onChange={(remindersEnabled) => setDecisionDraft({ ...decisionDraft, remindersEnabled })}>{t("Show reminders in Wodana")}</Checkbox>
          <Checkbox isSelected={decisionDraft.email} onChange={(email) => setDecisionDraft({ ...decisionDraft, email })}>{t("Email when connected and opted in")}</Checkbox>
          <Checkbox isSelected={decisionDraft.whatsapp} onChange={(whatsapp) => setDecisionDraft({ ...decisionDraft, whatsapp })}>{t("WhatsApp when connected and opted in")}</Checkbox>
          <NumericInput label={t("Escalate after due (minutes)")} minValue={0} maxValue={43200} value={decisionDraft.escalationMinutes} onChange={(escalationMinutes) => setDecisionDraft({ ...decisionDraft, escalationMinutes })} />
        </MoreDetails>
      </FormDialog>
      <FormDialog
        isOpen={create}
        onClose={() => setCreate(false)}
        title={newTitle}
        error={error || undefined}
        isSubmitting={busy}
        isDirty={accepted ? Boolean(changeDraft.title || changeDraft.detail || changeDraft.sourceLineIds.length) : Boolean(draft.title || draft.detail)}
        isSubmitDisabled={linesRequired && !changeDraft.sourceLineIds.length}
        submitLabel={accepted ? t("Create change request") : t("Create request")}
        onSubmit={async () => {
          if (!(await run(accepted ? "create_change_case" : "request", accepted ? changeDraft : draft))) throw new FormNotSaved();
          setCreate(false);
          setDraft({ title: "", detail: "" });
          setChangeDraft(blankChange);
        }}
      >
        {accepted && <SelectField label={t("Change type")} isRequired items={changeKinds.map((kind) => ({ id: kind.value, label: translateKnown(t, kind.label) }))} selectedKey={changeDraft.kind}
          onSelectionChange={(key) => setChangeDraft({ ...changeDraft, kind: String(key ?? "addition") as ControlledChangeKind, sourceLineIds: [] })} />}
        {accepted && contractLines.length > 0 && <FormSection title={linesRequired ? t("Affected accepted items") : `${t("Affected accepted items")} · ${t("Optional")}`}>
          {contractLines.map((line) => <Checkbox key={line.id} isSelected={changeDraft.sourceLineIds.includes(line.id)} onChange={(chosen) => setChangeDraft({
            ...changeDraft,
            sourceLineIds: chosen ? [...changeDraft.sourceLineIds, line.id] : changeDraft.sourceLineIds.filter((id) => id !== line.id),
          })}>V{line.quoteNumber} · {line.room} · {line.title} · {t("{quantity} {unit} remaining", { quantity: line.remainingQuantity, unit: line.unit })}</Checkbox>)}
        </FormSection>}
        <TextInput label={t("Title")} isRequired maxLength={160} value={accepted ? changeDraft.title : draft.title}
          onChange={(title) => accepted ? setChangeDraft({ ...changeDraft, title }) : setDraft({ ...draft, title })} />
        <TextAreaField label={t("What needs to change or be clarified?")} isRequired value={accepted ? changeDraft.detail : draft.detail}
          onChange={(detail) => accepted ? setChangeDraft({ ...changeDraft, detail }) : setDraft({ ...draft, detail })} />
        {accepted && <FormRow>
          <TextInput label={t("Owner")} value={changeDraft.owner} onChange={(owner) => setChangeDraft({ ...changeDraft, owner })} />
          <DateField label={t("Due date")} value={dateValue(changeDraft.dueDate)} onChange={(date) => setChangeDraft({ ...changeDraft, dueDate: date?.toString() ?? "" })} />
        </FormRow>}
      </FormDialog>
      <FormDialog
        isOpen={Boolean(request)}
        onClose={() => setSelected("")}
        title={request?.title ?? t("Request")}
        size="lg"
        hideSubmit={!state.canEdit}
        cancelLabel={t("Close")}
        submitLabel={t("Add reply")}
        isSubmitting={busy}
        isSubmitDisabled={!comment.trim()}
        isDirty={Boolean(comment.trim())}
        fieldMarkers="none"
        error={error || undefined}
        onSubmit={async () => {
          if (!request) return;
          if (!(await run("comment", { requestId: request.id, text: comment, visibility: internal ? "internal" : "client" }))) throw new FormNotSaved();
          setComment("");
        }}
      >
        {request && <>
          <p className={s.requestDetail}>{request.detail}</p>
          <ClientFiles files={threads.files(request.id)} url={threads.fileUrl} />
          {request.decisionRequest ? <div className={s.notice}><strong>{request.decisionRequest.target.label}</strong><p>{t("Due")}{" "}{request.dueDate} {t("· Choices:")}{" "}{request.decisionRequest.allowedChoices.map((choice) => choice.label).join(" / ")}</p><p>{decisionPolicySummary(request.decisionRequest)}</p>{request.decisionRequest.decision ? <p>{t("Client response:")}{" "}{request.decisionRequest.decision.choiceLabel}{request.decisionRequest.decision.note ? ` · ${request.decisionRequest.decision.note}` : ""}</p> : <p>{t("Awaiting the designated client approver.")}</p>}</div> : null}
          {request.control && <ControlledChangeCase request={request} state={state} run={run} busy={busy} />}
          <EditableFieldList>
            <EditableField canEdit={state.canEdit} label={t("Status")} kind="select" value={request.status} display={translateKnown(t, statusLabel[request.status] ?? request.status)}
              items={requestStatuses.filter((status) => status !== "awaiting_decision" || request.status === status).map((status) => ({ id: status, label: translateKnown(t, statusLabel[status]) }))}
              onSave={(status) => saveRequest({ status: status as ChangeRequest["status"] })} />
            <EditableField canEdit={state.canEdit} label={t("Owner")} value={request.owner} placeholder={t("Unassigned")} onSave={(owner) => saveRequest({ owner })} />
            <EditableField canEdit={state.canEdit} label={t("Due date")} kind="date" value={request.dueDate} onSave={(dueDate) => saveRequest({ dueDate })} />
            <EditableField canEdit={state.canEdit} label={t("Resolution / closure reason")} kind="multiline" value={request.resolution} onSave={(resolution) => saveRequest({ resolution })} />
          </EditableFieldList>
          <ul className={s.history}>
            {request.comments.map((c) => (
              <li key={c.id}>
                <strong>{c.author}</strong>{" "}
                <small>{c.visibility === "internal" ? t("Internal note") : t("Client conversation")}</small>
                <p>{c.text}</p>
                <ClientFiles files={threads.files(c.id)} url={threads.fileUrl} />
                <small>{new Date(c.at).toLocaleString()}</small>
              </li>
            ))}
          </ul>
          {conversation ? <SeenByClient readAt={threads.clientRead(conversation)} lastReplyAt={lastReplyAt} /> : null}
          {state.canEdit && <>
            <TextAreaField label={t("Reply")} value={comment} onChange={setComment} />
            <Checkbox isSelected={internal} onChange={setInternal}>{t("Internal note · hidden from client")}</Checkbox>
          </>}
        </>}
      </FormDialog>
    </>
  );
}

type PaymentDraft = {
  paymentId?: string;
  sourceQuoteId?: string;
  title: string;
  amount: string;
  dueDate: string;
  requiredForRelease: boolean;
  requiredForProduction: boolean;
  reference: string;
};
const newPayment = (): PaymentDraft => ({ title: "Advance payment", amount: "", dueDate: "", requiredForRelease: true, requiredForProduction: false, reference: "" });

/** `openPaymentId` (from a notice's link) opens the client's payment report on that milestone once it's loaded. */
export function AgreementPayments({ state, run, busy, error, initialView = "agreement", openPaymentId }: Props & { initialView?: "agreement" | "payments"; openPaymentId?: string }) {
  const t = useT();
  const { currency: workspaceCurrency } = useDesignSystem();
  const accepted = state.data.palmFlow
      ? state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation" && q.round === "main")
        ?? state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation" && q.round === "design")
      : state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation"),
    a = state.data.agreement;
  const savedAgreement = {
    reference: a?.reference ?? "",
    terms: a?.terms ?? accepted?.terms ?? "",
    evidence: a?.evidence ?? "",
  };
  const [agreement, setAgreement] = useState(savedAgreement),
    [tab, setTab] = useState<string>(initialView),
    [payment, setPayment] = useState<PaymentDraft | null>(null),
    [verify, setVerify] = useState(""),
    [reference, setReference] = useState(""),
    [receiptEvidence, setReceiptEvidence] = useState("");
  // Agreement and Payments are separate routes; follow the route's view.
  const [viewFor, setViewFor] = useState(initialView);
  if (viewFor !== initialView) { setViewFor(initialView); setTab(initialView); }
  // What the client reported paying in the portal, per milestone (newest first).
  const client = useClientPaymentReports(state.workspaceId, state.caseId, tab === "payments");
  const reportsFor = (paymentId: string) => client.reports.filter((report) => report.paymentId === paymentId);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [afterReceipt, setAfterReceipt] = useState<string | null>(null);
  const [linked, setLinked] = useState(openPaymentId ?? null);
  if (linked && client.reports.some((report) => report.paymentId === linked)) { setLinked(null); setReportFor(linked); }
  const reportPayment = reportFor ? state.data.payments.find((item) => item.id === reportFor) : undefined;
  const receiptOf = (paymentId: string) => state.data.receipts?.find((receipt) => receipt.paymentId === paymentId && receipt.status !== "rejected");
  const receiptPayment = state.data.payments.find((item) => item.id === verify),
    activeReceipt = receiptPayment ? receiptOf(receiptPayment.id) : undefined,
    verifying = receiptPayment?.status === "proof_submitted";
  const paymentCurrency = accepted?.currency ?? state.currency ?? workspaceCurrency;
  const agreementChanged = agreement.reference !== savedAgreement.reference || agreement.terms !== savedAgreement.terms || agreement.evidence !== savedAgreement.evidence;
  const receiptLabel = (status?: string) => status === "finance_verified" ? t("Finance verified") : status === "provider_confirmed" ? t("Provider confirmed") : status === "reported" ? t("Receipt reported") : t("Payment request only");
  return (
    <>
      {!accepted ? (
        <EmptyState illustration="locked" title={t("Accept the quotation first")} description={t("The agreement and payments follow the exact accepted version.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/pre-projects/cases/${state.caseId}/quotations`}>{t("Open quotations")}</Link>} />
      ) : tab === "agreement" ? (
        <div className={s.agreementPanel}>
          <p className={s.detail}>
            {t("Accepted quotation V")}{accepted.number} ·{" "}
            {money(accepted.clientDecision?.acceptedTotal ?? accepted.total, accepted.currency)}{accepted.decidedBy ? ` · ${accepted.decidedBy}` : ""}
            {accepted.clientDecision?.selectedOptionLineIds.length ? ` · ${t("{count} selected options", { count: accepted.clientDecision.selectedOptionLineIds.length })}` : ""}
          </p>
          {a?.status === "executed" ? <dl className={s.agreementReadout}>
            <div><dt>{t("Agreement reference")}</dt><dd>{a.reference}</dd></div>
            <div><dt>{t("Agreed terms")}</dt><dd>{a.terms}</dd></div>
            <div><dt>{t("Signing details")}</dt><dd>{a.evidence}</dd></div>
          </dl> : <Form className={s.agreementForm} onSubmit={(event) => { event.preventDefault(); void run("agreement", { ...agreement, quoteId: accepted.id }); }}>
            <TextInput isRequired isDisabled={!state.canEdit || busy} label={t("Agreement reference")} maxLength={200} value={agreement.reference}
              onChange={reference => setAgreement({ ...agreement, reference })} placeholder={t("e.g. AGR-2026-014")} />
            <TextAreaField isDisabled={!state.canEdit || busy} label={t("Agreed terms")} value={agreement.terms}
              onChange={terms => setAgreement({ ...agreement, terms })} />
            <TextAreaField isDisabled={!state.canEdit || busy} label={t("Signed document evidence")} value={agreement.evidence}
              onChange={evidence => setAgreement({ ...agreement, evidence })}
              description={t("Document reference, signers and date.")} />
            {state.canEdit ? <div className={s.formActions}><Button type="submit" variant="primary" isDisabled={busy || (Boolean(a) && !agreementChanged)} isLoading={busy}>{t("Save agreement")}</Button></div> : null}
          </Form>}
          <AgreementFiles state={state} run={run} busy={busy} />
          {a?.status === "executed" ? (
            <p className={s.notice}>
              {t("Signed agreement verified by")}{" "}<strong>{a.executedBy}</strong> ·{" "}
              {a.executedAt?.slice(0, 10)}
            </p>
          ) : (
            a &&
            state.canApprove && (
              <div className={s.formActions}><Button variant="primary" isDisabled={busy || !a.evidence || agreementChanged}
                onPress={() => void run("execute_agreement")}>{t("Verify signed agreement")}</Button></div>
            )
          )}
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            {state.data.financeContext ? (
              <p className={s.detail}>
                {state.data.financeContext.displayName} · {state.data.financeContext.code} · {state.data.financeContext.currency}
                {state.data.financeContext.taxValidation === "unvalidated" ? ` · ${t("Tax configuration not regionally validated")}` : ""}
              </p>
            ) : <span />}
            {state.canEdit && (
              <Button size="compact" variant="primary" isDisabled={!a || state.data.payments.some((p) => p.sourceQuoteId)} onPress={() => setPayment(newPayment())}>
                <Plus size={15} />{t("Add milestone")}
              </Button>
            )}
          </div>
          <div className={tableStyles.recordTablePanel}><DataGrid compactToolbar initialColumnVisibility={{ receipt: false }} selectable={false} ariaLabel={t("Payment milestones")} emptyTitle={t("No payment milestones yet")} emptyDescription={t("Add the agreed payment schedule.")} data={state.data.payments} getRowId={row => row.id} searchLabel={t("Search payment milestones")} exportFileName="payment-milestones.csv" columns={[
            { id: "title", header: t("Milestone"), size: 190, accessorFn: (p) => p.title, cell: ({ row: { original: p } }) => <>
              {p.title}
              {p.requiredForRelease && <small className={s.detail}>{t("Required before release")}</small>}
              {p.requiredForProduction && <small className={s.detail}>{t("Required before manufacturing")}</small>}
              {p.proof && <small className={s.detail} title={p.proof}>{t("Client evidence:")}{" "}{p.proof}</small>}
            </> },
            { id: "due", header: t("Due"), size: 130, accessorFn: (p) => p.dueDate || p.trigger || t("To schedule"), cell: ({ row: { original: p } }) => <>{p.dueDate || p.trigger || t("To schedule")}</> },
            { id: "amount", header: t("Amount"), size: 120, accessorFn: (p) => p.amount, cell: ({ row: { original: p } }) => <>{money(p.amount, accepted.currency)}</> },
            { id: "status", header: t("Status"), size: 120, accessorFn: (p) => translateKnown(t, statusLabel[p.status] ?? p.status), cell: ({ row: { original: p } }) => <span className={s.status} data-status={p.status}>{translateKnown(t, statusLabel[p.status] ?? p.status)}</span> },
            { id: "receipt", header: t("Receipt status"), size: 190, accessorFn: (p) => receiptOf(p.id)?.status ?? "request_only", cell: ({ row: { original: p } }) => <>{receiptLabel(receiptOf(p.id)?.status)}</> },
            { id: "reference", header: t("Accounting reference"), size: 200, accessorFn: (p) => p.reference, cell: ({ row: { original: p } }) => <>
              {p.reference || "—"}
              <PaymentInvoice
                currency={state.data.quotes.find((q) => q.id === p.sourceQuoteId)?.currency ?? state.currency ?? workspaceCurrency}
                customerName={state.customerName}
                workspaceId={state.workspaceId}
                payment={p}
                busy={busy}
                canVerifyFinance={state.canVerifyFinance}
                run={run}
              />
            </> },
            ...(client.reports.length ? [{ id: "clientReport", header: t("Client report"), size: 190, accessorFn: (p: typeof state.data.payments[number]) => reportsFor(p.id)[0]?.status ?? "", cell: ({ row: { original: p } }: { row: { original: typeof state.data.payments[number] } }) =>
              <ClientReportCell reports={reportsFor(p.id)} onOpen={() => setReportFor(p.id)} /> }] : []),
            { id: "action", header: t("Action"), size: 180, enableSorting: false, enableColumnFilter: false, cell: ({ row: { original: p } }) => {
              const receipt = receiptOf(p.id);
              return <div className={s.actions}>
                {state.canEdit && p.status === "pending" && (
                  <Button size="compact" onPress={() => setPayment({ paymentId: p.id, sourceQuoteId: p.sourceQuoteId, title: p.title, amount: String(p.amount), dueDate: p.dueDate, requiredForRelease: p.requiredForRelease, requiredForProduction: p.requiredForProduction === true, reference: p.reference })}>
                    {t("Set due date")}
                  </Button>
                )}
                {state.canEdit && p.status !== "verified" && !receipt && !p.invoice && (
                  <Button size="compact" onPress={() => { setVerify(p.id); setReference(p.reference); setReceiptEvidence(""); }}>{t("Record receipt")}</Button>
                )}
                {state.canVerifyFinance && p.status === "proof_submitted" && Boolean(receipt) && (
                  <Button size="compact" onPress={() => setVerify(p.id)}>{t("Finance verify")}</Button>
                )}
              </div>;
            } }]} /></div>
        </>
      )}
      {tab === "payments" && (
        <ClientCredits state={state} run={run} busy={busy} />
      )}
      {reportPayment && reportsFor(reportPayment.id).length ? <ClientReportDialog milestone={reportPayment.title} reports={reportsFor(reportPayment.id)} client={client}
        currency={state.data.quotes.find((q) => q.id === reportPayment.sourceQuoteId)?.currency ?? accepted?.currency ?? state.currency ?? workspaceCurrency}
        milestoneAmount={reportPayment.amount} hasReceipt={Boolean(receiptOf(reportPayment.id))}
        canRecordReceipt={state.canEdit && reportPayment.status !== "verified" && !reportPayment.invoice}
        onRecordReceipt={(report) => { setReportFor(null); setAfterReceipt(reportPayment.id); setVerify(reportPayment.id); setReference(report.reference || reportPayment.reference); setReceiptEvidence(""); }}
        onClose={() => setReportFor(null)} /> : null}
      {payment ? <FormDialog
        onClose={() => setPayment(null)}
        title={payment.paymentId ? t("Payment milestone") : t("Add milestone")}
        error={error || undefined}
        isSubmitting={busy}
        submitLabel={t("Save milestone")}
        onSubmit={async () => {
          if (!(await run("payment", { ...payment, amount: Number(payment.amount) }))) throw new FormNotSaved();
          setPayment(null);
        }}
      >
        <TextInput label={t("Milestone")} isRequired maxLength={160} isDisabled={Boolean(payment.sourceQuoteId)}
          value={payment.title} onChange={title => setPayment({ ...payment, title })} />
        <FormRow>
          <MoneyField label={t("Amount")} currency={paymentCurrency} isRequired min={smallestAmount(paymentCurrency)} isDisabled={Boolean(payment.sourceQuoteId)}
            value={payment.amount} onChange={amount => setPayment({ ...payment, amount })} />
          <DateField label={t("Due date")} isRequired value={dateValue(payment.dueDate)}
            onChange={date => setPayment({ ...payment, dueDate: date?.toString() ?? "" })} />
        </FormRow>
        <FormSection title={t("Required before")}>
          <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForRelease} onChange={requiredForRelease => setPayment({ ...payment, requiredForRelease })}>{t("Execution release")}</Checkbox>
          <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForProduction} onChange={requiredForProduction => setPayment({ ...payment, requiredForProduction })}>{t("Manufacturing starts")}</Checkbox>
        </FormSection>
        {payment.sourceQuoteId ? <p className={s.detail}>{t("The milestone amount and conditions are fixed by the accepted quotation.")}</p> : null}
        <MoreDetails filled={payment.reference ? 1 : 0}>
          <TextInput label={t("Invoice reference")} maxLength={240} value={payment.reference} onChange={reference => setPayment({ ...payment, reference })} />
        </MoreDetails>
      </FormDialog> : null}
      <FormDialog
        isOpen={Boolean(verify)}
        onClose={() => { setVerify(""); setAfterReceipt(null); }}
        title={verifying ? t("Finance verification") : t("Record payment receipt")}
        error={error || undefined}
        isSubmitting={busy}
        isDirty={!verifying && Boolean(receiptEvidence.trim())}
        submitLabel={verifying ? t("Verify receipt") : t("Record receipt")}
        lead={verifying ? <p className={s.detail}>{activeReceipt?.source === "provider" ? t("Confirm the provider settlement against the finance record.") : t("Confirm the reported receipt against the finance record.")}</p> : null}
        onSubmit={async () => {
          if (!(await run(verifying ? "verify_payment" : "report_payment_receipt", { paymentId: verify, reference, evidence: receiptEvidence }))) throw new FormNotSaved();
          setVerify("");
          // Recorded from the client's report: back to it, to mark it recorded.
          if (afterReceipt) { setReportFor(afterReceipt); setAfterReceipt(null); }
        }}
      >
        {!verifying && <>
          <TextInput isRequired maxLength={240} label={t("Receipt / transaction reference")} value={reference} onChange={setReference} />
          <TextAreaField isRequired label={t("Receipt evidence")} value={receiptEvidence} onChange={setReceiptEvidence} />
        </>}
      </FormDialog>
    </>
  );
}

/** One commission line: who, what kind, and an amount or a share. */
function CommissionFields({ currency, index, line, onChange, onRemove, fixedRecipient }: { currency: string; index: number; line: CommissionDraft; onChange: (next: Partial<CommissionDraft>) => void; onRemove?: () => void; fixedRecipient?: boolean }) {
  const t = useT();
  const title = fixedRecipient ? `${line.recipientName} · ${translateKnown(t, commissionTypes.find((type) => type.id === line.type)?.label ?? line.type)}` : t("Commission {number}", { number: index + 1 });
  return <FormSection title={<span className={s.commissionTitle}>{title}{onRemove ? <IconButton aria-label={t("Remove commission {number}", { number: index + 1 })} onPress={onRemove}><X size={14} /></IconButton> : null}</span>}>
    {fixedRecipient ? null : <FormRow>
      <TextInput isRequired label={t("Recipient")} maxLength={160} value={line.recipientName} onChange={(recipientName) => onChange({ recipientName })} />
      <SelectField isRequired label={t("Type")} items={commissionTypes.map((type) => ({ id: type.id, label: t(type.label) }))} selectedKey={line.type}
        onSelectionChange={(key) => onChange({ type: String(key ?? "sales") as CommissionDraft["type"] })} />
    </FormRow>}
    <FormRow>
      <SelectField isRequired label={t("Basis")} items={[{ id: "amount", label: currency }, { id: "percent", label: t("Percentage") }]} selectedKey={line.basis}
        onSelectionChange={(key) => onChange({ basis: String(key ?? "amount") as CommissionDraft["basis"], value: "" })} />
      {line.basis === "percent"
        ? <PercentageInput isRequired label={t("Share")} minValue={0.01} value={line.value ? Number(line.value) : Number.NaN} onChange={(value) => onChange({ value: Number.isFinite(value) ? String(value) : "" })} />
        : <MoneyField isRequired label={t("Amount")} currency={currency} min={smallestAmount(currency)} value={line.value} onChange={(value) => onChange({ value })} />}
    </FormRow>
  </FormSection>;
}

export function ApprovalRelease({
  state,
  run,
  busy,
  root,
  sectionHref,
  initialView = "owner",
}: Props & { root: string; sectionHref?: (section: string) => string; initialView?: string }) {
  const t = useT();
  const [tab, setTab] = useState<string>(initialView),
    [note, setNote] = useState(""),
    [decisionNote, setDecisionNote] = useState(""),
    [commissionLines, setCommissionLines] = useState<CommissionDraft[]>(state.data.ownerReview?.commissionLines?.map(draftOf) ?? [newCommissionLine()]),
    [financeDraft, setFinanceDraft] = useState<{ key: string; lines: CommissionDraft[] }>({ key: "", lines: [] }),
    [paymentProofUrl, setPaymentProofUrl] = useState(state.data.ownerReview?.paymentProofUrl ?? ""),
    [paymentVerification, setPaymentVerification] = useState<{ key: string; value: boolean }>({ key: "", value: false }),
    [approver, setApprover] = useState(""),
    [materialDraft, setMaterialDraft] = useState<MaterialApproval | null>(null),
    [photoProblem, setPhotoProblem] = useState(""),
    [checklist, setChecklist] = useState(
      state.data.ownerReview?.checklist ?? {
        agreement: false,
        boq: false,
        documents: false,
        margin: false,
        materials: false,
        payment: false,
      },
    );
  const d = state.data,
    accepted = d.palmFlow
      ? d.quotes.find(q => q.kind === "quotation" && q.round === "main" && q.status === "accepted")
        ?? d.quotes.find(q => q.kind === "quotation" && q.round === "design" && q.status === "accepted")
      : d.quotes.find(q => q.kind === "quotation" && q.status === "accepted");
  const deliveryQuote = activeDeliveryQuote(d);
  const submittedCommissions = d.ownerReview?.commissionLines ?? [];
  const reviewKey = `${d.ownerReview?.id ?? ""}:${d.ownerReview?.submittedAt ?? ""}`;
  const editableFinanceLines = financeDraft.key === reviewKey ? financeDraft.lines : submittedCommissions.map(draftOf);
  const paymentVerified = paymentVerification.key === reviewKey && paymentVerification.value;
  const updateCommission = (index: number, update: Partial<CommissionDraft>, finance = false) => {
    const current = finance ? editableFinanceLines : commissionLines;
    const next = current.map((line, i) => i === index ? { ...line, ...update } : line);
    if (finance) setFinanceDraft({ key: reviewKey, lines: next }); else setCommissionLines(next);
  };
  const checklistKeys = Object.keys(checklist).filter(key => !d.palmFlow || key !== "materials");
  const checks = [
    { label: tKey("Client accepted the quotation"), done: Boolean(deliveryQuote), href: "quotations" },
    {
      label: tKey("Linked design revisions approved"),
      done: Boolean(
        deliveryQuote &&
          ((d.palmFlow && !d.palmFlow.scope.design) ||
            (state.releaseReadiness &&
            (state.releaseReadiness.designsRequired > 0 &&
              state.releaseReadiness.designsApproved === state.releaseReadiness.designsRequired))),
      ),
      href: "designs",
    },
    {
      label: tKey("Signed agreement verified"),
      done: Boolean(deliveryQuote && agreementIsOperational(d.agreement) && agreementMatchesAcceptedQuote(d.agreement, deliveryQuote)),
      href: "contracts",
    },
    {
      label: tKey("Required payments verified"),
      done: Boolean(deliveryQuote && financeGatePaymentsReady(d, d.palmFlow ? deliveryQuote.id : undefined)),
      href: "payment-plan",
    },
    {
      label: tKey("Won opportunity, Finance verification and approved Deal File"),
      done:
        state.opportunityStatus === "won" &&
        d.ownerReview?.quoteId === deliveryQuote?.id &&
        d.ownerReview?.status === "approved" &&
        Boolean(d.ownerReview.financeReviewedById) &&
        d.dealFile?.quoteId === deliveryQuote?.id &&
        Boolean(d.dealFile?.paymentProofUrl) &&
        Boolean(d.dealFile?.commissionLines?.length),
      href: "execution-release",
      view: "owner",
    },
    {
      label: tKey("Material selections approved or not applicable"),
      done: Boolean(deliveryQuote && (d.palmFlow ? palmMaterialListSignedOff(d, deliveryQuote) : materialApprovalsComplete(deliveryQuote, d.materialApprovals))),
      href: "execution-release",
      view: "materials",
    },
    {
      label: tKey("Change requests resolved"),
      done: d.requests.every((r) => ["resolved", "declined", "withdrawn"].includes(r.status)),
      href: "variations",
    },
  ];
  const approvers = state.contacts.filter(contact => contact.active && contact.role === "approver").map(contact => ({ id: contact.id, label: `${contact.name} · ${contact.phone}` }));
  const readPhoto = (file?: File) => {
    setPhotoProblem("");
    if (!file) return;
    if (file.size > 180000) { setPhotoProblem(t("PNG, JPEG or WebP · up to 180 KB.")); return; }
    const reader = new FileReader();
    reader.onload = () => setMaterialDraft(current => current ? { ...current, photo: String(reader.result) } : current);
    reader.readAsDataURL(file);
  };
  return (
    <>
      <PillTabs ariaLabel={t("Approval views")} tour="deal-approvals" selectedKey={tab} onSelectionChange={setTab} items={[
        { id: "owner", label: t("Internal approval") },
        { id: "materials", label: t("Material approvals") },
        { id: "history", label: t("History") },
      ]} />
      {tab === "owner" ? (
        <>
          {!accepted ? (
            <EmptyState illustration="locked" title={t("Client acceptance comes first")} description={t("Issue the reviewed quotation and wait for the client approver.")}
              action={<Link className="wd-button" data-size="compact" data-variant="primary" href={sectionHref?.("quotations") ?? `${root}/quotations`}>{t("Open quotations")}</Link>} />
          ) : <>
            <div className={s.controlSummary}>
              <div><small>{t("Accepted quotation")}</small><strong>V{accepted.number} · {money(acceptedQuoteValue(accepted), accepted.currency)}</strong></div>
              {/* Costs are stripped for people who can't see them; showing 0 and 100% would mislead. */}
              {state.canViewCosts ? <>
                <div><small>{t("Internal cost")}</small><strong>{money(acceptedQuoteTotals(accepted).cost, accepted.currency)}</strong></div>
                <div><small>{t("Gross margin")}</small><strong>{acceptedQuoteTotals(accepted).margin.toFixed(1)}%</strong></div>
              </> : null}
              <div><small>{t("Internal approval")}</small><strong>{d.ownerReview ? translateKnown(t, statusLabel[d.ownerReview.status] ?? d.ownerReview.status) : t("Not submitted")}</strong></div>
            </div>
            {d.dealFile && <div className={s.dealBanner}><div><small>{t("DEAL FILE")}</small><strong>{d.dealFile.reference}</strong><span>{t("Approved")}{" "}{d.dealFile.approvedAt.slice(0, 10)} {t("by")}{" "}{d.dealFile.approvedBy}</span></div><div><small>{t("Current round")}</small><strong>{d.dealFile.quoteId === accepted.id ? accepted.round === "design" ? t("Design") : t("Main quotation") : t("Design approved · main pending")}</strong></div><div><small>{t("Frozen evidence")}</small><strong>{d.dealFile.designEvidence?.links?.length ?? 0} {t("files ·")}{" "}{d.dealFile.materialEvidence?.length ?? 0} {t("materials")}</strong></div><div><small>{t("Deal value")}</small><strong>{money(d.dealFile.value, accepted.currency)}</strong></div></div>}
            {d.ownerReview?.status === "pending_finance" ? <Form className={s.ownerForm} fieldMarkers="none" onSubmit={(event) => { event.preventDefault(); void run("review_deal_finance", { decision: "confirm", note: decisionNote, paymentVerified, commissionLines: editableFinanceLines.map(sent) }); }}>
              <h2>{t("2 · Finance verification")}</h2>
              <p className={s.muted}>{t("Submitted by {name}", { name: d.ownerReview.submittedBy })}</p>
              <a href={d.ownerReview.paymentProofUrl} target="_blank" rel="noopener noreferrer">{t("Open payment proof ↗")}</a>
              {editableFinanceLines.map((line, index) => <CommissionFields key={`${line.type}-${index}`} fixedRecipient currency={accepted.currency} index={index} line={line} onChange={(update) => updateCommission(index, update, true)} />)}
              <Checkbox isSelected={paymentVerified} onChange={(value) => setPaymentVerification({ key: reviewKey, value })}>{t("I verified the linked proof of payment")}</Checkbox>
              <TextAreaField label={t("Finance note")} value={decisionNote} onChange={setDecisionNote} placeholder={t("Explain any correction or reason for return.")} />
              {state.canVerifyFinance && <div className={s.formActions}>
                <Button isDisabled={busy || !decisionNote.trim()} onPress={() => void run("review_deal_finance", { decision: "return", note: decisionNote })}>{t("Return to Sales")}</Button>
                <Button type="submit" variant="primary" isLoading={busy} isDisabled={busy || !paymentVerified || !editableFinanceLines.every(commissionReady)}>{t("Confirm Finance review")}</Button>
              </div>}
            </Form> : d.ownerReview?.status === "pending_approval" ? <section className={s.ownerForm}>
              <h2>{t("3 · Owner approval")}</h2>
              <ul className={s.checkList}>{Object.entries(d.ownerReview.checklist).filter(([key]) => !d.palmFlow || key !== "materials").map(([key, done]) => <li key={key} data-done={done}>{done ? <Check aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}{translateKnown(t, checklistLabel[key] ?? key)}</li>)}</ul>
              <ul className={s.checkList}>{(d.ownerReview.finalCommissionLines ?? []).map((line, index) => <li key={`${line.type}-${index}`}>{line.recipientName} · {translateKnown(t, commissionTypes.find((type) => type.id === line.type)?.label ?? line.type)} · {money(line.amount, accepted.currency)}</li>)}</ul>
              <TextAreaField label={t("Decision remarks")} value={decisionNote} onChange={setDecisionNote} placeholder={t("Required when returning or rejecting.")} />
              {!d.palmFlow && !materialApprovalsComplete(accepted, d.materialApprovals) && <p className={s.notice}>{t("Complete every client material decision before creating the Deal File.")}</p>}
              {state.canApproveDeal && <div className={s.formActions}>
                <Button variant="danger" isDisabled={busy || !decisionNote.trim()} onPress={() => void run("decide_owner_review", { decision: "reject", note: decisionNote })}>{t("Reject")}</Button>
                <Button isDisabled={busy || !decisionNote.trim()} onPress={() => void run("decide_owner_review", { decision: "return", note: decisionNote })}>{t("Return for correction")}</Button>
                <Button variant="primary" isLoading={busy} isDisabled={busy || Object.entries(d.ownerReview.checklist).some(([key, value]) => !value && (!d.palmFlow || key !== "materials")) || (!d.palmFlow && !materialApprovalsComplete(accepted, d.materialApprovals))} onPress={() => void run("decide_owner_review", { decision: "approve", note: decisionNote })}>{t("Approve Deal File")}</Button>
              </div>}
            </section> : d.dealFile?.quoteId !== accepted.id && <Form className={s.ownerForm} onSubmit={async e => { e.preventDefault(); await run("submit_owner_review", { commissionLines: commissionLines.map(sent), paymentProofUrl, checklist, note }); }}>
              <h2>{t("1 · Submit Deal File")}</h2>
              {d.ownerReview && <p className={s.notice}>{t("Previous decision:")}{" "}{translateKnown(t, statusLabel[d.ownerReview.status] ?? d.ownerReview.status)}. {d.ownerReview.financeNote ?? d.ownerReview.decisionNote}</p>}
              {state.opportunityStatus !== "won" && <p className={s.notice}>{t("Mark the linked opportunity Won before submitting this Deal File.")}</p>}
              <TextInput isRequired inputType="url" label={t("Proof-of-payment link")} value={paymentProofUrl} onChange={setPaymentProofUrl} placeholder={t("https://…")} />
              {commissionLines.map((line, index) => <CommissionFields key={index} currency={accepted.currency} index={index} line={line}
                onChange={(update) => updateCommission(index, update)}
                onRemove={commissionLines.length > 1 ? () => setCommissionLines(commissionLines.filter((_, i) => i !== index)) : undefined} />)}
              {commissionLines.length < 3 && <div><Button size="compact" variant="quiet" onPress={() => setCommissionLines([...commissionLines, newCommissionLine()])}><Plus size={14} />{t("Add recipient")}</Button></div>}
              <FormSection title={t("Checklist")}>
                <div className={s.checkGrid}>{checklistKeys.map(key => <Checkbox key={key} isSelected={checklist[key as keyof typeof checklist]} onChange={(done) => setChecklist({ ...checklist, [key]: done })}>{translateKnown(t, checklistLabel[key] ?? key)}</Checkbox>)}</div>
              </FormSection>
              <TextAreaField isRequired label={t("Submission note")} value={note} onChange={setNote} placeholder={t("Summarize payment evidence, pricing decision and any conditions.")} />
              {state.canEdit && <div className={s.formActions}><Button type="submit" variant="primary" isLoading={busy} isDisabled={busy || state.opportunityStatus !== "won" || !note.trim() || !commissionLines.every(commissionReady)}>{t("Send to Finance")}</Button></div>}
            </Form>}
          </>}
        </>
      ) : tab === "materials" ? (
        <>
          <div className={s.header}><h2>{t("Client material selections")}</h2>{state.canEdit && <Button size="compact" isDisabled={busy || !accepted || (Boolean(d.palmFlow) && d.dealFile?.quoteId !== accepted.id)} onPress={() => void run("sync_material_approvals")}>{t("Prepare from quotation")}</Button>}</div>
          {(d.materialApprovals ?? []).filter(item => item.quoteId === accepted?.id).map(item => <div className={s.materialRow} key={item.id}>
            {item.photo ? <Image src={item.photo} alt="" width={64} height={64} unoptimized /> : <span className={s.materialThumb}>{t("No photo")}</span>}
            <div><strong>{item.name}</strong><span>{item.room} · {item.item}</span><small>{[item.brand, item.code].filter(Boolean).join(" · ") || item.specification}</small>{item.decisionNote && <small>{t("Client remark:")}{" "}{item.decisionNote}</small>}</div>
            <span className={s.status} data-status={item.status}>{translateKnown(t, statusLabel[item.status] ?? item.status.replaceAll("_", " "))}</span>
            {state.canEdit && ["proposed", "rejected"].includes(item.status) && <Button size="compact" onPress={() => { setPhotoProblem(""); setMaterialDraft({ ...item }); }}>{t("Edit")}</Button>}
            {state.canEdit && item.status === "proposed" && <Button size="compact" variant="primary" isDisabled={busy || !approver} onPress={() => void run("submit_material_approval", { materialApprovalId: item.id, approverId: approver })}>{t("Send to client")}</Button>}
          </div>)}
          {!(d.materialApprovals ?? []).some(item => item.quoteId === accepted?.id) && <EmptyState title={t("No selections prepared")} description={t("Accept the quotation, then prepare its materials for client review.")} />}
          {(d.materialApprovals ?? []).some(item => item.quoteId === accepted?.id && item.status === "proposed") && <div className={s.approverField}><SelectField label={t("Client approver")} placeholder={t("Choose approver…")} items={approvers} selectedKey={approver || null} onSelectionChange={(key) => setApprover(String(key ?? ""))} /></div>}
          {materialDraft ? <FormDialog onClose={() => setMaterialDraft(null)} title={t("Edit material selection")} isSubmitting={busy} submitLabel={t("Save selection")}
            onSubmit={async () => {
              if (!(await run("save_material_approval", { materialApprovalId: materialDraft.id, name: materialDraft.name, code: materialDraft.code, brand: materialDraft.brand, specification: materialDraft.specification, note: materialDraft.note, photo: materialDraft.photo ?? "" }))) throw new FormNotSaved();
              setMaterialDraft(null);
            }}>
            <TextInput isRequired label={t("Material / finish name")} value={materialDraft.name} onChange={name => setMaterialDraft({ ...materialDraft, name })} />
            <FormRow>
              <TextInput label={t("Brand")} value={materialDraft.brand} onChange={brand => setMaterialDraft({ ...materialDraft, brand })} />
              <TextInput label={t("Product code")} value={materialDraft.code} onChange={code => setMaterialDraft({ ...materialDraft, code })} />
            </FormRow>
            <TextAreaField isRequired label={t("Specification")} value={materialDraft.specification} onChange={specification => setMaterialDraft({ ...materialDraft, specification })} />
            <MoreDetails filled={(materialDraft.note ? 1 : 0) + (materialDraft.photo ? 1 : 0)}>
              <TextAreaField label={t("Internal note")} value={materialDraft.note} onChange={note => setMaterialDraft({ ...materialDraft, note })} />
              <FileUploader accept="image/png,image/jpeg,image/webp" appearance="button" label={t("Sample photo")} multiple={false} onFiles={(files) => readPhoto(files[0])} />
              {photoProblem ? <p className={s.error} role="alert">{photoProblem}</p> : <small className={s.detail}>{t("PNG, JPEG or WebP · up to 180 KB.")}</small>}
            </MoreDetails>
          </FormDialog> : null}
        </>
      ) : tab === "release" ? (
        d.palmFlow && !d.palmFlow.scope.mainQuotation ? <EmptyState illustration="done" title={t("Design-only project")} description={t("This path ends with the approved design. Procurement and production don’t apply.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={sectionHref?.("designs") ?? `${root}/designs`}>{t("Open design")}</Link>} /> : <>
          <ul className={s.checkList}>
            {checks.map((c) => (
              <li key={c.label} data-done={c.done}>
                {c.done ? <Check aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}
                <span>{t(c.label)}</span>
                {c.view ? <Button size="compact" variant="quiet" onPress={() => setTab(c.view)}>{t("Review →")}</Button> : <Link href={sectionHref?.(c.href) ?? `${root}/${c.href}`}>{t("Review →")}</Link>}
              </li>
            ))}
          </ul>
          {d.release ? (
            <p className={s.notice}>
              {t("Readiness recorded by")}{" "}{d.release.by} {t("on")}{" "}
              {d.release.at.slice(0, 10)}.<br />
              {d.release.note}
              {d.release.projectId && (
                <>
                  <br />
                  <Link href={`/workspace/projects/${d.release.projectId}/overview`}>{t("Open project →")}</Link>
                </>
              )}
            </p>
          ) : (
            <Form className={s.agreementForm} fieldMarkers="none" onSubmit={(event) => { event.preventDefault(); void run("release", { note }); }}>
              <TextAreaField isRequired label={t("Technical approvals, released scope and any conditions")} value={note} onChange={setNote}
                placeholder={t("Reference the approved drawings, scope and site checks. Record any authorized conditions.")} />
              {state.canRelease && (!d.palmFlow || d.palmFlow.scope.mainQuotation) && (
                <div className={s.formActions}>
                  <Button type="submit" variant="primary" isLoading={busy}
                    isDisabled={
                      busy ||
                      state.opportunityStatus !== "won" ||
                      !commercialReleaseInputsReady(d) ||
                      ((!d.palmFlow || d.palmFlow.scope.design) &&
                        (!state.releaseReadiness ||
                         state.releaseReadiness.designsRequired === 0 ||
                         state.releaseReadiness.designsApproved !== state.releaseReadiness.designsRequired)) ||
                      !note.trim()
                    }>
                    {d.palmFlow ? t("Release to procurement") : t("Release & open project")}
                  </Button>
                </div>
              )}
            </Form>
          )}
        </>
      ) : (
        <ul className={s.history}>
          {d.audit
            .slice()
            .reverse()
            .map((a) => (
              <li key={a.id}>
                <strong>{a.action.replaceAll("_", " ")}</strong>
                <p className={s.muted}>
                  {a.actor} · {new Date(a.at).toLocaleString()}
                </p>
                {a.note && <p>{a.note}</p>}
              </li>
            ))}
        </ul>
      )}
    </>
  );
}
