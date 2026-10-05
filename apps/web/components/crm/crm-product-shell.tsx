"use client";

import { useCallback, useState, type ReactNode } from "react";
import { DesignSystemProvider, NoAccessState, PageShell, useDesignSystem, type PageKind } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import base from "./crm-screen-page.module.css";
import styles from "./crm-product.module.css";
import workspaceColors from "./crm-workspace-colors.module.css";

/**
 * A Sales page on the shared anatomy (§5c D): PageShell with one title, at most one primary action top-end, tabs
 * under the title and an optional toolbar, then the page. `compact` fills the viewport (the board and the Inbox).
 */
export function CrmProductShell({ title, canView, actions, tabs, toolbar, children, compact = false, kind = "list", useWorkspaceColors = false }: {
  title: string; /** Ignored: a title carries no description (§5c D1). */ description?: string; canView: boolean; actions?: ReactNode; tabs?: ReactNode; toolbar?: ReactNode;
  children: ReactNode; compact?: boolean; kind?: PageKind; useWorkspaceColors?: boolean;
}) {
  const t = useT();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider className={[base.provider, useWorkspaceColors && workspaceColors.theme].filter(Boolean).join(" ")} portalContainer={portal} ref={setPortal}>
    <div className={compact ? styles.focusedPage : undefined}>
      <PageShell aria-label={t("{title} workspace", { title })} kind={kind} title={title} action={canView ? actions : undefined} tabs={canView ? tabs : undefined} toolbar={canView ? toolbar : undefined}>
        {canView ? children : <NoAccessState area={t(title as never)} />}
      </PageShell>
    </div>
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

/** A CRM date and time in the given locale and time zone; `empty` is shown when there is no date. */
export function crmTime(value: unknown, context: { locale?: string; timeZone?: string; empty?: string } = {}) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(context.locale, { timeZone: context.timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : context.empty ?? "Not scheduled";
}

/** `crmTime` in the workspace's locale and time zone, with the empty text in the person's language. */
export function useCrmTime() {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const empty = t("Not scheduled");
  return useCallback((value: unknown) => crmTime(value, { locale, timeZone, empty }), [locale, timeZone, empty]);
}
