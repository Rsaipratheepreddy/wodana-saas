"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, Badge, StageTracker, type WorkflowStage } from "@/design-system";
import { caseHref, PRE_PROJECT_ROOT, type PreProjectCase } from "@/lib/pre-project/types";
import styles from "./case-spine.module.css";

export const casePhases = ["discover", "define", "design", "price", "agree", "release"] as const;
export type CasePhase = (typeof casePhases)[number];

/** One label per phase, reused by the list, the spine and the overview. */
export const casePhaseLabel: Record<CasePhase, string> = {
  discover: "Discover",
  define: "Define",
  design: "Design",
  price: "Price",
  agree: "Agree",
  release: "Release",
};

/** The section that owns each phase; the tracker links there. */
const phaseSection: Record<CasePhase, string> = {
  discover: "requirements",
  define: "definition",
  design: "designs",
  price: "quotations",
  agree: "contracts",
  release: "execution-release",
};

const sectionPhase: Record<string, CasePhase> = {
  overview: "discover",
  requirements: "discover",
  measurements: "discover",
  inspiration: "discover",
  "site-layouts": "discover",
  site: "discover",
  definition: "define",
  designs: "design",
  boq: "price",
  quotations: "price",
  contracts: "agree",
  "payment-plan": "agree",
  variations: "agree",
  approvals: "release",
  "execution-release": "release",
  "client-portal": "release",
};

export function caseStatusLabel(status: PreProjectCase["status"] | "qualified" | undefined) {
  if (!status) return "Draft";
  if (status === "active") return "In progress";
  if (status === "on_hold") return "On hold";
  return status[0].toUpperCase() + status.slice(1);
}

export function caseStatusTone(status: PreProjectCase["status"] | "qualified" | undefined): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "released" || status === "qualified") return "success";
  if (status === "on_hold") return "warning";
  if (status === "cancelled") return "danger";
  if (status === "active") return "info";
  return "neutral";
}

export function riskTone(risk: PreProjectCase["riskLevel"] | undefined): "neutral" | "success" | "warning" | "danger" {
  if (risk === "critical" || risk === "high") return "danger";
  if (risk === "medium") return "warning";
  if (risk === "low") return "success";
  return "neutral";
}

export function casePhaseStages(record: Partial<Pick<PreProjectCase, "phase" | "status">>, viewing?: string): WorkflowStage[] {
  const current = Math.max(0, casePhases.indexOf(record.phase ?? "discover"));
  const viewed = viewing ? sectionPhase[viewing] : undefined;
  return casePhases.map((phase, index) => {
    const released = record.status === "released";
    const state: WorkflowStage["state"] = released || index < current
      ? "complete"
      : index === current
        ? record.status === "on_hold" || record.status === "cancelled" ? "blocked" : "current"
        : "upcoming";
    return { id: phase, label: viewed === phase && phase !== record.phase ? `${casePhaseLabel[phase]} · viewing` : casePhaseLabel[phase], state };
  });
}

/**
 * The case spine sits at the top of every pre-execution section. It answers
 * "which client, which job, where in the journey" once, so section screens
 * only render their own work.
 */
export function CaseSpine({ record, section, search = "", compact = false }: {
  record: PreProjectCase;
  section: string;
  search?: string;
  compact?: boolean;
}) {
  const query = new URLSearchParams(search);
  const backHref = "/workspace/projects";
  const risk = record.riskLevel ?? "none";
  const owner = record.engagementOwnerName ?? record.leadManagerName ?? "";
  return <header aria-label="Case journey" className={styles.spine} data-compact="true">
    <div className={styles.identityRow}>
      <Link aria-label="All projects" className={styles.back} href={backHref}><ArrowLeft aria-hidden="true" data-directional="true" size={15} /><span>All projects</span></Link>
      <div className={styles.identity}>
        <Avatar name={record.customerName} size={compact ? "sm" : "lg"} />
        <div>
          <span className={styles.customer}>{record.customerName}</span>
          <h1 className={styles.title}>{record.title}</h1>
        </div>
        <span className={styles.badges}>
          <Badge tone={caseStatusTone(record.status)}>{caseStatusLabel(record.status)}</Badge>
          {risk === "high" || risk === "critical" ? <Badge tone={riskTone(risk)}>{risk === "critical" ? "Critical risk" : "High risk"}</Badge> : null}
        </span>
      </div>
      {owner ? <span className={styles.owner}>{owner}</span> : null}
    </div>
  </header>;
}
