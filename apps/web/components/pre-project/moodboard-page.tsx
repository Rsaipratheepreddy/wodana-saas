"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Heart, ImagePlus, Link2, Maximize2, StickyNote, ThumbsDown, X } from "lucide-react";
import { PlatformMark } from "@/components/brand/platform-mark";
import { Badge, Button, EmptyState, FormDialog, IconButton, InlineNotice, MenuButton, MultiSelectField, SegmentedControl, SelectField, Switch, TextAreaField, TextInput } from "@/design-system";
import { ClientFeedback, FeedbackSignals, feedbackFor, useClientBoard, type ClientBoard } from "@/components/client-activity/client-feedback";
import { useT } from "@/lib/i18n/i18n-provider";
import { blankEntry, caseApi, caseRequest, entryPayload, type CaseAsset, type CaseContent, type CaseRoom, type ScopeEntry } from "@/lib/pre-project/content";
import { linkPlatform, pinKind } from "@/lib/pre-project/moodboard";
import { RoomField } from "./room-manager";
import styles from "./moodboard.module.css";

type Feeling = "love" | "avoid";
const feelingOf = (entry: ScopeEntry): Feeling => entry.board?.sentiment ?? "love";
const images = (entry: ScopeEntry) => entry.assets.filter((asset) => asset.mimeType.startsWith("image/"));

/**
 * The moodboard: what the client loves, or wants to avoid, in one scannable grid. Pins are photos,
 * links (Instagram, Pinterest, YouTube, any site) or notes; each names who added it, its room and
 * the requirements it informs. Photos open full size. Pins the team shows in the client's portal, and
 * the ones the client adds there, carry the client's likes, dislikes and comments; `?pin=` opens one.
 */
