"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, DesignSystemProvider, EmptyState, ErrorState, InlineNotice, SelectField, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { ConsentRequestError, UNAVAILABLE_REASON, decideConsent, readConsentRequest, type ConsentRequest, type McpScope } from "@/lib/mcp/consent";
import styles from "./consent-screen.module.css";

type View = { kind: "loading" } | { kind: "error"; message: string; retry: boolean; returnTo?: string } | { kind: "ready"; request: ConsentRequest };

function Frame({ children }: { children: ReactNode }) {
  return <DesignSystemProvider className={styles.root}><main className={styles.page}><div className={styles.card}>{children}</div></main></DesignSystemProvider>;
}

/**
 * An AI app asks to connect: the person picks the workspace and whether it may prepare changes (which they
 * still confirm in Wodana), then allows or denies. Signed-out people sign in and come back here; a bad
 * request shows an error and never sends anyone anywhere.
 */
export function ConsentScreen({ query }: { query: string }) {
  const t = useT();
  const router = useRouter();
  const accessLabel = useId();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [write, setWrite] = useState(true);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [failure, setFailure] = useState("");

  const signIn = useCallback(() => router.replace(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`), [query, router]);
  const load = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const request = await readConsentRequest(query);
      setWorkspaceId((request.workspaces.find((workspace) => workspace.available) ?? request.workspaces[0])?.id ?? null);
      setView({ kind: "ready", request });
    } catch (cause) {
      const status = cause instanceof ConsentRequestError ? cause.status : 0;
      if (status === 401) { signIn(); return; }
      setView({
        kind: "error", message: cause instanceof Error ? translateKnown(t, cause.message) : t("This connection request isn't valid."),
        retry: status === 0 || status >= 500, returnTo: cause instanceof ConsentRequestError ? cause.redirectTo : undefined,
      });
    }
  }, [query, signIn, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (view.kind === "loading") return <Frame><Skeleton lines={5} shape="form" /></Frame>;
  if (view.kind === "error") return <Frame>{view.returnTo
    // The app can be told what went wrong: offered as a link, never followed on its own.
    ? <EmptyState action={<a className="wd-button" data-size="standard" data-variant="secondary" href={view.returnTo}>{t("Return to the app")}</a>}
      description={view.message} illustration="error" title={t("Something went wrong")} />
    : <ErrorState description={view.message} onRetry={view.retry ? () => void load() : undefined} />}</Frame>;

  const { request } = view;
  const selected = request.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const asksWrite = request.scopes.includes("write");
  const decide = async (decision: "allow" | "deny") => {
    if (busy || !selected || (decision === "allow" && !selected.available)) return;
    const scopes: McpScope[] = decision === "allow" && asksWrite && write ? ["read", "write"] : ["read"];
    setBusy(decision); setFailure("");
    try {
      // The page is leaving: the buttons stay off until the AI app opens.
      window.location.assign(await decideConsent({ query, workspaceId: selected.id, scopes, decision }));
    } catch (cause) {
      if (cause instanceof ConsentRequestError && cause.status === 401) { signIn(); return; }
      setFailure(cause instanceof Error ? translateKnown(t, cause.message) : t("The AI app could not be connected."));
      setBusy(null);
    }
  };
  const reason = (item: ConsentRequest["workspaces"][number]) => !item.available && item.reason ? t(UNAVAILABLE_REASON[item.reason]) : undefined;

  return <Frame>
    <header className={styles.header}>
      <h1 className={styles.title}>{t("Connect {app}", { app: request.client.name })}</h1>
      <p className={styles.host}>{t("Returns to {host}", { host: request.redirectHost })}</p>
    </header>
    <SelectField accent="neutral" label={t("Workspace")} isDisabled={Boolean(busy)}
      items={request.workspaces.map((item) => ({ id: item.id, label: item.name, description: reason(item) }))}
      disabledKeys={request.workspaces.filter((item) => !item.available).map((item) => item.id)}
      selectedKey={workspaceId} onSelectionChange={(key) => setWorkspaceId(key === null ? null : String(key))}
      description={selected ? reason(selected) : undefined} />
    <div aria-labelledby={accessLabel} className={styles.scopes} role="group">
      <span className="wd-field-label" id={accessLabel}>{t("Access")}</span>
      <Checkbox isDisabled isSelected>{t("Read your records")}</Checkbox>
      {asksWrite ? <Checkbox isDisabled={Boolean(busy)} isSelected={write} onChange={setWrite}>{t("Prepare changes you confirm")}</Checkbox> : null}
    </div>
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    <footer className={styles.actions}>
      <Button intent="write" isDisabled={Boolean(busy) || !selected} isLoading={busy === "deny"} onPress={() => void decide("deny")}>{t("Deny")}</Button>
      <Button isDisabled={Boolean(busy) || !selected?.available} isLoading={busy === "allow"} onPress={() => void decide("allow")} variant="primary">{t("Allow")}</Button>
    </footer>
  </Frame>;
}
