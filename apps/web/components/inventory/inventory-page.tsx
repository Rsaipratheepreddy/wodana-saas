"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import type { InventorySection } from "@/lib/inventory/sections";
import type { StockState } from "@/lib/inventory/types";
import { History } from "./history";
import { MoveDialog } from "./move-dialog";
import { Moves } from "./moves";
import { Stock } from "./stock";
import styles from "./inventory.module.css";

/** Inventory: stock by place and owner, moves between places, and the history of every change. One thing per tab. */
export function InventoryPage({ workspaceId, section }: { workspaceId: string; section: InventorySection }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<StockState | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [moving, setMoving] = useState(false);
  const moveId = params.get("move");
  const itemId = params.get("item");
  const load = useCallback(async () => {
    try { setState(await api.stock()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Stock didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const go = (next: InventorySection, query?: Record<string, string>) => {
    const base = `/workspace/inventory${next === "stock" ? "" : `/${next}`}`;
    router.replace(query && Object.keys(query).length ? `${base}?${new URLSearchParams(query)}` : base, { scroll: false });
  };
  const changed = () => { setRefresh((value) => value + 1); void load(); };
  const action = state?.canManage && section !== "history" ? <Button variant="primary" onPress={() => setMoving(true)}>{t("Move stock")}</Button> : null;
  return <div className={styles.page}>
    <PageHeader title={t("Inventory")} actions={action} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as InventorySection)} items={[
      { id: "stock", label: t("Stock"), panel: <Stock api={api} state={state} error={error} onReload={() => void load()} onChanged={(next) => { setState(next); setRefresh((value) => value + 1); }}
        onMoved={(next) => { changed(); go("moves", { move: next.transfer.id }); }} onHistory={(id) => go("history", { item: id })} /> },
      { id: "moves", label: state?.inTransit ? t("Moves ({count})", { count: state.inTransit }) : t("Moves"),
        panel: <Moves api={api} refreshKey={refresh} openId={moveId} onOpen={(id) => go("moves", id ? { move: id } : undefined)} onChanged={changed} /> },
      { id: "history", label: t("History"), panel: <History api={api} itemId={itemId} refreshKey={refresh} onClearItem={() => go("history")} /> },
    ]} />
    {moving && state ? <MoveDialog api={api} state={state} row={null} onClose={() => setMoving(false)} onSent={(next) => { setMoving(false); changed(); go("moves", { move: next.transfer.id }); }} /> : null}
  </div>;
}
