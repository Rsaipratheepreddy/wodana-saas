"use client";
import { ClientCredits } from "./client-credits";
import { PaymentInvoice } from "./payment-invoice";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Plus, MessageSquare } from "lucide-react";
import {
  Button,
  Checkbox,
  ControlledModalDialog,
  DataGrid,
  NumericInput,
  SelectField,
  TextAreaField,
  TextInput,
} from "@/design-system";
import { acceptedQuoteTotals, acceptedQuoteValue, money, statusLabel } from "@/lib/commercial/client";
import {
  agreementIsOperational,
  agreementMatchesAcceptedQuote,
  commercialReleaseInputsReady,
  materialApprovalsComplete,
  releasePaymentIsOperational,
} from "@/lib/commercial/release";
import type { CommercialState, ChangeRequest, ControlledChangeKind, MaterialApproval } from "@/lib/commercial/types";
import { availableContractLines, changeKinds } from "@/lib/commercial/change-cases";
import { decisionPolicySummary } from "@/lib/commercial/decision-requests";
import { ControlledChangeCase } from "./controlled-change-case";
import s from "./commercial.module.css";
type Props = {
  state: CommercialState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error?: string;
};
export function CommercialRequests({ state, run, busy, error }: Props) {
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
          open requests
        </span>
        {state.canEdit && <div className={s.actions}><Button size="compact" isDisabled={!decisionTargets.length} onPress={() => setCreateDecision(true)}>Request client decision</Button><Button size="compact" variant="primary" onPress={() => setCreate(true)}><Plus size={15} />{accepted ? "New change case" : "New request"}</Button></div>}
      </div>
      {!state.data.requests.length ? (
        <div className={s.empty}>
          <MessageSquare size={30} />
          <h2>No change requests yet</h2>
          <p>
            Client change requests and your team’s clarifications appear here,
            with an owner, replies and a clear resolution.
          </p>
        </div>
      ) : (
        <DataGrid ariaLabel="Change requests" data={state.data.requests} getRowId={row=>row.id} searchLabel="Search change requests" exportFileName="change-requests.csv" onRowAction={r=>{setSelected(r.id);setEdit(r);}} columns={[{id:"title",header:"Request",size:320,accessorFn:(r)=>`CR-${String(r.number).padStart(3,"0")} ${r.title}`,cell:({row:{original:r}})=>{return <>
                    <button
                      className={s.requestButton}
                      onClick={() => {
                        setSelected(r.id);
                        setEdit(r);
                      }}
                    >
                      <span className={s.muted}>
                        CR-{String(r.number).padStart(3, "0")} ·{" "}
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
                  </>;}}]}/>
      )}
      <ControlledModalDialog
        isOpen={createDecision}
        onOpenChange={setCreateDecision}
        title="Request a client decision"
        description="Pin the request to one exact revision and offer only clear, bounded choices."
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
          <TextInput label="Question" isRequired value={decisionDraft.title} onChange={(value) => setDecisionDraft({ ...decisionDraft, title: value })} />
          <TextAreaField label="What does the client need to decide?" isRequired value={decisionDraft.detail} onChange={(value) => setDecisionDraft({ ...decisionDraft, detail: value })} />
          <SelectField label="Exact revision" isRequired items={decisionTargets} selectedKey={decisionDraft.targetKey || null} onSelectionChange={(key) => setDecisionDraft({ ...decisionDraft, targetKey: String(key ?? "") })} />
          <TextInput label="Due date" inputType="date" isRequired value={decisionDraft.dueDate} onChange={(value) => setDecisionDraft({ ...decisionDraft, dueDate: value })} />
          <div className={s.grid}><TextInput label="First choice" isRequired value={decisionDraft.firstChoice} onChange={(value) => setDecisionDraft({ ...decisionDraft, firstChoice: value })} /><TextInput label="Second choice" isRequired value={decisionDraft.secondChoice} onChange={(value) => setDecisionDraft({ ...decisionDraft, secondChoice: value })} /></div>
          <NumericInput label="Escalate after due (minutes)" minValue={0} maxValue={43200} value={decisionDraft.escalationMinutes} onChange={(value) => setDecisionDraft({ ...decisionDraft, escalationMinutes: value })} />
          <Checkbox isSelected={decisionDraft.remindersEnabled} onChange={(value) => setDecisionDraft({ ...decisionDraft, remindersEnabled: value })}>Show reminders in Wodana</Checkbox>
          <div className={s.grid}><Checkbox isSelected={decisionDraft.email} onChange={(value) => setDecisionDraft({ ...decisionDraft, email: value })}>Email when connected and opted in</Checkbox><Checkbox isSelected={decisionDraft.whatsapp} onChange={(value) => setDecisionDraft({ ...decisionDraft, whatsapp: value })}>WhatsApp when connected and opted in</Checkbox></div>
          <Button type="submit" variant="primary" isLoading={busy} isDisabled={!decisionDraft.title.trim() || !decisionDraft.detail.trim() || !decisionDraft.targetKey || !decisionDraft.dueDate || !decisionDraft.firstChoice.trim() || !decisionDraft.secondChoice.trim()}>Send decision request</Button>
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={create}
        onOpenChange={setCreate}
        title={accepted ? "New change case" : "New request"}
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
            <label>Change type
              <select value={changeDraft.kind} onChange={(event) => setChangeDraft({ ...changeDraft, kind: event.target.value as ControlledChangeKind, sourceLineIds: [] })}>
                {changeKinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}
              </select>
            </label>
            {contractLines.length > 0 && <fieldset className={s.form} style={{ border: 0, padding: 0 }}>
              <legend>Affected accepted items{["removal", "replacement"].includes(changeDraft.kind) ? " *" : ""}</legend>
              {contractLines.map((line) => <label key={line.id} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                <input type="checkbox" checked={changeDraft.sourceLineIds.includes(line.id)} onChange={(event) => setChangeDraft({
                  ...changeDraft,
                  sourceLineIds: event.target.checked ? [...changeDraft.sourceLineIds, line.id] : changeDraft.sourceLineIds.filter((id) => id !== line.id),
                })} />V{line.quoteNumber} · {line.room} · {line.title} · {line.remainingQuantity} {line.unit} remaining
              </label>)}
            </fieldset>}
          </>}
          <label>
            Title
            <input
              required
              value={accepted ? changeDraft.title : draft.title}
              onChange={(e) => accepted ? setChangeDraft({ ...changeDraft, title: e.target.value }) : setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            What needs to change or be clarified?
            <textarea
              required
              value={accepted ? changeDraft.detail : draft.detail}
              onChange={(e) => accepted ? setChangeDraft({ ...changeDraft, detail: e.target.value }) : setDraft({ ...draft, detail: e.target.value })}
            />
          </label>
          {accepted && <div className={s.grid}>
            <label>Owner<input value={changeDraft.owner} onChange={(event) => setChangeDraft({ ...changeDraft, owner: event.target.value })} /></label>
            <label>Due date<input type="date" value={changeDraft.dueDate} onChange={(event) => setChangeDraft({ ...changeDraft, dueDate: event.target.value })} /></label>
          </div>}
          <button className={s.primary} disabled={busy || accepted && ["removal", "replacement"].includes(changeDraft.kind) && !changeDraft.sourceLineIds.length}>
            {accepted ? "Create change case" : "Create request"}
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
            {request.decisionRequest ? <div className={s.notice}><strong>{request.decisionRequest.target.label}</strong><p>Due {request.dueDate} · Choices: {request.decisionRequest.allowedChoices.map((choice) => choice.label).join(" / ")}</p><p>{decisionPolicySummary(request.decisionRequest)}</p>{request.decisionRequest.decision ? <p>Client response: {request.decisionRequest.decision.choiceLabel}{request.decisionRequest.decision.note ? ` · ${request.decisionRequest.decision.note}` : ""}</p> : <p>Awaiting the designated client approver.</p>}</div> : null}
            {request.control && <ControlledChangeCase request={request} state={state} run={run} busy={busy} />}
            <div className={s.grid}>
              <label>
                Owner
                <input
                  disabled={!state.canEdit}
                  value={edit.owner}
                  onChange={(e) => setEdit({ ...edit, owner: e.target.value })}
                />
              </label>
              <label>
                Due date
                <input
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
              Status
              <select
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
              Resolution / closure reason
              <textarea
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
                Save request
              </button>
            )}
            <p className={s.muted}>
              A quotation change resolves after the linked revision is accepted.
              Sending the revision keeps the request open.
            </p>
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
                  Reply
                  <textarea
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
                  Internal note · hidden from client
                </label>
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
                  Add reply
                </button>
              </>
            )}
          </div>
        )}
      </ControlledModalDialog>
    </>
  );
}
export function AgreementPayments({ state, run, busy, error }: Props) {
  const accepted = state.data.quotes.find(
      (q) => q.status === "accepted" && q.kind === "quotation",
    ),
    a = state.data.agreement;
  const [agreement, setAgreement] = useState({
      quoteId: accepted?.id ?? "",
      reference: a?.reference ?? "",
      terms: a?.terms ?? accepted?.terms ?? "",
      evidence: a?.evidence ?? "",
    }),
    [tab, setTab] = useState("agreement"),
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
      dueDate: new Date().toISOString().slice(0, 10),
      requiredForRelease: true,
      requiredForProduction: false,
      reference: "",
    }),
    [verify, setVerify] = useState(""),
    [reference, setReference] = useState(""),
    [receiptEvidence, setReceiptEvidence] = useState("");
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
      <nav className={s.tabs} aria-label="Agreement and payment views">
        {[
          ["agreement", "Agreement"],
          ["payments", "Payment schedule"],
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
      {!accepted ? (
        <div className={s.empty}>
          <h2>Accept the quotation first</h2>
          <p>
            The agreement and payment schedule will reference the exact accepted
            version.
          </p>
        </div>
      ) : tab === "agreement" ? (
        <div className={s.form} style={{ maxWidth: "48rem" }}>
          <p className={s.notice}>
            Accepted quotation V{accepted.number} ·{" "}
            {money(accepted.clientDecision?.acceptedTotal ?? accepted.total, accepted.currency)} · {accepted.decidedBy}
            {accepted.clientDecision?.selectedOptionLineIds.length ? ` · ${accepted.clientDecision.selectedOptionLineIds.length} selected option${accepted.clientDecision.selectedOptionLineIds.length === 1 ? "" : "s"}` : ""}
            {accepted.clientDecision?.quoteHash ? ` · Snapshot ${accepted.clientDecision.quoteHash.slice(0, 12)}` : ""}
          </p>
          <fieldset
            disabled={!state.canEdit || a?.status === "executed" || busy}
            className={s.form}
            style={{ border: 0, padding: 0 }}
          >
            <label>
              Agreement reference
              <input
                value={agreement.reference}
                onChange={(e) =>
                  setAgreement({ ...agreement, reference: e.target.value })
                }
                placeholder="e.g. AGR-2026-014"
              />
            </label>
            <label>
              Agreed terms
              <textarea
                value={agreement.terms}
                onChange={(e) =>
                  setAgreement({ ...agreement, terms: e.target.value })
                }
              />
            </label>
            <label>
              Signed document reference / evidence
              <textarea
                value={agreement.evidence}
                onChange={(e) =>
                  setAgreement({ ...agreement, evidence: e.target.value })
                }
                placeholder="Signed file reference, signers and date. Upload the document in Files & activity."
              />
            </label>
            <button
              className={s.button}
              onClick={() =>
                void run("agreement", { ...agreement, quoteId: accepted.id })
              }
            >
              Save agreement
            </button>
          </fieldset>
          {a?.status === "executed" ? (
            <p className={s.notice}>
              Signed agreement verified by {a.executedBy} ·{" "}
              {a.executedAt?.slice(0, 10)}
            </p>
          ) : (
            a &&
            state.canApprove && (
              <button
                className={s.primary}
                disabled={busy || !a.evidence}
                onClick={() => void run("execute_agreement")}
              >
                Verify signed agreement
              </button>
            )
          )}
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <div>
              <p className={s.muted}>
                Payment requests, provider settlement notifications and
                finance-verified receipts are recorded separately.
              </p>
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
                    dueDate: new Date().toISOString().slice(0, 10),
                    requiredForRelease: true,
                    requiredForProduction: false,
                    reference: "",
                  });
                  setPaymentOpen(true);
                }}
              >
                <Plus size={15} />
                Add milestone
              </button>
            )}
          </div>
          <DataGrid ariaLabel="Payment milestones" emptyTitle="No payment milestones yet" emptyDescription="Add the agreed payment schedule." data={state.data.payments} getRowId={row=>row.id} searchLabel="Search payment milestones" exportFileName="payment-milestones.csv"  columns={[{id:"title",header:"Milestone",size:230,accessorFn:(p)=>p.title,cell:({row:{original:p}})=>{return <>
                      {p.title}
                      {p.requiredForRelease && (
                        <small className={s.detail}>
                          Required before release
                        </small>
                      )}
                      {p.requiredForProduction && (
                        <small className={s.detail}>
                          Required before manufacturing
                        </small>
                      )}
                      {p.proof && (
                        <small className={s.detail} title={p.proof}>
                          Client evidence: {p.proof}
                        </small>
                      )}
                    </>;}},
{id:"due",header:"Due",size:180,accessorFn:(p)=>p.dueDate || p.trigger || "To schedule",cell:({row:{original:p}})=>{return <>{p.dueDate || p.trigger || "To schedule"}</>;}},
{id:"amount",header:"Amount",size:150,accessorFn:(p)=>p.amount,cell:({row:{original:p}})=>{return <>{money(p.amount, accepted.currency)}</>;}},
	{id:"status",header:"Status",size:140,accessorFn:(p)=>statusLabel[p.status],cell:({row:{original:p}})=>{return <>
                      <span className={s.status} data-status={p.status}>
                        {statusLabel[p.status]}
                      </span>
                    </>;}},
	{id:"receipt",header:"Receipt truth",size:190,accessorFn:(p)=>state.data.receipts?.find((receipt)=>receipt.paymentId===p.id&&receipt.status!=="rejected")?.status??"request_only",cell:({row:{original:p}})=>{const receipt=state.data.receipts?.find((item)=>item.paymentId===p.id&&item.status!=="rejected");return <>{receipt?.status === "finance_verified" ? "Finance verified" : receipt?.status === "provider_confirmed" ? "Provider confirmed" : receipt?.status === "reported" ? "Receipt reported" : "Payment request only"}</>; }},
	{id:"reference",header:"Accounting reference",size:240,accessorFn:(p)=>p.reference,cell:({row:{original:p}})=>{return <>
                      {p.reference || "—"}
                      <PaymentInvoice
                        currency={
                          state.data.quotes.find(
                            (q) => q.id === p.sourceQuoteId,
                          )?.currency ??
                          state.currency ??
                          "AED"
                        }
                        customerName={state.customerName}
                        workspaceId={state.workspaceId}
                        payment={p}
                        busy={busy}
                        canVerifyFinance={state.canVerifyFinance}
                        run={run}
                      />
                    </>;}},
	{id:"action",header:"Action",size:240,enableSorting:false,enableColumnFilter:false,cell:({row:{original:p}})=>{const receipt=state.data.receipts?.find((item)=>item.paymentId===p.id&&item.status!=="rejected");return <>
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
                            Set due date
                          </button>
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
                              Record receipt
                            </Button>
                          )}
                        {state.canVerifyFinance && p.status === "proof_submitted" && Boolean(receipt) && (
                          <Button
                            size="compact"
                            onPress={() => setVerify(p.id)}
                          >
                            Finance verify
                          </Button>
                        )}
                      </div>
                    </>;}}]}/>

        </>
      )}
      {tab === "payments" && (
        <ClientCredits state={state} run={run} busy={busy} />
      )}
      <ControlledModalDialog
        isOpen={paymentOpen}
        onOpenChange={setPaymentOpen}
        title="Payment milestone"
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
          <label>
            Milestone
            <input
              disabled={Boolean(payment.sourceQuoteId)}
              required
              value={payment.title}
              onChange={(e) =>
                setPayment({ ...payment, title: e.target.value })
              }
            />
          </label>
          <div className={s.grid}>
            <label>
              Amount
              <input
                disabled={Boolean(payment.sourceQuoteId)}
                required
                type="number"
                min=".01"
                step=".01"
                value={payment.amount}
                onChange={(e) =>
                  setPayment({ ...payment, amount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Due date
              <input
                required
                type="date"
                value={payment.dueDate}
                onChange={(e) =>
                  setPayment({ ...payment, dueDate: e.target.value })
                }
              />
            </label>
          </div>
          <label>
            Zoho / QuickBooks invoice reference
            <input
              value={payment.reference}
              onChange={(e) =>
                setPayment({ ...payment, reference: e.target.value })
              }
            />
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              disabled={Boolean(payment.sourceQuoteId)}
              checked={payment.requiredForRelease}
              onChange={(e) =>
                setPayment({ ...payment, requiredForRelease: e.target.checked })
              }
            />
            Required before execution release
          </label>
          <Checkbox
            isDisabled={Boolean(payment.sourceQuoteId)}
            isSelected={payment.requiredForProduction}
            onChange={(selected) =>
              setPayment({ ...payment, requiredForProduction: selected })
            }
          >
            Required before manufacturing starts
          </Checkbox>
          <button className={s.primary} disabled={busy}>
            Save milestone
          </button>
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
                label="Receipt / transaction reference"
                value={reference}
                onChange={setReference}
              />
              <TextAreaField
                isRequired
                label="Receipt evidence"
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
}: Props & { root: string }) {
  const [tab, setTab] = useState("owner"),
    [note, setNote] = useState(""),
    [decisionNote, setDecisionNote] = useState(""),
    [commission, setCommission] = useState(state.data.ownerReview?.commission ?? 0),
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
    accepted = d.quotes.find(
      (q) => q.kind === "quotation" && q.status === "accepted",
    );
  const checks = [
    {
      label: "Client accepted the quotation",
      done: Boolean(accepted),
      href: "quotations",
    },
    {
      label: "Linked design revisions approved",
      done: Boolean(
        accepted &&
          state.releaseReadiness &&
          state.releaseReadiness.designsRequired > 0 &&
          state.releaseReadiness.designsApproved === state.releaseReadiness.designsRequired,
      ),
      href: "designs",
    },
    {
      label: "Signed agreement verified",
      done: Boolean(
        accepted &&
          agreementIsOperational(d.agreement) &&
          agreementMatchesAcceptedQuote(d.agreement, accepted),
      ),
      href: "contracts",
    },
    {
      label: "Required payments verified",
      done:
        d.payments.some((payment) => payment.requiredForRelease) &&
        d.payments
          .filter((payment) => payment.requiredForRelease)
          .every(releasePaymentIsOperational),
      href: "contracts",
    },
    {
      label: "Owner approval and active Deal File",
      done:
        d.ownerReview?.quoteId === accepted?.id &&
        d.ownerReview?.status === "approved" &&
        d.dealFile?.quoteId === accepted?.id,
      href: "execution-release",
    },
    {
      label: "Material selections approved or not applicable",
      done: Boolean(
        accepted && materialApprovalsComplete(accepted, d.materialApprovals),
      ),
      href: "execution-release",
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
      <nav className={s.tabs} aria-label="Approval views">
        {[
          ["owner", "Owner review"],
          ["materials", "Material approvals"],
          ["release", "Release checklist"],
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
            <div className={s.empty}>
              <h2>Client acceptance comes first</h2>
              <p>Issue the reviewed quotation and wait for the assigned client approver.</p>
              <Link className={s.button} href={`${root}/quotations`}>Open quotations →</Link>
            </div>
          ) : <>
            <div className={s.controlSummary}>
              <div><small>Accepted quotation</small><strong>V{accepted.number} · {money(acceptedQuoteValue(accepted), accepted.currency)}</strong></div>
              <div><small>Internal cost</small><strong>{money(acceptedQuoteTotals(accepted).cost, accepted.currency)}</strong></div>
              <div><small>Gross margin</small><strong>{acceptedQuoteTotals(accepted).margin.toFixed(1)}%</strong></div>
              <div><small>Owner review</small><strong>{d.ownerReview ? statusLabel[d.ownerReview.status] ?? d.ownerReview.status : "Not submitted"}</strong></div>
            </div>
            {d.dealFile && <div className={s.dealBanner}><div><small>ACTIVE DEAL FILE</small><strong>{d.dealFile.reference}</strong><span>Approved {d.dealFile.approvedAt.slice(0,10)} by {d.dealFile.approvedBy}</span></div><div><small>Production evidence</small><strong>{d.dealFile.designEvidence?.links.length??0} files · {d.dealFile.materialEvidence?.length??0} materials</strong></div><div><small>Deal value</small><strong>{money(d.dealFile.value, accepted.currency)}</strong></div><div><small>Commission</small><strong>{money(d.dealFile.commission, accepted.currency)}</strong></div></div>}
            {d.ownerReview?.status === "submitted" ? <div className={s.section}>
              <div className={s.header}><div><h2>Review submitted by {d.ownerReview.submittedBy}</h2><p className={s.muted}>{d.ownerReview.submissionNote}</p></div><span className={s.status} data-status="internal_review">Awaiting another owner</span></div>
              <div className={s.checkGrid}>{Object.entries(d.ownerReview.checklist).map(([key, done])=><span key={key} data-done={done}>{done?'✓':'○'} {key.replaceAll('_',' ')}</span>)}</div>
              {state.canApprove&&<><label className={s.decisionField}>Decision remarks<textarea value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder="Required when returning or rejecting."/></label>{!materialApprovalsComplete(accepted,d.materialApprovals)&&<p className={s.notice}>Complete every client material decision before creating the Deal File.</p>}<div className={s.actions}><button className={s.button} disabled={busy||!decisionNote.trim()} onClick={()=>void run('decide_owner_review',{decision:'reject',note:decisionNote})}>Reject</button><button className={s.button} disabled={busy||!decisionNote.trim()} onClick={()=>void run('decide_owner_review',{decision:'return',note:decisionNote})}>Return for correction</button><button className={s.primary} disabled={busy||Object.values(d.ownerReview.checklist).some(value=>!value)||!materialApprovalsComplete(accepted,d.materialApprovals)} onClick={()=>void run('decide_owner_review',{decision:'approve',note:decisionNote})}>Approve & create Deal File</button></div></>}
            </div> : !d.dealFile && <form className={s.ownerForm} onSubmit={async e=>{e.preventDefault();await run('submit_owner_review',{commission,checklist,note});}}>
              {d.ownerReview&&<p className={s.notice}>Previous decision: {statusLabel[d.ownerReview.status]??d.ownerReview.status}. {d.ownerReview.decisionNote}</p>}
              <div><h2>Submit for independent owner review</h2><p className={s.muted}>The owner checks the exact accepted quotation, agreement, payment, margin, materials and supporting documents.</p></div>
              <label>Commission · {accepted.currency}<input type="number" min="0" step="0.01" value={commission} onChange={e=>setCommission(Number(e.target.value))}/></label>
              <div className={s.checkGrid}>{Object.keys(checklist).map(key=><label key={key}><input type="checkbox" checked={checklist[key as keyof typeof checklist]} onChange={e=>setChecklist({...checklist,[key]:e.target.checked})}/><span>{key.replaceAll('_',' ')}</span></label>)}</div>
              <label>Submission note<textarea required value={note} onChange={e=>setNote(e.target.value)} placeholder="Summarize the payment evidence, pricing decision and any conditions."/></label>
              {state.canEdit&&<button className={s.primary} disabled={busy||!note.trim()}>Submit owner review</button>}
            </form>}
          </>}
        </>
      ) : tab === "materials" ? (
        <>
          <div className={s.header}><div><h2>Client material selections</h2><p className={s.muted}>Prepare from the accepted quotation, add the exact sample details, then send each selection to the assigned client approver.</p></div>{state.canEdit&&<button className={s.button} disabled={busy||!accepted} onClick={()=>void run('sync_material_approvals')}>Prepare from quotation</button>}</div>
          {(d.materialApprovals ?? []).filter(item=>item.quoteId===accepted?.id).map(item=><div className={s.materialRow} key={item.id}>
            {item.photo?<Image src={item.photo} alt="" width={64} height={64} unoptimized/>:<span className={s.materialThumb}>No photo</span>}
            <div><strong>{item.name}</strong><span>{item.room} · {item.item}</span><small>{[item.brand,item.code].filter(Boolean).join(' · ')||item.specification}</small>{item.decisionNote&&<small>Client remark: {item.decisionNote}</small>}</div>
            <span className={s.status} data-status={item.status}>{statusLabel[item.status]??item.status.replaceAll('_',' ')}</span>
            {state.canEdit&&['proposed','rejected'].includes(item.status)&&<button className={s.button} onClick={()=>{setSelectedMaterial(item.id);setMaterialDraft({...item});}}>Edit</button>}
            {state.canEdit&&item.status==='proposed'&&<button className={s.primary} disabled={busy||!approver} onClick={()=>void run('submit_material_approval',{materialApprovalId:item.id,approverId:approver})}>Send to client</button>}
          </div>)}
          {!(d.materialApprovals ?? []).some(item=>item.quoteId===accepted?.id)&&<div className={s.empty}><h2>No selections prepared</h2><p>Accept the quotation, then prepare its materials for client review.</p></div>}
          {(d.materialApprovals ?? []).some(item=>item.quoteId===accepted?.id&&item.status==='proposed')&&<label className={s.approverField}>Client approver<select value={approver} onChange={e=>setApprover(e.target.value)}><option value="">Choose approver…</option>{state.contacts.filter(contact=>contact.active&&contact.role==='approver').map(contact=><option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label>}
          <ControlledModalDialog isOpen={Boolean(selectedMaterial)} onOpenChange={open=>{if(!open){setSelectedMaterial('');setMaterialDraft(null);}}} title="Edit material selection">
            {materialDraft&&<form className={s.form} onSubmit={async e=>{e.preventDefault();if(await run('save_material_approval',{materialApprovalId:materialDraft.id,name:materialDraft.name,code:materialDraft.code,brand:materialDraft.brand,specification:materialDraft.specification,note:materialDraft.note,photo:materialDraft.photo??''})){setSelectedMaterial('');setMaterialDraft(null);}}}>
              <label>Material / finish name<input required value={materialDraft.name} onChange={e=>setMaterialDraft({...materialDraft,name:e.target.value})}/></label>
              <div className={s.grid}><label>Brand<input value={materialDraft.brand} onChange={e=>setMaterialDraft({...materialDraft,brand:e.target.value})}/></label><label>Product code<input value={materialDraft.code} onChange={e=>setMaterialDraft({...materialDraft,code:e.target.value})}/></label></div>
              <label>Specification<textarea required value={materialDraft.specification} onChange={e=>setMaterialDraft({...materialDraft,specification:e.target.value})}/></label>
              <label>Internal note<textarea value={materialDraft.note} onChange={e=>setMaterialDraft({...materialDraft,note:e.target.value})}/></label>
              <label>Sample photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>180000){e.target.value='';return;}const reader=new FileReader();reader.onload=()=>setMaterialDraft(current=>current?{...current,photo:String(reader.result)}:current);reader.readAsDataURL(file);}}/><small>PNG, JPEG or WebP · up to 180 KB.</small></label>
              <button className={s.primary} disabled={busy}>Save selection</button>
            </form>}
          </ControlledModalDialog>
        </>
      ) : tab === "release" ? (
        <>
          <p className={s.muted}>
            Release the accepted scope after checking technical and site
            conditions. This opens the connected project with its approved BOQ
            and payment evidence.
          </p>
          {checks.map((c) => (
            <div key={c.label} className={s.section}>
              <div className={s.header}>
                <span>
                  {c.done ? "✓" : "○"} {c.label}
                </span>
                <Link href={`${root}/${c.href}`}>Review →</Link>
              </div>
            </div>
          ))}
          {d.release ? (
            <p className={s.notice}>
              Readiness recorded by {d.release.by} on{" "}
              {d.release.at.slice(0, 10)}.<br />
              {d.release.note}
              {d.release.projectId && (
                <>
                  <br />
                  <Link
                    href={`/workspace/projects/${d.release.projectId}/overview`}
                  >
                    Open project →
                  </Link>
                </>
              )}
            </p>
          ) : (
            <div
              className={s.form}
              style={{ marginTop: "1rem", maxWidth: "45rem" }}
            >
              <label>
                Technical approvals, released scope and any conditions
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Reference the approved drawings, scope and site checks. Record any authorized conditions."
                />
              </label>
              {state.canRelease && (
                <button
                  className={s.primary}
                  disabled={
                    busy ||
                    !commercialReleaseInputsReady(d) ||
                    !state.releaseReadiness ||
                    state.releaseReadiness.designsRequired === 0 ||
                    state.releaseReadiness.designsApproved !== state.releaseReadiness.designsRequired ||
                    !note.trim()
                  }
                  onClick={() => void run("release", { note })}
                >
                  Release & open project
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
