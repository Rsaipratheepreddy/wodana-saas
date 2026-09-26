"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Camera, FileText, Pencil, PenLine, Plus, Ruler } from "lucide-react";
import { Badge, Button, EmptyState, InlineNotice, SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { blankEntry, caseApi, caseRequest, entryPayload, type CaseAsset, type CaseContent, type ItemDimension, type ScopeEntry } from "@/lib/pre-project/content";
import { newSiteRecord, sitePayload, type SiteData, type SiteRecord } from "@/lib/pre-project/site";
import { AssetMarkup } from "./asset-markup";
import { SiteRecordEditor } from "./site-record-editor";
import styles from "./site-workspace.module.css";

const paths = { visit: "visits", measurement: "measurements", observation: "observations" } as const;
const WHOLE = "whole";
type Area = { id: string; roomId: string | null; name: string };
type Photo = { entry: ScopeEntry; asset: CaseAsset };

/** The measurements every room needs; the surveyor fills what applies. Units follow the record. */
export function roomDimensions(unit = "m"): ItemDimension[] {
  return ["Wall A", "Wall B", "Wall C", "Wall D", "Ceiling height"].map((name) => ({ id: crypto.randomUUID(), name, unit, basis: "site_opening", approximate: null, measured: null, source: "team", evidence: "" }));
}

/**
 * Site: everything gathered on site, room by room. Photos and plans (drawn on straight after
 * upload), the room's measurements and the issues spotted, with the visits on top.
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
  const upload = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const { workspaceId, caseId, canEdit } = data;
  const assetUrl = (asset: CaseAsset, preview = true) => caseApi(workspaceId, caseId, `assets/${asset.id}${preview && asset.hasPreview ? "?preview=1" : ""}`);

  const areas: Area[] = useMemo(() => [...data.rooms.map((room) => ({ id: room.id, roomId: room.id, name: room.name })), { id: WHOLE, roomId: null, name: t("Whole project") }], [data.rooms, t]);
  const shown = areas.filter((area) => roomFilter === "all" || area.id === roomFilter);
  const files = data.entries.filter((entry) => entry.kind === "file" && !entry.archivedAt);
  const photosIn = (area: Area): Photo[] => files.filter((entry) => (entry.roomId ?? null) === area.roomId).flatMap((entry) => entry.assets.slice(0, 1).map((asset) => ({ entry, asset })));
  const roomMeasurement = (area: Area) => site.items.find((record) => record.kind === "measurement" && !record.entryId && (record.roomId ?? null) === area.roomId);
  const issuesIn = (area: Area) => site.items.filter((record) => record.kind === "observation" && (record.roomId ?? null) === area.roomId);
  const visits = site.items.filter((record) => record.kind === "visit").sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  const upsertRecord = (saved: SiteRecord) => setSite((current) => ({ ...current, items: [saved, ...current.items.filter((record) => record.id !== saved.id)] }));
  const saveEntry = async (entry: ScopeEntry) => {
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, "entries", "PUT", entryPayload(entry));
    setData((current) => ({ ...current, entries: current.entries.some((item) => item.id === saved.id) ? current.entries.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.entries] }));
    return saved;
  };

  /** Upload photos or plans into a room; photos open straight into the drawing tool, one after another. */
  const addFiles = async (list: FileList | null) => {
    const roomId = uploadTarget.current === WHOLE ? null : uploadTarget.current;
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
    if (failed.length) setError(`${t("These could not be added")}: ${failed.join(", ")}. ${t("Add photos or PDF plans.")}`);
    const photos = added.filter((item) => item.asset.mimeType.startsWith("image/"));
    if (photos.length && canEdit) { setMarking(photos[0]); setQueue(photos.slice(1)); }
    else if (added.length) setNotice(t("{count} added.", { count: added.length }));
    setBusy(null);
    if (upload.current) upload.current.value = "";
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
  const addIssue = (area: Area) => setEditing({ ...newSiteRecord("observation", site.timezone, area.roomId), title: "" });

  const dimensionText = (record?: SiteRecord) => (record?.dimensions ?? []).filter((d) => d.measured != null || d.approximate != null).map((d) => `${d.name} ${d.measured ?? d.approximate} ${d.unit}`);
  const when = (iso?: string, zone?: string) => { if (!iso) return ""; try { return new Intl.DateTimeFormat(locale, { timeZone: zone ?? site.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };

  return <section className={styles.page} aria-label={t("Site")}>
    <div className={styles.toolbar}>
      <SelectField aria-label={t("Room")} accent="neutral" items={[{ id: "all", label: t("All rooms") }, ...areas.map((area) => ({ id: area.id, label: area.name }))]} label={null} onSelectionChange={(key) => setRoomFilter(String(key ?? "all"))} selectedKey={roomFilter} />
      <span className={styles.spacer} />
      {canEdit ? <Button size="compact" onPress={() => setEditing(newSiteRecord("visit", site.timezone))}><CalendarPlus aria-hidden="true" size={14} />{t("Plan visit")}</Button> : null}
      <input accept="image/*,application/pdf" aria-hidden="true" className={styles.hiddenInput} multiple onChange={(event) => void addFiles(event.target.files)} ref={upload} tabIndex={-1} type="file" />
    </div>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}

    {visits.length ? <section className={styles.visits} aria-label={t("Visits")}>
      {visits.map((visit) => <button type="button" key={visit.id} className={styles.visit} data-status={visit.status} onClick={() => setEditing(visit)}>
        <strong>{visit.title || t("Site visit")}</strong>
        <span>{when(visit.scheduledAt, visit.timezone)}{visit.assigneeName ? ` · ${visit.assigneeName}` : ""}</span>
        <Badge tone={visit.status === "completed" ? "success" : visit.status === "cancelled" ? "neutral" : "info"}>{visit.status === "completed" ? t("Done") : visit.status === "cancelled" ? t("Cancelled") : t("Planned")}</Badge>
      </button>)}
    </section> : null}

    {!data.rooms.length ? <InlineNotice tone="info" message={t("Add the project's rooms in Requirements to capture the site room by room.")} /> : null}

    {shown.map((area) => {
      const photos = photosIn(area); const measurement = roomMeasurement(area); const issues = issuesIn(area); const dims = dimensionText(measurement);
      const open = issues.filter((issue) => issue.status !== "resolved").length;
      return <section className={styles.room} key={area.id} aria-label={area.name}>
        <header className={styles.roomHead}>
          <h3>{area.name}</h3>
          <span className={styles.stats}>
            <span data-done={photos.length > 0 || undefined}><Camera aria-hidden="true" size={13} />{photos.length === 1 ? t("1 photo") : t("{count} photos", { count: photos.length })}</span>
            {area.roomId ? <span data-done={dims.length > 0 || undefined}><Ruler aria-hidden="true" size={13} />{dims.length ? t("Measured") : t("Not measured")}</span> : null}
            {issues.length ? <span data-warn={open > 0 || undefined}><AlertTriangle aria-hidden="true" size={13} />{issues.length === 1 ? t("1 issue") : t("{count} issues", { count: issues.length })}</span> : null}
          </span>
          {canEdit ? <span className={styles.actions}>
            <Button size="compact" variant="primary" isLoading={busy === `upload:${area.id}`} onPress={() => pickFiles(area)}><Camera aria-hidden="true" size={14} />{t("Add photos")}</Button>
            {area.roomId ? <Button size="compact" onPress={() => measure(area)}><Ruler aria-hidden="true" size={14} />{measurement ? t("Edit measurements") : t("Measure")}</Button> : null}
            <Button size="compact" onPress={() => addIssue(area)}><Plus aria-hidden="true" size={14} />{t("Issue")}</Button>
          </span> : null}
        </header>

        {photos.length ? <ul className={styles.photos}>{photos.map((photo) => <li key={photo.entry.id} className={styles.photo}>
          {photo.asset.mimeType.startsWith("image/") ? <a href={assetUrl(photo.asset, false)} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: photo.entry.title })}>
            <Image alt="" height={240} src={assetUrl(photo.asset)} unoptimized width={320} />
          </a> : <a className={styles.pdf} href={assetUrl(photo.asset, false)} target="_blank" rel="noreferrer"><FileText aria-hidden="true" size={22} /><span>{photo.asset.name}</span></a>}
          <span className={styles.photoFoot}>
            <span className={styles.photoName}>{photo.entry.title}</span>
            {photo.entry.assets.length > 1 ? <Badge tone="info">{t("Marked")}</Badge> : null}
            {canEdit && photo.asset.mimeType.startsWith("image/") ? <Button aria-label={t("Draw on {name}", { name: photo.entry.title })} size="compact" variant="quiet" onPress={() => { setQueue([]); setMarking(photo); }}><PenLine aria-hidden="true" size={14} /></Button> : null}
          </span>
        </li>)}</ul> : <button type="button" className={styles.drop} disabled={!canEdit} onClick={() => pickFiles(area)}>
          <Camera aria-hidden="true" size={18} /><span>{canEdit ? t("Add photos of every wall, and any plan") : t("No photos yet")}</span>
        </button>}

        {dims.length || issues.length ? <div className={styles.details}>
          {dims.length ? <button type="button" className={styles.dimensions} onClick={() => measure(area)} disabled={!canEdit}>
            <Ruler aria-hidden="true" size={14} />{dims.map((text) => <span key={text}>{text}</span>)}{canEdit ? <Pencil aria-hidden="true" size={12} className={styles.editIcon} /> : null}
          </button> : null}
          {issues.length ? <ul className={styles.issues}>{issues.map((issue) => <li key={issue.id}><button type="button" onClick={() => setEditing(issue)} data-status={issue.status}>
            <AlertTriangle aria-hidden="true" size={14} /><strong>{issue.title}</strong>{issue.note ? <span className={styles.issueNote}>{issue.note}</span> : null}
            <Badge tone={issue.status === "resolved" ? "success" : "warning"}>{issue.status === "resolved" ? t("Resolved") : t("Open")}</Badge>
          </button></li>)}</ul> : null}
        </div> : null}
      </section>;
    })}

    {!data.rooms.length && !files.length && !site.items.length ? <EmptyState illustration="upload" title={t("Nothing captured on site yet")} description={t("Add photos, plans, measurements and issues as you walk the site.")} /> : null}

    {marking ? <AssetMarkup workspaceId={workspaceId} caseId={caseId} asset={marking.asset} assetUrl={assetUrl} onClose={nextMarkup} onSaved={(marked) => void markupSaved(marking, marked).catch((failure: Error) => setError(failure.message))} /> : null}
    {editing ? <SiteRecordEditor key={editing.id} initial={editing} data={data} site={site} onClose={() => setEditing(null)}
      onSave={async (record, version) => { upsertRecord(await caseRequest<SiteRecord>(workspaceId, caseId, `site/${paths[record.kind]}`, "PUT", sitePayload(record, version))); setEditing(null); setNotice(t("Saved.")); }} /> : null}
  </section>;
}
