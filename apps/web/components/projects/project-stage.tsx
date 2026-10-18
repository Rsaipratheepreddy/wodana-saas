"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, DataGrid, IconMenuButton, type ActionItem, type DataGridColumn } from "@/design-system";
import { money } from "@/lib/commercial/client";
import { quantityToSource } from "@/lib/projects/purchasing";
import { label, taskProgress, type Handover, type Material, type Order, type ProjectState, type Snag, type Task } from "@/lib/projects/execution";
import { productionReadiness } from "./project-production";
import styles from "./project-stage.module.css";

export { StageHeader, type StageMetric } from "@/design-system";

/* ------------------------------------------------------------------ */
/* Shared cell helpers                                                 */
/* ------------------------------------------------------------------ */

function Title({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return <span className={styles.title}><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>;
}

function Qty({ value, unit, muted }: { value: number; unit?: string; muted?: boolean }) {
  return <span className={styles.qty} data-muted={muted || undefined}>{Number.isInteger(value) ? value : value.toFixed(2)}{unit ? <small> {unit}</small> : null}</span>;
}

function stateTone(state: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["completed", "approved", "accepted", "closed", "verified"].includes(state)) return "success";
  if (["blocked", "returned", "critical", "rejected", "cancelled"].includes(state)) return "danger";
  if (["major", "on_hold", "draft", "enquiry", "open"].includes(state)) return "warning";
  if (["in_progress", "submitted", "review", "ready", "acknowledged"].includes(state)) return "info";
  return "neutral";
}

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={stateTone(state)}>{label(state)}</Badge>;
}

function due(date: string, today: string, done = false) {
  if (!date) return <span className={styles.muted}>—</span>;
  const overdue = !done && date < today;
  return <span className={styles.due} data-overdue={overdue || undefined}>{date}{overdue ? <small>overdue</small> : null}</span>;
}

function Actions({ items, onAction, name }: { items: ActionItem[]; onAction: (id: string) => void; name: string }) {
  if (!items.length) return null;
  return <span data-grid-interactive><IconMenuButton ariaLabel={`Actions for ${name}`} items={items} onAction={onAction} /></span>;
}

const grid = { appearance: "flush" as const, pageSize: 50, rowNumbers: false, selectable: false, showToolbar: false };

/* ------------------------------------------------------------------ */
/* Materials                                                          */
/* ------------------------------------------------------------------ */

export type MaterialAction = "order" | "allocate" | "move" | "comments";

export function materialPosition(material: Material) {
  const received = material.movements.filter((movement) => movement.kind === "receive").reduce((n, movement) => n + movement.quantity, 0);
  const stock = material.movements.reduce((n, movement) => n + (["receive", "return"].includes(movement.kind) ? movement.quantity : -movement.quantity), 0);
  const reserved = (material.reservations ?? []).reduce((n, reservation) => n + reservation.quantity, 0);
  return { received, stock, reserved, available: stock - reserved, remaining: Math.max(0, material.required - received) };
}

