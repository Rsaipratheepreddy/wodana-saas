"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Callout, DataGrid, EmptyState, ListTabs, PageShell, RecordName } from "@/design-system";
import type { PreProjectCase } from "@/lib/pre-project/types";
import { designStatus, type CaseContent, type CaseDesign, type DesignOptions } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { CommercialState } from "@/lib/commercial/types";
import { statusLabel } from "@/lib/commercial/client";
import { usePreProject } from "./pre-project-context";
import { DefinitionPage } from "./definition-page";
import { CommercialPage } from "../commercial/commercial-page";
import s from "./planning-approvals.module.css";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";

const typeLabels: Record<string, MessageKey> = { Requirements: tKey("Requirements"), Designs: tKey("Designs"), Quotations: tKey("Quotations") };

type Content = { data: CaseContent; designs: CaseDesign[]; designOptions?: DesignOptions } | { error: string };
export function PlanningApprovals({ record, content, definition, commercial, search, review }: {
  record: PreProjectCase; content: Content; definition: DefinitionPageData;
  commercial: CommercialState; search: string; review?: string;
}) {
  const router = useRouter();
  const t = useT();
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
  const scopeStatus = "error" in definition ? t("Unavailable") : current?.current
    ? t(({ confirmed: tKey("Client confirmed"), awaiting_confirmation: tKey("Awaiting client"), changes_requested: tKey("Changes requested"), superseded: tKey("Updated scope") })[current.status])
    : t(definition.definition.draft.readyToPublish ? "Ready for confirmation" : "Needs preparation");
  const rows = [
    { id: "scope", type: "Requirements", title: t("Project scope"), version: current ? (current.current ? `V${current.number}` : t("V{number} · updated", { number: current.number })) : t("Working scope"), status: scopeStatus, ready: "definition" in definition && definition.definition.canPublish && definition.definition.draft.readyToPublish && !current?.current, done: Boolean(current?.current && current.status === "confirmed") },
    ...designs.map(item => ({ id: `design:${item.id}`, type: "Designs", title: item.title, version: item.versions[0] ? `V${item.versions[0].number}` : t("No file"), status: designStatus[item.versions[0]?.status ?? "no_file"] ? t(designStatus[item.versions[0]?.status ?? "no_file"]) : t("Needs review"), ready: item.versions[0]?.status === "internal_approved", done: item.versions[0]?.status === "approved" })),
    ...quotes.map(item => ({ id: `quote:${item.id}`, type: "Quotations", title: item.title || t(item.kind === "quotation" ? "Project quotation" : "Change quotation"), version: `V${item.number}`, status: translateKnown(t, statusLabel[item.status] ?? item.status), ready: item.status === "internal_approved", done: item.status === "accepted" })),
  ];
  const selectedQuote = quotes.find(item => review === `quote:${item.id}`);
  const detail = review === "scope" ? <DefinitionPage initial={definition} />
    : selectedQuote ? <CommercialPage reviewOnly key={selectedQuote.id} initial={commercial} record={record} section="quotations" quotationId={selectedQuote.id} search={search} /> : null;
  const tabs = [{ id: "all", label: t("All items") }, ...["Requirements", "Designs", "Quotations"].map(type => ({ id: type, label: t(typeLabels[type]) }))];
  const statusTone = (item: (typeof rows)[number]) => item.done ? "success" as const : item.ready ? "info" as const : "neutral" as const;
  return <div data-tour="case-approvals"><PageShell title={t("Approvals")}
    action={review ? undefined : <Link className="wd-button" href={`${root}/client-portal`}>{t("Client access")}</Link>}
    tabs={review ? undefined : <ListTabs label={t("Approval type")} items={tabs} value={filter} onChange={setFilter} />}>
    {review ? <>{<Link className={s.back} href={href()}>← {t("All approvals")}</Link>}{detail ?? <Callout tone="warning" title={t("Review unavailable")}>{t("This item may have been archived or replaced. Return to the queue for its current version.")}</Callout>}</> : <>
      {"error" in content && <Callout tone="warning" title={t("Designs could not be loaded")}>{content.error}</Callout>}
      {"error" in definition && <Callout tone="warning" title={t("Requirements could not be loaded")}>{definition.error}</Callout>}
      <DataGrid ariaLabel={t("Planning approvals")} selectable={false} rowNumbers={false}
        data={rows.filter(row => filter === "all" || row.type === filter)} getRowId={row => row.id}
        searchLabel={t("Search approvals")} exportFileName="planning-approvals.csv"
        emptyContent={<EmptyState illustration={null} title={t(filter === "all" ? "No items to review" : filter === "Requirements" ? "No requirements to review" : filter === "Designs" ? "No designs to review" : "No quotations to review")} />}
        onRowAction={row => router.push(href(row.id))}
        columns={[
          {id:"title",header:t("Item"),size:300,accessorFn:row => row.title,meta:{primary:true,interactive:true,renderCell:item => <span data-tour={item.type === "Quotations" ? "approval-quote" : undefined}>
            <RecordName title={<Link className={s.open} href={href(item.id)}>{item.title}</Link>} detail={item.version} /></span>}},
          {id:"type",header:t("Type"),size:140,accessorFn:row => typeLabels[row.type] ? t(typeLabels[row.type]) : row.type,meta:{priority:"low"}},
          {id:"status",header:t("Status"),size:190,accessorFn:row => row.status,meta:{renderCell:item => <Badge tone={statusTone(item)} data-tour={item.type === "Quotations" ? "approval-quote-status" : undefined}>{item.status}</Badge>}},
          {id:"action",header:t("Action"),size:150,enableSorting:false,enableColumnFilter:false,meta:{interactive:true,renderCell:item => <Link className={s.open} aria-label={t("Review {title} {version}", { title: item.title, version: item.version })} href={href(item.id)}>{t(item.ready ? "Review & send" : "Review")}</Link>}},
        ]}
        footerActions={<Link className={s.open} href={`${root}/execution-release`}>{t("Release readiness")} →</Link>}
      />
    </>}
  </PageShell></div>;
}
