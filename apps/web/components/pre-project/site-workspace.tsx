"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Camera, DoorOpen, ExternalLink, Eye, FileText, Pencil, PenLine, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, IconButton, InlineNotice, InspectorSheet, SelectField, Tabs, useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { blankEntry, caseApi, caseRequest, entryPayload, type CaseAsset, type CaseContent, type CaseRoom, type ItemDimension, type ScopeEntry } from "@/lib/pre-project/content";
import { newSiteRecord, siteLabel, sitePayload, type SiteData, type SiteRecord } from "@/lib/pre-project/site";
import { AssetMarkup } from "./asset-markup";
import { RoomPicker } from "./room-manager";
import { measuredDimensions, SiteRecordEditor } from "./site-record-editor";
import { openSiteVisit, type JourneyView } from "@/lib/pre-project/design-workspace";
import { ScheduleVisitDialog } from "./design-journey";
import { accessMatters, SiteVisitFlow, siteVisitProgress } from "./site-visit-flow";
import { AccessPointsEditor, FitCheckList } from "@/components/catalog/fit-check-panel";
import type { LedgerView } from "@/lib/pre-project/design-decisions";
import styles from "./site-workspace.module.css";

const paths = { visit: "visits", measurement: "measurements", observation: "observations" } as const;
const NO_ROOM = "no-room";
type Area = { id: string; roomId: string | null; name: string };
const MEASURE_ORDER = ["incomplete", "recheck", "measured", "verified"];
type Photo = { entry: ScopeEntry; asset: CaseAsset };
type DetailTab = "details" | "photos" | "notes";

/** The measurements every room needs; the surveyor fills what applies. Units follow the record. */
export function roomDimensions(unit = "m"): ItemDimension[] {
  return ["Wall A", "Wall B", "Wall C", "Wall D", "Ceiling height"].map((name) => ({ id: crypto.randomUUID(), name, unit, basis: "site_opening", approximate: null, measured: null, source: "team", evidence: "" }));
}

/**
 * Site: everything gathered on site, a card per room: its measurement state, key dimensions, photos and
 * plans (drawn on straight after upload) and the issues spotted, with the visits on top. A card opens the
 * room's sheet (details, photos, notes); Edit opens the measurement form. It starts empty: the surveyor adds
 * each room (from the catalog) as they reach it.
 */
