import type { Metadata } from "next";
import { AiCreditsPage } from "@/components/control-plane/ai-credits-page";
import { OperatorShell } from "@/components/control-plane/operator-shell";
import { consoleT, requireOperator } from "@/lib/internal/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await consoleT();
  return { title: `${t("AI credits")} · ${t("Wodana Control")}` };
}

export default async function InternalAiCreditsPage() {
  const operator = await requireOperator();
  return <OperatorShell operator={operator}>
    <AiCreditsPage canManage={operator.permissions.includes("billing.manage")} />
  </OperatorShell>;
}
