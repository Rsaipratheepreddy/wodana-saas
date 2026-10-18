"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { MoneyRights, ProjectDetail } from "@/lib/project-core/types";
import { ProjectPettyCash } from "../petty-cash/project-petty-cash";
import { ProjectHandover } from "../site/project-handover";
import { ProjectWarranty } from "../site/project-warranty";
import { ProjectClientMoney } from "./project-client-money";
import { ProjectMoney } from "./project-money";
import { ProjectMoneySummary } from "./project-money-summary";
import styles from "./project-core.module.css";

/** A tab's view in the address (`?view=`), so a link or a notice opens the right one and the back button works. */
function useView<V extends string>(views: readonly V[], fallback: V) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("view");
  const view = views.includes(requested as V) ? (requested as V) : fallback;
  const go = useCallback((next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === fallback) query.delete("view"); else query.set("view", next);
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [fallback, params, pathname, router]);
  return [view, go] as const;
}

type MoneyView = "summary" | "client" | "costs" | "petty-cash";

/**
 * Money: the summary (key figures, the P&L by category and the cash flow), the client side (milestones, invoices,
 * receipts), the costs (budgets per package, every cost, hours) and petty cash. Each shows only to the people who see
 * it; everyone on the team sees their own petty cash.
 */
export function ProjectMoneyTab({ workspaceId, projectId, rights }: { workspaceId: string; projectId: string; rights: MoneyRights }) {
  const t = useT();
  const views = [...(rights.costs ? ["summary" as const] : []), ...(rights.client ? ["client" as const] : []), ...(rights.costs ? ["costs" as const] : []), "petty-cash" as const];
  const [view, go] = useView<MoneyView>(views, rights.costs ? "summary" : rights.client ? "client" : "petty-cash");
  const labels: Record<MoneyView, string> = { summary: t("Summary"), client: t("Client"), costs: t("Costs"), "petty-cash": t("Petty cash") };
  const switcher = views.length > 1 ? <SegmentedControl label={t("Money")} value={view} onChange={go} options={views.map((id) => ({ id, label: labels[id] }))} /> : null;
  if (view === "summary") return <ProjectMoneySummary workspaceId={workspaceId} projectId={projectId} switcher={switcher} />;
  if (view === "client") return <ProjectClientMoney workspaceId={workspaceId} projectId={projectId} switcher={switcher} />;
  if (view === "costs") return <ProjectMoney workspaceId={workspaceId} projectId={projectId} switcher={switcher} />;
  return <ProjectPettyCash workspaceId={workspaceId} projectId={projectId} switcher={switcher} />;
}

type HandoverView = "handover" | "warranty";

/**
 * Handover and, once something has been handed over (or the project is complete), its warranty: what's covered
 * until when, and the client's claims.
 */
export function ProjectHandoverTab({ workspaceId, projectId, detail }: { workspaceId: string; projectId: string; detail: ProjectDetail }) {
  const t = useT();
  const params = useSearchParams();
  // Warranty shows once the client has accepted a handover pack (or the project is complete), or when a link asks for it.
  const warranty = detail.project.status === "completed" || Boolean(detail.project.handoverAccepted) || params.get("view") === "warranty" || Boolean(params.get("claim"));
  const views: HandoverView[] = warranty ? ["handover", "warranty"] : ["handover"];
  const [view, go] = useView<HandoverView>(views, "handover");
  const switcher = views.length > 1 ? <div className={styles.tabSwitch}><SegmentedControl label={t("Handover")} tour="project-handover-view" value={view} onChange={go}
    options={[{ id: "handover", label: t("Handover") }, { id: "warranty", label: t("Warranty") }]} /></div> : null;
  return <div className={styles.tabStack}>
    {switcher}
    {view === "warranty" ? <ProjectWarranty workspaceId={workspaceId} projectId={projectId} /> : <ProjectHandover workspaceId={workspaceId} projectId={projectId} />}
  </div>;
}
