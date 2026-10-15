"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { RecordLinks } from "@/lib/project-core/types";
import { orderNumber } from "../factory/factory-labels";
import styles from "./linked-records.module.css";

/** Which record the block sits on: that one is named, not linked. */
export type LinkedRecordKind = "quote" | "deal_file" | "project" | "purchase_order" | "work_order";

/** PLM-164: where each record of a job opens, from any other record of it. */
export function recordHrefs(links: Pick<RecordLinks, "caseId"> & { project: { id: string } }) {
  const projectId = links.project.id;
  return {
    quote: `/workspace/pre-projects/cases/${links.caseId}/quotations`,
    dealFile: `/workspace/pre-projects/cases/${links.caseId}/execution-release`,
    project: `/workspace/projects/${projectId}`,
    purchaseOrders: `/workspace/purchasing/orders?project=${projectId}`,
    purchaseOrder: (id: string) => `/workspace/purchasing/orders?order=${id}&project=${projectId}`,
    workOrders: `/workspace/factory/orders?project=${projectId}`,
    workOrder: (id: string) => `/workspace/factory/orders?order=${id}&project=${projectId}`,
  };
}

/** A links response as the API shapes it; anything else (an error page, another record) shows nothing rather than a broken block. */
function isLinks(value: unknown): value is RecordLinks {
  const record = value as Partial<RecordLinks> | null;
  return Boolean(record && typeof record === "object" && typeof record.caseId === "string" && record.project && typeof record.project.id === "string"
    && Array.isArray(record.purchaseOrders) && Array.isArray(record.workOrders));
}

/** One record as a link, or as plain text when it is the record the block is on. */
export function RecordLink({ href, current, children }: { href: string; current?: boolean; children: ReactNode }) {
  return current ? <span className={styles.current} aria-current="page">{children}</span> : <Link className={styles.link} href={href}>{children}</Link>;
}

/**
 * PLM-164: the records a job runs through, from the accepted quotation onward (quotation, Deal File, project, purchase
 * orders and work orders), each a link to the live record; the one this block sits on is named, not linked. Self-contained:
 * give it the links, or a workspace and project to read them for.
 */
export function LinkedRecords({ workspaceId, projectId, links, current, currentId, title }: {
  workspaceId?: string; projectId?: string | null; links?: RecordLinks | null; current: LinkedRecordKind; currentId?: string;
  /** The heading over the block; none for a block whose container already names it. */
  title?: string | null;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<RecordLinks | null | undefined>(links);
  const api = useMemo(() => (workspaceId ? projectApi(workspaceId) : null), [workspaceId]);
  useEffect(() => {
    if (links !== undefined || !api || !projectId) return;
    let alive = true;
    api.links(projectId).then((next) => { if (alive) setLoaded(isLinks(next) ? next : null); }).catch(() => { if (alive) setLoaded(null); });
    return () => { alive = false; };
  }, [api, projectId, links]);
  const found = links !== undefined ? links : loaded;
  if (found === undefined) return <Skeleton lines={3} />;
  if (!found || !isLinks(found)) return null;
  const hrefs = recordHrefs(found);
  const heading = title === undefined ? t("Linked records") : title;
  const none = <span className={styles.empty}>{t("None yet")}</span>;
  return <section className={styles.block} aria-label={heading ?? t("Linked records")} data-tour="linked-records">
    {heading ? <h3 className={styles.title}>{heading}</h3> : null}
    <dl className={styles.facts}>
      <div><dt>{t("Quote")}</dt><dd>{found.quote ? <RecordLink href={hrefs.quote} current={current === "quote"}>{t("V{number} · {title}", { number: found.quote.number, title: found.quote.title })}</RecordLink> : none}</dd></div>
      <div><dt>{t("Deal File")}</dt><dd>{found.dealFile ? <RecordLink href={hrefs.dealFile} current={current === "deal_file"}>{found.dealFile.reference}</RecordLink> : none}</dd></div>
      <div><dt>{t("Project")}</dt><dd><RecordLink href={hrefs.project} current={current === "project"}>{found.project.reference}</RecordLink></dd></div>
      <div><dt>{t("Purchase orders")}</dt><dd>
        {found.purchaseOrders.length ? found.purchaseOrders.map((order) => <RecordLink key={order.id} href={hrefs.purchaseOrder(order.id)} current={current === "purchase_order" && order.id === currentId}>{order.number}</RecordLink>) : none}
        {found.purchaseOrders.length > 1 ? <Link className={styles.more} href={hrefs.purchaseOrders}>{t("All")}</Link> : null}
      </dd></div>
      <div><dt>{t("Work orders")}</dt><dd>
        {found.workOrders.length ? found.workOrders.map((order) => <RecordLink key={order.id} href={hrefs.workOrder(order.id)} current={current === "work_order" && order.id === currentId}>{orderNumber(order.number)}</RecordLink>) : none}
        {found.workOrders.length > 1 ? <Link className={styles.more} href={hrefs.workOrders}>{t("All")}</Link> : null}
      </dd></div>
    </dl>
  </section>;
}
