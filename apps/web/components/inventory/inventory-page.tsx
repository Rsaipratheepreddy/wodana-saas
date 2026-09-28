"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import type { InventorySection } from "@/lib/inventory/sections";
import type { StockState } from "@/lib/inventory/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { useProjectFilter, withProject } from "../operations/ops";
import { History } from "./history";
import { MoveDialog } from "./move-dialog";
import { Moves } from "./moves";
import { Stock, type StockView } from "./stock";
import styles from "./inventory.module.css";

// Deliveries, moves, counts (purchasing) and made goods (factory) all change stock.
const STOCK_SCOPES = ["purchasing", "factory"] as const;

/** Inventory: stock by place and owner (and what runs low), moves between places, and the history of every change. One thing per tab. */
export function InventoryPage({ workspaceId, section: initialSection }: { workspaceId: string; section: InventorySection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const params = useSearchParams();
  const api = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [projectId, setProjectId] = useProjectFilter();
  const [state, setState] = useState<StockState | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [moving, setMoving] = useState(false);
  const moveId = params.get("move");
  const itemId = params.get("item");
  const view = params.get("view") === "low" ? "low" as StockView : undefined;
  const load = useCallback(async () => {
    try { setState(await api.stock()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Stock didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Someone else's delivery, move, count or finished work shows without a reload.
  useLiveInvalidate(workspaceId, STOCK_SCOPES, () => { setRefresh((value) => value + 1); void load(); }, 2_000);
  const go = (next: InventorySection, query?: Record<string, string>) => {
    const base = `/workspace/inventory${next === "stock" ? "" : `/${next}`}`;
    move(next, withProject(query && Object.keys(query).length ? `${base}?${new URLSearchParams(query)}` : base, projectId));
  };
  const changed = () => { setRefresh((value) => value + 1); void load(); };
  const action = state?.canManage && section !== "history" ? <Button variant="primary" onPress={() => setMoving(true)}>{t("Move stock")}</Button> : null;
  return <div className={styles.page}>
    <PageHeader title={t("Inventory")} actions={action} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as InventorySection)} items={[
      { id: "stock", label: t("Stock"), count: (state?.reorderPoints ?? []).filter((point) => point.short).length || undefined,
        panel: <Stock api={api} workspaceId={workspaceId} state={state} error={error} onReload={() => void load()} onChanged={(next) => { setState(next); setRefresh((value) => value + 1); }}
          onMoved={(next) => { changed(); go("moves", { move: next.transfer.id }); }} onHistory={(id) => go("history", { item: id })} projectId={projectId} onProject={setProjectId} initialView={view} /> },
      { id: "moves", label: t("Moves"), count: state?.inTransit || undefined,
        panel: <Moves api={api} refreshKey={refresh} openId={moveId} onOpen={(id) => go("moves", id ? { move: id } : undefined)} onChanged={changed} projectId={projectId} onProject={setProjectId} /> },
      { id: "history", label: t("History"), panel: <History api={api} itemId={itemId} refreshKey={refresh} onClearItem={() => go("history")} projectId={projectId} onProject={setProjectId} /> },
    ]} />
    {moving && state ? <MoveDialog api={api} state={state} row={null} onClose={() => setMoving(false)} onSent={(next) => { setMoving(false); changed(); go("moves", { move: next.transfer.id }); }} /> : null}
  </div>;
}
