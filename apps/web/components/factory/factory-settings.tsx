"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DateField, EmptyState, InlineNotice, NumericInput, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError, NoAccessState, FormDialog, MoneyField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySettings, FactorySettingsState, ProductionStep, Workcenter, WorkcenterRate } from "@/lib/factory/types";
import { PRODUCTION_STEP_KINDS } from "@/lib/factory/production";
import { addExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { LogisticsSettingsSections } from "../logistics/vehicles-settings";
import { useProductionStepLabel } from "./factory-labels";
import styles from "./factory.module.css";

type Flag = "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck";
type Draft = { id: string; name: string; hours: string; active: boolean; isNew: boolean; rate: string; rateFrom: string | null };

/** A workcenter's rates, oldest first; the one in force on a day is set from the latest date on or before it. */
const ratesOf = (rates: WorkcenterRate[], workcenterId: string) => rates.filter((rate) => rate.workcenterId === workcenterId);
const rateOn = (rates: WorkcenterRate[], day: string) => rates.filter((rate) => rate.from <= day).at(-1) ?? null;

/** Settings → Factory: what a work order needs before it's released, whether output is checked, the workcenters with their hourly rates, the delivery vehicles and the permit warning. */
export function FactorySettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<FactorySettingsState | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingSteps, setEditingSteps] = useState(false);
  const [reminderDays, setReminderDays] = useState<number | null>(null);
  const stepLabel = useProductionStepLabel();
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Factory")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} shape="form" />;
  const readOnly = !data.canManage;
  const save = async (patch: Record<string, unknown>) => {
    setError("");
    try { setData(await api.saveSettings({ version: data.settings.version, ...patch })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const flip = (key: Flag, value: boolean) => save({ [key]: value });
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
    <SettingsSection id="production" title={t("Production status")}>
      <SettingsRow label={t("Steps")} hint={t("Read from the work orders as the factory works them.")}>
        <span className={styles.filters}>
          <span>{(data.settings.productionSteps ?? []).map(stepLabel).join(" → ")}</span>
          {data.canManage ? <Button size="compact" variant="quiet" aria-label={t("Edit production status")} onPress={() => setEditingSteps(true)}>{t("Edit")}</Button> : null}
        </span>
      </SettingsRow>
      <SettingsRow label={t("Production target")} hint={t("Projects over it are flagged on the schedule.")}>
        <span>{data.settings.productionWeeks ? t("{count} weeks", { count: data.settings.productionWeeks }) : t("Not set")}</span>
      </SettingsRow>
      <SettingsRow label={t("Remind the client to pay")} hint={t("Days before the latest planned ready date of the work orders tied to a payment.")}>
        <NumericInput label={<span className="wd-visually-hidden">{t("Remind the client to pay")}</span>} aria-label={t("Remind the client to pay")} minValue={0} maxValue={90}
          isDisabled={readOnly} suffix={t("days")} value={reminderDays ?? data.settings.balanceReminderDays ?? 7} onChange={(value) => setReminderDays(Number.isFinite(value) ? value : null)}
          onBlur={() => { if (reminderDays !== null && reminderDays !== (data.settings.balanceReminderDays ?? 7)) void save({ balanceReminderDays: reminderDays }); }} />
      </SettingsRow>
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
    {/* Palm, 6 Oct: deliveries record the vehicle; a missing building permit is raised ahead of the delivery. */}
    <LogisticsSettingsSections workspaceId={workspaceId} />
    {editingSteps ? <ProductionStepsDialog steps={data.settings.productionSteps ?? []} weeks={data.settings.productionWeeks ?? null} onClose={() => setEditingSteps(false)}
      onSave={async (productionSteps, productionWeeks) => { setData(await api.saveSettings({ version: data.settings.version, productionSteps, productionWeeks })); setEditingSteps(false); }} /> : null}
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

/** PLM-063: which production steps the firm keeps (Ready always) and its own word for each, and its internal target in weeks. */
function ProductionStepsDialog({ steps, weeks, onClose, onSave }: { steps: ProductionStep[]; weeks: number | null; onClose: () => void;
  onSave: (steps: ProductionStep[], weeks: number | null) => Promise<void> }) {
  const t = useT();
  const standard = useProductionStepLabel();
  const [rows, setRows] = useState(() => PRODUCTION_STEP_KINDS.map((kind) => {
    const kept = steps.find((step) => step.kind === kind);
    return { kind, on: Boolean(kept), label: kept?.label ?? "" };
  }));
  const [target, setTarget] = useState(weeks ? String(weeks) : "");
  const [error, setError] = useState("");
  const kept = rows.filter((row) => row.on);
  const weeksValid = !target || (/^\d{1,2}$/.test(target) && Number(target) >= 1 && Number(target) <= 52);
  return <FormDialog size="md" title={t("Production status")} onClose={onClose} error={error || undefined} isSubmitDisabled={kept.length < 2 || !weeksValid} submitLabel={t("Save")}
    onSubmit={async () => {
      setError("");
      try { await onSave(kept.map(({ kind, label }) => ({ kind, label: label.trim() })), target ? Number(target) : null); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    }}>
    {rows.map((row, index) => <div key={row.kind} className={styles.filters}>
      <Switch isSelected={row.on} isDisabled={row.kind === "ready"} onChange={(on) => setRows(rows.map((item, at) => (at === index ? { ...item, on } : item)))}>
        {standard({ kind: row.kind, label: "" })}</Switch>
      <TextInput label={t("Name it")} placeholder={standard({ kind: row.kind, label: "" })} maxLength={40} isDisabled={!row.on} value={row.label}
        onChange={(label) => setRows(rows.map((item, at) => (at === index ? { ...item, label } : item)))} />
    </div>)}
    <TextInput label={t("Production target in weeks")} inputMode="numeric" value={target} onChange={(value) => setTarget(value.replace(/[^\d]/g, ""))}
      isInvalid={!weeksValid} errorMessage={weeksValid ? undefined : t("From 1 to 52 weeks.")} />
  </FormDialog>;
}
