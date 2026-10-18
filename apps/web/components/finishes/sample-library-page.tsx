"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Plus } from "lucide-react";
import {
  Badge, Button, EmptyState, ErrorState, FileUploader, FormDialog, FormRow, PageShell, RecordTable, SegmentedControl, SelectField, Skeleton, Switch, TextAreaField, TextInput, ToolbarSearch,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { libraryApi, ORIGIN_LABEL, type LibraryView, type MaterialOrigin, type Sample } from "@/lib/pre-project/finishes";
import styles from "./finishes.module.css";

const ALL = "__all";
const NONE = "__none";

/**
 * PLM-157: the sample library. The samples the firm holds (its own stock first, then brands), each tagged with a
 * price band, where it is kept and whether it is in stock; searched when a material is chosen. The Material
 * Coordinator keeps it.
 */
export function SampleLibraryPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [view, setView] = useState<LibraryView | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [band, setBand] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<Sample | "new" | null>(null);
  const load = useCallback(async () => {
    try {
      setView(await libraryApi(workspaceId).samples({ q: search.trim() || undefined, band: band === ALL ? undefined : band, category: category === ALL ? undefined : category }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The samples didn't load.")); }
  }, [workspaceId, search, band, category, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), search ? 200 : 0); return () => window.clearTimeout(timer); }, [load, search]);

  const api = libraryApi(workspaceId);
  const filtered = Boolean(search.trim() || band !== ALL || category !== ALL);
  const categoryLabel = (key: string | null) => (key ? view?.categories.find((item) => item.key === key)?.label ?? key : "");
  const columns: DataGridColumn<Sample>[] = [
    { id: "photo", header: t("Photo"), enableSorting: false, size: 72, cell: ({ row }: { row: { original: Sample } }) => row.original.hasPhoto
      // eslint-disable-next-line @next/next/no-img-element
      ? <img className={styles.thumb} alt={row.original.name} src={api.photoUrl(row.original.id)} /> : null },
    { id: "name", header: t("Sample"), accessorFn: (row) => row.name, meta: { primary: true }, cell: ({ row }: { row: { original: Sample } }) => <span className={styles.cell}>
      <span>{row.original.name}</span>{row.original.code || row.original.categoryKey ? <small>{[row.original.code, categoryLabel(row.original.categoryKey)].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "from", header: t("Supplied from"), accessorFn: (row) => row.origin, cell: ({ row }: { row: { original: Sample } }) => <span className={styles.cell}>
      <span>{t(ORIGIN_LABEL[row.original.origin])}</span>{row.original.supplier ? <small>{row.original.supplier}</small> : null}</span> },
    { id: "band", header: t("Price band"), accessorFn: (row) => row.priceBandLabel ?? "" },
    { id: "location", header: t("Kept at"), accessorFn: (row) => row.location, meta: { priority: "low" } },
    { id: "stock", header: t("Stock"), accessorFn: (row) => (row.inStock ? 1 : 0), cell: ({ row }: { row: { original: Sample } }) => row.original.archived ? <Badge tone="neutral">{t("Archived")}</Badge>
      : <Badge tone={row.original.inStock ? "success" : "warning"}>{row.original.inStock ? t("In stock") : t("Out of stock")}</Badge> },
  ];

  return <PageShell title={t("Sample library")} action={view?.canManage ? <Button variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("Add sample")}</Button> : undefined}
    toolbar={<div className={styles.toolbar}>
      <ToolbarSearch label={t("Search samples")} value={search} onChange={setSearch} />
      <SelectField aria-label={t("Price band")} label={null} accent="neutral" items={[{ id: ALL, label: t("All price bands") }, ...(view?.bands ?? []).map((item) => ({ id: item.id, label: item.label }))]}
        selectedKey={band} onSelectionChange={(key) => setBand(String(key))} />
      <SelectField aria-label={t("Category")} label={null} accent="neutral" items={[{ id: ALL, label: t("All categories") }, ...(view?.categories ?? []).map((item) => ({ id: item.key, label: item.label }))]}
        selectedKey={category} onSelectionChange={(key) => setCategory(String(key))} />
    </div>}>
    {error && !view ? <ErrorState description={error} onRetry={() => void load()} />
      : !view ? <Skeleton lines={6} shape="rows" />
      : view.samples.length ? <RecordTable ariaLabel={t("Sample library")} data={view.samples} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText
        onRowAction={(row) => (view.canManage ? setEditing(row) : undefined)} />
      : filtered ? <EmptyState illustration={null} title={t("No samples match")} action={<Button onPress={() => { setSearch(""); setBand(ALL); setCategory(ALL); }}>{t("Clear the filters")}</Button>} />
      : <EmptyState illustration="empty" title={t("No samples yet")} action={view.canManage ? <Button variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("Add sample")}</Button> : undefined} />}
    {editing && view ? <SampleDialog sample={editing === "new" ? null : editing} view={view} api={api} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
  </PageShell>;
}

/** A sample of the library: what it is, where it comes from, its price band, where it is kept, and its photo. */
function SampleDialog({ sample, view, api, onClose, onSaved }: { sample: Sample | null; view: LibraryView; api: ReturnType<typeof libraryApi>; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [id] = useState(() => sample?.id ?? crypto.randomUUID());
  const [form, setForm] = useState({ name: sample?.name ?? "", code: sample?.code ?? "", categoryKey: sample?.categoryKey ?? null as string | null, origin: (sample?.origin ?? "own_stock") as MaterialOrigin,
    supplier: sample?.supplier ?? "", priceBandId: sample?.priceBandId ?? null as string | null, location: sample?.location ?? "", note: sample?.note ?? "", inStock: sample?.inStock ?? true });
  const [photo, setPhoto] = useState<File | null>(null);
  const [archiving, setArchiving] = useState(false);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  return <FormDialog title={sample ? sample.name : t("Add sample")} onClose={onClose} isDirty submitLabel={t("Save")} isSubmitDisabled={!form.name.trim()}
    secondaryAction={sample && !sample.archived ? <Button variant="quiet" isLoading={archiving} onPress={async () => { setArchiving(true); try { await api.archive(sample.id, sample.version); onSaved(); } finally { setArchiving(false); } }}>
      <Archive aria-hidden="true" size={14} />{t("Archive")}</Button> : undefined}
    onSubmit={async () => {
      const saved = await api.save({ id, ...(sample ? { version: sample.version } : {}), ...form, name: form.name.trim(), code: form.code.trim(), supplier: form.supplier.trim(), location: form.location.trim(), note: form.note.trim() });
      if (photo) await api.photo(saved.id, photo);
      onSaved();
    }}>
    <TextInput isRequired autoFocus label={t("Name")} maxLength={240} value={form.name} onChange={set("name")} />
    <FormRow>
      <TextInput label={t("Code")} maxLength={80} value={form.code} onChange={set("code")} />
      <SelectField label={t("Category")} items={[{ id: NONE, label: t("No category") }, ...view.categories.map((item) => ({ id: item.key, label: item.label }))]}
        selectedKey={form.categoryKey ?? NONE} onSelectionChange={(key) => set("categoryKey")(String(key) === NONE ? null : String(key))} />
    </FormRow>
    <SegmentedControl label={t("Supplied from")} value={form.origin} onChange={(origin) => set("origin")(origin as MaterialOrigin)}
      options={(["own_stock", "brand", "local_supplier"] as MaterialOrigin[]).map((origin) => ({ id: origin, label: t(ORIGIN_LABEL[origin]) }))} />
    <FormRow>
      <TextInput label={t("Supplier or brand")} maxLength={200} value={form.supplier} onChange={set("supplier")} />
      <SelectField label={t("Price band")} items={[{ id: NONE, label: t("No price band") }, ...view.bands.map((item) => ({ id: item.id, label: item.label }))]}
        selectedKey={form.priceBandId ?? NONE} onSelectionChange={(key) => set("priceBandId")(String(key) === NONE ? null : String(key))} />
    </FormRow>
    <TextInput label={t("Kept at")} maxLength={200} value={form.location} onChange={set("location")} />
    <Switch isSelected={form.inStock} onChange={set("inStock")}>{t("In stock")}</Switch>
    <TextAreaField label={t("Note")} maxLength={2000} value={form.note} onChange={set("note")} />
    {photo ? <p className={styles.muted}>{t("Photo: {name}", { name: photo.name })}</p>
      : <FileUploader appearance="button" accept="image/jpeg,image/png,image/webp,image/heic" multiple={false} label={sample?.hasPhoto ? t("Replace the photo") : t("Add a photo")}
        onFiles={(files) => setPhoto(files[0] ?? null)} />}
  </FormDialog>;
}
