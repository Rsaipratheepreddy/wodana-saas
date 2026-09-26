"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Image as ImageIcon, Percent, Plus } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InlineNotice, PillTabs, SegmentedControl, Skeleton, ToggleButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogImageUrl, quoteApi, QuotationRequestError } from "@/lib/quotation/client";
import { caseApi, caseRequest, saveCaseRoom, type CaseAsset } from "@/lib/pre-project/content";
import { groupLines, money, VIEW_LABEL, type LineGroup } from "@/lib/quotation/format";
import type { BuilderLine, BuilderState, CatalogHit, LineOp, QuoteAnchor, QuoteThread, QuoteView } from "@/lib/quotation/types";
import { GENERAL, NO_TRADE } from "@/lib/quotation/types";
import { RoomPicker } from "@/components/pre-project/room-manager";
import type { CaseRoom } from "@/lib/pre-project/content";
import { LineDetails } from "./line-details";
import { QuoteRow, type RowColumn } from "./quote-row";
import { QuoteSummary } from "./quote-summary";
import { FlowActions, RevisionChanges } from "./quote-flow";
import { DocumentStudio } from "./document-studio";
import { InsertTemplate, SaveTemplate } from "./quote-templates";
import { QuoteAssistant } from "./quote-assistant";
import { CommentButton, CommentPanel, PeopleHere, threadsAt, usePulse } from "./quote-collab";
import { useRouter } from "next/navigation";
import styles from "./quote-builder.module.css";

type Draft = { id: string; areaId: string | null; workPackageId: string | null };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", internal_review: "In review", internal_approved: "Approved internally", issued: "Sent", accepted: "Accepted", changes_requested: "Changes requested", declined: "Declined", superseded: "Superseded", withdrawn: "Withdrawn" };

/**
 * The quotation builder (plan §6.8): one list of lines, read by area, by trade or both. Edit like a
 * spreadsheet; every change is saved line by line as you go, priced on the server and shown back.
 */
