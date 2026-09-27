"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, EmptyState, InlineNotice, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySettings, FactorySettingsState, Workcenter } from "@/lib/factory/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

type Flag = "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck";
type Draft = { id: string; name: string; hours: string; active: boolean; isNew: boolean };

/** Settings → Factory: what a work order needs before it's released, whether output is checked, and the workcenters. */
export function FactorySettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<FactorySettingsState | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} />;
  const readOnly = !data.canManage;
  const flip = async (key: Flag, value: boolean) => {
    setError("");
    try { setData(await api.saveSettings({ version: data.settings.version, [key]: value })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const row = (key: Flag, label: string, hint: string) => <SettingsRow label={label} hint={hint}>
    <Switch aria-label={label} isDisabled={readOnly} isSelected={(data.settings as FactorySettings)[key]} onChange={(value) => void flip(key, value)} />
  </SettingsRow>;
  const edit = (center: Workcenter) => setDraft({ id: center.id, name: center.name, hours: center.hoursPerDay ? quantityText(center.hoursPerDay) : "", active: center.active, isNew: false });
  return <SettingsPage title={t("Factory")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="release" title={t("Before a work order is released")}>
      {row("requireDrawing", t("Drawing approved"), t("Someone records which drawing was approved."))}
      {row("requirePayment", t("Payment before production verified"), t("The payments the client agreed to make before production are verified."))}
      {row("requireMaterials", t("Materials in"), t("Everything the package needs has arrived or was given from stock."))}
    </SettingsSection>
    <SettingsSection id="output" title={t("Output")}>
      {row("requireCheck", t("Check quality"), t("Approved output is checked before it's ready. Off: approving it makes it ready."))}
    </SettingsSection>
    <SettingsSection id="workcenters" title={t("Workcenters")}>
      {!data.workcenters.length ? <EmptyState illustration={null} title={t("No workcenters yet")} description={t("Add where work is made, such as joinery or paint.")} />
        : <ul className={styles.places}>{data.workcenters.map((center) => <li key={center.id}>
          <span className={styles.nameCell}><span>{center.name}</span>
            <small>{[center.hoursPerDay ? t("{hours} hours a day", { hours: quantityText(center.hoursPerDay) }) : "", center.active ? "" : t("Not in use")].filter(Boolean).join(" · ")}</small></span>
          {data.canManage ? <Button size="compact" variant="quiet" onPress={() => edit(center)}>{t("Edit")}</Button> : null}
        </li>)}</ul>}
      {data.canManage ? <div className={styles.actions}><Button size="compact" onPress={() => setDraft({ id: crypto.randomUUID(), name: "", hours: "", active: true, isNew: true })}>{t("Add workcenter")}</Button></div> : null}
    </SettingsSection>
    {draft ? <WorkcenterDialog draft={draft} onClose={() => setDraft(null)} onSave={async (next) => {
      setData(await api.saveWorkcenter({ id: next.id, name: next.name.trim(), hoursPerDay: next.hours || null, active: next.active })); setDraft(null);
    }} /> : null}
  </SettingsPage>;
}

function WorkcenterDialog({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(draft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={draft.isNew ? t("Add workcenter") : draft.name} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!value.name.trim()} onPress={async () => {
        setBusy(true); setError("");
        try { await onSave(value); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.pair}>
        <TextInput label={t("Name")} isRequired value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextInput label={t("Hours a day")} inputMode="decimal" value={value.hours} onChange={(hours) => setValue({ ...value, hours: hours.replace(/[^\d.]/g, "") })} />
      </div>
      {!draft.isNew ? <Switch isSelected={value.active} onChange={(active) => setValue({ ...value, active })}>{t("In use")}</Switch> : null}
    </div>
  </ControlledModalDialog>;
}
