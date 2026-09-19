"use client";

import Link from "next/link";
import type { ProjectState } from "@/lib/projects/execution";
import s from "./project-flow-nav.module.css";

const stageDefinitions = [
  { id: "scope", label: "Scope", sections: ["documents", "boq"], destination: "documents" },
  { id: "plan", label: "Plan", sections: ["plan-teams"], destination: "plan-teams" },
  { id: "materials", label: "Materials", sections: ["material-planning", "procurement"], destination: "material-planning" },
  { id: "make", label: "Make", sections: ["production"], destination: "production" },
  { id: "install", label: "Install", sections: ["site-work", "daily-progress"], destination: "site-work" },
  { id: "close", label: "Close", sections: ["snagging", "handover"], destination: "snagging" },
] as const;

export function ProjectFlowNav({ state, section }: { state: ProjectState; section: string }) {
  const d = state.data;
  const activeOrders = d.orders.filter((order) => !["closed", "cancelled"].includes(order.status));
  const factoryTasks = d.tasks.filter((task) => task.location === "factory" && task.status !== "cancelled");
  const siteTasks = d.tasks.filter((task) => task.location === "site" && task.status !== "cancelled");
  const details: Record<string, string> = {
    scope: `${d.scope?.lines.length ?? 0} items · ${d.documents.filter((document) => document.status === "approved").length} approved files`,
    plan: `${(d.workPackages ?? []).filter((item) => item.status !== "cancelled").length} packages · ${d.tasks.filter((task) => task.status !== "cancelled").length} tasks`,
    materials: `${d.materials.length} requirements · ${activeOrders.length} open orders`,
    make: `${factoryTasks.filter((task) => task.status === "completed").length}/${factoryTasks.length} complete`,
    install: `${siteTasks.filter((task) => task.status === "completed").length}/${siteTasks.length} complete`,
    close: `${d.snags.filter((snag) => snag.status !== "closed").length} open snags · ${d.handovers.filter((handover) => handover.status === "accepted").length} accepted`,
  };

  return <nav className={s.flow} aria-label="Project delivery stages">
    <ol>{stageDefinitions.map((stage, index) => {
      const active = stage.sections.includes(section as never);
      return <li key={stage.id} data-active={active || undefined}>
        <Link href={`/workspace/projects/${state.id}/${stage.destination}`} aria-current={active ? "step" : undefined}>
          <span className={s.number}>{index + 1}</span>
          <span><strong>{stage.label}</strong><small>{details[stage.id]}</small></span>
        </Link>
      </li>;
    })}</ol>
  </nav>;
}
