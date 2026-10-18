"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, ButtonGroup, EmptyState, ErrorState, GroupedTable, ListTabs, NoAccessState, NoResultsState, SearchInput, Skeleton, type GroupedTableColumn, type GroupedTableSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import { restockQuantity } from "@/lib/inventory/levels";
import { readableCode } from "@/lib/workspace/catalog-v2";
import type { ReorderPoint } from "@/lib/inventory/types";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { Need, NeedsState } from "@/lib/purchasing/types";
import { Cell, DueText, ProjectFilterChip, operationsStyles as ops, projectHref } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { AskPricesDialog } from "./ask-prices-dialog";
import { BulkOrderDialog } from "./bulk-order-dialog";
import { CreateOrderDialog } from "./create-order-dialog";
import { LineStatusLabel, quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

export type ToOrderView = "order" | "late" | "signoff" | "boq" | "payment" | "hold" | "over" | "restock" | "all";

const running = (need: Need) => (need.projectStatus ?? "active") === "active";
/** What the buyer can order now: signed off (or no client choice), its project running, and something still open. */
export const orderable = (need: Need) => !need.blocked && running(need) && (need.remaining === null || Number(need.remaining) > 0);
const onHold = (need: Need) => need.projectStatus === "on_hold" && (need.remaining === null || Number(need.remaining) > 0);
const over = (need: Need) => need.remaining !== null && Number(need.remaining) < 0;
const unit = (value: string, of: string) => `${quantityText(value)} ${of}`.trim();
/** The project a list is narrowed to, named from what the list has. */
const projectRef = (needs: Need[], id: string, fallback: string) => {
  const need = needs.find((item) => item.projectId === id);
  return need ? { id, reference: need.projectReference, name: need.projectName } : { id, reference: fallback };
};

/**
 * What running projects still need to order, by project: materials from signed-off material lists and bought
 * or subcontracted scope lines, and stock that ran low. Queues say what needs the buyer (late to order, waiting
 * for the client's sign-off or payment, on hold, ordered past the need); each line has its one next step. Lines from
 * several projects can go on one order to one supplier, or on one order per supplier at once (PLM-071).
 */
export function ToOrder({ api, workspaceId, projectId = null, onProject = () => undefined, onCreated, onAsked, onOrders = () => undefined, initialView = "order", refreshKey = 0 }: {
  api: PurchasingApi; workspaceId: string; projectId?: string | null; onProject?: (projectId: string | null) => void; onCreated: (orderId: string) => void;
  onAsked: (requestId: string) => void; onOrders?: () => void; initialView?: ToOrderView; refreshKey?: number;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<NeedsState | null>(null);
  const [restock, setRestock] = useState<ReorderPoint[]>([]);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<ToOrderView>(initialView);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ordering, setOrdering] = useState<{ needs: Need[]; restock: ReorderPoint[] } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [asking, setAsking] = useState(false);
  const stock = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const load = useCallback(async () => {
    try { setState(await api.needs()); setError(""); } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("What to order didn't load.")); }
    // Stock that ran low is ordered here too; someone who can't see stock simply doesn't get that queue.
    try { setRestock(((await stock.stock()).reorderPoints ?? []).filter((point) => point.short)); } catch { setRestock([]); }
  }, [api, stock, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const today = format.today();
  const needle = search.trim().toLocaleLowerCase();
  const scoped = useMemo(() => (state?.needs ?? []).filter((need) => (!projectId || need.projectId === projectId)
    && (!needle || `${need.title} ${need.detail} ${need.projectReference} ${need.projectName} ${need.packageName ?? ""}`.toLocaleLowerCase().includes(needle))), [state, projectId, needle]);
  const queues: Record<Exclude<ToOrderView, "restock">, (need: Need) => boolean> = {
    order: orderable, late: (need) => orderable(need) && Boolean(need.orderBy && need.orderBy < today), signoff: (need) => (need.blocked === "material_signoff" || need.blocked === "client_signature") && running(need),
    // PLM-163: lines of a project whose BOQ the QS hasn't approved yet.
    boq: (need) => need.blocked === "boq_approval" && running(need),
    payment: (need) => need.blocked === "client_payment" && running(need), hold: onHold, over,
    all: () => true,
  };
  const count = (key: Exclude<ToOrderView, "restock">) => scoped.filter(queues[key]).length;
  const shown = view === "restock" ? [] : scoped.filter(queues[view]);
  const restockShown = restock.filter((point) => !needle || `${point.itemName} ${point.itemCode} ${point.locationName ?? ""}`.toLocaleLowerCase().includes(needle));
  const canBuy = Boolean(state?.canBuy);
  const showStatus = view === "all";

  const openOrder = (needs: Need[]) => setOrdering({ needs, restock: [] });
  const next = (need: Need) => {
    if (!canBuy) return null;
    if (need.blocked === "client_payment") return <Link className={ops.projectLink} href={projectHref(need.projectId, "money")}>{t("Open payments")}</Link>;
    // PLM-148: the client signs the samples and data sheets on the job's finishes.
    if (need.blocked === "client_signature") return <Link className={ops.projectLink} href={`${projectHref(need.projectId, "scope")}?view=finishes`}>{t("Get the signatures")}</Link>;
    // PLM-163: the BOQ is approved on the project's Scope tab.
    if (need.blocked === "boq_approval") return <Link className={ops.projectLink} href={projectHref(need.projectId, "scope")}>{t("Get the BOQ approved")}</Link>;
    if (need.blocked) return <Link className={ops.projectLink} href={projectHref(need.projectId, "scope")}>{t("Get sign-off")}</Link>;
    if (over(need)) return <Button size="compact" variant="quiet" onPress={onOrders}>{t("Open orders")}</Button>;
    if (onHold(need)) return <Button size="compact" aria-label={t("Order {name} anyway", { name: need.title })} onPress={() => openOrder([need])}>{t("Order anyway")}</Button>;
    if (orderable(need)) return <Button size="compact" aria-label={t("Order {name}", { name: need.title })} onPress={() => openOrder([need])}>{t("Order")}</Button>;
    return null;
  };
  const columns: GroupedTableColumn<Need>[] = [
    { id: "item", label: t("Material"), render: (need) => <Cell title={need.title}
      meta={[need.detail, need.packageName, need.scopeLines?.length ? t("For {line}", { line: need.scopeLines.join(", ") }) : "", need.changedBy ? t("Changed by {variation}", { variation: need.changedBy }) : ""]
        .filter(Boolean).join(" · ") || null} /> },
    // "Needed by" shows only when a line has a date: a column of dashes says nothing (UX-052).
    ...(shown.some((need) => need.neededBy) ? [{ id: "needed", label: t("Needed by"), width: "9.5rem", mobileHidden: true, render: (need: Need) => need.neededBy ? <span className={styles.nameCell}>
      <DueText date={need.neededBy} done={!orderable(need)} />
      {need.orderBy && orderable(need) ? <small className={need.orderBy < today ? styles.lateText : undefined}>{t("Order by {date}", { date: format.short(need.orderBy) })}</small> : null}</span> : "—" }] : []),
    { id: "left", label: t("Left"), width: "12rem", align: "end", render: (need) => {
      const parts = [Number(need.placed) ? t("{quantity} ordered", { quantity: unit(need.placed, need.unit) }) : "", Number(need.drafted) ? t("{quantity} in draft", { quantity: unit(need.drafted, need.unit) }) : "",
        Number(need.fromStock) ? t("{quantity} from stock", { quantity: unit(need.fromStock, need.unit) }) : ""].filter(Boolean).join(" · ");
      const main = need.blocked === "client_payment" ? <span className={styles.muted}>{t("Waiting for the client's payment")}</span>
        : need.blocked === "client_signature" ? <span className={styles.muted}>{t("Waiting for the client's signed samples")}</span>
        : need.blocked === "boq_approval" ? <span className={styles.muted}>{t("Waiting for the QS to approve the BOQ")}</span>
        : need.blocked ? <span className={styles.muted}>{t("Waiting for the client's sign-off")}</span>
        : need.remaining === null ? <span className={styles.muted}>{t("Quantity to confirm")}</span>
        : Number(need.remaining) > 0 ? <strong className={styles.money}>{unit(need.remaining, need.unit)}</strong>
        : Number(need.remaining) < 0 ? <span className={styles.lateText}>{t("Ordered {quantity} more than needed", { quantity: unit(need.remaining.replace("-", ""), need.unit) })}</span>
        : showStatus ? <span className={styles.muted}>—</span> : <span className={styles.done}>{t("Ordered")}</span>;
      return <span className={styles.nameCell}>{main}{parts ? <small>{parts}</small> : null}</span>;
    } },
    // Every line of the project with where it has got to (PLM-072): required, ordered, received or installed.
    ...(showStatus ? [{ id: "status", label: t("Status"), width: "8rem", render: (need: Need) => need.status ? <LineStatusLabel status={need.status} /> : null }] : []),
    ...(canBuy ? [{ id: "action", label: "", width: "8.5rem", align: "end" as const, render: (need: Need) => next(need) }] : []),
  ];
  const sections: GroupedTableSection<Need>[] = [...new Set(shown.map((need) => need.projectId))].map((id) => {
    const rows = shown.filter((need) => need.projectId === id);
    const held = rows[0].projectStatus === "on_hold";
    return { id, label: `${rows[0].projectReference} · ${rows[0].projectName}${held ? ` · ${t("On hold")}` : ""}`, rows, emptyMessage: "" };
  });
  const restockColumns: GroupedTableColumn<ReorderPoint>[] = [
    { id: "item", label: t("Item"), render: (point) => <Cell title={point.itemName} meta={[readableCode(point.itemCode), point.locationName ?? t("Every place")].filter(Boolean).join(" · ")} /> },
    { id: "free", label: t("Free now"), width: "9rem", align: "end", render: (point) => <span className={styles.nameCell}><span className={styles.lateText}>{unit(point.free, point.unit)}</span>
      <small>{t("Reorder at {quantity}", { quantity: unit(point.reorderAt, point.unit) })}</small></span> },
    { id: "order", label: t("To order"), width: "10rem", align: "end", render: (point) => <span className={styles.nameCell}><strong className={styles.money}>{unit(restockQuantity(point), point.unit)}</strong>
      {point.vendorName ? <small>{point.vendorName}</small> : null}</span> },
    ...(canBuy ? [{ id: "action", label: "", width: "8.5rem", align: "end" as const, render: (point: ReorderPoint) =>
      <Button size="compact" aria-label={t("Restock {name}", { name: point.itemName })} onPress={() => setOrdering({ needs: [], restock: [point] })}>{t("Order")}</Button> }] : []),
  ];

  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const chosen = state.needs.filter((need) => selected.has(need.key));
  const filtered = Boolean(needle || projectId);
  const empty = {
    order: [t("Nothing left to order"), t("Materials appear here from each project's material list, and bought items from its scope.")],
    late: [t("Nothing is late to order"), null], signoff: [t("Nothing waits for the client"), null], boq: [t("Nothing waits for the QS"), null], payment: [t("Nothing waits for a payment"), null], hold: [t("No project is on hold"), null],
    over: [t("Nothing is over-ordered"), null], restock: [t("No stock is low"), t("Set a reorder point on an item in Inventory to be told when it runs low.")], all: [t("Nothing to order yet"), null],
  }[view];
  // At most six tabs (To order, four of these, Everything): the views that hold something, most pressing first; the
  // open one always stays. Whatever doesn't fit is still under Everything.
  const optional = [
    { id: "late" as const, label: t("Late to order"), count: count("late") },
    { id: "signoff" as const, label: t("Client sign-off"), count: count("signoff") },
    { id: "boq" as const, label: t("BOQ approval"), count: count("boq") },
    { id: "payment" as const, label: t("Client payment"), count: count("payment") },
    { id: "hold" as const, label: t("On hold"), count: count("hold") },
    { id: "over" as const, label: t("Over-ordered"), count: count("over") },
    { id: "restock" as const, label: t("Low stock"), count: restock.length },
  ].filter((item) => item.count || item.id === view);
  const extraTabs = optional.slice(0, 4);
  const open = optional.find((item) => item.id === view);
  if (open && !extraTabs.includes(open)) extraTabs[3] = open;

  return <div className={styles.stack} data-tour="purchasing-to-order">
    <div className={styles.toolbar}>
      <ListTabs label={t("What to order")} value={view} onChange={(next) => { setView(next); setSelected(new Set()); }} items={[
        // The module tab is "To order" already: this list is the items ready to order now.
        { id: "order", label: t("Ready"), count: count("order") },
        ...extraTabs,
        { id: "all", label: t("Everything") },
      ]} />
      <div className={styles.filters}>
        <ProjectFilterChip project={projectId ? projectRef(state.needs, projectId, t("This project")) : null} onClear={() => onProject(null)} />
        <SearchInput label={t("Search what to order")} placeholder={t("Search")} value={search} onChange={setSearch} />
      </div>
    </div>
    {view === "restock" ? (restockShown.length
      ? <GroupedTable<ReorderPoint> ariaLabel={t("Low stock")} columns={restockColumns} sections={[{ id: "stock", label: t("Stock"), rows: restockShown, emptyMessage: "" }]} getRowId={(point) => point.id}
        selectable={false} groupRows={false} />
      : filtered ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState illustration={null} title={empty[0]!} description={empty[1]} />)
      : !sections.length ? (filtered && count("all") === 0 && Boolean(needle) ? <NoResultsState onClear={() => setSearch("")} />
        : <EmptyState illustration={null} title={empty[0]!} description={empty[1]} />)
      : <GroupedTable<Need> ariaLabel={t("To order")} columns={columns} sections={sections} getRowId={(need) => need.key} getRowLabel={(need) => `${need.projectReference} ${need.title}`}
        selectable={canBuy && ["order", "late", "all"].includes(view)} selectedIds={selected}
        onSelectionChange={(ids) => setSelected(new Set([...ids].filter((id) => state.needs.some((need) => need.key === id && orderable(need)))))} />}
    {selected.size ? <div className={styles.selectionBar} role="region" aria-label={t("Selected lines")}>
      <span className={styles.muted}>{t("{count} selected", { count: selected.size })}</span>
      <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
      <span className={styles.spacer} />
      <ButtonGroup>
        <Button size="compact" onPress={() => setAsking(true)}>{t("Ask for prices")}</Button>
        <Button size="compact" onPress={() => setBulk(true)}>{t("Orders by supplier")}</Button>
        <Button size="compact" variant="primary" onPress={() => openOrder(chosen)}>{t("Create order")}</Button>
      </ButtonGroup>
    </div> : null}
    {asking ? <AskPricesDialog api={api} needs={chosen} onClose={() => setAsking(false)} onCreated={(requestId) => { setAsking(false); setSelected(new Set()); onAsked(requestId); }} /> : null}
    {bulk ? <BulkOrderDialog api={api} needs={chosen} onClose={() => setBulk(false)} onCreated={() => { setBulk(false); setSelected(new Set()); onOrders(); }} /> : null}
    {ordering ? <CreateOrderDialog api={api} needs={ordering.needs} restock={ordering.restock} onClose={() => setOrdering(null)}
      onCreated={(orderId) => { setOrdering(null); setSelected(new Set()); onCreated(orderId); }} /> : null}
  </div>;
}
