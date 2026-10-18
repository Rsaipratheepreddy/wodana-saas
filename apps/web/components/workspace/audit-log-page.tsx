"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo, useState } from "react";
import { Badge, Button, Callout, ControlledModalDialog, DataGrid, DesignSystemProvider, SearchInput, SelectField, SettingsPage, formatDate, useDesignSystem, type DataGridColumn } from "@/design-system";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import type { AuditEvent, AuditLogPageData } from "@/lib/workspace/audit-log";
import styles from "./audit-log-page.module.css";

const SOURCE_LABELS: Record<string, MessageKey> = { user: tKey("User"), system: tKey("System"), integration: tKey("Integration"), automation: tKey("Automation") };

function humanize(value: string) {
  return value
    .replace(/\.v\d+$/i, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

/** Internal table and module names → the words the product uses for the same records. */
const PRODUCT_WORDS: Array<[RegExp, string]> = [
  [/\bpre project cases\b/g, "planning cases"], [/\bpre project case\b/g, "planning case"], [/\bpre projects?\b/g, "planning"],
  [/\bcrm leads\b/g, "enquiries"], [/\bcrm lead\b/g, "enquiry"], [/\bleads\b/g, "enquiries"], [/\blead\b/g, "enquiry"],
  [/\bcrm opportunit(y|ies)\b/g, "opportunit$1"], [/\bcrm parties\b/g, "customers"], [/\bcrm party\b/g, "customer"],
  [/\bworkspace invitations?\b/g, "invitation"], [/\bworkspace memberships?\b/g, "member"], [/\bworkspace members?\b/g, "member"],
  [/\bdelivery projects?\b/g, "project"], [/\bcommercial cases?\b/g, "deal"], [/\bview as sessions?\b/g, "view as"], [/\b(crm|hrms)\b/g, ""],
];

/** An event or record name in the product's words, in sentence case ("Planning case started", "Enquiry"). */
function productLabel(value: string) {
  let text = value.replace(/\.v\d+$/i, "").split(/[._-]+/).filter(Boolean).join(" ").toLowerCase();
  for (const [pattern, word] of PRODUCT_WORDS) text = text.replace(pattern, word);
  text = text.replace(/\s+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : humanize(value);
}

function actionLabel(action: string) {
  const words = action.replace(/\.v\d+$/i, "").split(".");
  const broadModules = new Set(["automation", "crm", "integration", "notification", "security", "workspace"]);
  return productLabel(words.length > 1 && broadModules.has(words[0] ?? "") ? words.slice(1).join(" ") : action);
}

function sourceLabel(source: string, t: Translate) {
  return SOURCE_LABELS[source] ? t(SOURCE_LABELS[source]) : humanize(source);
}

function timestamp(value: string, format: { locale: string; timeZone: string }) {
  return formatDate(value, format, { dateStyle: "medium", timeStyle: "short" });
}

function sourceTone(source: string) {
  if (source === "user") return "success" as const;
  if (source === "integration") return "info" as const;
  return "neutral" as const;
}

function changedFields(event: AuditEvent) {
  const keys = new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})]);
  return Array.from(keys).filter((key) => JSON.stringify(event.before?.[key]) !== JSON.stringify(event.after?.[key]));
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

