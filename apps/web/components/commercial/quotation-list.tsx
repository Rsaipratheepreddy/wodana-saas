"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { Button, DataGrid, SearchInput, SelectField, useDesignSystem } from "@/design-system";
import { translateKnown } from "@/lib/i18n/keys";
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
  const t = useT();
  const { locale } = useDesignSystem();
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
  const views = [{id:"current",label:t("Current offers")},{id:"all",label:t("Version history")},{id:"draft",label:t("Draft & review")},{id:"issued",label:t("Awaiting client")},{id:"accepted",label:t("Accepted")}];
  const status = (value: string) => translateKnown(t, statusLabel[value] ?? value);
  const createDisabled = busy || (state.servicePathEnabled && !state.data.servicePath);
  const canStartMainRound = Boolean(
    state.data.servicePath?.scope.design && state.data.servicePath.scope.mainQuotation &&
    state.data.dealFile && !state.data.quotes.some(quote => quote.kind === "quotation" && quote.round === "main"),
  );
  const primaryAction = !quotes.length || canStartMainRound
    ? <Button variant="primary" size="compact" isDisabled={createDisabled} onPress={create}>
        <Plus size={14}/>{t(canStartMainRound ? "Prepare main quotation" : "Create quotation")}
      </Button>
    : working ? <Link className={s.button} href={href(working.id)}>{t(working.status === "draft" ? "Continue draft" : "Continue review")}</Link> : null;
  const actions = state.canEdit ? primaryAction : null;
  const matching = visible.filter(quote => `${quote.title} ${quote.number} ${status(quote.status)}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    {initialPresentation === "cards" && <div className={cards.toolbar}>
      <h2>{t("Quotations")}</h2>
      <div className={cards.actions}>
        <div role="group" aria-label={t("Quotation display")}>
          <Button size="compact" variant="quiet" aria-label={t("Quotation cards")} aria-pressed={presentation === "cards"} onPress={() => setPresentation("cards")}><LayoutGrid size={15}/></Button>
          <Button size="compact" variant="quiet" aria-label={t("Quotation table")} aria-pressed={presentation === "table"} onPress={() => setPresentation("table")}><Table2 size={15}/></Button>
        </div>
        {presentation === "cards" && actions}
      </div>
    </div>}
    {presentation === "cards" ? <>
      <div className={cards.filters}>
        <SearchInput label={t("Search quotations")} value={search} onChange={setSearch}/>
        <SelectField label={t("Quotation status")} items={views} selectedKey={filter} onSelectionChange={key => setFilter(String(key ?? "current"))}/>
      </div>
      <div className={cards.grid}>
        {matching.map(quote => <article className={cards.card} key={quote.id}>
          <div className={cards.meta}><span className={cards.icon}><FileText size={20} aria-hidden="true"/></span><span className={s.status} data-status={quote.status}>{status(quote.status)}</span></div>
          <h3><Link href={href(quote.id)}>{quote.title}</Link></h3>
          <p className={cards.reference}>{t("Q-{number}", { number: quote.number })}{quote.kind === "variation" ? ` · ${t("Variation")}` : ""}</p>
          <strong className={cards.amount}>{money(acceptedQuoteValue(quote), quote.currency, locale)}</strong>
          <dl><div><dt>{t("Items")}</dt><dd>{quote.lines.length}</dd></div><div><dt>{t("Valid until")}</dt><dd>{quote.validUntil || t("Not set")}</dd></div></dl>
          <Link className={cards.open} href={href(quote.id)}>{t(["draft", "internal_review", "internal_approved"].includes(quote.status) ? "Open quotation" : "View version")}<ArrowRight size={14} aria-hidden="true"/></Link>
        </article>)}
      </div>
      {!matching.length && <div className={cards.empty}><h3>{t(quotes.length ? "No matching quotations" : "No quotations yet")}</h3><p>{t(quotes.length ? "Try a different search or status filter." : state.canEdit ? "Create a quotation from the project requirements." : "Quotations will appear here when your team creates them.")}</p></div>}
    </> : (
    <div className={tableStyles.recordTablePanel}>
      <DataGrid selectable={false} ariaLabel={t("Quotations")} selectedView={filter} onViewChange={setFilter} savedViews={views} toolbarActions={actions ?? undefined} emptyTitle={t(quotes.length?"No matching quotations":"No quotations yet")} emptyDescription={quotes.length?t("Try another search or status."):""} data={visible} getRowId={row=>row.id} searchLabel={t("Search quotations")} exportFileName="quotations.csv" onRowAction={q=>open(q.id)} columns={[{id:"title",header:t("Quotation"),size:300,accessorFn:(q)=>q.title,cell:({row:{original:q}})=>{return <>
                  <Link href={href(q.id)} className={s.quoteLink}>
                    {q.title}
                  </Link>
                  <small className={s.detail}>
                    {t("Q-{number}", { number: q.number })}
                    {q.kind === "variation" ? ` · ${t("Variation")}` : q.round ? ` · ${t(q.round === "design" ? "Design" : "Main")}` : ""}
                  </small>
                </>;}},
{id:"version",header:t("Version"),size:90,accessorFn:(q)=>q.number,cell:({row:{original:q}})=>{return <>{t("V{number}", { number: q.number })}</>;}},
{id:"total",header:t("Amount"),size:150,accessorFn:(q)=>acceptedQuoteValue(q),cell:({row:{original:q}})=>{return <>{money(acceptedQuoteValue(q), q.currency, locale)}</>; }},
{id:"status",header:t("Status"),size:170,accessorFn:(q)=>status(q.status),cell:({row:{original:q}})=>{return <>
                  <span className={s.status} data-status={q.status}>
                    {status(q.status)}
                  </span>
                </>;}},
{id:"validUntil",header:t("Valid until"),size:140,accessorFn:(q)=>q.validUntil,cell:({row:{original:q}})=>{return <>{q.validUntil}</>;}},
{id:"action",header:t("Action"),size:150,enableSorting:false,enableColumnFilter:false,cell:({row:{original:q}})=>{return <>
                  <Link
                    className={s.builderLink}
                    aria-label={t("Open quotation builder for {title}", { title: q.title })}
                    href={`${href(q.id)}${href(q.id).includes("?") ? "&" : "?"}builder=blank`}
                  >
                    {t(["draft", "internal_review", "internal_approved"].includes(q.status) ? "Open quotation" : "View version")}
                  </Link>
                </>;}}]}/>


    </div>
  )}</>;
}
