"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { ClientCredits } from "./client-credits";
import { PaymentInvoice } from "./payment-invoice";
import { AgreementFiles } from "./agreement-files";
import { useState } from "react";
import { parseDate } from "@internationalized/date";
import Link from "next/link";
import Image from "next/image";
import { Plus } from "lucide-react";
import {
  Button,
  Checkbox,
  ControlledModalDialog,
  DataGrid,
  DateField,
  NumericInput,
  SelectField,
  TextAreaField,
  TextInput, EmptyState, useDesignSystem
} from "@/design-system";
import { acceptedQuoteTotals, acceptedQuoteValue, money, statusLabel } from "@/lib/commercial/client";
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
import s from "./commercial.module.css";
import tableStyles from "../workspace/workspace.module.css";
type Props = {
  state: CommercialState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error?: string;
};
type CommissionDraft = { recipientName: string; type: "sales" | "designer" | "referral"; basis: "amount" | "percent"; value: number };
const newCommissionLine = (): CommissionDraft => ({ recipientName: "", type: "sales", basis: "amount", value: 0 });
export function CommercialRequests({ state, run, busy, error }: Props) {
  const t = useT();
  const [selected, setSelected] = useState(""),
    [create, setCreate] = useState(false),
    [createDecision, setCreateDecision] = useState(false),
    [draft, setDraft] = useState({ title: "", detail: "" }),
    [decisionDraft, setDecisionDraft] = useState({ title: "", detail: "", targetKey: "", dueDate: "", firstChoice: "Approve", secondChoice: "Request changes", remindersEnabled: true, email: false, whatsapp: false, escalationMinutes: 1440 }),
    [changeDraft, setChangeDraft] = useState<{ kind: ControlledChangeKind; sourceLineIds: string[]; title: string; detail: string; owner: string; dueDate: string }>({
      kind: "addition", sourceLineIds: [], title: "", detail: "", owner: "", dueDate: "",
    }),
    [comment, setComment] = useState(""),
    [internal, setInternal] = useState(false),
    [edit, setEdit] = useState<ChangeRequest | null>(null);
  const request = state.data.requests.find((r) => r.id === selected);
  const accepted = state.data.quotes.some((quote) => quote.kind === "quotation" && quote.status === "accepted");
  const contractLines = availableContractLines(state.data);
  const decisionTargets = [
    ...state.data.quotes.filter((quote) => Boolean(quote.issuedAt) && Boolean(quote.approverId) && !["superseded", "withdrawn"].includes(quote.status)).map((quote) => ({ id: `quotation:${quote.id}:${quote.number}`, label: `Quotation V${quote.number}` })),
    ...(state.data.materialApprovals ?? []).filter((material) => material.status === "client_review" && Boolean(material.approverId)).map((material) => ({ id: `material:${material.id}:${material.revision}`, label: `${material.name} · Revision ${material.revision}` })),
  ];
  return (
    <>
      <div className={s.toolbar}>
        <span className={s.muted}>
          {
            state.data.requests.filter(
              (r) => !["resolved", "withdrawn", "declined"].includes(r.status),
            ).length
          }{" "}
          {t("open requests")}</span>
        {state.canEdit && <div className={s.actions}>{decisionTargets.length > 0 && <Button size="compact" onPress={() => setCreateDecision(true)}>{t("Request client decision")}</Button>}<Button size="compact" variant="primary" onPress={() => setCreate(true)}><Plus size={15} />{accepted ? "New change request" : "New request"}</Button></div>}
      </div>
      {!state.data.requests.length ? (
        <EmptyState title={t("No change requests yet")} description={t("Client changes and your team’s clarifications appear here, each with an owner and a resolution.")} />
      ) : (
        <div className={tableStyles.recordTablePanel}><DataGrid selectable={false} compactToolbar ariaLabel="Change requests" data={state.data.requests} getRowId={row=>row.id} searchLabel="Search change requests" exportFileName="change-requests.csv" onRowAction={r=>{setSelected(r.id);setEdit(r);}} columns={[{id:"title",header:"Request",size:320,accessorFn:(r)=>`CR-${String(r.number).padStart(3,"0")} ${r.title}`,cell:({row:{original:r}})=>{return <>
                    <button
                      className={s.requestButton}
                      onClick={() => {
                        setSelected(r.id);
                        setEdit(r);
                      }}
                    >
                      <span className={s.muted}>
                        {t("CR-")}{String(r.number).padStart(3, "0")} ·{" "}
                      </span>
                      {r.title}
                    </button>
                  </>;}},
{id:"owner",header:"Owner",size:180,accessorFn:(r)=>r.owner || "Unassigned",cell:({row:{original:r}})=>{return <>{r.owner || "Unassigned"}</>;}},
{id:"due",header:"Due",size:140,accessorFn:(r)=>r.dueDate,cell:({row:{original:r}})=>{return <>{r.dueDate || "—"}</>;}},
{id:"status",header:"Status",size:160,accessorFn:(r)=>statusLabel[r.status],cell:({row:{original:r}})=>{return <>
                    <span className={s.status} data-status={r.status}>
                      {statusLabel[r.status]}
                    </span>
                  </>;}}]}/></div>
      )}
      <ControlledModalDialog
        isOpen={createDecision}
        onOpenChange={setCreateDecision}
        title={t("Request a client decision")}
        description={t("Pin the request to one exact revision and offer only clear, bounded choices.")}
        size="lg"
      >
        <form className={s.form} onSubmit={async (event) => {
          event.preventDefault();
          const [targetType, targetId, revision] = decisionDraft.targetKey.split(":");
          if (await run("request", {
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
          })) {
            setCreateDecision(false);
            setDecisionDraft({ title: "", detail: "", targetKey: "", dueDate: "", firstChoice: "Approve", secondChoice: "Request changes", remindersEnabled: true, email: false, whatsapp: false, escalationMinutes: 1440 });
          }
        }}>
          {error ? <p className={s.error} role="alert">{error}</p> : null}
          <TextInput label={t("Question")} isRequired value={decisionDraft.title} onChange={(value) => setDecisionDraft({ ...decisionDraft, title: value })} />
          <TextAreaField label={t("What does the client need to decide?")} isRequired value={decisionDraft.detail} onChange={(value) => setDecisionDraft({ ...decisionDraft, detail: value })} />
          <SelectField label={t("Exact revision")} isRequired items={decisionTargets} selectedKey={decisionDraft.targetKey || null} onSelectionChange={(key) => setDecisionDraft({ ...decisionDraft, targetKey: String(key ?? "") })} />
          <TextInput label={t("Due date")} inputType="date" isRequired value={decisionDraft.dueDate} onChange={(value) => setDecisionDraft({ ...decisionDraft, dueDate: value })} />
          <div className={s.grid}><TextInput label={t("First choice")} isRequired value={decisionDraft.firstChoice} onChange={(value) => setDecisionDraft({ ...decisionDraft, firstChoice: value })} /><TextInput label={t("Second choice")} isRequired value={decisionDraft.secondChoice} onChange={(value) => setDecisionDraft({ ...decisionDraft, secondChoice: value })} /></div>
          <NumericInput label={t("Escalate after due (minutes)")} minValue={0} maxValue={43200} value={decisionDraft.escalationMinutes} onChange={(value) => setDecisionDraft({ ...decisionDraft, escalationMinutes: value })} />
          <Checkbox isSelected={decisionDraft.remindersEnabled} onChange={(value) => setDecisionDraft({ ...decisionDraft, remindersEnabled: value })}>{t("Show reminders in Wodana")}</Checkbox>
          <div className={s.grid}><Checkbox isSelected={decisionDraft.email} onChange={(value) => setDecisionDraft({ ...decisionDraft, email: value })}>{t("Email when connected and opted in")}</Checkbox><Checkbox isSelected={decisionDraft.whatsapp} onChange={(value) => setDecisionDraft({ ...decisionDraft, whatsapp: value })}>{t("WhatsApp when connected and opted in")}</Checkbox></div>
          <Button type="submit" variant="primary" isLoading={busy} isDisabled={!decisionDraft.title.trim() || !decisionDraft.detail.trim() || !decisionDraft.targetKey || !decisionDraft.dueDate || !decisionDraft.firstChoice.trim() || !decisionDraft.secondChoice.trim()}>{t("Send decision request")}</Button>
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={create}
        onOpenChange={setCreate}
        title={accepted ? "New change request" : "New request"}
      >
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(accepted ? "create_change_case" : "request", accepted ? changeDraft : draft)) {
              setCreate(false);
              setDraft({ title: "", detail: "" });
              setChangeDraft({ kind: "addition", sourceLineIds: [], title: "", detail: "", owner: "", dueDate: "" });
            }
          }}
        >
          {accepted && <>
            <label>{t("Change type")}<select value={changeDraft.kind} onChange={(event) => setChangeDraft({ ...changeDraft, kind: event.target.value as ControlledChangeKind, sourceLineIds: [] })}>
                {changeKinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}
              </select>
            </label>
            {contractLines.length > 0 && <fieldset className={s.form} style={{ border: 0, padding: 0 }}>
              <legend>{t("Affected accepted items")}{["removal", "replacement"].includes(changeDraft.kind) ? " *" : ""}</legend>
              {contractLines.map((line) => <label key={line.id} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                <input type="checkbox" checked={changeDraft.sourceLineIds.includes(line.id)} onChange={(event) => setChangeDraft({
                  ...changeDraft,
                  sourceLineIds: event.target.checked ? [...changeDraft.sourceLineIds, line.id] : changeDraft.sourceLineIds.filter((id) => id !== line.id),
                })} />V{line.quoteNumber} · {line.room} · {line.title} · {line.remainingQuantity} {line.unit} {t("remaining")}</label>)}
            </fieldset>}
          </>}
          <label>
            {t("Title")}<input
              required
              value={accepted ? changeDraft.title : draft.title}
              onChange={(e) => accepted ? setChangeDraft({ ...changeDraft, title: e.target.value }) : setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            {t("What needs to change or be clarified?")}<textarea
              required
              value={accepted ? changeDraft.detail : draft.detail}
              onChange={(e) => accepted ? setChangeDraft({ ...changeDraft, detail: e.target.value }) : setDraft({ ...draft, detail: e.target.value })}
            />
          </label>
          {accepted && <div className={s.grid}>
            <label>{t("Owner")}<input value={changeDraft.owner} onChange={(event) => setChangeDraft({ ...changeDraft, owner: event.target.value })} /></label>
            <label>{t("Due date")}<input type="date" value={changeDraft.dueDate} onChange={(event) => setChangeDraft({ ...changeDraft, dueDate: event.target.value })} /></label>
          </div>}
          <button className={s.primary} disabled={busy || accepted && ["removal", "replacement"].includes(changeDraft.kind) && !changeDraft.sourceLineIds.length}>
            {accepted ? "Create change request" : "Create request"}
          </button>
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(request)}
        onOpenChange={(open) => !open && setSelected("")}
        title={request?.title ?? "Request"}
        size="lg"
      >
        {request && edit && (
          <div className={s.form}>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <p style={{ whiteSpace: "pre-wrap" }}>{request.detail}</p>
            <span className={s.status}>{statusLabel[request.status]}</span>
            {request.decisionRequest ? <div className={s.notice}><strong>{request.decisionRequest.target.label}</strong><p>{t("Due")}{" "}{request.dueDate} {t("· Choices:")}{" "}{request.decisionRequest.allowedChoices.map((choice) => choice.label).join(" / ")}</p><p>{decisionPolicySummary(request.decisionRequest)}</p>{request.decisionRequest.decision ? <p>{t("Client response:")}{" "}{request.decisionRequest.decision.choiceLabel}{request.decisionRequest.decision.note ? ` · ${request.decisionRequest.decision.note}` : ""}</p> : <p>{t("Awaiting the designated client approver.")}</p>}</div> : null}
            {request.control && <ControlledChangeCase request={request} state={state} run={run} busy={busy} />}
            <div className={s.grid}>
              <label>
                {t("Owner")}<input
                  disabled={!state.canEdit}
                  value={edit.owner}
                  onChange={(e) => setEdit({ ...edit, owner: e.target.value })}
                />
              </label>
              <label>
                {t("Due date")}<input
                  disabled={!state.canEdit}
                  type="date"
                  value={edit.dueDate}
                  onChange={(e) =>
                    setEdit({ ...edit, dueDate: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              {t("Status")}<select
                disabled={!state.canEdit}
                value={edit.status}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    status: e.target.value as ChangeRequest["status"],
                  })
                }
              >
                {[
                  "open",
                  "under_review",
                  "awaiting_decision",
                  "resolved",
                  "declined",
                  "withdrawn",
                ].map((v) => (
                  <option
                    value={v}
                    key={v}
                    disabled={v === "awaiting_decision"}
                  >
                    {statusLabel[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Resolution / closure reason")}<textarea
                disabled={!state.canEdit}
                value={edit.resolution}
                onChange={(e) =>
                  setEdit({ ...edit, resolution: e.target.value })
                }
              />
            </label>
            {state.canEdit && (
              <button
                className={s.button}
                disabled={busy}
                onClick={() =>
                  void run("update_request", {
                    requestId: request.id,
                    owner: edit.owner,
                    dueDate: edit.dueDate,
                    status: edit.status,
                    resolution: edit.resolution,
                  })
                }
              >
                {t("Save request")}</button>
            )}
            <p className={s.muted}>
              {t("A quotation change resolves after the linked revision is accepted. Sending the revision keeps the request open.")}</p>
            <ul className={s.history}>
              {request.comments.map((c) => (
                <li key={c.id}>
                  <strong>{c.author}</strong>{" "}
                  <small>
                    {c.visibility === "internal"
                      ? "Internal note"
                      : "Client conversation"}
                  </small>
                  <p>{c.text}</p>
                  <small>{new Date(c.at).toLocaleString()}</small>
                </li>
              ))}
            </ul>
            {state.canEdit && (
              <>
                <label>
                  {t("Reply")}<textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={internal}
                    onChange={(e) => setInternal(e.target.checked)}
                  />
                  {t("Internal note · hidden from client")}</label>
                <button
                  className={s.primary}
                  disabled={busy || !comment.trim()}
                  onClick={async () => {
                    if (
                      await run("comment", {
                        requestId: request.id,
                        text: comment,
                        visibility: internal ? "internal" : "client",
                      })
                    )
                      setComment("");
                  }}
                >
                  {t("Add reply")}</button>
              </>
            )}
          </div>
        )}
      </ControlledModalDialog>
    </>
  );
}
export function AgreementPayments({ state, run, busy, error, initialView = "agreement" }: Props & { initialView?: "agreement" | "payments" }) {
  const t = useT();
  const { currency: workspaceCurrency } = useDesignSystem();
  const accepted = state.data.palmFlow
      ? state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation" && q.round === "main")
        ?? state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation" && q.round === "design")
      : state.data.quotes.find(q => q.status === "accepted" && q.kind === "quotation"),
    a = state.data.agreement;
  const [agreement, setAgreement] = useState({
      quoteId: accepted?.id ?? "",
      reference: a?.reference ?? "",
      terms: a?.terms ?? accepted?.terms ?? "",
      evidence: a?.evidence ?? "",
    }),
    [tab, setTab] = useState<string>(initialView),
    [paymentOpen, setPaymentOpen] = useState(false),
    [payment, setPayment] = useState<{
      paymentId?: string;
      sourceQuoteId?: string;
      title: string;
      amount: number;
      dueDate: string;
      requiredForRelease: boolean;
      requiredForProduction: boolean;
      reference: string;
    }>({
      title: "Advance payment",
      amount: 0,
      dueDate: "",
      requiredForRelease: true,
      requiredForProduction: false,
      reference: "",
    }),
    [verify, setVerify] = useState(""),
    [reference, setReference] = useState(""),
    [receiptEvidence, setReceiptEvidence] = useState("");
  // Agreement and Payments are separate routes; follow the route's view.
  const [viewFor, setViewFor] = useState(initialView);
  if (viewFor !== initialView) { setViewFor(initialView); setTab(initialView); }
  const receiptPayment = state.data.payments.find((item) => item.id === verify),
    activeReceipt = receiptPayment
      ? state.data.receipts?.find(
          (receipt) =>
            receipt.paymentId === receiptPayment.id &&
            receipt.status !== "rejected",
        )
      : undefined;
  return (
    <>
      {!accepted ? (
        <EmptyState illustration="locked" title={t("Accept the quotation first")} description={t("The agreement and payments follow the exact accepted version.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/pre-projects/cases/${state.caseId}/quotations`}>{t("Open quotations")}</Link>} />
      ) : tab === "agreement" ? (
        <div className={s.form} style={{ maxWidth: "48rem" }}>
          <p className={s.detail}>
            {t("Accepted quotation V")}{accepted.number} ·{" "}
            {money(accepted.clientDecision?.acceptedTotal ?? accepted.total, accepted.currency)}{accepted.decidedBy ? ` · ${accepted.decidedBy}` : ""}
            {accepted.clientDecision?.selectedOptionLineIds.length ? ` · ${accepted.clientDecision.selectedOptionLineIds.length} selected option${accepted.clientDecision.selectedOptionLineIds.length === 1 ? "" : "s"}` : ""}
          </p>
          {a?.status === "executed" ? <dl className={s.agreementReadout}>
            <div><dt>{t("Agreement reference")}</dt><dd>{a.reference}</dd></div>
            <div><dt>{t("Agreed terms")}</dt><dd>{a.terms}</dd></div>
            <div><dt>{t("Signing details")}</dt><dd>{a.evidence}</dd></div>
          </dl> : <fieldset
            disabled={!state.canEdit || busy}
            className={s.form}
            style={{ border: 0, padding: 0 }}
          >
            <TextInput label={t("Agreement reference")} value={agreement.reference}
              onChange={reference => setAgreement({...agreement,reference})} placeholder={t("e.g. AGR-2026-014")} />
            <TextAreaField label={t("Agreed terms")} value={agreement.terms}
              onChange={terms => setAgreement({...agreement,terms})} />
            <TextAreaField label={t("Signed document evidence")} value={agreement.evidence}
              onChange={evidence => setAgreement({...agreement,evidence})}
              description={t("Document reference, signers and date.")} />
            <div className={s.actions}><Button variant="primary" isDisabled={!state.canEdit || busy}
              isLoading={busy} onPress={() => void run("agreement", {...agreement,quoteId:accepted.id})}>{t("Save agreement")}</Button></div>
          </fieldset>}
          <AgreementFiles state={state} run={run} busy={busy} />
          {a?.status === "executed" ? (
            <p className={s.notice}>
              {t("Signed agreement verified by")}{" "}<strong>{a.executedBy}</strong> ·{" "}
              {a.executedAt?.slice(0, 10)}
            </p>
          ) : (
            a &&
            state.canApprove && (
              <div className={s.actions}><Button variant="primary" isDisabled={busy || !a.evidence}
                onPress={() => void run("execute_agreement")}>{t("Verify signed agreement")}</Button></div>
            )
          )}
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <div>
              <p className={s.muted}>
                {t("Payment requests, provider settlement notifications and finance-verified receipts are recorded separately.")}</p>
              {state.data.financeContext && (
                <p className={s.detail}>
                  {state.data.financeContext.displayName} · {state.data.financeContext.code} · {state.data.financeContext.currency}
                  {state.data.financeContext.taxValidation === "unvalidated"
                    ? " · Tax configuration not regionally validated"
                    : ""}
                </p>
              )}
            </div>
            {state.canEdit && (
              <button
                className={s.primary}
                disabled={
                  !a || state.data.payments.some((p) => p.sourceQuoteId)
                }
                onClick={() => {
                  setPayment({
                    title: "Advance payment",
                    amount: 0,
                    dueDate: "",
                    requiredForRelease: true,
                    requiredForProduction: false,
                    reference: "",
                  });
                  setPaymentOpen(true);
                }}
              >
                <Plus size={15} />
                {t("Add milestone")}</button>
            )}
          </div>
          <div className={tableStyles.recordTablePanel}><DataGrid compactToolbar initialColumnVisibility={{receipt:false}} selectable={false} ariaLabel="Payment milestones" emptyTitle="No payment milestones yet" emptyDescription="Add the agreed payment schedule." data={state.data.payments} getRowId={row=>row.id} searchLabel="Search payment milestones" exportFileName="payment-milestones.csv"  columns={[{id:"title",header:"Milestone",size:190,accessorFn:(p)=>p.title,cell:({row:{original:p}})=>{return <>
                      {p.title}
                      {p.requiredForRelease && (
                        <small className={s.detail}>
                          {t("Required before release")}</small>
                      )}
                      {p.requiredForProduction && (
                        <small className={s.detail}>
                          {t("Required before manufacturing")}</small>
                      )}
                      {p.proof && (
                        <small className={s.detail} title={p.proof}>
                          {t("Client evidence:")}{" "}{p.proof}
                        </small>
                      )}
                    </>;}},
{id:"due",header:"Due",size:130,accessorFn:(p)=>p.dueDate || p.trigger || "To schedule",cell:({row:{original:p}})=>{return <>{p.dueDate || p.trigger || "To schedule"}</>;}},
{id:"amount",header:"Amount",size:120,accessorFn:(p)=>p.amount,cell:({row:{original:p}})=>{return <>{money(p.amount, accepted.currency)}</>;}},
	{id:"status",header:"Status",size:120,accessorFn:(p)=>statusLabel[p.status],cell:({row:{original:p}})=>{return <>
                      <span className={s.status} data-status={p.status}>
                        {statusLabel[p.status]}
                      </span>
                    </>;}},
	{id:"receipt",header:"Receipt status",size:190,accessorFn:(p)=>state.data.receipts?.find((receipt)=>receipt.paymentId===p.id&&receipt.status!=="rejected")?.status??"request_only",cell:({row:{original:p}})=>{const receipt=state.data.receipts?.find((item)=>item.paymentId===p.id&&item.status!=="rejected");return <>{receipt?.status === "finance_verified" ? "Finance verified" : receipt?.status === "provider_confirmed" ? "Provider confirmed" : receipt?.status === "reported" ? "Receipt reported" : "Payment request only"}</>; }},
	{id:"reference",header:"Accounting reference",size:200,accessorFn:(p)=>p.reference,cell:({row:{original:p}})=>{return <>
                      {p.reference || "—"}
                      <PaymentInvoice
                        currency={
                          state.data.quotes.find(
                            (q) => q.id === p.sourceQuoteId,
                          )?.currency ??
                          state.currency ??
                          workspaceCurrency
                        }
                        customerName={state.customerName}
                        workspaceId={state.workspaceId}
                        payment={p}
                        busy={busy}
                        canVerifyFinance={state.canVerifyFinance}
                        run={run}
                      />
                    </>;}},
	{id:"action",header:"Action",size:180,enableSorting:false,enableColumnFilter:false,cell:({row:{original:p}})=>{const receipt=state.data.receipts?.find((item)=>item.paymentId===p.id&&item.status!=="rejected");return <>
                      <div className={s.actions}>
                        {state.canEdit && p.status === "pending" && (
                          <button
                            className={s.button}
                            onClick={() => {
                              setPayment({
                                paymentId: p.id,
                                sourceQuoteId: p.sourceQuoteId,
                                title: p.title,
                                amount: p.amount,
                                dueDate: p.dueDate,
                                requiredForRelease: p.requiredForRelease,
                                requiredForProduction:
                                  p.requiredForProduction === true,
                                reference: p.reference,
                              });
                              setPaymentOpen(true);
                            }}
                          >
                            {t("Set due date")}</button>
                        )}
                        {state.canEdit && p.status !== "verified" && !receipt && !p.invoice && (
                            <Button
                              size="compact"
                              onPress={() => {
                                setVerify(p.id);
                                setReference(p.reference);
                                setReceiptEvidence("");
                              }}
                            >
                              {t("Record receipt")}</Button>
                          )}
                        {state.canVerifyFinance && p.status === "proof_submitted" && Boolean(receipt) && (
                          <Button
                            size="compact"
                            onPress={() => setVerify(p.id)}
                          >
                            {t("Finance verify")}</Button>
                        )}
                      </div>
                    </>;}}]}/></div>

        </>
      )}
      {tab === "payments" && (
        <ClientCredits state={state} run={run} busy={busy} />
      )}
      <ControlledModalDialog
        isOpen={paymentOpen}
        onOpenChange={setPaymentOpen}
        title={t("Payment milestone")}
      >
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("payment", payment)) setPaymentOpen(false);
          }}
        >
          <TextInput label={t("Milestone")} isRequired isDisabled={Boolean(payment.sourceQuoteId)}
            value={payment.title} onChange={title => setPayment({...payment,title})} />
          <div className={s.grid}>
            <NumericInput label={`Amount (${accepted?.currency ?? state.currency})`} isRequired minValue={0.01}
              formatOptions={{maximumFractionDigits:2}} isDisabled={Boolean(payment.sourceQuoteId)}
              value={payment.amount} onChange={amount => setPayment({...payment,amount})} />
            <DateField label={t("Due date")} isRequired value={payment.dueDate ? parseDate(payment.dueDate) : null}
              onChange={date => setPayment({...payment,dueDate:date?.toString() ?? ""})} />
          </div>
          <TextInput label={t("Invoice reference")} description={t("Optional · the reference from your accounting system.")}
            value={payment.reference} onChange={reference => setPayment({...payment,reference})} />
          <div className={s.paymentConditions}>
            <span className={s.detail}>{t("Required before")}</span>
            <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForRelease}
              onChange={requiredForRelease => setPayment({...payment,requiredForRelease})}>{t("Execution release")}</Checkbox>
            <Checkbox isDisabled={Boolean(payment.sourceQuoteId)} isSelected={payment.requiredForProduction}
              onChange={requiredForProduction => setPayment({...payment,requiredForProduction})}>{t("Manufacturing starts")}</Checkbox>
          </div>
          {payment.sourceQuoteId && <p className={s.detail}>{t("The milestone amount and conditions are fixed by the accepted quotation.")}</p>}
          <div className={s.modalActions}>
            <Button onPress={() => setPaymentOpen(false)} isDisabled={busy}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" isLoading={busy} isDisabled={busy || !payment.title.trim() || !Number.isFinite(payment.amount) || payment.amount <= 0 || !payment.dueDate}>{t("Save milestone")}</Button>
          </div>
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(verify)}
        onOpenChange={(open) => !open && setVerify("")}
        title={receiptPayment?.status === "proof_submitted" ? "Finance verification" : "Record payment receipt"}
      >
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.form}>
          <p>
            {receiptPayment?.status === "proof_submitted"
              ? `Confirm ${activeReceipt?.source === "provider" ? "the provider settlement notification" : "the reported receipt"} against the finance record. This is the step that makes it verified.`
              : "Record the bank or receipt evidence first. Another finance-authorized step verifies it."}
          </p>
          {receiptPayment?.status !== "proof_submitted" && (
            <>
              <TextInput
                isRequired
                label={t("Receipt / transaction reference")}
                value={reference}
                onChange={setReference}
              />
              <TextAreaField
                isRequired
                label={t("Receipt evidence")}
                value={receiptEvidence}
                onChange={setReceiptEvidence}
              />
            </>
          )}
          <Button
            variant="primary"
            isDisabled={
              busy ||
              (receiptPayment?.status !== "proof_submitted" &&
                (!reference.trim() || !receiptEvidence.trim()))
            }
            onPress={async () => {
              const action =
                receiptPayment?.status === "proof_submitted"
                  ? "verify_payment"
                  : "report_payment_receipt";
              if (
                await run(action, {
                  paymentId: verify,
                  reference,
                  evidence: receiptEvidence,
                })
              )
                setVerify("");
            }}
          >
            {receiptPayment?.status === "proof_submitted"
              ? "Verify receipt"
              : "Record receipt"}
          </Button>
        </div>
      </ControlledModalDialog>
    </>
  );
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
    [commissionLines, setCommissionLines] = useState<CommissionDraft[]>(state.data.ownerReview?.commissionLines?.map(({recipientName,type,basis,value})=>({recipientName,type,basis,value})) ?? [newCommissionLine()]),
    [financeDraft, setFinanceDraft] = useState<{key:string; lines:CommissionDraft[]}>({key:"",lines:[]}),
    [paymentProofUrl, setPaymentProofUrl] = useState(state.data.ownerReview?.paymentProofUrl ?? ""),
    [paymentVerification, setPaymentVerification] = useState<{key:string; value:boolean}>({key:"",value:false}),
    [approver, setApprover] = useState(""),
    [selectedMaterial, setSelectedMaterial] = useState(""),
    [materialDraft, setMaterialDraft] = useState<MaterialApproval | null>(null),
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
  const updateCommission = (index: number, update: Partial<CommissionDraft>, finance = false) => {
    const current = finance ? editableFinanceLines : commissionLines;
    const next = current.map((line, i) => i === index ? {...line, ...update} : line);
    if (finance) setFinanceDraft({key: reviewKey,lines:next}); else setCommissionLines(next);
  };
  const submittedCommissions = d.ownerReview?.commissionLines ?? [];
  const reviewKey = `${d.ownerReview?.id??""}:${d.ownerReview?.submittedAt??""}`;
  const editableFinanceLines = financeDraft.key === reviewKey ? financeDraft.lines : submittedCommissions.map(({recipientName,type,basis,value})=>({recipientName,type,basis,value}));
  const paymentVerified = paymentVerification.key === reviewKey && paymentVerification.value;
  const checks = [
    {
      label: "Client accepted the quotation",
      done: Boolean(deliveryQuote),
      href: "quotations",
    },
    {
      label: "Linked design revisions approved",
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
      label: "Signed agreement verified",
      done: Boolean(
        deliveryQuote &&
          agreementIsOperational(d.agreement) &&
          agreementMatchesAcceptedQuote(d.agreement, deliveryQuote),
      ),
      href: "contracts",
    },
    {
      label: "Required payments verified",
      done: Boolean(deliveryQuote && financeGatePaymentsReady(d, d.palmFlow ? deliveryQuote.id : undefined)),
      href: "payment-plan",
    },
    {
      label: "Won opportunity, Finance verification and approved Deal File",
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
      label: "Material selections approved or not applicable",
      done: Boolean(
        deliveryQuote && (d.palmFlow ? palmMaterialListSignedOff(d, deliveryQuote) : materialApprovalsComplete(deliveryQuote, d.materialApprovals)),
      ),
      href: "execution-release",
      view: "materials",
    },
    {
      label: "Change requests resolved",
      done: d.requests.every((r) =>
        ["resolved", "declined", "withdrawn"].includes(r.status),
      ),
      href: "variations",
    },
  ];
  return (
    <>
      <nav className={s.tabs} aria-label={t("Approval views")}>
        {[
          ["owner", "Internal approval"],
          ["materials", "Material approvals"],
          ["history", "History"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
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
              <div><small>{t("Internal approval")}</small><strong>{d.ownerReview ? statusLabel[d.ownerReview.status] ?? d.ownerReview.status : "Not submitted"}</strong></div>
            </div>
            {d.dealFile && <div className={s.dealBanner}><div><small>{t("DEAL FILE")}</small><strong>{d.dealFile.reference}</strong><span>{t("Approved")}{" "}{d.dealFile.approvedAt.slice(0,10)} {t("by")}{" "}{d.dealFile.approvedBy}</span></div><div><small>{t("Current round")}</small><strong>{d.dealFile.quoteId === accepted.id ? accepted.round === "design" ? "Design" : "Main quotation" : "Design approved · main pending"}</strong></div><div><small>{t("Frozen evidence")}</small><strong>{d.dealFile.designEvidence?.links?.length ?? 0} {t("files ·")}{" "}{d.dealFile.materialEvidence?.length ?? 0} {t("materials")}</strong></div><div><small>{t("Deal value")}</small><strong>{money(d.dealFile.value, accepted.currency)}</strong></div></div>}
            {d.ownerReview?.status === "pending_finance" ? <section className={s.ownerForm}>
              <div><h2>{t("2 · Finance verification")}</h2><p className={s.muted}>{t("Submitted by")}{" "}{d.ownerReview.submittedBy}{t(". Confirm payment proof and final commission amounts before Owner approval.")}</p></div>
              <a href={d.ownerReview.paymentProofUrl} target="_blank" rel="noopener noreferrer">{t("Open payment proof ↗")}</a>
              <div className={s.commissionRows}>{editableFinanceLines.map((line,index)=><div className={s.commissionRow} key={`${line.type}-${index}`}>
                <span>{line.recipientName} · {line.type}</span>
                <select aria-label={`Commission basis for ${line.recipientName}`} value={line.basis} onChange={e=>updateCommission(index,{basis:e.target.value as CommissionDraft["basis"]},true)}><option value="amount">{accepted.currency}</option><option value="percent">%</option></select>
                <input aria-label={`Final commission for ${line.recipientName}`} type="number" min="0.01" max={line.basis==="percent"?100:undefined} step="0.01" value={line.value} onChange={e=>updateCommission(index,{value:Number(e.target.value)},true)}/>
              </div>)}</div>
              <label className={s.inlineCheck}><input type="checkbox" checked={paymentVerified} onChange={e=>setPaymentVerification({key:reviewKey,value:e.target.checked})}/> {t("I verified the linked proof of payment")}</label>
              <label className={s.decisionField}>{t("Finance note")}<textarea value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder={t("Explain any correction or reason for return.")}/></label>
              {state.canVerifyFinance&&<div className={s.actions}><button className={s.button} disabled={busy||!decisionNote.trim()} onClick={()=>void run("review_deal_finance",{decision:"return",note:decisionNote})}>{t("Return to Sales")}</button><button className={s.primary} disabled={busy||!paymentVerified||editableFinanceLines.some(line=>!line.recipientName||line.value<=0)} onClick={()=>void run("review_deal_finance",{decision:"confirm",note:decisionNote,paymentVerified,commissionLines:editableFinanceLines})}>{t("Confirm Finance review")}</button></div>}
            </section> : d.ownerReview?.status === "pending_approval" ? <section className={s.ownerForm}>
              <div><h2>{t("3 · Owner approval")}</h2><p className={s.muted}>{t("Finance confirmed the payment and commission. Client material sign-off follows the material meeting, before procurement.")}</p></div>
              <div className={s.checkGrid}>{Object.entries(d.ownerReview.checklist).filter(([key]) => !d.palmFlow || key !== "materials").map(([key,done])=><span key={key} data-done={done}>{done?"✓":"○"} {key.replaceAll("_"," ")}</span>)}</div>
              <div className={s.commissionRows}>{(d.ownerReview.finalCommissionLines??[]).map((line,index)=><span key={`${line.type}-${index}`}>{line.recipientName} · {line.type} · {money(line.amount,accepted.currency)}</span>)}</div>
              <label className={s.decisionField}>{t("Decision remarks")}<textarea value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder={t("Required when returning or rejecting.")}/></label>
              {!d.palmFlow&&!materialApprovalsComplete(accepted,d.materialApprovals)&&<p className={s.notice}>{t("Complete every client material decision before creating the Deal File.")}</p>}
              {state.canApproveDeal&&<div className={s.actions}><button className={s.button} disabled={busy||!decisionNote.trim()} onClick={()=>void run("decide_owner_review",{decision:"reject",note:decisionNote})}>{t("Reject")}</button><button className={s.button} disabled={busy||!decisionNote.trim()} onClick={()=>void run("decide_owner_review",{decision:"return",note:decisionNote})}>{t("Return for correction")}</button><button className={s.primary} disabled={busy||Object.entries(d.ownerReview.checklist).some(([key,value])=>!value&&(!d.palmFlow||key!=="materials"))||(!d.palmFlow&&!materialApprovalsComplete(accepted,d.materialApprovals))} onClick={()=>void run("decide_owner_review",{decision:"approve",note:decisionNote})}>{t("Approve Deal File")}</button></div>}
            </section> : d.dealFile?.quoteId !== accepted.id && <form className={s.ownerForm} onSubmit={async e=>{e.preventDefault();await run("submit_owner_review",{commissionLines,paymentProofUrl,checklist,note});}}>
              {d.ownerReview&&<p className={s.notice}>{t("Previous decision:")}{" "}{statusLabel[d.ownerReview.status]??d.ownerReview.status}. {d.ownerReview.financeNote??d.ownerReview.decisionNote}</p>}
              <div><h2>{t("1 · Submit Deal File")}</h2><p className={s.muted}>{t("Every deal needs a Won opportunity, accepted quotation, signed agreement, payment proof and provisional split commissions.")}</p></div>
              {state.opportunityStatus!=="won"&&<p className={s.notice}>{t("Mark the linked opportunity Won before submitting this Deal File.")}</p>}
              <label>{t("Proof-of-payment link")}<input type="url" required value={paymentProofUrl} onChange={e=>setPaymentProofUrl(e.target.value)} placeholder={t("https://…")}/></label>
              <div className={s.commissionRows}><strong>{t("Provisional commissions")}</strong>{commissionLines.map((line,index)=><div className={s.commissionRow} key={index}>
                <input aria-label={`Commission recipient ${index+1}`} required placeholder={t("Recipient name")} value={line.recipientName} onChange={e=>updateCommission(index,{recipientName:e.target.value})}/>
                <select aria-label={`Commission type ${index+1}`} value={line.type} onChange={e=>updateCommission(index,{type:e.target.value as CommissionDraft["type"]})}><option value="sales">{t("Sales")}</option><option value="designer">{t("Designer")}</option><option value="referral">{t("Referral")}</option></select>
                <select aria-label={`Commission basis ${index+1}`} value={line.basis} onChange={e=>updateCommission(index,{basis:e.target.value as CommissionDraft["basis"]})}><option value="amount">{accepted.currency}</option><option value="percent">%</option></select>
                <input aria-label={`Commission value ${index+1}`} required type="number" min="0.01" max={line.basis==="percent"?100:undefined} step="0.01" value={line.value||""} onChange={e=>updateCommission(index,{value:Number(e.target.value)})}/>
                {commissionLines.length>1&&<button type="button" className={s.button} onClick={()=>setCommissionLines(commissionLines.filter((_,i)=>i!==index))} aria-label={`Remove commission ${index+1}`}>{t("Remove")}</button>}
              </div>)}{commissionLines.length<3&&<button type="button" className={s.button} onClick={()=>setCommissionLines([...commissionLines,newCommissionLine()])}>{t("Add recipient")}</button>}</div>
              <div className={s.checkGrid}>{Object.keys(checklist).filter(key => !d.palmFlow || key !== "materials").map(key=><label key={key}><input type="checkbox" checked={checklist[key as keyof typeof checklist]} onChange={e=>setChecklist({...checklist,[key]:e.target.checked})}/><span>{key.replaceAll("_"," ")}</span></label>)}</div>
              <label>{t("Submission note")}<textarea required value={note} onChange={e=>setNote(e.target.value)} placeholder={t("Summarize payment evidence, pricing decision and any conditions.")}/></label>
              {state.canEdit&&<button className={s.primary} disabled={busy||state.opportunityStatus!=="won"||!note.trim()||commissionLines.some(line=>!line.recipientName||line.value<=0)}>{t("Send to Finance")}</button>}
            </form>}
          </>}
        </>
      ) : tab === "materials" ? (
        <>
          <div className={s.header}><div><h2>{t("Client material selections")}</h2><p className={s.muted}>{t("After payment, record the material meeting and send the selected list to the client. Sign-off is required before procurement.")}</p></div>{state.canEdit&&<button className={s.button} disabled={busy||!accepted||(Boolean(d.palmFlow)&&d.dealFile?.quoteId!==accepted.id)} onClick={()=>void run('sync_material_approvals')}>{t("Prepare from quotation")}</button>}</div>
          {(d.materialApprovals ?? []).filter(item=>item.quoteId===accepted?.id).map(item=><div className={s.materialRow} key={item.id}>
            {item.photo?<Image src={item.photo} alt="" width={64} height={64} unoptimized/>:<span className={s.materialThumb}>{t("No photo")}</span>}
            <div><strong>{item.name}</strong><span>{item.room} · {item.item}</span><small>{[item.brand,item.code].filter(Boolean).join(' · ')||item.specification}</small>{item.decisionNote&&<small>{t("Client remark:")}{" "}{item.decisionNote}</small>}</div>
            <span className={s.status} data-status={item.status}>{statusLabel[item.status]??item.status.replaceAll('_',' ')}</span>
            {state.canEdit&&['proposed','rejected'].includes(item.status)&&<button className={s.button} onClick={()=>{setSelectedMaterial(item.id);setMaterialDraft({...item});}}>{t("Edit")}</button>}
            {state.canEdit&&item.status==='proposed'&&<button className={s.primary} disabled={busy||!approver} onClick={()=>void run('submit_material_approval',{materialApprovalId:item.id,approverId:approver})}>{t("Send to client")}</button>}
          </div>)}
          {!(d.materialApprovals ?? []).some(item=>item.quoteId===accepted?.id)&&<EmptyState title={t("No selections prepared")} description={t("Accept the quotation, then prepare its materials for client review.")} />}
          {(d.materialApprovals ?? []).some(item=>item.quoteId===accepted?.id&&item.status==='proposed')&&<label className={s.approverField}>{t("Client approver")}<select value={approver} onChange={e=>setApprover(e.target.value)}><option value="">{t("Choose approver…")}</option>{state.contacts.filter(contact=>contact.active&&contact.role==='approver').map(contact=><option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label>}
          <ControlledModalDialog isOpen={Boolean(selectedMaterial)} onOpenChange={open=>{if(!open){setSelectedMaterial('');setMaterialDraft(null);}}} title={t("Edit material selection")}>
            {materialDraft&&<form className={s.form} onSubmit={async e=>{e.preventDefault();if(await run('save_material_approval',{materialApprovalId:materialDraft.id,name:materialDraft.name,code:materialDraft.code,brand:materialDraft.brand,specification:materialDraft.specification,note:materialDraft.note,photo:materialDraft.photo??''})){setSelectedMaterial('');setMaterialDraft(null);}}}>
              <label>{t("Material / finish name")}<input required value={materialDraft.name} onChange={e=>setMaterialDraft({...materialDraft,name:e.target.value})}/></label>
              <div className={s.grid}><label>{t("Brand")}<input value={materialDraft.brand} onChange={e=>setMaterialDraft({...materialDraft,brand:e.target.value})}/></label><label>{t("Product code")}<input value={materialDraft.code} onChange={e=>setMaterialDraft({...materialDraft,code:e.target.value})}/></label></div>
              <label>{t("Specification")}<textarea required value={materialDraft.specification} onChange={e=>setMaterialDraft({...materialDraft,specification:e.target.value})}/></label>
              <label>{t("Internal note")}<textarea value={materialDraft.note} onChange={e=>setMaterialDraft({...materialDraft,note:e.target.value})}/></label>
              <label>{t("Sample photo")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>180000){e.target.value='';return;}const reader=new FileReader();reader.onload=()=>setMaterialDraft(current=>current?{...current,photo:String(reader.result)}:current);reader.readAsDataURL(file);}}/><small>{t("PNG, JPEG or WebP · up to 180 KB.")}</small></label>
              <button className={s.primary} disabled={busy}>{t("Save selection")}</button>
            </form>}
          </ControlledModalDialog>
        </>
      ) : tab === "release" ? (
        d.palmFlow && !d.palmFlow.scope.mainQuotation ? <EmptyState illustration="done" title={t("Design-only project")} description={t("This path ends with the approved design. Procurement and production don’t apply.")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href={sectionHref?.("designs") ?? `${root}/designs`}>{t("Open design")}</Link>} /> : <>
          <p className={s.muted}>
            {d.palmFlow
              ? d.palmFlow.scope.mainQuotation
                ? "Release the approved main scope after the material list is signed off. The same project and Deal File continue into procurement."
                : "This design-only project ends after Design & Specifications. Delivery release does not apply."
              : "Release the accepted scope after checking technical and site conditions. This opens the connected project with its approved BOQ and payment evidence."}
          </p>
          {checks.map((c) => (
            <div key={c.label} className={s.section}>
              <div className={s.header}>
                <span>
                  {c.done ? "✓" : "○"} {c.label}
                </span>
                {c.view ? <button className={s.button} onClick={() => setTab(c.view)}>{t("Review →")}</button> : <Link href={sectionHref?.(c.href) ?? `${root}/${c.href}`}>{t("Review →")}</Link>}
              </div>
            </div>
          ))}
          {d.release ? (
            <p className={s.notice}>
              {t("Readiness recorded by")}{" "}{d.release.by} {t("on")}{" "}
              {d.release.at.slice(0, 10)}.<br />
              {d.release.note}
              {d.release.projectId && (
                <>
                  <br />
                  <Link
                    href={`/workspace/projects/${d.release.projectId}/overview`}
                  >
                    {t("Open project →")}</Link>
                </>
              )}
            </p>
          ) : (
            <div
              className={s.form}
              style={{ marginTop: "1rem", maxWidth: "45rem" }}
            >
              <label>
                {t("Technical approvals, released scope and any conditions")}<textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("Reference the approved drawings, scope and site checks. Record any authorized conditions.")}
                />
              </label>
              {state.canRelease && (!d.palmFlow || d.palmFlow.scope.mainQuotation) && (
                <button
                  className={s.primary}
                  disabled={
                    busy ||
                    state.opportunityStatus !== "won" ||
                    !commercialReleaseInputsReady(d) ||
                    ((!d.palmFlow || d.palmFlow.scope.design) &&
                      (!state.releaseReadiness ||
                       state.releaseReadiness.designsRequired === 0 ||
                       state.releaseReadiness.designsApproved !== state.releaseReadiness.designsRequired)) ||
                    !note.trim()
                  }
                  onClick={() => void run("release", { note })}
                >
                  {d.palmFlow ? "Release to procurement" : "Release & open project"}
                </button>
              )}
            </div>
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
