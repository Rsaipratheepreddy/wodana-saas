"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Plus, RefreshCw, Settings2 } from "lucide-react";
import { Badge, Button, Callout, DataGrid, InspectorSheet, type DataGridColumn } from "@/design-system";
import type { CrmRecord, CrmScreenPageData } from "@/lib/crm/screens";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { CrmCreateDialog, LinkedRecordWorkbench } from "./crm-record-workbench";
import { CrmProductShell } from "./crm-product-shell";
import { PipelineSettings } from "./pipeline-settings";
import styles from "./crm-opportunities.module.css";

type Pipeline = RecordData & { stages?: RecordData[] };
type OpportunityPage = { data?: CrmRecord[]; nextCursor?: string | null };

function dateLabel(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(value));
}

function moneyLabel(record: CrmRecord) {
  if (record.amount === null || record.amount === undefined) return "Not set";
  const amount = Number(record.amount);
  const currency = String(record.currencyCode ?? record.currency_code ?? "");
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return "Not set";
  return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function columnsFor(pipelines: Pipeline[]): DataGridColumn<CrmRecord>[] {
  const pipelineNames = [...new Set(pipelines.map((pipeline) => String(pipeline.name ?? "")).filter(Boolean))];
  const stageNames = [...new Set(pipelines.flatMap((pipeline) => (pipeline.stages ?? []).map((stage) => String(stage.name ?? ""))).filter(Boolean))];
  return [
    { accessorKey: "title", header: "Opportunity", size: 270, meta: { primary: true }, cell: ({ row }) => <span className={styles.identity}><strong>{String(row.original.title ?? "Untitled opportunity")}</strong><small>{String(row.original.partyName ?? "Customer not set")}</small></span> },
    { id: "pipeline", accessorFn: (record) => String(record.pipelineName ?? "Not set"), header: "Pipeline", size: 165, meta: { filterOptions: pipelineNames.map((name) => ({ id: name, label: name })) } },
    { id: "stage", accessorFn: (record) => String(record.stageName ?? record.stage_name ?? "Not set"), header: "Stage", size: 150, meta: { filterOptions: stageNames.map((name) => ({ id: name, label: name })) }, cell: ({ row }) => <span data-unplaced={!row.original.stageName && !row.original.stage_name || undefined} className={styles.stage}>{String(row.original.stageName ?? row.original.stage_name ?? "Not set")}</span> },
    { accessorKey: "status", header: "Status", size: 105, cell: ({ row }) => { const status = String(row.original.status ?? "unknown"); return <Badge tone={status === "won" ? "success" : status === "lost" || status === "abandoned" ? "danger" : "neutral"}>{status.replaceAll("_", " ")}</Badge>; } },
    { id: "value", accessorFn: (record) => Number(record.amount ?? 0), header: "Value", size: 150, meta: { align: "end" }, cell: ({ row }) => <span className={styles.money}>{moneyLabel(row.original)}</span> },
    { accessorKey: "ownerName", header: "Sales owner", size: 160, cell: ({ row }) => String(row.original.ownerName ?? "Unassigned") },
    { accessorKey: "nextActionAt", header: "Next action", size: 145, cell: ({ row }) => <span className={styles.due}><CalendarClock aria-hidden="true" size={13} />{dateLabel(row.original.nextActionAt)}</span> },
  ];
}

export function CrmOpportunities({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [pipelines, setPipelines] = useState<Pipeline[]>(() => rows(initialData.supporting.pipelines) as Pipeline[]);
  const [selectedRecord, setSelectedRecord] = useState<string | undefined>(initialRecordId);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [view, setView] = useState<"open" | "closed">("open");

  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "active");
  const visibleItems = useMemo(() => items.filter((item) => view === "open" ? item.status === "open" : item.status !== "open"), [items, view]);
  const columns = useMemo(() => columnsFor(pipelines), [pipelines]);
  const views = useMemo(() => ([
    { id: "open", label: `Open (${items.filter((item) => item.status === "open").length})` },
    { id: "closed", label: `Closed (${items.filter((item) => item.status !== "open").length})` },
  ]), [items]);

  const reload = async (more = false) => {
    if (busy || more && !nextCursor) return;
    setBusy(true); setFailure("");
    try {
      const [opportunities, nextPipelines] = await Promise.all([
        crmRequest<OpportunityPage>(initialData.workspaceId, `opportunities?limit=100${more ? `&cursor=${encodeURIComponent(nextCursor ?? "")}` : ""}`),
        crmRequest<unknown>(initialData.workspaceId, "pipelines"),
      ]);
      const incoming = rows(opportunities) as CrmRecord[];
      setItems((current) => more ? [...current, ...incoming.filter((record) => !current.some((item) => item.id === record.id))] : incoming);
      setNextCursor(opportunities.nextCursor ?? null);
      setPipelines(rows(nextPipelines) as Pipeline[]);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Opportunities could not be refreshed."); }
    finally { setBusy(false); }
  };

  if (settingsOpen) return <CrmProductShell title="Sales pipeline" description="" canView={initialData.canView} useWorkspaceColors actions={<Button size="compact" onPress={() => { setSettingsOpen(false); void reload(); }}>Back to opportunities</Button>}><PipelineSettings workspaceId={initialData.workspaceId} /></CrmProductShell>;

  return <CrmProductShell title="Opportunities" description="" canView={initialData.canView} useWorkspaceColors actions={<div className={styles.actions}>
    <Button size="compact" variant="quiet" onPress={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" size={14} />Pipeline</Button>
    <Button size="compact" isLoading={busy} onPress={() => void reload()}><RefreshCw aria-hidden="true" size={14} />Refresh</Button>
    <Button size="compact" variant="primary" isDisabled={!activePipelines.length} onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />Add opportunity</Button>
  </div>}>
    {failure ? <Callout title="Could not refresh opportunities" tone="warning">{failure}</Callout> : null}
    {!activePipelines.length ? <Callout title="Set up a sales pipeline" tone="warning">A pipeline is required to create or move opportunities. <Button size="compact" onPress={() => setSettingsOpen(true)}>Set up pipeline</Button></Callout> : null}
    <DataGrid
      ariaLabel="Opportunities"
      columns={columns}
      data={visibleItems}
      emptyTitle={view === "open" ? "No open opportunities" : "No closed opportunities"}
      emptyDescription="Qualified enquiries become opportunities when they are ready for a commercial decision."
      exportFileName="wodana-opportunities.csv"
      footerActions={nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>Load more opportunities</Button> : undefined}
      getRowId={(record) => record.id}
      hasMoreRows={Boolean(nextCursor)}
      onRowAction={(record) => setSelectedRecord(record.id)}
      pageSize={25}
      persistKey="crm-opportunities"
      rowNumbers={false}
      savedViews={views}
      searchLabel="Search opportunities"
      selectable={false}
      selectedView={view}
      onViewChange={(id) => setView(id as "open" | "closed")}
    />
    {creating ? <CrmCreateDialog id="opportunities" workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload(); }} /> : null}
    {selectedRecord ? <InspectorSheet isOpen title="Opportunity" size="md" onOpenChange={(open) => { if (!open) setSelectedRecord(undefined); }}><LinkedRecordWorkbench id="opportunities" workspaceId={initialData.workspaceId} recordId={selectedRecord} onChanged={reload} /></InspectorSheet> : null}
  </CrmProductShell>;
}
