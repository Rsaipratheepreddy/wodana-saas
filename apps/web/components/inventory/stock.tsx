"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, DataGrid, EmptyState, ErrorState, InlineNotice, ListTabs, MenuButton, NoResultsState, TextAreaField, type DataGridColumn, type ToolbarFilter, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import { restockQuantity } from "@/lib/inventory/levels";
import { readableCode } from "@/lib/workspace/catalog-v2";

/** A money amount that says something: set and not zero (a cost nobody entered is stored as zero). */
const known = (value: string | null | undefined) => Boolean(value) && !/^-?0*(\.0+)?$/.test(String(value));
import type { PendingAdjustment, ReorderPoint, StockRow, StockState, TransferState } from "@/lib/inventory/types";
import { Cell, ProjectFilterChip, ProjectLinks } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { LinkedImportDialog } from "../linked-imports/linked-import-dialog";
import { MoveDialog } from "./move-dialog";
import { ReorderPointDialog } from "./reorder-point-dialog";
import { StockChangeDialog, type ChangeMode } from "./stock-change-dialog";
import styles from "./inventory.module.css";

export type StockView = "all" | "low" | "free" | "projects";
/** A row of the list: stock at a place, or (All) an item kept with nothing on hand anywhere. */
type ListRow = StockRow & { empty?: boolean };
const unit = (value: string, of: string) => `${quantityText(value)} ${of}`.trim();

/**
 * Stock: each item at each place, for a project (reserved or issued to it) or free, with what's on hand.
 * Queues show what runs low against its reorder point, free stock and what's held for projects. A row's
 * actions issue it, reserve or release it, move it, count it or set its reorder point; stock that isn't
 * in the system yet is added with its origin.
 */
