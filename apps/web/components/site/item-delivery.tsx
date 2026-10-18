"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button, CheckList, DataGrid, EmptyState, ErrorState, FileUploader, FormDialog, FormSection, InlineNotice, ReviewDialog, SegmentedControl, Skeleton, StateChip, TextAreaField, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { itemProofApi, type ItemDeliveriesState, type ItemDelivery, type ItemDeliveryPhoto, type ItemProofApi } from "@/lib/project-core/items";
import { shrinkPhoto } from "@/lib/site/shrink-photo";
import { useProjectFormat } from "../project-core/format";
import proof from "../project-core/item-proof.module.css";
import styles from "../project-core/project-core.module.css";

/** How many thumbnails a row shows before "+N". */
const SHOWN = 4;

/** An item's photos on site as thumbnails, each opening the full photo. */
export function PhotoThumbs({ photos, url, label }: { photos: ItemDeliveryPhoto[]; url: (id: string, preview?: boolean) => string; label: string }) {
  const t = useT();
  if (!photos.length) return <span className={styles.muted}>—</span>;
  return <ul className={proof.thumbs} aria-label={label}>
    {photos.slice(0, SHOWN).map((photo, index) => <li key={photo.id}>
      <a href={url(photo.id)} target="_blank" rel="noreferrer" aria-label={t("Photo {number} by {name}", { number: index + 1, name: photo.byName })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated previews stay on the same-origin file endpoint. */}
        <img alt="" src={url(photo.id, photo.hasPreview)} loading="lazy" />
      </a>
    </li>)}
    {photos.length > SHOWN ? <li className={proof.more}>{t("+{count}", { count: photos.length - SHOWN })}</li> : null}
  </ul>;
}

/**
 * Delivery proof per item: each item's state as one chip (not delivered, delivered, delivered and installed) and its
 * photos on site as thumbnails. Recording a delivery takes at least one photo of the item, taken by a signed-in person;
 * without one, "delivered" is blocked with one clear message.
 */
export function ItemDeliveries({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; switcher?: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => itemProofApi(workspaceId, projectId), [workspaceId, projectId]);
  const [data, setData] = useState<ItemDeliveriesState | null>(null);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.deliveries()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The deliveries didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const words = useMemo(() => ({ pending: t("Not delivered"), delivered: t("Delivered"), installed: t("Delivered and installed") }), [t]);

  const columns = useMemo<DataGridColumn<ItemDelivery>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (item) => item.title, size: 240, meta: { primary: true, renderCell: (item) => <span className={styles.lineCell}>
      <span>{item.title}</span><small>{[item.area, `${format.number(item.quantity)} ${item.unit}`.trim()].filter(Boolean).join(" · ")}</small>
    </span> } },
    { id: "state", header: t("Delivery"), accessorFn: (item) => words[item.state], size: 200, meta: { renderCell: (item) => <span className={styles.lineCell}>
      <span><StateChip state={item.state === "pending" ? "upcoming" : "done"} label={words[item.state]} /></span>
      {item.state === "installed" ? <small>{[item.installedByName, format.when(item.installedAt)].filter(Boolean).join(" · ")}</small>
        : item.state === "delivered" ? <small>{[item.deliveredByName, format.when(item.deliveredAt)].filter(Boolean).join(" · ")}</small> : null}
    </span> } },
    { id: "photos", header: t("Photos"), accessorFn: (item) => item.photos.length, size: 220, meta: { interactive: true,
      renderCell: (item) => <PhotoThumbs photos={item.photos} url={api.photoUrl} label={t("Photos of {item}", { item: item.title })} /> } },
    { id: "action", header: "", enableSorting: false, size: 170, meta: { align: "end", interactive: true, renderCell: (item) => item.canRecord
      ? <Button size="compact" onPress={() => setRecording(item.lineId)}>{item.state === "delivered" ? t("Mark installed") : t("Record delivery")}</Button> : null } },
  ], [api.photoUrl, format, t, words]);

  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton lines={5} shape="rows" />;
  const open = recording ? data.items.find((item) => item.lineId === recording) ?? null : null;
  const checklist = data.checklist ?? [];
  const designCheck = checklist.find((check) => check.key === "design_check");
  const ready = checklist.find((check) => check.key === "ready");
  return <div className={styles.scopeView}>
    {switcher ? <div className={styles.scopeToolbar}>{switcher}</div> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {checklist.length && data.items.some((item) => item.state === "pending") ? <CheckList label={t("Before installation")} layout="inline"
      items={checklist.map((check) => ({ id: check.key, label: translateKnown(t, check.label), done: check.done,
        action: check.key === "design_check" && !check.done && data.canDesignCheck ? <Button size="compact" variant="quiet" onPress={() => setChecking(true)}>{t("Check")}</Button> : undefined }))} /> : null}
    {checking && designCheck ? <ReviewDialog title={t("Check the items against the design")} onClose={() => setChecking(false)} confirmLabel={t("Items match the design")}
      facts={[{ label: t("Items"), value: data.items.map((item) => item.title).join(", ") }]}
      checks={ready ? { label: t("Before the check"), items: [{ id: ready.key, label: translateKnown(t, ready.label), done: ready.done }] } : undefined}
      onConfirm={async () => { setData(await api.designCheck()); setChecking(false); }} /> : null}
    <DataGrid<ItemDelivery> ariaLabel={t("Item deliveries")} wrapText columns={columns} data={data.items} getRowId={(item) => item.lineId} selectable={false} rowNumbers={false}
      showToolbar={false} showFooter={false} pageSize={200} onRowAction={(item) => (item.canRecord ? setRecording(item.lineId) : undefined)}
      emptyContent={<EmptyState illustration={null} title={t("No items yet")} />} />
    {open ? <RecordDelivery item={open} api={api} onState={setData} onClose={() => setRecording(null)} /> : null}
  </div>;
}

