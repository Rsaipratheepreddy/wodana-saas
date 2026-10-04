"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, RefreshCw, Columns3, List } from "lucide-react";
import { Avatar, Badge, Button, Callout, DataGrid, ControlledModalDialog, FormDialog, personDisplayName, SearchInput, SelectField, TextAreaField, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import type { CrmRecord, CrmScreenPageData } from "@/lib/crm/screens";
import { crmRequest, rows, type MissingRequirement, type RecordData } from "@/lib/crm/client";
import { missingFrom, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { nowPlan, type FunnelStep, type NowStep } from "@/lib/crm/now-step";
import { PaymentProofDialog, StageBlockedSheet } from "./opportunity-flow";
import { DueChip, useStepText } from "./opportunity-now";
import { LinkedRecordWorkbench } from "./crm-record-workbench";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-opportunities.module.css";

type Pipeline = RecordData & { stages?: RecordData[] };
type OpportunityPage = { data?: CrmRecord[]; nextCursor?: string | null };
type BoardStage = { id: string; pipelineId: string; name: string; code: string; pipelineName: string; canCreate: boolean };

function opportunityReference(record: CrmRecord) {
  const reference = String(record.reference ?? "").trim();
  const title = String(record.title ?? "").trim();
  return reference || (/^[A-Z]{1,4}-\d{3,}$/i.test(title) ? title : "");
}

function opportunityTitle(record: CrmRecord, t: Translate) {
  const title = String(record.title ?? "").trim();
  const reference = opportunityReference(record);
  return title && title !== reference ? title : String(record.partyName || reference || t("Opportunity"));
}

function dateLabel(value: unknown, locale: string, timeZone: string, t: Translate) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return t("Not scheduled");
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(value));
}

