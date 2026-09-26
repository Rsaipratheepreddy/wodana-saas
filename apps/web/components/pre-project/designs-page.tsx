"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, FolderPlus, Pencil, Upload } from "lucide-react";
import { Avatar, Badge, Button, MenuButton } from "@/design-system";
import { mergeDesigns } from "@/lib/pre-project/design-workflow";
import { caseRequest, type CaseContent, type CaseDesign, type DesignFolder, type DesignOptions } from "@/lib/pre-project/content";
import { DesignReviewModal } from "./design-review-modal";
import { FileCover } from "./design-file-preview";
import { DesignUpload, FolderEditor, DesignMetadata, RevisionUpload, type DesignUploadTarget } from "./design-forms";
import styles from "./case-content.module.css";
import view from "./designs.module.css";

const emptyOptions: DesignOptions = { folders: [], reviewers: [], actorId: "", canReview: false, canRecordClient: false };

/** A simple folder and file browser; formal approval stays in its own workflow. */
export function DesignsPage({ initialData, initialDesigns, options = emptyOptions, ownerName, readOnlyReason, preserveNavigation = false }: {
  preserveNavigation?: boolean;
  ownerName?: string | null;
  readOnlyReason?: string;
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
  const [upload, setUpload] = useState<DesignUploadTarget | null>(null);
  const [editingFile,setEditingFile] = useState<CaseDesign|null>(null);
  const [revisionFile,setRevisionFile] = useState<CaseDesign|null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderEditor, setFolderEditor] = useState<DesignFolder | null>(null);
  const folders = reviewOptions.folders;
  const virtualFolders: DesignFolder[] = [];
  for (const d of designs.filter(d => !d.archivedAt && !d.folderId)) {
    const id = `linked:${d.scopeEntryId ?? d.roomId ?? 'general'}`;
    if (!virtualFolders.some(f => f.id === id)) virtualFolders.push({ id, version: 0, name: d.scopeTitle ?? data.entries.find(e => e.id === d.scopeEntryId)?.title ?? d.roomName ?? data.rooms.find(r => r.id === d.roomId)?.name ?? 'Project designs', description: '', roomId: d.roomId, scopeEntryId: d.scopeEntryId });
  }
  const displayFolders = [...folders, ...virtualFolders];
  const activeFolder = displayFolders.find((f) => f.id === folderId) ?? null;
  const inFolder = (d: CaseDesign, id: string) => id.startsWith('linked:') ? !d.folderId && `linked:${d.scopeEntryId ?? d.roomId ?? 'general'}` === id : d.folderId === id;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const folderFiles=activeFolder?designs.filter(d=>!d.archivedAt&&inFolder(d,activeFolder.id)):[];
  const folderReady=(folder:DesignFolder)=>{const files=designs.filter(d=>!d.archivedAt&&inFolder(d,folder.id));return Boolean(folder.approvedAt&&files.length&&JSON.stringify(files.map(d=>d.versions[0]?.id).sort())===JSON.stringify([...(folder.approvedVersions??[])].sort()));};
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
    if (!preserveNavigation) query.delete("tab");
    query.delete("folder");
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
  return <div className={view.board} aria-label="Design board">
    {selected && <DesignReviewModal data={{...data,canEdit:data.canEdit || Boolean(reviewOptions.canReview && reviewOptions.folders.find(f=>f.id===selected.folderId)?.reviewerId===reviewOptions.actorId)}} design={selected} options={reviewOptions} onClose={() => navigate(null)} onUpdate={update} />}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}<Button size="compact" isLoading={loading} onPress={()=>void reload()}>Reload designs</Button></p> : null}
    {fileId && !selected ? <p role="alert" className={styles.error}>This file could not be found. Reload designs or choose a row below.</p> : null}
    <div className={view.organize}>
      <strong>Design files</strong>
      <div className={view.displaySwitch}>
        {!activeFolder && data.canEdit && <Button size="compact" onPress={()=>setFolderEditor({id:crypto.randomUUID(),version:0,name:'',description:'',roomId:null,scopeEntryId:null})}><FolderPlus size={14}/>Add folder</Button>}
        {!activeFolder && data.canEdit && <Button size="compact" variant="primary" onPress={()=>setUpload({folderId:null,roomId:null,scopeEntryId:null,name:'Project designs'})}>Add files</Button>}
      </div>
    </div>
    {!activeFolder && folderId !== "unfiled" ? <div aria-label="Design folders" className={view.folderGrid}>
      {displayFolders.map((f) => {
        const files = designs.filter((d) => !d.archivedAt && inFolder(d, f.id));
        const approved = files.filter((d) => d.versions[0]?.status === "approved").length;
        const attention = files.filter((d) => ["changes_requested", "rejected", "expired"].includes(d.versions[0]?.status ?? "")).length;
        return <button aria-label={"Open folder " + f.name} className={view.folder} key={f.id} onClick={() => setFolderId(f.id)} type="button">
          <span className={view.folderArtwork} aria-hidden="true"><span /></span>
          <strong>{f.name}</strong>
          <small>{f.roomName ?? roomName(f.roomId) ?? ""}{f.scopeTitle ? ` · ${f.scopeTitle}` : ""}</small>
          <Badge tone={attention ? "warning" : files.length && approved === files.length ? "success" : "neutral"}>{folderReady(f) ? "Ready to send to client" : f.reviewerId ? "In review" : attention ? "Changes requested" : files.length && approved === files.length ? "Approved" : files.length ? "In progress" : "Empty"}</Badge>
          <span className={view.folderOwner} title={ownerName ? `Case owner: ${ownerName}` : 'No case owner assigned'}>{ownerName ? <><Avatar name={ownerName} size="sm"/><span>{ownerName}</span></> : <span>Unassigned</span>}</span>

        </button>;
      })}
      {!folders.length && !designs.some((d) => !d.archivedAt) ? <p className={view.muted}>No files yet. Add a folder or upload your first drawing.</p> : null}
    </div> : null}
    {(activeFolder || folderId === "unfiled") ? <div className={view.location}>
      <Button onPress={() => setFolderId(null)} size="compact" variant="quiet"><ChevronRight aria-hidden="true" data-directional="true" size={14} style={{ transform: "rotate(180deg)" }} />All folders</Button>
      <strong>{activeFolder?.name ?? "Unfiled"}</strong>
      {!data.canEdit && <small id="design-add-reason" className={view.muted}>{readOnlyReason ?? "Your role does not have permission to add files."}</small>}
      {activeFolder && !activeFolder.id.startsWith("linked:") && data.canEdit ? <Button aria-label="Edit folder" onPress={() => setFolderEditor(activeFolder)} size="compact" variant="quiet"><Pencil size={14} /></Button> : null}
      {activeFolder ? <Button isDisabled={!data.canEdit} aria-describedby={!data.canEdit ? "design-add-reason" : undefined} onPress={() => setUpload({ folderId: activeFolder.id.startsWith("linked:") ? null : activeFolder.id, roomId: activeFolder.roomId, scopeEntryId: activeFolder.scopeEntryId, name: activeFolder.name })} size="compact" variant="primary"><Upload aria-hidden="true" size={14} />Add files</Button> : null}
    </div> : null}
    {activeFolder ? <div className={view.fileGrid} aria-label="Folder files">
      {folderFiles.map(design => {
        const asset = design.versions[0]?.asset;
        const extension = asset?.name.split('.').pop()?.toUpperCase() ?? 'FILE';
        return <div key={design.id}><button type="button" className={view.fileTile} onClick={() => navigate(design.id)} aria-label={`Open file ${asset?.name ?? design.title}`}>
          <div className={view.fileThumbnail}><FileCover data={data} design={design}/></div>
          <strong title={asset?.name ?? design.title}>{asset?.name ?? design.title}</strong>
          <span className={view.fileType}>{extension} · R{design.versions[0]?.number ?? 1}</span>
          {design.description && <p title={design.description}>{design.description}</p>}
        </button>{data.canEdit && <MenuButton label="File actions" items={[{id:'edit',label:'Edit details'},{id:'revision',label:'Upload revision'}]} onAction={key=>key==='edit'?setEditingFile(design):setRevisionFile(design)}/>}</div>;
      })}
      {!folderFiles.length && <p className={view.muted}>No files in this folder yet.</p>}
    </div> : null}
    {editingFile&&<DesignMetadata data={data} design={editingFile} folders={folders} onClose={()=>setEditingFile(null)} onSaved={saved=>{update(saved);setEditingFile(null);}}/>}
    {revisionFile&&<RevisionUpload data={data} design={revisionFile} onClose={()=>setRevisionFile(null)} onSaved={saved=>{update(saved);setRevisionFile(null);}}/>}
    {folderEditor ? <FolderEditor onContentChange={setData} key={folderEditor.id} data={data} initial={folderEditor} folders={folders} onClose={() => setFolderEditor(null)} onSaved={(f) => { setReviewOptions((o) => ({ ...o, folders: [f, ...o.folders.filter((row) => row.id !== f.id)].sort((a, b) => a.name.localeCompare(b.name)) })); setFolderEditor(null); setFolderId(f.id); setMessage("Folder saved."); }} /> : null}
    {upload ? <DesignUpload data={data} target={upload} onClose={() => setUpload(null)} onSaved={(saved) => { setDesigns((current) => mergeDesigns(current, saved)); setUpload(null); setMessage(`${saved.length} ${saved.length === 1 ? "design" : "designs"} added.`); }} /> : null}
  </div>;
}
