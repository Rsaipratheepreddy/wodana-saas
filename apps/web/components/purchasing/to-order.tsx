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
  const columns: GroupedTableColumn<Need>[] = [
    { id: "item", label: t("Item"), width: "34%", render: (need) => <span className={styles.nameCell}><span>{need.title}</span>
      {need.detail || need.packageName || need.scopeLines?.length ? <small>{[need.detail, need.packageName, need.scopeLines?.length ? t("For {line}", { line: need.scopeLines.join(", ") }) : ""].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "needed", label: t("Needed"), width: "14%", render: (need) => need.required === null ? <span className={styles.muted}>{t("Quantity to confirm")}</span> : `${quantityText(need.required)} ${need.unit}` },
    { id: "ordered", label: t("Ordered"), width: "14%", mobileHidden: true, render: (need) => <span className={styles.nameCell}><span>{Number(need.placed) ? `${quantityText(need.placed)} ${need.unit}` : "—"}</span>
      {Number(need.drafted) ? <small>{t("{quantity} in draft", { quantity: `${quantityText(need.drafted)} ${need.unit}` })}</small> : null}
      {Number(need.fromStock) ? <small>{t("{quantity} from stock", { quantity: `${quantityText(need.fromStock)} ${need.unit}`.trim() })}</small> : null}</span> },
    { id: "when", label: t("Needed by"), width: "16%", mobileHidden: true, render: (need) => !need.neededBy ? "—"
      : <span className={styles.nameCell}><span>{format.day(need.neededBy)}</span>
        {need.orderBy && left(need) && Number(need.remaining ?? 0) > 0 ? <small className={need.orderBy < format.today() ? styles.lateText : undefined}>{t("Order by {date}", { date: format.day(need.orderBy) })}</small> : null}</span> },
    { id: "left", label: t("Left"), width: "22%", render: (need) => need.blocked ? <span className={styles.muted}>{t("Waiting for the client's sign-off")}</span>
      : need.remaining === null ? "—" : Number(need.remaining) > 0 ? <strong>{`${quantityText(need.remaining)} ${need.unit}`}</strong>
      : Number(need.remaining) < 0 ? <span className={styles.lateText}>{t("Ordered {quantity} more than needed", { quantity: `${quantityText(need.remaining.replace("-", ""))} ${need.unit}`.trim() })}</span>
      : <span className={styles.done}>{t("Ordered")}</span> },
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

  return <div className={styles.stack}>
    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <SearchInput label={t("Search what to order")} placeholder={t("Search")} value={search} onChange={setSearch} />
        <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "left", label: t("Left to order") }, { id: "all", label: t("Everything") }]} />
      </div>
      {selected.size ? <div className={styles.filters}>
        <span className={styles.muted}>{t("{count} selected", { count: selected.size })}</span>
        <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
        <Button size="compact" onPress={() => setAsking(true)}>{t("Ask for prices")}</Button>
        <Button size="compact" variant="primary" onPress={() => setOrdering(true)}>{t("Create order")}</Button>
      </div> : null}
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
    {asking ? <AskPricesDialog api={api} needs={chosen} onClose={() => setAsking(false)} onCreated={(requestId) => { setAsking(false); setSelected(new Set()); onAsked(requestId); }} /> : null}
    {ordering ? <CreateOrderDialog api={api} needs={chosen} onClose={() => setOrdering(false)} onCreated={(orderId) => { setOrdering(false); setSelected(new Set()); onCreated(orderId); }} /> : null}
  </div>;
}
