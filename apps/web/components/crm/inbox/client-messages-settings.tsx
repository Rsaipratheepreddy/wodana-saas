"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, DataGrid, FormDialog, InlineNotice, SelectField, SettingsSection, Skeleton, Switch, TextInput, type DataGridColumn } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CLIENT_EVENT_LABELS, FOLLOW_UP_EVENTS, type ClientMessageRow, type FollowUpTiming, type InboxTemplate } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { reminderHref } from "@/lib/reminders/contract";
import styles from "./inbox-parts.module.css";

/**
 * Settings → Inbox → Client messages: which business events message the client on WhatsApp, with which of the
 * firm's templates. An event without an approved template goes by email where it has one, else not at all.
 */
export function ClientMessagesSection({ workspaceId, canManage, templates }: { workspaceId: string; canManage: boolean; templates: InboxTemplate[] }) {
  const t = useT();
  const [data, setData] = useState<{ connected: boolean; events: ClientMessageRow[]; timing?: FollowUpTiming } | null>(null);
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [timing, setTiming] = useState(false);
  const load = useCallback(() => crmRequest<{ connected: boolean; events: ClientMessageRow[]; timing?: FollowUpTiming }>(workspaceId, "inbox/client-messages").then(setData).catch((error: Error) => setFailure(error.message)), [workspaceId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const save = async (row: ClientMessageRow, change: { enabled?: boolean; templateCode?: string | null }) => {
    setSaving(row.event); setFailure("");
    try { await crmRequest(workspaceId, `inbox/client-messages/${row.event}`, "PUT", { version: row.version, ...change }); await load(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The client message could not be saved.")); }
    finally { setSaving(null); }
  };
  const codes = [...new Set(templates.map((template) => template.code))].sort();
  const columns: DataGridColumn<ClientMessageRow>[] = [
    { accessorKey: "event", header: t("Message"), size: 240, cell: ({ row: { original } }) => <span className={styles.name}><strong>{t(CLIENT_EVENT_LABELS[original.event] ?? "Client message")}</strong>{original.template ? <small dir="auto">{original.template.body}</small> : null}
      {/* When payment reminders go is the payment.due reminder rule (Settings › Reminders). */}
      {original.event === "payments.reminder" ? <Link className={styles.scheduleLink} href={reminderHref.settings("payment.due")}>{t("Schedule")}</Link> : null}
      {FOLLOW_UP_EVENTS.has(original.event) && data?.timing ? <Button size="compact" variant="quiet" onPress={() => setTiming(true)}>{original.event === "project.handover_thanks" ? t("Review link") : t("Timing")}</Button> : null}</span> },
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
    {timing && data?.timing ? <FollowUpTimingDialog workspaceId={workspaceId} canManage={canManage} timing={data.timing} onClose={() => setTiming(false)} onSaved={() => { setTiming(false); void load(); }} /> : null}
  </SettingsSection>;
}

const DAY_CHOICES = [1, 2, 3, 4, 5, 7, 10, 14];

/**
 * When the follow-ups go: a quiet enquiry's nudge (and an optional, later second one) after our last message, the
 * quotation follow-up after it was issued, and the review link the handover thank-you carries (left out when empty).
 */
function FollowUpTimingDialog({ workspaceId, canManage, timing, onClose, onSaved }: { workspaceId: string; canManage: boolean; timing: FollowUpTiming; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState({ quietDays: timing.quietDays, quietSecondDays: timing.quietSecondDays, quoteDays: timing.quoteDays, reviewUrl: timing.reviewUrl ?? "" });
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const days = (count: number) => t("{count} days", { count });
  const seconds = [...new Set([...DAY_CHOICES, 21, 30].filter((count) => count > draft.quietDays))];
  const save = async () => {
    const reviewUrl = draft.reviewUrl.trim();
    if (reviewUrl && !/^https:\/\/\S{3,}$/.test(reviewUrl)) { setError(t("Use a full https:// link")); return; }
    setSaving(true); setError("");
    try {
      await crmRequest(workspaceId, "inbox/follow-ups", "PUT", { version: timing.version, quietDays: draft.quietDays, quietSecondDays: draft.quietSecondDays && draft.quietSecondDays > draft.quietDays ? draft.quietSecondDays : null, quoteDays: draft.quoteDays, reviewUrl: reviewUrl || null });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("The timing could not be saved.")); }
    finally { setSaving(false); }
  };
  return <FormDialog title={t("Follow-up timing")} onClose={onClose} error={error || undefined} isSubmitting={saving} hideSubmit={!canManage} cancelLabel={canManage ? undefined : t("Close")}
    submitLabel={t("Save timing")} onSubmit={() => save()}>
    <div className={styles.fields}>
      <SelectField label={t("Quiet enquiry: first follow-up after")} isDisabled={!canManage} items={DAY_CHOICES.map((count) => ({ id: String(count), label: days(count) }))} selectedKey={String(draft.quietDays)}
        onSelectionChange={(key) => key && setDraft((current) => ({ ...current, quietDays: Number(key) }))} />
      <SelectField label={t("Second follow-up")} isDisabled={!canManage} items={[{ id: "", label: t("No second follow-up") }, ...seconds.map((count) => ({ id: String(count), label: t("{count} days after the first", { count }) }))]}
        selectedKey={draft.quietSecondDays && draft.quietSecondDays > draft.quietDays ? String(draft.quietSecondDays) : ""} onSelectionChange={(key) => setDraft((current) => ({ ...current, quietSecondDays: key ? Number(key) : null }))} />
      <SelectField label={t("Quotation follow-up after")} isDisabled={!canManage} items={DAY_CHOICES.map((count) => ({ id: String(count), label: days(count) }))} selectedKey={String(draft.quoteDays)}
        onSelectionChange={(key) => key && setDraft((current) => ({ ...current, quoteDays: Number(key) }))} />
      <TextInput label={t("Review link")} inputType="url" maxLength={500} isDisabled={!canManage} value={draft.reviewUrl} placeholder="https://" onChange={(value) => setDraft((current) => ({ ...current, reviewUrl: value }))} />
    </div>
  </FormDialog>;
}
