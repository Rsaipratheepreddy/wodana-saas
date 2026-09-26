"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Camera, CirclePlay, ExternalLink, Globe, Heart, Pin, ImagePlus, Link2, Maximize2, Minus, Plus, StickyNote, ThumbsDown, X } from "lucide-react";
import { Badge, Button, ControlledModalDialog, EmptyState, IconButton, InlineNotice, MultiSelectField, SegmentedControl, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { blankEntry, caseApi, caseRequest, entryPayload, type CaseAsset, type CaseContent, type MoodboardPlacement, type ScopeEntry } from "@/lib/pre-project/content";
import { clampZoom, fitView, layoutPins, linkPlatform, pinKind, PIN_WIDTH, zoomAround } from "@/lib/pre-project/moodboard";
import styles from "./moodboard.module.css";

type View = { x: number; y: number; zoom: number };
type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; origin: MoodboardPlacement } | { id: null; mode: "pan"; startX: number; startY: number; origin: View };

/**
 * The moodboard: everything the client loves (or wants to avoid) on one board. Pins are photos,
 * links (Instagram, Pinterest, YouTube, any site) or notes; each can point to a room and to the
 * requirements it informs. Board view is a free canvas; grid view is for scanning.
 */
export function MoodboardPage({ initialData }: { initialData: CaseContent }) {
  const t = useT();
  const { workspaceId, caseId } = initialData;
  const [entries, setEntries] = useState(() => initialData.entries.filter((entry) => entry.kind === "inspiration" && !entry.archivedAt));
  const [placements, setPlacements] = useState(() => layoutPins(entries));
  const [mode, setMode] = useState<"board" | "grid">("board");
  const [room, setRoom] = useState("all");
  const [feeling, setFeeling] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<"link" | "note" | null>(null);
  const [view, setView] = useState<View>({ x: 48, y: 48, zoom: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const requirements = useMemo(() => initialData.entries.filter((entry) => entry.kind === "requirement" && !entry.archivedAt), [initialData.entries]);
  const canEdit = initialData.canEdit;

  const visible = entries.filter((entry) => (room === "all" || entry.roomId === room) && (feeling === "all" || (placements.get(entry.id)?.sentiment ?? "love") === feeling));
  const assetUrl = (asset: CaseAsset, preview = true) => caseApi(workspaceId, caseId, `assets/${asset.id}${preview ? "?preview=1" : ""}`);

  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (box) setView(fitView([...placements.values()], { width: box.width, height: box.height }));
  }, [placements]);
  useEffect(() => { if (mode === "board") fit(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLayout = async (ids: string[], override?: Map<string, MoodboardPlacement>) => {
    if (!canEdit) return;
    const pins = ids.map((id) => ({ entryId: id, ...(override?.get(id) ?? placements.get(id)!) })).map(({ entryId, x, y, width, z, sentiment }) => ({ entryId, x, y, width, z, sentiment }));
    try { await caseRequest(workspaceId, caseId, "moodboard/layout", "PUT", { pins }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("The board could not be saved.")); }
  };
  const place = (id: string, patch: Partial<MoodboardPlacement>) => setPlacements((current) => { const next = new Map(current); next.set(id, { ...current.get(id)!, ...patch }); return next; });
  const markFeeling = (id: string, sentiment: "love" | "avoid") => {
    const next = { ...placements.get(id)!, sentiment };
    place(id, next);
    void saveLayout([id], new Map([[id, next]]));
  };
  const topZ = () => Math.max(0, ...[...placements.values()].map((p) => p.z)) + 1;

  const saveEntry = async (entry: ScopeEntry) => {
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, "entries", "PUT", entryPayload(entry));
    setEntries((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    return saved;
  };
  /** New pins land in the middle of what's on screen, on top. */
  const dropPoint = (index = 0) => {
    const box = canvas.current?.getBoundingClientRect();
    const cx = box ? (box.width / 2 - view.x) / view.zoom : 0; const cy = box ? (box.height / 2 - view.y) / view.zoom : 0;
    return { x: Math.round(cx - PIN_WIDTH / 2 + index * 32), y: Math.round(cy - 120 + index * 32), width: PIN_WIDTH, z: topZ() + index, sentiment: "love" as const };
  };
  const create = async (draft: Partial<ScopeEntry>, index = 0) => {
    const entry: ScopeEntry = { ...blankEntry(room === "all" ? null : room), kind: "inspiration", category: "Inspiration", source: "team", requirementIds: [], ...draft };
    const saved = await saveEntry(entry);
    const spot = dropPoint(index);
    setPlacements((current) => new Map(current).set(saved.id, spot));
    await caseRequest(workspaceId, caseId, "moodboard/layout", "PUT", { pins: [{ entryId: saved.id, ...spot }] });
    return saved;
  };
  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      for (const [index, file] of [...files].entries()) {
        if (!file.type.startsWith("image/")) throw new Error(t("Add photos here; share videos as links."));
        const body = new FormData(); body.append("file", file);
        const asset = await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body);
        await create({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 240) || t("Photo"), assets: [asset] }, index);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("The photo could not be added.")); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };

  // Canvas gestures: drag a pin to move it, its corner to resize, the background to pan.
  const pointerDown = (event: ReactPointerEvent, id: string | null, action: "move" | "resize" | "pan") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
    if (id) { setSelected(id); if (!canEdit) return; drag.current = { id, mode: action as "move" | "resize", startX: event.clientX, startY: event.clientY, origin: placements.get(id)! }; }
    else { setSelected(null); drag.current = { id: null, mode: "pan", startX: event.clientX, startY: event.clientY, origin: view }; }
  };
  const pointerMove = (event: ReactPointerEvent) => {
    const current = drag.current; if (!current) return;
    const dx = event.clientX - current.startX; const dy = event.clientY - current.startY;
    if (current.mode === "pan") setView({ ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy });
    else if (current.mode === "move") place(current.id, { x: Math.round(current.origin.x + dx / view.zoom), y: Math.round(current.origin.y + dy / view.zoom) });
    else place(current.id, { width: Math.round(Math.min(960, Math.max(120, current.origin.width + dx / view.zoom))) });
  };
  const pointerUp = () => {
    const current = drag.current; drag.current = null; setDragging(false);
    if (!current?.id) return;
    const now = placements.get(current.id)!;
    if (now.x === current.origin.x && now.y === current.origin.y && now.width === current.origin.width) return;
    // A moved pin comes to the front.
    const moved = { ...now, z: topZ() };
    place(current.id, moved);
    void saveLayout([current.id], new Map([[current.id, moved]]));
  };
  const wheel = (event: ReactWheelEvent) => {
    if (mode !== "board") return;
    const box = canvas.current!.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) setView((current) => zoomAround(current, { x: event.clientX - box.left, y: event.clientY - box.top }, current.zoom * (1 - event.deltaY * 0.01)));
    else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };
  const nudge = (id: string, key: string, shift: boolean) => {
    const step = shift ? 40 : 8; const p = placements.get(id)!;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
    if (!delta || !canEdit) return false;
    place(id, { x: p.x + delta[0], y: p.y + delta[1] }); return true;
  };

  const selectedEntry = entries.find((entry) => entry.id === selected) ?? null;
  const rooms = [{ id: "all", label: t("All rooms") }, ...initialData.rooms.map((item) => ({ id: item.id, label: item.name }))];

  return <section className={styles.page} aria-label={t("Moodboard")}>
    <div className={styles.toolbar}>
      <SegmentedControl label={t("View")} value={mode} onChange={(value) => setMode(value as "board" | "grid")} options={[{ id: "board", label: t("Board") }, { id: "grid", label: t("Grid") }]} />
      <SelectField aria-label={t("Room")} accent="neutral" items={rooms} label={null} onSelectionChange={(key) => setRoom(String(key ?? "all"))} selectedKey={room} />
      <SegmentedControl label={t("Feeling")} value={feeling} onChange={setFeeling} options={[{ id: "all", label: t("All") }, { id: "love", label: t("Love") }, { id: "avoid", label: t("Avoid") }]} />
      <span className={styles.spacer} />
      {canEdit ? <div className={styles.addGroup} role="group" aria-label={t("Add to moodboard")}>
        <Button size="compact" isLoading={busy} onPress={() => upload.current?.click()}><ImagePlus aria-hidden="true" size={14} />{t("Photos")}</Button>
        <Button size="compact" onPress={() => setAdding("link")}><Link2 aria-hidden="true" size={14} />{t("Link")}</Button>
        <Button size="compact" variant="primary" onPress={() => setAdding("note")}><StickyNote aria-hidden="true" size={14} />{t("Note")}</Button>
        <input accept="image/*" aria-hidden="true" className={styles.hiddenInput} multiple onChange={(event) => void uploadPhotos(event.target.files)} ref={upload} tabIndex={-1} type="file" />
      </div> : null}
    </div>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    {!entries.length ? <div className={styles.empty}><EmptyState illustration="upload" title={t("Start the moodboard")} description={t("Add photos, Instagram or Pinterest links, videos and notes the client loves, or wants to avoid.")} /></div>
      : mode === "grid" ? <div className={styles.grid}>{visible.map((entry) => <div className={styles.gridItem} key={entry.id}><PinCard entry={entry} placement={placements.get(entry.id)} requirementCount={entry.requirementIds?.length ?? 0} assetUrl={assetUrl} selected={selected === entry.id} onSelect={() => setSelected(entry.id)} /><FeelingToggle value={placements.get(entry.id)?.sentiment ?? "love"} canEdit={canEdit} onChange={(value) => markFeeling(entry.id, value)} /></div>)}</div>
      : <div className={styles.canvas} ref={canvas} onPointerDown={(event) => pointerDown(event, null, "pan")} onPointerMove={pointerMove} onPointerUp={pointerUp} onWheel={wheel} data-dragging={dragging || undefined}>
        <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {visible.map((entry) => { const p = placements.get(entry.id)!; return <div className={styles.pin} key={entry.id} style={{ transform: `translate(${p.x}px, ${p.y}px)`, inlineSize: p.width, zIndex: p.z }}
            onPointerDown={(event) => pointerDown(event, entry.id, "move")}
            onKeyDown={(event) => { if (nudge(entry.id, event.key, event.shiftKey)) { event.preventDefault(); } if (event.key === "Escape") setSelected(null); }}
            onKeyUp={(event) => { if (event.key.startsWith("Arrow")) void saveLayout([entry.id]); }}>
            <PinCard entry={entry} placement={p} requirementCount={entry.requirementIds?.length ?? 0} assetUrl={assetUrl} selected={selected === entry.id} onSelect={() => setSelected(entry.id)} />
            <FeelingToggle value={p.sentiment} canEdit={canEdit} onChange={(value) => markFeeling(entry.id, value)} />
            {canEdit ? <span aria-hidden="true" className={styles.resize} onPointerDown={(event) => pointerDown(event, entry.id, "resize")} /> : null}
          </div>; })}
        </div>
        <div className={styles.zoom} onPointerDown={(event) => event.stopPropagation()}>
          <IconButton aria-label={t("Zoom out")} size="compact" onPress={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom - 0.1) }))}><Minus size={14} /></IconButton>
          <span aria-live="polite">{Math.round(view.zoom * 100)}%</span>
          <IconButton aria-label={t("Zoom in")} size="compact" onPress={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom + 0.1) }))}><Plus size={14} /></IconButton>
          <IconButton aria-label={t("Fit to screen")} size="compact" onPress={fit}><Maximize2 size={14} /></IconButton>
        </div>
      </div>}
    {selectedEntry ? <PinInspector key={selectedEntry.id} entry={selectedEntry} placement={placements.get(selectedEntry.id)!} rooms={initialData.rooms} requirements={requirements} canEdit={canEdit} assetUrl={assetUrl}
      onClose={() => setSelected(null)}
      onFeeling={(sentiment) => markFeeling(selectedEntry.id, sentiment)}
      onSave={async (next) => { await saveEntry(next); }}
      onRemove={async () => { await caseRequest(workspaceId, caseId, `entries/${selectedEntry.id}`, "PATCH", { version: selectedEntry.version, archived: true }); setEntries((current) => current.filter((item) => item.id !== selectedEntry.id)); setSelected(null); }} /> : null}
    {adding ? <AddPinDialog kind={adding} onClose={() => setAdding(null)} onAdd={async (draft) => { await create(draft); setAdding(null); }} /> : null}
  </section>;
}

