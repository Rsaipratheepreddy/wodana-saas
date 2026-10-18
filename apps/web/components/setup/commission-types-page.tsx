"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, IconButton, InlineNotice, SaveBar, SettingsPage, SettingsSection, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { KIT_COMMISSION_LABELS, KIT_COMMISSION_TYPES, loadCommissionTypes, saveCommissionTypes, type CommissionTypes } from "@/lib/setup/commissions";
import styles from "./setup.module.css";

type Row = { key: string; code?: string; label: string };

/**
 * §0.3 P3, Settings → Commissions: the commission types a deal file offers (one to eight), named and ordered by the
 * firm. Removing one retires it: lines already using it keep it; new lines can't pick it.
 */
export function CommissionTypesPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [saved, setSaved] = useState<CommissionTypes | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // The kit's names read in the person's language until the firm renames them.
  const named = useCallback((list: CommissionTypes["types"]) => list.map((type) => ({ key: type.code, code: type.code,
    label: KIT_COMMISSION_LABELS[type.code] && KIT_COMMISSION_TYPES.find((kit) => kit.code === type.code)?.label === type.label ? t(KIT_COMMISSION_LABELS[type.code]) : type.label })), [t]);
  const load = useCallback(() => { setFailure(""); loadCommissionTypes(workspaceId).then((next) => { setSaved(next); setRows(named(next.types)); }).catch((error: Error) => setFailure(error.message)); }, [workspaceId, named]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  if (failure && !saved) return <SettingsPage title={t("Commissions")}><ErrorState description={failure} onRetry={load} /></SettingsPage>;
  if (!saved) return <SettingsPage title={t("Commissions")}><Skeleton lines={4} shape="form" /></SettingsPage>;
  const dirty = JSON.stringify(rows.map((row) => row.label.trim())) !== JSON.stringify(named(saved.types).map((row) => row.label)) || rows.length !== saved.types.length;
  const edit = (key: string, label: string) => { setJustSaved(false); setRows((current) => current.map((row) => (row.key === key ? { ...row, label } : row))); };
  const save = async () => {
    setBusy(true); setFailure("");
    try {
      const next = await saveCommissionTypes(workspaceId, saved.version, rows.map((row) => ({ ...(row.code ? { code: row.code } : {}), label: row.label.trim() })));
      setSaved(next); setRows(named(next.types)); setJustSaved(true);
    } catch (error) { setFailure((error as Error).message); }
    setBusy(false);
  };
  return <SettingsPage title={t("Commissions")}>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <SettingsSection id="commission-types" title={t("Commission types")}>
      <ol className={styles.typeList}>
        {rows.map((row, index) => <li key={row.key}>
          <TextInput aria-label={t("Commission type {number}", { number: index + 1 })} label={null} maxLength={60} value={row.label} onChange={(label) => edit(row.key, label)} />
          <IconButton aria-label={t("Remove {name}", { name: row.label || t("Commission type {number}", { number: index + 1 }) })} size="compact" variant="quiet" isDisabled={rows.length <= 1}
            onPress={() => { setJustSaved(false); setRows((current) => current.filter((item) => item.key !== row.key)); }}><X size={14} /></IconButton>
        </li>)}
      </ol>
      {rows.length < 8 ? <span className={styles.typeAdd}><Button size="compact" onPress={() => { setJustSaved(false); setRows((current) => [...current, { key: crypto.randomUUID(), label: "" }]); }}><Plus aria-hidden="true" size={14} />{t("Add a type")}</Button></span> : null}
    </SettingsSection>
    <SaveBar isDirty={dirty} isSaving={busy} saved={justSaved} onSave={() => void save()} onDiscard={() => setRows(named(saved.types))} />
  </SettingsPage>;
}
