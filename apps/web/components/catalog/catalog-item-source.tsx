"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button, ErrorState, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { SourcingRequestError, sourcingApi, type ClipField, type ItemSource } from "@/lib/workspace/product-sourcing";
import { ProvenanceNote } from "./product-clip-dialog";
import styles from "./product-sourcing.module.css";

const UNITS = ["mm", "cm", "m", "in", "ft"];
const SIZE_KEYS = ["width", "depth", "height", "diagonalDepth"] as const;
type SizeDraft = Record<(typeof SIZE_KEYS)[number] | "unit", string>;

/** An item's outside size and, for clipped items, the supplier page it came from (loaded once for both tabs). */
export function useItemSource(workspaceId: string, itemId: string, enabled: boolean) {
  const [data, setData] = useState<ItemSource | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    sourcingApi<ItemSource>(workspaceId, `items/${itemId}/source`).then((next) => { if (live) { setData(next); setError(""); } })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : ""); });
    return () => { live = false; };
  }, [workspaceId, itemId, enabled, attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { data: enabled ? data : null, error: enabled ? error : "", reload };
}

const draftOf = (data: ItemSource): SizeDraft => {
  const size = data.size;
  return { width: size?.width ? String(Number(size.width)) : "", depth: size?.depth ? String(Number(size.depth)) : "", height: size?.height ? String(Number(size.height)) : "",
    diagonalDepth: size?.diagonalDepth ? String(Number(size.diagonalDepth)) : "", unit: size?.unit ?? data.defaultUnit };
};

/** The item's outside size (used by the fit check), with the size as the supplier wrote it when it isn't one number. */
export function CatalogItemSize({ workspaceId, itemId, canManage, source, notes }: { workspaceId: string; itemId: string; canManage: boolean; source: ReturnType<typeof useItemSource>; notes?: ReactNode }) {
  const { data, error: loadError, reload } = source;
  // A save's problem outlives the reload it causes (a size someone else changed loads theirs).
  const [error, setError] = useState("");
  if (loadError) return <ErrorState description={loadError} onRetry={reload} />;
  if (!data) return <Skeleton lines={3} shape="facts" />;
  // Keyed by the saved size so a reload starts the editor from what was saved.
  return <SizeEditor canManage={canManage} data={data} error={error} itemId={itemId} key={`${data.size?.version ?? 0}`} notes={notes} onError={setError} onSaved={reload} workspaceId={workspaceId} />;
}

function SizeEditor({ workspaceId, itemId, canManage, data, notes, error, onError, onSaved }: { workspaceId: string; itemId: string; canManage: boolean; data: ItemSource; notes?: ReactNode; error: string; onError: (message: string) => void; onSaved: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(() => draftOf(data));
  const [busy, setBusy] = useState(false);
  const setError = onError;
  const labels: Record<(typeof SIZE_KEYS)[number], string> = { width: t("Width"), depth: t("Depth"), height: t("Height"), diagonalDepth: t("Diagonal depth") };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await sourcingApi(workspaceId, `items/${itemId}/dimensions`, { method: "PUT", body: { version: data.size?.version ?? 0, unit: draft.unit, ...Object.fromEntries(SIZE_KEYS.map((key) => [key, draft[key].trim() || null])) } });
      onSaved();
    } catch (reason) {
      if (reason instanceof SourcingRequestError && reason.status === 409) onSaved();
      setError(reason instanceof Error ? reason.message : "");
    } finally { setBusy(false); }
  };
  return <div className={styles.panel}>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    <div className={styles.sizeGrid} role="group" aria-label={t("Size")}>
      {SIZE_KEYS.map((key) => <TextInput dir="ltr" isReadOnly={!canManage} key={key} label={labels[key]} maxLength={12} onChange={(value) => setDraft({ ...draft, [key]: value })} value={draft[key]} />)}
      <SelectField isDisabled={!canManage} items={UNITS.map((unit) => ({ id: unit, label: unit }))} label={t("Unit")} onSelectionChange={(key) => setDraft({ ...draft, unit: String(key) })} selectedKey={draft.unit} />
    </div>
    {notes}
    {canManage ? <div className={styles.actions}><Button isLoading={busy} onPress={() => void save()} size="compact">{t("Save size")}</Button></div> : null}
  </div>;
}

/** Where a clipped item came from: the supplier page and each field's origin. */
export function CatalogItemProvenance({ source }: { source: NonNullable<ItemSource["source"]> }) {
  const t = useT();
  const shown: Partial<Record<ClipField, string>> = { name: t("Name"), price: t("Price"), finish: t("Finish"), material: t("Material"), colour: t("Colour"), lead_time_days: t("Lead time (days)") };
  return <div className={styles.panel}>
    <p className={styles.source}><span dir="ltr">{source.host}</span><a href={source.finalUrl} rel="noopener noreferrer nofollow" target="_blank"><ExternalLink aria-hidden="true" data-directional="true" size={12} /> {t("Supplier page")}</a></p>
    <dl className={styles.facts}>{source.fields.filter((row) => shown[row.field] && row.finalValue).map((row) => <div key={row.field}>
      <dt>{shown[row.field]}</dt>
      <dd dir="auto">{row.finalValue}</dd>
      <ProvenanceNote row={row} />
    </div>)}</dl>
  </div>;
}
