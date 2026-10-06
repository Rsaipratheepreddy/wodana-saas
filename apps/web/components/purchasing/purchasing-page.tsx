"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { Plus, ScanLine } from "lucide-react";
import { Button, PageShell } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { RECEIVE_PATH } from "@/lib/operations/receive-link";
import { purchasingApi } from "@/lib/purchasing/client";
import type { PurchasingSection } from "@/lib/purchasing/sections";
import { moduleTabs } from "../operations/module-tabs";
import { useProjectFilter, withProject } from "../operations/ops";
import { CreateOrderDialog } from "./create-order-dialog";
import { Deliveries } from "./deliveries";
import type { OrderIntent } from "./order-sheet";
import { Orders } from "./orders";
import { PriceRequests } from "./price-requests";
import { Suppliers } from "./suppliers";
import { ToOrder, type ToOrderView } from "./to-order";
import { useLiveInvalidate } from "@/lib/workspace/live-events";

const PURCHASING_SCOPES = ["purchasing"] as const;
const INTENTS: OrderIntent[] = ["send", "confirm", "chase", "receive", "close"];
const VIEWS: ToOrderView[] = ["order", "late", "signoff", "hold", "over", "restock", "all"];

export type { PurchasingSection };

/**
 * Purchasing, for the buyer across all projects (or one, from the project's own links): what projects still
 * need to order, price requests, the orders, deliveries, and the suppliers. One thing per tab; a request, an
 * order or a delivery opens in place, and every list names its projects and its one next step.
 */
export function PurchasingPage({ workspaceId, section: initialSection }: { workspaceId: string; section: PurchasingSection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const params = useSearchParams();
  const router = useRouter();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [projectId, setProjectId] = useProjectFilter();
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // Another buyer's order, approval or delivery shows on every tab without a reload.
  useLiveInvalidate(workspaceId, PURCHASING_SCOPES, () => setRefresh((value) => value + 1), 2_000);
  const openId = params.get("order");
  const requestId = params.get("request");
  const receiptId = params.get("receipt");
  const returnId = params.get("return");
  const unmatchedId = params.get("unmatched");
  const asked = params.get("do");
  const intent = INTENTS.includes(asked as OrderIntent) ? asked as OrderIntent : null;
  const view = params.get("view");
  const toOrderView = VIEWS.includes(view as ToOrderView) ? view as ToOrderView : undefined;
  const go = (next: PurchasingSection, open?: string | null, key?: "return" | "unmatched", then?: OrderIntent) => {
    const base = `/workspace/purchasing${next === "to-order" ? "" : `/${next}`}`;
    const record = open ? `${base}?${key ?? (next === "price-requests" ? "request" : next === "deliveries" ? "receipt" : "order")}=${open}${then ? `&do=${then}` : ""}` : base;
    move(next, withProject(record, projectId));
  };
  const action = section === "orders" ? <Button variant="primary" onPress={() => setNewOrder(true)}><Plus aria-hidden="true" size={15} />{t("New order")}</Button>
    : section === "suppliers" ? <Button variant="primary" onPress={() => setAddingSupplier(true)}><Plus aria-hidden="true" size={15} />{t("Add supplier")}</Button>
    // Deliveries: receive by scanning the code on the printed order or move (D-46).
    : section === "deliveries" ? <Button variant="primary" onPress={() => router.push(RECEIVE_PATH)}><ScanLine aria-hidden="true" size={15} />{t("Scan to receive")}</Button> : null;
  const { tabs, content } = moduleTabs<PurchasingSection>({ t, tour: "purchasing-tab", value: section, onChange: (key) => go(key), items: [
      { id: "to-order", label: t("To order"), panel: <ToOrder api={api} workspaceId={workspaceId} projectId={projectId} onProject={setProjectId} initialView={toOrderView}
        onCreated={(id) => { setRefresh((value) => value + 1); go("orders", id); }} onAsked={(id) => { setRefresh((value) => value + 1); go("price-requests", id); }}
        onOrders={() => go("orders")} refreshKey={refresh} /> },
      { id: "price-requests", label: t("Price requests"), panel: <PriceRequests api={api} refreshKey={refresh} openId={requestId} onOpen={(id) => go("price-requests", id)}
        onOrder={(id) => { setRefresh((value) => value + 1); go("orders", id); }} /> },
      { id: "orders", label: t("Orders"), panel: <Orders api={api} refreshKey={refresh} openId={openId} intent={intent} onOpen={(id, then) => go("orders", id, undefined, then)}
        onReceipt={(id) => go("deliveries", id)} projectId={projectId} onProject={setProjectId} /> },
      { id: "deliveries", label: t("Deliveries"), panel: <Deliveries api={api} refreshKey={refresh} openId={receiptId} returnId={returnId} unmatchedId={unmatchedId} onOpen={(id) => go("deliveries", id)}
        onOpenReturn={(id) => go("deliveries", id, "return")} onOpenUnmatched={(id) => go("deliveries", id, "unmatched")} onOpenOrder={(id) => go("orders", id)}
        projectId={projectId} onProject={setProjectId} /> },
      { id: "suppliers", label: t("Suppliers"), panel: <Suppliers api={api} adding={addingSupplier} onAddingChange={setAddingSupplier} importLinkId={params.get("import")} /> },
    ] });
  return <PageShell title={t("Purchasing")} action={action} tabs={tabs}>
    {content}
    {newOrder ? <CreateOrderDialog api={api} needs={[]} onClose={() => setNewOrder(false)} onCreated={(id) => { setNewOrder(false); setRefresh((value) => value + 1); go("orders", id); }} /> : null}
  </PageShell>;
}
