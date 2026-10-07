"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, NoResultsState, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import { catalogImageUrl } from "@/lib/quotation/client";
import { caseApi } from "@/lib/pre-project/content";
import { catalogItemHref, type CatalogColumn, type ProjectReadiness as Readiness, type ProjectReadinessRow, type ReadinessColumn } from "@/lib/readiness/types";
import { ReadinessGrid, type CellTarget } from "../readiness/readiness-grid";
import styles from "../readiness/readiness.module.css";

/**
 * Item readiness for a project: every line of its scope with what it still needs, each column worked out from the
 * records. A Missing chip opens the place to fill it: the catalogue item's tab, or the project's drawings, material
 * list, purchasing, factory or site.
 */
export function ProjectReadiness({ workspaceId, projectId, version, onView }: { workspaceId: string; projectId: string; version: number;
  /** Opens another view of the project's scope (drawings, materials). */
  onView: (view: "drawings" | "materials") => void }) {
  const t = useT();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setReadiness(await api.readiness(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The items didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  const target = useCallback((row: ProjectReadinessRow, column: ReadinessColumn): CellTarget => {
    const catalogue = (tab: CatalogColumn): CellTarget => (row.catalogItemId && row.catalogId ? { href: catalogItemHref(row.catalogId, row.catalogItemId, tab) } : null);
    switch (column) {
      case "picture": case "size": case "labour": return catalogue(column);
      case "drawing": return row.cells.drawing?.note === "catalogue_drawing" ? catalogue("drawing") : { onPress: () => onView("drawings") };
      case "materials": case "selection": return { onPress: () => onView("materials") };
      case "purchase": return { href: `/workspace/purchasing?${new URLSearchParams({ project: projectId })}` };
      case "production": return { href: `/workspace/factory?${new URLSearchParams({ project: projectId })}` };
      case "delivery": return { href: `/workspace/projects/${projectId}/site` };
      default: return null;
    }
  }, [onView, projectId]);

  const caseId = readiness?.caseId;
  const leading = useMemo<DataGridColumn<ProjectReadinessRow>[]>(() => [
    { id: "image", header: t("Photo"), accessorFn: (row) => (row.imageAssetId || row.catalogImageId ? 1 : 0), size: 64, enableSorting: false, meta: { renderCell: (row) => {
      const src = row.imageAssetId && caseId ? caseApi(workspaceId, caseId, `assets/${row.imageAssetId}?preview=1`) : row.catalogImageId ? catalogImageUrl(workspaceId, row.catalogImageId) : null;
      // eslint-disable-next-line @next/next/no-img-element -- the line's picture, streamed through the signed-in routes
      return src ? <img alt="" className={styles.thumb} loading="lazy" src={src} /> : <span aria-hidden="true" className={styles.thumb} />;
    } } },
    { id: "item", header: t("Item"), accessorFn: (row) => `${row.title} ${row.code ?? ""}`, size: 240, meta: { primary: true, renderCell: (row) => <span className={styles.item}>
      <strong>{row.title}</strong>
      <small>{[row.code ? <bdi dir="ltr" key="code">{row.code}</bdi> : null, <span className={styles.number} key="qty">{Number(row.quantity).toLocaleString()} {row.unit}</span>]
        .filter(Boolean).flatMap((part, index) => (index ? [" · ", part] : [part]))}</small>
    </span> } },
    { id: "area", header: t("Area"), accessorFn: (row) => row.areaName ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.muted}>{row.areaName ?? t("General")}</span> } },
  ], [caseId, t, workspaceId]);

  if (error && !readiness) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!readiness) return <Skeleton lines={6} shape="rows" />;
  const query = search.trim().toLocaleLowerCase();
  const rows = query ? readiness.rows.filter((row) => [row.title, row.code ?? "", row.areaName ?? ""].some((text) => text.toLocaleLowerCase().includes(query))) : readiness.rows;
  return <ReadinessGrid<ProjectReadinessRow>
    ariaLabel={t("Item readiness")}
    columns={readiness.columns}
    emptyContent={query ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState illustration={null} title={t("No items")} />}
    exportFileName="item-readiness"
    leading={leading}
    onSearchChange={setSearch}
    rows={rows}
    searchLabel={t("Search items")}
    searchValue={search}
    target={target}
  />;
}
