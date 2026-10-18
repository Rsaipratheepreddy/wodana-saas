"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import {
  Button, Checkbox, DateField, EmptyState, Fieldset, InlineNotice, NumericInput, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError,
  NoAccessState, FormDialog, MoneyField,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { FactorySettings, FactorySettingsState, InspectionStage, InspectionStageKind, ProductionStep, Workcenter, WorkcenterRate } from "@/lib/factory/types";
import { PRODUCTION_STEP_KINDS } from "@/lib/factory/production";
import { addExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { LogisticsSettingsSections } from "../logistics/vehicles-settings";
import { useInspectionLabels, useProductionStepLabel } from "./factory-labels";
import styles from "./factory.module.css";

type Flag = "requireDrawing" | "requirePayment" | "requireMaterials" | "requireCheck" | "requireTechnicalHandover" | "requireFactoryRequirements" | "requireQs" | "requireSuppliesSignoff";
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
  const [editingInspections, setEditingInspections] = useState(false);
  const [inspectionDays, setInspectionDays] = useState<number | null>(null);
  const stepLabel = useProductionStepLabel();
  const inspectionLabels = useInspectionLabels();
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Factory")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} shape="form" />;
  const readOnly = !data.canManage;
  const choices = data.inspectionChoices ?? { roles: [], workPackages: [], designPackages: [] };
  const roleName = (key: string) => choices.roles.find((role) => role.key === key)?.label ?? key;
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
      {row("requireSuppliesSignoff", t("Supplies signed off"), t("Procurement signed off the item's supplies after its material list, signed drawing and price check."))}
    </SettingsSection>
    {/* PLM-174: the path E checks; they hold only on bespoke (made-to-order) jobs. */}
    <SettingsSection id="bespoke" title={t("Before a work order on a bespoke job is released")}>
      {row("requireTechnicalHandover", t("Technical handover accepted"), t("The technical team accepted the handover pack from sales or design."))}
      {row("requireFactoryRequirements", t("Factory requirements confirmed"), t("The line's materials and labour come from a verified recipe or a record the factory lead confirmed."))}
      {row("requireQs", t("QS approved the quotation"), t("The quotation passed its QS step."))}
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
    {/* PLM-150: the design team inspects made items at the factory before they go to site. */}
    <SettingsSection id="inspections" title={t("Design inspections")}>
      <SettingsRow label={t("Design inspections")} hint={t("Dispatch waits until the last one passed.")}>
        <Switch aria-label={t("Design inspections")} isDisabled={readOnly} isSelected={Boolean(data.settings.inspectionsEnabled)} onChange={(value) => void save({ inspectionsEnabled: value })} />
      </SettingsRow>
      {data.settings.inspectionsEnabled ? <>
        <SettingsRow label={t("Inspections")} hint={t("Before the final finish, and after finishing.")}>
          <span className={styles.filters}>
            <span>{(data.settings.inspectionStages ?? []).map((stage) => inspectionLabels.stage(stage.kind, data.settings.inspectionStages)).join(" → ")}</span>
            {data.canManage ? <Button size="compact" variant="quiet" aria-label={t("Edit design inspections")} onPress={() => setEditingInspections(true)}>{t("Edit")}</Button> : null}
          </span>
        </SettingsRow>
        <SettingsRow label={t("Items")} hint={t("The trades whose made items are inspected.")}>
          <span>{(data.settings.inspectionWorkPackages ?? []).length ? (data.settings.inspectionWorkPackages ?? [])
            .map((id) => choices.workPackages.find((entry) => entry.id === id)?.name ?? "").filter(Boolean).join(", ") : t("Every made item")}</span>
        </SettingsRow>
        <SettingsRow label={t("Who inspects")} hint={t("From the project team; the designer when nobody holds the role.")}>
          <span>{[roleName(data.settings.inspectorRole ?? "designer"), data.settings.directorRole && (data.settings.directorPackages ?? []).length
            ? t("{role} on {packages}", { role: roleName(data.settings.directorRole), packages: (data.settings.directorPackages ?? [])
              .map((code) => choices.designPackages.find((entry) => entry.code === code)?.name ?? code).join(", ") }) : ""].filter(Boolean).join(" · ")}</span>
        </SettingsRow>
        <SettingsRow label={t("Days to inspect")} hint={t("Working days after the factory marks it ready.")}>
          <NumericInput label={<span className="wd-visually-hidden">{t("Days to inspect")}</span>} aria-label={t("Days to inspect")} minValue={1} maxValue={30}
            isDisabled={readOnly} suffix={t("days")} value={inspectionDays ?? data.settings.inspectionDays ?? 2} onChange={(value) => setInspectionDays(Number.isFinite(value) ? value : null)}
            onBlur={() => { if (inspectionDays !== null && inspectionDays !== (data.settings.inspectionDays ?? 2)) void save({ inspectionDays }); }} />
        </SettingsRow>
      </> : null}
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
    {editingInspections ? <InspectionsDialog settings={data.settings} choices={choices} onClose={() => setEditingInspections(false)}
      onSave={async (patch) => { setData(await api.saveSettings({ version: data.settings.version, ...patch })); setEditingInspections(false); }} /> : null}
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
      <NumericInput label={t("Hours a day")} suffix={t("h")} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={value.hours === "" ? Number.NaN : Number(value.hours)}
        onChange={(hours) => setValue({ ...value, hours: Number.isFinite(hours) ? String(hours) : "" })} />
      <MoneyField label={t("Hourly rate")} currency={currency} value={value.rate} onChange={(rate) => setValue({ ...value, rate })} />
      {changed ? <DateField label={t("From")} isRequired value={value.rateFrom ? parseDate(value.rateFrom) : null} onChange={(day) => setValue({ ...value, rateFrom: day ? day.toString() : null })} /> : null}
      {!draft.isNew ? <Switch isSelected={value.active} onChange={(active) => setValue({ ...value, active })}>{t("In use")}</Switch> : null}
  </FormDialog>;
}

