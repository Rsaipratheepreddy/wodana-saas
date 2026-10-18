"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronRight, Folder, FolderPlus, Pencil, RotateCcw, Upload } from "lucide-react";
import { Badge, Button, DataGrid, IconButton, SegmentedControl, type DataGridColumn } from "@/design-system";
import { designStateLabels, mergeDesigns } from "@/lib/pre-project/design-workflow";
import { caseRequest, type CaseContent, type CaseDesign, type DesignFolder, type DesignOptions } from "@/lib/pre-project/content";
import { DesignFileDetails } from "./design-file-details";
import { FileCover } from "./design-file-preview";
import { DesignUpload, FolderEditor, type DesignUploadTarget } from "./design-forms";
import styles from "./case-content.module.css";
import view from "./designs.module.css";

const emptyOptions: DesignOptions = { folders: [], reviewers: [], actorId: "", canReview: false, canRecordClient: false };

type BoardStatus = "no_file" | "draft" | "internal_review" | "internal_approved" | "client_review" | "approved" | "changes_requested" | "rejected" | "expired" | "superseded";
type BoardRow = {
  id: string;
  room: string;
  roomId: string | null;
  scopeTitle: string;
  scopeEntryId: string | null;
  design: CaseDesign | null;
  status: BoardStatus;
  updatedAt: string;
  folderId: string | null;
};
type BoardView = "all" | "needs" | "internal" | "ready" | "client" | "approved";

const stageTone: Record<BoardStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  no_file: "warning", draft: "neutral", internal_review: "info", internal_approved: "warning", client_review: "info",
  approved: "success", changes_requested: "danger", rejected: "danger", expired: "warning", superseded: "neutral",
};
const stageLabel: Record<BoardStatus, string> = {
  ...designStateLabels as Record<BoardStatus, string>,
  no_file: "Needs design",
  internal_approved: "Ready for client",
  client_review: "With client",
};
const viewMatches: Record<BoardView, (status: BoardStatus) => boolean> = {
  all: () => true,
  needs: (status) => ["no_file", "changes_requested", "rejected", "expired"].includes(status),
  internal: (status) => status === "internal_review" || status === "draft",
  ready: (status) => status === "internal_approved",
  client: (status) => status === "client_review",
  approved: (status) => status === "approved",
};

function nextStep(row: BoardRow, options: DesignOptions, canEdit: boolean) {
  const reviewer = row.design?.versions[0]?.reviewerId;
  switch (row.status) {
    case "no_file": return canEdit ? "Upload design" : "No design yet";
    case "draft": return canEdit ? "Send for review" : "Draft";
    case "internal_review": return options.canReview && (!reviewer || reviewer === options.actorId) ? "Review now" : "In internal review";
    case "internal_approved": return canEdit ? "Send to client" : "Ready for client";
    case "client_review": return "Awaiting client decision";
    case "changes_requested": return canEdit ? "Upload revision" : "Changes requested";
    case "rejected": return canEdit ? "Upload revision" : "Rejected";
    case "expired": return canEdit ? "Resend to client" : "Review expired";
    default: return "Open";
  }
}

function dateLabel(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
}

/**
 * Design board: every included scope item is a row that must reach an approved
 * design before pricing. Files, reviews and client decisions live in the
 * details view; this board only answers "what still needs a design decision?".
 */
