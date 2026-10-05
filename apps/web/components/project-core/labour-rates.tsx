"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, Trash2 } from "lucide-react";
import { Button, DateField, EmptyState, FormDialog, IconButton, InlineNotice, MoneyField, SettingsRow, SettingsSection, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { LabourRates, TradeRate } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-settings.module.css";

type Trade = LabourRates["trades"][number];

/** The rate in force on a day: set from the latest date on or before it. */
const rateOn = (rates: TradeRate[], day: string) => rates.filter((rate) => rate.from <= day).at(-1) ?? null;

/**
 * Settings → Projects → Labour rates: what a day of each trade on site costs, from a date. Trades used on
 * site reports without a rate are listed too — their days aren't costed until they're priced.
 */
export function LabourRatesSection({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<LabourRates | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Trade | "new" | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.labourRates()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!data) return error ? <InlineNotice tone="error" message={error} /> : <Skeleton lines={4} shape="form" />;
  const money = (value: string) => format.money(value, data.currency);
  const trade = editing && editing !== "new" ? data.trades.find((item) => item.key === editing.key) ?? editing : null;
  return <SettingsSection id="labour" title={t("Labour rates")}
    actions={data.canManage ? <Button size="compact" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("Add trade")}</Button> : null}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {!data.trades.length ? <EmptyState illustration={null} title={t("No trades yet")} /> : data.trades.map((item) => {
      const current = rateOn(item.rates, data.today);
      const next = item.rates.find((rate) => rate.from > data.today);
      return <SettingsRow key={item.key} label={item.name} hint={[next ? t("{amount} from {date}", { amount: money(next.rate), date: format.day(next.from) }) : "",
        item.reports ? t("On {count} site reports", { count: item.reports }) : ""].filter(Boolean).join(" · ") || undefined}>
        <span className={current ? styles.rate : `${styles.rate} ${styles.missing}`}>{current ? t("{amount} a day", { amount: money(current.rate) }) : t("No rate")}</span>
        {data.canManage ? <Button size="compact" variant="quiet" onPress={() => setEditing(item)}>{current || item.rates.length ? t("Change") : t("Set rate")}</Button> : null}
      </SettingsRow>;
    })}
    {editing ? <RateDialog trade={editing === "new" ? null : trade} currency={data.currency} today={data.today} onClose={() => setEditing(null)}
      onRemove={async (rate) => {
        const next = await api.labourRateCommand("remove", { id: rate.id, version: rate.version });
        setData(next);
        if (!next.trades.some((item) => item.key === rate.key)) setEditing(null);
      }}
      onSave={async (input) => { setData(await api.labourRateCommand("save", input)); setEditing(null); }} /> : null}
  </SettingsSection>;
}

/** A day rate from a date: a new date adds to the trade's history, the same date corrects that rate. */
function RateDialog({ trade, currency, today, onClose, onSave, onRemove }: {
  trade: Trade | null; currency: string; today: string; onClose: () => void;
  onSave: (input: { trade: string; dayRate: string; from: string; version: number }) => Promise<void>; onRemove: (rate: TradeRate) => Promise<void>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [name, setName] = useState(trade?.name ?? "");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState<string | null>(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rates = [...(trade?.rates ?? [])].reverse();
  // Saving from a date that already has a rate corrects it, so it's checked against that rate's version.
  const version = trade?.rates.find((item) => item.from === from)?.version ?? 0;
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  return <FormDialog size="md" title={trade ? trade.name : t("Add trade")} onClose={onClose} error={error || undefined} isSubmitting={busy}
    isDirty={Boolean(rate || (!trade && name.trim()))} isSubmitDisabled={!name.trim() || !rate || !from} submitLabel={t("Save")}
    onSubmit={() => onSave({ trade: name.trim(), dayRate: rate, from: from!, version })}>
      {rates.length ? <ul className={styles.history} aria-label={t("Rates")}>{rates.map((item) => <li key={item.id}>
        <span>{t("{amount} a day from {date}", { amount: format.money(item.rate, item.currency), date: format.day(item.from) })}</span>
        <IconButton aria-label={t("Remove {name}", { name: format.day(item.from) })} size="compact" variant="quiet" isDisabled={busy} onPress={() => void run(() => onRemove(item))}>
          <Trash2 aria-hidden="true" size={14} /></IconButton>
      </li>)}</ul> : null}
      {trade ? null : <TextInput label={t("Trade")} isRequired maxLength={80} value={name} onChange={setName} />}
      <MoneyField label={t("Day rate")} isRequired currency={currency} value={rate} onChange={setRate} />
      <DateField label={t("From")} isRequired value={from ? parseDate(from) : null} onChange={(value) => setFrom(value ? value.toString() : null)} />
  </FormDialog>;
}
