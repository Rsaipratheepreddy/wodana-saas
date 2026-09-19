"use client";
import { Button, DataGrid, SegmentedControl } from "@/design-system";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { CommercialState } from "@/lib/commercial/types";
import { acceptedQuoteValue, money, statusLabel } from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function QuotationList({
  state,
  busy,
  create,
  href,
  open,
}: {
  state: CommercialState;
  busy: boolean;
  create: () => void;
  href: (id: string) => string;
  open: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const quotes = state.data.quotes.slice().reverse(),
    working = quotes.find((q) =>
      ["draft", "internal_review", "internal_approved"].includes(q.status),
    );
  const visible = quotes.filter(
    (q) =>
      (filter === "all" ||
        (filter === "draft"
          ? ["draft", "internal_review", "internal_approved"].includes(q.status)
          : q.status === filter)),
  );
  return (
    <>
      <div className={s.listTop}>
        <span className={s.muted}>
          {quotes.length} quotation{quotes.length === 1 ? "" : "s"} · Open a
          quotation to edit or review its document.
        </span>
        {state.canEdit &&
          (!quotes.length ? (
            <Button variant="primary" size="compact" isDisabled={busy} onPress={create}>
              <Plus size={15} />
              Create quotation
            </Button>
          ) : working ? (
            <Link className={s.button} href={href(working.id)}>
              Continue {working.status === "draft" ? "draft" : "review"}
              <ArrowRight size={14} />
            </Link>
          ) : null)}
      </div>
      <div className={s.listTools}>
        <div className={s.filterScroller}>
          <SegmentedControl label="Filter quotations" value={filter} onChange={setFilter} options={[
            { id: "all", label: "All" },
            { id: "draft", label: "Draft & review" },
            { id: "issued", label: "Awaiting client" },
            { id: "accepted", label: "Accepted" },
          ]} />
        </div>
      </div>
      <DataGrid ariaLabel="Quotations" emptyTitle={quotes.length?"No matching quotations":"No quotations yet"} emptyDescription={quotes.length?"Try another search or status.":"Create a quotation, then add rooms, items and a payment schedule."} data={visible} getRowId={row=>row.id} searchLabel="Search quotations" exportFileName="quotations.csv" onRowAction={q=>open(q.id)} columns={[{id:"title",header:"Quotation",size:300,accessorFn:(q)=>q.title,cell:({row:{original:q}})=>{return <>
                  <Link href={href(q.id)} className={s.quoteLink}>
                    {q.title}
                  </Link>
                  <small className={s.detail}>
                    QT-{q.id.slice(0, 8).toUpperCase()}
                    {q.kind === "variation" ? " · Variation" : ""}
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
{id:"action",header:"Action",size:100,enableSorting:false,enableColumnFilter:false,cell:({row:{original:q}})=>{return <>
                  <Link
                    className={s.icon}
                    aria-label={`Open ${q.title} version ${q.number}`}
                    href={href(q.id)}
                  >
                    <ArrowRight size={16} />
                  </Link>
                </>;}}]}/>


    </>
  );
}
