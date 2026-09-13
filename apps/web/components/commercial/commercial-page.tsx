"use client";
import { useWoddyRecord } from "@/components/crm/woddy-chat";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { QuotationList } from "./quotation-list";
import { FileText, History, Plus, RefreshCw } from "lucide-react";
import {
  ControlledModalDialog,
  DesignSystemProvider,
  useDesignSystem,
} from "@/design-system";
import { usePreProject } from "@/components/pre-project/pre-project-context";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import {
  changedLines,
  commercialPath,
  jsonRequest,
  money,
  statusLabel,
} from "@/lib/commercial/client";
import { ClientAccess } from "./client-access";
import { ScopeImport } from "./scope-import";
import { PreProjectSectionLoading } from "../pre-project/section-loading";
import { useWorkspaceFocus } from "@/components/workspace/workspace-focus";
import { QuotationEditor } from "./quotation-editor";
import {
  CommercialRequests,
  AgreementPayments,
  ApprovalRelease,
} from "./commercial-workflows";
import { PreExecutionFlow } from "./pre-execution-flow";
import s from "./commercial.module.css";
import colors from "../crm/crm-workspace-colors.module.css";
const QuotationStudio = dynamic(() => import('./quotation-studio').then(module => module.QuotationStudio), { loading: PreProjectSectionLoading });
const labels: Record<string, string> = {
  "client-portal": "Client portal",
  boq: "BOQ & costing",
  quotations: "Quotations",
  contracts: "Agreement & payments",
  "payment-plan": "Agreement & payments",
  variations: "Change requests",
  approvals: "Approvals & release",
  "execution-release": "Approvals & release",
};
export function CommercialPage({
  initial,
  record,
  section,
  search,
  quotationId,
}: {
  initial: CommercialState;
  record: PreProjectCase;
  section: string;
  search: string;
  quotationId?: string;
}) {
  const router = useRouter();
  const quotationList = section === "quotations" && !quotationId;
  const rootHref = `/workspace/pre-projects/cases/${record.id}/quotations${search ? `?${search}` : ""}`;
  const quoteHref = (id: string) => {
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
    section === "quotations" && quotationId ? record.title : undefined,
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
      if (!window.confirm("Discard unsaved quotation edits?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", leave, true);
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", leave, true); };
  }, [dirty]);
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
      await reload(
        ["create", "revise", "variation"].includes(action)
          ? result.data.quotes.at(-1)?.id
          : undefined,
      );
      setNotice(
        action === "issue"
          ? "Issued to the client portal. Copy the portal link to share it."
          : action === "save"
            ? "Quotation saved."
            : "Saved.",
      );
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
    if (dirty && !window.confirm("Discard unsaved quotation edits?")) return;
    if (section === "quotations") router.push(quoteHref(id));
    setSelectedQuote(id);
    setDraft(state.data.quotes.find((q) => q.id === id) ?? null);
  }
  const quotePage = ["boq", "quotations"].includes(section),
    root = `/workspace/pre-projects/cases/${state.caseId}`,
    showReadinessFlow = ["contracts", "payment-plan", "variations", "approvals", "execution-release"].includes(section);
  return (
    <DesignSystemProvider {...design} className={colors.theme}>
      <section
        className={`${s.page} ${section === "quotations" && quotationId && draft ? s.studioPage : ""}`}
      >
        {section === "quotations" && quotationId && draft && (
          <h1 className={s.visuallyHidden}>Quotations</h1>
        )}
        {!(section === "quotations" && quotationId && draft) && (
          <header className={s.header}>
            <div>
              <h1>{labels[section]}</h1>
            </div>
            <div className={s.actions}>
              <button
                className={s.icon}
                aria-label="Reload commercial"
                disabled={busy}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Discard unsaved edits and reload?")
                  )
                    void reload().catch((e) => setError(e.message));
                }}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </header>
        )}
        {showReadinessFlow ? <PreExecutionFlow state={state} section={section} root={root} /> : null}
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
        {quotationList ? (
          <QuotationList
            state={state}
            busy={busy}
            create={() => void run("create")}
            href={quoteHref}
            open={(id) => router.push(quoteHref(id))}
          />
        ) : section === "quotations" && quotationId && !draft ? (
          <div className={s.empty}>
            <h2>Quotation not found</h2>
            <Link href={rootHref}>Back to quotations</Link>
          </div>
        ) : quotePage ? (
          draft ? (
            <>
              <div className={s.toolbar}>
                <div className={s.actions}>
                  <strong>
                    {draft.kind === "variation" ? "Variation" : "Quotation"}
                  </strong>
                  <select
                    aria-label="Quotation version"
                    value={selected}
                    onChange={(e) => choose(e.target.value)}
                    disabled={busy}
                  >
                    {state.data.quotes.map((q) => (
                      <option key={q.id} value={q.id}>
                        V{q.number} · {statusLabel[q.status]}
                      </option>
                    ))}
                  </select>
                  <span className={s.status} data-status={draft.status}>
                    {statusLabel[draft.status]}
                  </span>
                  {dirty ? (
                    <span className={s.muted}>Unsaved edits</span>
                  ) : (
                    notice && (
                      <span role="status" className={s.muted}>
                        {notice}
                      </span>
                    )
                  )}
                </div>
                <div className={s.actions}>
                  <button
                    className={s.icon}
                    aria-label="Version history"
                    onClick={() => setDialog("history")}
                  >
                    <History size={16} />
                  </button>
                  {draft.issuedAt && (
                    <a
                      className={s.button}
                      href={`/quotation/${state.caseId}?quote=${draft.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Print / PDF
                    </a>
                  )}
                  {state.canEdit && draft.status === "draft" && (
                    <>
                      <button
                        className={s.button}
                        disabled={busy}
                        hidden={section === "quotations"}
                        onClick={() => setDialog("scope")}
                      >
                        Import scope
                      </button>
                      <button
                        className={s.button}
                        disabled={busy || !dirty}
                        onClick={() => void run("save")}
                      >
                        Save changes
                      </button>
                      <button
                        className={s.primary}
                        disabled={busy || !draft.lines.length}
                        onClick={() => void run("submit")}
                      >
                        Submit for review
                      </button>
                    </>
                  )}
                  {state.canEdit &&
                    ["internal_review", "internal_approved"].includes(
                      draft.status,
                    ) && (
                      <button
                        className={s.button}
                        disabled={busy}
                        onClick={() => void run("return")}
                      >
                        Return to draft
                      </button>
                    )}
                  {state.canApprove && draft.status === "internal_review" && (
                    <button
                      className={s.primary}
                      disabled={busy}
                      onClick={() => void run("approve")}
                    >
                      Approve pricing
                    </button>
                  )}
                  {state.canEdit && draft.status === "internal_approved" && (
                    <button
                      className={s.primary}
                      disabled={busy}
                      onClick={() => setDialog("issue")}
                    >
                      Issue quotation
                    </button>
                  )}
                  {state.canEdit && draft.status === "issued" && (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => void run("withdraw")}
                    >
                      Withdraw
                    </button>
                  )}
                  {state.canEdit &&
                    !["draft", "internal_review", "internal_approved"].includes(
                      draft.status,
                    ) && (
                      <button
                        className={s.primary}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            draft.status === "accepted"
                              ? "variation"
                              : "revise",
                          )
                        }
                      >
                        {draft.status === "accepted"
                          ? "Create variation"
                          : "Create revision"}
                      </button>
                    )}
                </div>
              </div>
              {section==="boq"&&<div className={s.boqContext}><span>01 <strong>Scope & costing</strong></span><span>02 <Link href={quoteHref(draft.id)}>Quotation builder →</Link></span><span>03 <Link href={`${root}/contracts`}>Agreement & payments →</Link></span><small>One set of room items. Costs stay internal.</small></div>}
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
              <fieldset
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
                  quote={draft}
                  onChange={setDraft}
                  costing={section === "boq"}
                  readOnly={!state.canEdit || draft.status !== "draft"}
                  requests={state.data.requests}
                />
              </fieldset>
            </>
          ) : (
            <div className={s.empty}>
              <FileText size={30} />
              <h2>
                {section === "boq"
                  ? "Build your BOQ"
                  : "Create your first quotation"}
              </h2>
              <p>
                Import your included scope, choose materials and set rates. The
                same items carry into your quotation.
              </p>
              {state.canEdit && (
                <button
                  className={s.primary}
                  disabled={busy}
                  onClick={() => void run("create")}
                >
                  <Plus size={15} />
                  Create quotation
                </button>
              )}
            </div>
          )
        ) : section === "client-portal" ? (
          <ClientAccess state={state} reload={reload} />
        ) : section === "variations" ? (
          <CommercialRequests
            state={state}
            run={run}
            busy={busy}
            error={error}
          />
        ) : ["contracts", "payment-plan"].includes(section) ? (
          <AgreementPayments
            state={state}
            run={run}
            busy={busy}
            error={error}
          />
        ) : (
          <ApprovalRelease state={state} run={run} busy={busy} root={root} />
        )}
        {draft&&<ScopeImport workspaceId={state.workspaceId} caseId={state.caseId} quote={draft} open={dialog==="scope"} onClose={()=>setDialog("")} busy={busy} run={run}/>}
        <ControlledModalDialog
          isOpen={dialog === "history"}
          onOpenChange={(open) => !open && setDialog("")}
          title="Version & activity history"
        >
          <ul className={s.history}>
            {state.data.quotes
              .slice()
              .reverse()
              .map((q) => (
                <li key={q.id}>
                  <button
                    className={s.requestButton}
                    onClick={() => {
                      choose(q.id);
                      setDialog("");
                    }}
                  >
                    V{q.number} · {statusLabel[q.status]} ·{" "}
                    {money(q.total, q.currency)}
                  </button>
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
          <h3>Activity</h3>
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
          title="Issue this quotation"
          footer={
            <button
              className={s.primary}
              disabled={busy || !approver}
              onClick={() => void run("issue", { approverId: approver })}
            >
              Issue V{draft?.number}
            </button>
          }
        >
          <div className={s.form}>
            <p>
              Freeze this version and make it available for the client’s
              decision. Any previous pending version is replaced.
            </p>
            <label>
              Client approver
              <select
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
              >
                <option value="">Choose an approver</option>
                {state.contacts
                  .filter((c) => c.active && c.role === "approver")
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
              </select>
            </label>
            {!state.contacts.some((c) => c.active && c.role === "approver") && (
              <p>
                Add an approver in the{" "}
                <Link href={`${root}/client-portal`}>Client portal tab</Link>{" "}
                first.
              </p>
            )}
            {error && (
              <p role="alert" className={s.error}>
                {error}
              </p>
            )}
            <p className={s.muted}>
              Publishing to the portal does not send a WhatsApp message.
            </p>
          </div>
        </ControlledModalDialog>
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
  const changes = changedLines(draft, previous);
  return previous && changes.length ? (
    <details className={s.section}>
      <summary>
        {changes.length} item changes since V{previous.number}
      </summary>
      <ul>
        {changes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </details>
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
    <QuotationStudio key={props.quote.id} {...props} />
  ) : (
    <QuotationEditor {...props} />
  );
}
