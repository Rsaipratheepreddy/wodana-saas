"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySection } from "@/lib/factory/sections";
import type { FactoryState } from "@/lib/factory/types";
import { Batches } from "./batches";
import { Schedule } from "./schedule";
import { ToMake } from "./to-make";
import { WorkOrders } from "./work-orders";
import styles from "./factory.module.css";

/** Factory: what's left to make across running projects, and the work orders. A work order opens in place. */
export function FactoryPage({ workspaceId, section: initialSection }: { workspaceId: string; section: FactorySection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const params = useSearchParams();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<FactoryState | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const openId = params.get("order");
  const batchId = params.get("batch");
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); setRefresh((value) => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The factory didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const go = (next: FactorySection, open?: string | null) => {
    const base = `/workspace/factory${next === "to-make" ? "" : `/${next}`}`;
    move(next, open ? `${base}?${next === "batches" ? "batch" : "order"}=${open}` : base);
  };
  const open = state?.orders.filter((order) => ["planned", "released", "in_production", "on_hold"].includes(order.status)).length ?? 0;
  return <div className={styles.page}>
    <PageHeader title={t("Factory")} />
    <Tabs tour="factory-tab" selectedKey={section} onSelectionChange={(key) => go(key as FactorySection)} items={[
      { id: "to-make", label: t("To make"), panel: <ToMake api={api} state={state} error={error} onReload={() => void load()} onPlanned={(id) => { void load(); go("orders", id); }} /> },
      { id: "orders", label: open ? t("Work orders ({count})", { count: open }) : t("Work orders"),
        panel: <WorkOrders api={api} state={state} error={error} openId={openId} onReload={() => void load()} onOpen={(id) => go("orders", id)} onBatched={(id) => { void load(); go("batches", id); }} /> },
      { id: "schedule", label: t("Schedule"), panel: <Schedule api={api} refreshKey={refresh} onOpen={(id) => go("orders", id)} /> },
      { id: "batches", label: t("Batches"), panel: <Batches api={api} state={state} error={error} openId={batchId} onReload={() => void load()} onOpen={(id) => go("batches", id)}
        onOpenOrder={(id) => go("orders", id)} /> },
    ]} />
  </div>;
}
