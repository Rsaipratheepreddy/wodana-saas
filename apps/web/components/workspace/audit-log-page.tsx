"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  ControlledModalDialog,
  DataGrid,
  DesignSystemProvider,
  SearchInput,
  SelectField,
  formatDate,
  type DataGridColumn,
} from "@/design-system";
import type { AuditEvent, AuditLogPageData } from "@/lib/workspace/audit-log";
import styles from "./audit-log-page.module.css";

const DUBAI_FORMAT = { locale: "en-GB", timeZone: "Asia/Dubai" };

function humanize(value: string) {
  return value
    .replace(/\.v\d+$/i, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function actionLabel(action: string) {
  const words = action.replace(/\.v\d+$/i, "").split(".");
  const broadModules = new Set(["automation", "crm", "integration", "notification", "security", "workspace"]);
  return humanize(words.length > 1 && broadModules.has(words[0] ?? "") ? words.slice(1).join(" ") : action);
}

function timestamp(value: string) {
  return formatDate(value, DUBAI_FORMAT, { dateStyle: "medium", timeStyle: "short" });
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
    { id: "all", label: "All sources" },
    ...Array.from(new Set(items.map((item) => item.source))).sort().map((value) => ({ id: value, label: humanize(value) })),
  ], [items]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const minimum = period === "7d" ? loadedAt - 7 * 86_400_000 : period === "30d" ? loadedAt - 30 * 86_400_000 : 0;
    return items.filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (minimum && Date.parse(item.occurredAt) < minimum) return false;
      if (!normalized) return true;
      return `${item.action} ${item.entityType} ${item.entityId ?? ""} ${item.actorName ?? ""} ${item.actorEmail ?? ""} ${item.source} ${JSON.stringify(item.before)} ${JSON.stringify(item.after)}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [items, loadedAt, period, query, source]);
  const columns: DataGridColumn<AuditEvent>[] = [
    { id: "event", accessorFn: (item) => actionLabel(item.action), header: "Event", size: 230, meta: { primary: true } },
    { id: "actor", accessorFn: (item) => item.actorName ?? "System", header: "Actor", size: 215, cell: ({ row }) => <span className={styles.actor}><span>{row.original.actorName ?? "System"}</span>{row.original.actorEmail ? <small>{row.original.actorEmail}</small> : null}</span> },
    { id: "source", accessorFn: (item) => humanize(item.source), header: "Source", size: 115 },
    { id: "record", accessorFn: (item) => humanize(item.entityType), header: "Record", size: 165 },
    { id: "occurred", accessorFn: (item) => item.occurredAt, header: "Date & time", size: 195, cell: ({ row }) => <time dateTime={row.original.occurredAt}>{timestamp(row.original.occurredAt)}</time> },
    { id: "action", header: "Action", size: 90, enableSorting: false, cell: ({ row }) => <Button aria-label={`View ${actionLabel(row.original.action)} details`} onPress={() => setSelectedEvent(row.original)} size="compact" variant="quiet">{t("View")}</Button> },
  ];

  const exportAudit = () => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      ["Date and time", "Action", "Actor", "Email", "Source", "Record type", "Record ID", "Correlation ID"].map(quote).join(","),
      ...visibleItems.map((item) => [
        item.occurredAt,
        item.action,
        item.actorName ?? "System",
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
      if (!response.ok) throw new Error(await responseMessage(response, "More audit events could not be loaded."));
      const page = await response.json() as { items: AuditEvent[]; nextCursor: string | null };
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "More audit events could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label={t("Audit logs")} className={styles.page}>
      {!initialData.canView ? <Callout title={t("Audit log access is restricted")} tone="warning">{t("Ask a workspace owner or administrator for audit viewing permission.")}</Callout> : <>
        <section aria-label={t("Audit filters")} className={styles.filters}>
          <div className={styles.filterControls}>
            <div className={styles.searchField}><SearchInput label={t("Search audit log")} onChange={setQuery} placeholder={t("Search actions, people, or records…")} value={query} /></div>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label={t("Audit source")} items={sourceItems} label={<span className={styles.visuallyHidden}>{t("Source")}</span>} onSelectionChange={(key) => key && setSource(String(key))} selectedKey={source} />
            </div>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label={t("Audit period")} items={[{ id: "all", label: "All time" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }]} label={<span className={styles.visuallyHidden}>{t("Period")}</span>} onSelectionChange={(key) => key && setPeriod(String(key))} selectedKey={period} />
            </div>
            <Button isDisabled={!visibleItems.length} onPress={exportAudit}>{t("Export")}</Button>
          </div>
        </section>

        {failure ? <Callout title={t("Audit log could not be updated")} tone="danger">{failure}</Callout> : null}

        <DataGrid ariaLabel="Workspace audit log" appearance="flush" columns={columns} data={visibleItems} getRowId={(item) => item.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} hasMoreRows={Boolean(nextCursor)} footerActions={nextCursor ? <Button isLoading={loadingMore} onPress={() => void loadMore()} size="compact">{t("Load more")}</Button> : undefined} emptyTitle="No audit events found" emptyDescription="Try a different source, period, or search." />
      </>}
    </section>

    <AuditEventDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
  </DesignSystemProvider>;
}

function AuditEventDialog({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const t = useT();
  const fields = event ? changedFields(event) : [];
  return <ControlledModalDialog
    description={event ? `${humanize(event.entityType)} · ${event.entityId?.slice(0, 8) ?? "No record ID"}` : undefined}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Done")}</Button></div>}
    isOpen={Boolean(event)}
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={event ? actionLabel(event.action) : "Audit event"}
  >
    {event ? <div className={styles.eventDetails}>
      <dl>
        <div><dt>{t("Actor")}</dt><dd>{event.actorName ?? "Wodana system"}<small>{event.actorEmail}</small></dd></div>
        <div><dt>Date &amp; time</dt><dd>{timestamp(event.occurredAt)}</dd></div>
        <div><dt>{t("Source")}</dt><dd><Badge tone={sourceTone(event.source)}>{humanize(event.source)}</Badge></dd></div>
        <div><dt>{t("Correlation ID")}</dt><dd><code>{event.correlationId}</code></dd></div>
      </dl>
      <section className={styles.changedFields}><strong>{t("Changed fields")}</strong><div>{fields.length ? fields.map((field) => <Badge key={field}>{humanize(field)}</Badge>) : <span>{t("No field-level changes recorded.")}</span>}</div></section>
      <div className={styles.changeGrid}>
        <section><strong>{t("Before")}</strong><pre>{event.before ? JSON.stringify(event.before, null, 2) : "No previous value"}</pre></section>
        <section><strong>{t("After")}</strong><pre>{event.after ? JSON.stringify(event.after, null, 2) : "No resulting value"}</pre></section>
      </div>
    </div> : null}
  </ControlledModalDialog>;
}
