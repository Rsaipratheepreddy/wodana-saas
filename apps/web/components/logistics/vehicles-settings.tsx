"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, FormDialog, InlineNotice, NumericInput, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { logisticsApi } from "@/lib/logistics/client";
import type { VehiclesState } from "@/lib/logistics/types";
import factoryStyles from "../factory/factory.module.css";

type Draft = { id: string; version: number; name: string; plate: string; kind: string; capacityNote: string; active: boolean; isNew: boolean };

/**
 * Settings → Factory: the vehicles deliveries go out in (PLM-135: a name or plate, its type, a capacity note, in use or
 * not), whether Furniture Only deliveries need a building permit too, and how many working days before a delivery a
 * missing permit is raised (PLM-136). Read by everyone who books; kept by the factory and logistics managers.
 */
export function LogisticsSettingsSections({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => logisticsApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<VehiclesState | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [reminder, setReminder] = useState<number | null>(null);
  const load = useCallback(async () => {
    try { const next = await api.vehicles(); setData(next); setDays(next.permitWarningDays); setReminder(next.permitExpiryReminderDays ?? 7); setError(""); }
    catch (cause) { if ((cause as { status?: number }).status === 403) setHidden(true); else setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (hidden) return null;
  if (!data) return error ? <InlineNotice tone="error" message={error} /> : <Skeleton lines={3} shape="form" />;
  const saveDays = async () => {
    if (days === null || days === data.permitWarningDays) return;
    try { setData(await api.saveSettings({ version: data.settingsVersion, permitWarningDays: days })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const saveReminder = async () => {
    if (reminder === null || reminder === (data.permitExpiryReminderDays ?? 7)) return;
    try { setData(await api.saveSettings({ version: data.settingsVersion, permitExpiryReminderDays: reminder })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  return <>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="vehicles" title={t("Delivery vehicles")}>
      {!data.vehicles.length ? <EmptyState illustration={null} title={t("No vehicles yet")} description={t("Add the vans and trucks deliveries go out in.")} />
        : <ul className={factoryStyles.places}>{data.vehicles.map((vehicle) => <li key={vehicle.id}>
          <span className={factoryStyles.nameCell}><span>{vehicle.name}</span>
            <small>{[vehicle.plate !== vehicle.name ? vehicle.plate : "", vehicle.kind, vehicle.capacityNote, vehicle.active ? "" : t("Not in use")].filter(Boolean).join(" · ")}</small></span>
          {data.canManage ? <Button size="compact" variant="quiet" onPress={() => setDraft({ ...vehicle, isNew: false })}>{t("Edit")}</Button> : null}
        </li>)}</ul>}
      {data.canManage ? <div className={factoryStyles.actions}><Button size="compact" onPress={() => setDraft({ id: crypto.randomUUID(), version: 0, name: "", plate: "", kind: "", capacityNote: "", active: true, isNew: true })}>
        {t("Add vehicle")}</Button></div> : null}
    </SettingsSection>
    <SettingsSection id="permits" title={t("Building permits")}>
      <SettingsRow label={t("Furniture deliveries need one")} hint={t("Orders delivered without a project (Furniture Only) are booked only with a building permit for the day.")}>
        <Switch aria-label={t("Furniture deliveries need one")} isDisabled={!data.canManage} isSelected={data.dealDeliveryPermit} onChange={(value) => void (async () => {
          try { setData(await api.saveSettings({ version: data.settingsVersion, dealDeliveryPermit: value })); setError(""); }
          catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
        })()} />
      </SettingsRow>
      <SettingsRow label={t("Warn before a delivery")} hint={t("Working days before a delivery with no building permit for its day.")}>
        <NumericInput label={<span className="wd-visually-hidden">{t("Warn before a delivery")}</span>} aria-label={t("Warn before a delivery")} minValue={0} maxValue={30} isDisabled={!data.canManage} value={days ?? data.permitWarningDays}
          onChange={(value) => setDays(Number.isFinite(value) ? value : null)} onBlur={() => void saveDays()} />
      </SettingsRow>
      <SettingsRow label={t("Remind before a permit ends")} hint={t("Days before each permit ends, unless the permit has its own.")}>
        <NumericInput label={<span className="wd-visually-hidden">{t("Remind before a permit ends")}</span>} aria-label={t("Remind before a permit ends")} minValue={0} maxValue={365}
          isDisabled={!data.canManage} value={reminder ?? data.permitExpiryReminderDays ?? 7} onChange={(value) => setReminder(Number.isFinite(value) ? value : null)}
          onBlur={() => void saveReminder()} />
      </SettingsRow>
    </SettingsSection>
    {draft ? <VehicleDialog draft={draft} onClose={() => setDraft(null)} onSave={async (next) => {
      setData(await api.saveVehicle({ id: next.id, version: next.version, name: next.name.trim(), plate: next.plate.trim(), kind: next.kind.trim(), capacityNote: next.capacityNote.trim(), active: next.active }));
      setDraft(null);
    }} /> : null}
  </>;
}

function VehicleDialog({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(draft);
  const set = (key: keyof Draft) => (next: string) => setValue({ ...value, [key]: next });
  return <FormDialog size="md" title={draft.isNew ? t("Add vehicle") : draft.name} submitLabel={t("Save")} onClose={onClose} isDirty={JSON.stringify(value) !== JSON.stringify(draft)}
    isSubmitDisabled={!value.name.trim() && !value.plate.trim()} onSubmit={() => onSave(value)}>
    <TextInput label={t("Name")} description={t("How the team calls it, such as Van 2.")} value={value.name} onChange={set("name")} maxLength={120} />
    <TextInput label={t("Plate")} value={value.plate} onChange={set("plate")} maxLength={40} />
    <TextInput label={t("Type")} placeholder={t("Van, truck, pickup")} value={value.kind} onChange={set("kind")} maxLength={60} />
    <TextInput label={t("Capacity")} placeholder={t("What it can carry")} value={value.capacityNote} onChange={set("capacityNote")} maxLength={200} />
    {!draft.isNew ? <Switch isSelected={value.active} onChange={(active) => setValue({ ...value, active })}>{t("In use")}</Switch> : null}
  </FormDialog>;
}