export function DesignsPage({ initialData, initialDesigns, options = emptyOptions }: {
  initialData: CaseContent;
  initialDesigns: CaseDesign[];
  options?: DesignOptions;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [data, setData] = useState(initialData);
  const [designs, setDesigns] = useState(initialDesigns);
  const [reviewOptions, setReviewOptions] = useState(options);
  const fileId = params.get("file");
  const [search, setSearch] = useState("");
  const [boardView, setBoardView] = useState<BoardView>("all");
  const [upload, setUpload] = useState<DesignUploadTarget | null>(null);
  const [organize, setOrganize] = useState<"scope" | "folders">("scope");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderEditor, setFolderEditor] = useState<DesignFolder | null>(null);
  const folders = reviewOptions.folders;
  const activeFolder = folders.find((f) => f.id === folderId) ?? null;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = designs.find((d) => d.id === fileId) ?? null;

  const applyListing = useCallback((listing: DesignOptions & { items: CaseDesign[] }) => {
    setDesigns((current) => mergeDesigns(current, listing.items));
    setReviewOptions((current) => ({ ...listing, folders: listing.folders.length ? listing.folders : current.folders }));
  }, []);
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const listing = await caseRequest<DesignOptions & { items: CaseDesign[] }>(initialData.workspaceId, initialData.caseId, "designs");
        if (active) { applyListing(listing); setError(""); }
      } catch { if (active) setError("Could not refresh designs. Your files are still shown below. Try Reload designs."); }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [initialData.workspaceId, initialData.caseId, applyListing]);

  const navigate = (file: string | null) => {
    const query = new URLSearchParams(params.toString());
    if (file) query.set("file", file); else query.delete("file");
    query.delete("tab"); query.delete("folder");
    window.history.pushState(null, "", pathname + (query.size ? "?" + query : ""));
  };
  const update = (saved: CaseDesign) => setDesigns((items) => mergeDesigns(items, [saved]));
  const reload = async () => {
    setLoading(true); setError("");
    try {
      const [fresh, listing] = await Promise.all([
        caseRequest<CaseContent>(data.workspaceId, data.caseId, "brief"),
        caseRequest<DesignOptions & { items: CaseDesign[] }>(data.workspaceId, data.caseId, "designs"),
      ]);
      setData(fresh); applyListing(listing);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load designs. Please try Reload designs."); }
    finally { setLoading(false); }
  };

  const roomName = useCallback((roomId: string | null) => data.rooms.find((room) => room.id === roomId)?.name ?? null, [data.rooms]);
  const rows = useMemo<BoardRow[]>(() => {
    const live = designs.filter((d) => !d.archivedAt);
    const scopeItems = data.entries.filter((entry) => entry.kind === "requirement" && entry.scopeStatus === "included" && !entry.archivedAt);
    const result: BoardRow[] = [];
    for (const entry of scopeItems) {
      const linked = live.filter((d) => d.scopeEntryId === entry.id);
      const room = roomName(entry.roomId) ?? "General";
      if (!linked.length) result.push({ id: `scope:${entry.id}`, room, roomId: entry.roomId, scopeTitle: entry.title, scopeEntryId: entry.id, design: null, status: "no_file", updatedAt: entry.updatedAt ?? "", folderId: null });
      for (const d of linked) result.push({ id: d.id, room, roomId: entry.roomId, scopeTitle: entry.title, scopeEntryId: entry.id, design: d, status: (d.versions[0]?.status ?? "no_file") as BoardStatus, updatedAt: d.updatedAt, folderId: d.folderId ?? null });
    }
    const scopeIds = new Set(scopeItems.map((entry) => entry.id));
    for (const d of live.filter((d) => !d.scopeEntryId || !scopeIds.has(d.scopeEntryId))) {
      result.push({ id: d.id, room: d.roomName ?? roomName(d.roomId) ?? "Whole home", roomId: d.roomId, scopeTitle: d.scopeTitle ?? "General design", scopeEntryId: d.scopeEntryId, design: d, status: (d.versions[0]?.status ?? "no_file") as BoardStatus, updatedAt: d.updatedAt, folderId: d.folderId ?? null });
    }
    return result.sort((a, b) => a.room.localeCompare(b.room) || a.scopeTitle.localeCompare(b.scopeTitle));
  }, [designs, data.entries, roomName]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(viewMatches) as BoardView[]).map((id) => [id, rows.filter((row) => viewMatches[id](row.status)).length])) as Record<BoardView, number>, [rows]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => (organize === "scope" || (row.design && (!folderId || (row.folderId ?? "unfiled") === folderId))) && viewMatches[boardView](row.status) && (!query || `${row.room} ${row.scopeTitle} ${row.design?.title ?? ""} ${row.design?.documentType ?? ""}`.toLocaleLowerCase().includes(query)));
  }, [rows, boardView, search, organize, folderId]);

  const openRow = (row: BoardRow) => {
    if (row.design) { navigate(row.design.id); return; }
    if (data.canEdit) setUpload({ folderId: null, roomId: row.roomId, scopeEntryId: row.scopeEntryId, name: `${row.room} · ${row.scopeTitle}` });
  };
  const reviewerName = (id?: string | null) => reviewOptions.reviewers.find((r) => r.id === id)?.name;
  const columns: DataGridColumn<BoardRow>[] = [
    { id: "room", header: "Room", size: 150, accessorFn: (row) => row.room, meta: { renderCell: (row) => <span className={view.roomCell}>{row.room}</span> } },
    { id: "scope", header: "Scope item", size: 230, accessorFn: (row) => row.scopeTitle, meta: { primary: true, renderCell: (row) => <span className={view.scopeCell}>{row.scopeTitle}</span> } },
    { id: "design", header: "Design", size: 300, accessorFn: (row) => row.design?.title ?? "", meta: { renderCell: (row) => row.design ? <span className={view.designCell}><FileCover data={data} design={row.design} /><span><strong>{row.design.title}</strong><small>{row.design.documentType} · R{row.design.versions[0]?.number ?? 0}</small></span></span> : <span className={view.muted}>No design uploaded</span> } },
    { id: "stage", header: "Stage", size: 150, accessorFn: (row) => stageLabel[row.status], filterFn: "equalsString", meta: { filterOptions: (Object.keys(stageLabel) as BoardStatus[]).map((status) => ({ id: stageLabel[status], label: stageLabel[status] })), renderCell: (row) => <Badge tone={stageTone[row.status]}>{stageLabel[row.status]}</Badge> } },
    { id: "with", header: "With", size: 150, accessorFn: (row) => row.status === "internal_review" ? reviewerName(row.design?.versions[0]?.reviewerId) ?? "Internal reviewer" : row.status === "client_review" ? "Client" : "", meta: { renderCell: (row) => row.status === "internal_review" ? reviewerName(row.design?.versions[0]?.reviewerId) ?? "Internal reviewer" : row.status === "client_review" ? "Client" : <span className={view.muted}>—</span> } },
    { id: "folder", header: "Folder", size: 150, accessorFn: (row) => folders.find((f) => f.id === row.folderId)?.name ?? (row.design ? "Unfiled" : ""), meta: { mobileHidden: true, renderCell: (row) => row.design ? <span className={view.roomCell}>{folders.find((f) => f.id === row.folderId)?.name ?? "Unfiled"}</span> : <span className={view.muted}>—</span> } },
    { id: "updated", header: "Updated", size: 110, accessorFn: (row) => row.updatedAt, meta: { mobileHidden: true, renderCell: (row) => dateLabel(row.updatedAt) } },
    { id: "next", header: "Next step", size: 190, enableSorting: false, meta: { align: "end", renderCell: (row) => {
      const label = nextStep(row, reviewOptions, data.canEdit);
      const actionable = data.canEdit || row.design;
      return actionable ? <span data-grid-interactive><Button aria-label={`${label}: ${row.scopeTitle}`} onPress={() => openRow(row)} size="compact" variant={["no_file", "changes_requested", "rejected", "internal_approved"].includes(row.status) || (row.status === "internal_review" && label === "Review now") ? "primary" : "quiet"}>{label}{row.design ? <ArrowUpRight aria-hidden="true" size={13} /> : <Upload aria-hidden="true" size={13} />}</Button></span> : <span className={view.muted}>{label}</span>;
    } } },
  ];
  const savedViews = [
    { id: "all", label: `All (${counts.all})` },
    { id: "needs", label: `Needs design (${counts.needs})` },
    { id: "internal", label: `Internal review (${counts.internal})` },
    { id: "ready", label: `Ready for client (${counts.ready})` },
    { id: "client", label: `With client (${counts.client})` },
    { id: "approved", label: `Approved (${counts.approved})` },
  ];

  if (selected) return <>
    <DesignFileDetails key={selected.id} data={data} design={selected} options={reviewOptions} folderName={selected.scopeTitle ?? selected.roomName ?? "Design board"} backLabel="Design board" onClose={() => navigate(null)} onUpdate={update} onReviewed={update} />
    {error ? <p role="alert" className={styles.error}>{error}<Button variant="quiet" size="compact" onPress={() => void reload()}>Reload designs</Button></p> : null}
  </>;

  const approvedShare = rows.length ? Math.round((counts.approved / rows.length) * 100) : 0;
  return <div className={view.board} aria-label="Design board">
    <div className={view.pulse}>
      <div className={view.pulseCopy}><strong>{counts.approved} of {rows.length} designs approved</strong><span>{counts.needs ? `${counts.needs} need a design or revision` : counts.client ? `${counts.client} waiting on the client` : counts.internal ? `${counts.internal} in internal review` : rows.length ? "Every scope item has an approved design" : "Add included scope items in Requirements to start the design board"}</span></div>
      <div className={view.progress} aria-hidden="true"><span style={{ inlineSize: `${approvedShare}%` }} /></div>
    </div>
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {fileId && !selected ? <p role="alert" className={styles.error}>This file could not be found. Reload designs or choose a row below.</p> : null}
    <div className={view.organize}>
      <SegmentedControl label="Organise designs" onChange={(value) => { setOrganize(value as "scope" | "folders"); setFolderId(null); }} options={[{ id: "scope", label: "By scope item" }, { id: "folders", label: "By folder" }]} value={organize} />
      {organize === "folders" && data.canEdit ? <Button onPress={() => setFolderEditor({ id: crypto.randomUUID(), version: 0, name: "", description: "", roomId: null, scopeEntryId: null })} size="compact"><FolderPlus aria-hidden="true" size={14} />New folder</Button> : null}
    </div>
    {organize === "folders" && !activeFolder && folderId !== "unfiled" ? <div aria-label="Design folders" className={view.folderGrid}>
      {[...folders, ...(designs.some((d) => !d.archivedAt && !d.folderId) ? [{ id: "unfiled", name: "Unfiled", description: "", roomId: null, scopeEntryId: null, version: 0 } as DesignFolder] : [])].map((f) => {
        const files = designs.filter((d) => !d.archivedAt && (d.folderId ?? "unfiled") === f.id);
        const approved = files.filter((d) => d.versions[0]?.status === "approved").length;
        const attention = files.filter((d) => ["changes_requested", "rejected", "expired"].includes(d.versions[0]?.status ?? "")).length;
        return <button aria-label={"Open folder " + f.name} className={view.folder} key={f.id} onClick={() => setFolderId(f.id)} type="button">
          <span className={view.folderTop}><Folder size={22} strokeWidth={1.5} /><span>{files.length} {files.length === 1 ? "file" : "files"}</span></span>
          <strong>{f.name}</strong>
          <small>{f.roomName ?? roomName(f.roomId) ?? "Whole home"}{f.scopeTitle ? ` · ${f.scopeTitle}` : ""}</small>
          <small className={attention ? view.needsChanges : undefined}>{attention ? `${attention} need changes` : `${approved} of ${files.length} approved`}</small>
          <ChevronRight className={view.folderArrow} size={16} />
        </button>;
      })}
      {!folders.length && !designs.some((d) => !d.archivedAt) ? <p className={view.muted}>No folders yet. Create one per room or item, or upload straight from the scope view.</p> : null}
    </div> : null}
    {organize === "folders" && (activeFolder || folderId === "unfiled") ? <div className={view.location}>
      <Button onPress={() => setFolderId(null)} size="compact" variant="quiet"><ChevronRight aria-hidden="true" data-directional="true" size={14} style={{ transform: "rotate(180deg)" }} />All folders</Button>
      <strong>{activeFolder?.name ?? "Unfiled"}</strong>
      {activeFolder && data.canEdit ? <Button aria-label="Edit folder" onPress={() => setFolderEditor(activeFolder)} size="compact" variant="quiet"><Pencil size={14} /></Button> : null}
      {activeFolder && data.canEdit ? <Button onPress={() => setUpload({ folderId: activeFolder.id, roomId: activeFolder.roomId, scopeEntryId: activeFolder.scopeEntryId, name: activeFolder.name })} size="compact" variant="primary"><Upload aria-hidden="true" size={14} />Add files</Button> : null}
    </div> : null}
    {organize === "scope" || activeFolder || folderId === "unfiled" ? <DataGrid
      ariaLabel="Design board"
      columns={columns}
      data={visible}
      emptyDescription={rows.length ? "Try another view or clear the search." : "Included scope items from Requirements appear here so every item reaches an approved design."}
      emptyTitle={rows.length ? "No designs in this view" : "No scope items to design yet"}
      exportFileName="design-board.csv"
      footerActions={<IconButton aria-label="Reload designs" isLoading={loading} onPress={() => void reload()} size="compact"><RotateCcw size={14} /></IconButton>}
      getRowId={(row) => row.id}
      onRowAction={openRow}
      onSearchChange={setSearch}
      onViewChange={(id) => setBoardView(id as BoardView)}
      pageSize={50}
      rowNumbers={false}
      savedViews={savedViews}
      searchLabel="Search designs"
      searchValue={search}
      selectable={false}
      selectedView={boardView}
      toolbarActions={data.canEdit && organize === "scope" ? <Button onPress={() => setUpload({ folderId: null, roomId: null, scopeEntryId: null, name: "Whole home" })} size="compact" variant="primary"><Upload aria-hidden="true" size={14} />Upload design</Button> : null}
    /> : null}
    {folderEditor ? <FolderEditor key={folderEditor.id} data={data} initial={folderEditor} folders={folders} onClose={() => setFolderEditor(null)} onSaved={(f) => { setReviewOptions((o) => ({ ...o, folders: [f, ...o.folders.filter((row) => row.id !== f.id)].sort((a, b) => a.name.localeCompare(b.name)) })); setFolderEditor(null); setFolderId(f.id); setMessage("Folder saved. Add files or upload from the scope view."); }} /> : null}
    {upload ? <DesignUpload data={data} target={upload} onClose={() => setUpload(null)} onSaved={(saved) => { setDesigns((current) => mergeDesigns(current, saved)); setUpload(null); setMessage(`${saved.length} ${saved.length === 1 ? "design" : "designs"} added. Send them for internal review when ready.`); }} /> : null}
  </div>;
}
