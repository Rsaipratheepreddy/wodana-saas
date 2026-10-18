"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeliveryHealthMessage, DeliveryHealthMessagesQuery, DeliveryMessageStatus } from "@wodana/contracts";
import { Badge, Button, EmptyState, ErrorState, RecordTable, formatDate, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { remindersApi } from "@/lib/reminders/client";
import { DELIVERY_MESSAGE_STATUSES } from "@/lib/reminders/contract";
import { DELIVERY_STATUS_LOOK, REMINDER_CHANNEL_LABELS } from "@/lib/reminders/labels";
import { failureReason } from "@/lib/workspace/delivery-health";
import styles from "./delivery-health.module.css";

const CHANNELS = ["in_app", "push", "email", "whatsapp"] as const;
const PERIODS: Array<{ id: string; label: MessageKey; hours: number }> = [
  { id: "1d", label: tKey("Last 24 hours"), hours: 24 },
  { id: "7d", label: tKey("Last 7 days"), hours: 24 * 7 },
  { id: "30d", label: tKey("Last 30 days"), hours: 24 * 30 },
];
const PAGE = 50;

/** Why a message was held, suppressed or failed, in plain words (provider codes fall back to their own message). */
const REASONS: Record<string, MessageKey> = {
  quiet_hours: tKey("Quiet hours"),
  retrying: tKey("Retrying"),
  client_cap: tKey("One reminder a day to this client"),
  cap_reached: tKey("One reminder a day to this client"),
  client_window: tKey("Outside client hours"),
  consent_missing: tKey("No consent for this channel"),
  muted: tKey("Muted by the person"),
  unreachable: tKey("No way to reach them"),
  no_recipient: tKey("No one to tell"),
  disabled: tKey("Reminder turned off"),
  done: tKey("Already done"),
  snoozed: tKey("Snoozed"),
};
export function messageReason(t: Translate, reason: string | null) {
  if (!reason) return "";
  return REASONS[reason] ? t(REASONS[reason]) : failureReason(t, { at: "", code: reason, message: null });
}

type Filter = { status?: DeliveryMessageStatus; channel?: string; period?: string };

/**
 * Delivery health's messages (plan §6.24a): every notice with its channel, recipient, status and reason, attempts and
 * provider id, newest first; filtered by status, channel and period, with "Load more" and a CSV of the loaded rows.
 */
export function DeliveryMessages({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const api = useMemo(() => remindersApi(workspaceId), [workspaceId]);
  const [filter, setFilter] = useState<Filter>({});
  const [items, setItems] = useState<DeliveryHealthMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const query = useCallback((next?: string): DeliveryHealthMessagesQuery => {
    const hours = PERIODS.find((period) => period.id === filter.period)?.hours;
    return { status: filter.status, channel: filter.channel, from: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined, cursor: next, limit: PAGE };
  }, [filter]);
  const load = useCallback(async () => {
    try {
      const page = await api.healthMessages(query());
      setItems(Array.isArray(page?.items) ? page.items : []); setCursor(page?.nextCursor ?? null); setError("");
    } catch (cause) { setError(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Messages didn't load.")); }
  }, [api, query, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await api.healthMessages(query(cursor));
      setItems((current) => [...(current ?? []), ...(Array.isArray(page?.items) ? page.items : [])]); setCursor(page?.nextCursor ?? null);
    } catch (cause) { setError(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Messages didn't load.")); }
    finally { setMore(false); }
  };
  const change = (next: Filter) => { setFilter(next); setItems(null); setCursor(null); };

  const at = (value: string) => formatDate(value, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" });
  const status = (row: DeliveryHealthMessage) => t(DELIVERY_STATUS_LOOK[row.status]?.label ?? row.status as MessageKey);
  // Status, channel and period are filtered by the server (the toolbar's Filter), not per column.
  const columns: DataGridColumn<DeliveryHealthMessage>[] = ([
    { id: "time", header: t("Time"), size: 160, accessorFn: (row) => at(row.createdAt), meta: { renderCell: (row) => <time dateTime={row.createdAt}>{at(row.createdAt)}</time> } },
    { id: "channel", header: t("Channel"), size: 110, accessorFn: (row) => t(REMINDER_CHANNEL_LABELS[row.channel] ?? row.channel as MessageKey) },
    { id: "recipient", header: t("Recipient"), size: 180, accessorFn: (row) => row.recipient.label },
    { id: "event", header: t("Event"), size: 200, accessorFn: (row) => row.eventType, meta: { renderCell: (row) => <span className={styles.event}>
      <span dir="ltr">{row.eventType}</span>
      {row.critical ? <Badge tone="danger">{t("Critical")}</Badge> : null}
      {row.fallbackOf ? <Badge tone="info">{t("Fallback")}</Badge> : null}
    </span> } },
    { id: "status", header: t("Status"), size: 120, accessorFn: status, meta: { renderCell: (row) => <Badge tone={DELIVERY_STATUS_LOOK[row.status]?.tone ?? "neutral"}>{status(row)}</Badge> } },
    { id: "reason", header: t("Reason"), size: 200, accessorFn: (row) => messageReason(t, row.reason) },
    { id: "attempts", header: t("Attempts"), size: 90, accessorFn: (row) => row.attempts, meta: { align: "end" } },
    { id: "provider", header: t("Provider id"), size: 180, accessorFn: (row) => row.providerMessageId ?? "", meta: { renderCell: (row) => row.providerMessageId ? <code className={styles.provider} dir="ltr">{row.providerMessageId}</code> : null } },
  ] as DataGridColumn<DeliveryHealthMessage>[]).map((column) => ({ ...column, enableColumnFilter: false }));
  const filters = [
    { id: "status", label: t("Status"), value: filter.status, options: DELIVERY_MESSAGE_STATUSES.map((id) => ({ id, label: t(DELIVERY_STATUS_LOOK[id].label) })),
      onChange: (value: string | undefined) => change({ ...filter, status: value as DeliveryMessageStatus | undefined }) },
    { id: "channel", label: t("Channel"), value: filter.channel, options: CHANNELS.map((id) => ({ id, label: t(REMINDER_CHANNEL_LABELS[id]) })),
      onChange: (value: string | undefined) => change({ ...filter, channel: value }) },
    { id: "period", label: t("Period"), value: filter.period, options: PERIODS.map((period) => ({ id: period.id, label: t(period.label) })),
      onChange: (value: string | undefined) => change({ ...filter, period: value }) },
  ];

  if (error && !items) return <ErrorState title={t("Messages didn't load")} description={error} onRetry={() => { setError(""); void load(); }} />;
  return <RecordTable<DeliveryHealthMessage> ariaLabel={t("Messages")} columns={columns} data={items ?? []} getRowId={(row) => row.id} isLoading={!items}
    filters={filters} searchLabel={t("Search messages")} exportFileName="delivery-messages.csv" hasMoreRows={Boolean(cursor)}
    emptyContent={<EmptyState illustration={null} title={filter.status || filter.channel || filter.period ? t("No messages match") : t("No messages yet")} />}
    footerActions={cursor ? <Button size="compact" isLoading={more} onPress={() => void loadMore()}>{t("Load more")}</Button> : null}
    rowNumbers={false} selectable={false} wrapText />;
}