export function Stock({ api, workspaceId, state, error, onReload, onChanged, onMoved, onHistory, projectId = null, onProject = () => undefined, initialView = "all", importLinkId = null }: {
  api: InventoryApi; workspaceId: string; state: StockState | null; error: string; onReload: () => void; onChanged: (next: StockState) => void; onMoved: (next: TransferState) => void;
  onHistory: (itemId: string) => void; projectId?: string | null; onProject?: (projectId: string | null) => void; initialView?: StockView;
  /** A linked stock sheet to open (a notice about its refresh links here). */
  importLinkId?: string | null;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<StockView>(initialView);
  const [refusing, setRefusing] = useState<PendingAdjustment | null>(null);
  const [notice, setNotice] = useState("");
  const [place, setPlace] = useState<string | null>(null);
  const [change, setChange] = useState<{ mode: ChangeMode; row: StockRow | null; itemId?: string } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ row: StockRow | null } | null>(null);
  const [reorder, setReorder] = useState<{ item: { itemId: string; itemName: string; unit: string; locationId: string | null }; point: ReorderPoint | null } | null>(null);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }> | null>(null);
  // The stock list kept in a spreadsheet: imported, or linked and refreshed (PLM-073).
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (importLinkId) queueMicrotask(() => setImporting(true)); }, [importLinkId]);
  // The suppliers a reorder point can name (only for someone who can see them).
  useEffect(() => {
    if (!reorder || suppliers) return;
    fetch(`/api/purchasing/suppliers?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }).then((response) => (response.ok ? response.json() : null))
      .then((data: { suppliers?: Array<{ id: string; name: string; status: string }> } | null) => setSuppliers((data?.suppliers ?? []).filter((item) => item.status !== "archived")))
      .catch(() => setSuppliers([]));
  }, [reorder, suppliers, workspaceId]);
  const decide = async (request: PendingAdjustment, action: "approve" | "reject", note = "") => {
    setNotice("");
    try { onChanged(await api.decideAdjustment(request.id, action, note)); return true; } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  const points = useMemo(() => state?.reorderPoints ?? [], [state]);
  const low = points.filter((point) => point.low);
  const pointFor = (row: StockRow) => points.find((point) => point.itemId === row.itemId && (point.locationId === row.locationId || point.locationId === null));
  const needle = search.trim().toLocaleLowerCase();
  // An item's category, from the item list (stock rows from an older server don't carry it).
  const categoryOf = useMemo(() => new Map((state?.items ?? []).map((item) => [item.itemId, item.category])), [state]);
  const categoryFor = (row: StockRow) => row.category || categoryOf.get(row.itemId) || "";
  const categories = useMemo(() => [...new Set([...(state?.items ?? []).map((item) => item.category), ...(state?.rows ?? []).map((row) => row.category ?? "")].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)), [state]);
  const matches = (row: StockRow) => (!category || categoryFor(row) === category)
    && (!needle || `${row.itemName} ${row.itemCode} ${categoryFor(row)} ${row.projectReference ?? ""} ${row.projectName ?? ""}`.toLocaleLowerCase().includes(needle));
  const held = useMemo(() => (state?.rows ?? []).filter((row) => Number(row.onHand) !== 0), [state]);
  const scoped = held.filter((row) => (!place || row.locationId === place) && (!projectId || row.projectId === projectId) && matches(row));
  // All lists every item kept: one with nothing on hand anywhere shows at 0 (a materials list imported without quantities).
  const unheld: ListRow[] = view === "all" && !place && !projectId ? (state?.items ?? []).filter((item) => !held.some((row) => row.itemId === item.itemId))
    .map((item) => ({ ...item, locationId: "", locationName: "", locationKind: "warehouse", projectId: null, projectReference: null, projectName: null, onHand: "0", updatedAt: "",
      value: "0", averageCost: null, currency: state?.currency ?? "", empty: true } satisfies ListRow)).filter(matches) : [];
  const rows: ListRow[] = [...scoped.filter((row) => view === "free" ? !row.projectId : view === "projects" ? Boolean(row.projectId) : true), ...unheld]
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
  const noQuantities = Boolean(state?.items?.length) && !held.length;
  const columns = useMemo<DataGridColumn<ListRow>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (row) => row.itemName, size: 260, meta: { primary: true, renderCell: (row) => {
      const point = !row.projectId && !row.empty ? pointFor(row) : undefined;
      return <span className={styles.nameCell}><span>{row.itemName}</span>
        {readableCode(row.itemCode) || point ? <small>{[readableCode(row.itemCode), point ? t("Low at {quantity}", { quantity: unit(point.reorderAt, row.unit) }) : ""].filter(Boolean).join(" · ")}</small> : null}
        {point?.low ? <span><Badge tone="warning">{t("Low")}</Badge></span> : null}</span>;
    } } },
    ...(categories.length ? [{ id: "category", header: t("Category"), accessorFn: (row: ListRow) => categoryFor(row), size: 160, enableColumnFilter: false,
      meta: { mobileHidden: true } } satisfies DataGridColumn<ListRow>] : []),
    { id: "place", header: t("Place"), accessorFn: (row) => row.locationName, size: 180, enableColumnFilter: false, meta: { renderCell: (row) => row.empty
      ? <span className={styles.muted}>—</span> : row.locationName } },
    { id: "for", header: t("For"), accessorFn: (row) => row.projectReference ?? "", size: 170, meta: { renderCell: (row) => row.empty ? <span className={styles.muted}>—</span>
      : row.projectId && row.projectReference ? <ProjectLinks projects={[{ id: row.projectId, reference: row.projectReference, name: row.projectName }]} />
      : <span className={styles.muted}>{t("Free stock")}</span> } },
    { id: "onHand", header: t("On hand"), accessorFn: (row) => Number(row.onHand), size: 130, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{unit(row.onHand, row.unit)}</span> } },
    // An unknown cost is "—", never "AED 0.00" (UX-006).
    { id: "value", header: t("Value"), accessorFn: (row) => Number(row.value), size: 150, meta: { align: "end", mobileHidden: true, renderCell: (row) => row.empty || (!known(row.value) && !known(row.averageCost)) ? <span className={styles.muted}>—</span> : <span className={styles.nameCell}>
      <span className={styles.number}>{format.money(row.value, row.currency)}</span>
      {known(row.averageCost) ? <small>{t("{price} each", { price: format.money(row.averageCost!, row.currency) })}</small> : null}</span> } },
    { id: "actions", header: "", accessorFn: () => "", size: 120, meta: { align: "end", renderCell: (row) => row.empty ? (state && (state.canManage || state.canAdjust) ? <MenuButton size="compact" label={t("Actions")}
      onAction={(id) => (id === "history" ? onHistory(row.itemId) : id === "reorder" ? setReorder({ item: { itemId: row.itemId, itemName: row.itemName, unit: row.unit, locationId: null }, point: pointFor(row) ?? null })
        : setChange({ mode: "add", row: null, itemId: row.itemId }))}
      items={[...(state.canAdjust ? [{ id: "add", label: t("Add stock") }] : []), { id: "reorder", label: pointFor(row) ? t("Change reorder point") : t("Set reorder point") },
        { id: "history", label: t("History") }]} /> : null)
      : state && (state.canManage || state.canAdjust) ? <MenuButton size="compact" label={t("Actions")}
      onAction={(id) => (id === "history" ? onHistory(row.itemId) : id === "move" ? setMoving({ row }) : id === "reorder"
        ? setReorder({ item: { itemId: row.itemId, itemName: row.itemName, unit: row.unit, locationId: row.locationId }, point: pointFor(row) ?? null }) : setChange({ mode: id as ChangeMode, row }))}
      items={[
        ...(state.canManage ? [{ id: "issue", label: t("Issue to a project") }, row.projectId ? { id: "release", label: t("Release to free stock") } : { id: "allocate", label: t("Reserve for a project") },
          { id: "move", label: t("Move") }, { id: "return", label: t("Take back from a project") }] : []),
        ...(state.canAdjust ? [{ id: "count", label: t("Count") }] : []),
        ...(!row.projectId ? [{ id: "reorder", label: pointFor(row) ? t("Change reorder point") : t("Set reorder point") }] : []),
        { id: "history", label: t("History") },
      ]} /> : null } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, state, onHistory, format, points, categories, categoryOf]);
  const lowColumns = useMemo<DataGridColumn<ReorderPoint>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (point) => point.itemName, size: 240, meta: { primary: true, renderCell: (point) => <Cell title={point.itemName}
      meta={[readableCode(point.itemCode), point.locationName ?? t("Every place together")].filter(Boolean).join(" · ")} /> } },
    { id: "free", header: t("Free now"), accessorFn: (point) => Number(point.free), size: 150, meta: { align: "end", renderCell: (point) => <Cell title={<span className={styles.number}>{unit(point.free, point.unit)}</span>}
      meta={t("Low at {quantity}", { quantity: unit(point.reorderAt, point.unit) })} tone={point.low ? "danger" : undefined} /> } },
    { id: "coming", header: t("On order"), accessorFn: (point) => Number(point.onOrder), size: 130, meta: { align: "end", renderCell: (point) => Number(point.onOrder)
      ? <span className={styles.number}>{unit(point.onOrder, point.unit)}</span> : <span className={styles.muted}>—</span> } },
    { id: "state", header: t("Status"), accessorFn: (point) => (point.short ? 2 : point.low ? 1 : 0), size: 150, meta: { renderCell: (point) => point.short ? <Badge tone="danger">{t("Order now")}</Badge>
      : point.low ? <Badge tone="warning">{t("Coming")}</Badge> : <Badge tone="success">{t("Enough")}</Badge> } },
    { id: "next", header: t("Next"), accessorFn: () => "", size: 170, meta: { align: "end", renderCell: (point) => point.short
      ? <Link className={styles.rowLink} href="/workspace/purchasing?view=restock">{t("Order {quantity}", { quantity: unit(restockQuantity(point), point.unit) })}</Link>
      : state?.canManage || state?.canAdjust ? <Button size="compact" variant="quiet" onPress={() => setReorder({ item: { itemId: point.itemId, itemName: point.itemName, unit: point.unit, locationId: point.locationId }, point })}>
        {t("Change")}</Button> : null } },
  ], [t, state]);

  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const placeFilter: ToolbarFilter[] = view !== "low" && state?.locations.length ? [{ id: "place", label: t("Place"), value: place ?? undefined, onChange: (value) => setPlace(value ?? null),
    options: state.locations.map((location) => ({ id: location.id, label: location.name })) }] : [];
  const stockFilters: ToolbarFilter[] = [...placeFilter, ...(view !== "low" && categories.length ? [{ id: "category", label: t("Category"), value: category ?? undefined,
    onChange: (value: string | undefined) => setCategory(value ?? null), options: categories.map((name) => ({ id: name, label: name })) } satisfies ToolbarFilter] : [])];
  const project = projectId ? state?.rows.find((row) => row.projectId === projectId) : undefined;
  const toolbar = <div className={styles.filters}>
    <ListTabs label={t("Stock")} value={view} onChange={setView} items={[
      { id: "all", label: t("All") },
      { id: "low", label: t("Low stock"), count: low.length },
      { id: "free", label: t("Free stock") },
      { id: "projects", label: t("For projects") },
    ]} />
    <ProjectFilterChip project={projectId ? { id: projectId, reference: project?.projectReference ?? t("This project"), name: project?.projectName } : null} onClear={() => onProject(null)} />
  </div>;
  return <>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {state?.pendingAdjustments.length ? <section className={styles.pending} aria-label={t("Corrections waiting for approval")}>
      <h3 className={styles.subhead}>{t("Corrections waiting for approval")}</h3>
      <ul className={styles.places}>{state.pendingAdjustments.map((request) => <li key={request.id}>
        <span className={styles.nameCell}><span>{`${request.itemName} · ${request.locationName}${request.projectReference ? ` · ${request.projectReference}` : ""}`}</span>
          <small>{t("Counted {counted} ({difference}), worth {value}: {reason} ({name})", { counted: `${quantityText(request.counted)} ${request.unit}`.trim(),
            difference: `${Number(request.difference) > 0 ? "+" : ""}${quantityText(request.difference)}`, value: format.money(request.value, state.currency),
            reason: request.reason, name: request.requestedByName })}</small></span>
        {state.canAdjust && request.requestedBy !== state.me ? <span className={styles.filters}>
          <Button size="compact" variant="primary" onPress={() => void decide(request, "approve")}>{t("Approve")}</Button>
          <Button size="compact" variant="quiet" onPress={() => setRefusing(request)}>{t("Refuse")}</Button></span> : <small className={styles.muted}>{t("Someone else approves it.")}</small>}
      </li>)}</ul>
    </section> : null}
    {view === "low" ? <DataGrid<ReorderPoint> ariaLabel={t("Low stock")} columns={lowColumns} data={[...points].sort((a, b) => Number(b.short) - Number(a.short) || Number(b.low) - Number(a.low))
      .filter((point) => !needle || point.itemName.toLocaleLowerCase().includes(needle))} getRowId={(point) => point.id} isLoading={!state}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search stock")} rowNumbers={false} selectable={false} wrapText toolbarLeading={toolbar} filters={placeFilter}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No reorder points yet")}
        description={t("Set one from an item's actions to be told when free stock runs low.")} />} />
    : <>{noQuantities ? <InlineNotice message={t("No quantities recorded yet. Count stock or import quantities.")} /> : null}
    <DataGrid<ListRow> gridKey="inventory.stock" ariaLabel={t("Stock")} columns={columns} data={rows} getRowId={(row) => `${row.itemId}:${row.locationId}:${row.projectId ?? ""}`} isLoading={!state}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search stock")} rowNumbers={false} selectable={false} wrapText toolbarLeading={toolbar} filters={stockFilters}
      toolbarActions={state?.canAdjust ? <Button size="compact" onPress={() => setChange({ mode: "add", row: null })}>{t("Add stock")}</Button> : null}
      menuActions={state?.canAdjust ? [{ id: "import", label: t("Import") }] : undefined} onMenuAction={(id) => { if (id === "import") setImporting(true); }}
      emptyContent={needle || place || category || view !== "all" || projectId ? <NoResultsState onClear={() => { setSearch(""); setPlace(null); setCategory(null); setView("all"); onProject(null); }} />
        : <EmptyState title={t("Nothing in stock")} description={t("Deliveries add stock where they arrive.")} />} /></>}
    {change && state ? <StockChangeDialog api={api} state={state} mode={change.mode} row={change.row} itemId={change.itemId} onClose={() => setChange(null)} onDone={(next) => { setChange(null); onChanged(next); }} /> : null}
    <LinkedImportDialog isOpen={importing} onClose={() => setImporting(false)} onImported={onReload} openLinkId={importLinkId} target="stock" workspaceId={workspaceId} />
    {refusing ? <RefuseDialog onClose={() => setRefusing(null)} onSave={async (note) => { if (await decide(refusing, "reject", note)) setRefusing(null); }} /> : null}
    {moving && state ? <MoveDialog api={api} state={state} row={moving.row} onClose={() => setMoving(null)} onSent={(next) => { setMoving(null); onMoved(next); }} /> : null}
    {reorder && state ? <ReorderPointDialog api={api} state={state} item={reorder.item} point={reorder.point} suppliers={suppliers} onClose={() => setReorder(null)}
      onDone={(next) => { setReorder(null); onChanged(next); }} /> : null}
  </>;
}

function RefuseDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Refuse the correction")} onClose={onClose} cancelLabel={t("Back")} isSubmitDisabled={!note.trim()} submitLabel={t("Refuse")} onSubmit={async () => { await onSave(note.trim()); }}>
    <TextAreaField label={t("Why it's refused")} isRequired value={note} onChange={setNote} />
  </FormDialog>;
}
