"use client";

import { Eye, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DesignSystemProvider, ErrorState, Skeleton, SkeletonBlock } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { PortalError, portalApi, staffPortalApi, type PortalApi, type StaffPortalApi } from "@/lib/client-portal/client";
import type { PortalSite, PortalView } from "@/lib/client-portal/types";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import styles from "./client-view.module.css";
import { PortalFrame } from "./portal-frame";
import { PortalWorkspace } from "./portal-workspace";

type State = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; site: PortalSite; view: PortalView };

/** The client's portal as a read-only preview: it reads like the real thing, and every decision stays the client's. */
function previewApi(slug: string, t: Translate, view: () => Promise<PortalView>, staff: StaffPortalApi, caseId: string): PortalApi {
  const refuse = () => Promise.reject(new PortalError(t("This is a preview. Only the client can decide here."), 403));
  const client = portalApi(slug, t);
  // The client's own files open through the team's access (the preview has no client session).
  const file: PortalApi["file"] = (kind, id, preview = false) => (kind === "asset" ? staff.clientFile(caseId, id, preview) : client.file(kind, id, preview));
  return { ...client, view, file, challenge: refuse, login: refuse, command: refuse, logout: refuse, upload: refuse };
}

/**
 * Client view: a case's portal exactly as its client sees it (their projects, what's needed from them,
 * decisions, payments and documents in the tenant's brand), for the team to check and for Woddy's tours.
 * Nothing can be decided or sent from here.
 */
export function ClientView({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const t = useT();
  const staff = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const load = useCallback(async () => {
    try {
      const preview = await staff.preview(caseId);
      setState({ kind: "ready", site: preview.site, view: preview.view });
      return preview.view;
    } catch (cause) {
      setState((current) => (current.kind === "ready" ? current : { kind: "failed", message: (cause as Error).message }));
      throw cause;
    }
  }, [caseId, staff]);
  useEffect(() => { queueMicrotask(() => void load().catch(() => undefined)); }, [load]);
  const site = state.kind === "ready" ? state.site : null;
  const api = useMemo(() => (site ? previewApi(site.slug, t, load, staff, caseId) : null), [caseId, load, site, staff, t]);
  const close = <Link aria-label={t("Close client view")} className={styles.close} href={`/workspace/pre-projects/cases/${caseId}/overview`}><X aria-hidden="true" size={16} /></Link>;
  if (state.kind !== "ready" || !api) return <div className={styles.page}>
    <div className={styles.bar}><Eye aria-hidden="true" size={16} /><span className={styles.label}>{t("Client view")}</span>{close}</div>
    {state.kind === "failed"
      ? <ErrorState description={state.message} onRetry={() => { setState({ kind: "loading" }); void load().catch(() => undefined); }} />
      : <div aria-busy="true" aria-label={t("Loading")} className={styles.loading} role="status"><SkeletonBlock height={2} width={16} /><Skeleton lines={4} shape="rows" /></div>}
  </div>;
  const brand = workspacePrimaryColorStyle({ primaryColor: state.site.brand.primaryColor, secondaryColor: state.site.brand.secondaryColor, headingFont: state.site.brand.headingFont,
    bodyFont: state.site.brand.bodyFont });
  return <DesignSystemProvider locale={state.site.region.locale} currency={state.site.region.currency} timeZone={state.site.region.timeZone} portalContainer={container}
    style={brand} data-portal-root>
    <div className={styles.bar} data-tour="client-view-bar">
      <Eye aria-hidden="true" size={16} />
      <span className={styles.label}>{t("Client view")}</span>
      <span className={styles.client}>{state.view.contact.name}</span>
      {close}
    </div>
    <PortalFrame site={state.site}>
      <PortalWorkspace view={state.view} site={state.site} api={api} reload={async () => { await load().catch(() => undefined); }} />
    </PortalFrame>
    <div ref={setContainer} />
  </DesignSystemProvider>;
}
