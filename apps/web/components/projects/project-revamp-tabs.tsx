"use client";

import { useEffect } from "react";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { DesignSystemProvider, Tabs } from "@/design-system";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import styles from "./project-revamp-tabs.module.css";
import { ProjectPlanningPanel } from "./project-planning-panel";
import type { ProjectPlanningContext } from "@/lib/projects/planning";

// Approved Scope is the agreed baseline: items, BOQ, quotations and approved drawings.
// Quality & Handover closes the flow with inspections, snags and final delivery.
const sections = [
  { id: "overview", label: "Overview" },
  { id: "planning", label: "Planning" },
  { id: "approved-scope", label: "Approved Scope" },
  { id: "materials-procurement", label: "Materials & Procurement" },
  { id: "execution", label: "Execution" },
  { id: "finance-expenses", label: "Finance & Expenses" },
  { id: "issues-delays", label: "Issues & Delays" },
  { id: "quality-handover", label: "Quality & Handover" },
] as const;

const planningSections = [
  { id: "requirements", label: "Requirements" },
  { id: "design", label: "Design" },
  { id: "quotations", label: "Quotations" },
  { id: "change-requests", label: "Change Requests" },
] as const;

export function ProjectRevampTabs({ projectName, planningContext }: { projectName: string; planningContext?: ProjectPlanningContext }) {
  useWorkspaceBreadcrumb(projectName);
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = sections.find(section => section.id === params.get("tab"))?.id ?? "overview";
  const selectedPlanning = planningSections.find(section => section.id === params.get("planningTab"))?.id ?? "requirements";
  useEffect(() => {
    if (!projectName || params.get("projectName") === projectName) return;
    const query = new URLSearchParams(params.toString());
    query.set("projectName", projectName);
    window.history.replaceState(null, "", `${pathname}?${query.toString()}`);
  }, [projectName, pathname, params]);

  function selectTab(tab: string) {
    const query = new URLSearchParams(params.toString());
    query.set("tab", tab);
    window.history.pushState(null, "", `${pathname}?${query.toString()}`);
  }

  function selectPlanningTab(tab: string) {
    const query = new URLSearchParams(params.toString());
    query.set("tab", "planning");
    query.set("planningTab", tab);
    window.history.pushState(null, "", `${pathname}?${query.toString()}`);
  }

  return <DesignSystemProvider className={styles.tabs}>
    <Tabs selectedKey={selected} onSelectionChange={selectTab} items={sections.map(({ id, label }) => ({
      id,
      label: <span className={styles.label}><Image className={styles.icon} src={`/icons/projects/${id}.svg?v=original-colorful`} alt="" width={20} height={20} unoptimized/>{label}</span>,
      panel: id === "planning" ? <section aria-label="Planning sections" className={styles.planningTabs}>
        <Tabs selectedKey={selectedPlanning} onSelectionChange={selectPlanningTab} items={planningSections.map(({ id, label }) => ({
          id,
          label: <span className={styles.label}><Image className={styles.icon} src={`/icons/projects/${id}.svg`} alt="" width={18} height={18} unoptimized/>{label}</span>,
          panel: planningContext ? <ProjectPlanningPanel context={planningContext} section={id}/> : null,
        }))}/>
      </section> : null,
    }))}/>
  </DesignSystemProvider>;
}
