"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox, EmptyState, ErrorState, FormDialog, NoResultsState, type DataGridColumn, type SavedView } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi, type CatalogStructure } from "@/lib/workspace/catalog-v2";
import { catalogImageUrl } from "@/lib/quotation/client";
import { CATALOG_TAB, READINESS_COLUMNS, type CatalogReadiness, type CatalogReadinessRow, type ReadinessColumn, type ReadinessSettings } from "@/lib/readiness/types";
import { ReadinessGrid, useReadinessLabels, type CellTarget } from "../readiness/readiness-grid";
import styles from "../readiness/readiness.module.css";

const SETTINGS = "readiness-settings";

/**
 * The catalogue's Readiness view: per item, what it still needs (picture, size, price, technical drawing, materials,
 * trades and hours). A Missing chip opens the item's panel at the tab where it's filled.
 */
export function CatalogReadinessView({ workspaceId, catalogId, categoryId, search, onSearchChange, views, onViewChange, structure, typeLabel, onOpen, reloadKey }: {
  workspaceId: string; catalogId: string; categoryId: string | null; search: string; onSearchChange: (value: string) => void;
  views: SavedView[]; onViewChange: (view: string) => void; structure: CatalogStructure | null; typeLabel: (type: string) => string;
  /** Opens the item's panel at a tab. */
  onOpen: (item: { id: string; name: string }, tab: string) => void;
  /** Changes when an item changed elsewhere (the panel saved), so the cells are read again. */
  reloadKey: number;
}) {
  const t = useT();
  const [data, setData] = useState<CatalogReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ ...(categoryId ? { categoryId } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
      setData(await catalogApi<CatalogReadiness>(workspaceId, `${catalogId}/readiness?${query}`)); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The items didn't load.")); }
    finally { setLoading(false); }
  }, [catalogId, categoryId, search, t, workspaceId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), search ? 250 : 0); return () => window.clearTimeout(timer); }, [load, search, reloadKey]);

  const target = useCallback((row: CatalogReadinessRow, column: ReadinessColumn): CellTarget =>
    column in CATALOG_TAB ? { onPress: () => onOpen(row, CATALOG_TAB[column as keyof typeof CATALOG_TAB]) } : null, [onOpen]);
  const leading = useMemo<DataGridColumn<CatalogReadinessRow>[]>(() => [
    { id: "image", header: t("Photo"), accessorFn: (row) => (row.image ? 1 : 0), size: 64, enableSorting: false, meta: { renderCell: (row) => row.image
      // eslint-disable-next-line @next/next/no-img-element -- the item's picture, streamed through the signed-in catalog route
      ? <img alt="" className={styles.thumb} loading="lazy" src={catalogImageUrl(workspaceId, row.image.id, row.image.hasPreview)} />
      : <span aria-hidden="true" className={styles.thumb} /> } },
    { id: "name", header: t("Item"), accessorFn: (row) => `${row.name} ${row.code}`, size: 240, meta: { primary: true, renderCell: (row) => <span className={styles.item}>
      <strong>{row.name}</strong><small><bdi dir="ltr">{row.code}</bdi> · {typeLabel(row.itemType)}</small>
    </span> } },
  ], [t, typeLabel, workspaceId]);

  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  return <>
    <ReadinessGrid<CatalogReadinessRow>
      ariaLabel={t("Catalog readiness")}
      columns={data?.columns ?? []}
      emptyContent={search.trim() ? <NoResultsState onClear={() => onSearchChange("")} /> : <EmptyState title={t("No items yet")} />}
      exportFileName="catalog-readiness"
      isLoading={loading && !data}
      leading={leading}
      menuActions={data?.canManage ? [{ id: SETTINGS, label: t("Readiness settings") }] : undefined}
      onMenuAction={(id) => { if (id === SETTINGS) setSettingsOpen(true); }}
      onRowAction={(row) => onOpen(row, "details")}
      onSearchChange={onSearchChange}
      onViewChange={onViewChange}
      rows={data?.rows ?? []}
      savedViews={views}
      searchLabel={t("Search items")}
      searchValue={search}
      selectedView="readiness"
      target={target}
    />
    {settingsOpen && data ? <ReadinessSettingsDialog workspaceId={workspaceId} settings={data.settings} structure={structure} onClose={() => setSettingsOpen(false)}
      onSaved={() => { setSettingsOpen(false); void load(); }} /> : null}
  </>;
}

/** The firm's readiness settings: which columns show and count, and which attributes hold a sheet's materials and its trades and hours. */
export function ReadinessSettingsDialog({ workspaceId, settings, structure, onClose, onSaved }: {
  workspaceId: string; settings: ReadinessSettings; structure: CatalogStructure | null; onClose: () => void; onSaved: () => void;
}) {
  const t = useT();
  const words = useReadinessLabels();
  const [columns, setColumns] = useState<ReadinessColumn[]>(settings.columns);
  const [materials, setMaterials] = useState<string[]>(settings.materialAttributes);
  const [labour, setLabour] = useState<string[]>(settings.labourAttributes);
  // One request id per change, so a repeated save changes nothing twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const attributes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const attribute of structure?.attributes ?? []) if (attribute.valueType === "text" && attribute.code !== "size_notes" && !seen.has(attribute.code)) seen.set(attribute.code, attribute.label);
    for (const code of [...settings.materialAttributes, ...settings.labourAttributes]) if (!seen.has(code)) seen.set(code, code);
    return [...seen.entries()].map(([code, label]) => ({ code, label }));
  }, [settings.labourAttributes, settings.materialAttributes, structure?.attributes]);
  const toggle = <V extends string>(list: V[], value: V, on: boolean) => (on ? [...list.filter((entry) => entry !== value), value] : list.filter((entry) => entry !== value));
  const dirty = columns.join() !== settings.columns.join() || materials.join() !== settings.materialAttributes.join() || labour.join() !== settings.labourAttributes.join();
  const submit = async () => {
    await catalogApi(workspaceId, "readiness/settings", { method: "PUT", body: { requestId, version: settings.version, columns, materialAttributes: materials, labourAttributes: labour } });
    onSaved();
  };
  return <FormDialog isDirty={dirty} isOpen isSubmitDisabled={!columns.length} onClose={onClose} onSubmit={submit} submitLabel={t("Save")} title={t("Readiness settings")}>
    <div className={styles.settings}>
      <fieldset>
        <legend>{t("Columns")}</legend>
        {READINESS_COLUMNS.map((column) => <Checkbox isSelected={columns.includes(column)} key={column}
          onChange={(on) => setColumns(READINESS_COLUMNS.filter((entry) => (entry === column ? on : columns.includes(entry))))}>{words.column[column]}</Checkbox>)}
      </fieldset>
      {attributes.length ? <>
        <fieldset>
          <legend>{t("Materials from")}</legend>
          {attributes.map((attribute) => <Checkbox isSelected={materials.includes(attribute.code)} key={attribute.code}
            onChange={(on) => setMaterials(toggle(materials, attribute.code, on))}>{attribute.label}</Checkbox>)}
        </fieldset>
        <fieldset>
          <legend>{t("Trades & hours from")}</legend>
          {attributes.map((attribute) => <Checkbox isSelected={labour.includes(attribute.code)} key={attribute.code}
            onChange={(on) => setLabour(toggle(labour, attribute.code, on))}>{attribute.label}</Checkbox>)}
        </fieldset>
      </> : null}
    </div>
  </FormDialog>;
}
