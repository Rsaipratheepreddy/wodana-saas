"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { purchasingApi } from "@/lib/purchasing/client";
import type { PurchasingSection } from "@/lib/purchasing/sections";
import { CreateOrderDialog } from "./create-order-dialog";
import { Orders } from "./orders";
import { Suppliers } from "./suppliers";
import { ToOrder } from "./to-order";
import styles from "./purchasing.module.css";

export type { PurchasingSection };

/**
 * Purchasing, for the buyer across all projects: what projects still need to order, the orders, and
 * the suppliers. One thing per tab; an order opens in place.
 */
export function PurchasingPage({ workspaceId, section }: { workspaceId: string; section: PurchasingSection }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const openId = params.get("order");
  const go = (next: PurchasingSection, order?: string | null) => {
    const base = `/workspace/purchasing${next === "to-order" ? "" : `/${next}`}`;
    router.replace(order ? `${base}?order=${order}` : base, { scroll: false });
  };
  const action = section === "orders" ? <Button variant="primary" onPress={() => setNewOrder(true)}><Plus aria-hidden="true" size={15} />{t("New order")}</Button>
    : section === "suppliers" ? <Button variant="primary" onPress={() => setAddingSupplier(true)}><Plus aria-hidden="true" size={15} />{t("Add supplier")}</Button> : null;
  return <div className={styles.page}>
    <PageHeader title={t("Purchasing")} actions={action} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as PurchasingSection)} items={[
      { id: "to-order", label: t("To order"), panel: <ToOrder api={api} onCreated={(id) => { setRefresh((value) => value + 1); go("orders", id); }} /> },
      { id: "orders", label: t("Orders"), panel: <Orders api={api} refreshKey={refresh} openId={openId} onOpen={(id) => go("orders", id)} /> },
      { id: "suppliers", label: t("Suppliers"), panel: <Suppliers api={api} adding={addingSupplier} onAddingChange={setAddingSupplier} /> },
    ]} />
    {newOrder ? <CreateOrderDialog api={api} needs={[]} onClose={() => setNewOrder(false)} onCreated={(id) => { setNewOrder(false); setRefresh((value) => value + 1); go("orders", id); }} /> : null}
  </div>;
}
