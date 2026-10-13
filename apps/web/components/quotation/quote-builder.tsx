"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark, CircleAlert, Columns3, Image as ImageIcon, Layers, MapPin, MessageCircle, Plus, Sparkles, Store, Type, X } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, IconButton, IconMenuButton, InlineNotice, MenuButton, SegmentedControl, Skeleton, useConfirmationDialog, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inOverlay, isTypingTarget } from "@/lib/keyboard/typing-target";
import { catalogImageUrl, quoteApi, quoteColumnsApi, QuotationRequestError } from "@/lib/quotation/client";
import { caseApi, caseRequest, saveCaseRoom, type CaseAsset, type CaseRoom } from "@/lib/pre-project/content";
import { requirementHref } from "@/lib/pre-project/types";
import { groupLines, money, QUOTE_STATUS, VIEW_LABEL, type LineGroup } from "@/lib/quotation/format";
import type { BuilderLine, BuilderState, CatalogHit, LineOp, QuoteAnchor, QuoteColumn, QuoteThread, QuoteView } from "@/lib/quotation/types";
import { GENERAL, NO_TRADE } from "@/lib/quotation/types";
import { RoomPicker } from "@/components/pre-project/room-manager";
import { LineDetails } from "./line-details";
import { QuoteRow, readNumber, type RowColumn, type RowColumns } from "./quote-row";
import { QuoteSummary } from "./quote-summary";
import { FlowActions, QuotePayments, RevisionChanges } from "./quote-flow";
import { ValueEngineering } from "./value-engineering";
import { QuoteNextSteps } from "./quote-next-steps";
import { QuoteTerms } from "./quote-terms";
import { QuoteProposal } from "./quote-proposal";
import { QuoteFiles } from "./quote-files";
import { InsertTemplate, SaveTemplate } from "./quote-templates";
import { QuoteChat, type AssistantCommands } from "./quote-chat";
import { QuoteCatalog } from "./quote-catalog";
import { NameDialog } from "./name-dialog";
import { ColumnDialog } from "./column-dialog";
import { useColumnWidths } from "./use-column-widths";
import { ChangeAgreedItem } from "./quote-variation";
import { CommentButton, CommentPanel, CommentsList, PeopleHere, threadsAt, usePulse } from "./quote-collab";
import styles from "./quote-builder.module.css";
import { WorkspaceNotifications } from "@/components/workspace/workspace-notifications";

type Draft = { id: string; areaId: string | null; workPackageId: string | null };

/**
 * The quotation builder (plan §6.8): one list of lines, read by area, by trade or both. Edit like a
 * spreadsheet; every change is saved line by line as you go, priced on the server and shown back.
 */
