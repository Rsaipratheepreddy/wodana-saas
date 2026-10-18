import type { Metadata } from "next";
import { AccountsPage } from "@/components/control-plane/accounts-page";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { consoleT, requireOperator } from "@/lib/internal/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Accounts")} · ${t("Wodana Control")}` };
}

export default async function InternalAccountsPage() {
  const operator = await requireOperator();
  return <OperatorShell operator={operator}>
    <AccountsPage canProvision={operator.permissions.includes("tenants.provision")} />
  </OperatorShell>;
}