/** The opportunity value in the record's currency, or null when it has none. */
function moneyLabel(record: CrmRecord, locale: string) {
  if (record.amount === null || record.amount === undefined) return null;
  const amount = Number(record.amount);
  const currency = String(record.currencyCode ?? record.currency_code ?? "");
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return null;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function columnsFor(pipelines: Pipeline[], t: Translate, locale: string, timeZone: string): DataGridColumn<CrmRecord>[] {
  const pipelineNames = [...new Set(pipelines.map((pipeline) => String(pipeline.name ?? "")).filter(Boolean))];
  const stageNames = [...new Set(pipelines.flatMap((pipeline) => (pipeline.stages ?? []).map((stage) => String(stage.name ?? ""))).filter(Boolean))];
  return [
    { accessorKey: "reference", header: t("Opportunity ID"), size: 135, cell: ({ row }) => String(row.original.reference ?? "—") },
    { accessorKey: "title", header: t("Opportunity"), size: 270, meta: { primary: true }, cell: ({ row }) => <span className={styles.identity}><strong>{String(row.original.title ?? t("Untitled opportunity"))}</strong><small>{String(row.original.partyName ?? t("Customer not set"))}</small></span> },
    { id: "pipeline", accessorFn: (record) => String(record.pipelineName ?? t("Not set")), header: t("Pipeline"), size: 165, meta: { filterOptions: pipelineNames.map((name) => ({ id: name, label: name })) } },
    { id: "stage", accessorFn: (record) => String(record.stageName ?? record.stage_name ?? t("Not set")), header: t("Stage"), size: 150, meta: { filterOptions: stageNames.map((name) => ({ id: name, label: name })) }, cell: ({ row }) => <span data-unplaced={!row.original.stageName && !row.original.stage_name || undefined} className={styles.stage}>{String(row.original.stageName ?? row.original.stage_name ?? t("Not set"))}</span> },
    { accessorKey: "status", header: t("Status"), size: 105, cell: ({ row }) => { const status = String(row.original.status ?? "unknown"); return <Badge tone={status === "won" ? "success" : status === "lost" || status === "abandoned" ? "danger" : "neutral"}>{status.replaceAll("_", " ")}</Badge>; } },
    { id: "value", accessorFn: (record) => Number(record.amount ?? 0), header: t("Value"), size: 150, meta: { align: "end" }, cell: ({ row }) => <span className={styles.money}>{moneyLabel(row.original, locale) ?? t("Not set")}</span> },
    { accessorKey: "ownerName", header: t("Sales owner"), size: 160, cell: ({ row }) => personDisplayName(row.original.ownerName as string | null) || t("Unassigned") },
    { accessorKey: "nextActionAt", header: t("Next follow-up"), size: 145, cell: ({ row }) => <span className={styles.due}><CalendarClock aria-hidden="true" size={13} />{dateLabel(row.original.nextActionAt, locale, timeZone, t)}</span> },
  ];
}

export function CrmOpportunities({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [pipelines, setPipelines] = useState<Pipeline[]>(() => rows(initialData.supporting.pipelines) as Pipeline[]);
  const [selectedRecord, setSelectedRecord] = useState<string | undefined>(initialRecordId);
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const moveLock = useRef(false);
  const [moveNotice, setMoveNotice] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<{ recordId: string; stageId: string; status: "won" | "lost" } | null>(null);
  const [outcomeReason, setOutcomeReason] = useState("");
  // PLM-121/122: a refused move shows what the column needs; Won asks for the payment proof.
  const [blocked, setBlocked] = useState<{ recordId: string; stage: string; items: MissingRequirement[] } | null>(null);
  const [proofFor, setProofFor] = useState<string | null>(null);
  // S-5: the board refreshes itself while on screen; a card being moved or decided is left alone.
  const quiet = useRef(false);
  useEffect(() => { quiet.current = busy || Boolean(moving || dragged || pendingOutcome || blocked || proofFor); });
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible" || quiet.current || moveLock.current) return;
      crmRequest<OpportunityPage>(initialData.workspaceId, "opportunities?limit=100").then((page) => {
        if (quiet.current || moveLock.current) return;
        const fresh = rows(page) as CrmRecord[];
        const byId = new Map(fresh.map((record) => [record.id, record]));
        setItems((current) => [...fresh.filter((record) => !current.some((item) => item.id === record.id)), ...current.map((record) => byId.get(record.id) ?? record)]);
      }).catch(() => { /* the next pass tries again */ });
    };
    const timer = window.setInterval(poll, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [initialData.workspaceId]);
  // Each open card shows its step now, read from the opportunity's detail once per version.
  const stepText = useStepText();
  const [nowSteps, setNowSteps] = useState<Record<string, { version: string; step: NowStep | null }>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const wanted = items.filter((item) => item.status === "open" && !asked.current.has(`${item.id}:${String(item.version ?? "")}`)).slice(0, 60);
    if (!wanted.length) return;
    let cancelled = false;
    const queue = [...wanted];
    const worker = async () => {
      for (let item = queue.shift(); item && !cancelled; item = queue.shift()) {
        const version = String(item.version ?? "");
        asked.current.add(`${item.id}:${version}`);
        try {
          const detail = await crmRequest<RecordData & { flow?: OpportunityFlowView; funnel?: FunnelStep[] }>(initialData.workspaceId, `opportunities/${item.id}`);
          if (!detail || typeof detail !== "object") continue;
          const step = nowPlan({ flow: detail.flow && typeof detail.flow === "object" ? detail.flow : null, status: String(detail.status ?? item.status), funnel: detail.funnel, caseId: detail.preProjectCaseId ? String(detail.preProjectCaseId) : null }).now;
          setNowSteps((current) => ({ ...current, [item!.id]: { version, step } }));
        } catch { /* the card simply shows no step */ }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [items, initialData.workspaceId]);
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [view, setView] = useState<"all" | "open" | "closed">("all");

  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "active");
  const visibleItems = useMemo(() => items.filter((item) => view === "all" || (view === "open" ? item.status === "open" : item.status !== "open")), [items, view]);
  const boardItems = visibleItems.filter((item) => (pipelineFilter === "all" || String(item.pipelineId ?? item.pipeline_id) === pipelineFilter) && (!assignee || String(item.ownerMembershipId ?? "unassigned") === assignee) && `${item.title ?? ""} ${item.partyName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const boardColumns: BoardStage[] = pipelines.filter(pipeline => pipelineFilter === "all" || pipeline.id === pipelineFilter).flatMap((pipeline) => (pipeline.stages ?? []).filter(stage => stage.status !== "archived").sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map((stage) => ({ id: String(stage.id), pipelineId: pipeline.id, name: String(stage.name), code: String(stage.code ?? ""), pipelineName: String(pipeline.name), canCreate: pipeline.status === "active" })));
  const unplaced = boardItems.filter((item) => !boardColumns.some((column) => column.id === String(item.stageId ?? item.stage_id)));
  const columns = useMemo(() => columnsFor(pipelines, t, locale, timeZone), [pipelines, t, locale, timeZone]);

  const moveDeal = async (recordId: string, stageId: string, reason?: string) => {
    const item = items.find(record => record.id === recordId);
    const target = boardColumns.find(column => column.id === stageId);
    if (moveLock.current || !item || item.status !== "open" || !target?.canCreate || target.pipelineId !== String(item.pipelineId ?? item.pipeline_id) || stageId === String(item.stageId ?? item.stage_id)) return;
    moveLock.current = true; setMoving(recordId); setFailure(""); setMoveNotice("");
    try {
      const live = await crmRequest<RecordData>(initialData.workspaceId, `opportunities/${recordId}`);
      const status = target.code === "won" || target.code === "lost" ? target.code : "open";
      const updated = await crmRequest<RecordData>(initialData.workspaceId, `opportunities/${recordId}/transition`, "POST", { version: live.version, stageId, status, ...(reason ? { reason } : {}) });
      setItems(current => current.map(record => record.id === recordId ? { ...record, ...updated, stageId, stageName: target.name } : record));
      setMoveNotice(t("{title} moved to {stage}.", { title: opportunityTitle(item, t), stage: target.name }));
      setPendingOutcome(null); setOutcomeReason("");
    } catch (error) {
      const missing = missingFrom(error);
      // The card stays where it was; the box lists every missing item with its action.
      if (missing.length) { setBlocked({ recordId, stage: target.name, items: missing }); setPendingOutcome(null); }
      else setFailure(error instanceof Error ? error.message : t("Could not move the opportunity. Try again."));
    }
    finally { moveLock.current = false; setMoving(null); setDragged(null); setDropTarget(null); }
  };

  /** Won is a payment proof: check what else Won needs, then ask for the proof (or a reason once a payment is verified). */
  const requestWin = async (recordId: string, stageId: string, stageName: string) => {
    if (moveLock.current) return;
    moveLock.current = true; setMoving(recordId); setFailure("");
    try {
      const live = await crmRequest<RecordData & { flow?: OpportunityFlowView }>(initialData.workspaceId, `opportunities/${recordId}`);
      const toWon = live.flow?.toWon ?? [];
      const others = toWon.filter((item) => item.key !== "paymentProof");
      if (others.length) setBlocked({ recordId, stage: stageName, items: others });
      else if (!live.flow || toWon.length) setProofFor(recordId);
      else { setPendingOutcome({ recordId, stageId, status: "won" }); setOutcomeReason(""); }
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Could not move the opportunity. Try again.")); }
    finally { moveLock.current = false; setMoving(null); setDragged(null); setDropTarget(null); }
  };

  const resolve = (recordId: string, step: NowStep) => {
    if (step.target === "proof") setProofFor(recordId);
    else setSelectedRecord(recordId);
  };

  const requestMove = (recordId: string, stageId: string) => {
    const target = boardColumns.find(column => column.id === stageId);
    if (!target) return;
    if (target.code === "won") { void requestWin(recordId, stageId, target.name); return; }
    if (target.code === "lost") {
      setPendingOutcome({ recordId, stageId, status: target.code });
      setOutcomeReason("");
      return;
    }
    void moveDeal(recordId, stageId);
  };

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
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Opportunities could not be refreshed.")); }
    finally { setBusy(false); }
  };


  return <CrmProductShell title={t("Pipeline")} description="" canView={initialData.canView} useWorkspaceColors compact pageClassName={styles.boardPage}
    actions={<Button variant="primary" onPress={() => router.push("/workspace/crm/leads")}><Plus aria-hidden="true" size={15} />{t("Convert enquiry")}</Button>}>
    <div className={styles.boardSurface}>
    <div className={styles.boardToolbar}>
      <SearchInput label={t("Search opportunities")} value={search} onChange={setSearch} />
      <SelectField label={null} aria-label={t("Filter by assignee")} placeholder={t("All assignees")} selectedKey={assignee || "all"} onSelectionChange={key => setAssignee(key === "all" ? "" : String(key))} items={[{id:"all",label:t("All assignees")},{id:"unassigned",label:t("Unassigned")}, ...[...new Map(items.filter(item => item.ownerMembershipId).map(item => [String(item.ownerMembershipId), personDisplayName(item.ownerName as string | null) || t("Assigned person")])).entries()].map(([id,label]) => ({id,label}))]} />
      <SelectField label={null} aria-label={t("Opportunity status")} selectedKey={view} onSelectionChange={key => setView(key as "all" | "open" | "closed")} items={[{id:"all",label:t("All opportunities")},{id:"open",label:t("Open")},{id:"closed",label:t("Closed")}]} />
      {pipelines.length > 1 && <SelectField label={null} aria-label={t("Pipeline")} selectedKey={pipelineFilter} onSelectionChange={key => setPipelineFilter(String(key))} items={[{id:"all",label:t("All pipelines")},...pipelines.map(p => ({id:p.id,label:String(p.name)}))]} />}
      <div role="group" aria-label={t("Pipeline view")} className={styles.viewSwitch}><Button size="compact" aria-pressed={layout === "board"} onPress={() => setLayout("board")}><Columns3 size={14} />{t("Board")}</Button><Button size="compact" aria-pressed={layout === "list"} onPress={() => setLayout("list")}><List size={14} />{t("List")}</Button></div>
      <div className={styles.toolbarActions}>
        <Button size="compact" aria-label={t("Refresh pipeline")} isLoading={busy} onPress={() => void reload()}><RefreshCw aria-hidden="true" size={15} /></Button>
      </div>
    </div>
    {failure ? <Callout title={t("Could not update pipeline")} tone="warning">{failure}</Callout> : null}
    {moveNotice && <p role="status" className={styles.moveNotice}>{moveNotice}</p>}
    {layout === "board" && !activePipelines.length && !items.length ? <div className={styles.emptyState}><strong>{t("Your pipeline starts with an enquiry")}</strong><p>{t("Open an enquiry and choose Convert to opportunity. Its customer, owner and follow-up stay connected.")}</p><ol className={styles.stageFlow} aria-label={t("Sales stages")}><li>{t("New Opportunity")}</li><li>{t("Qualified")}</li><li>{t("Proposal")}</li><li>{t("Negotiation")}</li></ol><p className={styles.flowOutcome}>{t("Then mark the opportunity {won} or {lost}.").split(/(\{won\}|\{lost\})/).map((part, index) => part === "{won}" ? <strong key={index}>{t("Won")}</strong> : part === "{lost}" ? <strong key={index}>{t("Lost")}</strong> : part)}</p></div> : null}
    {layout === "board" && activePipelines.length > 0 && !boardItems.length && <p className={styles.emptyNotice}>{search || assignee || pipelineFilter !== "all" ? t("No opportunities match these filters.") : view === "closed" ? t("No closed opportunities yet.") : view === "open" ? t("No open opportunities yet. Convert one from an enquiry.") : t("No opportunities yet. Convert one from an enquiry.")}</p>}
    {layout === "board" ? <>
      <span id="pipeline-drag-hint" className={styles.srOnly}>{t("Open opportunity. Drag to move stage, or use Alt and the left or right arrow keys.")}</span>
      <div className={`${styles.salesBoard} wd-scroll-quiet`} role="region" tabIndex={0} aria-label={t("Sales pipeline board")} style={{ "--stage-count": boardColumns.length + (unplaced.length ? 1 : 0) } as CSSProperties}>{[...boardColumns, ...(unplaced.length ? [{id:"unplaced",name:t("Needs a stage"),code:"",pipelineId:"",pipelineName:"",canCreate:false}] : [])].map((column, columnIndex) => {
        const cards = column.id === "unplaced" ? unplaced : boardItems.filter(item => String(item.stageId ?? item.stage_id) === column.id);
        return <section className={styles.boardColumn} key={column.id} aria-label={column.name} data-empty={!cards.length || undefined} data-tone={column.code === "won" ? "won" : column.code === "lost" ? "lost" : columnIndex % 5} data-drop-target={dropTarget === column.id || undefined}
          onDragOver={event => { const item = items.find(record => record.id === dragged); if (item && column.canCreate && column.pipelineId === String(item.pipelineId ?? item.pipeline_id)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(column.id); } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
          onDrop={event => { event.preventDefault(); if (dragged) requestMove(dragged, column.id); setDragged(null); setDropTarget(null); }}>
          <header><h2><i aria-hidden="true" />{column.name}</h2><span className={styles.count} aria-label={t("{count} loaded opportunities", { count: cards.length })}>{cards.length}</span></header>
          {pipelines.length > 1 && pipelineFilter === "all" && <small className={styles.pipelineName}>{column.pipelineName}</small>}
          <div className={`${styles.cardStack} wd-scroll-quiet`}>{cards.map(item => {
            const owner = personDisplayName(item.ownerName as string | null);
            const title = opportunityTitle(item, t);
            const customer = String(item.partyName ?? "").trim();
            const value = moneyLabel(item, locale);
            const outcomeMismatch = (column.code === "won" || column.code === "lost") && item.status !== column.code;
            const now = item.status === "open" ? nowSteps[item.id]?.step ?? null : null;
            return <button type="button" className={styles.boardCard} key={item.id} draggable={item.status === "open" && !moving} aria-busy={moving === item.id} data-dragging={dragged === item.id || undefined}
              aria-describedby="pipeline-drag-hint"
              onDragStart={event => { setDragged(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
              onDragEnd={() => { setDragged(null); setDropTarget(null); }}
              onKeyDown={event => { if (event.altKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) { event.preventDefault(); const stages = boardColumns.filter(stage => stage.pipelineId === String(item.pipelineId ?? item.pipeline_id)); const index = stages.findIndex(stage => stage.id === String(item.stageId ?? item.stage_id)); const next = stages[index + (event.key === "ArrowRight" ? 1 : -1)]; if (next) requestMove(item.id, next.id); } }} onClick={() => setSelectedRecord(item.id)}>
              <strong>{title}</strong>
              {outcomeMismatch && <span className={styles.cardWarning}>{t("Status is {status} — review outcome", { status: String(item.status).replaceAll("_", " ") })}</span>}
              {(customer && customer !== title) || value ? <span className={styles.cardMeta}>{customer && customer !== title ? <span>{customer}</span> : null}{value ? <b>{value}</b> : null}</span> : null}
              {now ? <span className={styles.cardNow}>{stepText(now, "short")}</span> : null}
              <footer>
                {item.status === "open" ? (typeof item.nextActionAt === "string" ? <DueChip at={item.nextActionAt} /> : <span className={styles.cardNoDue}>{t("No follow-up")}</span>) : <span />}
                <span className={styles.owner} title={owner || t("Unassigned")}><span aria-hidden="true"><Avatar name={owner || t("Unassigned")} seed={owner ? String(item.ownerMembershipId ?? owner) : undefined} size="sm" /></span><span className={styles.srOnly}>{owner || t("Unassigned")}</span></span>
              </footer>
            </button>;
          })}</div>
          {!cards.length && dragged && <p className={styles.emptyColumn}>{t("Drop here to move")}</p>}
        </section>;
      })}</div>
      {nextCursor && <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more opportunities")}</Button>}
    </> : <DataGrid
      ariaLabel={t("Opportunities")}
      columns={columns}
      data={boardItems}
      emptyTitle={view === "open" ? t("No open opportunities") : view === "closed" ? t("No closed opportunities") : t("No opportunities")}
      emptyDescription={t("Convert an enquiry to carry its customer and follow-up into the pipeline.")}
      exportFileName="wodana-opportunities.csv"
      footerActions={nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more opportunities")}</Button> : undefined}
      getRowId={(record) => record.id}
      hasMoreRows={Boolean(nextCursor)}
      onRowAction={(record) => setSelectedRecord(record.id)}
      pageSize={25}
      persistKey="crm-opportunities"
      rowNumbers={false}
      searchLabel={t("Search opportunities")}
      selectable={false}
      showToolbar={false}
    />}
    {selectedRecord ? <ControlledModalDialog isOpen title={t("Opportunity details")} hideTitle size="xl" className={styles.opportunityModal} onOpenChange={(open) => { if (!open) setSelectedRecord(undefined); }}><LinkedRecordWorkbench id="opportunities" workspaceId={initialData.workspaceId} recordId={selectedRecord} onChanged={reload} /></ControlledModalDialog> : null}
    {blocked ? <StageBlockedSheet stageName={blocked.stage} items={blocked.items} onClose={() => setBlocked(null)} onAction={(step) => resolve(blocked.recordId, step)} /> : null}
    {proofFor ? <PaymentProofDialog workspaceId={initialData.workspaceId} opportunityId={proofFor}
      loadVersion={async () => Number((await crmRequest<RecordData>(initialData.workspaceId, `opportunities/${proofFor}`)).version)}
      onClose={() => setProofFor(null)} onWon={() => reload()}
      onBlocked={(items) => setBlocked({ recordId: proofFor, stage: boardColumns.find((column) => column.code === "won")?.name ?? t("Won"), items })} /> : null}
    {pendingOutcome ? <FormDialog error={failure || undefined} isDirty={Boolean(outcomeReason.trim())} isSubmitDisabled={!outcomeReason.trim()} isSubmitting={Boolean(moving)}
      onClose={() => setPendingOutcome(null)} onSubmit={() => { if (outcomeReason.trim()) void moveDeal(pendingOutcome.recordId, pendingOutcome.stageId, outcomeReason.trim()); }}
      submitLabel={pendingOutcome.status === "won" ? t("Confirm win") : t("Confirm loss")} title={pendingOutcome.status === "won" ? t("Mark opportunity Won") : t("Mark opportunity Lost")}>
      <TextAreaField autoFocus isRequired label={t("Reason")} value={outcomeReason} onChange={setOutcomeReason} maxLength={2000}
        placeholder={pendingOutcome.status === "won" ? t("What confirms this win?") : t("Why was this opportunity lost?")} />
    </FormDialog> : null}
    </div>
  </CrmProductShell>;
}
