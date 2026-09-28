"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, DataGrid, InlineNotice, SelectField, SettingsSection, Skeleton, Switch, type DataGridColumn } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CLIENT_EVENT_LABELS, type ClientMessageRow, type InboxTemplate } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./inbox-parts.module.css";

/**
 * Settings → Inbox → Client messages: which business events message the client on WhatsApp, with which of the
 * firm's templates. An event without an approved template goes by email where it has one, else not at all.
 */
export function ClientMessagesSection({ workspaceId, canManage, templates }: { workspaceId: string; canManage: boolean; templates: InboxTemplate[] }) {
  const t = useT();
  const [data, setData] = useState<{ connected: boolean; events: ClientMessageRow[] } | null>(null);
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => crmRequest<{ connected: boolean; events: ClientMessageRow[] }>(workspaceId, "inbox/client-messages").then(setData).catch((error: Error) => setFailure(error.message)), [workspaceId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const save = async (row: ClientMessageRow, change: { enabled?: boolean; templateCode?: string | null }) => {
    setSaving(row.event); setFailure("");
    try { await crmRequest(workspaceId, `inbox/client-messages/${row.event}`, "PUT", { version: row.version, ...change }); await load(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The client message could not be saved.")); }
    finally { setSaving(null); }
  };
  const codes = [...new Set(templates.map((template) => template.code))].sort();
  const columns: DataGridColumn<ClientMessageRow>[] = [
    { accessorKey: "event", header: t("Message"), size: 240, cell: ({ row: { original } }) => <span className={styles.name}><strong>{t(CLIENT_EVENT_LABELS[original.event] ?? "Client message")}</strong>{original.template ? <small dir="auto">{original.template.body}</small> : null}</span> },
    { accessorKey: "templateCode", header: t("Template"), size: 220, enableSorting: false, cell: ({ row: { original } }) => canManage
      ? <SelectField aria-label={t("Template")} label={null} isDisabled={saving === original.event} placeholder={t("Choose a template")}
        items={codes.map((code) => ({ id: code, label: code }))} selectedKey={original.templateCode} onSelectionChange={(key) => key && key !== original.templateCode && void save(original, { templateCode: String(key) })} />
      : original.templateCode ?? "" },
    { accessorKey: "channel", header: t("Sends by"), size: 190, cell: ({ row: { original } }) => <span className={styles.name}>
      {original.channel === "whatsapp" ? <Badge tone="success">WhatsApp</Badge> : original.channel === "email" ? <Badge tone="neutral">{t("Email")}</Badge> : <Badge tone="neutral">{t("Not sent")}</Badge>}
      {original.enabled && original.channel !== "whatsapp" ? <small>{!data?.connected ? t("WhatsApp isn't connected") : !original.template ? t("No template yet") : original.template.providerStatus === "rejected" ? t("Template rejected by Meta") : original.template.providerStatus === "paused" ? t("Template paused by Meta") : t("Waiting for Meta approval")}</small> : null}
    </span> },
    { accessorKey: "enabled", header: t("On"), size: 90, enableSorting: false, cell: ({ row: { original } }) => <Switch aria-label={t(CLIENT_EVENT_LABELS[original.event] ?? "Client message")} isDisabled={!canManage || saving === original.event} isSelected={original.enabled} onChange={(value) => void save(original, { enabled: value })} /> },
  ];
  return <SettingsSection id="inbox-client-messages" title={t("Client messages")}>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {!data && !failure ? <Skeleton lines={4} shape="rows" /> : null}
    {data ? <div data-sales-grid><DataGrid ariaLabel={t("Client messages")} columns={columns} data={data.events} getRowId={(row) => row.event} rowNumbers={false} selectable={false} showToolbar={false}
      emptyTitle={t("No client messages")} emptyDescription={t("Connect WhatsApp first.")} /></div> : null}
  </SettingsSection>;
}
