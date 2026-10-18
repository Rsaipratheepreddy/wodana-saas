"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import type { ReactNode } from "react";
import { Badge } from "../components/status";

export type StageMetric = { label: string; value: string | number; tone?: "neutral" | "attention" | "danger" | "success" };

/**
 * Stage header: what this screen is for, the few numbers that matter and one
 * obvious primary action. Shared by project stages and pre-execution sections.
 */
export function StageHeader({ title, description, metrics = [], action, readOnly = false, children }: {
  title: string;
  description?: string;
  metrics?: StageMetric[];
  action?: ReactNode;
  readOnly?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return <section aria-label={t("{title} summary", { title })} className="wd-stage">
    <div className="wd-stage-copy">
      <div><h2>{title}{readOnly ? <Badge tone="neutral">{t("View only")}</Badge> : null}</h2>{description ? <p>{description}</p> : null}</div>
      {action ? <div className="wd-stage-action">{action}</div> : null}
    </div>
    {metrics.length ? <dl className="wd-stage-metrics">{metrics.map((metric) => <div data-tone={metric.tone} key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl> : null}
    {children}
  </section>;
}
