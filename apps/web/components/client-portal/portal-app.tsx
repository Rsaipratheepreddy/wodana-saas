"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DesignSystemProvider, ErrorState, InlineNotice, Skeleton, SkeletonBlock } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { PortalError, portalApi } from "@/lib/client-portal/client";
import type { PortalSite, PortalView } from "@/lib/client-portal/types";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { ConfirmName } from "./confirm-name";
import { PortalFrame } from "./portal-frame";
import { PortalWorkspace } from "./portal-workspace";
import styles from "./portal.module.css";
import { SignIn } from "./sign-in";
import { useDeviceTheme } from "./use-device-theme";

type State = { kind: "loading" } | { kind: "signed-out"; message?: string } | { kind: "failed"; message: string } | { kind: "ready"; view: PortalView };

/** The shape of the portal while it opens: a title, the section tabs and a few rows. */
function PortalSkeleton() {
  const t = useT();
  return <div aria-busy="true" aria-label={t("Loading")} className={styles.skeleton} role="status">
    <SkeletonBlock height={2} width={16} />
    <SkeletonBlock height={1} width={10} />
    <Skeleton lines={4} shape="rows" />
  </div>;
}

/**
 * The client portal: the tenant's brand (colours and fonts through the design tokens), light or dark like
 * the client's device, their language and direction. Signed out, it asks for a mobile number; signed in,
 * it shows the client's projects.
 */
export function PortalApp({ site }: { site: PortalSite }) {
  const t = useT();
  const theme = useDeviceTheme();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const api = useMemo(() => portalApi(site.slug, t), [site.slug, t]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    try { setState({ kind: "ready", view: await api.view() }); }
    catch (cause) {
      const failure = cause as PortalError;
      if (failure.status === 401) setState({ kind: "signed-out" });
      else if (failure.status === 403) setState({ kind: "signed-out", message: failure.message });
      else setState((current) => (current.kind === "ready" ? current : { kind: "failed", message: failure.message }));
    }
  }, [api]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Back on the page after a while: show what changed.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && state.kind === "ready") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, state.kind]);
  const signOut = async () => { await api.logout().catch(() => null); setState({ kind: "signed-out" }); };
  const style = workspacePrimaryColorStyle({ primaryColor: site.brand.primaryColor, secondaryColor: site.brand.secondaryColor, headingFont: site.brand.headingFont,
    bodyFont: site.brand.bodyFont });
  return <DesignSystemProvider theme={theme} locale={site.region.locale} currency={site.region.currency} timeZone={site.region.timeZone} portalContainer={container}
    style={style} data-portal-root>
    <PortalFrame site={site} onSignOut={state.kind === "ready" ? () => void signOut() : undefined}>
      {state.kind === "loading" ? <PortalSkeleton /> : null}
      {state.kind === "failed" ? <ErrorState description={state.message} onRetry={() => { setState({ kind: "loading" }); void load(); }} /> : null}
      {state.kind === "signed-out" ? <>
        {state.message ? <InlineNotice tone="info" message={state.message} /> : null}
        <SignIn site={site} api={api} onSignedIn={() => { setState({ kind: "loading" }); void load(); }} />
      </> : null}
      {state.kind === "ready" && !state.view.contact.nameConfirmed
        ? <ConfirmName api={api} name={state.view.contact.name} onDone={() => void load()} /> : null}
      {state.kind === "ready" && state.view.contact.nameConfirmed ? <PortalWorkspace view={state.view} site={site} api={api} reload={load} /> : null}
    </PortalFrame>
    <div ref={setContainer} />
  </DesignSystemProvider>;
}