export function MoodboardPage({ initialData, clientName }: { initialData: CaseContent; clientName?: string }) {
  const t = useT();
  const { workspaceId, caseId, canEdit } = initialData;
  const [entries, setEntries] = useState(() => initialData.entries.filter((entry) => entry.kind === "inspiration" && !entry.archivedAt));
  const [room, setRoom] = useState("all");
  const [caseRooms, setCaseRooms] = useState(initialData.rooms);
  const [feeling, setFeeling] = useState("all");
  const [source, setSource] = useState("all");
  const linkedPin = useSearchParams()?.get("pin") ?? null;
  const [selected, setSelected] = useState<string | null>(() => linkedPin && entries.some((entry) => entry.id === linkedPin) ? linkedPin : null);
  const [viewing, setViewing] = useState<{ entryId: string; index: number } | null>(null);
  const [adding, setAdding] = useState<"link" | "note" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const requirements = useMemo(() => initialData.entries.filter((entry) => entry.kind === "requirement" && !entry.archivedAt), [initialData.entries]);
  const requirementName = useMemo(() => new Map(requirements.map((entry) => [entry.id, entry.title])), [requirements]);
  const roomName = (entry: ScopeEntry) => caseRooms.find((item) => item.id === entry.roomId)?.name ?? entry.roomName ?? null;
  const addedBy = (entry: ScopeEntry) => entry.fromClient ? (entry.createdByName || clientName || t("Client"))
    : entry.source === "client" ? (clientName || t("Client")) : (entry.createdByName || t("Team"));
  const client = useClientBoard(workspaceId, caseId);
  const shared = (entry: ScopeEntry) => Boolean(client.board?.shared.includes(entry.id));
  /** The client sees pins the team shared and the ones someone on their side added. */
  const seenByClient = (entry: ScopeEntry) => Boolean(entry.fromClient) || shared(entry);
  useEffect(() => {
    if (linkedPin) document.getElementById(`pin-${linkedPin}`)?.scrollIntoView?.({ block: "center" });
  }, [linkedPin]);
  const assetUrl = (asset: CaseAsset, preview = true) => caseApi(workspaceId, caseId, `assets/${asset.id}${preview && asset.hasPreview ? "?preview=1" : ""}`);

  const visible = entries.filter((entry) => (room === "all" || entry.roomId === room)
    && (feeling === "all" || feelingOf(entry) === feeling)
    && (source === "all" || entry.source === source));
  const filtered = room !== "all" || feeling !== "all" || source !== "all";
  // Show or hide the team's pins in view (the filters choose them); the client's own pins are always theirs to see.
  const teamInView = visible.filter((entry) => !entry.fromClient);
  const toShow = teamInView.filter((entry) => !shared(entry)).map((entry) => entry.id);
  const toHide = teamInView.filter(shared).map((entry) => entry.id);
  const shareMany = async (ids: string[], show: boolean) => {
    if (!ids.length) return;
    setError("");
    try { await client.share(ids, show); } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); }
  };

  const replace = (saved: ScopeEntry) => setEntries((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
  const saveEntry = async (entry: ScopeEntry) => {
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, "entries", "PUT", entryPayload(entry));
    replace({ ...saved, board: saved.board ?? entry.board ?? null });
    return saved;
  };
  /** Love / avoid is stored with the pin's placement, so changing it never rewrites the pin. */
  const markFeeling = async (entry: ScopeEntry, sentiment: Feeling) => {
    if (!canEdit || feelingOf(entry) === sentiment) return;
    const board = { x: entry.board?.x ?? 0, y: entry.board?.y ?? 0, width: entry.board?.width ?? 240, z: entry.board?.z ?? 0, sentiment };
    replace({ ...entry, board });
    try { await caseRequest(workspaceId, caseId, "moodboard/layout", "PUT", { pins: [{ entryId: entry.id, ...board }] }); }
    catch (failure) { replace(entry); setError(failure instanceof Error ? failure.message : t("Could not save.")); }
  };
  const create = async (draft: Partial<ScopeEntry>) => {
    const entry: ScopeEntry = { ...blankEntry(room === "all" ? null : room), kind: "inspiration", category: "Inspiration", source: "team", requirementIds: [], ...draft };
    return saveEntry(entry);
  };
  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError("");
    const failed: string[] = [];
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) { failed.push(file.name); continue; }
      try {
        const body = new FormData(); body.append("file", file);
        const asset = await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body);
        await create({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 240) || t("Photo"), assets: [asset] });
      } catch { failed.push(file.name); }
    }
    if (failed.length) setError(t("These could not be added: {files}. Add photos here; share videos as links.", { files: failed.join(", ") }));
    setBusy(false);
    if (upload.current) upload.current.value = "";
  };

  const selectedEntry = entries.find((entry) => entry.id === selected) ?? null;
  const viewingEntry = viewing ? entries.find((entry) => entry.id === viewing.entryId) ?? null : null;
  // Filter by the rooms pins are in; rooms themselves come from the catalog.
  const rooms = [{ id: "all", label: t("All rooms") }, ...caseRooms.filter((item) => entries.some((entry) => entry.roomId === item.id)).map((item) => ({ id: item.id, label: item.name }))];

  return <section className={styles.page} aria-label={t("Moodboard")}>
    <div className={styles.toolbar}>
      <SelectField aria-label={t("Room")} accent="neutral" items={rooms} label={null} onSelectionChange={(key) => setRoom(String(key ?? "all"))} selectedKey={room} />
      <SegmentedControl label={t("Feeling")} value={feeling} onChange={setFeeling} options={[{ id: "all", label: t("All") }, { id: "love", label: t("Love") }, { id: "avoid", label: t("Avoid") }]} />
      <SegmentedControl label={t("Added by")} value={source} onChange={setSource} options={[{ id: "all", label: t("Everyone") }, { id: "client", label: t("Client") }, { id: "team", label: t("Team") }]} />
      <span className={styles.count}>{visible.length === 1 ? t("1 pin") : t("{count} pins", { count: visible.length })}</span>
      <span className={styles.spacer} />
      {client.board?.canEdit && teamInView.length ? <MenuButton size="compact" label={t("Client portal")} onAction={(id) => void shareMany(id === "show" ? toShow : toHide, id === "show")} items={[
        ...(toShow.length ? [{ id: "show", label: t("Show {count} in the portal", { count: toShow.length }) }] : []),
        ...(toHide.length ? [{ id: "hide", label: t("Hide {count} from the portal", { count: toHide.length }) }] : []),
      ]} /> : null}
      {canEdit ? <div className={styles.addGroup} role="group" aria-label={t("Add to moodboard")}>
        <Button size="compact" isLoading={busy} onPress={() => upload.current?.click()}><ImagePlus aria-hidden="true" size={14} />{t("Photos")}</Button>
        <Button size="compact" onPress={() => setAdding("link")}><Link2 aria-hidden="true" size={14} />{t("Link")}</Button>
        <Button size="compact" variant="primary" onPress={() => setAdding("note")}><StickyNote aria-hidden="true" size={14} />{t("Note")}</Button>
        <input accept="image/*" aria-hidden="true" className={styles.hiddenInput} multiple onChange={(event) => void uploadPhotos(event.target.files)} ref={upload} tabIndex={-1} type="file" />
      </div> : null}
    </div>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    {client.board?.boards.length ? <SharedBoards caseId={caseId} client={client} /> : null}
    {!entries.length ? <div className={styles.empty}><EmptyState illustration="upload" title={t("Start the moodboard")} description={t("Add photos, Instagram or Pinterest links, videos and notes the client loves, or wants to avoid.")} /></div>
      : !visible.length ? <div className={styles.empty}><EmptyState illustration="search" title={t("Nothing matches these filters")} description={t("Try another room, feeling or person.")} action={filtered ? <Button size="compact" onPress={() => { setRoom("all"); setFeeling("all"); setSource("all"); }}>{t("Clear filters")}</Button> : undefined} /></div>
      : <div className={styles.content} data-panel={selectedEntry ? "open" : undefined}><div className={styles.grid}>{visible.map((entry) => <PinCard key={entry.id} entry={entry} room={roomName(entry)} addedBy={addedBy(entry)} requirementNames={(entry.requirementIds ?? []).map((id) => requirementName.get(id)).filter((name): name is string => Boolean(name))}
        assetUrl={assetUrl} selected={selected === entry.id} canEdit={canEdit} signals={<FeedbackSignals board={client.board} kind="pin" id={entry.id} shown={shared(entry)} />} onOpen={() => setSelected(entry.id)} onView={(index) => setViewing({ entryId: entry.id, index })} onFeeling={(value) => void markFeeling(entry, value)} />)}</div>
      {selectedEntry ? <PinPanel key={selectedEntry.id} entry={selectedEntry} client={client} shared={shared(selectedEntry)} seenByClient={seenByClient(selectedEntry)} roomContext={{ workspaceId, caseId, rooms: caseRooms, canEdit }} onRoomAdded={(added) => setCaseRooms((current) => [...current, added])} requirements={requirements} canEdit={canEdit} addedBy={addedBy(selectedEntry)} assetUrl={assetUrl}
      onClose={() => setSelected(null)} onView={(index) => setViewing({ entryId: selectedEntry.id, index })}
      onFeeling={(value) => void markFeeling(selectedEntry, value)}
      onSave={async (next) => { await saveEntry(next); setSelected(null); }}
      onRemove={async () => { await caseRequest(workspaceId, caseId, `entries/${selectedEntry.id}`, "PATCH", { version: selectedEntry.version, archived: true }); setEntries((current) => current.filter((item) => item.id !== selectedEntry.id)); setSelected(null); }} /> : null}</div>}
    {viewingEntry && images(viewingEntry).length ? <PhotoViewer entry={viewingEntry} start={viewing!.index} assetUrl={assetUrl} onClose={() => setViewing(null)} /> : null}
    {adding ? <AddPinDialog kind={adding} onClose={() => setAdding(null)} onAdd={async (draft) => { await create(draft); setAdding(null); }} /> : null}
  </section>;
}

