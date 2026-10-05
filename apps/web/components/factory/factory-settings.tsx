"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DateField, EmptyState, InlineNotice, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError, NoAccessState, FormDialog, MoneyField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySettings, FactorySettingsState, Workcenter, WorkcenterRate } from "@/lib/factory/types";
import { addExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

type Flag = "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck";
type Draft = { id: string; name: string; hours: string; active: boolean; isNew: boolean; rate: string; rateFrom: string | null };

/** A workcenter's rates, oldest first; the one in force on a day is set from the latest date on or before it. */
const ratesOf = (rates: WorkcenterRate[], workcenterId: string) => rates.filter((rate) => rate.workcenterId === workcenterId);
const rateOn = (rates: WorkcenterRate[], day: string) => rates.filter((rate) => rate.from <= day).at(-1) ?? null;

/** Settings → Factory: what a work order needs before it's released, whether output is checked, and the workcenters with their hourly rates. */
export function FactorySettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<FactorySettingsState | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Factory")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} shape="form" />;
  const readOnly = !data.canManage;
  const flip = async (key: Flag, value: boolean) => {
    setError("");
    try { setData(await api.saveSettings({ version: data.settings.version, [key]: value })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const row = (key: Flag, label: string, hint: string) => <SettingsRow label={label} hint={hint}>
    <Switch aria-label={label} isDisabled={readOnly} isSelected={(data.settings as FactorySettings)[key]} onChange={(value) => void flip(key, value)} />
  </SettingsRow>;
  const hourly = (value: string) => t("{amount} an hour", { amount: format.money(value, data.currency) });
  const edit = (center: Workcenter) => {
    const current = rateOn(ratesOf(data.rates, center.id), data.today);
    setDraft({ id: center.id, name: center.name, hours: center.hoursPerDay ? quantityText(center.hoursPerDay) : "", active: center.active, isNew: false,
      rate: current ? quantityText(current.rate) : "", rateFrom: data.today });
  };
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
        : <ul className={styles.places}>{data.workcenters.map((center) => {
          const rates = ratesOf(data.rates, center.id);
          const current = rateOn(rates, data.today), next = rates.find((rate) => rate.from > data.today);
          return <li key={center.id}>
            <span className={styles.nameCell}><span>{center.name}</span>
              <small>{[center.hoursPerDay ? t("{hours} hours a day", { hours: quantityText(center.hoursPerDay) }) : "",
                data.canSeeRates ? (current ? hourly(current.rate) : t("No hourly rate")) : "",
                data.canSeeRates && next ? t("{amount} from {date}", { amount: hourly(next.rate), date: format.day(next.from) }) : "",
                center.active ? "" : t("Not in use")].filter(Boolean).join(" · ")}</small></span>
            {data.canManage ? <Button size="compact" variant="quiet" onPress={() => edit(center)}>{t("Edit")}</Button> : null}
          </li>;
        })}</ul>}
      {data.canManage ? <div className={styles.actions}><Button size="compact" onPress={() => setDraft({ id: crypto.randomUUID(), name: "", hours: "", active: true, isNew: true, rate: "", rateFrom: data.today })}>
        {t("Add workcenter")}</Button></div> : null}
    </SettingsSection>
    {draft ? <WorkcenterDialog draft={draft} currency={data.currency} current={rateOn(ratesOf(data.rates, draft.id), data.today)} onClose={() => setDraft(null)} onSave={async (next) => {
      // A rate saved from a date that already has one corrects it, checked against that rate's version.
      const rateVersion = ratesOf(data.rates, next.id).find((rate) => rate.from === next.rateFrom)?.version ?? 0;
      setData(await api.saveWorkcenter({ id: next.id, name: next.name.trim(), hoursPerDay: next.hours || null, active: next.active, hourlyRate: next.rate || null, rateFrom: next.rateFrom,
        rateVersion }));
      setDraft(null);
    }} /> : null}
  </SettingsPage>;
}

function WorkcenterDialog({ draft, currency, current, onClose, onSave }: { draft: Draft; currency: string; current: WorkcenterRate | null; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(draft);
  const [error, setError] = useState("");
  // A new rate applies from a date (today unless said); the days before keep the rate they had.
  const changed = Boolean(value.rate) && (!current || addExact(value.rate) !== addExact(current.rate));
  return <FormDialog size="md" title={draft.isNew ? t("Add workcenter") : draft.name} onClose={onClose} error={error || undefined} isSubmitDisabled={!value.name.trim() || (Boolean(current) && !value.rate) || (changed && !value.rateFrom)} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave(value); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
      }}>
      <TextInput label={t("Name")} isRequired value={value.name} onChange={(name) => setValue({ ...value, name })} />
      <TextInput label={t("Hours a day")} inputMode="decimal" value={value.hours} onChange={(hours) => setValue({ ...value, hours: hours.replace(/[^\d.]/g, "") })} />
      <MoneyField label={t("Hourly rate")} currency={currency} value={value.rate} onChange={(rate) => setValue({ ...value, rate })} />
      {changed ? <DateField label={t("From")} isRequired value={value.rateFrom ? parseDate(value.rateFrom) : null} onChange={(day) => setValue({ ...value, rateFrom: day ? day.toString() : null })} /> : null}
      {!draft.isNew ? <Switch isSelected={value.active} onChange={(active) => setValue({ ...value, active })}>{t("In use")}</Switch> : null}
  </FormDialog>;
}