export function QuoteBuilder({ workspaceId, caseId, quoteId, backHref, initial, initialTab = "items" }: { workspaceId: string; caseId: string; quoteId: string; backHref: string; initial?: BuilderState; initialTab?: "items" | "document" }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const router = useRouter();
  const api = useMemo(() => quoteApi(workspaceId, caseId, quoteId), [workspaceId, caseId, quoteId]);
  const [state, setState] = useState<BuilderState | null>(initial ?? null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<QuoteView>(initial?.settings.defaultView ?? "area");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [addingArea, setAddingArea] = useState(false);
  const [tab, setTab] = useState<"items" | "document">(initialTab);
  // Showing pictures is a per-person choice, remembered on this device.
  const images = useSyncExternalStore(subscribePictures, readPictures, () => false);
  const toggleImages = () => { try { window.localStorage.setItem(PICTURES_KEY, images ? "0" : "1"); } catch { /* storage unavailable */ } window.dispatchEvent(new Event(PICTURES_KEY)); };
  const [inserting, setInserting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<{ scope: "area" | "trade" | "quote"; target: string; name: string } | null>(null);
  const [threads, setThreads] = useState<QuoteThread[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [commentAt, setCommentAt] = useState<{ anchor: QuoteAnchor; title: string } | null>(null);
  const focus = useRef<{ lineId: string | null; field: string | null }>({ lineId: null, field: null });
  const [discountFor, setDiscountFor] = useState<{ scope: "area" | "trade" | "quote"; target: string; name: string } | null>(null);
  const latest = useRef(state);
  useEffect(() => { latest.current = state; }, [state]);
  const queue = useRef<LineOp[]>([]);
  const sending = useRef(false);

  const load = useCallback(async () => {
    try { const next = await api.load(); setState(next); setLoadError(""); return next; }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : t("Could not load the quote.")); return null; }
  }, [api, t]);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    api.load().then((next) => { if (alive) { setState(next); setView(next.settings.defaultView); } }).catch((cause: Error) => { if (alive) setLoadError(cause.message); });
    return () => { alive = false; };
  }, [api, initial]);

  // Changes are sent one batch at a time; each change carries the version of the line we last saw.
  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true; setSaving(true);
    while (queue.current.length) {
      const batch = merge(queue.current.splice(0), latest.current);
      try { const next = await api.apply(batch); setState(next); latest.current = next; setError(""); }
      catch (cause) {
        queue.current = [];
        setError(cause instanceof Error ? cause.message : t("Could not save."));
        if (cause instanceof QuotationRequestError && cause.status === 409) await load();
      }
    }
    sending.current = false; setSaving(false);
  }, [api, load, t]);
  const send = useCallback((ops: LineOp[]) => { queue.current.push(...ops); void flush(); }, [flush]);

  const changeLine = (line: BuilderLine, fields: Partial<BuilderLine>) => {
    // Show the change straight away; the server's answer (with prices) replaces it.
    setState((current) => current ? { ...current, lines: current.lines.map((item) => (item.id === line.id ? { ...item, ...fields } : item)) } : current);
    send([{ op: "upsert", line: { id: line.id, ...fields } }]);
  };
  const createFromDraft = (draft: Draft, fields: Partial<BuilderLine>, hit?: CatalogHit) => {
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    const base = { id: draft.id, areaId: draft.areaId, workPackageId: draft.workPackageId, ...fields };
    send([hit ? { op: "catalog", itemId: hit.id, line: base } : { op: "upsert", line: base }]);
  };
  // A brand-new item: the line is created, then added to the catalog (price and picture can follow).
  const newCatalogLine = async (draft: Draft, title: string) => {
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    try {
      const created = await api.apply([{ op: "upsert", line: { id: draft.id, title, areaId: draft.areaId, workPackageId: draft.workPackageId } }]);
      const line = created.lines.find((item) => item.id === draft.id);
      setState(line ? await api.toCatalog(draft.id, line.version) : created);
      setOpen(draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); void load(); }
  };
  const addDraft = (group: { areaId: string | null; workPackageId: string | null }) => setDrafts((current) => [...current, { id: crypto.randomUUID(), ...group }]);

  const loadThreads = useCallback(async () => {
    try { const result = await api.threads(); setThreads(result.threads ?? []); setMembers(result.members ?? []); } catch { /* comments load again on the next change */ }
  }, [api]);
  useEffect(() => {
    let alive = true;
    api.threads().then((result) => { if (alive) { setThreads(result.threads ?? []); setMembers(result.members ?? []); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [api]);
  // Someone else changed the quote: reload it when nothing of ours is waiting to be saved.
  const people = usePulse(api, focus, {
    revision: state?.quote.revision ?? 0,
    onRevision: () => { if (!sending.current && !queue.current.length) void load(); },
    onComments: () => void loadThreads(),
  });
  const openComments = (anchor: QuoteAnchor, title: string) => setCommentAt({ anchor, title });
  const lineImage = (line: BuilderLine) => line.imageAssetId ? caseApi(workspaceId, caseId, `assets/${line.imageAssetId}?preview=1`) : line.catalogImageId ? catalogImageUrl(workspaceId, line.catalogImageId) : null;
  const setLineImage = async (line: BuilderLine, file: File | null) => {
    if (!file) { changeLine(line, line.imageAssetId ? { imageAssetId: null } : { catalogImageId: null }); return; }
    try {
      const body = new FormData(); body.append("file", file);
      const asset = await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body);
      changeLine(line, { imageAssetId: asset.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not upload the picture.")); }
  };
  // A new area straight from a line's area picker; the line moves into it.
  const newArea = async (line: BuilderLine) => {
    const name = window.prompt(t("Name of the new area"))?.trim();
    if (!name) return;
    try {
      const room = await saveCaseRoom(workspaceId, caseId, { id: crypto.randomUUID(), version: 0, name: name.slice(0, 120), catalogRecordId: null } as never);
      await load();
      changeLine(line, { areaId: room.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };

  const search = useCallback(async (text: string, signal: AbortSignal) => (await api.search(text, signal)).items, [api]);

  const newTrade = async (line?: BuilderLine) => {
    const name = window.prompt(t("Name of the work package"))?.trim();
    if (!name) return;
    try {
      const trade = await api.addTrade(crypto.randomUUID(), name);
      const next = await load();
      if (line && next) changeLine(next.lines.find((item) => item.id === line.id) ?? line, { workPackageId: trade.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };

  const menu = (line: BuilderLine, action: string) => {
    if (action === "details") setOpen(line.id);
    else if (action === "comment") openComments({ kind: "line", key: line.id }, line.title);
    else if (action === "to_catalog") {
      void api.toCatalog(line.id, line.version).then((next) => { setState(next); setError(""); }).catch((cause: Error) => { setError(cause.message); void load(); });
    }
    else if (action === "optional") changeLine(line, { optional: !line.optional });
    else if (action === "delete") {
      setState((current) => current ? { ...current, lines: current.lines.filter((item) => item.id !== line.id) } : current);
      send([{ op: "delete", id: line.id, version: line.version }]);
    } else if (action === "duplicate") {
      const skip = new Set(["id", "version", "position", "components", "updatedAt", "updatedByName", "formulaError", "buildUpComplete", "catalogSnapshot", "catalogItemId", "taxRate", ...(line.formula ? ["quantity"] : []), ...(state?.canEditCosts ? [] : ["unitCost", "markupPercent"])]);
      const fields = Object.fromEntries(Object.entries(line).filter(([key, value]) => !skip.has(key) && value !== null));
      const copy = { ...fields, id: crypto.randomUUID(), title: line.title, ...(line.components.length ? { components: line.components.map((part) => Object.fromEntries(Object.entries(part).filter(([key]) => key !== "worked" && key !== "id"))) } : {}) };
      send([{ op: "upsert", line: copy }, { op: "reorder", ids: reordered(latest.current?.lines ?? [], copy.id, line.id, "after") }]);
    }
  };

  // Drag a line onto another line (or a group's empty row): it moves there and takes that group's area/trade.
  const dropBefore = (target: { lineId?: string; areaId: string | null; workPackageId: string | null }, groupView: QuoteView) => {
    const current = latest.current;
    if (!dragged || !current || dragged === target.lineId) return;
    const line = current.lines.find((item) => item.id === dragged);
    setDragged(null);
    if (!line) return;
    const fields: Partial<BuilderLine> = {};
    if (groupView !== "trade" && (line.areaId ?? null) !== target.areaId) fields.areaId = target.areaId;
    if (groupView !== "area" && (line.workPackageId ?? null) !== target.workPackageId) fields.workPackageId = target.workPackageId;
    const ops: LineOp[] = [];
    if (Object.keys(fields).length) ops.push({ op: "upsert", line: { id: line.id, ...fields } });
    if (target.lineId) ops.push({ op: "reorder", ids: reordered(current.lines, line.id, target.lineId, "before") });
    if (ops.length) send(ops);
  };

  const quoteHref = (id: string) => `${backHref.split("?")[0]}?${new URLSearchParams({ quote: id })}`;
  if (loadError && !state) return <EmptyState illustration="error" title={t("The quote didn't load")} description={loadError} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!state) return <Skeleton lines={8} />;

  const { currency, decimals } = state.quote;
  const groups = groupLines(state.lines, view, state.areas, state.workPackages, { general: t("General"), noTrade: t("No work package") });
  const amountOf = new Map(state.pricing.lines.map((line) => [line.id, String(Number(line.gross) - Number(line.lineDiscount))]));
  const sectionOf = new Map((view === "trade" ? state.pricing.trades : state.pricing.areas).map((section) => [section.key, section]));
  const column: RowColumn = view === "area" ? "trade" : view === "trade" ? "area" : null;
  const openLine = state.lines.find((line) => line.id === open) ?? null;

  const renderGroup = (group: LineGroup, context: { areaId: string | null; workPackageId: string | null }, depth: number) => {
    const groupDrafts = drafts.filter((draft) => draft.areaId === context.areaId && draft.workPackageId === context.workPackageId);
    const section = depth === 0 ? sectionOf.get(group.key) : null;
    const discount = depth === 0 && view !== "area_trade" ? state.discounts.find((item) => item.scope === (view === "trade" ? "trade" : "area") && item.target === group.key) : undefined;
    const empty = !group.lines.length && !groupDrafts.length;
    return <div key={`${depth}-${group.key}`} role="rowgroup" className={styles.group} data-depth={depth}>
      <div role="row" className={styles.groupHead}
        onDragOver={(event) => { if (state.canEdit && dragged) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); dropBefore({ lineId: group.lines[0]?.id, ...context }, view); }}>
        <span role="columnheader" className={styles.groupName}>{group.name}<small>{group.lines.length}</small></span>
        <span className={styles.groupTotal}>
          {discount ? <Badge tone="success">−{discount.kind === "percent" ? `${discount.value}%` : money(discount.value, currency, decimals, locale)}</Badge> : null}
          {section ? money(section.net, currency, decimals, locale) : null}
          {depth === 0 && view !== "area_trade" ? <CommentButton threads={threadsAt(threads, { kind: view === "trade" ? "trade" : "area", key: group.key })} label={t("Comments on {name}", { name: group.name })}
            onOpen={() => openComments({ kind: view === "trade" ? "trade" : "area", key: group.key }, group.name)} /> : null}
          {state.canEdit && depth === 0 && view !== "area_trade" && group.lines.length ? <IconButton aria-label={t("Save {name} as a template", { name: group.name })} size="compact" variant="quiet"
            onPress={() => setSavingTemplate({ scope: view === "trade" ? "trade" : "area", target: group.key, name: group.name })}><Bookmark aria-hidden="true" size={13} /></IconButton> : null}
          {state.canEdit && depth === 0 && view !== "area_trade" && group.lines.length ? <IconButton aria-label={t("Discount on {name}", { name: group.name })} size="compact" variant="quiet"
            onPress={() => setDiscountFor({ scope: view === "trade" ? "trade" : "area", target: group.key, name: group.name })}><Percent aria-hidden="true" size={13} /></IconButton> : null}
        </span>
      </div>
      {group.children ? group.children.map((child) => renderGroup(child, { ...context, workPackageId: child.key === NO_TRADE ? null : child.key }, depth + 1)) : <>
        {group.lines.map((line) => <QuoteRow key={line.id} line={line} column={column} areas={state.areas} trades={state.workPackages} amount={amountOf.get(line.id) ?? null}
          currency={currency} decimals={decimals} canEdit={state.canEdit} search={search}
          comments={threadsAt(threads, { kind: "line", key: line.id })} editingBy={people.filter((person) => person.lineId === line.id)}
          image={images ? { url: lineImage(line) } : null} onImage={(file) => void setLineImage(line, file)} catalogThumb={(id) => catalogImageUrl(workspaceId, id)} onNewArea={() => void newArea(line)}
          onComments={() => openComments({ kind: "line", key: line.id }, line.title)}
          onChange={(fields) => changeLine(line, fields)}
          onCatalog={(hit) => send([{ op: "catalog", itemId: hit.id, line: { id: line.id } }])}
          onOpen={() => setOpen(line.id)} onMenu={(action) => menu(line, action)} onDragStart={() => setDragged(line.id)}
          onDropBefore={() => dropBefore({ lineId: line.id, areaId: line.areaId, workPackageId: line.workPackageId }, view)} onNewTrade={() => void newTrade(line)} />)}
        {groupDrafts.map((draft) => <QuoteRow key={draft.id} draft line={{ ...EMPTY_LINE, id: draft.id, areaId: draft.areaId, workPackageId: draft.workPackageId }} column={column} areas={state.areas} trades={state.workPackages}
          image={images ? { url: null } : null} catalogThumb={(id) => catalogImageUrl(workspaceId, id)}
          amount={null} currency={currency} decimals={decimals} canEdit={state.canEdit} search={search}
          onChange={(fields) => { if (fields.title) createFromDraft(draft, fields); }} onCatalog={(hit) => createFromDraft(draft, {}, hit)}
          onNewCatalogItem={(title) => void newCatalogLine(draft, title)}
          onOpen={() => undefined} onMenu={() => undefined} onDragStart={() => undefined} onDropBefore={() => undefined} onNewTrade={() => undefined} />)}
        {state.canEdit && (depth > 0 || !group.children) ? <div role="row" className={styles.addRow} data-empty={empty || undefined}>
          <button type="button" onClick={() => addDraft(context)}><Plus aria-hidden="true" size={14} />{empty ? t("Add the first item") : t("Add item")}</button>
        </div> : null}
      </>}
    </div>;
  };

  return <section className={styles.builder} aria-label={t("Quotation builder")}>
    <header className={styles.head}>
      <Link href={backHref} className={styles.back} aria-label={t("All quotes")}><ArrowLeft aria-hidden="true" data-directional="true" size={16} /></Link>
      <h1>{t("Q-{number}", { number: state.quote.number })} · {state.quote.title}</h1>
      <Badge tone={state.quote.status === "accepted" ? "success" : state.quote.status === "draft" ? "neutral" : "info"}>{t((STATUS_LABEL[state.quote.status] ?? state.quote.status) as never)}</Badge>
      {state.family.length > 1 ? <PillTabs ariaLabel={t("Revisions")} selectedKey={state.quote.id} onSelectionChange={(id) => router.push(quoteHref(id))}
        items={state.family.map((item, index) => ({ id: item.id, label: t("R{number}", { number: index + 1 }) }))} /> : null}
      {state.quote.validUntil && ["draft", "internal_review", "internal_approved", "issued"].includes(state.quote.status) ? <span className={styles.meta}>{t("Valid until {date}", { date: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${state.quote.validUntil}T00:00:00Z`)) })}</span> : null}
      <span className={styles.saving} aria-live="polite">{saving ? t("Saving…") : null}</span>
      <PeopleHere people={people} />
      <span className={styles.spacer} />
      <strong className={styles.total}>{money(state.pricing.total, currency, decimals, locale)}</strong>
      <FlowActions state={state} api={api} caseHref={(section) => backHref.replace(/\/quotations(\?.*)?$/, `/${section}`)} onDone={load} onError={setError} onRevision={(id) => router.push(quoteHref(id))} />
    </header>
    {state.quote.clientDecision ? <InlineNotice tone={state.quote.status === "accepted" ? "success" : "info"} message={t("{decision} by {name} on {date}{how}", {
      decision: t((state.quote.clientDecision.decision === "accept" ? "Accepted" : state.quote.clientDecision.decision === "changes" ? "Changes requested" : "Declined") as never),
      name: state.quote.clientDecision.decidedBy,
      date: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(state.quote.clientDecision.decidedAt)),
      how: state.quote.clientDecision.recordedBy ? t(" · recorded by {name}", { name: state.quote.clientDecision.recordedBy }) : "",
    }) + (state.quote.clientDecision.note ? ` — ${state.quote.clientDecision.note}` : "")} /> : null}
    <RevisionChanges key={state.quote.id} state={state} api={api} />

    <PillTabs ariaLabel={t("Quote")} selectedKey={tab} onSelectionChange={(key) => setTab(key as "items" | "document")} items={[{ id: "items", label: t("Items") }, { id: "document", label: t("Document") }]} />
    {tab === "document" ? <>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <DocumentStudio state={state} api={api} workspaceId={workspaceId} caseId={caseId} onState={setState} onError={setError} />
    </> : <>
    <div className={styles.toolbar}>
      <SegmentedControl label={t("View")} value={view} onChange={(value) => setView(value as QuoteView)} options={(["area", "trade", "area_trade"] as QuoteView[]).map((id) => ({ id, label: t(VIEW_LABEL[id] as never) }))} />
      <span className={styles.spacer} />
      {state.canEdit && view !== "trade" ? <Button size="compact" variant="quiet" onPress={() => setAddingArea(true)}><Plus aria-hidden="true" size={14} />{t("Area")}</Button> : null}
      {state.canEdit && view !== "area" ? <Button size="compact" variant="quiet" onPress={() => void newTrade()}><Plus aria-hidden="true" size={14} />{t("Work package")}</Button> : null}
      {state.canEdit ? <Button size="compact" variant="quiet" onPress={() => setInserting(true)}><Bookmark aria-hidden="true" size={14} />{t("Insert template")}</Button> : null}
      {state.lines.length ? <Button size="compact" variant="quiet" onPress={() => setSavingTemplate({ scope: "quote", target: "", name: state.quote.title })}>{t("Save quote as template")}</Button> : null}
      <ToggleButton size="compact" isSelected={images} onPress={toggleImages}><ImageIcon aria-hidden="true" size={14} />{t("Pictures")}</ToggleButton>
    </div>

    {state.canEdit ? <QuoteAssistant state={state} api={api} starting={!state.lines.length} onApply={(ops) => send(ops)} onError={setError} /> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {!state.canEdit && state.quote.status !== "draft" ? <InlineNotice tone="info" message={t("This quote has been sent. Start a new revision to change it.")} /> : null}

    <div className={styles.body}>
      <div role="grid" aria-label={t("Quote lines")} className={styles.grid} data-column={column ?? "none"} data-images={images || undefined}
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-line-id]");
          const label = (event.target as HTMLElement).getAttribute("aria-label") ?? "";
          focus.current = { lineId: row?.dataset.lineId ?? null, field: ({ Item: "title", Quantity: "quantity", Unit: "unit", Rate: "rate", Area: "area", "Work package": "trade" } as Record<string, string>)[label] ?? null };
        }}
        onBlurCapture={() => { focus.current = { lineId: null, field: null }; }}>
        <div role="row" className={styles.columns}>
          <span role="columnheader" />
          {images ? <span role="columnheader" data-col="image" /> : null}
          <span role="columnheader">{t("Item")}</span>
          {column ? <span role="columnheader" data-col="pick">{column === "area" ? t("Area") : t("Work package")}</span> : null}
          <span role="columnheader" data-numeric>{t("Qty")}</span>
          <span role="columnheader" data-col="unit">{t("Unit")}</span>
          <span role="columnheader" data-numeric>{t("Rate")}</span>
          <span role="columnheader" data-numeric>{t("Amount")}</span>
          <span role="columnheader" />
        </div>
        {groups.filter((group) => group.lines.length || state.canEdit).map((group) => renderGroup(group, view === "trade"
          ? { areaId: null, workPackageId: group.key === NO_TRADE ? null : group.key }
          : { areaId: group.key === GENERAL ? null : group.key, workPackageId: null }, 0))}
        {!state.lines.length && !state.canEdit ? <EmptyState title={t("No items yet")} /> : null}
      </div>
      <div className={styles.side}>
        {commentAt ? <CommentPanel key={`${commentAt.anchor.kind}:${commentAt.anchor.key}`} anchor={commentAt.anchor} title={commentAt.title} threads={threads} members={members} api={api} meId={state.me}
          onThreads={setThreads} onClose={() => setCommentAt(null)} onError={setError} /> : null}
        <QuoteSummary state={state} api={api} onState={setState} onError={setError} discountFor={discountFor} onDiscountFor={setDiscountFor}
          totalComments={<CommentButton threads={threadsAt(threads, { kind: "total", key: "" })} label={t("Comments on the total")} onOpen={() => openComments({ kind: "total", key: "" }, t("Total"))} />} />
      </div>
    </div>

    </>}
    {inserting ? <InsertTemplate state={state} api={api} onInsert={(ops) => send(ops)} onClose={() => { setInserting(false); void load(); }}
      createArea={(name) => saveCaseRoom(workspaceId, caseId, { id: crypto.randomUUID(), version: 0, name: name.slice(0, 120), catalogRecordId: null } as never)} /> : null}
    {savingTemplate ? <SaveTemplate api={api} scope={savingTemplate.scope} target={savingTemplate.target} name={savingTemplate.name} onClose={() => setSavingTemplate(null)} onError={setError} /> : null}
    {addingArea ? <RoomPicker data={{ workspaceId, caseId, canEdit: state.canEdit, rooms: state.areas.map((area) => ({ ...area, version: 1 }) as unknown as CaseRoom) }}
      onClose={() => setAddingArea(false)} onPick={() => { setAddingArea(false); void load(); }} /> : null}
    {openLine ? <LineDetails key={`${openLine.id}-${openLine.version}`} line={openLine} state={state} onClose={() => setOpen(null)}
      onSave={async (fields) => {
        try { const next = await api.apply([{ op: "upsert", line: { id: openLine.id, version: openLine.version, ...fields } }]); setState(next); setError(""); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); if (cause instanceof QuotationRequestError && cause.status === 409) await load(); return false; }
      }} /> : null}
  </section>;
}

const PICTURES_KEY = "wodana.quote.images";
const readPictures = () => { try { return window.localStorage.getItem(PICTURES_KEY) === "1"; } catch { return false; } };
const subscribePictures = (notify: () => void) => { window.addEventListener(PICTURES_KEY, notify); window.addEventListener("storage", notify); return () => { window.removeEventListener(PICTURES_KEY, notify); window.removeEventListener("storage", notify); }; };

const EMPTY_LINE: BuilderLine = {
  id: "", position: 0, version: 0, kind: "item", areaId: null, fromAreaId: null, workPackageId: null, title: "", description: "", unit: "", quantity: "1",
  formula: null, formulaError: null, length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "0", unitCost: null, markupPercent: null,
  pricingMode: "rate", discountKind: null, discountValue: null, taxCode: null, taxRate: null, optional: null, optionGroup: null, note: "", catalogItemId: null,
  catalogSnapshot: null, buildUpComplete: null, updatedAt: "", updatedByName: null, components: [], imageAssetId: null, catalogImageId: null,
};

/** Combines queued changes: several edits to one line become one upsert with the version we last saw. */
function merge(ops: LineOp[], state: BuilderState | null): LineOp[] {
  const out: LineOp[] = [];
  const upserts = new Map<string, Extract<LineOp, { op: "upsert" }>>();
  const version = (id: string) => state?.lines.find((line) => line.id === id)?.version;
  for (const op of ops) {
    if (op.op === "upsert") {
      const known = version(op.line.id);
      const existing = upserts.get(op.line.id);
      if (existing) { Object.assign(existing.line, op.line); continue; }
      const next = { op: "upsert" as const, line: { ...op.line, ...(known !== undefined && op.line.version === undefined ? { version: known } : {}) } };
      upserts.set(op.line.id, next);
      out.push(next);
    } else if (op.op === "delete") {
      out.push({ ...op, version: version(op.id) ?? op.version });
    } else out.push(op);
  }
  return out;
}

function reordered(lines: BuilderLine[], moving: string, target: string, where: "before" | "after") {
  const ids = [...lines].sort((a, b) => a.position - b.position).map((line) => line.id).filter((id) => id !== moving);
  const index = ids.indexOf(target);
  ids.splice(index < 0 ? ids.length : where === "before" ? index : index + 1, 0, moving);
  return ids;
}