function PlatformIcon({ id }: { id: string }) {
  return <span aria-hidden="true" className={styles.platformIcon}><PlatformMark platform={id} /></span>;
}

function FeelingToggle({ value, canEdit, onChange }: { value: Feeling; canEdit: boolean; onChange: (value: Feeling) => void }) {
  const t = useT();
  return <span className={styles.feelingToggle} data-value={value} role="group" aria-label={t("Feeling")}>
    <button type="button" aria-label={t("Love")} aria-pressed={value === "love"} disabled={!canEdit} onClick={() => onChange("love")}><Heart aria-hidden="true" size={14} /></button>
    <button type="button" aria-label={t("Avoid")} aria-pressed={value === "avoid"} disabled={!canEdit} onClick={() => onChange("avoid")}><ThumbsDown aria-hidden="true" size={14} /></button>
  </span>;
}

function PinCard({ entry, room, addedBy, requirementNames, assetUrl, selected, canEdit, signals, onOpen, onView, onFeeling }: {
  entry: ScopeEntry; room: string | null; addedBy: string; requirementNames: string[]; assetUrl: (asset: CaseAsset) => string; selected: boolean; canEdit: boolean;
  signals?: ReactNode; onOpen: () => void; onView: (index: number) => void; onFeeling: (value: Feeling) => void;
}) {
  const t = useT();
  const kind = pinKind(entry);
  const photos = images(entry);
  const platform = entry.referenceUrl ? linkPlatform(entry.referenceUrl) : null;
  const feeling = feelingOf(entry);
  return <article id={`pin-${entry.id}`} className={styles.card} data-kind={kind} data-selected={selected || undefined} data-avoid={feeling === "avoid" || undefined} aria-label={entry.title}>
    {kind === "image" && photos[0] ? <button type="button" className={styles.media} aria-label={t("View {name} full size", { name: entry.title })} onClick={() => onView(0)}>
      <Image alt="" className={styles.photo} height={360} src={assetUrl(photos[0])} unoptimized width={480} />
      <span aria-hidden="true" className={styles.expand}><Maximize2 size={14} /></span>
      {photos.length > 1 ? <span className={styles.photoCount}>+{photos.length - 1}</span> : null}
    </button> : null}
    {kind === "link" && platform ? <a className={styles.link} data-platform={platform.id} href={entry.referenceUrl} target="_blank" rel="noreferrer"><PlatformIcon id={platform.id} /><strong>{platform.label}</strong><small>{platform.host}</small><ExternalLink aria-hidden="true" className={styles.linkOut} size={14} /></a> : null}
    <button type="button" className={styles.body} onClick={onOpen} aria-label={t("Open details for {name}", { name: entry.title })}>
      {kind === "note" ? <span className={styles.noteText}>{entry.note || entry.title}</span> : <strong className={styles.cardTitle}>{entry.title}</strong>}
      {kind !== "note" && entry.note ? <span className={styles.cardNote}>{entry.note}</span> : null}
      {requirementNames.length || room ? <span className={styles.tags}>
        {room ? <span className={styles.tag} data-kind="room">{room}</span> : null}
        {requirementNames.map((name) => <span className={styles.tag} data-kind="requirement" key={name}>{name}</span>)}
      </span> : null}
    </button>
    <footer className={styles.cardFoot}>
      <span className={styles.chip} data-feeling={feeling}>{feeling === "avoid" ? t("Avoid") : t("Love")}</span>
      {entry.fromClient ? <Badge className={styles.fromClient} tone="info">{t("From client")}</Badge> : null}
      <span className={styles.byline} title={addedBy}>{entry.source === "client" ? t("From {name}", { name: addedBy }) : t("Added by {name}", { name: addedBy })}</span>
      <FeelingToggle value={feeling} canEdit={canEdit} onChange={onFeeling} />
      {signals}
    </footer>
  </article>;
}

