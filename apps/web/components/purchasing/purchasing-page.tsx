"use client";

import { useMemo } from "react";
import { purchasingApi } from "@/lib/purchasing/client";
import { Suppliers } from "./suppliers";
import styles from "./purchasing.module.css";

/** Purchasing: the supplier register (what to order and orders join it as they're built). */
export function PurchasingPage({ workspaceId }: { workspaceId: string }) {
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  return <div className={styles.page}><Suppliers api={api} /></div>;
}
