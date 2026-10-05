"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { PageShell } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySection } from "@/lib/factory/sections";
import type { FactoryState } from "@/lib/factory/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { moduleTabs } from "../operations/module-tabs";
import { useProjectFilter, withProject } from "../operations/ops";
import { Batches } from "./batches";
import { Schedule } from "./schedule";
import { ToMake } from "./to-make";
import type { WorkOrderIntent } from "./work-order-sheet";
import { WorkOrders } from "./work-orders";

// Releases, reports and checks change the factory; deliveries and moves change what's in for it.
const FACTORY_SCOPES = ["factory", "purchasing"] as const;
const INTENTS: WorkOrderIntent[] = ["report", "check", "dispatch", "drawing"];

/** Factory: what's left to make across running projects, the work orders (what waits for me first), the schedule and batches. A work order opens in place. */
export function FactoryPage({ workspaceId, section: initialSection }: { workspaceId: string; section: FactorySection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const params = useSearchParams();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [projectId, setProjectId] = useProjectFilter();
  const [state, setState] = useState<FactoryState | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const openId = params.get("order");
  const batchId = params.get("batch");
  const asked = params.get("do");
  const intent = INTENTS.includes(asked as WorkOrderIntent) ? asked as WorkOrderIntent : null;
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); setRefresh((value) => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The factory didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // A release, report, check or delivery by someone else shows without a reload.
  useLiveInvalidate(workspaceId, FACTORY_SCOPES, () => void load(), 2_000);
  const go = (next: FactorySection, open?: string | null, action?: WorkOrderIntent) => {
    const base = `/workspace/factory${next === "to-make" ? "" : `/${next}`}`;
    const query = open ? `?${next === "batches" ? "batch" : "order"}=${open}${action ? `&do=${action}` : ""}` : "";
    move(next, withProject(`${base}${query}`, projectId));
  };
  const orders = (state?.orders ?? []).filter((order) => !projectId || order.projectId === projectId);
  const mine = orders.filter((order) => order.mine && order.next).length;
  const left = (state?.toMake ?? []).filter((line) => (!projectId || line.projectId === projectId) && Number(line.left) > 0 && line.projectStatus !== "on_hold").length;
  const { tabs, content } = moduleTabs<FactorySection>({ t, tour: "factory-tab", value: section, onChange: (key) => go(key), items: [
      { id: "to-make", label: t("To make"), count: left || undefined,
        panel: <ToMake api={api} state={state} error={error} onReload={() => void load()} onPlanned={(id) => { void load(); go("orders", id); }} projectId={projectId} onProject={setProjectId} /> },
      { id: "orders", label: t("Work orders"), count: mine || undefined,
        panel: <WorkOrders api={api} state={state} error={error} openId={openId} intent={intent} onReload={() => void load()} onOpen={(id, action) => go("orders", id, action ?? undefined)}
          onBatched={(id) => { void load(); go("batches", id); }} projectId={projectId} onProject={setProjectId} /> },
      { id: "schedule", label: t("Schedule"), panel: <Schedule api={api} refreshKey={refresh} onOpen={(id) => go("orders", id)} /> },
      { id: "batches", label: t("Batches"), panel: <Batches api={api} state={state} error={error} openId={batchId} onReload={() => void load()} onOpen={(id) => go("batches", id)}
        onOpenOrder={(id) => go("orders", id)} /> },
    ] });
  return <PageShell title={t("Factory")} tabs={tabs}>{content}</PageShell>;
}
