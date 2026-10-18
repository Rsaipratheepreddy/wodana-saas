import type { Metadata } from "next";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { SalesEnquiriesPage } from "@/components/control-plane/sales-enquiries-page";
import { NoAccessState } from "@/design-system";
import { consoleT, requireOperator } from "@/lib/internal/server";
import styles from "@/components/control-plane/control-plane.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Sales enquiries")} · ${t("Wodana Control")}` };
}

export default async function InternalSalesEnquiriesPage() {
  const operator = await requireOperator();
  const t = await consoleT();
  return <OperatorShell operator={operator}>
    {operator.permissions.includes("sales.read")
      ? <SalesEnquiriesPage canManage={operator.permissions.includes("sales.manage")} />
      : <div className={styles.page}><NoAccessState area={t("Sales enquiries")} /></div>}
  </OperatorShell>;
}