export function SiteWorkspace({ initialData, initialSite, locale }: { initialData: CaseContent; initialSite: SiteData; locale?: string }) {
  const t = useT();
  const [data, setData] = useState(initialData);
  const [site, setSite] = useState(initialSite);
  const [roomFilter, setRoomFilter] = useState("all");
  const [editing, setEditing] = useState<SiteRecord | null>(null);
  const [marking, setMarking] = useState<Photo | null>(null);
  const [queue, setQueue] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picking, setPicking] = useState(false);
  const [started, setStarted] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ areaId: string; tab: DetailTab } | null>(null);
  const { locale: designLocale } = useDesignSystem();
  const upload = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const { workspaceId, caseId, canEdit } = data;
  // PLM-048/128: while the design journey's site visit is open, the visit runs here as one guided flow.
  const [journey, setJourney] = useState<JourneyView | null>(null);
  const [visitOpen, setVisitOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const loadJourney = useCallback(() => caseRequest<JourneyView>(workspaceId, caseId, "design-journey").then(setJourney).catch(() => setJourney(null)), [workspaceId, caseId]);
  useEffect(() => { void loadJourney(); }, [loadJourney]);
  // The open visit: the old order's site visit stage, or the design site measure inside the concept (PLM-141).
  const visitStage = openSiteVisit(journey);
  // R5 fit check: the way in (access points) and how the case's chosen catalog items get through it.
  const [access, setAccess] = useState<{ count: number; unit: string } | null>(null);
  const [accessRefresh, setAccessRefresh] = useState(0);
  const [fitRefresh, setFitRefresh] = useState(0);
  const [fitItems, setFitItems] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    caseRequest<LedgerView>(workspaceId, caseId, "design-ledger").then((ledger) => {
      if (live) setFitItems([...new Set(ledger.entries.filter((entry) => !entry.archivedAt).map((entry) => entry.current?.catalogItemId).filter((id): id is string => Boolean(id)))]);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [workspaceId, caseId]);
  const accessChanged = (fromVisit: boolean) => { if (fromVisit) setAccessRefresh((value) => value + 1); setFitRefresh((value) => value + 1); };
  const assetUrl = (asset: CaseAsset, preview = true) => caseApi(workspaceId, caseId, `assets/${asset.id}${preview && asset.hasPreview ? "?preview=1" : ""}`);

  const files = data.entries.filter((entry) => entry.kind === "file" && !entry.archivedAt);
  // Only rooms with something captured, or just added here; nothing is listed up front.
  const areas: Area[] = useMemo(() => {
    const captured = new Set<string | null>([...files.map((entry) => entry.roomId ?? null), ...site.items.filter((record) => record.kind !== "visit").map((record) => record.roomId ?? null)]);
    const rooms = data.rooms.filter((room) => captured.has(room.id) || started.includes(room.id)).map((room) => ({ id: room.id, roomId: room.id, name: room.name }));
    return captured.has(null) ? [...rooms, { id: NO_ROOM, roomId: null, name: t("Not in a room") }] : rooms;
  }, [data.rooms, files, site.items, started, t]);
  const shown = areas.filter((area) => roomFilter === "all" || area.id === roomFilter);
  const photosIn = (area: Area): Photo[] => files.filter((entry) => (entry.roomId ?? null) === area.roomId).flatMap((entry) => entry.assets.slice(0, 1).map((asset) => ({ entry, asset })));
  const roomMeasurement = (area: Area) => site.items.find((record) => record.kind === "measurement" && !record.entryId && (record.roomId ?? null) === area.roomId);
  // Items measured in the room (a wall opening, a niche) count for it too, so a room is never shown unmeasured beside a verified item.
  const itemMeasurements = (area: Area) => area.roomId ? site.items.filter((record) => record.kind === "measurement" && record.entryId && record.roomId === area.roomId) : [];
  /** The room's measurement state: its own set, else its item sets, led by the least advanced one. */
  const roomState = (area: Area) => roomMeasurement(area) ?? [...itemMeasurements(area)].sort((a, b) => MEASURE_ORDER.indexOf(a.status) - MEASURE_ORDER.indexOf(b.status))[0];
  /** Photos filed to the room plus the evidence attached to its measurements. */
  const photoCount = (area: Area) => photosIn(area).length + [roomMeasurement(area), ...itemMeasurements(area)].reduce((sum, record) => sum + (record?.assetIds.length ?? 0), 0);
  const issuesIn = (area: Area) => site.items.filter((record) => record.kind === "observation" && (record.roomId ?? null) === area.roomId);
  const visits = site.items.filter((record) => record.kind === "visit").sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  // PLM-128: a recorded visit says "Done" only when every room it captured is measured with a photo; otherwise it says what is missing.
  const capturedRooms = areas.filter((area) => area.roomId);
  const unmeasured = capturedRooms.filter((area) => !["measured", "verified"].includes(roomState(area)?.status ?? "")).length;
  const unphotographed = capturedRooms.filter((area) => !photoCount(area)).length;
  const visitBadge = (visit: SiteRecord): { tone: StatusTone; label: string } => visit.status === "cancelled" ? { tone: "neutral", label: t("Cancelled") }
    : visit.status !== "completed" ? { tone: "info", label: t("Planned") }
    : unmeasured ? { tone: "warning", label: unmeasured === 1 ? t("Visit recorded · 1 room not measured") : t("Visit recorded · {count} rooms not measured", { count: unmeasured }) }
    : unphotographed ? { tone: "warning", label: unphotographed === 1 ? t("Visit recorded · 1 room without photos") : t("Visit recorded · {count} rooms without photos", { count: unphotographed }) }
    : { tone: "success", label: t("Done") };

  const upsertRecord = (saved: SiteRecord) => setSite((current) => ({ ...current, items: [saved, ...current.items.filter((record) => record.id !== saved.id)] }));
  const saveEntry = async (entry: ScopeEntry) => {
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, "entries", "PUT", entryPayload(entry));
    setData((current) => ({ ...current, entries: current.entries.some((item) => item.id === saved.id) ? current.entries.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.entries] }));
    return saved;
  };

  /** Upload photos or plans into a room; photos open straight into the drawing tool, one after another. */
  const addFiles = async (list: FileList | null) => {
    const roomId = uploadTarget.current === NO_ROOM ? null : uploadTarget.current;
    if (!list?.length) return;
    setBusy(`upload:${uploadTarget.current}`); setError(""); setNotice("");
    const added: Photo[] = []; const failed: string[] = [];
    for (const file of [...list]) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") { failed.push(file.name); continue; }
      try {
        const body = new FormData(); body.append("file", file);
        const asset = await caseRequest<CaseAsset>(workspaceId, caseId, `assets/${crypto.randomUUID()}`, "POST", body);
        const entry = await saveEntry({ ...blankEntry(roomId), kind: "file", category: "Site", title: file.name.replace(/\.[^.]+$/, "").slice(0, 240) || t("Site photo"), assets: [asset] });
        added.push({ entry, asset });
      } catch { failed.push(file.name); }
    }
    if (failed.length) setError(t("These could not be added: {files}. Add photos or PDF plans.", { files: failed.join(", ") }));
    const photos = added.filter((item) => item.asset.mimeType.startsWith("image/"));
    if (photos.length && canEdit) { setMarking(photos[0]); setQueue(photos.slice(1)); }
    else if (added.length) setNotice(t("{count} added.", { count: added.length }));
    setBusy(null);
    if (upload.current) upload.current.value = "";
    void loadJourney();
  };
  const pickFiles = (area: Area) => { uploadTarget.current = area.id; upload.current?.click(); };

  /** The drawn photo sits first on the record; the original stays with it. */
  const markupSaved = async (photo: Photo, marked: CaseAsset) => {
    const entry = data.entries.find((item) => item.id === photo.entry.id) ?? photo.entry;
    await saveEntry({ ...entry, assets: [marked, ...entry.assets.filter((asset) => asset.id !== marked.id)] });
    nextMarkup();
  };
  const nextMarkup = () => { const [next, ...rest] = queue; setMarking(next ?? null); setQueue(rest); if (!next) setNotice(t("Photos saved.")); };

  const measure = (area: Area) => {
    const existing = roomMeasurement(area);
    setEditing(existing ?? { ...newSiteRecord("measurement", site.timezone, area.roomId), title: area.name, dimensions: roomDimensions() });
  };
  const startRoom = (room: CaseRoom) => {
    setData((current) => current.rooms.some((item) => item.id === room.id) ? current : { ...current, rooms: [...current.rooms, room] });
    setStarted((current) => current.includes(room.id) ? current : [...current, room.id]);
    setRoomFilter("all"); setPicking(false);
    requestAnimationFrame(() => document.getElementById(`site-room-${room.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };
  const addIssue = (area: Area) => setEditing({ ...newSiteRecord("observation", site.timezone, area.roomId), title: "" });

  const dimensionText = (record?: SiteRecord) => measuredDimensions(record?.dimensions).map((d) => `${d.name} ${d.measured ?? d.approximate} ${d.unit}`);
  const when = (iso?: string, zone?: string) => { if (!iso) return ""; try { return new Intl.DateTimeFormat(locale ?? designLocale, { timeZone: zone ?? site.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const shortDate = (iso?: string | null) => { if (!iso) return ""; try { return new Intl.DateTimeFormat(locale ?? designLocale, { timeZone: site.timezone, day: "numeric", month: "short" }).format(new Date(iso)); } catch { return ""; } };
  /** The room's measurement state as a chip: its status, with the day it got there. */
  const measureChip = (record?: SiteRecord) => {
    if (!record) return { tone: "neutral" as const, label: t("Not measured") };
    const day = shortDate(record.status === "verified" ? record.verifiedAt ?? record.updatedAt : record.updatedAt);
    const label = siteLabel(t, record.status);
    return { tone: record.status === "verified" ? "success" as const : record.status === "recheck" ? "warning" as const : record.status === "measured" ? "info" as const : "neutral" as const,
      label: day ? t("{status} · {date}", { status: label, date: day }) : label };
  };
  const detailArea = detail ? areas.find((area) => area.id === detail.areaId) ?? null : null;
  /** Leave the room's sheet, then act (a form or the drawing tool opens on its own). */
  const fromDetail = (action: () => void) => { setDetail(null); action(); };

  return <section className={styles.page} aria-label={t("Site")}>
    <div className={styles.toolbar}>
      {areas.length > 1 ? <SelectField aria-label={t("Room")} accent="neutral" items={[{ id: "all", label: t("All rooms") }, ...areas.map((area) => ({ id: area.id, label: area.name }))]} label={null} onSelectionChange={(key) => setRoomFilter(String(key ?? "all"))} selectedKey={roomFilter} /> : null}
      <span className={styles.spacer} />
      {canEdit ? <Button size="compact" onPress={() => setEditing(newSiteRecord("visit", site.timezone))}><CalendarPlus aria-hidden="true" size={14} />{t("Plan visit")}</Button> : null}
      {canEdit && areas.length ? <Button size="compact" variant="primary" onPress={() => setPicking(true)}><Plus aria-hidden="true" size={14} />{t("Add room")}</Button> : null}
      <input accept="image/*,application/pdf" aria-hidden="true" className={styles.hiddenInput} multiple onChange={(event) => void addFiles(event.target.files)} ref={upload} tabIndex={-1} type="file" />
    </div>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}

    {visitStage && journey ? (() => {
      const progress = siteVisitProgress({ ...journey, stages: [visitStage] });
      const steps = [progress.visit, progress.measurements, progress.photos, progress.questions].filter(Boolean).length;
      return <Card title={t("Site visit")} chip={<Badge tone={visitStage.overdue ? "danger" : "info"}>{visitStage.overdue ? t("Overdue") : t("{done} of {total} steps", { done: steps, total: 4 })}</Badge>}
        action={canEdit ? <Button size="compact" variant="primary" onPress={() => setVisitOpen(true)}>{steps ? t("Continue the visit") : t("Start the visit")}</Button> : undefined}>
        <p className={styles.none}>{journey.siteEvidenceProblem ?? journey.siteChecklistProblem ?? t("Everything is in. Complete the visit.")}</p>
      </Card>;
    })() : null}
    {visits.length ? <section className={styles.visits} aria-label={t("Visits")}>
      {visits.map((visit) => <button type="button" key={visit.id} className={styles.visit} data-status={visit.status} onClick={() => setEditing(visit)}>
        <strong>{visit.title || t("Site visit")}</strong>
        <span>{when(visit.scheduledAt, visit.timezone)}{visit.assigneeName ? ` · ${visit.assigneeName}` : ""}</span>
        {(() => { const badge = visitBadge(visit); return <Badge tone={badge.tone}>{badge.label}</Badge>; })()}
      </button>)}
    </section> : null}

    {shown.length ? <ul className={styles.rooms} aria-label={t("Rooms")}>{shown.map((area) => {
      const photos = photosIn(area); const measurement = roomMeasurement(area); const issues = issuesIn(area);
      const dims = measurement ? dimensionText(measurement) : itemMeasurements(area).flatMap((record) => dimensionText(record));
      const open = issues.filter((issue) => issue.status !== "resolved").length;
      const chip = area.roomId ? measureChip(roomState(area)) : null;
      return <li key={area.id}><article className={styles.room} id={`site-room-${area.id}`} aria-label={area.name}>
        <header className={styles.roomHead}>
          <button type="button" className={styles.roomName} onClick={() => setDetail({ areaId: area.id, tab: "details" })}><DoorOpen aria-hidden="true" size={16} /><span>{area.name}</span></button>
          <span className={styles.quickActions}>
            <IconButton aria-label={t("View {name}", { name: area.name })} size="compact" variant="quiet" onPress={() => setDetail({ areaId: area.id, tab: "details" })}><Eye size={15} /></IconButton>
            {canEdit && area.roomId ? <IconButton aria-label={measurement ? t("Edit measurements of {name}", { name: area.name }) : t("Measure {name}", { name: area.name })} size="compact" variant="quiet" onPress={() => measure(area)}><Pencil size={15} /></IconButton> : null}
            {canEdit ? <IconButton aria-label={t("Add photos to {name}", { name: area.name })} size="compact" variant="quiet" isDisabled={busy === `upload:${area.id}`} onPress={() => pickFiles(area)}><Camera size={15} /></IconButton> : null}
          </span>
        </header>
        {chip ? <span className={styles.roomState}><Badge tone={chip.tone}>{chip.label}</Badge></span> : null}
        <dl className={styles.facts}>
          {area.roomId ? <div><dt>{t("Dimensions")}</dt><dd>{dims.length ? <>{dims.slice(0, 3).join(" · ")}{dims.length > 3 ? ` · ${t("+{count} more", { count: dims.length - 3 })}` : ""}</> : <span className={styles.none}>{t("None yet")}</span>}</dd></div> : null}
          <div><dt>{t("Photos")}</dt><dd>{photoCount(area)}</dd></div>
          <div><dt>{t("Issues")}</dt><dd>{issues.length ? <span data-warn={open > 0 || undefined}>{open ? t("{count} open", { count: open }) : t("All resolved")}</span> : 0}</dd></div>
          {measurement?.note ? <div><dt>{t("Notes")}</dt><dd className={styles.clamp}>{measurement.note}</dd></div> : null}
        </dl>
        {photos.length ? <ul className={styles.thumbs} aria-label={t("Photos")}>{photos.slice(0, 4).map((photo, index) => <li key={photo.entry.id}>
          <button type="button" className={styles.thumb} aria-label={t("Open {name}", { name: photo.entry.title })} onClick={() => setDetail({ areaId: area.id, tab: "photos" })}>
            {photo.asset.mimeType.startsWith("image/") ? <Image alt="" height={120} src={assetUrl(photo.asset)} unoptimized width={160} /> : <FileText aria-hidden="true" size={20} />}
            {index === 3 && photos.length > 4 ? <span className={styles.more}>+{photos.length - 4}</span> : null}
          </button>
        </li>)}</ul> : canEdit ? <button type="button" className={styles.drop} onClick={() => pickFiles(area)}>
          <Camera aria-hidden="true" size={16} /><span>{t("Add photos of every wall, and any plan")}</span>
        </button> : null}
      </article></li>;
    })}</ul> : null}

    {!areas.length ? <EmptyState illustration="upload" title={t("Nothing captured on site yet")} description={t("Add each room as you reach it, then its photos, measurements and issues.")}
      action={canEdit ? <Button size="compact" variant="primary" onPress={() => setPicking(true)}><Plus aria-hidden="true" size={14} />{t("Add room")}</Button> : undefined} /> : null}
    <Card title={t("Access")}>
      <AccessPointsEditor workspaceId={workspaceId} caseId={caseId} canEdit={canEdit} refreshKey={accessRefresh} onChanged={() => accessChanged(false)} onLoaded={(points, unit) => setAccess({ count: points.length, unit })} />
    </Card>
    {fitItems.length ? <Card title={t("Fit check")}>
      <FitCheckList workspaceId={workspaceId} caseId={caseId} itemIds={fitItems} unit={access?.unit} canOverride={canEdit} context="approval" refreshKey={fitRefresh} />
    </Card> : null}
    {detailArea ? <RoomDetail area={detailArea} tab={detail!.tab} onTab={(tab) => setDetail({ areaId: detailArea.id, tab })} onClose={() => setDetail(null)} canEdit={canEdit}
      chip={detailArea.roomId ? measureChip(roomState(detailArea)) : null} measurement={roomMeasurement(detailArea)} photos={photosIn(detailArea)} issues={issuesIn(detailArea)} assetUrl={assetUrl}
      onMeasure={() => fromDetail(() => measure(detailArea))} onAddPhotos={() => fromDetail(() => pickFiles(detailArea))} onAddIssue={() => fromDetail(() => addIssue(detailArea))}
      onIssue={(issue) => fromDetail(() => setEditing(issue))} onDraw={(photo) => fromDetail(() => { setQueue([]); setMarking(photo); })} /> : null}
    {picking ? <RoomPicker data={data} exclude={areas.map((area) => area.id)} onClose={() => setPicking(false)} onPick={startRoom} /> : null}

    {marking ? <AssetMarkup key={marking.asset.id} workspaceId={workspaceId} caseId={caseId} asset={marking.asset} assetUrl={assetUrl} onClose={nextMarkup} onSaved={(marked) => void markupSaved(marking, marked).catch((failure: Error) => setError(failure.message))} /> : null}
    {editing ? <SiteRecordEditor key={editing.id} initial={editing} data={data} site={site} onClose={() => setEditing(null)} onRoomAdded={(room) => setData((current) => ({ ...current, rooms: [...current.rooms, room] }))}
      onSave={async (record, version) => { upsertRecord(await caseRequest<SiteRecord>(workspaceId, caseId, `site/${paths[record.kind]}`, "PUT", sitePayload(record, version))); setEditing(null); setNotice(t("Saved.")); void loadJourney(); }} /> : null}
    {visitOpen && visitStage && journey ? <SiteVisitFlow view={journey} stage={visitStage} onClose={() => setVisitOpen(false)} onBook={() => setBooking(true)}
      access={{ workspaceId, caseId, canEdit, count: access?.count ?? null, nudge: accessMatters(journey), onChanged: () => accessChanged(true), onLoaded: (count) => setAccess((current) => ({ count, unit: current?.unit ?? "cm" })) }}
      onMeasure={(roomId) => { setVisitOpen(false); const area = areas.find((item) => item.roomId === roomId); if (area) measure(area); else setPicking(true); }}
      onAddPhotos={(roomId) => { setVisitOpen(false); const area = areas.find((item) => item.roomId === roomId); if (area) pickFiles(area); }}
      onSaveAnswers={async (answers) => setJourney(await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/site-visit/answers", "PUT", { version: visitStage.version, answers }))}
      onApplies={canEdit ? async (group, applies) => setJourney(await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/checklists/applies", "PUT",
        { scope: group.scope, applies, version: group.choiceVersion ?? 0 })) : undefined}
      onComplete={async (summary) => { setJourney(await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/site-visit/complete", "POST", { version: visitStage.version, summary })); setVisitOpen(false); setNotice(t("Site visit completed.")); }} /> : null}
    {booking && visitStage && journey ? <ScheduleVisitDialog title={t("Book site visit")} timezone={journey.timezone} onClose={() => setBooking(false)}
      onSubmit={async (value) => { setJourney(await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/site-visit/schedule", "POST", { version: visitStage.version, ...value })); setBooking(false); }} /> : null}
  </section>;
}

/** One room's sheet: its measurements, photos and notes, with the room's actions at its foot. */
function RoomDetail({ area, tab, onTab, onClose, canEdit, chip, measurement, photos, issues, assetUrl, onMeasure, onAddPhotos, onAddIssue, onIssue, onDraw }: {
  area: Area; tab: DetailTab; onTab: (tab: DetailTab) => void; onClose: () => void; canEdit: boolean; chip: { tone: StatusTone; label: string } | null; measurement?: SiteRecord;
  photos: Photo[]; issues: SiteRecord[]; assetUrl: (asset: CaseAsset, preview?: boolean) => string;
  onMeasure: () => void; onAddPhotos: () => void; onAddIssue: () => void; onIssue: (issue: SiteRecord) => void; onDraw: (photo: Photo) => void;
}) {
  const t = useT();
  const dims = measuredDimensions(measurement?.dimensions);
  // The usual basis (the site opening) goes unsaid; only a different one is named.
  const basis = (value: string) => value === "finished_item" ? t("Finished item") : t("Fabrication / cut size");
  const qualifiers = (d: ItemDimension) => [d.measured == null ? t("Approximate") : null, d.basis !== "site_opening" ? basis(d.basis) : null, d.source === "client" ? t("Client supplied") : null].filter(Boolean).join(" · ");
  const details = <div className={styles.sheetSection}>
    {chip ? <Badge tone={chip.tone}>{chip.label}</Badge> : null}
    {area.roomId ? dims.length ? <dl className={styles.dimensionList}>{dims.map((d) => <div key={d.id}>
      <dt>{d.name}</dt>
      <dd><strong>{d.measured ?? d.approximate} {d.unit}</strong>{qualifiers(d) ? <span>{qualifiers(d)}</span> : null}</dd>
    </div>)}</dl> : <EmptyState illustration={null} title={t("Not measured yet")} action={canEdit ? <Button size="compact" variant="primary" onPress={onMeasure}>{t("Measure")}</Button> : undefined} />
      : <p className={styles.none}>{t("Files here aren't in a room.")}</p>}
  </div>;
  const photoPanel = photos.length ? <ul className={styles.sheetPhotos}>{photos.map((photo) => <li key={photo.entry.id} className={styles.photo}>
    {photo.asset.mimeType.startsWith("image/") ? <a href={assetUrl(photo.asset, false)} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: photo.entry.title })}>
      <Image alt="" height={240} src={assetUrl(photo.asset)} unoptimized width={320} />
    </a> : <a className={styles.pdf} href={assetUrl(photo.asset, false)} target="_blank" rel="noreferrer"><FileText aria-hidden="true" size={22} /><span>{photo.asset.name}</span></a>}
    <span className={styles.photoFoot}>
      <span className={styles.photoName}>{photo.entry.title}</span>
      {photo.entry.assets.length > 1 ? <Badge tone="info">{t("Marked")}</Badge> : null}
      {canEdit && photo.asset.mimeType.startsWith("image/") ? <IconButton aria-label={t("Draw on {name}", { name: photo.entry.title })} size="compact" variant="quiet" onPress={() => onDraw(photo)}><PenLine size={14} /></IconButton>
        : <a className={styles.openOriginal} href={assetUrl(photo.asset, false)} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: photo.asset.name })}><ExternalLink aria-hidden="true" size={14} /></a>}
    </span>
  </li>)}</ul> : <EmptyState illustration={null} title={t("No photos yet")} action={canEdit ? <Button size="compact" variant="primary" onPress={onAddPhotos}><Camera aria-hidden="true" size={14} />{t("Add photos")}</Button> : undefined} />;
  const notes = <div className={styles.sheetSection}>
    {measurement?.note ? <p className={styles.note}>{measurement.note}</p> : null}
    {issues.length ? <ul className={styles.issues}>{issues.map((issue) => <li key={issue.id}><button type="button" onClick={() => onIssue(issue)} data-status={issue.status}>
      <AlertTriangle aria-hidden="true" size={14} /><strong>{issue.title}</strong>{issue.note ? <span className={styles.issueNote}>{issue.note}</span> : null}
      <Badge tone={issue.status === "resolved" ? "success" : "warning"}>{issue.status === "resolved" ? t("Resolved") : t("Open")}</Badge>
    </button></li>)}</ul> : null}
    {!measurement?.note && !issues.length ? <EmptyState illustration={null} title={t("No notes or issues yet")} action={canEdit ? <Button size="compact" variant="primary" onPress={onAddIssue}><Plus aria-hidden="true" size={14} />{t("Issue")}</Button> : undefined} /> : null}
  </div>;
  return <InspectorSheet isOpen onOpenChange={(open) => { if (!open) onClose(); }} size="lg" title={area.name}
    footer={canEdit ? <div className={styles.sheetActions}>
      <Button size="compact" onPress={onAddIssue}><Plus aria-hidden="true" size={14} />{t("Issue")}</Button>
      <Button size="compact" onPress={onAddPhotos}><Camera aria-hidden="true" size={14} />{t("Add photos")}</Button>
      {area.roomId ? <Button size="compact" variant="primary" onPress={onMeasure}><Pencil aria-hidden="true" size={14} />{measurement ? t("Edit measurements") : t("Measure")}</Button> : null}
    </div> : undefined}>
    <Tabs selectedKey={tab} onSelectionChange={(key) => onTab(key as DetailTab)} items={[
      { id: "details", label: t("Details"), panel: details },
      { id: "photos", label: t("Photos"), count: photos.length || undefined, panel: photoPanel },
      { id: "notes", label: t("Notes"), count: issues.length || undefined, panel: notes },
    ]} />
  </InspectorSheet>;
}
