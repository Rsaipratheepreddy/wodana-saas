"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import s from "./workspace-readiness.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

/** Each setup check from real workspace records; null = could not be checked right now. */
export type ReadinessData = {
  company: boolean | null;
  regional: boolean | null;
  tax?: boolean | null;
  people: boolean | null;
  proposalKit?: boolean | null;
  connections: boolean | null;
};

/** The setup steps for this workspace's modules and how many are done; `readiness` unknown means nothing is done yet. */
export function useWorkspaceSetupSteps(readiness: ReadinessData | undefined, modules: string[]) {
  const t = useT();
  const steps = [
    { id: "company", label: t("Company details"), href: "/workspace/company", action: t("Review company"), done: readiness?.company },
    { id: "regional", label: t("Regional defaults"), href: "/workspace/company", action: t("Review defaults"), done: readiness?.regional },
    { id: "tax", label: t("Tax set up"), href: "/workspace/legal-entities", action: t("Set up tax"), done: readiness?.tax },
    { id: "people", label: t("People & roles"), href: "/workspace/members", action: t("Manage people"), done: readiness?.people },
    ...(modules.includes("pre-project") ? [{ id: "proposal-kit", label: t("Proposal kit"), href: "/workspace/settings/quotations", action: t("Open proposal kit"), done: readiness?.proposalKit }] : []),
    { id: "connections", label: t("Connect your tools"), href: "/workspace/integrations", action: t("View connections"), done: readiness?.connections },
  ];
  const completed = steps.filter((step) => step.done === true).length;
  return { steps, completed, total: steps.length };
}

/** The setup checklist with each step's link; whoever shows it (the account menu) names and counts it. */
export function WorkspaceSetupChecklist({ readiness, modules, onNavigate }: { readiness?: ReadinessData; modules: string[]; onNavigate?: () => void }) {
  const t = useT();
  const { steps } = useWorkspaceSetupSteps(readiness, modules);
  return <ul className={s.steps} aria-label={t("Setup tasks")}>{steps.map((step) => <li key={step.id} className={s.step} data-complete={step.done === true}>
    <span className={s.check} aria-hidden="true">{step.done === true ? <Check size={12} strokeWidth={3} /> : null}</span>
    <span className={s.label}>{step.label}{step.done === true ? <span className="wd-visually-hidden"> ({t("Done")})</span> : null}</span>
    {step.done !== true ? <Link className={s.action} href={step.href} onClick={onNavigate}>{step.action}<ArrowRight size={14} aria-hidden="true" /></Link> : null}
  </li>)}</ul>;
}
