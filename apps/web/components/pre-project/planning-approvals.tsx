"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Callout, DataGrid } from "@/design-system";
import type { PreProjectCase } from "@/lib/pre-project/types";
import { designStatus, type CaseContent, type CaseDesign, type DesignOptions } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { CommercialState } from "@/lib/commercial/types";
import { statusLabel } from "@/lib/commercial/client";
import { usePreProject } from "./pre-project-context";
import { DefinitionPage } from "./definition-page";
import { CommercialPage } from "../commercial/commercial-page";
import s from "./planning-approvals.module.css";
import tableStyles from "../workspace/workspace.module.css";

type Content = { data: CaseContent; designs: CaseDesign[]; designOptions?: DesignOptions } | { error: string };
export function PlanningApprovals({ record, content, definition, commercial, search, review }: {
  record: PreProjectCase; content: Content; definition: DefinitionPageData;
  commercial: CommercialState; search: string; review?: string;
}) {
  const router = useRouter();
  const { setSelected } = usePreProject();
  const [filter, setFilter] = useState("all");
  useEffect(() => { setSelected({ record, search }); }, [record, search, setSelected]);
  const root = `/workspace/pre-projects/cases/${record.id}`;
  const href = (item?: string) => {
    // Designs are reviewed and approved on the drawing, in Design.
    if (item?.startsWith("design:")) return `${root}/designs?file=${item.slice(7)}`;
    const query = new URLSearchParams(search);
    query.delete("review");
    if (item) query.set("review", item);
    return `${root}/approvals${query.size ? `?${query}` : ""}`;
  };
  const designs = "data" in content ? content.designs.filter(item => !item.archivedAt) : [];
  const quotes = commercial.data.quotes.filter(item => !["superseded", "withdrawn", "declined", "expired"].includes(item.status));
  const current = "definition" in definition ? definition.definition.current : null;
  const scopeStatus = "error" in definition ? "Unavailable" : current?.current
    ? ({ confirmed: "Client confirmed", awaiting_confirmation: "Awaiting client", changes_requested: "Changes requested", superseded: "Updated scope" })[current.status]
    : definition.definition.draft.readyToPublish ? "Ready for confirmation" : "Needs preparation";
  const rows = [
    { id: "scope", type: "Requirements", title: "Project scope", version: current ? `V${current.number}${current.current ? "" : " · updated"}` : "Working scope", status: scopeStatus, ready: "definition" in definition && definition.definition.canPublish && definition.definition.draft.readyToPublish && !current?.current, done: Boolean(current?.current && current.status === "confirmed") },
    ...designs.map(item => ({ id: `design:${item.id}`, type: "Designs", title: item.title, version: item.versions[0] ? `V${item.versions[0].number}` : "No file", status: designStatus[item.versions[0]?.status ?? "no_file"] ?? "Needs review", ready: item.versions[0]?.status === "internal_approved", done: item.versions[0]?.status === "approved" })),
    ...quotes.map(item => ({ id: `quote:${item.id}`, type: "Quotations", title: item.title || (item.kind === "quotation" ? "Project quotation" : "Change quotation"), version: `V${item.number}`, status: statusLabel[item.status] ?? item.status, ready: item.status === "internal_approved", done: item.status === "accepted" })),
  ];
  const selectedQuote = quotes.find(item => review === `quote:${item.id}`);
  const detail = review === "scope" ? <DefinitionPage initial={definition} />
    : selectedQuote ? <CommercialPage reviewOnly key={selectedQuote.id} initial={commercial} record={record} section="quotations" quotationId={selectedQuote.id} search={search} /> : null;
  return <section className={s.page}>
    <h1 className={s.visuallyHidden}>Approvals</h1>
    {review ? <>{<Link className={s.back} href={href()}>← All approvals</Link>}{detail ?? <Callout tone="warning" title="Review unavailable">This item may have been archived or replaced. Return to the queue for its current version.</Callout>}</> : <>
      {"error" in content && <Callout tone="warning" title="Designs could not be loaded">{content.error}</Callout>}
      {"error" in definition && <Callout tone="warning" title="Requirements could not be loaded">{definition.error}</Callout>}
      <div className={tableStyles.recordTablePanel}>
        <DataGrid ariaLabel="Planning approvals" appearance="flush" compactToolbar selectable={false} toolbarActions={<Link className="wd-button" data-size="compact" href={`${root}/client-portal`}>Client access</Link>}
          data={rows.filter(row => filter === "all" || row.type === filter)} getRowId={row => row.id}
          selectedView={filter} onViewChange={setFilter}
          savedViews={[{id:"all",label:"All items"}, ...["Requirements", "Designs", "Quotations"].map(type => ({id:type,label:type}))]}
          searchLabel="Search approvals" exportFileName="planning-approvals.csv"
          emptyTitle={`No ${filter === "all" ? "items" : filter.toLowerCase()} to review`}
          emptyDescription="" onRowAction={row => router.push(href(row.id))}
          columns={[
            {id:"title",header:"Item",size:300,accessorFn:row => row.title,cell:({row:{original:item}}) => <div className={s.item}><Link href={href(item.id)}>{item.title}</Link><small>{item.version}</small></div>},
            {id:"type",header:"Type",size:140,accessorFn:row => row.type,meta:{mobileHidden:true}},
            {id:"status",header:"Status",size:190,accessorFn:row => row.status,cell:({row:{original:item}}) => <span className={s.status} data-complete={item.done} data-ready={item.ready}>{item.status}</span>},
            {id:"action",header:"Action",size:150,enableSorting:false,enableColumnFilter:false,cell:({row:{original:item}}) => <Link aria-label={`Review ${item.title} ${item.version}`} href={href(item.id)}>{item.ready ? "Review & send" : "Review"}</Link>},
          ]}
          footerActions={<Link href={`${root}/execution-release`}>Release readiness →</Link>}
        />
      </div>
    </>}
  </section>;
}
