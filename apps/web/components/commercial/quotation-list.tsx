"use client";
import { Button, DataGrid, SearchInput, SelectField } from "@/design-system";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, LayoutGrid, Plus, Table2 } from "lucide-react";
import type { CommercialState } from "@/lib/commercial/types";
import { acceptedQuoteValue, money, statusLabel } from "@/lib/commercial/client";
import tableStyles from "../workspace/workspace.module.css";
import s from "./commercial.module.css";
import cards from "./quotation-cards.module.css";
export function QuotationList({
  state,
  busy,
  create,
  href,
  open,
  initialPresentation = "table",
}: {
  state: CommercialState;
  busy: boolean;
  create: () => void;
  href: (id: string) => string;
  open: (id: string) => void;
  initialPresentation?: "cards" | "table";
}) {
  const [presentation, setPresentation] = useState(initialPresentation);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("current");
  const quotes = state.data.quotes.slice().reverse(),
    working = quotes.find((q) =>
      ["draft", "internal_review", "internal_approved"].includes(q.status),
    );
  const visible = quotes.filter(
    (q) =>
      (filter === "all" || (filter === "current" && !["superseded", "withdrawn", "declined", "expired"].includes(q.status)) ||
        (filter === "draft"
          ? ["draft", "internal_review", "internal_approved"].includes(q.status)
          : q.status === filter)),
  );
  const views = [{id:"current",label:"Current offers"},{id:"all",label:"Version history"},{id:"draft",label:"Draft & review"},{id:"issued",label:"Awaiting client"},{id:"accepted",label:"Accepted"}];
  const createDisabled = busy || (state.palmFlowEnabled && !state.data.palmFlow);
  const canStartMainRound = Boolean(
    state.data.palmFlow?.scope.design && state.data.palmFlow.scope.mainQuotation &&
    state.data.dealFile && !state.data.quotes.some(quote => quote.kind === "quotation" && quote.round === "main"),
  );
  const primaryAction = !quotes.length || canStartMainRound
    ? <Button variant="primary" size="compact" isDisabled={createDisabled} onPress={create}>
        <Plus size={14}/>{canStartMainRound ? "Prepare main quotation" : "Create quotation"}
      </Button>
    : working ? <Link className={s.button} href={href(working.id)}>Continue {working.status === "draft" ? "draft" : "review"}</Link> : null;
  const actions = state.canEdit ? primaryAction : null;
  const matching = visible.filter(quote => `${quote.title} ${quote.number} ${statusLabel[quote.status]}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    {initialPresentation === "cards" && <div className={cards.toolbar}>
      <h2>Quotations</h2>
      <div className={cards.actions}>
        <div role="group" aria-label="Quotation display">
          <Button size="compact" variant="quiet" aria-label="Quotation cards" aria-pressed={presentation === "cards"} onPress={() => setPresentation("cards")}><LayoutGrid size={15}/></Button>
          <Button size="compact" variant="quiet" aria-label="Quotation table" aria-pressed={presentation === "table"} onPress={() => setPresentation("table")}><Table2 size={15}/></Button>
        </div>
        {presentation === "cards" && actions}
      </div>
    </div>}
    {presentation === "cards" ? <>
      <div className={cards.filters}>
        <SearchInput label="Search quotations" value={search} onChange={setSearch}/>
        <SelectField label="Quotation status" items={views} selectedKey={filter} onSelectionChange={key => setFilter(String(key ?? "current"))}/>
      </div>
      <div className={cards.grid}>
        {matching.map(quote => <article className={cards.card} key={quote.id}>
          <div className={cards.meta}><span className={cards.icon}><FileText size={20} aria-hidden="true"/></span><span className={s.status} data-status={quote.status}>{statusLabel[quote.status] ?? quote.status}</span></div>
          <h3><Link href={href(quote.id)}>{quote.title}</Link></h3>
          <p className={cards.reference}>QT-{quote.id.slice(0,8).toUpperCase()} · Version {quote.number}{quote.kind === "variation" ? " · Variation" : ""}</p>
          <strong className={cards.amount}>{money(acceptedQuoteValue(quote), quote.currency)}</strong>
          <dl><div><dt>Items</dt><dd>{quote.lines.length}</dd></div><div><dt>Valid until</dt><dd>{quote.validUntil || "Not set"}</dd></div></dl>
          <Link className={cards.open} href={href(quote.id)}>{["draft", "internal_review", "internal_approved"].includes(quote.status) ? "Open quotation" : "View version"}<ArrowRight size={14} aria-hidden="true"/></Link>
        </article>)}
      </div>
      {!matching.length && <div className={cards.empty}><h3>{quotes.length ? "No matching quotations" : "No quotations yet"}</h3><p>{quotes.length ? "Try a different search or status filter." : state.canEdit ? "Create a quotation from the project requirements." : "Quotations will appear here when your team creates them."}</p></div>}
    </> : (
    <div className={tableStyles.recordTablePanel}>
      <DataGrid selectable={false} ariaLabel="Quotations" selectedView={filter} onViewChange={setFilter} savedViews={[{id:"current",label:"Current offers"},{id:"all",label:"Version history"},{id:"draft",label:"Draft & review"},{id:"issued",label:"Awaiting client"},{id:"accepted",label:"Accepted"}]} toolbarActions={actions ?? undefined} emptyTitle={quotes.length?"No matching quotations":"No quotations yet"} emptyDescription={quotes.length?"Try another search or status.":""} data={visible} getRowId={row=>row.id} searchLabel="Search quotations" exportFileName="quotations.csv" onRowAction={q=>open(q.id)} columns={[{id:"title",header:"Quotation",size:300,accessorFn:(q)=>q.title,cell:({row:{original:q}})=>{return <>
                  <Link href={href(q.id)} className={s.quoteLink}>
                    {q.title}
                  </Link>
                  <small className={s.detail}>
                    QT-{q.id.slice(0, 8).toUpperCase()}
                    {q.kind === "variation" ? " · Variation" : q.round ? ` · ${q.round === "design" ? "Design" : "Main"}` : ""}
                  </small>
                </>;}},
{id:"version",header:"Version",size:90,accessorFn:(q)=>q.number,cell:({row:{original:q}})=>{return <>V{q.number}</>;}},
{id:"total",header:"Amount",size:150,accessorFn:(q)=>acceptedQuoteValue(q),cell:({row:{original:q}})=>{return <>{money(acceptedQuoteValue(q), q.currency)}</>; }},
{id:"status",header:"Status",size:170,accessorFn:(q)=>statusLabel[q.status],cell:({row:{original:q}})=>{return <>
                  <span className={s.status} data-status={q.status}>
                    {statusLabel[q.status]}
                  </span>
                </>;}},
{id:"validUntil",header:"Valid until",size:140,accessorFn:(q)=>q.validUntil,cell:({row:{original:q}})=>{return <>{q.validUntil}</>;}},
{id:"action",header:"Action",size:150,enableSorting:false,enableColumnFilter:false,cell:({row:{original:q}})=>{return <>
                  <Link
                    className={s.builderLink}
                    aria-label={`Open quotation builder for ${q.title}`}
                    href={`${href(q.id)}${href(q.id).includes("?") ? "&" : "?"}builder=blank`}
                  >
                    {["draft", "internal_review", "internal_approved"].includes(q.status) ? "Open quotation" : "View version"}
                  </Link>
                </>;}}]}/>


    </div>
  )}</>;
}