type InspectionChoices = NonNullable<FactorySettingsState["inspectionChoices"]>;

/**
 * PLM-150: the design inspections the firm keeps (the one after finishing always; the one before the final finish if it
 * wants) with its own names, the trades whose made items are inspected, and who inspects: a project role, and the role
 * that inspects instead on projects of the chosen design packages.
 */
function InspectionsDialog({ settings, choices, onClose, onSave }: { settings: FactorySettings; choices: InspectionChoices; onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const labels = useInspectionLabels();
  const stages = settings.inspectionStages ?? [];
  const [raw, setRaw] = useState(stages.some((stage) => stage.kind === "raw"));
  const [names, setNames] = useState<Record<InspectionStageKind, string>>({ raw: stages.find((stage) => stage.kind === "raw")?.label ?? "", final: stages.find((stage) => stage.kind === "final")?.label ?? "" });
  const [trades, setTrades] = useState<string[]>(settings.inspectionWorkPackages ?? []);
  const [inspector, setInspector] = useState(settings.inspectorRole ?? "designer");
  const [director, setDirector] = useState(settings.directorRole ?? "");
  const [packages, setPackages] = useState<string[]>(settings.directorPackages ?? []);
  const [error, setError] = useState("");
  const toggle = (list: string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((entry) => entry !== value));
  const roles = choices.roles.map((role) => ({ id: role.key, label: role.label }));
  return <FormDialog size="md" title={t("Design inspections")} onClose={onClose} error={error || undefined} submitLabel={t("Save")} isSubmitDisabled={Boolean(director && !packages.length)}
    onSubmit={async () => {
      setError("");
      try {
        await onSave({ inspectionStages: [...(raw ? [{ kind: "raw", label: names.raw.trim() }] : []), { kind: "final", label: names.final.trim() }],
          inspectionWorkPackages: trades, inspectorRole: inspector, directorRole: director || null, directorPackages: director ? packages : [] });
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    }}>
    <div className={styles.filters}>
      <Switch isSelected={raw} onChange={setRaw}>{t("Before the final finish")}</Switch>
      <TextInput label={t("Name it")} placeholder={labels.stage("raw", DEFAULT_STAGES)} maxLength={60} isDisabled={!raw} value={names.raw} onChange={(raw) => setNames({ ...names, raw })} />
    </div>
    <div className={styles.filters}>
      <Switch isSelected isDisabled>{t("After finishing")}</Switch>
      <TextInput label={t("Name it")} placeholder={labels.stage("final", raw ? DEFAULT_STAGES : [{ kind: "final", label: "" }])} maxLength={60} value={names.final}
        onChange={(final) => setNames({ ...names, final })} />
    </div>
    {choices.workPackages.length ? <Fieldset legend={t("Items")}>
      {choices.workPackages.map((trade) => <Checkbox key={trade.id} isSelected={trades.includes(trade.id)} onChange={(on) => setTrades(toggle(trades, trade.id, on))}>{trade.name}</Checkbox>)}
    </Fieldset> : null}
    <SelectField label={t("Who inspects")} selectedKey={inspector} onSelectionChange={(key) => setInspector(key ? String(key) : "designer")} items={roles} />
    <SelectField label={t("Who inspects on some design packages")} placeholder={t("Nobody else")} selectedKey={director || "none"}
      onSelectionChange={(key) => setDirector(!key || key === "none" ? "" : String(key))} items={[{ id: "none", label: t("Nobody else") }, ...roles]} />
    {director ? <Fieldset legend={t("Design packages")}>
      {choices.designPackages.map((option) => <Checkbox key={option.code} isSelected={packages.includes(option.code)} onChange={(on) => setPackages(toggle(packages, option.code, on))}>
        {option.name}</Checkbox>)}
    </Fieldset> : null}
  </FormDialog>;
}

const DEFAULT_STAGES: InspectionStage[] = [{ kind: "raw", label: "" }, { kind: "final", label: "" }];

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
    <NumericInput label={t("Production target in weeks")} minValue={0} formatOptions={{ maximumFractionDigits: 0 }} value={target === "" ? Number.NaN : Number(target)}
      onChange={(value) => setTarget(Number.isFinite(value) ? String(value) : "")}
      isInvalid={!weeksValid} errorMessage={weeksValid ? undefined : t("From 1 to 52 weeks.")} />
  </FormDialog>;
}
