import type { Metadata } from "next";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { PlatformConnectionsPage } from "@/components/control-plane/platform-connections-page";
import { NoAccessState } from "@/design-system";
import { consoleT, requireOperator } from "@/lib/internal/server";
import styles from "@/components/control-plane/control-plane.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Platform connections")} · ${t("Wodana Control")}` };
}

export default async function InternalPlatformConnectionsPage() {
  const operator = await requireOperator();
  const t = await consoleT();
  return <OperatorShell operator={operator}>
    {operator.permissions.includes("platform.integrations.manage")
      ? <PlatformConnectionsPage />
      : <div className={styles.page}><NoAccessState area={t("Platform connections")} /></div>}
  </OperatorShell>;
}
