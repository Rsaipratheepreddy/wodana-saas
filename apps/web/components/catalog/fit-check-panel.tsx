"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, FormDialog, IconButton, SelectField, Skeleton, TextAreaField, TextInput, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { fromMm, sourcingApi, SourcingRequestError, type AccessKind, type AccessPoint, type FitStatus, type ItemFit } from "@/lib/workspace/product-sourcing";
import styles from "./product-sourcing.module.css";

const UNITS = ["mm", "cm", "m", "in", "ft"];
const SIZE_KEYS = ["width", "height", "turnWidth", "cabinWidth", "cabinDepth", "cabinHeight"] as const;
type PointDraft = { id: string; version: number; route: string; kind: AccessKind; label: string; unit: string } & Record<(typeof SIZE_KEYS)[number], string>;

export function useFitLabels() {
  const t = useT();
  const status: Record<FitStatus, { label: string; tone: StatusTone }> = {
    fits: { label: t("Fits"), tone: "success" }, tight: { label: t("Tight fit"), tone: "warning" }, does_not_fit: { label: t("Doesn't fit"), tone: "danger" }, unknown: { label: t("Not measured"), tone: "neutral" },
  };
  const kinds: Record<AccessKind, string> = { door: t("Door"), lift: t("Lift"), stair: t("Stair"), corridor: t("Corridor"), window: t("Window"), other: t("Other opening") };
  return { status, kinds };
}

/** A fit check's state as a badge, for approval and ordering surfaces (E5-6: a warning at approval). */
export function FitCheckBadge({ fit }: { fit: Pick<ItemFit, "result" | "override"> }) {
  const t = useT();
  const { status } = useFitLabels();
  if (fit.override) return <Badge tone="warning">{t("Overridden")}</Badge>;
  return <Badge tone={status[fit.result.status].tone}>{status[fit.result.status].label}</Badge>;
}

/**
 * Each item's fit for a case, for badges on approval surfaces (E5-6: a warning there, never a block). Items without a
 * catalog item aren't checked; a failed load shows no badge rather than an error on someone else's page.
 */
export function useItemFits(workspaceId: string, caseId: string, itemIds: string[], refreshKey = 0) {
  const [state, setState] = useState<{ key: string; fits: Map<string, ItemFit> }>({ key: "", fits: new Map() });
  const key = [...new Set(itemIds.filter(Boolean))].sort().join(",");
  useEffect(() => {
    let live = true;
    if (!key) return;
    sourcingApi<{ items: ItemFit[] }>(workspaceId, `cases/${caseId}/fit-checks`, { body: { itemIds: key.split(",") } })
      .then((next) => { if (live) setState({ key, fits: new Map(next.items.map((fit) => [fit.itemId, fit])) }); }).catch(() => { if (live) setState({ key, fits: new Map() }); });
    return () => { live = false; };
  }, [workspaceId, caseId, key, refreshKey]);
  return useMemo(() => (key && state.key === key ? state.fits : new Map<string, ItemFit>()), [key, state]);
}

/** Whether a fit needs a warning where the item is approved: it doesn't fit, it's tight, or it was let through. */
export const fitNeedsWarning = (fit: Pick<ItemFit, "result" | "override"> | undefined) => Boolean(fit && (fit.override || fit.result.status === "does_not_fit" || fit.result.status === "tight"));

