"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  ControlledModalDialog,
  DesignSystemProvider,
  SelectField,
  formatDate,
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
    <section aria-label="Audit logs" className={styles.page}>
      {!initialData.canView ? <Callout title="Audit log access is restricted" tone="warning">Ask a workspace owner or administrator for audit viewing permission.</Callout> : <>
        <section aria-label="Audit filters" className={styles.filters}>
          <div className={styles.filterControls}>
            <label className={styles.searchField}>
              <input aria-label="Search audit log" onChange={(event) => setQuery(event.target.value)} placeholder="Search actions, people, or records…" type="search" value={query} />
            </label>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label="Audit source" items={sourceItems} label={<span className={styles.visuallyHidden}>Source</span>} onSelectionChange={(key) => key && setSource(String(key))} selectedKey={source} />
            </div>
            <div className={styles.selectField}>
              <SelectField accent="neutral" aria-label="Audit period" items={[{ id: "all", label: "All time" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }]} label={<span className={styles.visuallyHidden}>Period</span>} onSelectionChange={(key) => key && setPeriod(String(key))} selectedKey={period} />
            </div>
            <Button isDisabled={!visibleItems.length} onPress={exportAudit} size="compact">Export</Button>
          </div>
        </section>

        {failure ? <Callout title="Audit log could not be updated" tone="danger">{failure}</Callout> : null}

        <div aria-label="Audit logs table" className={styles.tableRegion} role="region" tabIndex={0}>
          <table data-record-table="" aria-label="Workspace audit log" className={styles.auditTable}>
            <colgroup><col className={styles.eventColumn} /><col className={styles.actorColumn} /><col className={styles.sourceColumn} /><col className={styles.recordColumn} /><col className={styles.dateColumn} /><col className={styles.actionColumn} /></colgroup>
            <thead><tr><th scope="col">Event</th><th scope="col">Actor</th><th scope="col">Source</th><th scope="col">Record</th><th scope="col">Date &amp; time</th><th scope="col"><span className={styles.visuallyHidden}>Actions</span></th></tr></thead>
            <tbody>{visibleItems.map((item) => <tr key={item.id}>
              <td>{actionLabel(item.action)}</td>
              <td><span className={styles.actor}><span>{item.actorName ?? "System"}</span>{item.actorEmail ? <small>{item.actorEmail}</small> : null}</span></td>
              <td>{humanize(item.source)}</td>
              <td>{humanize(item.entityType)}</td>
              <td><time dateTime={item.occurredAt}>{timestamp(item.occurredAt)}</time></td>
              <td><Button aria-label={`View ${actionLabel(item.action)} details`} onPress={() => setSelectedEvent(item)} size="compact" variant="quiet">View</Button></td>
            </tr>)}
            {!visibleItems.length ? <tr className={styles.emptyRow}><td colSpan={6}>No audit events found.</td></tr> : null}</tbody>
          </table>
        </div>

        <div className={styles.tableFooter}>
          <span>{visibleItems.length} event{visibleItems.length === 1 ? "" : "s"}</span>
          {nextCursor ? <Button isLoading={loadingMore} onPress={() => void loadMore()} size="compact">Load more</Button> : null}
        </div>
      </>}
    </section>

    <AuditEventDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
  </DesignSystemProvider>;
}

function AuditEventDialog({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const fields = event ? changedFields(event) : [];
  return <ControlledModalDialog
    description={event ? `${humanize(event.entityType)} · ${event.entityId?.slice(0, 8) ?? "No record ID"}` : undefined}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>Done</Button></div>}
    isOpen={Boolean(event)}
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={event ? actionLabel(event.action) : "Audit event"}
  >
    {event ? <div className={styles.eventDetails}>
      <dl>
        <div><dt>Actor</dt><dd>{event.actorName ?? "Wodana system"}<small>{event.actorEmail}</small></dd></div>
        <div><dt>Date &amp; time</dt><dd>{timestamp(event.occurredAt)}</dd></div>
        <div><dt>Source</dt><dd><Badge tone={sourceTone(event.source)}>{humanize(event.source)}</Badge></dd></div>
        <div><dt>Correlation ID</dt><dd><code>{event.correlationId}</code></dd></div>
      </dl>
      <section className={styles.changedFields}><strong>Changed fields</strong><div>{fields.length ? fields.map((field) => <Badge key={field}>{humanize(field)}</Badge>) : <span>No field-level changes recorded.</span>}</div></section>
      <div className={styles.changeGrid}>
        <section><strong>Before</strong><pre>{event.before ? JSON.stringify(event.before, null, 2) : "No previous value"}</pre></section>
        <section><strong>After</strong><pre>{event.after ? JSON.stringify(event.after, null, 2) : "No resulting value"}</pre></section>
      </div>
    </div> : null}
  </ControlledModalDialog>;
}
