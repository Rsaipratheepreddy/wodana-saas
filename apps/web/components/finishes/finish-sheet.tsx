"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { MapPin, PenLine, Signature, Trash2 } from "lucide-react";
import { parseDate } from "@internationalized/date";
import { Badge, Button, DateField, FormDialog, IconButton, InlineNotice, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { CaseAsset, CaseRoom } from "@/lib/pre-project/content";
import { LOG_STATUS_LABEL, logStatusTone, ORIGIN_LABEL, type FinishEntry, type scheduleApi, type ScheduleView } from "@/lib/pre-project/finishes";
import { AssetUpload, CaseModal } from "../pre-project/case-controls";
import styles from "./finishes.module.css";

type Api = ReturnType<typeof scheduleApi>;
type Saved = (message: string, next: ScheduleView) => void;

/**
 * One finish of the schedule: what was specified and where it comes from, where it goes (PLM-156), its marked render
 * snapshots (PLM-146) and the client's signed sample or data sheet (PLM-148). Each change is its own dialog.
 */
export function FinishSheet({ entry, view, rooms, api, onClose, onSaved }: { entry: FinishEntry; view: ScheduleView; rooms: CaseRoom[]; api: Api; onClose: () => void; onSaved: Saved }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [dialog, setDialog] = useState<"placement" | "snapshot" | "signature" | null>(null);
  const [error, setError] = useState("");
  const day = (ymd: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd.slice(0, 10)}T00:00:00Z`)); } catch { return ymd; } };
  const current = entry.current;
  const remove = async (snapshotId: string) => {
    setError("");
    try { onSaved(t("Snapshot removed."), await api.removeSnapshot(view.caseId, snapshotId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const last = entry.signature.last;
  return <CaseModal title={entry.title} size="md" layout="sheet" onClose={onClose}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className={styles.inline}>
      <Badge tone={logStatusTone(entry.status)}>{t(LOG_STATUS_LABEL[entry.status])}</Badge>
      {entry.priced.stale ? <Badge tone="danger">{t("Price to check")}</Badge> : entry.changedSinceSent ? <Badge tone="warning">{t("Changed since sent")}</Badge>
        : entry.sentToQs ? <Badge tone="neutral">{t("Sent to QS")}</Badge> : null}
    </div>
    <dl className={styles.details}>
      {current?.specification ? <><dt>{t("Finish or specification")}</dt><dd>{current.specification}</dd></> : null}
      <dt>{t("Category")}</dt><dd>{entry.categoryLabel ?? "—"}</dd>
      <dt>{t("Supplied from")}</dt><dd>{[current?.origin ? t(ORIGIN_LABEL[current.origin]) : null, current?.supplier, current?.sampleName].filter(Boolean).join(" · ") || "—"}</dd>
      <dt>{t("Room")}</dt><dd>{entry.roomName ?? t("Whole home")}</dd>
      <dt>{t("Where it goes")}</dt><dd>{entry.location || "—"}</dd>
      {entry.installNote ? <><dt>{t("Installation note")}</dt><dd>{entry.installNote}</dd></> : null}
      {current?.quantity ? <><dt>{t("Quantity")}</dt><dd><bdi dir="ltr">{current.quantity}</bdi> {current.unit}</dd></> : null}
    </dl>
    {current?.samplePhotoAssetId
      // eslint-disable-next-line @next/next/no-img-element
      ? <img className={styles.photo} alt={current.samplePhotoName ?? t("Sample photo")} src={api.assetUrl(view.caseId, current.samplePhotoAssetId, true)} /> : null}
    {view.canManageMaterials ? <div className={styles.inline}><Button size="compact" onPress={() => setDialog("placement")}><MapPin aria-hidden="true" size={14} />{t("Change where it goes")}</Button></div> : null}

    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("Marked on the renders")}</h3>
      {entry.snapshots.length ? <ul className={styles.snapshots}>{entry.snapshots.map((snapshot) => <li key={snapshot.id}>
        <div className={styles.canvas} dir="ltr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={snapshot.label} src={api.assetUrl(view.caseId, snapshot.assetId, true)} />
          <span className={styles.marker} style={{ "--x": snapshot.markerX, "--y": snapshot.markerY } as CSSProperties} aria-hidden="true" />
        </div>
        <span className={styles.inline}><span>{snapshot.label}</span>
          {view.canEdit ? <IconButton aria-label={t("Remove {label}", { label: snapshot.label })} onPress={() => void remove(snapshot.id)}><Trash2 aria-hidden="true" size={14} /></IconButton> : null}</span>
      </li>)}</ul> : <p className={styles.muted}>{t("Not marked yet")}</p>}
      {view.canEdit ? <div className={styles.inline}><Button size="compact" onPress={() => setDialog("snapshot")}><PenLine aria-hidden="true" size={14} />{t("Mark on a render snapshot")}</Button></div> : null}
    </div>

    {entry.signature.required || last ? <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("Client's signature")}</h3>
      {entry.signature.signed && last ? <p className={styles.muted}>{t("Signed {date} by {name}", { date: day(last.signedOn), name: last.signer })}{last.assetName ? ` · ${last.assetName}` : ""}</p>
        : last?.outOfDate ? <p className={styles.muted}>{t("Signed for an earlier version. The client signs the new one.")}</p>
        : <p className={styles.muted}>{t("Not signed yet")}</p>}
      {view.canRecordSignature && !entry.signature.signed && (entry.locked ?? current) ? <div className={styles.inline}>
        <Button size="compact" variant="primary" onPress={() => setDialog("signature")}><Signature aria-hidden="true" size={14} />{t("Record the client's signature")}</Button></div> : null}
    </div> : null}

    {dialog === "placement" ? <PlacementDialog entry={entry} view={view} rooms={rooms} onClose={() => setDialog(null)}
      onSubmit={async (input) => { onSaved(t("Saved."), await api.details(view.caseId, entry.id, { entryVersion: entry.version, ...input })); setDialog(null); }} /> : null}
    {dialog === "snapshot" ? <SnapshotDialog view={view} api={api} onClose={() => setDialog(null)}
      onSubmit={async (input) => { onSaved(t("Marked on the snapshot."), await api.addSnapshot(view.caseId, entry.id, { id: crypto.randomUUID(), ...input })); setDialog(null); }} /> : null}
    {dialog === "signature" ? <SignatureDialog view={view} api={api} onClose={() => setDialog(null)}
      onSubmit={async (input) => { onSaved(t("The client's signature is recorded."), await api.signature(view.caseId, entry.id, { id: crypto.randomUUID(), versionId: (entry.locked ?? current)!.id, ...input }));
        setDialog(null); }} /> : null}
  </CaseModal>;
}

/** Where a finish goes: its category, room, place in the room and the note for whoever installs it. */
function PlacementDialog({ entry, view, rooms, onClose, onSubmit }: { entry: FinishEntry; view: ScheduleView; rooms: CaseRoom[]; onClose: () => void;
  onSubmit: (input: { categoryKey: string | null; roomId: string | null; location: string; installNote: string }) => Promise<unknown> }) {
  const t = useT();
  const [categoryKey, setCategoryKey] = useState(entry.categoryKey);
  const [roomId, setRoomId] = useState(entry.roomId);
  const [location, setLocation] = useState(entry.location);
  const [installNote, setInstallNote] = useState(entry.installNote);
  const NONE = "__none";
  const dirty = categoryKey !== entry.categoryKey || roomId !== entry.roomId || location !== entry.location || installNote !== entry.installNote;
  return <FormDialog title={t("Where it goes")} onClose={onClose} isDirty={dirty} submitLabel={t("Save")} isSubmitDisabled={!dirty} onSubmit={() => onSubmit({ categoryKey, roomId, location: location.trim(), installNote: installNote.trim() })}>
    <SelectField label={t("Category")} items={[{ id: NONE, label: t("No category") }, ...view.categories.map((item) => ({ id: item.key, label: item.label }))]}
      selectedKey={categoryKey ?? NONE} onSelectionChange={(key) => setCategoryKey(String(key) === NONE ? null : String(key))} />
    {rooms.length ? <SelectField label={t("Room")} items={[{ id: NONE, label: t("Whole home") }, ...rooms.map((room) => ({ id: room.id, label: room.name }))]}
      selectedKey={roomId ?? NONE} onSelectionChange={(key) => setRoomId(String(key) === NONE ? null : String(key))} /> : null}
    <TextInput label={t("Where it goes")} maxLength={200} value={location} onChange={setLocation} />
    <TextAreaField label={t("Installation note")} maxLength={2000} value={installNote} onChange={setInstallNote} />
  </FormDialog>;
}

/** PLM-146: a render snapshot (an image of this job) with a marker placed on it and its label. */
function SnapshotDialog({ view, api, onClose, onSubmit }: { view: ScheduleView; api: Api; onClose: () => void;
  onSubmit: (input: { assetId: string; markerX: number; markerY: number; label: string }) => Promise<unknown> }) {
  const t = useT();
  const [asset, setAsset] = useState<CaseAsset | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const place = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (value: number, size: number) => Math.round(Math.max(0, Math.min(100, (value / size) * 100)) * 100) / 100;
    setPoint({ x: share(event.clientX - box.left, box.width), y: share(event.clientY - box.top, box.height) });
  };
  return <FormDialog title={t("Mark on a render snapshot")} onClose={onClose} isDirty={Boolean(asset)} submitLabel={t("Save")} error={error || undefined}
    isSubmitDisabled={!asset || !point || !label.trim() || busy} onSubmit={() => onSubmit({ assetId: asset!.id, markerX: point!.x, markerY: point!.y, label: label.trim() })}>
    {asset ? <div className={styles.canvas} dir="ltr">
      <button type="button" className={styles.canvasButton} aria-label={t("Place the marker on the snapshot")} onClick={place}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={asset.name} src={api.assetUrl(view.caseId, asset.id, true)} />
      </button>
      {point ? <span className={styles.marker} style={{ "--x": point.x, "--y": point.y } as CSSProperties} aria-hidden="true" /> : null}
    </div> : <AssetUpload workspaceId="" caseId={view.caseId} multiple={false} label={t("Upload the render snapshot")} onBusy={setBusy} onError={setError}
      uploadFile={(file, id) => file.type.startsWith("image/") ? api.upload(view.caseId, file, id) : Promise.reject(new Error(t("Choose an image of the render.")))}
      onUploaded={setAsset} />}
    {asset && !point ? <p className={styles.muted}>{t("Click the finish on the snapshot.")}</p> : null}
    <TextInput isRequired label={t("What the marker shows")} placeholder={t("e.g. Calacatta marble, honed")} maxLength={200} value={label} onChange={setLabel} />
  </FormDialog>;
}

/** PLM-148: the client signed the physical sample or the data sheet: a photo of it, the day and who signed. */
function SignatureDialog({ view, api, onClose, onSubmit }: { view: ScheduleView; api: Api; onClose: () => void;
  onSubmit: (input: { signedOn: string; signer: string; assetId: string }) => Promise<unknown> }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [asset, setAsset] = useState<CaseAsset | null>(null);
  const [signedOn, setSignedOn] = useState(today);
  const [signer, setSigner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <FormDialog title={t("Record the client's signature")} onClose={onClose} isDirty={Boolean(asset || signer)} submitLabel={t("Save")} error={error || undefined}
    isSubmitDisabled={!asset || !signer.trim() || !signedOn || busy} onSubmit={() => onSubmit({ signedOn, signer: signer.trim(), assetId: asset!.id })}>
    {asset ? <p className={styles.muted}>{t("Photo: {name}", { name: asset.name })}</p>
      : <AssetUpload workspaceId="" caseId={view.caseId} multiple={false} label={t("Photo of the signed sample or data sheet")} onBusy={setBusy} onError={setError}
        uploadFile={(file, id) => api.upload(view.caseId, file, id)} onUploaded={setAsset} />}
    <DateField isRequired label={t("Signed on")} maxValue={parseDate(today)} value={signedOn ? parseDate(signedOn) : null} onChange={(date) => setSignedOn(date?.toString() ?? "")} />
    <TextInput isRequired label={t("Who signed")} maxLength={200} value={signer} onChange={setSigner} />
  </FormDialog>;
}
