"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { Plus } from "lucide-react";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { purchasingApi } from "@/lib/purchasing/client";
import type { PurchasingSection } from "@/lib/purchasing/sections";
import { CreateOrderDialog } from "./create-order-dialog";
import { Deliveries } from "./deliveries";
import { Orders } from "./orders";
import { PriceRequests } from "./price-requests";
import { Suppliers } from "./suppliers";
import { ToOrder } from "./to-order";
import styles from "./purchasing.module.css";
import { useLiveInvalidate } from "@/lib/workspace/live-events";

const PURCHASING_SCOPES = ["purchasing"] as const;

export type { PurchasingSection };

/**
 * Purchasing, for the buyer across all projects: what projects still need to order, price requests,
 * the orders, deliveries, and the suppliers. One thing per tab; a request, an order or a delivery opens in place.
 */
export function PurchasingPage({ workspaceId, section: initialSection }: { workspaceId: string; section: PurchasingSection }) {
  const t = useT();
  const [section, move] = useSection(initialSection);
  const params = useSearchParams();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
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
  const go = (next: PurchasingSection, open?: string | null, key?: "return" | "unmatched") => {
    const base = `/workspace/purchasing${next === "to-order" ? "" : `/${next}`}`;
    move(next, open ? `${base}?${key ?? (next === "price-requests" ? "request" : next === "deliveries" ? "receipt" : "order")}=${open}` : base);
  };
  const action = section === "orders" ? <Button variant="primary" onPress={() => setNewOrder(true)}><Plus aria-hidden="true" size={15} />{t("New order")}</Button>
    : section === "suppliers" ? <Button variant="primary" onPress={() => setAddingSupplier(true)}><Plus aria-hidden="true" size={15} />{t("Add supplier")}</Button> : null;
  return <div className={styles.page}>
    <PageHeader title={t("Purchasing")} actions={action} />
    <Tabs tour="purchasing-tab" selectedKey={section} onSelectionChange={(key) => go(key as PurchasingSection)} items={[
      { id: "to-order", label: t("To order"), panel: <ToOrder api={api} onCreated={(id) => { setRefresh((value) => value + 1); go("orders", id); }}
        onAsked={(id) => { setRefresh((value) => value + 1); go("price-requests", id); }} /> },
      { id: "price-requests", label: t("Price requests"), panel: <PriceRequests api={api} refreshKey={refresh} openId={requestId} onOpen={(id) => go("price-requests", id)}
        onOrder={(id) => { setRefresh((value) => value + 1); go("orders", id); }} /> },
      { id: "orders", label: t("Orders"), panel: <Orders api={api} refreshKey={refresh} openId={openId} onOpen={(id) => go("orders", id)} onReceipt={(id) => go("deliveries", id)} /> },
      { id: "deliveries", label: t("Deliveries"), panel: <Deliveries api={api} refreshKey={refresh} openId={receiptId} returnId={returnId} unmatchedId={unmatchedId} onOpen={(id) => go("deliveries", id)}
        onOpenReturn={(id) => go("deliveries", id, "return")} onOpenUnmatched={(id) => go("deliveries", id, "unmatched")} onOpenOrder={(id) => go("orders", id)} /> },
      { id: "suppliers", label: t("Suppliers"), panel: <Suppliers api={api} adding={addingSupplier} onAddingChange={setAddingSupplier} /> },
    ]} />
    {newOrder ? <CreateOrderDialog api={api} needs={[]} onClose={() => setNewOrder(false)} onCreated={(id) => { setNewOrder(false); setRefresh((value) => value + 1); go("orders", id); }} /> : null}
  </div>;
}