export function MaterialsTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: MaterialAction, material: Material) => void }) {
  const d = state.data;
  const taskTitle = (id: string) => d.tasks.find((task) => task.id === id)?.title ?? "Unlinked";
  const rows = d.materials.filter((material) => `${material.title} ${material.specification}`.toLowerCase().includes(search.toLowerCase()));
  const columns: DataGridColumn<Material>[] = [
    { id: "material", header: "Material", size: 260, accessorFn: (m) => m.title, meta: { primary: true, renderCell: (m) => <Title title={m.title} detail={m.specification} /> } },
    { id: "task", header: "Used for", size: 180, accessorFn: (m) => taskTitle(m.taskId), meta: { renderCell: (m) => <span className={styles.wrap}>{taskTitle(m.taskId)}</span> } },
    { id: "supply", header: "Supplied by", size: 120, accessorFn: (m) => m.supply, meta: { renderCell: (m) => <Badge tone={m.supply === "company" ? "info" : "neutral"}>{label(m.supply)}</Badge> } },
    { id: "required", header: "Required", size: 110, accessorFn: (m) => m.required, meta: { align: "end", renderCell: (m) => <Qty value={m.required} unit={m.unit} /> } },
    { id: "received", header: "Received", size: 110, accessorFn: (m) => materialPosition(m).received, meta: { align: "end", renderCell: (m) => <Qty value={materialPosition(m).received} unit={m.unit} /> } },
    { id: "stock", header: "In stock", size: 100, accessorFn: (m) => materialPosition(m).stock, meta: { align: "end", renderCell: (m) => <Qty value={materialPosition(m).stock} /> } },
    { id: "reserved", header: "Allocated", size: 100, accessorFn: (m) => materialPosition(m).reserved, meta: { align: "end", renderCell: (m) => <Qty value={materialPosition(m).reserved} muted={!materialPosition(m).reserved} /> } },
    { id: "toOrder", header: "To order", size: 110, accessorFn: (m) => quantityToSource(m, d.orders), meta: { align: "end", renderCell: (m) => { const q = m.supply === "company" ? quantityToSource(m, d.orders) : 0; return q > 0 ? <span className={styles.shortfall}><Qty value={q} unit={m.unit} /></span> : <span className={styles.muted}>Covered</span>; } } },
    { id: "needBy", header: "Needed by", size: 120, accessorFn: (m) => m.needBy, meta: { renderCell: (m) => due(m.needBy, state.today ?? "", materialPosition(m).remaining === 0) } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (m) => {
      const items: ActionItem[] = [];
      if (state.canBuy && m.supply === "company" && quantityToSource(m, d.orders) > 0) items.push({ id: "order", label: `Order ${quantityToSource(m, d.orders)} ${m.unit}` });
      if (state.canManage) items.push({ id: "allocate", label: "Allocate stock to work" }, { id: "move", label: "Record receipt, issue or waste" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={m.title} onAction={(id) => onAction(id as MaterialAction, m)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Material requirements" columns={columns} data={rows} getRowId={(m) => m.id}
    emptyTitle="Plan materials against the actual work" emptyDescription="Define each material, its specification and who supplies it. Company orders become accepted stock through verified receipts." />;
}

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

export type OrderAction = "open" | "edit" | "step" | "vendor" | "comments";

export function OrdersTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: OrderAction, order: Order) => void }) {
  const d = state.data;
  const rows = d.orders.filter((order) => order.status !== "enquiry" && `${order.title} ${order.vendor} ${order.number}`.toLowerCase().includes(search.toLowerCase()));
  const received = (order: Order) => order.receipts.reduce((n, receipt) => n + receipt.accepted, 0);
  const rejected = (order: Order) => order.receipts.reduce((n, receipt) => n + receipt.rejected, 0);
  const stepLabel = (order: Order) => order.status === "draft" ? "Submit for approval" : order.status === "submitted" ? "Approve order" : order.status === "approved" ? "Confirm vendor dates" : order.status === "acknowledged" ? (received(order) >= order.quantity ? "Close order" : "Verify receipt") : null;
  const columns: DataGridColumn<Order>[] = [
    { id: "order", header: "Order", size: 250, accessorFn: (o) => `${o.number} ${o.title}`, meta: { primary: true, renderCell: (o) => <Title title={<><span className={styles.mono}>{o.number}</span> · {o.title}</>} detail={o.acknowledgement || undefined} /> } },
    { id: "vendor", header: "Vendor", size: 180, accessorFn: (o) => o.vendor, meta: { renderCell: (o) => <Title title={o.vendor} detail={label(o.kind)} /> } },
    { id: "quantity", header: "Qty", size: 100, accessorFn: (o) => o.quantity, meta: { align: "end", renderCell: (o) => <Qty value={o.quantity} unit={o.unit} /> } },
    { id: "unitCost", header: "Unit cost", size: 120, accessorFn: (o) => o.unitCost, meta: { align: "end", renderCell: (o) => <span className={styles.money}>{money(o.unitCost, o.currency)}</span> } },
    { id: "value", header: "Value", size: 130, accessorFn: (o) => o.quantity * o.unitCost, meta: { align: "end", renderCell: (o) => <strong className={styles.money}>{money(o.quantity * o.unitCost, o.currency)}</strong> } },
    { id: "promised", header: "Promised", size: 120, accessorFn: (o) => o.promisedDate, meta: { renderCell: (o) => due(o.promisedDate, state.today ?? "", ["closed", "cancelled"].includes(o.status)) } },
    { id: "lead", header: "Lead time", size: 100, accessorFn: (o) => o.leadTimeDays ?? 0, meta: { align: "end", renderCell: (o) => o.leadTimeDays ? <Qty value={o.leadTimeDays} unit="days" /> : <span className={styles.muted}>—</span> } },
    { id: "received", header: "Received", size: 130, accessorFn: (o) => received(o), meta: { align: "end", renderCell: (o) => <span className={styles.qty}>{received(o)} / {o.quantity}{rejected(o) ? <small className={styles.rejected}> · {rejected(o)} rejected</small> : null}</span> } },
    { id: "status", header: "Status", size: 120, accessorFn: (o) => o.status, meta: { renderCell: (o) => <StateBadge state={o.status} /> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (o) => {
      const items: ActionItem[] = [{ id: "open", label: "Open order" }];
      const step = stepLabel(o);
      if (state.canBuy && step && !(o.status === "submitted" && !state.canReview)) items.push({ id: "step", label: step });
      if (state.canBuy && o.status === "draft") items.push({ id: "edit", label: "Edit draft" });
      if (state.canBuy && !["closed", "cancelled"].includes(o.status)) items.push({ id: "vendor", label: "Vendor form link" });
      items.push({ id: "comments", label: `Comments${o.vendorUpdates?.length ? ` · ${o.vendorUpdates.length} vendor updates` : ""}` });
      return <Actions items={items} name={o.number} onAction={(id) => onAction(id as OrderAction, o)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Purchase and subcontract orders" columns={columns} data={rows} getRowId={(o) => o.id} onRowAction={(o) => onAction("open", o)}
    emptyTitle="Buy against clear requirements" emptyDescription="Record the selected vendor offer, approve within budget, confirm dates and verify partial deliveries." />;
}

/* ------------------------------------------------------------------ */
/* Snags                                                              */
/* ------------------------------------------------------------------ */

export type SnagAction = "submit" | "verify" | "reopen" | "comments";

export function SnagsTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: SnagAction, snag: Snag) => void }) {
  const d = state.data;
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const rows = d.snags.filter((snag) => `${snag.title} ${snag.area}`.toLowerCase().includes(search.toLowerCase()));
  const columns: DataGridColumn<Snag>[] = [
    { id: "defect", header: "Defect", size: 280, accessorFn: (x) => x.title, meta: { primary: true, renderCell: (x) => <Title title={x.title} detail={x.resolution || x.evidence} /> } },
    { id: "area", header: "Area", size: 140, accessorFn: (x) => x.area },
    { id: "task", header: "Related work", size: 180, accessorFn: (x) => d.tasks.find((task) => task.id === x.taskId)?.title ?? "", meta: { renderCell: (x) => <span className={styles.wrap}>{d.tasks.find((task) => task.id === x.taskId)?.title ?? <span className={styles.muted}>—</span>}</span> } },
    { id: "owner", header: "Responsible", size: 150, accessorFn: (x) => person(x.ownerId) },
    { id: "severity", header: "Severity", size: 110, accessorFn: (x) => x.severity, meta: { renderCell: (x) => <StateBadge state={x.severity} /> } },
    { id: "due", header: "Fix by", size: 120, accessorFn: (x) => x.dueDate, meta: { renderCell: (x) => due(x.dueDate, state.today ?? "", x.status === "closed") } },
    { id: "status", header: "Status", size: 110, accessorFn: (x) => x.status, meta: { renderCell: (x) => <StateBadge state={x.status} /> } },
    { id: "source", header: "Reported", size: 130, accessorFn: (x) => x.reportedVia ?? "team", meta: { mobileHidden: true, renderCell: (x) => <span className={styles.muted}>{x.reportedVia === "client_portal" ? "Client portal" : "Team"}{x.handoverId ? " · warranty" : ""}</span> } },
    { id: "verified", header: "Verified by", size: 140, accessorFn: (x) => x.verifiedBy ?? "", meta: { mobileHidden: true, renderCell: (x) => x.verifiedBy ? person(x.verifiedBy) : <span className={styles.muted}>—</span> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (x) => {
      const items: ActionItem[] = [];
      if ((state.canManage || x.ownerId === state.memberId) && x.status === "open") items.push({ id: "submit", label: "Submit correction" });
      if (state.canReview && x.status === "ready") items.push({ id: "verify", label: "Verify & close" });
      if (state.canManage && x.status !== "open") items.push({ id: "reopen", label: "Reopen" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={x.title} onAction={(id) => onAction(id as SnagAction, x)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Snags" columns={columns} data={rows} getRowId={(x) => x.id} onRowAction={(x) => onAction("comments", x)}
    emptyTitle="Track every defect through verification" emptyDescription="Assign the correction and review its evidence. Major and critical defects block area handover." />;
}

/* ------------------------------------------------------------------ */
/* Handovers                                                          */
/* ------------------------------------------------------------------ */

export type HandoverAction = "prepare" | "accept" | "warranty" | "comments";

export function HandoversTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: HandoverAction, handover: Handover) => void }) {
  const d = state.data;
  const approver = (id?: string) => state.clientApprovers?.find((contact) => contact.id === id)?.name;
  const rows = d.handovers.filter((x) => `${x.title} ${x.area}`.toLowerCase().includes(search.toLowerCase()));
  const outstanding = (x: Handover) => (x.outstandingItems ?? []).filter((item) => !["closed", "warranty"].includes(item.status));
  const columns: DataGridColumn<Handover>[] = [
    { id: "handover", header: "Handover", size: 260, accessorFn: (x) => x.title, meta: { primary: true, renderCell: (x) => <Title title={x.title} detail={x.source === "work_package" ? `Package · ${x.area || "Project-wide"}` : x.area || "Whole project"} /> } },
    { id: "scope", header: "Scope pack", size: 160, accessorFn: (x) => x.taskIds.length, meta: { renderCell: (x) => <span className={styles.wrap}>{x.taskIds.length} tasks · {x.documentIds.length} documents{x.packet ? ` · v${x.packet.version}` : ""}</span> } },
    { id: "outstanding", header: "Outstanding", size: 150, accessorFn: (x) => outstanding(x).length, meta: { renderCell: (x) => { const open = outstanding(x); const blocking = open.filter((item) => item.blocking).length; return open.length ? <span className={styles.qty} data-attention={blocking > 0 || undefined}>{open.length} open{blocking ? <small> · {blocking} blocking</small> : null}</span> : <span className={styles.muted}>{x.outstanding || "None"}</span>; } } },
    { id: "approver", header: "Client approver", size: 160, accessorFn: (x) => approver(x.clientApproverId) ?? "", meta: { renderCell: (x) => approver(x.clientApproverId) ?? <span className={styles.muted}>Signed record</span> } },
    { id: "reviewDue", header: "Review due", size: 120, accessorFn: (x) => x.clientReviewDueDate ?? "", meta: { renderCell: (x) => due(x.clientReviewDueDate ?? "", state.today ?? "", x.status === "accepted") } },
    { id: "status", header: "Status", size: 110, accessorFn: (x) => x.status, meta: { renderCell: (x) => <StateBadge state={x.status} /> } },
    { id: "accepted", header: "Accepted", size: 170, accessorFn: (x) => x.acceptedAt, meta: { renderCell: (x) => x.acceptedBy ? <Title title={x.acceptedBy} detail={`${x.acceptedAt.slice(0, 10)}${x.decisionSource === "client_portal" ? " · portal" : ""}`} /> : <span className={styles.muted}>—</span> } },
    { id: "warranty", header: "Warranty until", size: 130, accessorFn: (x) => x.warrantyUntil, meta: { renderCell: (x) => x.warrantyUntil || <span className={styles.muted}>Not specified</span> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (x) => {
      const items: ActionItem[] = [];
      if (state.canReview && ["draft", "returned"].includes(x.status)) items.push({ id: "prepare", label: x.status === "returned" ? "Prepare correction" : "Prepare client review" });
      if (state.canReview && x.status === "ready") items.push({ id: "accept", label: "Record signed acceptance" });
      if (state.canReport && x.status === "accepted") items.push({ id: "warranty", label: "Record warranty defect" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={x.title} onAction={(id) => onAction(id as HandoverAction, x)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Handovers" columns={columns} data={rows} getRowId={(x) => x.id} onRowAction={(x) => onAction("comments", x)}
    emptyTitle="Hand over room by room" emptyDescription="Generate a pack from a delivery package or area. The server assembles scope, inspections, documents and open defects for the client decision." />;
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

export type ProjectDocument = ProjectState["data"]["documents"][number];
export type DocumentAction = "submit" | "approve" | "revise" | "publish" | "unpublish" | "comments";

export function documentHref(state: ProjectState, document: ProjectDocument) {
  return document.url || (document.sourceDesignAssetId ? `/api/project-files/${state.id}/${document.sourceDesignAssetId}?workspaceId=${state.workspaceId}` : "");
}

export function DocumentsTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: DocumentAction, document: ProjectDocument) => void }) {
  const d = state.data;
  const rows = d.documents.filter((document) => `${document.title} ${document.kind} ${document.revision}`.toLowerCase().includes(search.toLowerCase()));
  const columns: DataGridColumn<ProjectDocument>[] = [
    { id: "document", header: "Document", size: 300, accessorFn: (x) => x.title, meta: { primary: true, renderCell: (x) => {
      const href = documentHref(state, x);
      return <Title title={href ? <a className={styles.fileLink} href={href} rel="noreferrer" target="_blank">{x.title}</a> : x.title} detail={x.note || undefined} />;
    } } },
    { id: "kind", header: "Type", size: 130, accessorFn: (x) => x.kind, meta: { renderCell: (x) => label(x.kind) } },
    { id: "revision", header: "Revision", size: 100, accessorFn: (x) => x.revision, meta: { renderCell: (x) => <span className={styles.mono}>{x.revision}</span> } },
    { id: "linked", header: "Scope items", size: 110, accessorFn: (x) => x.scopeLineIds?.length ?? 0, meta: { align: "end", renderCell: (x) => { const n = x.scopeLineIds?.length ?? 0; return n ? <Qty value={n} /> : <span className={styles.muted}>Not linked</span>; } } },
    { id: "status", header: "Status", size: 130, accessorFn: (x) => x.status, meta: { renderCell: (x) => <StateBadge state={x.status} /> } },
    { id: "client", header: "Client", size: 110, accessorFn: (x) => (x.published ? "shared" : "internal"), meta: { renderCell: (x) => x.published ? <Badge tone="info">Shared</Badge> : <span className={styles.muted}>Internal</span> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (x) => {
      const items: ActionItem[] = [];
      if (state.canManage && x.status === "draft") items.push({ id: "submit", label: "Submit for review" });
      if (state.canReview && x.status === "review") items.push({ id: "approve", label: "Approve" });
      if (state.canManage && x.status === "approved") items.push({ id: "revise", label: "New revision" });
      if (state.canReview && x.status === "approved") items.push(x.published ? { id: "unpublish", label: "Hide from client" } : { id: "publish", label: "Share with client" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={x.title} onAction={(id) => onAction(id as DocumentAction, x)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Project documents" columns={columns} data={rows} getRowId={(x) => x.id}
    emptyTitle="No documents yet" emptyDescription="Approved drawings arrive from Pre-execution when the project is released. Add specifications, permits and closeout records here." />;
}

/* ------------------------------------------------------------------ */
/* Factory jobs                                                       */
/* ------------------------------------------------------------------ */

export type FactoryAction = "open" | "start" | "report" | "dispatch" | "order" | "comments";

export function FactoryTable({ state, tasks, busy, onAction }: { state: ProjectState; tasks: Task[]; busy: boolean; onAction: (action: FactoryAction, task: Task) => void }) {
  const d = state.data;
  const jobs = tasks.filter((task) => !d.tasks.some((child) => child.parentId === task.id && child.status !== "cancelled"));
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Owner needed";
  const dispatched = (task: Task) => (d.dispatches ?? []).filter((x) => x.taskId === task.id && ["ready", "dispatched", "received"].includes(x.status)).reduce((n, x) => n + x.quantity - x.rejected, 0);
  const columns: DataGridColumn<Task>[] = [
    { id: "job", header: "Job", size: 260, accessorFn: (t) => t.title, meta: { primary: true, renderCell: (t) => <Title title={t.title} detail={`${t.area || "General"} · ${t.quantity} ${t.unit}`} /> } },
    { id: "route", header: "Made by", size: 170, accessorFn: (t) => productionReadiness(state, t).resource?.name ?? "", meta: { renderCell: (t) => {
      const { external, resource, orders } = productionReadiness(state, t);
      return external ? <Title title={orders[0]?.vendor || resource?.name || "Outside factory"} detail={orders.length ? `${orders[0].number} · ${label(orders[0].status)}` : "Factory order needed"} />
        : resource ? <Title title={resource.name} detail="Own workshop" /> : <span className={styles.shortfall}>Assign workshop</span>;
    } } },
    { id: "owner", header: "Owner", size: 140, accessorFn: (t) => person(t.ownerId), meta: { renderCell: (t) => <span className={styles.wrap}>{person(t.ownerId)}</span> } },
    { id: "dates", header: "Start → due", size: 170, accessorFn: (t) => t.end, meta: { renderCell: (t) => <span className={styles.due} data-overdue={t.status !== "completed" && t.end < (state.today ?? "") || undefined}>{t.start} → {t.end}</span> } },
    { id: "readiness", header: "Ready to make", size: 190, accessorFn: (t) => productionReadiness(state, t).checks.filter((c) => c.ready).length, meta: { renderCell: (t) => {
      const checks = productionReadiness(state, t).checks, missing = checks.filter((c) => !c.ready);
      if (["completed", "cancelled"].includes(t.status)) return <span className={styles.muted}>—</span>;
      return missing.length
        ? <Title title={<span className={styles.shortfall}>{missing.length} of {checks.length} checks open</span>} detail={missing.slice(0, 2).map((c) => c.href ? <Link className={styles.fileLink} href={c.href} key={c.title}>{c.title}</Link> : c.title).reduce<ReactNode[]>((acc, item, index) => index ? [...acc, " · ", item] : [item], [])} />
        : <Badge tone="success">Ready</Badge>;
    } } },
    { id: "output", header: "Output approved", size: 160, accessorFn: (t) => taskProgress(d, t), meta: { align: "end", renderCell: (t) => <span className={styles.qty}>{t.approved} / {t.quantity}<small> {t.unit} · {Math.round(taskProgress(d, t))}%</small></span> } },
    { id: "dispatched", header: "Dispatched", size: 110, accessorFn: (t) => dispatched(t), meta: { align: "end", renderCell: (t) => dispatched(t) ? <Qty value={dispatched(t)} unit={t.unit} /> : <span className={styles.muted}>—</span> } },
    { id: "status", header: "Status", size: 130, accessorFn: (t) => t.status, meta: { renderCell: (t) => <StateBadge state={t.status} /> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (t) => {
      const { external, orders, checks } = productionReadiness(state, t), missing = checks.filter((c) => !c.ready);
      const items: ActionItem[] = [{ id: "open", label: t.status === "awaiting_inspection" ? "Review inspection" : "Job details" }];
      if (state.canManage && ["planned", "blocked", "on_hold"].includes(t.status)) items.push({ id: "start", label: missing.length ? `Start job · ${missing.length} checks open` : "Start job", isDisabled: busy || missing.length > 0 });
      if (state.canReport && t.status === "in_progress") items.push({ id: "report", label: "Add progress report" });
      if (state.canManage && t.status === "completed") items.push({ id: "dispatch", label: "Plan dispatch to site" });
      if (state.canBuy && external && !orders.length) items.push({ id: "order", label: "Request factory offer" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={t.title} onAction={(id) => onAction(id as FactoryAction, t)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Factory jobs" columns={columns} data={jobs} getRowId={(t) => t.id}
    emptyTitle="No manufacturing jobs in this view" emptyDescription="Add the items that need to be made, choose your workshop or an outside factory, and link the approved drawing." />;
}

/* ------------------------------------------------------------------ */
/* Shortages: what still has to be bought                              */
/* ------------------------------------------------------------------ */

export type ShortageAction = "order" | "enquiry" | "comments";

export function shortages(state: ProjectState) {
  const d = state.data;
  return d.materials.filter((material) => material.supply === "company" && quantityToSource(material, d.orders) > 0);
}

export function ShortagesTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: ShortageAction, material: Material) => void }) {
  const d = state.data;
  const taskTitle = (id: string) => d.tasks.find((task) => task.id === id)?.title ?? "Unlinked";
  const rows = shortages(state).filter((material) => `${material.title} ${material.specification}`.toLowerCase().includes(search.toLowerCase()));
  const onOrder = (m: Material) => d.orders.filter((o) => o.materialId === m.id && !["cancelled", "closed", "enquiry"].includes(o.status)).reduce((n, o) => n + o.quantity, 0);
  const columns: DataGridColumn<Material>[] = [
    { id: "material", header: "Material", size: 280, accessorFn: (m) => m.title, meta: { primary: true, renderCell: (m) => <Title title={m.title} detail={m.specification} /> } },
    { id: "task", header: "Used for", size: 200, accessorFn: (m) => taskTitle(m.taskId), meta: { renderCell: (m) => <span className={styles.wrap}>{taskTitle(m.taskId)}</span> } },
    { id: "needBy", header: "Needed by", size: 130, accessorFn: (m) => m.needBy, meta: { renderCell: (m) => due(m.needBy, state.today ?? "") } },
    { id: "required", header: "Required", size: 110, accessorFn: (m) => m.required, meta: { align: "end", renderCell: (m) => <Qty value={m.required} unit={m.unit} /> } },
    { id: "covered", header: "Received + on order", size: 160, accessorFn: (m) => materialPosition(m).received + onOrder(m), meta: { align: "end", renderCell: (m) => <Qty value={materialPosition(m).received + onOrder(m)} unit={m.unit} muted={!(materialPosition(m).received + onOrder(m))} /> } },
    { id: "toOrder", header: "To order", size: 120, accessorFn: (m) => quantityToSource(m, d.orders), meta: { align: "end", renderCell: (m) => <span className={styles.shortfall}>{quantityToSource(m, d.orders)} {m.unit}</span> } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (m) => {
      const items: ActionItem[] = [];
      if (state.canBuy) items.push({ id: "order", label: `Create order for ${quantityToSource(m, d.orders)} ${m.unit}` }, { id: "enquiry", label: "Send vendor enquiry" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={m.title} onAction={(id) => onAction(id as ShortageAction, m)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Materials to order" columns={columns} data={rows} getRowId={(m) => m.id}
    emptyTitle="Nothing left to order" emptyDescription="Every company-supplied requirement is covered by stock or an open order. New shortages appear here as Materials change." />;
}

/* ------------------------------------------------------------------ */
/* Expediting: orders that need a chase before they slip               */
/* ------------------------------------------------------------------ */

export function expediting(state: ProjectState) {
  const today = state.today ?? "";
  const soon = today ? new Date(`${today}T12:00:00Z`) : null;
  if (soon) soon.setUTCDate(soon.getUTCDate() + 7);
  const horizon = soon ? soon.toISOString().slice(0, 10) : "";
  return (state.data.orders ?? []).filter((order) => {
    if (order.status === "approved") return true;
    if (order.status !== "acknowledged") return false;
    const received = order.receipts.reduce((n, receipt) => n + receipt.accepted, 0);
    return received < order.quantity && (!horizon || order.promisedDate <= horizon);
  });
}

export function ExpeditingTable({ state, search, onAction }: { state: ProjectState; search: string; onAction: (action: OrderAction, order: Order) => void }) {
  const today = state.today ?? "";
  const rows = expediting(state).filter((order) => `${order.title} ${order.vendor} ${order.number}`.toLowerCase().includes(search.toLowerCase()));
  const received = (order: Order) => order.receipts.reduce((n, receipt) => n + receipt.accepted, 0);
  const nextStep = (order: Order) => order.status === "approved"
    ? { label: "Chase acknowledgement", tone: "warning" as const, detail: "Vendor has not confirmed the order or dates." }
    : order.promisedDate < today
      ? { label: "Delivery overdue", tone: "danger" as const, detail: `${received(order)} of ${order.quantity} ${order.unit} received.` }
      : { label: "Confirm dispatch", tone: "info" as const, detail: `Due ${order.promisedDate} · ${received(order)} of ${order.quantity} ${order.unit} received.` };
  const columns: DataGridColumn<Order>[] = [
    { id: "order", header: "Order", size: 250, accessorFn: (o) => `${o.number} ${o.title}`, meta: { primary: true, renderCell: (o) => <Title title={<><span className={styles.mono}>{o.number}</span> · {o.title}</>} detail={o.acknowledgement || undefined} /> } },
    { id: "vendor", header: "Vendor", size: 180, accessorFn: (o) => o.vendor, meta: { renderCell: (o) => <Title title={o.vendor} detail={o.vendorContact || label(o.kind)} /> } },
    { id: "status", header: "Status", size: 130, accessorFn: (o) => o.status, meta: { renderCell: (o) => <StateBadge state={o.status} /> } },
    { id: "promised", header: "Promised", size: 130, accessorFn: (o) => o.promisedDate, meta: { renderCell: (o) => due(o.promisedDate, today) } },
    { id: "received", header: "Received", size: 120, accessorFn: (o) => received(o), meta: { align: "end", renderCell: (o) => <span className={styles.qty}>{received(o)} / {o.quantity}<small> {o.unit}</small></span> } },
    { id: "next", header: "Next step", size: 240, accessorFn: (o) => nextStep(o).label, meta: { renderCell: (o) => { const step = nextStep(o); return <Title title={<Badge tone={step.tone}>{step.label}</Badge>} detail={step.detail} />; } } },
    { id: "actions", header: "", size: 56, enableSorting: false, enableHiding: false, meta: { align: "end", renderCell: (o) => {
      const items: ActionItem[] = [{ id: "open", label: "Open order" }];
      if (state.canBuy) items.push({ id: "vendor", label: "Vendor form link" });
      items.push({ id: "comments", label: "Comments" });
      return <Actions items={items} name={o.number} onAction={(id) => onAction(id as OrderAction, o)} />;
    } } },
  ];
  return <DataGrid {...grid} ariaLabel="Orders to expedite" columns={columns} data={rows} getRowId={(o) => o.id}
    emptyTitle="Nothing to chase" emptyDescription="Approved orders waiting for vendor confirmation, and confirmed orders due within a week, appear here." />;
}

/* ------------------------------------------------------------------ */
/* Room budget: contract value versus commitments per room             */
/* ------------------------------------------------------------------ */

type RoomBudgetRow = { room: string; items: number; contract: number; committed: number; received: number };

export function roomBudget(state: ProjectState): RoomBudgetRow[] {
  const d = state.data;
  const lines = [...(d.scope?.lines ?? []), ...(d.variations ?? []).flatMap((v) => v.lines)];
  const rooms = new Map<string, RoomBudgetRow>();
  const row = (room: string) => {
    const key = room || "Unassigned";
    if (!rooms.has(key)) rooms.set(key, { room: key, items: 0, contract: 0, committed: 0, received: 0 });
    return rooms.get(key)!;
  };
  for (const line of lines) {
    const r = row(line.room);
    r.items += 1;
    r.contract += (line.deductsLineId ? -1 : 1) * Math.abs(line.lineTotal ?? 0);
  }
  const roomOf = (order: Order) => {
    const material = (d.materials ?? []).find((m) => m.id === order.materialId);
    const line = material?.scopeLineId ? lines.find((l) => l.id === material.scopeLineId) : undefined;
    if (line) return line.room;
    const task = d.tasks.find((t) => t.id === order.taskId);
    const viaTask = task?.scopeIds?.map((id) => lines.find((l) => l.id === id)?.room).find(Boolean);
    return viaTask ?? task?.area ?? "";
  };
  for (const order of d.orders ?? []) {
    if (!["approved", "acknowledged", "closed"].includes(order.status)) continue;
    const r = row(roomOf(order));
    r.committed += order.quantity * order.unitCost;
    r.received += order.receipts.reduce((n, receipt) => n + receipt.accepted, 0) * order.unitCost;
  }
  return [...rooms.values()].sort((a, b) => b.contract - a.contract);
}

export function RoomBudgetTable({ state }: { state: ProjectState }) {
  const rows = roomBudget(state);
  const currency = state.data.scope?.currency;
  const columns: DataGridColumn<RoomBudgetRow>[] = [
    { id: "room", header: "Room", size: 200, accessorFn: (r) => r.room, meta: { primary: true, renderCell: (r) => <Title title={r.room} detail={`${r.items} scope item${r.items === 1 ? "" : "s"}`} /> } },
    { id: "contract", header: "Contract value", size: 150, accessorFn: (r) => r.contract, meta: { align: "end", renderCell: (r) => <span className={styles.money}>{money(r.contract, currency)}</span> } },
    { id: "committed", header: "Committed orders", size: 150, accessorFn: (r) => r.committed, meta: { align: "end", renderCell: (r) => <span className={styles.money}>{money(r.committed, currency)}</span> } },
    { id: "received", header: "Received value", size: 140, accessorFn: (r) => r.received, meta: { align: "end", renderCell: (r) => <span className={styles.money}>{money(r.received, currency)}</span> } },
    { id: "margin", header: "Contract less committed", size: 170, accessorFn: (r) => r.contract - r.committed, meta: { align: "end", renderCell: (r) => { const v = r.contract - r.committed; return <span className={v < 0 ? styles.rejected : styles.money}>{money(v, currency)}</span>; } } },
    { id: "share", header: "Committed %", size: 110, accessorFn: (r) => (r.contract ? r.committed / r.contract : 0), meta: { align: "end", renderCell: (r) => <span className={styles.qty} data-attention={r.contract > 0 && r.committed > r.contract || undefined}>{r.contract ? Math.round((r.committed / r.contract) * 100) : 0}%</span> } },
  ];
  return <DataGrid {...grid} ariaLabel="Budget by room" columns={columns} data={rows} getRowId={(r) => r.room}
    emptyTitle="No released scope" emptyDescription="Room budgets appear once the accepted quotation is released to this project." />;
}