function PinPanel({ entry, client, shared, seenByClient, roomContext, onRoomAdded, requirements, canEdit, addedBy, assetUrl, onClose, onView, onFeeling, onSave, onRemove }: {
  entry: ScopeEntry; client: ClientBoard; shared: boolean; seenByClient: boolean; roomContext: Pick<CaseContent, "workspaceId" | "caseId" | "rooms" | "canEdit">; onRoomAdded: (room: CaseRoom) => void; requirements: ScopeEntry[]; canEdit: boolean; addedBy: string; assetUrl: (asset: CaseAsset, preview?: boolean) => string;
  onClose: () => void; onView: (index: number) => void; onFeeling: (value: Feeling) => void; onSave: (entry: ScopeEntry) => Promise<void>; onRemove: () => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => { if (dirty) setConfirmDiscard(true); else onClose(); };
  const dirty = JSON.stringify({ ...draft, board: null }) !== JSON.stringify({ ...entry, board: null });
  const set = <K extends keyof ScopeEntry>(key: K) => (value: ScopeEntry[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); setBusy(false); } };
  const validLink = !draft.referenceUrl || /^https?:\/\/\S+$/i.test(draft.referenceUrl);
  const photos = images(entry);
  const feeling = feelingOf(entry);
  const [sharing, setSharing] = useState(false);
  const feedback = feedbackFor(client.board, "pin", entry.id);
  const share = async (show: boolean) => {
    setSharing(true); setError("");
    try { await client.share([entry.id], show); } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); }
    setSharing(false);
  };
  return <aside className={styles.panel} aria-label={t("Pin details")}>
    <header className={styles.panelHead}>
      <strong>{entry.title || t("Pin")}</strong>
      <IconButton aria-label={t("Close")} size="compact" onPress={requestClose}><X size={14} /></IconButton>
    </header>
    <div className={styles.panelBody}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      {photos.length ? <div className={styles.panelPhotos} data-count={Math.min(photos.length, 2)}>
        {photos.map((asset, index) => <button type="button" key={asset.id} className={styles.sheetPhoto} onClick={() => onView(index)} aria-label={t("View {name} full size", { name: asset.name })}>
          <Image alt="" height={600} src={assetUrl(asset)} unoptimized width={800} />
          <span aria-hidden="true" className={styles.expand}><Maximize2 size={14} /></span>
        </button>)}
      </div> : null}
      <div className={styles.sheetRow}>
        <span className={styles.chip} data-feeling={feeling}>{feeling === "avoid" ? t("Avoid") : t("Love")}</span>
        {entry.fromClient ? <Badge tone="info">{t("From client")}</Badge> : null}
        <FeelingToggle value={feeling} canEdit={canEdit} onChange={onFeeling} />
      </div>
      <p className={styles.byline}>{entry.source === "client" ? t("From {name}", { name: addedBy }) : t("Added by {name}", { name: addedBy })}</p>
      {client.board && !entry.fromClient ? <Switch isSelected={shared} isDisabled={!client.board.canEdit || sharing} onChange={(show) => void share(show)}>{t("Show in the client portal")}</Switch> : null}
      {client.board && (seenByClient || feedback.comments.length || feedback.likes.length || feedback.dislikes.length)
        ? <ClientFeedback board={client.board} kind="pin" id={entry.id} canReply={client.board.canEdit && seenByClient} onReply={client.reply} /> : null}
      <TextInput isDisabled={!canEdit} isRequired label={t("Title")} maxLength={240} onChange={set("title")} value={draft.title} errorMessage={!draft.title.trim() ? t("Give the pin a title.") : undefined} />
      <TextAreaField isDisabled={!canEdit} label={t("Note")} maxLength={3000} onChange={set("note")} value={draft.note} />
      <TextInput isDisabled={!canEdit} inputType="url" label={t("Link")} maxLength={2000} onChange={set("referenceUrl")} placeholder="https://" value={draft.referenceUrl} errorMessage={!validLink ? t("Paste a full link starting with https://") : undefined} />
      {draft.referenceUrl && validLink ? <a className={styles.openLink} href={draft.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={13} />{t("Open")} {linkPlatform(draft.referenceUrl).label}</a> : null}
      <RoomField data={roomContext} isDisabled={!canEdit} value={draft.roomId ?? null} onRoomAdded={onRoomAdded} onChange={(item) => setDraft((current) => ({ ...current, roomId: item.id, roomName: item.name }))} />
      {requirements.length ? <MultiSelectField label={t("Requirements it informs")} items={requirements.map((item) => ({ id: item.id, label: item.title }))} selectedKeys={new Set(draft.requirementIds ?? [])} onSelectionChange={(keys) => { if (canEdit) set("requirementIds")([...keys].map(String)); }} />
        : <p className={styles.hint}>{t("Add requirements to link this pin to them.")}</p>}
    </div>
    {canEdit ? <footer className={styles.panelFoot}>
      {confirmDiscard ? <><span>{t("Discard your changes?")}</span><span className={styles.spacer} /><Button size="compact" onPress={() => setConfirmDiscard(false)}>{t("Keep editing")}</Button><Button size="compact" variant="primary" onPress={onClose}>{t("Discard")}</Button></>
        : confirmRemove ? <><span>{t("Remove this pin?")}</span><span className={styles.spacer} /><Button size="compact" isDisabled={busy} onPress={() => setConfirmRemove(false)}>{t("Keep")}</Button><Button size="compact" variant="primary" isLoading={busy} onPress={() => void run(onRemove)}>{t("Remove")}</Button></>
        : <><Button size="compact" variant="quiet" isDisabled={busy} onPress={() => setConfirmRemove(true)}>{t("Remove")}</Button><span className={styles.spacer} /><Button size="compact" isDisabled={busy} onPress={requestClose}>{t("Cancel")}</Button><Button size="compact" variant="primary" isDisabled={!dirty || !draft.title.trim() || !validLink} isLoading={busy} onPress={() => void run(() => onSave(draft))}>{t("Save")}</Button></>}
    </footer> : null}
  </aside>;
}

