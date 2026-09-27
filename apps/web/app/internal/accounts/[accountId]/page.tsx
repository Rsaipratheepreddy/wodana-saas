import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPage } from "@/components/control-plane/account-page";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { consoleT, requireOperator } from "@/lib/internal/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("Account")} · ${t("Wodana Control")}` };
}

export default async function InternalAccountPage(context: { params: Promise<{ accountId: string }> }) {
  const operator = await requireOperator();
  const { accountId } = await context.params;
  if (!ID.test(accountId)) notFound();
  return <OperatorShell operator={operator}>
    <AccountPage accountId={accountId} permissions={operator.permissions} operatorUserId={operator.userId} />
  </OperatorShell>;
}