/** Love or avoid, right on the card: set in one click, always visible once chosen. */
function FeelingToggle({ value, canEdit, onChange }: { value: "love" | "avoid"; canEdit: boolean; onChange: (value: "love" | "avoid") => void }) {
  const t = useT();
  return <span className={styles.feelingToggle} data-value={value} role="group" aria-label={t("Feeling")} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" aria-label={t("Love")} aria-pressed={value === "love"} disabled={!canEdit} onClick={() => onChange("love")}><Heart aria-hidden="true" size={14} /></button>
    <button type="button" aria-label={t("Avoid")} aria-pressed={value === "avoid"} disabled={!canEdit} onClick={() => onChange("avoid")}><ThumbsDown aria-hidden="true" size={14} /></button>
  </span>;
}

function PlatformIcon({ id }: { id: string }) {
  const Icon = id === "instagram" ? Camera : id === "pinterest" ? Pin : ["youtube", "tiktok"].includes(id) ? CirclePlay : Globe;
  return <span aria-hidden="true" className={styles.platformIcon}><Icon size={16} /></span>;
}

function PinCard({ entry, placement, requirementCount, assetUrl, selected, onSelect }: { entry: ScopeEntry; placement?: MoodboardPlacement; requirementCount: number; assetUrl: (asset: CaseAsset) => string; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const kind = pinKind(entry);
  const image = entry.assets.find((asset) => asset.mimeType.startsWith("image/"));
  const platform = entry.referenceUrl ? linkPlatform(entry.referenceUrl) : null;
  return <button type="button" className={styles.card} data-kind={kind} data-selected={selected || undefined} data-avoid={placement?.sentiment === "avoid" || undefined} onClick={onSelect} aria-label={entry.title}>
    {kind === "image" && image ? <Image alt="" className={styles.photo} draggable={false} height={360} src={assetUrl(image)} unoptimized width={480} /> : null}
    {kind === "link" && platform ? <span className={styles.link} data-platform={platform.id}><PlatformIcon id={platform.id} /><strong>{platform.label}</strong><small>{platform.host}</small></span> : null}
    <span className={styles.caption}>
      {kind === "note" ? <span className={styles.noteText}>{entry.note || entry.title}</span> : <strong>{entry.title}</strong>}
      <span className={styles.meta}>
        {placement?.sentiment === "avoid" ? <Badge tone="danger">{t("Avoid")}</Badge> : null}
        {entry.source === "client" ? <Badge tone="info">{t("Client")}</Badge> : null}
        {entry.roomName ? <span>{entry.roomName}</span> : null}
        {requirementCount ? <span>{t("{count} linked", { count: requirementCount })}</span> : null}
        {entry.assets.length > 1 ? <span>+{entry.assets.length - 1}</span> : null}
      </span>
    </span>
  </button>;
}

function PinInspector({ entry, placement, rooms, requirements, canEdit, assetUrl, onClose, onFeeling, onSave, onRemove }: {
  entry: ScopeEntry; placement: MoodboardPlacement; rooms: CaseContent["rooms"]; requirements: ScopeEntry[]; canEdit: boolean; assetUrl: (asset: CaseAsset, preview?: boolean) => string;
  onClose: () => void; onFeeling: (sentiment: "love" | "avoid") => void; onSave: (entry: ScopeEntry) => Promise<void>; onRemove: () => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry);
  const set = <K extends keyof ScopeEntry>(key: K) => (value: ScopeEntry[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save.")); } finally { setBusy(false); } };
  return <aside className={styles.inspector} aria-label={t("Pin details")}>
    <header className={styles.inspectorHead}><strong>{t("Pin")}</strong><IconButton aria-label={t("Close")} size="compact" onPress={onClose}><X size={14} /></IconButton></header>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    {entry.assets.filter((asset) => asset.mimeType.startsWith("image/")).length ? <div className={styles.inspectorPhotos}>{entry.assets.map((asset) => <a key={asset.id} href={assetUrl(asset, false)} target="_blank" rel="noreferrer"><Image alt={asset.name} height={160} src={assetUrl(asset)} unoptimized width={160} /></a>)}</div> : null}
    <div className={styles.feeling} role="group" aria-label={t("Feeling")}>
      <Button size="compact" variant={placement.sentiment === "love" ? "primary" : "secondary"} isDisabled={!canEdit} onPress={() => onFeeling("love")}><Heart aria-hidden="true" size={13} />{t("Love")}</Button>
      <Button size="compact" variant={placement.sentiment === "avoid" ? "primary" : "secondary"} isDisabled={!canEdit} onPress={() => onFeeling("avoid")}><ThumbsDown aria-hidden="true" size={13} />{t("Avoid")}</Button>
    </div>
    <TextInput isDisabled={!canEdit} label={t("Title")} maxLength={240} onChange={set("title")} value={draft.title} />
    <TextAreaField isDisabled={!canEdit} label={t("Note")} maxLength={3000} onChange={set("note")} value={draft.note} />
    <TextInput isDisabled={!canEdit} inputType="url" label={t("Link")} maxLength={2000} onChange={set("referenceUrl")} placeholder="https://" value={draft.referenceUrl} />
    {draft.referenceUrl ? <a className={styles.openLink} href={draft.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={13} />{t("Open")} {linkPlatform(draft.referenceUrl).label}</a> : null}
    <SelectField isDisabled={!canEdit} items={[{ id: "", label: t("Whole project") }, ...rooms.map((item) => ({ id: item.id, label: item.name }))]} label={t("Room")} onSelectionChange={(key) => set("roomId")(key ? String(key) : null)} selectedKey={draft.roomId ?? ""} />
    <MultiSelectField label={t("Requirements it informs")} items={requirements.map((item) => ({ id: item.id, label: item.title }))} selectedKeys={new Set(draft.requirementIds ?? [])} onSelectionChange={(keys) => set("requirementIds")([...keys].map(String))} />
    <p className={styles.provenance}>{entry.source === "client" ? t("Added by the client") : entry.createdByName ? t("Added by {name}", { name: entry.createdByName }) : null}</p>
    {canEdit ? <footer className={styles.inspectorFoot}>
      <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void run(onRemove)}>{t("Remove")}</Button>
      <Button size="compact" variant="primary" isDisabled={!dirty || !draft.title.trim()} isLoading={busy} onPress={() => void run(() => onSave(draft))}>{t("Save")}</Button>
    </footer> : null}
  </aside>;
}

function AddPinDialog({ kind, onClose, onAdd }: { kind: "link" | "note"; onClose: () => void; onAdd: (draft: Partial<ScopeEntry>) => Promise<void> }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    if (kind === "link" && !/^https?:\/\/\S+$/i.test(url.trim())) { setError(t("Paste a full link starting with https://")); return; }
    if (kind === "note" && !note.trim()) { setError(t("Write the note first.")); return; }
    setBusy(true); setError("");
    try {
      const platform = kind === "link" ? linkPlatform(url.trim()) : null;
      await onAdd(kind === "link" ? { referenceUrl: url.trim(), title: (title.trim() || platform!.label).slice(0, 240), note } : { title: note.trim().slice(0, 80), note: note.trim() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not add it.")); setBusy(false); }
  };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button><Button isLoading={busy} onPress={() => void add()} variant="primary">{t("Add")}</Button></div>}
    isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={kind === "link" ? t("Add a link") : t("Add a note")}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void add(); }}>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      {kind === "link" ? <>
        <TextInput autoFocus inputType="url" isRequired label={t("Link")} onChange={setUrl} placeholder="https://www.instagram.com/…" value={url} />
        <TextInput label={t("Title")} maxLength={240} onChange={setTitle} value={title} />
        <TextAreaField label={t("Why it's here")} maxLength={3000} onChange={setNote} value={note} />
      </> : <TextAreaField autoFocus isRequired label={t("Note")} maxLength={3000} onChange={setNote} value={note} />}
    </form>
  </ControlledModalDialog>;
}