/**
 * Recording one item's delivery: its photos on site (added here, each by the signed-in person), delivered or delivered
 * and installed, and a note. Without a photo it can't be saved. Save bottom-end.
 */
function RecordDelivery({ item, api, onState, onClose }: { item: ItemDelivery; api: ItemProofApi; onState: (state: ItemDeliveriesState) => void; onClose: () => void }) {
  const t = useT();
  const [target, setTarget] = useState<"delivered" | "installed">(item.state === "delivered" ? "installed" : "delivered");
  // An item planned as delivery only is never installed by the team.
  const deliveryOnly = item.plan?.deliveryMode === "delivery";
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState("");
  const add = async (files: File[]) => {
    setUploading(true); setProblem("");
    try {
      let state: ItemDeliveriesState | null = null;
      for (const file of files) state = await api.uploadPhoto(item.lineId, crypto.randomUUID(), await shrinkPhoto(file));
      if (state) onState(state);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); }
    finally { setUploading(false); }
  };
  const missing = !item.photos.length;
  return <FormDialog size="md" title={item.title} onClose={onClose} isDirty={Boolean(note.trim())} isSubmitDisabled={missing || uploading}
    isSubmitting={uploading} submitLabel={target === "installed" ? t("Mark installed") : t("Mark delivered")}
    onSubmit={async () => { onState(await api.mark(item.lineId, item.version, target, note.trim())); onClose(); }}>
    <FormSection>
      {item.state === "pending" && !deliveryOnly ? <SegmentedControl label={t("What happened")} value={target} onChange={(value) => setTarget(value as "delivered" | "installed")}
        options={[{ id: "delivered", label: t("Delivered") }, { id: "installed", label: t("Delivered and installed") }]} /> : null}
      <PhotoThumbs photos={item.photos} url={api.photoUrl} label={t("Photos of {item}", { item: item.title })} />
      <FileUploader accept="image/*" label={t("Add photos")} onFiles={(files) => void add(files)} />
      {problem ? <InlineNotice tone="error" message={problem} /> : missing ? <InlineNotice tone="info" message={t("Add a photo of the item on site first.")} /> : null}
      <TextAreaField label={t("Note")} maxLength={1000} value={note} onChange={setNote} />
    </FormSection>
  </FormDialog>;
}