/** The site's measured way in: doors, lifts, stairs, corridors and windows, by route. */
export function AccessPointsEditor({ workspaceId, caseId, canEdit, onChanged, onLoaded, refreshKey = 0 }: {
  workspaceId: string; caseId: string; canEdit: boolean; onChanged?: () => void;
  /** Every load (first and after a change), with the region's default unit (metric → cm, imperial → in). */
  onLoaded?: (points: AccessPoint[], defaultUnit: string) => void; refreshKey?: number;
}) {
  const t = useT();
  const { kinds } = useFitLabels();
  const [points, setPoints] = useState<AccessPoint[] | null>(null);
  const [defaultUnit, setDefaultUnit] = useState("cm");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PointDraft | null>(null);
  const loaded = useRef(onLoaded);
  useEffect(() => { loaded.current = onLoaded; }, [onLoaded]);
  const load = useCallback(() => sourcingApi<{ points: AccessPoint[]; defaultUnit: string }>(workspaceId, `cases/${caseId}/access-points`)
    .then((next) => { setPoints(next.points); setDefaultUnit(next.defaultUnit); setError(""); loaded.current?.(next.points, next.defaultUnit); })
    .catch((reason) => setError(reason instanceof Error ? reason.message : "")), [workspaceId, caseId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  if (error && !points) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!points) return <Skeleton lines={3} />;
  const blank = (): PointDraft => ({ id: crypto.randomUUID(), version: 0, route: points[0]?.route ?? t("Main"), kind: "door", label: "", unit: defaultUnit, width: "", height: "", turnWidth: "", cabinWidth: "", cabinDepth: "", cabinHeight: "" });
  const edit = (point: AccessPoint): PointDraft => ({ ...point, ...Object.fromEntries(SIZE_KEYS.map((key) => [key, point[key] ? String(Number(point[key])) : ""])) } as PointDraft);
  const size = (value: string | null) => (value ? String(Number(value)) : "—");
  const summary = (point: AccessPoint) => point.kind === "lift"
    ? `${size(point.width)} × ${size(point.height)} · ${t("cabin")} ${size(point.cabinWidth)} × ${size(point.cabinDepth)} × ${size(point.cabinHeight)} ${point.unit}`
    : `${size(point.width)} × ${size(point.height)} ${point.unit}${point.turnWidth ? ` · ${t("turn")} ${size(point.turnWidth)}` : ""}`;
  const remove = async (point: AccessPoint) => {
    try { await sourcingApi(workspaceId, `cases/${caseId}/access-points/${point.id}/archive`, { body: { version: point.version } }); await load(); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : ""); if (reason instanceof SourcingRequestError && reason.status === 409) void load(); }
  };
  const save = async () => {
    if (!editing) return;
    const position = editing.version ? points.find((point) => point.id === editing.id)?.position ?? 0 : points.filter((point) => point.route === editing.route).length;
    await sourcingApi(workspaceId, `cases/${caseId}/access-points/${editing.id}`, { method: "PUT", body: {
      version: editing.version, route: editing.route.trim(), position, kind: editing.kind, label: editing.label.trim(), unit: editing.unit,
      ...Object.fromEntries(SIZE_KEYS.map((key) => [key, editing[key].trim() || null])),
    } });
    setEditing(null); await load(); onChanged?.();
  };
  const set = (key: keyof PointDraft) => (value: string) => setEditing((current) => (current ? { ...current, [key]: value } : current));
  const routes = [...new Set(points.map((point) => point.route))];
  return <div className={styles.panel}>
    {canEdit && points.length ? <div className={styles.actions}><Button onPress={() => setEditing(blank())} size="compact"><Plus aria-hidden="true" size={14} />{t("Add access point")}</Button></div> : null}
    {!points.length ? <EmptyState title={t("No access measured yet")} action={canEdit ? <Button onPress={() => setEditing(blank())} variant="primary">{t("Add access point")}</Button> : null} />
      : routes.map((route) => <section className={styles.route} key={route} aria-label={route}>
        <header>{route}</header>
        <ul className={styles.points}>{points.filter((point) => point.route === route).map((point) => <li className={styles.point} key={point.id}>
          <span><strong dir="auto">{point.label}</strong> <small>{kinds[point.kind]} · <bdi dir="ltr">{summary(point)}</bdi></small></span>
          {canEdit ? <span className={styles.actions}>
            <IconButton aria-label={t("Edit")} onPress={() => setEditing(edit(point))}><Pencil size={14} /></IconButton>
            <IconButton aria-label={t("Remove")} onPress={() => void remove(point)}><Trash2 size={14} /></IconButton>
          </span> : null}
        </li>)}</ul>
      </section>)}
    <FormDialog isDirty={Boolean(editing?.label)} isOpen={Boolean(editing)} onClose={() => setEditing(null)} onSubmit={save} submitLabel={t("Save")} title={editing?.version ? t("Edit access point") : t("Add access point")}>
      {editing ? <div className={styles.pointForm}>
        <TextInput isRequired label={t("Name")} maxLength={120} onChange={set("label")} value={editing.label} />
        <SelectField items={(Object.keys(kinds) as AccessKind[]).map((kind) => ({ id: kind, label: kinds[kind] }))} label={t("Type")} onSelectionChange={(key) => set("kind")(String(key))} selectedKey={editing.kind} />
        <TextInput isRequired label={t("Route")} maxLength={60} onChange={set("route")} value={editing.route} />
        <TextInput dir="ltr" label={t("Clear width")} maxLength={12} onChange={set("width")} value={editing.width} />
        <TextInput dir="ltr" label={t("Clear height")} maxLength={12} onChange={set("height")} value={editing.height} />
        <SelectField items={UNITS.map((unit) => ({ id: unit, label: unit }))} label={t("Unit")} onSelectionChange={(key) => set("unit")(String(key))} selectedKey={editing.unit} />
        {editing.kind === "corridor" || editing.kind === "stair" ? <TextInput dir="ltr" label={t("Width after the turn")} maxLength={12} onChange={set("turnWidth")} value={editing.turnWidth} /> : null}
        {editing.kind === "lift" ? <>
          <TextInput dir="ltr" label={t("Cabin width")} maxLength={12} onChange={set("cabinWidth")} value={editing.cabinWidth} />
          <TextInput dir="ltr" label={t("Cabin depth")} maxLength={12} onChange={set("cabinDepth")} value={editing.cabinDepth} />
          <TextInput dir="ltr" label={t("Cabin height")} maxLength={12} onChange={set("cabinHeight")} value={editing.cabinHeight} />
        </> : null}
      </div> : null}
    </FormDialog>
  </div>;
}