export function QuoteBuilder({ workspaceId, caseId, quoteId, backHref, initial, initialTab = "items", quoteHref: hrefOf }: { workspaceId: string; caseId: string; quoteId: string; backHref: string; quoteHref?: (id: string) => string; initial?: BuilderState; initialTab?: QuoteTab }) {
  const t = useT();
  const { locale, timeZone, direction } = useDesignSystem();
  const router = useRouter();
  const api = useMemo(() => quoteApi(workspaceId, caseId, quoteId), [workspaceId, caseId, quoteId]);
  const [state, setState] = useState<BuilderState | null>(initial ?? null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  // What the last step actually did (who the quote went to, and how).
  const [flowNotice, setFlowNotice] = useState<{ tone: "success" | "info"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<QuoteView>(initial?.settings.defaultView ?? "area");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [tab, setTab] = useState<QuoteTab>(initialTab);
  // Which optional columns show is a per-person choice, remembered on this device.
  const shownColumns = useSyncExternalStore(subscribeColumns, readColumns, () => COLUMNS_DEFAULT);
  const columns: RowColumns = JSON.parse(shownColumns);
  const widths = useColumnWidths(COLUMN_WIDTHS);
  // The sheet scrolls sideways; the area bands stay the width of what's visible.
  const [visible, setVisible] = useState(0);
  const watching = useRef<ResizeObserver | null>(null);
  const scroller = useCallback((element: HTMLDivElement | null) => {
    watching.current?.disconnect();
    if (!element) return;
    watching.current = new ResizeObserver(() => setVisible(element.clientWidth));
    watching.current.observe(element);
  }, []);
  const toggleColumn = (key: keyof RowColumns) => { try { window.localStorage.setItem(COLUMNS_KEY, JSON.stringify({ ...columns, [key]: !columns[key] })); } catch { /* storage unavailable */ } window.dispatchEvent(new Event(COLUMNS_KEY)); };
  const [inserting, setInserting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<{ scope: "area" | "trade" | "quote"; target: string; name: string } | null>(null);
  const [threads, setThreads] = useState<QuoteThread[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [commentAt, setCommentAt] = useState<{ anchor: QuoteAnchor; title: string } | null>(null);
  const focus = useRef<{ lineId: string | null; field: string | null }>({ lineId: null, field: null });
  const [discountFor, setDiscountFor] = useState<{ scope: "area" | "trade" | "quote"; target: string; name: string } | null>(null);
  // The side panel: the assistant, the catalog, comments and totals. On a narrow screen it's a sheet.
  const [panel, setPanel] = useState<Panel>("assistant");
  // Closed until asked for (AI, comments, catalog or totals): the sheet gets the whole width.
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  const showPanel = narrow ? sheetOpen : panelOpen;
  // The document has its own settings beside the preview; the panel steps aside there.
  const panelShown = showPanel && tab !== "document" && tab !== "files";
  const [contextLineId, setContextLineId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const scrollTo = useRef<string | null>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const assistantRef = useRef<AssistantCommands | null>(null);
  const [catalogArea, setCatalogArea] = useState<string | null>(null);
  const [roomFor, setRoomFor] = useState<BuilderLine | "new" | null>(null);
  const [tradeFor, setTradeFor] = useState<BuilderLine | "new" | null>(null);
  const [columnFor, setColumnFor] = useState<QuoteColumn | "new" | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const columnsApi = useMemo(() => quoteColumnsApi(workspaceId), [workspaceId]);
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
        // Show the quote as it really is again (no half-applied value stays on screen).
        await load();
      }
    }
    sending.current = false; setSaving(false);
  }, [api, load, t]);
  const send = useCallback((ops: LineOp[]) => { queue.current.push(...ops); void flush(); }, [flush]);

  // Lines just added or changed (by the assistant, the catalog or a check) light up for a moment.
  const highlight = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFlash(new Set(ids));
    scrollTo.current = ids[0];
    window.setTimeout(() => setFlash((current) => (ids.some((id) => current.has(id)) ? new Set() : current)), 2400);
  }, []);
  useEffect(() => {
    if (!scrollTo.current) return;
    const row = document.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(scrollTo.current)}"]`);
    if (!row) return;
    scrollTo.current = null;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state, flash]);
  const touched = (ops: LineOp[]) => ops.flatMap((op) => (op.op === "upsert" || op.op === "catalog" ? [op.line.id] : []));
  const applyOps = (ops: LineOp[]) => { send(ops); highlight(touched(ops)); };

  const changeLine = (line: BuilderLine, fields: Partial<BuilderLine>) => {
    // Show the change straight away; the server's answer (with prices) replaces it.
    setState((current) => current ? { ...current, lines: current.lines.map((item) => (item.id === line.id ? { ...item, ...fields } : item)) } : current);
    send([{ op: "upsert", line: { id: line.id, ...fields } }]);
  };
  const discardDraft = (draft: Draft) => setDrafts((current) => current.filter((item) => item.id !== draft.id));
  const createFromDraft = (draft: Draft, fields: Partial<BuilderLine>, hit?: CatalogHit) => {
    discardDraft(draft);
    const base = { id: draft.id, areaId: draft.areaId, workPackageId: draft.workPackageId, ...fields };
    send([hit ? { op: "catalog", itemId: hit.id, line: base } : { op: "upsert", line: base }]);
    focusNext.current = draft.id;
  };
  // A line just added from a new row: its quantity is the next thing to type.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    const cell = document.querySelector<HTMLInputElement>(`[data-line-id="${CSS.escape(focusNext.current)}"]:not([data-draft]) input[aria-label="${t("Quantity")}"]`);
    if (!cell) return;
    focusNext.current = null;
    cell.focus();
  }, [state, t]);
  // A brand-new item: the line is created, then added to the catalog (price and picture can follow).
  const newCatalogLine = async (draft: Draft, title: string) => {
    discardDraft(draft);
    try {
      const created = await api.apply([{ op: "upsert", line: { id: draft.id, title, areaId: draft.areaId, workPackageId: draft.workPackageId } }]);
      const line = created.lines.find((item) => item.id === draft.id);
      setState(line ? await api.toCatalog(draft.id, line.version) : created);
      setOpen(draft.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); void load(); }
  };
  const addDraft = (group: { areaId: string | null; workPackageId: string | null }) => setDrafts((current) => [...current, { id: crypto.randomUUID(), ...group }]);
  /**
   * Rows pasted from a spreadsheet into a new row: one line per row. A header row (Description, Length,
   * Height, Depth, Materials, Qty, Unit, Unit price…) maps the columns by name, so an estimator's own
   * sheet pastes straight in; without one, the cells follow this sheet's column order.
   */
  const pasteRows = (draft: Draft, text: string) => {
    const current = latest.current;
    if (!current) return;
    const custom = current.columns ?? [];
    const rows = text.replace(/\r/g, "").split("\n").map((row) => row.split("\t").map((cell) => cell.trim())).filter((cells) => cells.some(Boolean));
    const header = rows[0]?.some((cell) => /^(description|item|items|name|qty|quantity|unit price|rate|material)/i.test(cell)) ? rows.shift() : undefined;
    const byName = (cell: string) => {
      const name = cell.toLowerCase();
      if (/^(sn|s\.?no|#|no\.?)$|picture|image|photo|total|amount/.test(name)) return null;
      if (/description|^item|name/.test(name)) return "title";
      if (/^l(ength)?\b/.test(name)) return "length";
      if (/^d(epth)?\b|width/.test(name)) return "width";
      if (/^h(eight)?\b/.test(name)) return "height";
      if (/material/.test(name)) return "material";
      if (/^(qty|quantity)/.test(name)) return "quantity";
      if (/^(unit|uom)$/.test(name)) return "unit";
      if (/price|rate/.test(name)) return "rate";
      return custom.find((column) => column.name.toLowerCase() === name) ? `custom:${custom.find((column) => column.name.toLowerCase() === name)!.id}` : null;
    };
    const order = header ? header.map(byName)
      : ["title", ...(columns.size ? ["length", "width", "height"] : []), ...(columns.material ? ["material"] : []), ...custom.map((column) => `custom:${column.id}`), "quantity", "unit", "rate"];
    const numeric = new Set(["length", "width", "height", "quantity", "rate"]);
    const ops: LineOp[] = rows.slice(0, 200).flatMap((cells): LineOp[] => {
      const line: Record<string, unknown> = { id: crypto.randomUUID(), areaId: draft.areaId, workPackageId: draft.workPackageId };
      const values: Record<string, string> = {};
      order.forEach((key, index) => {
        const cell = cells[index];
        if (!key || !cell || cell === "-" || cell === "—") return;
        if (numeric.has(key) || custom.some((column) => key === `custom:${column.id}` && column.kind === "number")) {
          const value = readNumber(cell.replace(/[^\d.,\s]/g, ""), locale);
          if (value === null) return;
          if (key.startsWith("custom:")) values[key.slice(7)] = value; else line[key] = value;
        } else if (key.startsWith("custom:")) values[key.slice(7)] = cell;
        else line[key] = key === "title" ? cell.slice(0, 240) : cell;
      });
      if (!line.title) return [];
      if (line.length || line.width || line.height) line.dimensionUnit = current.sizeUnit ?? "cm";
      if (Object.keys(values).length) line.values = values;
      return [{ op: "upsert", line: line as never }];
    });
    discardDraft(draft);
    if (ops.length) applyOps(ops);
  };
  const addFromCatalog = (hit: CatalogHit, areaId: string | null) => applyOps([{ op: "catalog", itemId: hit.id, line: { id: crypto.randomUUID(), areaId, workPackageId: null } }]);

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

  const showSide = useCallback((next: boolean) => (narrow ? setSheetOpen(next) : setPanelOpen(next)), [narrow]);
  const openPanel = useCallback((view: Panel) => { setPanel(view); showSide(true); }, [showSide]);
  const openComments = (anchor: QuoteAnchor, title: string) => { setCommentAt({ anchor, title }); openPanel("comments"); };
  // ⌘K asks the assistant about the line you're on; ⌘J shows or hides the panel.
  const askAbout = useCallback((lineId: string | null) => {
    setContextLineId(lineId); openPanel("assistant");
    requestAnimationFrame(() => chatInput.current?.focus());
  }, [openPanel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // Typing in the side panel (the catalog search, the assistant) or a dialog keeps its keys.
      if (isTypingTarget(event.target) && inOverlay(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "k" && latest.current?.canEdit) { event.preventDefault(); askAbout(focus.current.lineId); }
      else if (key === "j") { event.preventDefault(); showSide(!showPanel); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askAbout, showSide, showPanel]);

  const lineImage = (line: BuilderLine) => line.imageAssetId ? caseApi(workspaceId, caseId, `assets/${line.imageAssetId}?preview=1`) : line.catalogImageId ? catalogImageUrl(workspaceId, line.catalogImageId) : null;
  const setLineImage = async (line: BuilderLine, file: File | null) => {
    if (!file) { changeLine(line, line.imageAssetId ? { imageAssetId: null } : { catalogImageId: null }); return; }
    try {
      const body = new FormData(); body.append("file", file);
      const asset = await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body);
      changeLine(line, { imageAssetId: asset.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not upload the picture.")); }
  };
  // A new area or work package, from the table or straight from a line's picker (the line moves into it).
  const roomPicked = async (room: CaseRoom) => {
    const line = roomFor;
    setRoomFor(null);
    const next = await load();
    if (line && line !== "new") changeLine(next?.lines.find((item) => item.id === line.id) ?? line, { areaId: room.id });
  };
  const newTrade = async (name: string) => {
    const line = tradeFor;
    const trade = await api.addTrade(crypto.randomUUID(), name);
    const next = await load();
    if (line && line !== "new" && next) changeLine(next.lines.find((item) => item.id === line.id) ?? line, { workPackageId: trade.id });
  };

  const search = useCallback(async (text: string, signal: AbortSignal, limit?: number) => (await api.search(text, signal, limit)).items, [api]);
  const catalogThumb = useCallback((id: string) => catalogImageUrl(workspaceId, id), [workspaceId]);

  // A line as a new one: the same fields, pictures, values and build-up; a catalog line keeps its catalog link.
  const copyOf = (line: BuilderLine, id: string): Extract<LineOp, { op: "upsert" | "catalog" }> => {
    const skip = new Set(["id", "version", "position", "components", "updatedAt", "updatedByName", "formulaError", "buildUpComplete", "catalogSnapshot", "catalogItemId", "taxRate", ...(line.formula ? ["quantity"] : []), ...(state?.canEditCosts ? [] : ["unitCost", "markupPercent"])]);
    const fields = Object.fromEntries(Object.entries(line).filter(([key, value]) => !skip.has(key) && value !== null));
    const copy = { ...fields, id, title: line.title, ...(line.components.length ? { components: line.components.map((part) => Object.fromEntries(Object.entries(part).filter(([key]) => key !== "worked" && key !== "id"))) } : {}) };
    return line.catalogItemId ? { op: "catalog", itemId: line.catalogItemId, line: copy as never } : { op: "upsert", line: copy as never };
  };
  const [undo, setUndo] = useState<{ label: string; ops: LineOp[] } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const offerUndo = (label: string, ops: LineOp[]) => {
    window.clearTimeout(undoTimer.current);
    setUndo({ label, ops });
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const menu = (line: BuilderLine, action: string) => {
    if (action === "details") setOpen(line.id);
    else if (action === "ask") askAbout(line.id);
    else if (action === "comment") openComments({ kind: "line", key: line.id }, line.title);
    else if (action === "to_catalog") {
      void api.toCatalog(line.id, line.version).then((next) => { setState(next); setError(""); }).catch((cause: Error) => { setError(cause.message); void load(); });
    }
    else if (action === "optional") changeLine(line, { optional: !line.optional });
    else if (action === "delete") {
      setState((current) => current ? { ...current, lines: current.lines.filter((item) => item.id !== line.id) } : current);
      send([{ op: "delete", id: line.id, version: line.version }]);
      // A deleted line can come back for a few seconds (as a copy, with its catalog link).
      offerUndo(t("Deleted “{name}”", { name: line.title || t("Untitled line") }), [copyOf(line, line.id)]);
    } else if (action === "duplicate") {
      const copy = copyOf(line, crypto.randomUUID());
      send([copy, { op: "reorder", ids: reordered(latest.current?.lines ?? [], copy.line.id, line.id, "after") }]);
      highlight([copy.line.id]);
    }
  };

  // Drag a line onto another line (or a group's heading): it moves there and takes that group's area/trade.
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

  const quoteHref = hrefOf ?? ((id: string) => `${backHref.split("?")[0]}?${new URLSearchParams({ quote: id })}`);
  if (loadError && !state) return <div className={styles.loading}><ErrorState title={t("The quote didn't load")} description={loadError} onRetry={() => void load()} /></div>;
  if (!state) return <div className={styles.loading}><Skeleton lines={8} shape="rows" /></div>;

  const { currency, decimals } = state.quote;
  const groups = groupLines(state.lines, view, state.areas, state.workPackages, { general: t("General"), noTrade: t("No work package") });
  const amountOf = new Map(state.pricing.lines.map((line) => [line.id, String(Number(line.gross) - Number(line.lineDiscount))]));
  const sectionOf = new Map((view === "trade" ? state.pricing.trades : state.pricing.areas).map((section) => [section.key, section]));
  // Grouped by trade, each line shows its area; grouped by area, the work package lives in the line's details.
  const column: RowColumn = view === "trade" ? "area" : null;
  const openLine = state.lines.find((line) => line.id === open) ?? null;
  const contextLine = state.lines.find((line) => line.id === contextLineId) ?? null;
  const canAsk = state.canEdit && state.assistant?.available !== false;
  const openThreads = threads.filter((thread) => thread.status === "open").length;
  const customColumns = state.columns ?? [];
  const day = (value: Date) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(value);
  const proposalFacts = {
    reference: `${t("Q-{number}", { number: state.quote.number })} · ${t("R{number}", { number: Math.max(1, state.family.findIndex((item) => item.id === state.quote.id) + 1) })}`,
    date: day(new Date()), validUntil: state.quote.validUntil ? day(new Date(`${state.quote.validUntil}T12:00:00Z`)) : "", approvedBy: state.quote.approvedBy ?? "",
    subtotal: state.pricing.subtotal, discount: state.pricing.discounts.total, net: state.pricing.net, tax: state.pricing.tax, total: state.pricing.total,
    lineAmount: Object.fromEntries(state.pricing.lines.map((line) => [line.id, String(Number(line.gross) - Number(line.lineDiscount))])),
  };
  const toFix = state.quote.status === "draft" ? state.checks.length : 0;
  // An approved quotation waits to be sent until every requirement is decided; the notice opens the first one to decide.
  const undecided = state.quote.status === "internal_approved" ? state.checks.find((check) => check.requirementId) : undefined;
  const views: Array<{ id: Panel; label: string }> = [
    ...(state.canEdit ? [{ id: "assistant" as const, label: t("Assistant") }, { id: "catalog" as const, label: t("Catalog") }] : []),
    { id: "comments", label: openThreads ? t("Comments · {count}", { count: openThreads }) : t("Comments") },
    { id: "totals", label: t("Totals") },
  ];
  const activePanel = views.some((item) => item.id === panel) ? panel : views[0].id;
  const lineTitle = (thread: QuoteThread) => thread.anchorKind === "line" ? state.lines.find((line) => line.id === thread.anchorKey)?.title || t("A removed line")
    : thread.anchorKind === "area" ? (state.areas.find((area) => area.id === thread.anchorKey)?.name ?? t("General"))
      : thread.anchorKind === "trade" ? (state.workPackages.find((trade) => trade.id === thread.anchorKey)?.name ?? t("No work package")) : t("The quote");
  const groupMenu = (group: LineGroup) => [
    { id: "comment", label: t("Comment") },
    ...(state.canEdit && group.lines.length ? [{ id: "discount", label: t("Discount") }, { id: "template", label: t("Save as template") }] : []),
  ];
  const onGroupMenu = (group: LineGroup, action: string) => {
    const scope = view === "trade" ? "trade" : "area";
    if (action === "comment") openComments({ kind: scope, key: group.key }, group.name);
    else if (action === "discount") { setDiscountFor({ scope, target: group.key, name: group.name }); openPanel("totals"); }
    else if (action === "template") setSavingTemplate({ scope, target: group.key, name: group.name });
  };

  // Column headings, repeated under each area's band so a long quote stays readable. Each heading's
  // edge can be dragged (or moved with the arrow keys) to resize its column.
  const heading = (key: string, content: React.ReactNode, options: { numeric?: boolean; label?: string } = {}) => <span role="columnheader" data-numeric={options.numeric || undefined}
    data-stick={STICKY_COLUMNS.has(key) ? key : undefined}
    aria-label={options.label} title={options.label}>
    {content}
    {RESIZABLE.has(key) || key.startsWith("custom:") ? <span role="separator" aria-orientation="vertical" aria-label={t("Resize {column}", { column: options.label ?? String(content) })} tabIndex={0} className={styles.resizer}
      onPointerDown={widths.startResize(key)} onDoubleClick={() => widths.reset(key)}
      onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); widths.nudge(key, ((event.key === "ArrowRight") !== (direction === "rtl") ? 1 : -1) * 16); } }} /> : null}
  </span>;
  const headerRow = () => <div role="row" className={styles.columns}>
    <span role="columnheader" className={styles.gutter} data-stick="gutter" />
    <span role="columnheader" data-numeric data-stick="serial">{t("#")}</span>
    {columns.picture ? heading("picture", <ImageIcon aria-hidden="true" size={13} />, { label: t("Picture") }) : null}
    {heading("item", <><Type aria-hidden="true" size={13} />{t("Item")}</>, { label: t("Item") })}
    {column ? heading("pick", <><MapPin aria-hidden="true" size={13} />{t("Area")}</>, { label: t("Area") }) : null}
    {columns.size ? <>
      {heading("length", <>{t("L")}<small>{state.sizeUnit ?? "cm"}</small></>, { numeric: true, label: t("Length") })}
      {heading("width", <>{t("D")}<small>{state.sizeUnit ?? "cm"}</small></>, { numeric: true, label: t("Depth") })}
      {heading("height", <>{t("H")}<small>{state.sizeUnit ?? "cm"}</small></>, { numeric: true, label: t("Height") })}
    </> : null}
    {columns.material ? heading("material", <><Layers aria-hidden="true" size={13} />{t("Material")}</>, { label: t("Material") }) : null}
    {customColumns.map((custom) => heading(`custom:${custom.id}`, <><span className={styles.headLabel}>{custom.name}</span>
      {state.canEdit ? <span className={styles.headMenu}><IconMenuButton ariaLabel={t("Actions for {name}", { name: custom.name })} items={[{ id: "rename", label: t("Rename") }, { id: "proposal", label: custom.showInProposal ? t("Hide from the client's proposal") : t("Show on the client's proposal") }, { id: "remove", label: t("Remove column"), tone: "danger" }]}
        onAction={(action) => action === "rename" ? setColumnFor(custom)
          : action === "proposal" ? void columnsApi.change(custom.id, { showInProposal: !custom.showInProposal, version: custom.version }).then(({ columns: next }) => setState((current) => (current ? { ...current, columns: next } : current))).catch((cause: Error) => setError(cause.message))
          : requestConfirmation({ title: t("Remove “{name}”?", { name: custom.name }), body: t("It goes from every quote. Values already on sent quotes stay on their records."), confirmLabel: t("Remove column"),
          onConfirm: () => void columnsApi.change(custom.id, { archived: true, version: custom.version }).then(({ columns: next }) => setState((current) => (current ? { ...current, columns: next } : current))).catch((cause: Error) => setError(cause.message)) })} /></span> : null}</>,
      { numeric: custom.kind === "number", label: custom.name }))}
    {heading("qty", t("Qty"), { numeric: true, label: t("Qty") })}
    {heading("unit", t("Unit"), { label: t("Unit") })}
    {heading("rate", t("Rate"), { numeric: true, label: t("Rate") })}
    {heading("amount", t("Amount"), { numeric: true, label: t("Amount") })}
    <span role="columnheader" className={styles.gutter} data-stick="menu">{state.canEdit ? <IconButton aria-label={t("Add a column")} size="compact" onPress={() => setColumnFor("new")}><Plus aria-hidden="true" size={15} /></IconButton> : null}</span>
  </div>;

  const renderGroup = (group: LineGroup, context: { areaId: string | null; workPackageId: string | null }, depth: number, tone?: string) => {
    const groupDrafts = drafts.filter((draft) => draft.areaId === context.areaId && draft.workPackageId === context.workPackageId);
    const section = depth === 0 ? sectionOf.get(group.key) : null;
    const discount = depth === 0 && view !== "area_trade" ? state.discounts.find((item) => item.scope === (view === "trade" ? "trade" : "area") && item.target === group.key) : undefined;
    const groupThreads = depth === 0 && view !== "area_trade" ? threadsAt(threads, { kind: view === "trade" ? "trade" : "area", key: group.key }) : [];
    return <div key={`${depth}-${group.key}`} role="rowgroup" className={styles.group} data-depth={depth}>
      <div role="row" className={styles.groupHead} data-tone={tone}
        onDragOver={(event) => { if (state.canEdit && dragged) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); dropBefore({ lineId: group.lines[0]?.id, ...context }, view); }}>
        <span role="columnheader" className={styles.groupName}>{depth === 0 ? <span className={styles.groupDot} aria-hidden="true" /> : null}{group.name}<small>{group.lines.length}</small></span>
        <span className={styles.groupTotal}>
          {groupThreads.some((thread) => thread.status === "open") ? <CommentButton threads={groupThreads} label={t("Comments on {name}", { name: group.name })} onOpen={() => openComments({ kind: view === "trade" ? "trade" : "area", key: group.key }, group.name)} /> : null}
          {discount ? <Badge tone="success">−{discount.kind === "percent" ? `${discount.value}%` : money(discount.value, currency, decimals, locale)}</Badge> : null}
          {section ? <span>{money(section.net, currency, decimals, locale)}</span> : null}
          <span className={styles.groupActions}>
            {state.canEdit && !group.children ? <IconButton aria-label={t("New line in {name}", { name: group.name })} size="compact" onPress={() => addDraft(context)}><Plus aria-hidden="true" size={15} /></IconButton> : null}
            {depth === 0 && view !== "area_trade" ? <IconMenuButton ariaLabel={t("Actions for {name}", { name: group.name })} items={groupMenu(group)} onAction={(action) => onGroupMenu(group, action)} /> : null}
          </span>
        </span>
      </div>
      {depth === 0 ? headerRow() : null}
      {group.children ? group.children.map((child) => renderGroup(child, { ...context, workPackageId: child.key === NO_TRADE ? null : child.key }, depth + 1)) : <>
        {group.lines.map((line, index) => <QuoteRow key={line.id} line={line} serial={index + 1} column={column} columns={columns} customColumns={customColumns} units={state.units} materials={state.materials} sizeUnit={state.sizeUnit}
          areas={state.areas} trades={state.workPackages} amount={amountOf.get(line.id) ?? null}
          currency={currency} decimals={decimals} canEdit={state.canEdit} canPrice={state.canPrice ?? state.canEdit} canAsk={canAsk} search={search} flash={flash.has(line.id)}
          comments={threadsAt(threads, { kind: "line", key: line.id })} editingBy={people.filter((person) => person.lineId === line.id)}
          imageUrl={lineImage(line)} onImage={(file) => void setLineImage(line, file)} catalogThumb={catalogThumb} onNewArea={() => setRoomFor(line)}
          onComments={() => openComments({ kind: "line", key: line.id }, line.title)}
          onChange={(fields) => changeLine(line, fields)}
          onCatalog={(hit) => send([{ op: "catalog", itemId: hit.id, line: { id: line.id } }])}
          onOpen={() => setOpen(line.id)} onMenu={(action) => menu(line, action)} onDragStart={() => setDragged(line.id)}
          onDropBefore={() => dropBefore({ lineId: line.id, areaId: line.areaId, workPackageId: line.workPackageId }, view)} onNewTrade={() => setTradeFor(line)} />)}
        {groupDrafts.map((draft, index) => <QuoteRow key={draft.id} draft serial={group.lines.length + index + 1} line={{ ...EMPTY_LINE, id: draft.id, areaId: draft.areaId, workPackageId: draft.workPackageId }}
          column={column} columns={columns} customColumns={customColumns} units={state.units} materials={state.materials} sizeUnit={state.sizeUnit} areas={state.areas} trades={state.workPackages} catalogThumb={catalogThumb}
          amount={null} currency={currency} decimals={decimals} canEdit={state.canEdit} search={search}
          onChange={(fields) => { if (fields.title) createFromDraft(draft, fields); }} onCatalog={(hit) => createFromDraft(draft, {}, hit)}
          onNewCatalogItem={(title) => void newCatalogLine(draft, title)} onDiscard={() => discardDraft(draft)} onPasteRows={(text) => pasteRows(draft, text)}
          onOpen={() => undefined} onMenu={() => undefined} onDragStart={() => undefined} onDropBefore={() => undefined} onNewTrade={() => undefined} />)}
        {unpricedLines(group.lines).length ? <div role="row" className={styles.priceNotice}><span role="gridcell">
          {unpricedLines(group.lines).length === 1 ? t("1 item has no active price in {currency}.", { currency }) : t("{count} items have no active price in {currency}.", { count: unpricedLines(group.lines).length, currency })}
          {" "}<Link href="/workspace/catalogs">{t("Set a price book")}</Link>
        </span></div> : null}
        {state.canEdit && (depth > 0 || !group.children) ? <div role="row" className={styles.addRow}>
          <button type="button" data-tour="quote-new-line" data-tour-safe onClick={() => addDraft(context)}><Plus aria-hidden="true" size={14} />{t("New line")}</button>
        </div> : null}
      </>}
    </div>;
  };

  const empty = !state.lines.length;
  return <section className={styles.builder} aria-label={t("Quotation builder")} data-panel={panelShown ? "open" : "closed"}>
    <header className={styles.top}>
      <Link href={backHref} className={styles.back} aria-label={t("All quotes")}><ArrowLeft aria-hidden="true" data-directional="true" size={16} /></Link>
      <h1>{state.quote.reference ?? t("Q-{number}", { number: state.quote.number })} · {state.quote.title}</h1>
      <Badge data-tour="quote-status" tone={QUOTE_STATUS[state.quote.status]?.tone ?? "neutral"}>{t((QUOTE_STATUS[state.quote.status]?.label ?? state.quote.status) as never)}</Badge>
      {state.family.length > 1 ? <span className={styles.revisions}><SegmentedControl label={t("Revisions")} value={state.quote.id} onChange={(id) => router.push(quoteHref(id))}
        options={state.family.map((item, index) => ({ id: item.id, label: t("R{number}", { number: index + 1 }) }))} /></span> : null}
      <span className={styles.tabs}><SegmentedControl label={t("Quote")} tour="quote-tab" value={tab} onChange={(key) => setTab(key as QuoteTab)}
        options={[{ id: "items", label: t("Items") }, { id: "terms", label: t("Terms") }, { id: "payments", label: t("Payments") }, { id: "document", label: t("Document") },
          ...(state.quote.kind === "quotation" ? [{ id: "files", label: t("Proposal & files") }] : [])]} /></span>
      <span className={styles.saving} aria-live="polite">{saving ? t("Saving…") : null}</span>
      <span className={styles.spacer} />
      <PeopleHere people={people} />
      {toFix ? <button type="button" className={styles.toFix} data-tour="quote-checks" onClick={() => openPanel("totals")}><CircleAlert aria-hidden="true" size={14} />{toFix === 1 ? t("1 to fix") : t("{count} to fix", { count: toFix })}</button> : null}
      <button type="button" className={styles.total} data-tour="quote-total" aria-label={t("Totals: {amount}", { amount: money(state.pricing.total, currency, decimals, locale) })} onClick={() => openPanel("totals")}>{money(state.pricing.total, currency, decimals, locale)}</button>
      <IconButton className={styles.withCount} aria-label={openThreads ? t("Comments · {count}", { count: openThreads }) : t("Comments")} aria-pressed={panelShown && activePanel === "comments"} onPress={() => (panelShown && activePanel === "comments" ? showSide(false) : openPanel("comments"))}>
        <MessageCircle aria-hidden="true" size={17} />{openThreads ? <span className={styles.countDot}>{openThreads}</span> : null}
      </IconButton>
      <WorkspaceNotifications workspaceId={workspaceId} />
      {state.canEdit ? <button type="button" className={styles.askAi} aria-pressed={panelShown && activePanel === "assistant"} aria-keyshortcuts="Meta+K Control+K"
        onClick={() => (panelShown && activePanel === "assistant" ? showSide(false) : askAbout(null))}><Sparkles aria-hidden="true" size={15} />{t("Ask AI")}</button> : null}
      <FlowActions state={state} api={api} workspaceId={workspaceId} caseId={caseId} onDone={load} onError={setError} onNotice={setFlowNotice} onRevision={(id) => router.push(quoteHref(id))} />
    </header>

    <div className={styles.workbench}>
      <main className={styles.canvas}>
        {tab === "items" ? <div className={styles.canvasHead}>
          <span className={styles.spacer} />
          <>
            {state.quote.validUntil && ["draft", "internal_review", "internal_approved", "issued"].includes(state.quote.status) ? <span className={styles.meta}>{t("Valid until {date}", { date: new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${state.quote.validUntil}T00:00:00Z`)) })}</span> : null}
            {state.canEdit ? <Button size="compact" variant="quiet" onPress={() => openPanel("catalog")}><Store aria-hidden="true" size={15} />{t("Catalog")}</Button> : null}
            <MenuButton size="compact" label={t(GROUP_LABEL[view] as never)} onAction={(id) => setView(id as QuoteView)}
              items={(["area", "trade", "area_trade"] as QuoteView[]).map((id) => ({ id, label: t(VIEW_LABEL[id] as never) }))} />
            <IconMenuButton ariaLabel={t("Columns")} icon={<Columns3 aria-hidden="true" size={16} />} onAction={(id) => toggleColumn(id as keyof RowColumns)} items={[
              { id: "picture", label: columns.picture ? t("Hide pictures") : t("Show pictures") },
              { id: "size", label: columns.size ? t("Hide sizes") : t("Show sizes") },
              { id: "material", label: columns.material ? t("Hide materials") : t("Show materials") },
            ]} />
            <IconMenuButton ariaLabel={t("More")} onAction={(id) => {
              if (id === "template") setInserting(true);
              else if (id === "save_template") setSavingTemplate({ scope: "quote", target: "", name: state.quote.title });
              else if (id === "trade") setTradeFor("new");
              else if (id === "change") setChanging(true);
            }} items={[
              ...(state.canEdit ? [{ id: "template", label: t("Insert a template") }, { id: "trade", label: t("New work package") }] : []),
              ...(state.lines.length ? [{ id: "save_template", label: t("Save quote as template") }] : []),
              ...(state.quote.kind === "variation" && state.canEdit && state.project ? [{ id: "change", label: t("Change an agreed item") }] : []),
            ]} />
          </>
        </div> : null}

        {state.quote.clientDecision ? <InlineNotice tone={state.quote.status === "accepted" ? "success" : "info"} message={t("{decision} by {name} on {date}{how}", {
          decision: t((state.quote.clientDecision.decision === "accept" ? "Accepted" : state.quote.clientDecision.decision === "changes" ? "Changes requested" : "Declined") as never),
          name: state.quote.clientDecision.decidedBy,
          date: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(state.quote.clientDecision.decidedAt)),
          how: state.quote.clientDecision.recordedBy ? t(" · recorded by {name}", { name: state.quote.clientDecision.recordedBy }) : "",
        }) + (state.quote.clientDecision.note ? `: ${state.quote.clientDecision.note}` : "")} /> : null}
        <RevisionChanges key={state.quote.id} state={state} api={api} />
        {/* PLM-147: value engineering on the estimate, led by the lead designer with the QS. */}
        <ValueEngineering key={`ve:${state.quote.id}`} workspaceId={workspaceId} caseId={caseId} state={state} />
        {["accepted", "declined"].includes(state.quote.status) && state.quote.kind === "quotation" ? <QuoteNextSteps key={`next:${state.quote.id}:${state.quote.revision}`} workspaceId={workspaceId} caseId={caseId} quote={{ id: state.quote.id, round: state.quote.round, status: state.quote.status }} projectStarted={Boolean(state.project)} /> : null}
        {error ? <InlineNotice tone="error" message={error} /> : null}
        {flowNotice ? <InlineNotice tone={flowNotice.tone} message={flowNotice.message} /> : null}
        {undecided ? <InlineNotice tone="error" message={<Link className={styles.checkLink} href={requirementHref(caseId, undecided.requirementId!)}>{t(undecided.code as never, undecided.values)}</Link>} /> : null}
        {!state.canEdit && state.quote.status !== "draft" && !undecided ? <InlineNotice tone="info" message={state.quote.status === "internal_review"
          ? t("This quote is in review. It can be changed again if it's sent back.") : state.quote.status === "internal_approved"
            ? t("This quote is approved and ready to send to the client.") : t("This quote has been sent. Start a new revision to change it.")} /> : null}

        {tab === "files" ? <QuoteFiles workspaceId={workspaceId} caseId={caseId} state={state} />
          : tab === "document" ? <QuoteProposal workspaceId={workspaceId} caseId={caseId} quoteId={quoteId} api={api} sizeUnit={state.sizeUnit ?? "cm"} onPayments={() => setTab("payments")}
          columns={customColumns.filter((custom) => custom.showInProposal).map(({ id, name }) => ({ id, name }))} facts={proposalFacts} />
          : tab === "terms" ? <QuoteTerms key={`terms:${state.quote.id}`} state={state} api={api} onError={setError}
            onSaved={(proposal) => setState((current) => (current ? { ...current, proposal } : current))} />
            : tab === "payments" ? <QuotePayments key={`payments:${state.quote.id}:${JSON.stringify(state.quote.paymentTerms)}`} state={state} api={api} onState={setState} onError={setError} /> : <>
          {empty && state.canEdit ? <div className={styles.starts} aria-label={t("Start the quote")} role="group">
            <button type="button" data-primary onClick={() => { openPanel("assistant"); requestAnimationFrame(() => assistantRef.current?.draft()); }}>
              <Sparkles aria-hidden="true" size={18} /><strong>{t("Draft it with AI")}</strong><small>{t("From Planning")}</small>
            </button>
            <button type="button" onClick={() => openPanel("catalog")}><Store aria-hidden="true" size={18} /><strong>{t("Pick from the catalog")}</strong><small>{t("Search and add")}</small></button>
            <button type="button" onClick={() => setInserting(true)}><Bookmark aria-hidden="true" size={18} /><strong>{t("Insert a template")}</strong><small>{t("Saved areas and quotes")}</small></button>
          </div> : null}
          <div ref={scroller} className={styles.gridScroll} style={{ "--visible": visible ? `${visible}px` : "100%" } as React.CSSProperties}><div role="grid" aria-label={t("Quote lines")} data-tour="quote-grid" className={styles.grid} style={{ "--cols": gridColumns(column, columns, widths.width, customColumns), "--grid-min": `${gridMinWidth(column, columns, widths.width, customColumns)}px`, "--stick-serial": `${widths.width("gutter")}px`, "--stick-picture": `${widths.width("gutter") + widths.width("serial")}px`,
            "--stick-item": `${widths.width("gutter") + widths.width("serial") + (columns.picture ? widths.width("picture") : 0)}px`, "--stick-menu": `${widths.width("menu")}px`,
            "--stick-rate": `${widths.width("menu") + widths.width("amount")}px`, "--stick-unit": `${widths.width("menu") + widths.width("amount") + widths.width("rate")}px`,
            "--stick-qty": `${widths.width("menu") + widths.width("amount") + widths.width("rate") + widths.width("unit")}px` } as React.CSSProperties}
            onFocusCapture={(event) => {
              const row = (event.target as HTMLElement).closest<HTMLElement>("[data-line-id]");
              const label = (event.target as HTMLElement).getAttribute("aria-label") ?? "";
              focus.current = { lineId: row?.dataset.lineId ?? null, field: ({ Item: "title", Quantity: "quantity", Unit: "unit", Rate: "rate", Area: "area", "Work package": "trade" } as Record<string, string>)[label] ?? null };
            }}
            onBlurCapture={() => { focus.current = { lineId: null, field: null }; }}>
            {groups.filter((group) => group.lines.length || (state.canEdit && (view !== "trade" || group.key === NO_TRADE || drafts.some((draft) => draft.workPackageId === group.key))))
              .map((group, index) => renderGroup(group, view === "trade"
              ? { areaId: null, workPackageId: group.key === NO_TRADE ? null : group.key }
              : { areaId: group.key === GENERAL ? null : group.key, workPackageId: null }, 0, GROUP_TONES[index % GROUP_TONES.length]))}
            {empty && !state.canEdit ? <EmptyState title={t("No items yet")} /> : null}
          </div></div>
          {state.canEdit ? <div className={styles.tableFoot}>
            {view !== "trade" ? <button type="button" onClick={() => setRoomFor("new")}><Plus aria-hidden="true" size={14} />{t("Add area")}</button>
              : <button type="button" onClick={() => setTradeFor("new")}><Plus aria-hidden="true" size={14} />{t("New work package")}</button>}
            {canAsk ? <button type="button" aria-keyshortcuts="Meta+K Control+K" onClick={() => askAbout(null)}><Sparkles aria-hidden="true" size={14} />{t("Ask AI")}</button> : null}
          </div> : null}
        </>}
      </main>

      <aside className={styles.panel} aria-label={t("Side panel")} hidden={!panelShown} data-side-panel>
        <div className={styles.panelHead}>
          <SegmentedControl label={t("Side panel")} value={activePanel} onChange={(id) => setPanel(id as Panel)} options={views} />
          <span className={styles.spacer} />
          <IconButton aria-label={t("Close")} onPress={() => showSide(false)}><X aria-hidden="true" size={16} /></IconButton>
        </div>
        {state.canEdit ? <div className={styles.panelBody} hidden={activePanel !== "assistant"}>
          <QuoteChat state={state} api={api} workspaceId={workspaceId} onApply={applyOps} contextLine={contextLine} onClearContext={() => setContextLineId(null)}
            onFocusLine={(id) => highlight([id])} inputRef={chatInput} commandsRef={assistantRef} />
        </div> : null}
        {state.canEdit ? <div className={styles.panelBody} hidden={activePanel !== "catalog"}>
          <QuoteCatalog active={panelShown && activePanel === "catalog"} search={search} thumb={catalogThumb} currency={currency} decimals={decimals} areas={state.areas} areaId={catalogArea} onAreaChange={setCatalogArea} onAdd={addFromCatalog} canEdit={state.canEdit} />
        </div> : null}
        <div className={styles.panelBody} data-scroll hidden={activePanel !== "comments"}>
          {commentAt ? <CommentPanel key={`${commentAt.anchor.kind}:${commentAt.anchor.key}`} anchor={commentAt.anchor} title={commentAt.title} threads={threads} members={members} api={api} meId={state.me}
            onThreads={setThreads} onClose={() => setCommentAt(null)} onError={setError} />
            : <CommentsList threads={threads} members={members} api={api} meId={state.me} titleOf={lineTitle} onThreads={setThreads} onError={setError}
              onOpen={(thread) => { if (thread.anchorKind === "line") highlight([thread.anchorKey]); setCommentAt({ anchor: { kind: thread.anchorKind, key: thread.anchorKey }, title: lineTitle(thread) }); }} />}
        </div>
        <div className={styles.panelBody} data-scroll hidden={activePanel !== "totals"}>
          <QuoteSummary state={state} api={api} onState={setState} onError={setError} discountFor={discountFor} onDiscountFor={setDiscountFor}
            onFocusLine={(id) => { setTab("items"); highlight([id]); }} onPayments={() => setTab("payments")} requirementHref={(id) => requirementHref(caseId, id)} onFix={canAsk ? (text) => { openPanel("assistant"); requestAnimationFrame(() => assistantRef.current?.ask(text)); } : undefined}
            totalComments={<CommentButton threads={threadsAt(threads, { kind: "total", key: "" })} label={t("Comments on the total")} onOpen={() => openComments({ kind: "total", key: "" }, t("Total"))} />} />
        </div>
      </aside>
    </div>

    {changing ? <ChangeAgreedItem state={state} api={api} onClose={() => setChanging(false)}
      onApply={async (ops) => { try { setState(await api.apply(ops)); setError(""); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); return false; } }} /> : null}
    {inserting ? <InsertTemplate state={state} api={api} onInsert={applyOps} onClose={() => { setInserting(false); void load(); }}
      onAskAssistant={canAsk ? () => askAbout(null) : undefined}
      createArea={(name) => saveCaseRoom(workspaceId, caseId, { id: crypto.randomUUID(), version: 0, name: name.slice(0, 120), catalogRecordId: null } as never)} /> : null}
    {savingTemplate ? <SaveTemplate api={api} scope={savingTemplate.scope} target={savingTemplate.target} name={savingTemplate.name} onClose={() => setSavingTemplate(null)} onError={setError} /> : null}
    {roomFor ? <RoomPicker data={{ workspaceId, caseId, canEdit: state.canEdit, rooms: state.areas.map((area) => ({ ...area, version: 1 }) as unknown as CaseRoom) }}
      title={t("Add area")} onClose={() => setRoomFor(null)} onPick={(room) => void roomPicked(room)} /> : null}
    {columnFor ? <ColumnDialog column={columnFor === "new" ? undefined : columnFor} onClose={() => setColumnFor(null)}
      onSave={async ({ name, kind }) => {
        const { columns: next } = columnFor === "new" ? await columnsApi.add(crypto.randomUUID(), name, kind) : await columnsApi.change(columnFor.id, { name, version: columnFor.version });
        setState((current) => (current ? { ...current, columns: next } : current));
      }} /> : null}
    {confirmationDialog}
    {undo ? <div className={styles.undoBar} role="status">
      <span>{undo.label}</span>
      <Button size="compact" variant="quiet" onPress={() => { applyOps(undo.ops); setUndo(null); }}>{t("Undo")}</Button>
    </div> : null}
    {tradeFor ? <NameDialog title={t("New work package")} label={t("Name")} onClose={() => setTradeFor(null)} onSave={newTrade} /> : null}
    {openLine ? <LineDetails key={`${openLine.id}-${openLine.version}`} line={openLine} state={state} onClose={() => setOpen(null)}
      onSave={async (fields) => {
        try { const next = await api.apply([{ op: "upsert", line: { id: openLine.id, version: openLine.version, ...fields } }]); setState(next); setError(""); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); if (cause instanceof QuotationRequestError && cause.status === 409) await load(); return false; }
      }} /> : null}
  </section>;
}

type Panel = "assistant" | "catalog" | "comments" | "totals";
export type QuoteTab = "items" | "terms" | "payments" | "document" | "files";
/** Each area gets its own tint, in turn, so areas are told apart at a glance. */
const GROUP_TONES = ["info", "success", "warning", "brand", "neutral"] as const;
const GROUP_LABEL: Record<QuoteView, string> = { area: "Group by area", trade: "Group by trade", area_trade: "Group by area, then trade" };
const NARROW = "(max-width: 64rem)";
const readNarrow = () => window.matchMedia(NARROW).matches;
const subscribeNarrow = (notify: () => void) => { const query = window.matchMedia(NARROW); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };

const COLUMNS_KEY = "wodana.quote.columns";
const COLUMNS_DEFAULT = JSON.stringify({ picture: true, size: true, material: true });
const readColumns = () => { try { const saved = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "null"); return saved ? JSON.stringify({ ...JSON.parse(COLUMNS_DEFAULT), ...saved }) : COLUMNS_DEFAULT; } catch { return COLUMNS_DEFAULT; } };
const subscribeColumns = (notify: () => void) => { window.addEventListener(COLUMNS_KEY, notify); window.addEventListener("storage", notify); return () => { window.removeEventListener(COLUMNS_KEY, notify); window.removeEventListener("storage", notify); }; };
/** Starting widths (px) of the table's columns; the item column also takes any room left over. */
const COLUMN_WIDTHS: Record<string, number> = { gutter: 20, serial: 44, picture: 96, item: 280, pick: 160, length: 84, width: 84, height: 84, material: 200, qty: 72, unit: 92, rate: 112, amount: 132, menu: 56 };
/** Frozen while the sheet scrolls sideways: the item on one side, the quantity and money on the other. */
const STICKY_COLUMNS = new Set(["picture", "item", "qty", "unit", "rate", "amount"]);
const RESIZABLE = new Set(["picture", "item", "pick", "length", "width", "height", "material", "qty", "unit", "rate", "amount"]);
/** The grid's columns, in the order the cells are drawn. */
const gridKeys = (column: RowColumn, columns: RowColumns, custom: QuoteColumn[]) => ["gutter", "serial", ...(columns.picture ? ["picture"] : []), "item", ...(column ? ["pick"] : []),
  ...(columns.size ? ["length", "width", "height"] : []), ...(columns.material ? ["material"] : []), ...custom.map((item) => `custom:${item.id}`), "qty", "unit", "rate", "amount", "menu"];
/** The item column takes whatever room is left; its text wraps, so a long name never widens it. */
const gridColumns = (column: RowColumn, columns: RowColumns, width: (key: string) => number, custom: QuoteColumn[]) => gridKeys(column, columns, custom)
  .map((key) => (key === "item" ? `minmax(${width(key)}px, 1fr)` : `${width(key)}px`)).join(" ");
/**
 * The table's narrowest width: every column at its set width. Every area's rows share it (so the columns line up
 * across areas), and the table scrolls sideways only when the screen is narrower than this.
 */
const gridMinWidth = (column: RowColumn, columns: RowColumns, width: (key: string) => number, custom: QuoteColumn[]) => gridKeys(column, columns, custom)
  .reduce((total, key) => total + width(key), 0);
/** Lines picked from the catalog with no live price, still without a rate of their own. */
export const unpricedLines = (lines: BuilderLine[]) => lines.filter((line) => Boolean(line.catalogSnapshot?.priceReason) && line.pricingMode !== "build_up" && !Number(line.rate));

const EMPTY_LINE: BuilderLine = {
  id: "", position: 0, version: 0, kind: "item", areaId: null, fromAreaId: null, workPackageId: null, title: "", description: "", unit: "", quantity: "1",
  formula: null, formulaError: null, length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "0", unitCost: null, markupPercent: null,
  pricingMode: "rate", discountKind: null, discountValue: null, taxCode: null, taxRate: null, optional: null, optionGroup: null, note: "", catalogItemId: null,
  catalogSnapshot: null, buildUpComplete: null, updatedAt: "", updatedByName: null, components: [], imageAssetId: null, catalogImageId: null, material: "", values: {},
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
    } else if (op.op === "catalog") {
      // Choosing a catalog item on a line that exists: send the version we last saw, as an edit does.
      const known = version(op.line.id);
      out.push(known !== undefined && op.line.version === undefined ? { ...op, line: { ...op.line, version: known } } : op);
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
