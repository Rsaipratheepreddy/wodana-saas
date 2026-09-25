"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Button, DesignSystemProvider, useDesignSystem } from "@/design-system";
import { loadProjectPlanning, type ProjectPlanningContext, type ProjectPlanningData, type ProjectPlanningSection } from "@/lib/projects/planning";
import styles from "./project-planning-panel.module.css";

const loading = () => <p role="status">Loading planning workspace…</p>;
const Requirements = dynamic(() => import("@/components/pre-project/brief-scope-page").then(module => module.BriefScopePage), { loading });
const Designs = dynamic(() => import("@/components/pre-project/designs-page").then(module => module.DesignsPage), { loading });
const Quotations = dynamic(() => import("@/components/commercial/commercial-page").then(module => module.CommercialPage), { loading });

export function ProjectPlanningPanel({ context, section }: { context: ProjectPlanningContext; section: ProjectPlanningSection }) {
  const design = useDesignSystem();
  const params = useSearchParams();
  const quoteId = params?.get("quote") ?? undefined;
  const [result, setResult] = useState<{ key: string; data?: ProjectPlanningData; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const key = `${context.workspaceId}:${context.caseId}:${section}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    void loadProjectPlanning(context, section, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Planning could not be loaded." });
    });
    return () => controller.abort();
  }, [context.workspaceId, context.caseId, section, key]);

  const current = result?.key === key ? result : undefined;
  const data = current?.data;
  return <DesignSystemProvider {...design} className={styles.panel} currency={data ? "commercial" in data ? data.commercial.currency : data.content.brief.currencyCode : design.currency}>
    {!current ? <p role="status">Loading {section === "design" ? "designs" : section.replaceAll("-", " ")}…</p> : current.error ? <div role="alert" className={styles.message}><p>{current.error}</p><Button size="compact" onPress={() => setAttempt(value => value + 1)}>Retry</Button></div> : data?.section === "requirements" ? <Requirements key={key} initialData={data.content} view="requirement" compact/> : data?.section === "design" ? <Designs key={key} initialData={data.content} initialDesigns={data.designs} options={data.options} preserveNavigation/> : data && "commercial" in data ? <Quotations key={`${key}:${quoteId??""}`} initial={data.commercial} record={data.record} section={data.section === "change-requests" ? "variations" : data.section === "agreement" ? "contracts" : data.section === "approvals" ? "approvals" : "quotations"} search="" quotationId={data.section === "quotations" ? quoteId : undefined} quotationPresentation="cards" embedded projectId={context.projectId}/> : null}
  </DesignSystemProvider>;
}