/** Each item's fit through the site, with the route details and the override that lets a failing item be ordered. */
export function FitCheckList({ workspaceId, caseId, itemIds, unit = "cm", canOverride, context = "approval", refreshKey = 0 }: {
  workspaceId: string; caseId: string; itemIds: string[]; unit?: string; canOverride: boolean; context?: "approval" | "ordering"; refreshKey?: number;
}) {
  const t = useT();
  const { status, kinds } = useFitLabels();
  const [fits, setFits] = useState<ItemFit[] | null>(null);
  const [error, setError] = useState("");
  const [overriding, setOverriding] = useState<{ fit: ItemFit; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const key = itemIds.join(",");
  const load = useCallback(() => (key ? sourcingApi<{ items: ItemFit[] }>(workspaceId, `cases/${caseId}/fit-checks`, { body: { itemIds: key.split(",") } }) : Promise.resolve({ items: [] }))
    .then((next) => { setFits(next.items); setError(""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "")), [workspaceId, caseId, key]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  if (error && !fits) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!fits) return <Skeleton lines={3} />;
  if (!fits.length) return <EmptyState title={t("No items to check")} />;
  const why = (fit: ItemFit) => fit.result.reason === "no_access_points" ? t("Measure the site's doors, lifts and stairs") : fit.result.reason === "item_size_missing" ? t("Add the item's size") : null;
  const override = async () => {
    if (!overriding) return;
    await sourcingApi(workspaceId, `cases/${caseId}/fit-checks/overrides`, { body: { id: overriding.id, itemId: overriding.fit.itemId, inputsHash: overriding.fit.inputsHash, reason: reason.trim(), context } })
      .catch(async (cause) => { if (cause instanceof SourcingRequestError && cause.status === 409) await load(); throw cause; });
    setOverriding(null); setReason(""); await load();
  };
  return <div className={styles.panel}>
    <ul className={styles.points}>{fits.map((fit) => <li className={styles.point} key={fit.itemId}>
      <div className={styles.route}>
        <header><span dir="auto">{fit.name}</span><FitCheckBadge fit={fit} /></header>
        {why(fit) ? <small>{why(fit)}</small> : null}
        {fit.result.routes.map((route) => <ul className={styles.fitRows} key={route.route} aria-label={route.route}>{route.points.map((point) => <li key={point.pointId}>
          <span><bdi>{route.route}</bdi> · <bdi dir="auto">{point.label}</bdi> <small>{kinds[point.kind]}</small></span>
          <span><Badge tone={status[point.status].tone}>{status[point.status].label}</Badge>{point.spareMm !== null && point.status !== "unknown" ? <small dir="ltr"> {point.spareMm >= 0 ? "+" : ""}{fromMm(point.spareMm, unit)} {unit}</small> : null}</span>
        </li>)}</ul>)}
        {fit.override ? <small className={styles.override}>{t("Overridden by")} {fit.override.overriddenByName ?? ""}: <bdi dir="auto">{fit.override.reason}</bdi></small> : null}
      </div>
      {fit.blocksOrdering && canOverride ? <Button onPress={() => setOverriding({ fit, id: crypto.randomUUID() })} size="compact">{t("Override")}</Button> : <span />}
    </li>)}</ul>
    <FormDialog isDirty={Boolean(reason.trim())} isOpen={Boolean(overriding)} isSubmitDisabled={reason.trim().length < 3} onClose={() => { setOverriding(null); setReason(""); }} onSubmit={override} submitLabel={t("Override")} title={t("Override the fit check")}>
      <TextAreaField isRequired label={t("Reason")} maxLength={500} onChange={setReason} value={reason} />
    </FormDialog>
  </div>;
}
