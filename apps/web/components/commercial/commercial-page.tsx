"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useWoddyRecord } from "@/components/crm/woddy-chat";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { QuotationList } from "./quotation-list";
import { SERVICE_PATHS } from "@/lib/commercial/service-paths";
import { History, Plus } from "lucide-react";
import {
  Button,
  ControlledModalDialog,
  DesignSystemProvider,
  IconButton,
  SelectField,
  useConfirmationDialog,
  useDesignSystem, EmptyState
} from "@/design-system";
import { usePreProject } from "@/components/pre-project/pre-project-context";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import {
  changedLines,
  acceptedQuoteValue,
  commercialPath,
  jsonRequest,
  money,
  statusLabel,
} from "@/lib/commercial/client";
import { ClientContacts } from "@/components/client-portal/client-contacts";
import { ScopeImport } from "./scope-import";
import { PreProjectSectionLoading } from "../pre-project/section-loading";
import { useWorkspaceFocus } from "@/components/workspace/workspace-focus";
import { QuotationEditor } from "./quotation-editor";
import { QuotationScopeComposer } from "./quotation-scope-composer";
import {
  CommercialRequests,
  AgreementPayments,
  ApprovalRelease,
} from "./commercial-workflows";
import { PreExecutionFlow } from "./pre-execution-flow";
import { QuotationBuilderPreview } from "./quotation-builder-preview";
import s from "./commercial.module.css";
import colors from "../crm/crm-workspace-colors.module.css";
const QuotationStudio = dynamic(() => import('./quotation-studio').then(module => module.QuotationStudio), { loading: PreProjectSectionLoading });
const labels: Record<string, string> = {
  "client-portal": "Client portal",
  boq: "Design Quote",
  quotations: "Quotations",
  contracts: "Agreements & Payments",
  "payment-plan": "Agreements & Payments",
  variations: "Change requests",
  approvals: "Approvals & release",
  "execution-release": "Release readiness",
};
export function CommercialPage({
  initial,
  record,
  section,
  search,
  quotationId,
  reviewOnly = false,
  quotationPresentation = "table",
  embedded = false,
  projectId,
  openRequestId,
}: {
  initial: CommercialState;
  record: PreProjectCase;
  section: string;
  search: string;
  quotationId?: string;
  reviewOnly?: boolean;
  quotationPresentation?: "cards" | "table";
  embedded?: boolean;
  projectId?: string;
  /** A change request to open as the page loads (a notification's link). */
  openRequestId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const quotationList = section === "quotations" && !quotationId;
  const projectPlanningHref = (part: string, quote?: string) => {
    if (!projectId) return "";
    const query = new URLSearchParams({ tab: "planning", planningTab: part });
    if (quote) query.set("quote", quote);
    return `/workspace/projects/${projectId}?${query}`;
  };
  const rootHref = projectId
    ? projectPlanningHref("quotations")
    : `/workspace/pre-projects/cases/${record.id}/quotations${search ? `?${search}` : ""}`;
  const quoteHref = (id: string) => {
    if (projectId) return projectPlanningHref("quotations", id);
    const query = new URLSearchParams(search);
    query.set("quote", id);
    return `/workspace/pre-projects/cases/${record.id}/quotations?${query}`;
  };
  const initialQuote =
    (quotationId
      ? initial.data.quotes.find((q) => q.id === quotationId)
      : initial.data.quotes.at(-1)) ?? null;
  useWoddyRecord("commercial", record.id, record.title);
  useWorkspaceFocus(
    !reviewOnly && section === "quotations" && quotationId ? record.title : undefined,
    rootHref,
  );
  const design = useDesignSystem(),
    { setSelected } = usePreProject();
  const [state, setState] = useState(initial),
    [selected, setSelectedQuote] = useState(initialQuote?.id ?? ""),
    [draft, setDraft] = useState<Quote | null>(initialQuote),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState(""),
    [approver, setApprover] = useState("");
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const saved = state.data.quotes.find((q) => q.id === selected),
    dirty = Boolean(
      draft && saved && JSON.stringify(draft) !== JSON.stringify(saved),
    );
  useEffect(() => {
    setSelected({ record, search });
  }, [record, search, setSelected]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const leave = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.href === window.location.href
      )
        return;
      event.preventDefault(); event.stopPropagation();
      requestConfirmation({ title: "Discard unsaved quotation edits?", body: "The saved quotation will remain unchanged. Your current edits will be lost.", confirmLabel: "Discard edits", onConfirm: () => window.location.assign(anchor.href) });
    };
    document.addEventListener("click", leave, true);
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", leave, true); };
  }, [dirty, requestConfirmation]);
  const path = commercialPath(state.workspaceId, `cases/${state.caseId}`);
  async function reload(choose?: string) {
    const next = await jsonRequest<CommercialState>(path);
    setState(next);
    const q =
      next.data.quotes.find((q) => q.id === (choose ?? selected)) ??
      (quotationId ? null : next.data.quotes.at(-1)) ??
      null;
    setSelectedQuote(q?.id ?? "");
    setDraft(q);
    return next;
  }
  async function run(action: string, input: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let revision = state.data.revision;
      if (dirty && action !== "save" && draft) {
        const saved = await jsonRequest<{ data: CommercialState["data"] }>(
          path,
          "POST",
          { action: "save", quoteId: draft.id, quote: draft, revision },
        );
        revision = saved.data.revision;
        setState((current) => ({ ...current, data: saved.data }));
        setDraft(saved.data.quotes.find((q) => q.id === draft.id) ?? draft);
      }
      const result = await jsonRequest<{ data: CommercialState["data"] }>(
        action === "invoice" ? commercialPath(state.workspaceId, `cases/${state.caseId}/invoice`) : path,
        "POST",
        {
          action,
          revision,
          quoteId: draft?.id,
          ...input,
          ...(action === "save" ? { quote: draft } : {}),
        },
      );
      const createdId = ["create", "revise", "variation"].includes(action)
        ? result.data.quotes.at(-1)?.id
        : undefined;
      let refreshFailed = false;
      try {
        await reload(createdId);
      } catch {
        // The mutation succeeded. Keep its authoritative response so a failed
        // follow-up read cannot invite the user to repeat a non-idempotent action.
        refreshFailed = true;
        const quote = result.data.quotes.find((item) => item.id === (createdId ?? selected))
          ?? (quotationId ? null : result.data.quotes.at(-1))
          ?? null;
        setState((current) => ({ ...current, data: result.data }));
        setSelectedQuote(quote?.id ?? "");
        setDraft(quote);
      }
      setNotice(refreshFailed
        ? "Saved. Latest changes are shown; refresh when the connection returns."
        : action === "issue"
          ? "Issued to the client portal. Copy the portal link to share it."
          : action === "save"
            ? "Quotation saved."
            : "Saved.");
      setDialog("");
      if (
        section === "quotations" &&
        ["create", "revise", "variation"].includes(action)
      ) {
        const created = result.data.quotes.at(-1);
        if (created) router.push(quoteHref(created.id));
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    const applyChoice = () => {
      if (section === "quotations") router.push(reviewOnly ? `/workspace/pre-projects/cases/${record.id}/approvals?review=${encodeURIComponent(`quote:${id}`)}` : quoteHref(id));
      setSelectedQuote(id);
      setDraft(state.data.quotes.find((q) => q.id === id) ?? null);
    };
    if (dirty) {
      requestConfirmation({ title: "Discard unsaved quotation edits?", body: "The saved quotation will remain unchanged. Your current edits will be lost.", confirmLabel: "Discard edits", onConfirm: applyChoice });
      return;
    }
    applyChoice();
  }
  const quotePage = ["boq", "quotations"].includes(section),
    root = `/workspace/pre-projects/cases/${state.caseId}`,
    showReadinessFlow = ["approvals", "execution-release"].includes(section);
  return (
    <DesignSystemProvider {...design} className={colors.theme}>
      <section
        className={`${s.page} ${reviewOnly ? s.reviewPage : ""} ${section === "quotations" && !quotationId ? s.quotationTablePage : ""} ${!reviewOnly && section === "quotations" && quotationId && draft ? s.studioPage : ""}`}
      >
        {section === "quotations" && quotationId && draft && (
          <h1 className={s.visuallyHidden}>{t("Quotations")}</h1>
        )}
        {section !== "quotations" && section !== "contracts" && section !== "payment-plan" && (
          <h1 className={s.visuallyHidden}>{labels[section]}</h1>
        )}
        {showReadinessFlow && !embedded && (!state.data.palmFlow || state.data.palmFlow.scope.mainQuotation) ? <PreExecutionFlow state={state} section={section} root={root} /> : null}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {notice && !(section === "quotations" && quotationId) && (
          <p role="status" className={s.muted}>
            {notice}
          </p>
        )}
        {quotationList && state.palmFlowEnabled && !state.data.quotes.length && (
          <section className={s.flowChooser} aria-label={t("Enquiry service path")}>
            <div>
              <h2>{t("Service path")}</h2>
              <p>{state.data.palmFlow
                ? "Confirmed for this enquiry. Create the quotation when its requirements are ready."
                : "Choose what the client is buying before preparing the first quotation. This keeps inapplicable project stages out of the way."}</p>
            </div>
            {state.data.palmFlow
              ? <span className={s.flowSelected}>{SERVICE_PATHS.find(path => JSON.stringify(path.scope) === JSON.stringify(state.data.palmFlow?.scope))?.label ?? "Custom service path"}</span>
              : <div className={s.flowChoices}>{SERVICE_PATHS.map(path => (
                  <Button key={path.label} size="compact" isDisabled={busy || !state.canEdit} onPress={() => void run("set_palm_flow", { scope: path.scope })}>
                    {path.label}
                  </Button>
                ))}</div>}
          </section>
        )}
        {quotationList ? (
          <QuotationList
            initialPresentation={quotationPresentation}
            state={state}
            busy={busy}
            create={() => void run("create")}
            href={quoteHref}
            open={(id) => router.push(quoteHref(id))}
          />
        ) : section === "quotations" && quotationId && !draft ? (
          <EmptyState illustration="search" title={t("Quotation not found")} action={<Link className="wd-button" data-size="compact" data-variant="primary" href={rootHref}>{t("Back to quotations")}</Link>} />
        ) : quotePage ? (
          draft ? (
            <>
              <div className={s.toolbar} data-quotation-toolbar={!reviewOnly && section === "quotations" || undefined}>
                <div className={s.actions}>
                  {section !== "quotations" ? <strong>
                    {draft.kind === "variation" ? "Variation" : "Quotation"}
                  </strong> : null}
                  <SelectField
                    label={<span className="wd-visually-hidden">{t("Quotation version")}</span>}
                    items={state.data.quotes.map((q) => ({ id: q.id, label: `V${q.number} · ${statusLabel[q.status]}` }))}
                    selectedKey={selected}
                    onSelectionChange={(key) => choose(String(key))}
                    isDisabled={busy}
                  />
                  {section !== "quotations" ? <span className={s.status} data-status={draft.status}>
                    {statusLabel[draft.status]}
                  </span> : null}
                  {draft.qsEstimate && <span className={s.muted}>{t("QS checked ·")}{" "}{draft.qsEstimate.reviewedBy}</span>}
                  {dirty ? (
                    <span className={s.muted}>{t("Unsaved edits")}</span>
                  ) : (
                    notice && (
                      <span role="status" className={s.muted}>
                        {notice}
                      </span>
                    )
                  )}
                </div>
                {!reviewOnly && state.canEdit && draft.status === "draft" && draft.direction !== "deduction" && section === "quotations" ? <QuotationScopeComposer
                  key={draft.id}
                  compact
                  workspaceId={state.workspaceId}
                  caseId={state.caseId}
                  quoteId={draft.id}
                  revision={state.data.revision}
                  lineCount={draft.lines.length}
                  dirty={dirty}
                  onApplied={() => reload(draft.id)}
                /> : null}
                <div className={s.actions}>
                  <IconButton
                    aria-label={t("Version history")}
                    size="compact"
                    onPress={() => setDialog("history")}
                  >
                    <History size={16} />
                  </IconButton>
                  {draft.issuedAt && (
                    <a
                      className={s.button}
                      href={`/quotation/${state.caseId}?quote=${draft.id}${draft.hash ? `&snapshot=${draft.hash}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Print / PDF")}</a>
                  )}
                  {state.canEdit && draft.status === "draft" && (
                    <>
                      <Button
                        size="compact"
                        isDisabled={busy}
                        hidden={section === "quotations"}
                        onPress={() => setDialog("scope")}
                      >
                        {t("Import scope")}</Button>
                      <Button
                        size="compact"
                        isDisabled={busy || !dirty}
                        hidden={reviewOnly}
                        onPress={() => void run("save")}
                      >
                        {t("Save changes")}</Button>
                      <Button
                        size="compact"
                        variant="primary"
                        isDisabled={busy || !draft.lines.length}
                        onPress={() => void run("submit")}
                      >
                        {t("Submit for review")}</Button>
                    </>
                  )}
                  {state.canEdit &&
                    ["internal_review", "internal_approved"].includes(
                      draft.status,
                    ) && (
                      <Button
                        size="compact"
                        isDisabled={busy}
                        onPress={() => void run("return")}
                      >
                        {t("Return to draft")}</Button>
                    )}
                  {state.data.palmFlow && state.canEstimate && draft.status === "internal_review" && draft.kind === "quotation" && (
                    <Button
                      size="compact"
                      variant="primary"
                      isDisabled={busy}
                      onPress={() => void run("qs_approve")}
                    >
                      {t("Approve QS estimate")}</Button>
                  )}
                  {!state.data.palmFlow && state.canApprove && draft.status === "internal_review" && (
                    <Button
                      size="compact"
                      variant="primary"
                      isDisabled={busy}
                      onPress={() => void run("approve")}
                    >
                      {t("Approve pricing")}</Button>
                  )}
                  {state.canEdit && draft.status === "internal_approved" && (
                    <Button
                      size="compact"
                      variant="primary"
                      isDisabled={busy}
                      onPress={() => setDialog("issue")}
                    >
                      {reviewOnly ? "Send to client" : "Issue quotation"}
                    </Button>
                  )}
                  {state.canEdit && draft.status === "issued" && (
                    <Button
                      size="compact"
                      isDisabled={busy}
                      onPress={() => void run("withdraw")}
                    >
                      {t("Withdraw")}</Button>
                  )}
                  {state.canEdit && draft.status === "accepted" && (
                    <Link className={s.primary} href={`${root}/variations`}>
                      {t("Request a change")}</Link>
                  )}
                  {state.canEdit &&
                    !["draft", "internal_review", "internal_approved", "accepted"].includes(
                      draft.status,
                    ) && (
                      <Button
                        size="compact"
                        variant="primary"
                        isDisabled={busy}
                        onPress={() => void run("revise")}
                      >
                        {t("Create revision")}</Button>
                    )}
                </div>
              </div>
              
              {section === "boq" && <>
              <QuotationsChangeSummary
                draft={draft}
                previous={state.data.quotes
                  .filter(
                    (q) => q.number < draft.number && q.kind === draft.kind,
                  )
                  .at(-1)}
              />
              <QuotationsReadonlyNote quote={draft} />
              </>}
              {reviewOnly ? <><Link className={s.button} href={quoteHref(draft.id)}>{t("Open quotation editor →")}</Link><QuotationBuilderPreview fitWidth initialPageId="scope" quote={draft} brand={state.portalBrand} customerName={record.customerName}/></> : <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <Editor
                  onSave={() => run("save")}
                  onImportScope={() => setDialog("scope")}
                  state={state}
                  customerName={record.customerName}
                  studio={section === "quotations"}
                  workspaceId={state.workspaceId}
                  caseId={state.caseId}
                  canOverridePrice={Boolean(state.canOverridePrice)}
                  canEditCosts={Boolean(state.canEditCosts)}
                  quote={draft}
                  onChange={setDraft}
                  costing={section === "boq" && Boolean(state.canViewCosts)}
                  readOnly={!state.canEdit || draft.status !== "draft"}
                  requests={state.data.requests}
                />
              </fieldset>}
            </>
          ) : (
            <EmptyState title={section === "boq" ? "Prepare quotation items" : "Create your first quotation"} description={t("Import the included scope, choose materials and set rates. The same items carry into the quotation.")}
              action={state.canEdit ? <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void run("create")}><Plus size={15} />{t("Create quotation")}</Button> : undefined} />
          )
        ) : section === "client-portal" ? (
          <ClientContacts workspaceId={state.workspaceId} caseId={state.caseId} portalSlug={state.portalSlug} portalEnabled={Boolean(state.portalEnabled)} locale={design.locale} onChanged={reload} />
        ) : section === "variations" ? (
          <CommercialRequests
            state={state}
            run={run}
            busy={busy}
            error={error}
            openRequestId={openRequestId}
          />
        ) : ["contracts", "payment-plan"].includes(section) ? (
          <AgreementPayments
            initialView={section === "payment-plan" ? "payments" : "agreement"}
            state={state}
            run={run}
            busy={busy}
            error={error}
          />
        ) : (
          <ApprovalRelease initialView="owner" state={state} run={run} busy={busy} root={root} sectionHref={projectId ? part => projectPlanningHref(part === "contracts" || part === "payment-plan" ? "agreement" : part === "designs" ? "design" : part === "variations" ? "change-requests" : part === "execution-release" ? "approvals" : part) : undefined} />
        )}
        {draft&&<ScopeImport workspaceId={state.workspaceId} caseId={state.caseId} quote={draft} open={dialog==="scope"} onClose={()=>setDialog("")} busy={busy} run={run}/>}
        <ControlledModalDialog
          isOpen={dialog === "history"}
          onOpenChange={(open) => !open && setDialog("")}
          title={t("Version & activity history")}
        >
          <ul className={s.history}>
            {state.data.quotes
              .slice()
              .reverse()
              .map((q) => (
                <li key={q.id}>
                  <Button
                    size="compact"
                    variant="quiet"
                    onPress={() => {
                      choose(q.id);
                      setDialog("");
                    }}
                  >
                    V{q.number} · {statusLabel[q.status]} ·{" "}
                    {money(acceptedQuoteValue(q), q.currency)}
                  </Button>
                  <p className={s.muted}>
                    {q.decidedBy
                      ? `${q.decidedBy} · ${q.decidedAt?.slice(0, 10)}`
                      : q.issuedAt
                        ? `Issued ${q.issuedAt.slice(0, 10)}`
                        : "Internal draft"}
                  </p>
                </li>
              ))}
          </ul>
          <h3>{t("Activity")}</h3>
          <ul className={s.history}>
            {state.data.audit
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
        </ControlledModalDialog>
        <ControlledModalDialog
          isOpen={dialog === "issue"}
          onOpenChange={(open) => !open && setDialog("")}
          title={t("Issue this quotation")}
          footer={
            <Button
              size="compact"
              variant="primary"
              isDisabled={busy || !approver}
              onPress={() => void run("issue", { approverId: approver })}
            >
              {t("Issue V")}{draft?.number}
            </Button>
          }
        >
          <div className={s.form}>
            <p>
              {t("Freeze this version and make it available for the client’s decision. Any previous pending version is replaced.")}</p>
            <SelectField
              label={t("Client approver")}
              placeholder={t("Choose an approver")}
              items={state.contacts
                .filter((c) => c.active && c.role === "approver")
                .map((c) => ({ id: c.id, label: `${c.name} · ${c.phone}` }))}
              selectedKey={approver || null}
              onSelectionChange={(key) => setApprover(String(key))}
            />
            {!state.contacts.some((c) => c.active && c.role === "approver") && (
              <p>
                {t("Add an approver in the")}{" "}
                <Link href={`${root}/client-portal`}>{t("Client portal tab")}</Link>{" "}
                {t("first.")}</p>
            )}
            {error && (
              <p role="alert" className={s.error}>
                {error}
              </p>
            )}
            <p className={s.muted}>
              {t("Publishing to the portal does not send a WhatsApp message.")}</p>
          </div>
        </ControlledModalDialog>
        {confirmationDialog}
      </section>
    </DesignSystemProvider>
  );
}
function QuotationsReadonlyNote({ quote }: { quote: Quote }) {
  return quote.status === "draft" ? null : (
    <p className={s.muted}>
      {quote.status === "accepted"
        ? "Accepted version. Materials and prices are fixed; use Create variation to record a change."
        : quote.issuedAt
          ? "Issued version. Use Create revision to edit materials and prices in a new draft."
          : "Pricing is in review. Use Return to draft to edit materials and prices."}
    </p>
  );
}
function QuotationsChangeSummary({
  draft,
  previous,
}: {
  draft: Quote;
  previous?: Quote;
}) {
  const t = useT();
  const changes = changedLines(draft, previous);
  return previous && changes.length ? (
    <section className={s.section}>
      <h3>
        {changes.length} {t("item changes since V")}{previous.number}
      </h3>
      <ul>
        {changes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </section>
  ) : null;
}

function Editor(
  props: React.ComponentProps<typeof QuotationEditor> & {
    studio: boolean;
    onSave: () => Promise<boolean>;
    onImportScope: () => void;
    state: CommercialState;
    customerName: string;
  },
) {
  return props.studio ? (
    <QuotationStudio key={props.quote.id} {...props} initialMode="design" />
  ) : (
    <QuotationEditor {...props} />
  );
}
