"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button, ErrorState, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { SourcingRequestError, sourcingApi, type ClipField, type ItemSource } from "@/lib/workspace/product-sourcing";
import { ProvenanceNote } from "./product-clip-dialog";
import styles from "./product-sourcing.module.css";

const UNITS = ["mm", "cm", "m", "in", "ft"];
const SIZE_KEYS = ["width", "depth", "height", "diagonalDepth"] as const;

/** An item's outside size (used by the fit check) and, for clipped items, the supplier page and each field's origin. */
export function CatalogItemSource({ workspaceId, itemId, canManage }: { workspaceId: string; itemId: string; canManage: boolean }) {
  const t = useT();
  const [data, setData] = useState<ItemSource | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Record<(typeof SIZE_KEYS)[number] | "unit", string> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    sourcingApi<ItemSource>(workspaceId, `items/${itemId}/source`).then((next) => {
      if (!live) return;
      setData(next); setError("");
      const size = next.size;
      setDraft({ width: size?.width ? String(Number(size.width)) : "", depth: size?.depth ? String(Number(size.depth)) : "", height: size?.height ? String(Number(size.height)) : "",
        diagonalDepth: size?.diagonalDepth ? String(Number(size.diagonalDepth)) : "", unit: size?.unit ?? next.defaultUnit });
    }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : ""); });
    return () => { live = false; };
  }, [workspaceId, itemId, attempt]);
  if (error) return <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!data || !draft) return <Skeleton lines={3} shape="facts" />;
  const labels: Record<(typeof SIZE_KEYS)[number], string> = { width: t("Width"), depth: t("Depth"), height: t("Height"), diagonalDepth: t("Diagonal depth") };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await sourcingApi(workspaceId, `items/${itemId}/dimensions`, { method: "PUT", body: { version: data.size?.version ?? 0, unit: draft.unit, ...Object.fromEntries(SIZE_KEYS.map((key) => [key, draft[key].trim() || null])) } });
      setAttempt((value) => value + 1);
    } catch (reason) {
      if (reason instanceof SourcingRequestError && reason.status === 409) setAttempt((value) => value + 1);
      setError(reason instanceof Error ? reason.message : "");
    } finally { setBusy(false); }
  };
  const source = data.source;
  const shown: Partial<Record<ClipField, string>> = { name: t("Name"), price: t("Price"), finish: t("Finish"), material: t("Material"), colour: t("Colour"), lead_time_days: t("Lead time (days)") };
  return <div className={styles.panel}>
    <div className={styles.sizeRow} role="group" aria-label={t("Size")}>
      {SIZE_KEYS.map((key) => <TextInput dir="ltr" isReadOnly={!canManage} key={key} label={labels[key]} maxLength={12} onChange={(value) => setDraft({ ...draft, [key]: value })} value={draft[key]} />)}
      <SelectField isDisabled={!canManage} items={UNITS.map((unit) => ({ id: unit, label: unit }))} label={t("Unit")} onSelectionChange={(key) => setDraft({ ...draft, unit: String(key) })} selectedKey={draft.unit} />
    </div>
    {canManage ? <div className={styles.actions}><Button isLoading={busy} onPress={() => void save()} size="compact">{t("Save size")}</Button></div> : null}
    {source ? <>
      <p className={styles.source}><span dir="ltr">{source.host}</span><a href={source.finalUrl} rel="noopener noreferrer nofollow" target="_blank"><ExternalLink aria-hidden="true" data-directional="true" size={12} /> {t("Supplier page")}</a></p>
      <dl className={styles.facts}>{source.fields.filter((row) => shown[row.field] && row.finalValue).map((row) => <div key={row!.field}>
        <dt>{shown[row.field]}</dt>
        <dd dir="auto">{row!.finalValue}</dd>
        <ProvenanceNote row={row!} />
      </div>)}</dl>
    </> : null}
  </div>;
}
