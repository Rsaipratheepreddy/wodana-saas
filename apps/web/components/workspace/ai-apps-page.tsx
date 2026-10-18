"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import {
  Button, DataGrid, ErrorState, InlineNotice, NoAccessState, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch,
  formatDate, isNoAccessError, useDesignSystem, type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { AiAppsRequestError, aiAppsApi, type McpConnection, type McpOverview } from "@/lib/workspace/ai-apps";
import styles from "./ai-apps-page.module.css";

/** Where AI apps connect: the workspace's MCP endpoint on this host. */
const connectorUrl = () => (typeof window === "undefined" ? "" : `${window.location.origin}/api/v1/mcp`);

/**
 * Settings → Connections → AI apps: whether AI apps (Claude, ChatGPT and others, over MCP) may connect, the
 * address to give them, and every connected app. Each acts as the person who connected it; anything it
 * prepares waits for that person's OK. People revoke their own; owners and administrators revoke any.
 */
export function AiAppsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const api = useMemo(() => aiAppsApi(workspaceId), [workspaceId]);
  const [overview, setOverview] = useState<McpOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [noAccess, setNoAccess] = useState(false);
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<McpConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const load = useCallback(async () => {
    try { setOverview(await api.read()); setLoadError(""); }
    catch (cause) {
      setNoAccess(isNoAccessError(cause));
      setLoadError(cause instanceof Error ? translateKnown(t, cause.message) : t("AI apps didn't load."));
    }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  /** A refusal shows its message; a stale version (someone changed it meanwhile) also reloads. */
  const refused = useCallback(async (cause: unknown, fallback: string) => {
    setFailure(cause instanceof Error ? translateKnown(t, cause.message) : fallback);
    if (cause instanceof AiAppsRequestError && cause.status === 409) await load();
  }, [load, t]);
  const toggle = async (enabled: boolean) => {
    if (!overview || saving) return;
    setSaving(true); setFailure("");
    try { setOverview(await api.setEnabled(enabled, overview.version)); }
    catch (cause) { await refused(cause, t("AI apps could not be saved.")); }
    finally { setSaving(false); }
  };
  const revoke = async () => {
    if (!revoking || busy) return;
    setBusy(true); setFailure("");
    try { setOverview(await api.revoke(revoking)); }
    catch (cause) { await refused(cause, t("The AI app could not be revoked.")); }
    finally { setBusy(false); setRevoking(null); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connectorUrl());
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2_000);
    } catch { setFailure(t("Copy failed. Select and copy the link manually.")); }
  };

  const canManage = overview?.canManage ?? false;
  const at = useCallback((value: string) => formatDate(value, { locale, timeZone }, { dateStyle: "medium" }), [locale, timeZone]);
  const columns = useMemo<DataGridColumn<McpConnection>[]>(() => [
    { id: "app", header: t("App"), size: 200, accessorFn: (row) => row.clientName, meta: { primary: true } },
    ...(canManage ? [{ id: "person", header: t("Person"), size: 180, accessorFn: (row: McpConnection) => row.userName }] : []),
    { id: "access", header: t("Access"), size: 200, accessorFn: (row) => row.scopes.includes("write") ? t("Read and prepare changes") : t("Read") },
    { id: "connected", header: t("Connected"), size: 140, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => at(row.createdAt), mobileHidden: true } },
    { id: "last-used", header: t("Last used"), size: 140, accessorFn: (row) => row.lastUsedAt ?? "",
      meta: { renderCell: (row) => row.lastUsedAt ? at(row.lastUsedAt) : <span className={styles.muted}>{t("Not yet")}</span> } },
    { id: "actions", header: "", size: 120, enableSorting: false, accessorFn: () => "",
      meta: { align: "end", renderCell: (row) => row.mine || canManage
        ? <Button intent="write" isDisabled={busy} onPress={() => setRevoking(row)} size="compact">{t("Revoke")}</Button> : null } },
  ], [at, busy, canManage, t]);

  if (loadError && !overview) return noAccess ? <NoAccessState area={t("AI apps")} /> : <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!overview) return <Skeleton lines={6} shape="form" />;
  return <SettingsPage title={t("AI apps")} width="wide">
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    <SettingsSection id="general" title={t("General")}>
      <SettingsRow label={t("AI apps can connect")} hint={overview.aiEnabled ? undefined : t("Turn on AI assistance first.")}>
        <Switch aria-label={t("AI apps can connect")} isDisabled={!overview.canManage || !overview.aiEnabled || saving} isSelected={overview.enabled} onChange={(value) => void toggle(value)} />
      </SettingsRow>
      <SettingsRow label={t("Connector URL")}>
        <span className={styles.connector}>
          <code className={styles.url} dir="ltr">{connectorUrl()}</code>
          <Button onPress={() => void copy()} size="compact" variant="quiet"><Copy aria-hidden="true" size={14} />{copied ? t("Copied") : t("Copy")}</Button>
        </span>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="connected-apps" title={t("Connected apps")}>
      <DataGrid ariaLabel={t("Connected apps")} columns={columns} data={overview.connections} getRowId={(row) => row.id}
        emptyTitle={t("No AI apps connected")} pageSize={25} pinFirstColumn={false} rowNumbers={false} selectable={false} showToolbar={false} wrapText />
    </SettingsSection>
    {revoking ? <FormDialog title={t("Revoke {app}?", { app: revoking.clientName })} onClose={() => { setRevoking(null); }} isSubmitting={busy} submitVariant="danger" submitLabel={t("Revoke")} onSubmit={() => revoke()}>
      <p className={styles.dialogText}>{t("{app} loses access to this workspace.", { app: revoking.clientName })}</p>
    </FormDialog> : null}
  </SettingsPage>;
}
