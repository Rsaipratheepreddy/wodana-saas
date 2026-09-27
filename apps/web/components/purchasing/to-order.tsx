"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, NoAccessState, GroupedTable, SearchInput, SegmentedControl, Skeleton, type GroupedTableColumn, type GroupedTableSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { Need, NeedsState } from "@/lib/purchasing/types";
import { AskPricesDialog } from "./ask-prices-dialog";
import { CreateOrderDialog } from "./create-order-dialog";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

type Show = "left" | "all";
/** Still to order, or ordered past what's needed now (a change after ordering): both need the buyer. */
const left = (need: Need) => need.remaining === null || Number(need.remaining) !== 0;

/**
 * What running projects still need to order, one project at a time: materials from signed-off material
 * lists and bought or subcontracted scope lines, with what's already ordered and what's left. Select
 * lines (from any projects) to order them from one supplier.
 */
export function ToOrder({ api, onCreated, onAsked }: { api: PurchasingApi; onCreated: (orderId: string) => void; onAsked: (requestId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<NeedsState | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [show, setShow] = useState<Show>("left");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ordering, setOrdering] = useState(false);
  const [asking, setAsking] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.needs()); setError(""); } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("What to order didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const needs = useMemo(() => (state?.needs ?? []).filter((need) => (show === "all" || left(need))
    && (!search.trim() || `${need.title} ${need.detail} ${need.projectReference} ${need.projectName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [state, show, search]);
  /** A line the buyer can act on: not waiting for sign-off, with a quantity still open (or still to confirm). */
  const orderable = (need: Need) => !need.blocked && (need.remaining === null || Number(need.remaining) > 0);
  const orderOne = (need: Need) => { setSelected(new Set([need.key])); setOrdering(true); };
  const columns: GroupedTableColumn<Need>[] = [
    { id: "item", label: t("Material"), render: (need) => <span className={styles.nameCell}><span>{need.title}</span>
      {need.detail || need.packageName || need.scopeLines?.length ? <small>{[need.detail, need.packageName, need.scopeLines?.length ? t("For {line}", { line: need.scopeLines.join(", ") }) : ""].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "needed", label: t("Needed"), width: "9.5rem", align: "end", render: (need) => need.required === null ? <span className={styles.muted}>{t("Quantity to confirm")}</span> : `${quantityText(need.required)} ${need.unit}` },
    { id: "ordered", label: t("Ordered"), width: "9rem", align: "end", mobileHidden: true, render: (need) => <span className={styles.nameCell}><span>{Number(need.placed) ? `${quantityText(need.placed)} ${need.unit}` : "—"}</span>
      {Number(need.drafted) ? <small>{t("{quantity} in draft", { quantity: `${quantityText(need.drafted)} ${need.unit}` })}</small> : null}
      {Number(need.fromStock) ? <small>{t("{quantity} from stock", { quantity: `${quantityText(need.fromStock)} ${need.unit}`.trim() })}</small> : null}</span> },
    { id: "when", label: t("Needed by"), width: "10rem", mobileHidden: true, render: (need) => !need.neededBy ? "—"
      : <span className={styles.nameCell}><span>{format.day(need.neededBy)}</span>
        {need.orderBy && left(need) && Number(need.remaining ?? 0) > 0 ? <small className={need.orderBy < format.today() ? styles.lateText : undefined}>{t("Order by {date}", { date: format.day(need.orderBy) })}</small> : null}</span> },
    { id: "left", label: t("Left"), width: "11rem", align: "end", render: (need) => need.blocked ? <span className={styles.muted}>{t("Waiting for the client's sign-off")}</span>
      : need.remaining === null ? <span className={styles.muted}>{t("To confirm")}</span> : Number(need.remaining) > 0 ? <strong>{`${quantityText(need.remaining)} ${need.unit}`}</strong>
      : Number(need.remaining) < 0 ? <span className={styles.lateText}>{t("Ordered {quantity} more than needed", { quantity: `${quantityText(need.remaining.replace("-", ""))} ${need.unit}`.trim() })}</span>
      : <span className={styles.done}>{t("Ordered")}</span> },
    ...(state?.canBuy ? [{ id: "action", label: "", width: "6rem", align: "end" as const, render: (need: Need) => orderable(need) ? <Button size="compact" variant="quiet" aria-label={t("Order {name}", { name: need.title })} onPress={() => orderOne(need)}>{t("Order")}</Button> : null }] : []),
  ];
  const sections = (blocked: boolean): GroupedTableSection<Need>[] => [...new Set(needs.filter((need) => Boolean(need.blocked) === blocked).map((need) => need.projectId))].map((projectId) => {
    const rows = needs.filter((need) => need.projectId === projectId);
    return { id: projectId, label: `${rows[0].projectReference} · ${rows[0].projectName}`, rows, emptyMessage: "" };
  });
  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const ready = sections(false);
  const waiting = sections(true);
  const chosen = state.needs.filter((need) => selected.has(need.key));

  return <div className={styles.stack} data-tour="purchasing-to-order">
    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <SearchInput label={t("Search what to order")} placeholder={t("Search")} value={search} onChange={setSearch} />
        <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "left", label: t("Left to order") }, { id: "all", label: t("Everything") }]} />
      </div>
    </div>
    {!needs.length ? <EmptyState illustration={null} title={show === "left" ? t("Nothing left to order") : t("Nothing to order yet")}
        description={t("Materials appear here from each project's material list, and bought items from its scope.")} />
      : <>
        {ready.length ? <GroupedTable<Need> ariaLabel={t("To order")} columns={columns} sections={ready} getRowId={(need) => need.key} getRowLabel={(need) => `${need.projectReference} ${need.title}`}
          selectable={state.canBuy} selectedIds={selected}
          onSelectionChange={(ids) => setSelected(new Set([...ids].filter((id) => state.needs.some((need) => need.key === id && !need.blocked && (need.remaining === null || Number(need.remaining) > 0)))))} /> : null}
        {waiting.length ? <section className={styles.stack} aria-label={t("Waiting for the client's sign-off")}>
          <h3 className={styles.subhead}>{t("Waiting for the client's sign-off")}</h3>
          <GroupedTable<Need> ariaLabel={t("Waiting for the client's sign-off")} columns={columns} sections={waiting} getRowId={(need) => need.key} selectable={false} />
        </section> : null}
      </>}
    {selected.size ? <div className={styles.selectionBar} role="region" aria-label={t("Selected lines")}>
      <span className={styles.muted}>{t("{count} selected", { count: selected.size })}</span>
      <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
      <span className={styles.selectionActions}>
        <Button size="compact" onPress={() => setAsking(true)}>{t("Ask for prices")}</Button>
        <Button size="compact" variant="primary" onPress={() => setOrdering(true)}>{t("Create order")}</Button>
      </span>
    </div> : null}
    {asking ? <AskPricesDialog api={api} needs={chosen} onClose={() => setAsking(false)} onCreated={(requestId) => { setAsking(false); setSelected(new Set()); onAsked(requestId); }} /> : null}
    {ordering ? <CreateOrderDialog api={api} needs={chosen} onClose={() => setOrdering(false)} onCreated={(orderId) => { setOrdering(false); setSelected(new Set()); onCreated(orderId); }} /> : null}
  </div>;
}