/** The concept and material boards the client sees in the portal, with their reactions and comments; each opens in Design to reply. */
function SharedBoards({ caseId, client }: { caseId: string; client: ClientBoard }) {
  const t = useT();
  return <section className={styles.boards} aria-label={t("Boards the client sees")}>
    <h3 className={styles.boardsHead}>{t("Boards the client sees")}</h3>
    <ul className={styles.boardList}>{client.board!.boards.map((board) => <li key={board.id}>
      <Link className={styles.boardLink} href={`/workspace/pre-projects/cases/${caseId}/designs?file=${encodeURIComponent(board.designId)}`}>
        <strong>{board.title}</strong><span>{[t("R{number}", { number: board.number }), board.room].filter(Boolean).join(" · ")}</span>
      </Link>
      <FeedbackSignals board={client.board} kind="design" id={board.id} shown={false} />
    </li>)}</ul>
  </section>;
}

/** Photos full size: arrows and keys move between a pin's photos, Escape closes. */
function PhotoViewer({ entry, start, assetUrl, onClose }: { entry: ScopeEntry; start: number; assetUrl: (asset: CaseAsset, preview?: boolean) => string; onClose: () => void }) {
  const t = useT();
  const photos = images(entry);
  const [index, setIndex] = useState(Math.min(start, photos.length - 1));
  const close = useRef<HTMLButtonElement>(null);
  const step = (delta: number) => setIndex((current) => (current + delta + photos.length) % photos.length);
  useEffect(() => {
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(document.dir === "rtl" ? -1 : 1);
      if (event.key === "ArrowLeft") step(document.dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const photo = photos[index];
  return <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={entry.title} onClick={onClose}>
    <div className={styles.viewerBar} onClick={(event) => event.stopPropagation()}>
      <strong>{entry.title}</strong>
      {photos.length > 1 ? <span>{index + 1} / {photos.length}</span> : null}
      <span className={styles.spacer} />
      <a className={styles.viewerAction} href={assetUrl(photo, false)} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={14} />{t("Open original")}</a>
      <button ref={close} type="button" className={styles.viewerClose} aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
    </div>
    {/* eslint-disable-next-line @next/next/no-img-element -- full-size original, sized by the viewport */}
    <img alt={photo.name} className={styles.viewerImage} onClick={(event) => event.stopPropagation()} src={assetUrl(photo, false)} />
    {photos.length > 1 ? <>
      <button type="button" className={styles.viewerNav} data-side="start" aria-label={t("Previous photo")} onClick={(event) => { event.stopPropagation(); step(-1); }}><ChevronLeft size={22} /></button>
      <button type="button" className={styles.viewerNav} data-side="end" aria-label={t("Next photo")} onClick={(event) => { event.stopPropagation(); step(1); }}><ChevronRight size={22} /></button>
    </> : null}
  </div>;
}

function AddPinDialog({ kind, onClose, onAdd }: { kind: "link" | "note"; onClose: () => void; onAdd: (draft: Partial<ScopeEntry>) => Promise<void> }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const add = async () => {
    if (kind === "link" && !/^https?:\/\/\S+$/i.test(url.trim())) throw new Error(t("Paste a full link starting with https://"));
    if (kind === "note" && !note.trim()) throw new Error(t("Write the note first."));
    const platform = kind === "link" ? linkPlatform(url.trim()) : null;
    await onAdd(kind === "link" ? { referenceUrl: url.trim(), title: (title.trim() || platform!.label).slice(0, 240), note } : { title: note.trim().slice(0, 80), note: note.trim() });
  };
  return <FormDialog title={kind === "link" ? t("Add a link") : t("Add a note")} onClose={onClose} isDirty={Boolean(url.trim() || title.trim() || note.trim())} submitLabel={t("Add")} onSubmit={add}>
    {kind === "link" ? <>
      <TextInput inputType="url" isRequired label={t("Link")} onChange={setUrl} placeholder="https://www.instagram.com/…" value={url} />
      <TextInput label={t("Title")} maxLength={240} onChange={setTitle} value={title} />
      <TextAreaField label={t("Why it's here")} maxLength={3000} onChange={setNote} value={note} />
    </> : <TextAreaField isRequired label={t("Note")} maxLength={3000} onChange={setNote} value={note} />}
  </FormDialog>;
}
