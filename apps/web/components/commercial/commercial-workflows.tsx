"use client";
import { RecordHistory } from "../history/record-history";
import { useT } from "@/lib/i18n/i18n-provider";
import { KIT_COMMISSION_LABELS, KIT_COMMISSION_TYPES, useCommissionTypes, type CommissionType } from "@/lib/setup/commissions";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { ClientCredits } from "./client-credits";
import { PaymentInvoice } from "./payment-invoice";
import { AgreementFiles } from "./agreement-files";
import { AssetFiles } from "../pre-project/case-controls";
import { useEffect, useState } from "react";
import { parseDate, today } from "@internationalized/date";
import Link from "next/link";
import Image from "next/image";
import { Banknote, FileCheck2, PenLine, Percent, Plus, Receipt, ScrollText, StickyNote, UserRound, X } from "lucide-react";
import {
  AmountList,
  Card,
  Avatar,
  Badge,
  CheckList,
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
  InlineNotice,
  KpiStrip,
  KpiTile,
  MoneyField,
  MoreDetails,
  NumericInput,
  PercentageInput,
  ReviewDialog,
  ReviewFiles,
  SelectField,
  StateChip,
  TextAreaField,
  TextInput,
  useDesignSystem,
  formatDate,
} from "@/design-system";
import { CommercialStatus } from "./commercial-status";
import { acceptedQuoteTotals, acceptedQuoteValue, money, paymentMethodLabel, statusLabel } from "@/lib/commercial/client";
import { smallestAmount, sumExact, taxInside } from "@/lib/money-exact";
import {
  activeDeliveryQuote,
  agreementHasSignedEvidence,
  agreementIsOperational,
  agreementMatchesAcceptedQuote,
  dealPaymentProofReady,
  financeGatePaymentsReady,
  materialApprovalsComplete,
  materialListSignedOff,
  paymentProofProblem,
  quoteHasVerifiedReceipt,
  requestBlocksRelease,
} from "@/lib/commercial/release";
import { MANUAL_PAYMENT_METHODS, type CommercialState, type ChangeRequest, type ControlledChangeKind, type ManualPaymentMethod, type MaterialApproval } from "@/lib/commercial/types";
import { availableContractLines, changeKinds } from "@/lib/commercial/change-cases";
import { decisionPolicySummary } from "@/lib/commercial/decision-requests";
import { ControlledChangeCase } from "./controlled-change-case";
import { ClientReportCell, ClientReportDialog, useClientPaymentReports } from "./client-payment-reports";
import { ClientFiles } from "@/components/client-activity/client-files";
import { EvidenceField } from "@/components/evidence/evidence-field";
import { evidenceFiles, type EvidenceFile } from "@/lib/evidence/evidence";
import { caseApi, caseRequest, type CaseAsset } from "@/lib/pre-project/content";
import { SeenByClient, useClientThreads } from "@/components/client-activity/client-threads";
import { DealApprovalSteps, DealClosing, DealMoney, DealRequirements, DealTeam, dealPaidShare, dealRequirementCount, dealRiskText } from "./deal-file-insight";
import { NextStepCard, SectionTabs, SideSection, useSectionTabs } from "@/components/record/record-layout";
import { FactList, PersonChip } from "@/components/record/record-parts";
import ds from "./deal-file-insight.module.css";
import { LinkedRecords } from "@/components/record/linked-records";
import s from "./commercial.module.css";
import { DealPath } from "./deal-path";
import { PaymentProofDialog } from "../crm/opportunity-flow";
import { StartProjectDialog } from "../project-core/start-project-dialog";
import { crmRequest } from "@/lib/crm/client";
import tableStyles from "../workspace/workspace.module.css";
type Props = {
  state: CommercialState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error?: string;
};
/** A commission line as it is typed: the value is exact decimal text until it is sent. */
type CommissionDraft = { recipientName: string; type: string; basis: "amount" | "percent"; value: string };
type CommissionLine = { recipientName: string; type: CommissionDraft["type"]; basis: CommissionDraft["basis"]; value: number };
const newCommissionLine = (): CommissionDraft => ({ recipientName: "", type: "sales", basis: "amount", value: "" });
const draftOf = ({ recipientName, type, basis, value }: CommissionLine): CommissionDraft => ({ recipientName, type, basis, value: value ? String(value) : "" });
const sent = (line: CommissionDraft): CommissionLine => ({ ...line, value: Number(line.value || 0) });
const commissionReady = (line: CommissionDraft) => Boolean(line.recipientName.trim()) && Number(line.value || 0) > 0;
/** A row nobody filled in: it isn't a commission and isn't sent (a deal may have none). */
const commissionBlank = (line: CommissionDraft) => !line.recipientName.trim() && !Number(line.value || 0);
const requestStatuses = ["open", "under_review", "awaiting_decision", "resolved", "declined", "withdrawn"] as const;
const dateValue = (value: string) => { try { return value ? parseDate(value.slice(0, 10)) : null; } catch { return null; } };
const blankDecision = { title: "", detail: "", targetKey: "", dueDate: "", firstChoice: "Approve", secondChoice: "Request changes", remindersEnabled: true, email: false, whatsapp: false, escalationMinutes: 1440 };
const blankChange = { kind: "addition" as ControlledChangeKind, sourceLineIds: [] as string[], title: "", detail: "", owner: "", dueDate: "" };
/** A reply the client reads carries up to ten of the team's photos or PDFs, each up to 20 MB. */
const REPLY_FILE_LIMIT = 10;
const REPLY_FILE_BYTES = 20 * 1024 * 1024;
const REPLY_FILE_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,application/pdf";

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
    [internal, setInternal] = useState(false),
    // Photos or PDFs the team sends with a reply the client reads (uploaded to the case first).
    [replyFiles, setReplyFiles] = useState<CaseAsset[]>([]),
    [replyUploading, setReplyUploading] = useState(false),
    [replyFileError, setReplyFileError] = useState("");
  const request = state.data.requests.find((r) => r.id === selected);
  const accepted = state.data.quotes.some((quote) => quote.kind === "quotation" && quote.status === "accepted");
  // The client's files on each conversation, and whether they've read the team's replies; opening a thread tells them it was seen.
  const threads = useClientThreads(state.workspaceId, state.caseId);
  const { markRead } = threads;
  const conversation = request && !request.decisionRequest ? request.id : null;
  useEffect(() => { if (conversation) markRead(conversation); }, [conversation, markRead]);
  const fromClient = (comment: ChangeRequest["comments"][number]) => Boolean((comment as { fromClient?: boolean }).fromClient);
  /** Who raised a request: kept on it, else the client contact whose portal command raised it. */
  const raiser = (r: ChangeRequest) => r.raisedBy ?? (threads.raisedBy(r.id) ? { name: threads.raisedBy(r.id)!, client: true } : null);
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
  // Each file goes to the case first; the reply then carries their ids.
  const attachToReply = async (files: File[]) => {
    setReplyFileError("");
    const room = REPLY_FILE_LIMIT - replyFiles.length;
    if (!files.length) return;
    if (files.length > room) { setReplyFileError(t("You can add {count} more files to this record.", { count: Math.max(0, room) })); return; }
    const oversized = files.find((file) => file.size > REPLY_FILE_BYTES);
    if (oversized) { setReplyFileError(t("{name} is larger than 20 MB.", { name: oversized.name })); return; }
    setReplyUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.set("file", file);
        const asset = await caseRequest<CaseAsset>(state.workspaceId, state.caseId, `assets/${crypto.randomUUID()}`, "POST", body);
        setReplyFiles((current) => [...current, asset].slice(0, REPLY_FILE_LIMIT));
      }
    } catch (failure) { setReplyFileError(failure instanceof Error ? translateKnown(t, failure.message) : t("Upload failed.")); }
    finally { setReplyUploading(false); }
  };
  return (
    <>
      <div className={s.toolbar}>
        <span className={s.muted}>
          {t("{count} open requests", { count: state.data.requests.filter((r) => !["resolved", "withdrawn", "declined"].includes(r.status)).length })}
        </span>
        {state.canEdit && <div className={s.actions}>{decisionTargets.length > 0 && <Button size="compact" onPress={() => { setDecisionDraft(blankDecision); setCreateDecision(true); }}>{t("Request client decision")}</Button>}<Button size="compact" variant="primary" onPress={() => { setDraft({ title: "", detail: "" }); setChangeDraft(blankChange); setCreate(true); }}><Plus size={15} />{newTitle}</Button></div>}
      </div>
      {!state.data.requests.length ? (
        <EmptyState title={t("No change requests yet")} description={t("Client changes and your team’s clarifications appear here, each with an owner and a resolution.")} />
      ) : (
        <div className={tableStyles.recordTablePanel}><DataGrid selectable={false} compactToolbar ariaLabel={t("Change requests")} data={state.data.requests} getRowId={row => row.id} searchLabel={t("Search change requests")} exportFileName="change-requests.csv" onRowAction={r => setSelected(r.id)} columns={[
          { id: "title", header: t("Request"), size: 320, accessorFn: (r) => `CR-${String(r.number).padStart(3, "0")} ${r.title}`, cell: ({ row: { original: r } }) => <Button size="compact" variant="quiet" className={s.requestButton} onPress={() => setSelected(r.id)}><span className={s.muted}>{t("CR-")}{String(r.number).padStart(3, "0")} · </span>{r.title}</Button> },
          { id: "from", header: t("From"), size: 170, accessorFn: (r) => raiser(r)?.name ?? "", cell: ({ row: { original: r } }) => <>{raiser(r)?.name ?? "—"}</> },
          { id: "owner", header: t("Owner"), size: 180, accessorFn: (r) => r.owner || t("Unassigned"), cell: ({ row: { original: r } }) => <>{r.owner || t("Unassigned")}</> },
          { id: "due", header: t("Due"), size: 140, accessorFn: (r) => r.dueDate, cell: ({ row: { original: r } }) => <>{r.dueDate || "—"}</> },
          { id: "status", header: t("Status"), size: 160, accessorFn: (r) => translateKnown(t, statusLabel[r.status] ?? r.status), cell: ({ row: { original: r } }) => <CommercialStatus status={r.status}>{translateKnown(t, statusLabel[r.status] ?? r.status)}</CommercialStatus> },
        ]} /></div>
      )}
      <FormDialog
        isOpen={createDecision}
        onClose={() => setCreateDecision(false)}
        title={t("Request a client decision")}
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
        <FormSection>
          <TextInput label={t("Question")} isRequired maxLength={160} value={decisionDraft.title} onChange={(title) => setDecisionDraft({ ...decisionDraft, title })} />
          <TextAreaField label={t("What does the client need to decide?")} isRequired value={decisionDraft.detail} onChange={(detail) => setDecisionDraft({ ...decisionDraft, detail })} />
          <SelectField label={t("Exact revision")} isRequired items={decisionTargets} selectedKey={decisionDraft.targetKey || null} onSelectionChange={(key) => setDecisionDraft({ ...decisionDraft, targetKey: String(key ?? "") })} />
          <DateField label={t("Due date")} isRequired value={dateValue(decisionDraft.dueDate)} onChange={(date) => setDecisionDraft({ ...decisionDraft, dueDate: date?.toString() ?? "" })} />
        </FormSection>
        <FormSection title={t("Choices")}>
          <TextInput label={t("First choice")} isRequired value={decisionDraft.firstChoice} onChange={(firstChoice) => setDecisionDraft({ ...decisionDraft, firstChoice })} />
          <TextInput label={t("Second choice")} isRequired value={decisionDraft.secondChoice} onChange={(secondChoice) => setDecisionDraft({ ...decisionDraft, secondChoice })} />
        </FormSection>
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
        <FormSection>
          {accepted && <SelectField label={t("Change type")} isRequired items={changeKinds.map((kind) => ({ id: kind.value, label: translateKnown(t, kind.label) }))} selectedKey={changeDraft.kind}
            onSelectionChange={(key) => setChangeDraft({ ...changeDraft, kind: String(key ?? "addition") as ControlledChangeKind, sourceLineIds: [] })} />}
          <TextInput label={t("Title")} isRequired maxLength={160} value={accepted ? changeDraft.title : draft.title}
            onChange={(title) => accepted ? setChangeDraft({ ...changeDraft, title }) : setDraft({ ...draft, title })} />
          <TextAreaField label={t("What needs to change or be clarified?")} isRequired value={accepted ? changeDraft.detail : draft.detail}
            onChange={(detail) => accepted ? setChangeDraft({ ...changeDraft, detail }) : setDraft({ ...draft, detail })} />
        </FormSection>
        {accepted && contractLines.length > 0 && <FormSection title={linesRequired ? t("Affected accepted items") : `${t("Affected accepted items")} · ${t("Optional")}`}>
          {contractLines.map((line) => <Checkbox key={line.id} isSelected={changeDraft.sourceLineIds.includes(line.id)} onChange={(chosen) => setChangeDraft({
            ...changeDraft,
            sourceLineIds: chosen ? [...changeDraft.sourceLineIds, line.id] : changeDraft.sourceLineIds.filter((id) => id !== line.id),
          })}>V{line.quoteNumber} · {line.room} · {line.title} · {t("{quantity} {unit} remaining", { quantity: line.remainingQuantity, unit: line.unit })}</Checkbox>)}
        </FormSection>}
        {accepted && <FormSection title={t("Follow-up")}>
          <TextInput label={t("Owner")} value={changeDraft.owner} onChange={(owner) => setChangeDraft({ ...changeDraft, owner })} />
          <DateField label={t("Due date")} value={dateValue(changeDraft.dueDate)} onChange={(date) => setChangeDraft({ ...changeDraft, dueDate: date?.toString() ?? "" })} />
        </FormSection>}
      </FormDialog>
      <FormDialog
        isOpen={Boolean(request)}
        // The reply being written belongs to this request: closing it lets it go, so another request starts clean.
        onClose={() => { setSelected(""); setComment(""); setInternal(false); setReplyFiles([]); setReplyFileError(""); }}
        title={request?.title ?? t("Request")}
        size="lg"
        hideSubmit={!state.canEdit}
        cancelLabel={t("Close")}
        submitLabel={t("Add reply")}
        isSubmitting={busy}
        // A reply the client reads can be just files; an internal note carries none.
        isSubmitDisabled={replyUploading || (!comment.trim() && (internal || !replyFiles.length))}
        isDirty={Boolean(comment.trim() || replyFiles.length)}
        fieldMarkers="none"
        error={error || undefined}
        onSubmit={async () => {
          if (!request) return;
          const files = !internal && replyFiles.length ? { assetIds: replyFiles.map((file) => file.id) } : {};
          if (!(await run("comment", { requestId: request.id, text: comment, visibility: internal ? "internal" : "client", ...files }))) throw new FormNotSaved();
          setComment("");
          setReplyFiles([]);
          setReplyFileError("");
          void threads.load();
        }}
      >
        {request && <>
          {raiser(request) ? <p className={s.muted}>{raiser(request)!.client ? t("From {name} · Client", { name: raiser(request)!.name }) : t("From {name}", { name: raiser(request)!.name })}</p> : null}
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
                <small>{c.visibility === "internal" ? t("Internal note") : fromClient(c) ? t("Client") : t("Reply to client")}</small>
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
            {!internal ? <div className={s.replyFiles}>
              {replyFiles.length ? <ul aria-label={t("Files to send")}>{replyFiles.map((file) => <li key={file.id}>
                <span>{file.name}</span>
                <IconButton aria-label={t("Remove {name}", { name: file.name })} onPress={() => setReplyFiles((files) => files.filter((item) => item.id !== file.id))}><X size={14} /></IconButton>
              </li>)}</ul> : null}
              {replyUploading ? <InlineNotice message={t("Uploading…")} />
                : replyFiles.length < REPLY_FILE_LIMIT ? <FileUploader accept={REPLY_FILE_TYPES} appearance="button" label={t("Attach photos or PDFs to the reply")} onFiles={(files) => void attachToReply(files)} /> : null}
              {replyFileError ? <InlineNotice message={replyFileError} tone="error" /> : null}
            </div> : null}
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
  const { currency: workspaceCurrency, locale, timeZone } = useDesignSystem();
  const accepted = state.data.servicePath
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
    [receiptEvidence, setReceiptEvidence] = useState(""),
    [receiptFiles, setReceiptFiles] = useState<EvidenceFile[]>([]),
    [receiptUploading, setReceiptUploading] = useState(false),
    [receiptMethod, setReceiptMethod] = useState<ManualPaymentMethod>("bank"),
    [receivedOn, setReceivedOn] = useState(""),
    [reviewAgreement, setReviewAgreement] = useState(false);
  const todayHere = today(timeZone);
  // A new receipt starts as a bank transfer received today; one recorded from the client's report takes its date.
  const openReceipt = (paymentId: string, ref: string, paidOn = "") => {
    setVerify(paymentId); setReference(ref); setReceiptEvidence(""); setReceiptFiles([]); setReceiptMethod("bank");
    setReceivedOn(paidOn && paidOn <= todayHere.toString() ? paidOn.slice(0, 10) : todayHere.toString());
  };
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
    verifying = receiptPayment?.status === "proof_submitted",
    // A receipt the team recorded can go back with a reason; a provider's settlement is reversed by the provider.
    canSendBack = verifying && activeReceipt?.source === "manual";
  const paymentCurrency = accepted?.currency ?? state.currency ?? workspaceCurrency;
  const agreementChanged = agreement.reference !== savedAgreement.reference || agreement.terms !== savedAgreement.terms || agreement.evidence !== savedAgreement.evidence;
  // Why the signed agreement can't be verified yet: unsaved edits, or nothing signed on record (a file or its description).
  const verifyBlocker = agreementChanged ? t("Save the agreement first.") : !agreementHasSignedEvidence(a) ? t("Attach the signed agreement first.") : "";
  const receiptLabel = (status?: string) => status === "finance_verified" ? t("Finance verified") : status === "provider_confirmed" ? t("Provider confirmed") : status === "reported" ? t("Receipt reported") : t("Payment request only");
  return (
    <>
      {!accepted ? (
        <EmptyState illustration="locked" title={t("Accept the quotation first")} description={t("The agreement and payments follow the exact accepted version.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/pre-projects/cases/${state.caseId}/quotations`}>{t("Open quotations")}</Link>} />
      ) : tab === "agreement" ? (
        <div className={s.agreementPanel}>
          {/* Guide J: the deal path, with this step's one action beside its next step. */}
          <DealPath state={state} root={`/workspace/pre-projects/cases/${state.caseId}`} action={!a && state.canEdit
            ? <Button size="compact" variant="primary" isDisabled={busy} isLoading={busy} onPress={() => void run("agreement", { ...agreement, quoteId: accepted.id })}>{t("Prepare agreement")}</Button>
            : a && a.status !== "executed" && state.canApprove
              // Waits for the signed copy (attached right below, which says so).
              ? <Button size="compact" variant="primary" isDisabled={busy || Boolean(verifyBlocker)} onPress={() => setReviewAgreement(true)}>{t("Review signed agreement")}</Button> : undefined} />
          <div className={s.agreementFacts} aria-label={t("Accepted quotation")}>
            <Badge>{t("Q-{number}", { number: accepted.number })}</Badge>
            <Badge>{money(accepted.clientDecision?.acceptedTotal ?? accepted.total, accepted.currency)}</Badge>
            {accepted.decidedBy ? <Badge>{accepted.decidedBy}</Badge> : null}
            {accepted.clientDecision?.selectedOptionLineIds.length ? <Badge>{t("{count} selected options", { count: accepted.clientDecision.selectedOptionLineIds.length })}</Badge> : null}
            {a?.reference ? <Badge tone="info">{a.reference}</Badge> : null}
          </div>
          {a?.status === "executed" ? <dl className={s.agreementReadout}>
            <div><dt>{t("Agreement reference")}</dt><dd>{a.reference}</dd></div>
            <div><dt>{t("Agreed terms")}</dt><dd>{a.terms}</dd></div>
            <div><dt>{t("Signing details")}</dt><dd>{a.evidence}</dd></div>
          </dl> : !a ? null : <Form className={s.agreementForm} onSubmit={(event) => { event.preventDefault(); void run("agreement", { ...agreement, quoteId: accepted.id }); }}>
            {/* The terms come from the quotation; the signing notes are optional (the signed copy is the evidence). */}
            <MoreDetails filled={[agreement.terms, agreement.evidence].filter((value) => value?.trim()).length}>
              <TextAreaField isDisabled={!state.canEdit || busy} label={t("Agreed terms")} value={agreement.terms}
                onChange={terms => setAgreement({ ...agreement, terms })} />
              <TextAreaField isDisabled={!state.canEdit || busy} label={t("Signing notes")} value={agreement.evidence}
                onChange={evidence => setAgreement({ ...agreement, evidence })}
                description={t("Document reference, signers and date.")} />
              {state.canEdit && agreementChanged ? <div className={s.formActions}><Button type="submit" size="compact" isDisabled={busy} isLoading={busy}>{t("Save")}</Button></div> : null}
            </MoreDetails>
          </Form>}
          {a ? <AgreementFiles state={state} run={run} busy={busy} /> : null}
          {a?.status === "executed" ? (
            <p className={s.notice}>
              {t("Signed agreement verified by")}{" "}<strong>{a.executedBy}</strong> ·{" "}
              {a.executedAt ? <time dateTime={a.executedAt}>{formatDate(a.executedAt, { locale, timeZone })}</time> : null}
            </p>
          ) : a && state.canApprove && verifyBlocker ? <p className={s.muted} role="status">{verifyBlocker}</p> : null}
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            {state.data.financeContext ? (
              <p className={s.detail}>
                {state.data.financeContext.displayName} · {state.data.financeContext.code} · {state.data.financeContext.currency}
                {/* The tax setup in plain words when the region's rates aren't confirmed yet. */}
                {state.data.financeContext.taxValidation === "unvalidated" ? <> <Badge tone="warning">{t("Tax rates not confirmed for this region")}</Badge></> : null}
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
            { id: "status", header: t("Status"), size: 120, accessorFn: (p) => translateKnown(t, statusLabel[p.status] ?? p.status), cell: ({ row: { original: p } }) => <CommercialStatus status={p.status}>{translateKnown(t, statusLabel[p.status] ?? p.status)}</CommercialStatus> },
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
                  <Button size="compact" onPress={() => openReceipt(p.id, p.reference)}>{t("Record receipt")}</Button>
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
      {/* §0.3 P0: verifying the signed agreement is a review of what was signed, never one click. */}
      {reviewAgreement && a && accepted ? <ReviewDialog title={t("Verify signed agreement")} description={a.reference || undefined} confirmLabel={t("Verify signed agreement")}
        blocked={verifyBlocker || undefined} onClose={() => setReviewAgreement(false)}
        facts={[
          { icon: <FileCheck2 />, label: t("Accepted quotation"), value: `${t("Accepted quotation V")}${accepted.number} · ${money(accepted.clientDecision?.acceptedTotal ?? accepted.total, accepted.currency)}` },
          { icon: <ScrollText />, label: t("Agreed terms"), value: a.terms || "—" },
          { icon: <PenLine />, label: t("Signing details"), value: a.evidence || "—" },
        ]}
        evidence={<AssetFiles workspaceId={state.workspaceId} caseId={state.caseId} assets={a.files ?? []} />}
        onConfirm={async () => { if (!(await run("execute_agreement"))) throw new FormNotSaved(); setReviewAgreement(false); }} /> : null}
      {reportPayment && reportsFor(reportPayment.id).length ? <ClientReportDialog milestone={reportPayment.title} reports={reportsFor(reportPayment.id)} client={client}
        currency={state.data.quotes.find((q) => q.id === reportPayment.sourceQuoteId)?.currency ?? accepted?.currency ?? state.currency ?? workspaceCurrency}
        milestoneAmount={reportPayment.amount} hasReceipt={Boolean(receiptOf(reportPayment.id))}
        canRecordReceipt={state.canEdit && reportPayment.status !== "verified" && !reportPayment.invoice}
        onRecordReceipt={(report) => { setReportFor(null); setAfterReceipt(reportPayment.id); openReceipt(reportPayment.id, report.reference || reportPayment.reference, report.paidOn); }}
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
        <MoneyField label={t("Amount")} currency={paymentCurrency} isRequired min={smallestAmount(paymentCurrency)} isDisabled={Boolean(payment.sourceQuoteId)}
          value={payment.amount} onChange={amount => setPayment({ ...payment, amount })} />
        <DateField label={t("Due date")} isRequired value={dateValue(payment.dueDate)}
          onChange={date => setPayment({ ...payment, dueDate: date?.toString() ?? "" })} />
        <FormSection title={t("Required before")}>
          <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForRelease} onChange={requiredForRelease => setPayment({ ...payment, requiredForRelease })}>{t("Execution release")}</Checkbox>
          <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForProduction} onChange={requiredForProduction => setPayment({ ...payment, requiredForProduction })}>{t("Manufacturing starts")}</Checkbox>
        </FormSection>
        {payment.sourceQuoteId ? <p className={s.detail}>{t("The milestone amount and conditions are fixed by the accepted quotation.")}</p> : null}
        <MoreDetails filled={payment.reference ? 1 : 0}>
          <TextInput label={t("Invoice reference")} maxLength={240} value={payment.reference} onChange={reference => setPayment({ ...payment, reference })} />
        </MoreDetails>
      </FormDialog> : null}
      {/* §0.3 P0: verifying a receipt is a review: the amounts, the proof beside it, then confirm or send it back. */}
      {verify && verifying ? <ReviewDialog
        title={t("Finance verification")}
        description={activeReceipt?.source === "provider" ? t("Confirm the provider settlement against the finance record.") : t("Confirm the reported receipt against the finance record.")}
        evidence={receiptPayment && activeReceipt && accepted ? <ReceiptReview receipt={activeReceipt} milestone={receiptPayment.title} quote={accepted} /> : null}
        files={activeReceipt ? [...evidenceFiles(state.workspaceId, state.receiptFiles?.[activeReceipt.id]),
          ...reportsFor(activeReceipt.paymentId).flatMap((report) => report.files.map((file) => ({ id: `${report.id}:${file.id}`, name: file.name,
            href: client.fileUrl(file.id), previewHref: file.hasPreview ? client.fileUrl(file.id, true) : null })))] : undefined}
        confirmLabel={t("Verify receipt")}
        returnLabel={canSendBack ? t("Send back") : undefined}
        onReturn={canSendBack ? async (note) => {
          if (!(await run("return_payment", { paymentId: verify, note }))) throw new FormNotSaved();
          setVerify(""); setAfterReceipt(null);
        } : undefined}
        onConfirm={async () => {
          if (!(await run("verify_payment", { paymentId: verify }))) throw new FormNotSaved();
          setVerify("");
          if (afterReceipt) { setReportFor(afterReceipt); setAfterReceipt(null); }
        }}
        onClose={() => { setVerify(""); setAfterReceipt(null); }}
      /> : null}
      <FormDialog
        isOpen={Boolean(verify) && !verifying}
        onClose={() => { setVerify(""); setAfterReceipt(null); }}
        title={t("Record payment receipt")}
        error={error || undefined}
        isSubmitting={busy}
        isDirty={Boolean(receiptEvidence.trim() || receiptFiles.length)}
        isSubmitDisabled={receiptUploading || !receiptFiles.length}
        submitLabel={t("Record receipt")}
        onSubmit={async () => {
          if (!(await run("report_payment_receipt", { paymentId: verify, reference, evidence: receiptEvidence, evidenceFileIds: receiptFiles.map((file) => file.id), method: receiptMethod, receivedOn }))) throw new FormNotSaved();
          setVerify("");
          // Recorded from the client's report: back to it, to mark it recorded.
          if (afterReceipt) { setReportFor(afterReceipt); setAfterReceipt(null); }
        }}
      >
        <FormRow>
          <SelectField isRequired label={t("Payment method")} selectedKey={receiptMethod}
            items={MANUAL_PAYMENT_METHODS.map((method) => ({ id: method, label: translateKnown(t, paymentMethodLabel[method]) }))}
            onSelectionChange={(key) => setReceiptMethod(String(key ?? "bank") as ManualPaymentMethod)} />
          <DateField label={t("Received on")} isRequired maxValue={todayHere} value={dateValue(receivedOn)}
            onChange={(date) => setReceivedOn(date?.toString() ?? "")} />
        </FormRow>
        <TextInput isRequired maxLength={240} label={t("Receipt / transaction reference")} value={reference} onChange={setReference} />
        <EvidenceField workspaceId={state.workspaceId} kind="receipt" isRequired label={t("Proof of payment")} value={receiptFiles} onChange={setReceiptFiles} onBusy={setReceiptUploading} />
        <TextAreaField label={t("Note")} maxLength={3000} value={receiptEvidence} onChange={setReceiptEvidence} />
      </FormDialog>
    </>
  );
}

/**
 * What Finance checks before verifying a receipt (§0.3 P0): the amount split into net and tax at the accepted
 * quotation's rate, how and when it was paid, and who recorded it. Read only; Verify is the dialog's action.
 */
function ReceiptReview({ receipt, milestone, quote }: { receipt: NonNullable<CommercialState["data"]["receipts"]>[number]; milestone: string; quote: CommercialState["data"]["quotes"][number] }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const split = taxInside(receipt.amount, quote.taxRate, receipt.currency);
  const taxLabel = t("{label} ({rate}%)", { label: translateKnown(t, quote.cover?.taxLabel || "Tax"), rate: quote.taxRate });
  return <>
    <AmountList label={milestone} rows={[
      { id: "net", label: t("Net"), amount: money(split.net, receipt.currency, locale) },
      { id: "tax", label: taxLabel, amount: money(split.tax, receipt.currency, locale) },
      { id: "total", label: t("Total"), amount: <strong>{money(receipt.amount, receipt.currency, locale)}</strong> },
    ]} />
    <dl className={s.agreementReadout}>
      <div><dt>{t("Payment method")}</dt><dd>{receipt.method ? translateKnown(t, paymentMethodLabel[receipt.method]) : receipt.provider ?? "—"}</dd></div>
      <div><dt>{t("Received on")}</dt><dd>{receipt.receivedOn ? formatDate(receipt.receivedOn, { locale, timeZone }) : "—"}</dd></div>
      <div><dt>{t("Receipt / transaction reference")}</dt><dd>{receipt.reference || "—"}</dd></div>
      <div><dt>{t("Receipt evidence")}</dt><dd>{receipt.evidence || "—"}</dd></div>
      <div><dt>{t("Recorded by")}</dt><dd>{receipt.reportedBy} · {formatDate(receipt.reportedAt, { locale, timeZone })}</dd></div>
    </dl>
  </>;
}

/** One commission line: who, what kind, and an amount or a share. */
function CommissionFields({ types, currency, index, line, onChange, onRemove, fixedRecipient }: { types: CommissionType[]; currency: string; index: number; line: CommissionDraft; onChange: (next: Partial<CommissionDraft>) => void; onRemove?: () => void; fixedRecipient?: boolean }) {
  const t = useT();
  const kind = (code: string) => KIT_COMMISSION_LABELS[code] && types.find((type) => type.code === code)?.label === KIT_COMMISSION_TYPES.find((type) => type.code === code)?.label
    ? t(KIT_COMMISSION_LABELS[code]) : types.find((type) => type.code === code)?.label ?? code;
  const title = fixedRecipient ? `${line.recipientName} · ${kind(line.type)}` : t("Commission {number}", { number: index + 1 });
  // An untouched row is optional; once it's being filled in, it needs a recipient and a value.
  const required = Boolean(fixedRecipient) || !commissionBlank(line);
  return <FormSection title={<span className={s.commissionTitle}>{title}{onRemove ? <IconButton aria-label={t("Remove commission {number}", { number: index + 1 })} onPress={onRemove}><X size={14} /></IconButton> : null}</span>}>
    {fixedRecipient ? null : <>
      <TextInput isRequired={required} label={t("Recipient")} maxLength={160} value={line.recipientName} onChange={(recipientName) => onChange({ recipientName })} />
      <SelectField isRequired={required} label={t("Type")} items={types.map((type) => ({ id: type.code, label: kind(type.code) }))} selectedKey={line.type}
        onSelectionChange={(key) => onChange({ type: String(key ?? types[0]?.code ?? "sales") })} />
    </>}
    {/* The amount and what it is counted in (the currency, or a percentage) stay side by side. */}
    <FormRow>
      <SelectField isRequired={required} label={t("Basis")} items={[{ id: "amount", label: currency }, { id: "percent", label: t("Percentage") }]} selectedKey={line.basis}
        onSelectionChange={(key) => onChange({ basis: String(key ?? "amount") as CommissionDraft["basis"], value: "" })} />
      {line.basis === "percent"
        ? <PercentageInput isRequired={required} label={t("Share")} minValue={0.01} value={line.value ? Number(line.value) : Number.NaN} onChange={(value) => onChange({ value: Number.isFinite(value) ? String(value) : "" })} />
        : <MoneyField isRequired={required} label={t("Amount")} currency={currency} min={smallestAmount(currency)} value={line.value} onChange={(value) => onChange({ value })} />}
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
  // §0.3 P3: the firm's own commission types (Setup → Commissions).
  const commissionKinds = useCommissionTypes(state.workspaceId);
  const { locale, timeZone } = useDesignSystem();
  const day = (value: string) => <time dateTime={value}>{formatDate(value, { locale, timeZone })}</time>;
  // A line without a cost leaves the margin unknown: never a false 100%.
  const marginText = (margin: number | null) => (margin === null ? t("Cost missing") : `${margin.toFixed(1)}%`);
  const [tab, setTab] = useState<string>(initialView),
    // Finance's note and the approver's remarks are separate: one never pre-fills the other (the owner's is in the review).
    [decisionNote, setDecisionNote] = useState(""),
    [ownerReviewOpen, setOwnerReviewOpen] = useState(false),
    [proofOpen, setProofOpen] = useState(false),
    [starting, setStarting] = useState(false),
    [commissionLines, setCommissionLines] = useState<CommissionDraft[]>(state.data.ownerReview?.commissionLines?.map(draftOf) ?? [newCommissionLine()]),
    [financeDraft, setFinanceDraft] = useState<{ key: string; lines: CommissionDraft[] }>({ key: "", lines: [] }),
    [paymentProofUrl] = useState(state.data.ownerReview?.paymentProofUrl ?? ""),
    [paymentVerification, setPaymentVerification] = useState<{ key: string; value: boolean }>({ key: "", value: false }),
    [approver, setApprover] = useState(""),
    [materialDraft, setMaterialDraft] = useState<MaterialApproval | null>(null),
    [photoProblem, setPhotoProblem] = useState("");
  // The Deal File's long lists (requirements, approvals, history) as sub-tabs; a KPI tile opens its tab.
  const sections = useSectionTabs("requirements");
  const d = state.data,
    accepted = d.servicePath
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
  // A receipt Finance already verified in Wodana is the proof; a link given anyway must be HTTPS.
  const receiptVerified = Boolean(accepted && quoteHasVerifiedReceipt(d, accepted.id));
  // PLM-122: the payment proof attached on the opportunity (it made the deal Won) is the Deal File's proof.
  const attachedProof = state.paymentProofId && state.opportunityId ? `/api/workspace/crm/opportunity-proofs/${state.opportunityId}/${state.paymentProofId}?workspaceId=${encodeURIComponent(state.workspaceId)}` : "";
  const proofProblem = paymentProofProblem(paymentProofUrl, receiptVerified || Boolean(attachedProof));
  // The deal checklist is read from the records, never ticked (§0.3 P0); the owner's approval waits for every line.
  const dealChecks = accepted ? [
    { id: "agreement", label: tKey("Signed agreement verified"), done: agreementIsOperational(d.agreement) && agreementMatchesAcceptedQuote(d.agreement, accepted) },
    { id: "documents", label: tKey("Signed agreement on file"), done: agreementHasSignedEvidence(d.agreement) },
    { id: "payment", label: tKey("Payment proof"), done: Boolean(attachedProof) || receiptVerified || Boolean(d.ownerReview?.paymentProofUrl ?? paymentProofUrl.trim()) },
    { id: "boq", label: tKey("Priced quotation lines"), done: accepted.round === "design" || accepted.lines.length > 0 },
    ...(d.servicePath ? [] : [{ id: "materials", label: tKey("Client material decisions"), done: materialApprovalsComplete(accepted, d.materialApprovals) }]),
  ] : [];
  const dealChecksMissing = dealChecks.some((check) => !check.done);
  // When Sales sent no commission lines, Finance adds them (PLM-122).
  const financeAddsLines = !submittedCommissions.length;
  const insecureProof = t("Use a secure HTTPS proof-of-payment link.");
  // Opening the Deal File by hand needs only the proof (the opportunity's, or a payment Finance verified); Finance adds commissions.
  const sendBlocker = proofProblem === "missing" ? t("Attach the payment proof first.") : proofProblem === "insecure" ? insecureProof : "";
  const checks = [
    { label: tKey("Client accepted the quotation"), done: Boolean(deliveryQuote), href: "quotations" },
    {
      label: tKey("Linked design revisions approved"),
      done: Boolean(
        deliveryQuote &&
          ((d.servicePath && !d.servicePath.scope.design) ||
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
      done: Boolean(deliveryQuote && financeGatePaymentsReady(d, d.servicePath ? deliveryQuote.id : undefined)),
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
        Boolean(deliveryQuote && dealPaymentProofReady(d, d.dealFile?.paymentProofUrl, deliveryQuote.id)) &&
        Array.isArray(d.dealFile?.commissionLines),
      href: "deal-file",
      view: "owner",
    },
    {
      label: tKey("Material selections approved or not applicable"),
      done: Boolean(deliveryQuote && (d.servicePath ? materialListSignedOff(d, deliveryQuote) : materialApprovalsComplete(deliveryQuote, d.materialApprovals))),
      href: "deal-file",
      view: "materials",
    },
    {
      label: tKey("Change requests resolved"),
      done: !d.requests.some(requestBlocksRelease),
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
  // The Deal File at a glance (KPI tiles), then its sections: the step that is next, the requirements, the approvals,
  // the money, the commission, the closing and the team.
  const insight = state.dealInsight ?? null;
  const review = d.ownerReview;
  const requirements = insight ? dealRequirementCount(insight) : null;
  const paidShare = insight ? dealPaidShare(insight) : null;
  const totals = accepted ? acceptedQuoteTotals(accepted) : null;
  const paymentChecked = Boolean(accepted && (receiptVerified
    || (review && review.quoteId === accepted.id && ["pending_approval", "approved"].includes(review.status) && review.financeReviewedById)));
  const reviewText = review ? translateKnown(t, statusLabel[review.status] ?? review.status) : t("Not submitted");
  const reviewTone = !review ? undefined : review.status === "approved" ? "success" : review.status === "rejected" ? "danger" : "warning";
  const showApprovalSteps = Boolean(state.dealApproval && (state.dealApproval.status === "pending" || review?.status === "approved"));
  // The commission as decided: Finance's final lines while the owner decides, the Deal File's once approved.
  const commission = !accepted ? [] : review?.status === "pending_approval" ? review.finalCommissionLines ?? []
    : d.dealFile?.quoteId === accepted.id ? d.dealFile.commissionLines ?? [] : [];
  const commissionTotal = sumExact(commission.map((line) => line.amount), accepted?.currency);
  // The client's payments on the accepted quotation, as recorded (Finance checks the method and the day against the bank).
  const dealReceipts = accepted ? (d.receipts ?? []).filter((receipt) => receipt.status !== "rejected" && d.payments.some((payment) => payment.id === receipt.paymentId && payment.sourceQuoteId === accepted.id)) : [];
  // §0.3 P0: the files the Deal File rests on, beside every check of it: the payment proof, the receipts' proofs and the signed agreement.
  const dealFiles = [
    ...(attachedProof ? [{ id: "proof", name: t("Payment proof"), href: attachedProof, previewHref: null }] : []),
    ...(!attachedProof && (review?.paymentProofUrl || paymentProofUrl) ? [{ id: "proof-link", name: t("Payment proof"), href: review?.paymentProofUrl || paymentProofUrl, previewHref: null }] : []),
    ...dealReceipts.flatMap((receipt) => evidenceFiles(state.workspaceId, state.receiptFiles?.[receipt.id])),
    ...(d.agreement?.quoteId === accepted?.id ? (d.agreement?.files ?? []).map((asset) => ({ id: asset.id, name: asset.name,
      href: caseApi(state.workspaceId, state.caseId, `assets/${asset.id}`), previewHref: asset.hasPreview ? caseApi(state.workspaceId, state.caseId, `assets/${asset.id}?preview=1`) : null })) : []),
  ];
  const costRows = accepted && totals && state.canViewCosts ? [{ id: "cost", label: t("Internal cost"), amount: money(totals.cost, accepted.currency, locale) }] : [];
  const riskText = insight ? dealRiskText(t, insight) : null;
  const riskLine = riskText ? <span className={ds.risks}>{riskText}</span> : null;
  const stepOf = (current: number) => <Badge tone="neutral">{t("Step {current} of {total}", { current, total: 3 })}</Badge>;
  const waitingFor = (names: string[]) => names.length ? <span className={ds.waiting}>
    <span className={ds.avatars} aria-hidden="true">{names.slice(0, 3).map((name) => <Avatar key={name} name={name} seed={`holder-${name}`} size="sm" />)}</span>
    <span>{t("Waiting for {names}", { names: names.join(", ") })}</span>
  </span> : null;
  // Only an approver who didn't submit or verify this deal decides it; everyone else sees who does.
  const canDecide = Boolean(review && state.canApproveDeal && (state.dealApproval?.status === "pending" ? state.dealApproval.canDecide : ![review.submittedById, review.financeReviewedById].includes(state.viewerId)));
  const stepCard = !accepted ? null : review?.status === "pending_finance" ? <NextStepCard id="deal-next" title={t("Finance verification")} why={t("Submitted by {name}", { name: review.submittedBy })}
    meta={<>{waitingFor(state.stepHolders?.verifyPayment ?? [])}{stepOf(2)}</>}>
    <Form className={ds.stepForm} fieldMarkers="none" onSubmit={(event) => { event.preventDefault(); void run("review_deal_finance", { decision: "confirm", note: decisionNote, paymentVerified, commissionLines: editableFinanceLines.map(sent) }); }}>
      <ReviewFiles files={dealFiles} />
      {/* §0.3 P0: what Finance checks: the accepted value split into net and tax, and how and when the client paid. */}
      {totals ? <AmountList label={t("Accepted quotation")} rows={[
        { id: "net", label: t("Net"), amount: money(totals.net, accepted.currency, locale) },
        { id: "tax", label: t("{label} ({rate}%)", { label: translateKnown(t, accepted.cover?.taxLabel || "Tax"), rate: accepted.taxRate }), amount: money(totals.tax, accepted.currency, locale) },
        { id: "total", label: t("Total"), amount: <strong>{money(acceptedQuoteValue(accepted), accepted.currency, locale)}</strong> },
        ...dealReceipts.map((receipt) => ({ id: receipt.id, label: receipt.method ? translateKnown(t, paymentMethodLabel[receipt.method]) : t("Payment"),
          detail: [receipt.receivedOn ? formatDate(receipt.receivedOn, { locale, timeZone }) : null, receipt.reference].filter(Boolean).join(" · "),
          amount: money(receipt.amount, receipt.currency, locale) })),
      ]} /> : null}
      {editableFinanceLines.map((line, index) => <CommissionFields types={commissionKinds} key={`${line.type}-${index}`} fixedRecipient={!financeAddsLines} currency={accepted.currency} index={index} line={line} onChange={(update) => updateCommission(index, update, true)}
        onRemove={financeAddsLines ? () => setFinanceDraft({ key: reviewKey, lines: editableFinanceLines.filter((_, i) => i !== index) }) : undefined} />)}
      {financeAddsLines && editableFinanceLines.length < 3 ? <div><Button size="compact" variant="quiet" onPress={() => setFinanceDraft({ key: reviewKey, lines: [...editableFinanceLines, newCommissionLine()] })}><Plus size={14} />{t("Add recipient")}</Button></div> : null}
      <Checkbox isSelected={paymentVerified} onChange={(value) => setPaymentVerification({ key: reviewKey, value })}>{review.paymentProofUrl ? t("I verified the linked proof of payment") : t("I verified the payment receipt")}</Checkbox>
      <TextAreaField label={t("Finance note")} value={decisionNote} onChange={setDecisionNote} placeholder={t("Explain any correction or reason for return.")} />
      {state.canVerifyFinance && <div className={ds.stepActions}>
        <Button isDisabled={busy || !decisionNote.trim()} onPress={() => void run("review_deal_finance", { decision: "return", note: decisionNote })}>{t("Return to Sales")}</Button>
        <Button type="submit" variant="primary" isLoading={busy} isDisabled={busy || !paymentVerified || !editableFinanceLines.every(commissionReady)}>{t("Confirm Finance review")}</Button>
      </div>}
    </Form>
  </NextStepCard> : review?.status === "pending_approval" ? <NextStepCard id="deal-next" title={t("Owner approval")} why={riskLine}
    meta={<>{waitingFor(state.dealApproval?.status === "pending" ? state.dealApproval.waitingFor : state.stepHolders?.approveDeal ?? [])}{stepOf(3)}</>}>
    <div className={ds.stepForm}>
      <div className={ds.checklist}>
        <h4 className={ds.subhead}>{t("Read from the records")}</h4>
        <CheckList layout="inline" label={t("Read from the records")} items={dealChecks.map((check) => ({ id: check.id, label: translateKnown(t, check.label), done: check.done }))} />
      </div>
      {!d.servicePath && !materialApprovalsComplete(accepted, d.materialApprovals) && <p className={ds.stepNote}>{t("Complete every client material decision before creating the Deal File.")}</p>}
      {/* §0.3 P0: the owner decides in a review of the Deal File (figures, checks read from the records), never one click. */}
      {canDecide ? <div className={ds.stepActions}>
        <Button variant="primary" isDisabled={busy} onPress={() => setOwnerReviewOpen(true)}>{t("Review Deal File")}</Button>
      </div> : null}
      {ownerReviewOpen ? <ReviewDialog title={t("Owner approval")} description={state.customerName} confirmLabel={t("Approve Deal File")} returnLabel={t("Return for correction")} rejectLabel={t("Reject")}
        onClose={() => setOwnerReviewOpen(false)}
        facts={[
          { icon: <FileCheck2 />, label: t("Accepted quotation"), value: `${t("Accepted quotation V")}${accepted.number} · ${money(acceptedQuoteValue(accepted), accepted.currency, locale)}` },
          ...(totals ? [{ icon: <Banknote />, label: t("Net"), value: money(totals.net, accepted.currency, locale) }, { icon: <Receipt />, label: t("{label} ({rate}%)", { label: translateKnown(t, accepted.cover?.taxLabel || "Tax"), rate: accepted.taxRate }), value: money(totals.tax, accepted.currency, locale) }] : []),
          { icon: <UserRound />, label: t("Submitted by"), value: review.submittedBy },
          ...(review.financeNote ? [{ icon: <StickyNote />, label: t("Finance note"), value: review.financeNote }] : []),
          ...(commission.length ? [{ icon: <Percent />, label: t("Commission"), value: money(Number(commissionTotal), accepted.currency, locale) }] : []),
        ]}
        files={dealFiles}
        checks={{ label: t("Read from the records"), items: dealChecks.map((check) => ({ id: check.id, label: translateKnown(t, check.label), done: check.done })) }}
        onConfirm={async (remark) => { if (!(await run("decide_owner_review", { decision: "approve", note: remark }))) throw new FormNotSaved(); setOwnerReviewOpen(false); }}
        onReturn={async (remark) => { if (!(await run("decide_owner_review", { decision: "return", note: remark }))) throw new FormNotSaved(); setOwnerReviewOpen(false); }}
        onReject={async (remark) => { if (!(await run("decide_owner_review", { decision: "reject", note: remark }))) throw new FormNotSaved(); setOwnerReviewOpen(false); }} /> : null}
    </div>
  </NextStepCard> : d.dealFile?.quoteId !== accepted.id ? <NextStepCard id="deal-next" title={t("Deal File")} why={riskLine} meta={stepOf(1)}>
    {/* Guide J: the Deal File opens by itself once the payment proof is attached (and the agreement verified). This step
        only offers what is missing, right here: the proof, or opening it by hand; Finance adds the commissions. */}
    <div className={ds.stepForm}>
      {review ? <p className={ds.stepNote}>{t("Returned:")}{" "}{review.decisionNote ?? review.financeNote}</p> : null}
      <div className={s.agreementFacts}>
        {attachedProof ? <a className="wd-badge" data-tone="success" href={attachedProof} target="_blank" rel="noopener noreferrer">{t("Payment proof attached")}</a>
          : receiptVerified ? <Badge tone="success">{t("Payment verified by Finance")}</Badge> : <Badge>{t("No payment proof yet")}</Badge>}
        <Badge tone={agreementIsOperational(d.agreement) && d.agreement?.quoteId === accepted.id ? "success" : "neutral"}>
          {agreementIsOperational(d.agreement) && d.agreement?.quoteId === accepted.id ? t("Agreement verified") : t("Agreement not verified yet")}</Badge>
      </div>
      <FormSection title={t("Read from the records")}>
        <CheckList layout="inline" label={t("Read from the records")} items={dealChecks.map((check) => ({ id: check.id, label: translateKnown(t, check.label), done: check.done }))} />
      </FormSection>
      {state.canEdit ? <div className={ds.stepActions}>
        {state.opportunityStatus !== "won" && state.opportunityId
          ? <Button variant="primary" onPress={() => setProofOpen(true)}>{t("Attach payment proof")}</Button>
          : <Button variant="primary" isLoading={busy} isDisabled={busy || Boolean(sendBlocker)}
            onPress={() => void run("submit_owner_review", { commissionLines: [], note: review ? t("Sent again after the correction") : t("Opened by hand") })}>{review ? t("Send again") : t("Open Deal File")}</Button>}
        {sendBlocker && state.opportunityStatus === "won" ? <span className={s.muted} role="status">{sendBlocker}</span> : null}
      </div> : null}
      {proofOpen && state.opportunityId ? <PaymentProofDialog workspaceId={state.workspaceId} opportunityId={state.opportunityId}
        proposal={accepted.round === "design" ? "design" : "main"}
        loadVersion={async () => Number((await crmRequest<{ version?: number }>(state.workspaceId, `opportunities/${state.opportunityId}`)).version ?? 1)}
        onClose={() => setProofOpen(false)} onWon={() => { window.location.reload(); }} onBlocked={() => setProofOpen(false)} /> : null}
    </div>
  </NextStepCard> : <NextStepCard id="deal-next" status="done" title={t("Deal File approved")} why={riskLine} />;
  return (
    <>
      {tab === "owner" ? (
        !accepted ? (
          <EmptyState illustration="locked" title={t("Client acceptance comes first")} description={t("Issue the reviewed quotation and wait for the client approver.")}
            action={<Link className="wd-button" data-size="compact" data-variant="primary" href={sectionHref?.("quotations") ?? `${root}/quotations`}>{t("Open quotations")}</Link>} />
        ) : <div className={ds.overview} data-tour="deal-approvals">
          {/* The few numbers and states that decide the deal; each tile opens its section. */}
          <KpiStrip label={t("Deal File summary")}>
            <KpiTile label={t("Deal value")} value={money(d.dealFile?.quoteId === accepted.id ? d.dealFile.value : acceptedQuoteValue(accepted), accepted.currency, locale)}
              detail={t("Quotation V{number}", { number: accepted.number })} href={sectionHref?.("quotations") ?? `${root}/quotations`} />
            {/* Costs are stripped for people who can't see them; showing 0 and 100% would mislead. */}
            {state.canViewCosts && totals ? <KpiTile label={t("Gross margin")} value={marginText(totals.margin)}
              tone={totals.margin === null ? "warning" : insight?.risks.includes("margin_below_floor") ? "danger" : undefined} /> : null}
            {requirements ? <KpiTile label={t("Requirements")} value={t("{done} of {total}", { done: requirements.done, total: requirements.total })}
              detail={requirements.missing ? t("{count} missing", { count: requirements.missing }) : null} tone={requirements.missing ? "warning" : "success"} onPress={() => sections.open("requirements")} /> : null}
            <KpiTile label={t("Payment")} value={paymentChecked ? t("Verified") : t("Not verified")} tone={paymentChecked ? "success" : "warning"}
              detail={paidShare !== null ? t("{percent}% paid", { percent: paidShare }) : null} href={sectionHref?.("payment-plan") ?? `${root}/payment-plan`} />
            <KpiTile label={t("Internal approval")} value={reviewText} tone={reviewTone}
              detail={d.dealFile?.quoteId === accepted.id ? formatDate(d.dealFile.approvedAt, { locale, timeZone }) : null}
              {...(showApprovalSteps ? { onPress: () => sections.open("approvals") } : { href: "#deal-next" })} />
            {commission.length ? <KpiTile label={t("Commission")} value={money(commissionTotal, accepted.currency, locale)}
              detail={commission.length === 1 ? commission[0].recipientName : t("{count} people", { count: commission.length })} href="#deal-commission" /> : null}
          </KpiStrip>
          <div className={ds.columns}>
            <div className={ds.column}>
              {stepCard}
              {/* The long lists as sub-tabs under the next step, each in its card (the tab names it): what the Deal File
                  holds (PLM-066 / PLM-102 / PLM-123), the approval's steps (E3) and the history. */}
              <SectionTabs tab={sections.tab} onTabChange={sections.setTab} tabsRef={sections.ref} tabs={[
                ...(insight ? [{ id: "requirements", label: t("Requirements"), panel: <DealRequirements insight={insight} /> }] : []),
                ...(showApprovalSteps && state.dealApproval ? [{ id: "approvals", label: t("Approvals"), panel: <Card><DealApprovalSteps approval={state.dealApproval} /></Card> }] : []),
                ...(d.dealFile ? [{ id: "history", label: t("History"), panel: <Card><RecordHistory workspaceId={state.workspaceId} recordType="deal_file" recordId={d.dealFile.id} /></Card> }] : []),
                // The client's material decisions (a deal without a material list signs them here).
                ...(!d.servicePath || (d.materialApprovals ?? []).length ? [{ id: "materials", label: t("Material decisions"), panel: <Button size="compact" variant="quiet" onPress={() => setTab("materials")}>{t("Open material decisions")}</Button> }] : []),
              ]} />
            </div>
            <div className={ds.column}>
              {d.dealFile ? <SideSection title={t("Deal File")} chip={<StateChip state="done" label={t("Approved")} />}>
                <FactList facts={[
                  { label: t("Reference"), value: d.dealFile.reference },
                  { label: t("Approved"), value: <>{day(d.dealFile.approvedAt)}<small>{d.dealFile.approvedBy}</small></> },
                  { label: t("Current round"), value: d.dealFile.quoteId === accepted.id ? accepted.round === "design" ? t("Design") : t("Main quotation") : t("Design approved · main pending") },
                  { label: t("Frozen evidence"), value: `${d.dealFile.designEvidence?.links?.length ?? 0} ${t("files ·")} ${d.dealFile.materialEvidence?.length ?? 0} ${t("materials")}` },
                ]} />
              </SideSection> : null}
              {insight ? <DealMoney insight={insight} withAgreed={false} extra={costRows} />
                : costRows.length ? <SideSection title={t("Money")}><AmountList label={t("Money")} rows={costRows} /></SideSection> : null}
              {commission.length ? <SideSection id="deal-commission" title={t("Commission")}>
                <AmountList label={t("Commission")} rows={commission.map((line, index) => ({ id: `${line.type}-${index}`,
                  label: <PersonChip id={`commission-${line.recipientName}`} name={line.recipientName} />,
                  detail: KIT_COMMISSION_LABELS[line.type] && !commissionKinds.some((type) => type.code === line.type && type.label !== KIT_COMMISSION_TYPES.find((kit) => kit.code === line.type)?.label) ? t(KIT_COMMISSION_LABELS[line.type]) : commissionKinds.find((type) => type.code === line.type)?.label ?? line.type, amount: money(line.amount, accepted.currency, locale) }))}
                  total={commission.length > 1 ? { label: t("Total"), amount: money(commissionTotal, accepted.currency, locale) } : undefined} />
              </SideSection> : null}
              {insight ? <DealClosing insight={insight} /> : null}
              {insight ? <DealTeam insight={insight} /> : null}
              {/* PLM-164: once the deal is a project, every record it runs through, each a link. */}
              {insight?.links ? <LinkedRecords links={insight.links} current="deal_file" /> : null}
            </div>
          </div>
        </div>
      ) : tab === "materials" ? (
        <>
          <div><Button size="compact" variant="quiet" onPress={() => setTab("owner")}>{t("Back to the Deal File")}</Button></div>
          <div className={s.header}><h2>{t("Client material selections")}</h2>{state.canEdit && <Button size="compact" isDisabled={busy || !accepted || (Boolean(d.servicePath) && d.dealFile?.quoteId !== accepted.id)} onPress={() => void run("sync_material_approvals")}>{t("Prepare from quotation")}</Button>}</div>
          {(d.materialApprovals ?? []).filter(item => item.quoteId === accepted?.id).map(item => <div className={s.materialRow} key={item.id}>
            {item.photo ? <Image src={item.photo} alt="" width={64} height={64} unoptimized /> : <span className={s.materialThumb}>{t("No photo")}</span>}
            <div><strong>{item.name}</strong><span>{item.room} · {item.item}</span><small>{[item.brand, item.code].filter(Boolean).join(" · ") || item.specification}</small>{item.decisionNote && <small>{t("Client remark:")}{" "}{item.decisionNote}</small>}</div>
            <CommercialStatus status={item.status}>{translateKnown(t, statusLabel[item.status] ?? item.status.replaceAll("_", " "))}</CommercialStatus>
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
            <TextInput label={t("Brand")} value={materialDraft.brand} onChange={brand => setMaterialDraft({ ...materialDraft, brand })} />
            <TextInput label={t("Product code")} value={materialDraft.code} onChange={code => setMaterialDraft({ ...materialDraft, code })} />
            <TextAreaField isRequired label={t("Specification")} value={materialDraft.specification} onChange={specification => setMaterialDraft({ ...materialDraft, specification })} />
            <MoreDetails filled={(materialDraft.note ? 1 : 0) + (materialDraft.photo ? 1 : 0)}>
              <TextAreaField label={t("Internal note")} value={materialDraft.note} onChange={note => setMaterialDraft({ ...materialDraft, note })} />
              <FileUploader accept="image/png,image/jpeg,image/webp" appearance="button" label={t("Sample photo")} multiple={false} onFiles={(files) => readPhoto(files[0])} />
              {photoProblem ? <InlineNotice tone="error" message={photoProblem} /> : <small className={s.detail}>{t("PNG, JPEG or WebP · up to 180 KB.")}</small>}
            </MoreDetails>
          </FormDialog> : null}
        </>
      ) : tab === "release" ? (
        d.servicePath && !d.servicePath.scope.mainQuotation ? <EmptyState illustration="done" title={t("Design-only project")} description={t("This path ends with the approved design. Procurement and production don’t apply.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={sectionHref?.("designs") ?? `${root}/designs`}>{t("Open design")}</Link>} /> : <>
          {/* Guide §16–21: what the work waits for, each with its state and where to finish it; the one action starts the project. */}
          <ul className={s.releaseChecks}>
            {checks.map((c) => (
              <li key={c.label}>
                <Badge tone={c.done ? "success" : "neutral"}>{c.done ? t("Done") : t("Waiting")}</Badge>
                <span>{t(c.label)}</span>
                {!c.done ? <Link className="wd-button" data-size="compact" data-variant="quiet" href={sectionHref?.(c.view === "materials" || c.view === "owner" ? "deal-file" : c.href) ?? `${root}/${c.view ? "deal-file" : c.href}`}>{t("Open")}</Link> : null}
              </li>
            ))}
          </ul>
          {d.release?.projectId ? <div className={s.releaseAction}>
            <Badge tone="success">{t("Project started")}</Badge>
            <Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/projects/${d.release.projectId}/overview`}>{t("Open project")}</Link>
          </div> : state.canRelease ? <div className={s.releaseAction}>
            <span className={s.muted}>{checks.every((c) => c.done) ? t("Everything is ready: start the project to release the work.") : t("The project starts once every check is done.")}</span>
            <Button variant="primary" isDisabled={busy || !checks.every((c) => c.done)} onPress={() => setStarting(true)}>{t("Start project")}</Button>
          </div> : null}
          {starting ? <StartProjectDialog workspaceId={state.workspaceId} caseId={state.caseId} onClose={() => setStarting(false)} /> : null}
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