export function AuditLogPage({ initialData }: { initialData: AuditLogPageData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const loadedAt = Date.parse(initialData.referenceTime);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [period, setPeriod] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState("");

  const sourceItems = useMemo(() => [
    { id: "all", label: t("All sources") },
    ...Array.from(new Set(items.map((item) => item.source))).sort().map((value) => ({ id: value, label: sourceLabel(value, t) })),
  ], [items, t]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const minimum = period === "7d" ? loadedAt - 7 * 86_400_000 : period === "30d" ? loadedAt - 30 * 86_400_000 : 0;
    return items.filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (minimum && Date.parse(item.occurredAt) < minimum) return false;
      if (!normalized) return true;
      // Found by the names shown (Leave decided, View as) as well as the stored codes.
      return `${actionLabel(item.action)} ${productLabel(item.entityType)} ${item.action} ${item.entityType} ${item.entityId ?? ""} ${item.actorName ?? ""} ${item.actorEmail ?? ""} ${item.source} ${JSON.stringify(item.before)} ${JSON.stringify(item.after)}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [items, loadedAt, period, query, source]);
  const columns: DataGridColumn<AuditEvent>[] = [
    { id: "event", accessorFn: (item) => actionLabel(item.action), header: t("Event"), size: 230, meta: { primary: true } },
    { id: "actor", accessorFn: (item) => item.actorName ?? t("System"), header: t("Actor"), size: 215, cell: ({ row }) => <span className={styles.actor}><span>{row.original.actorName ?? t("System")}</span>{row.original.actorEmail ? <small>{row.original.actorEmail}</small> : null}</span> },
    { id: "source", accessorFn: (item) => sourceLabel(item.source, t), header: t("Source"), size: 115 },
    { id: "record", accessorFn: (item) => productLabel(item.entityType), header: t("Record"), size: 165 },
    { id: "occurred", accessorFn: (item) => item.occurredAt, header: t("Date & time"), size: 195, cell: ({ row }) => <time dateTime={row.original.occurredAt}>{timestamp(row.original.occurredAt, { locale, timeZone })}</time> },
    { id: "action", header: t("Action"), size: 90, enableSorting: false, cell: ({ row }) => <Button aria-label={t("View {event} details", { event: actionLabel(row.original.action) })} onPress={() => setSelectedEvent(row.original)} size="compact" variant="quiet">{t("View")}</Button> },
  ];

  const exportAudit = () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      [t("Date and time"), t("Action"), t("Actor"), t("Email"), t("Source"), t("Record type"), t("Record ID"), t("Correlation ID")].map(quote).join(","),
      ...visibleItems.map((item) => [
        item.occurredAt,
        item.action,
        item.actorName ?? t("System"),
        item.actorEmail ?? "",
        item.source,
        item.entityType,
        item.entityId ?? "",
        item.correlationId,
      ].map(quote).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wodana-audit-log.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setFailure("");
    try {
      const params = new URLSearchParams({ workspaceId: initialData.workspaceId, cursor: nextCursor });
      const response = await fetch(`/api/workspace/audit-events?${params}`);
      if (!response.ok) throw new Error(await responseMessage(response, t("More audit events could not be loaded.")));
      const page = await response.json() as { items: AuditEvent[]; nextCursor: string | null };
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("More audit events could not be loaded."));
    } finally {
      setLoadingMore(false);
    }
  };

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <SettingsPage aria-label={t("Audit logs")} title={t("Audit history")} width="wide">
      {!initialData.canView ? <Callout title={t("Audit log access is restricted")} tone="warning">{t("Ask a workspace owner or administrator for audit viewing permission.")}</Callout> : <>
        <section aria-label={t("Audit filters")} className={styles.filters}>
          <div className={styles.filterControls}>
            <div className={styles.searchField}><SearchInput label={t("Search audit log")} onChange={setQuery} placeholder={t("Search actions, people, or records…")} value={query} /></div>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label={t("Audit source")} items={sourceItems} label={<span className={styles.visuallyHidden}>{t("Source")}</span>} onSelectionChange={(key) => key && setSource(String(key))} selectedKey={source} />
            </div>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label={t("Audit period")} items={[{ id: "all", label: t("All time") }, { id: "7d", label: t("Last 7 days") }, { id: "30d", label: t("Last 30 days") }]} label={<span className={styles.visuallyHidden}>{t("Period")}</span>} onSelectionChange={(key) => key && setPeriod(String(key))} selectedKey={period} />
            </div>
            <Button isDisabled={!visibleItems.length} onPress={exportAudit}>{t("Export")}</Button>
          </div>
        </section>

        {failure ? <Callout title={t("Audit log could not be updated")} tone="danger">{failure}</Callout> : null}

        <DataGrid ariaLabel={t("Workspace audit log")} columns={columns} data={visibleItems} getRowId={(item) => item.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} hasMoreRows={Boolean(nextCursor)} footerActions={nextCursor ? <Button isLoading={loadingMore} onPress={() => void loadMore()} size="compact">{t("Load more")}</Button> : undefined} emptyTitle={t("No audit events found")} emptyDescription={t("Try a different source, period, or search.")} />
      </>}
    </SettingsPage>

    <AuditEventDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
  </DesignSystemProvider>;
}

function AuditEventDialog({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const fields = event ? changedFields(event) : [];
  return <ControlledModalDialog
    description={event ? `${productLabel(event.entityType)} · ${event.entityId?.slice(0, 8) ?? t("No record ID")}` : undefined}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Done")}</Button></div>}
    isOpen={Boolean(event)}
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={event ? actionLabel(event.action) : t("Audit event")}
  >
    {event ? <div className={styles.eventDetails}>
      <dl>
        <div><dt>{t("Actor")}</dt><dd>{event.actorName ?? t("Wodana system")}<small>{event.actorEmail}</small></dd></div>
        <div><dt>{t("Date & time")}</dt><dd>{timestamp(event.occurredAt, { locale, timeZone })}</dd></div>
        <div><dt>{t("Source")}</dt><dd><Badge tone={sourceTone(event.source)}>{sourceLabel(event.source, t)}</Badge></dd></div>
        <div><dt>{t("Correlation ID")}</dt><dd><code>{event.correlationId}</code></dd></div>
      </dl>
      <section className={styles.changedFields}><strong>{t("Changed fields")}</strong><div>{fields.length ? fields.map((field) => <Badge key={field} hue="auto">{humanize(field)}</Badge>) : <span>{t("No field-level changes recorded.")}</span>}</div></section>
      <div className={styles.changeGrid}>
        <section><strong>{t("Before")}</strong><pre>{event.before ? JSON.stringify(event.before, null, 2) : t("No previous value")}</pre></section>
        <section><strong>{t("After")}</strong><pre>{event.after ? JSON.stringify(event.after, null, 2) : t("No resulting value")}</pre></section>
      </div>
    </div> : null}
  </ControlledModalDialog>;
}
