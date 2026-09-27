"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySection } from "@/lib/factory/sections";
import type { FactoryState } from "@/lib/factory/types";
import { ToMake } from "./to-make";
import { WorkOrders } from "./work-orders";
import styles from "./factory.module.css";

/** Factory: what's left to make across running projects, and the work orders. A work order opens in place. */
export function FactoryPage({ workspaceId, section }: { workspaceId: string; section: FactorySection }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<FactoryState | null>(null);
  const [error, setError] = useState("");
  const openId = params.get("order");
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The factory didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const go = (next: FactorySection, order?: string | null) => {
    const base = `/workspace/factory${next === "to-make" ? "" : `/${next}`}`;
    router.replace(order ? `${base}?order=${order}` : base, { scroll: false });
  };
  const open = state?.orders.filter((order) => ["planned", "released", "in_production", "on_hold"].includes(order.status)).length ?? 0;
  return <div className={styles.page}>
    <PageHeader title={t("Factory")} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as FactorySection)} items={[
      { id: "to-make", label: t("To make"), panel: <ToMake api={api} state={state} error={error} onReload={() => void load()} onPlanned={(id) => { void load(); go("orders", id); }} /> },
      { id: "orders", label: open ? t("Work orders ({count})", { count: open }) : t("Work orders"),
        panel: <WorkOrders api={api} state={state} error={error} openId={openId} onReload={() => void load()} onOpen={(id) => go("orders", id)} /> },
    ]} />
  </div>;
}
