"use client";

import { useState, type ReactNode } from "react";
import { Callout, DesignSystemProvider } from "@/design-system";
import base from "./crm-screen-page.module.css";
import styles from "./crm-product.module.css";
import workspaceColors from "./crm-workspace-colors.module.css";
import { useWorkspaceFocus } from "@/components/workspace/workspace-focus";

export function CrmProductShell({ title, canView, actions, children, compact = false, useWorkspaceColors = false, headerClassName, pageClassName }: { title: string; description: string; canView: boolean; actions?: ReactNode; children: ReactNode; compact?: boolean; useWorkspaceColors?: boolean; headerClassName?: string; pageClassName?: string }) {
  useWorkspaceFocus(title === "Automations" ? title : undefined);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider className={[base.provider, useWorkspaceColors && workspaceColors.theme].filter(Boolean).join(" ")} portalContainer={portal} ref={setPortal}>
    <section className={[compact ? styles.focusedPage : base.page, pageClassName].filter(Boolean).join(" ")} aria-label={`${title} workspace`}>
      {!compact && canView && actions ? <header className={[base.pageHeading, headerClassName].filter(Boolean).join(" ")}><div className={styles.actions}>{actions}</div></header> : null}
      {canView ? children : <Callout title={`${title} access is restricted`} tone="warning">Ask an administrator for the required CRM permission.</Callout>}
    </section>
  </DesignSystemProvider>;
}

export function crmRecordLink(item: Record<string, unknown>) {
  const match = String(item.deepLink ?? "").match(/^\/crm\/(leads|opportunities|activities|conversations)\/([\da-f-]{36})$/i);
  if (match) {
    const destination = match[1] === "activities" ? "follow-ups" : match[1];
    return `/workspace/crm/${destination}?${match[1] === "leads" ? "lead" : "record"}=${match[2]}`;
  }
  return `/workspace/crm/${String(item.kind).includes("reply") ? "conversations" : String(item.kind).includes("lead") || item.kind === "sla_breach" ? "leads" : String(item.kind).includes("opportunity") ? "opportunities" : "follow-ups"}`;
}

export function crmTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Not scheduled";
}
