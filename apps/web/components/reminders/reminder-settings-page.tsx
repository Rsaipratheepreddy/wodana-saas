"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseTime } from "@internationalized/date";
import { Plus } from "lucide-react";
import type { ReminderChainLink, ReminderChannel, ReminderRuleDto, ReminderRuleInput, ReminderSettingsDto, ReminderSettingsResponse } from "@wodana/contracts";
import {
  Button, Checkbox, ErrorState, FormDialog, InlineNotice, MenuButton, NoAccessState, NumericInput, SegmentedControl, SelectField, SettingsPage, SettingsRow,
  SettingsSection, Skeleton, Switch, Tag, TimeField, isNoAccessError,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { isVersionConflict, remindersApi, type RemindersApi } from "@/lib/reminders/client";
import { REMINDER_CHAIN_LINKS, REMINDER_CHANNELS, REMINDER_MODULES, REMINDER_RULE_LIMITS } from "@/lib/reminders/contract";
import { REMINDER_CHAIN_LABELS, REMINDER_CHANNEL_LABELS, REMINDER_KIND_LABELS, REMINDER_MODULE_LABELS, offsetLabel } from "@/lib/reminders/labels";
import styles from "./reminder-settings.module.css";

type Draft = Omit<ReminderRuleInput, "version">;
const STAFF_CHANNELS: ReminderChannel[] = ["in_app", "push", "email"];
const CLIENT_CHANNELS: ReminderChannel[] = ["whatsapp", "email"];

const timeValue = (value: string | null | undefined) => { try { return value ? parseTime(value) : null; } catch { return null; } };
const timeText = (value: { hour: number; minute: number } | null) => (value ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}` : null);
const draftOf = (rule: ReminderRuleDto): Draft => ({
  enabled: rule.critical ? true : rule.enabled, offsets: [...rule.offsets].sort((a, b) => a - b), unit: rule.unit, workingDays: rule.workingDays,
  escalateAfter: rule.escalateAfter, chain: [...rule.chain], channels: [...rule.channels], digest: rule.critical ? false : rule.digest, quietHours: rule.quietHours,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings › Reminders (plan §6.24a): the firm's quiet hours, digest time and client window, then one section per
 * module with a row per reminder: on or off ("Always on" when critical), when it goes, who hears next, on which
 * channels and whether it waits for the daily digest. Each row saves on its own, version-checked.
 */
export function ReminderSettingsPage({ workspaceId, focusKind, extra }: { workspaceId: string; focusKind?: string; extra?: ReactNode }) {
  const t = useT();
  const api = useMemo(() => remindersApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<ReminderSettingsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const scrolled = useRef(false);
  const load = useCallback(async () => {
    try { setData(await api.settings()); setError(null); } catch (cause) { setError(cause); }
  }, [api]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // A link from elsewhere (?kind=) lands on its row.
  useEffect(() => {
    if (!data || !focusKind || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(`reminder-${focusKind}`)?.scrollIntoView?.({ block: "center" });
  }, [data, focusKind]);

  if (error && !data) return <SettingsPage title={t("Reminders")}>{isNoAccessError(error) ? <NoAccessState area={t("Reminders")} />
    : <ErrorState title={t("Reminder settings didn't load")} description={error instanceof Error && error.message ? translateKnown(t, error.message) : undefined} onRetry={() => void load()} />}</SettingsPage>;
  if (!data) return <SettingsPage title={t("Reminders")}><Skeleton lines={8} shape="form" /></SettingsPage>;
  const replaceRule = (rule: ReminderRuleDto) => setData((current) => current ? { ...current, rules: current.rules.map((item) => (item.kind === rule.kind ? rule : item)) } : current);

  return <SettingsPage title={t("Reminders")} width="wide">
    <FirmDefaults key={data.settings.version} api={api} settings={data.settings} onSaved={(response) => setData(response)} onReload={() => void load()} />
    {REMINDER_MODULES.map((module) => {
      const rules = data.rules.filter((rule) => rule.module === module);
      return rules.length ? <SettingsSection key={module} id={`reminders-${module}`} title={t(REMINDER_MODULE_LABELS[module])}>
        {rules.map((rule) => <RuleRow key={`${rule.kind}:${rule.version}:${rule.isDefault}`} api={api} rule={rule} highlighted={rule.kind === focusKind} onSaved={replaceRule} onReload={() => void load()} />)}
      </SettingsSection> : null;
    })}
    {extra}
  </SettingsPage>;
}

/** Quiet hours, digest time, the client window and whether critical reminders break quiet hours, for the whole firm. */
function FirmDefaults({ api, settings, onSaved, onReload }: { api: RemindersApi; settings: ReminderSettingsDto; onSaved: (response: ReminderSettingsResponse) => void; onReload: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const dirty = !same(draft, settings);
  const set = <K extends keyof ReminderSettingsDto>(key: K, value: ReminderSettingsDto[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setProblem(null);
    try { onSaved(await api.saveSettings(draft)); }
    catch (cause) { setProblem({ conflict: isVersionConflict(cause), message: cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Could not save.") }); }
    finally { setSaving(false); }
  };
  const clientWindow = draft.clientWindow;
  const time = (label: string, value: string, onChange: (value: string) => void) => <TimeField aria-label={label} label={undefined} hourCycle={24} value={timeValue(value)}
    onChange={(next) => { const text = timeText(next); if (text) onChange(text); }} />;
  return <SettingsSection id="reminders-defaults" title={t("Firm defaults")}
    actions={<Button size="compact" variant="primary" isDisabled={!dirty} isLoading={saving} onPress={() => void save()}>{t("Save")}</Button>}>
    {problem ? <Problem problem={problem} onReload={onReload} /> : null}
    <SettingsRow label={t("Quiet hours")}>
      <div className={styles.times}>{time(t("Quiet hours start"), draft.quietStart, (value) => set("quietStart", value))}<span aria-hidden="true">–</span>{time(t("Quiet hours end"), draft.quietEnd, (value) => set("quietEnd", value))}</div>
    </SettingsRow>
    <SettingsRow label={t("Daily digest")}>{time(t("Daily digest time"), draft.digestTime, (value) => set("digestTime", value))}</SettingsRow>
    <SettingsRow label={t("Client messages")}>
      <div className={styles.times}>
        <SegmentedControl label={t("Client messages")} value={clientWindow ? "custom" : "calendar"}
          onChange={(value) => set("clientWindow", value === "custom" ? (clientWindow ?? { start: "09:00", end: "18:00" }) : null)}
          options={[{ id: "calendar", label: t("Work calendar hours") }, { id: "custom", label: t("Custom") }]} />
        {clientWindow ? <>{time(t("Client messages from"), clientWindow.start, (value) => set("clientWindow", { ...clientWindow, start: value }))}<span aria-hidden="true">–</span>
          {time(t("Client messages until"), clientWindow.end, (value) => set("clientWindow", { ...clientWindow, end: value }))}</> : null}
      </div>
    </SettingsRow>
    <SettingsRow label={t("Critical reminders break quiet hours")}>
      <Switch aria-label={t("Critical reminders break quiet hours")} isSelected={draft.criticalBreaksQuiet} onChange={(value) => set("criticalBreaksQuiet", value)} />
    </SettingsRow>
  </SettingsSection>;
}

function Problem({ problem, onReload }: { problem: { message: string; conflict: boolean }; onReload: () => void }) {
  const t = useT();
  return problem.conflict
    ? <div className={styles.conflict} role="alert"><span>{t("Changed by someone else")}</span><Button size="compact" variant="quiet" onPress={onReload}>{t("Reload")}</Button></div>
    : <InlineNotice tone="error" message={problem.message} />;
}

/** One reminder kind: its switch, cadence, escalation, channels and digest, saved on its own. */
function RuleRow({ api, rule, highlighted, onSaved, onReload }: { api: RemindersApi; rule: ReminderRuleDto; highlighted: boolean; onSaved: (rule: ReminderRuleDto) => void; onReload: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(() => draftOf(rule));
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const name = t(REMINDER_KIND_LABELS[rule.kind]);
  const dirty = !same(draft, draftOf(rule));
  const channels = rule.audience === "client" ? CLIENT_CHANNELS : STAFF_CHANNELS;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const run = async (kind: "save" | "reset") => {
    setBusy(kind); setProblem(null);
    try {
      onSaved(kind === "save"
        ? await api.saveRule(rule.kind, { ...draft, enabled: rule.critical || draft.enabled, version: rule.isDefault ? 0 : rule.version })
        : await api.resetRule(rule.kind, rule.version));
    } catch (cause) {
      setProblem({ conflict: isVersionConflict(cause), message: cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("The reminder could not be saved.") });
    } finally { setBusy(null); }
  };
  const on = rule.critical || draft.enabled;
  const escalate = draft.escalateAfter;
  const remaining = REMINDER_CHAIN_LINKS.filter((link) => !draft.chain.includes(link));
  const orderedChannels = (next: ReminderChannel[]) => REMINDER_CHANNELS.filter((channel) => next.includes(channel));

  return <article className={styles.rule} id={`reminder-${rule.kind}`} data-highlighted={highlighted || undefined} aria-label={name}>
    <header className={styles.ruleHeader}>
      <span className={styles.ruleName}><strong>{name}</strong><small>{rule.audience === "client" ? t("To the client") : t("To the team")}</small></span>
      {rule.critical
        ? <Switch aria-label={t("{name}: always on", { name })} isSelected isDisabled>{t("Always on")}</Switch>
        : <Switch aria-label={t("Turn on {name}", { name })} isSelected={draft.enabled} onChange={(value) => set("enabled", value)} />}
    </header>
    {on ? <div className={styles.ruleBody}>
      <div className={styles.field} role="group" aria-label={t("When it goes")}>
        <span className={styles.fieldLabel}>{t("When it goes")}</span>
        <div className={styles.chips}>
          {draft.offsets.map((offset) => <Tag key={offset} onRemove={draft.offsets.length > 1 ? () => set("offsets", draft.offsets.filter((value) => value !== offset)) : undefined}>{offsetLabel(t, offset, draft.unit)}</Tag>)}
          {draft.offsets.length < REMINDER_RULE_LIMITS.maxOffsets ? <Button size="compact" variant="quiet" aria-label={t("Add a reminder")} onPress={() => setAdding(true)}><Plus aria-hidden="true" size={14} />{t("Add")}</Button> : null}
        </div>
      </div>
      {draft.unit === "day" ? <Switch isSelected={draft.workingDays} onChange={(value) => set("workingDays", value)}>{t("Working days only")}</Switch> : null}
      <div className={styles.field}>
        <SelectField label={t("Escalate")} accent="neutral" selectedKey={escalate === null ? "never" : String(escalate)}
          items={[{ id: "never", label: t("Never") }, ...Array.from({ length: REMINDER_RULE_LIMITS.maxEscalateAfter }, (_, index) => ({
            id: String(index + 1), label: index === 0 ? t("After 1 reminder") : t("After {count} reminders", { count: index + 1 }) }))]}
          onSelectionChange={(key) => set("escalateAfter", key && key !== "never" ? Number(key) : null)} />
      </div>
      {escalate !== null ? <div className={styles.field} role="group" aria-label={t("Then tell")}>
        <span className={styles.fieldLabel}>{t("Then tell")}</span>
        <div className={styles.chips}>
          {draft.chain.map((link, index) => <Tag key={link} onRemove={() => set("chain", draft.chain.filter((value) => value !== link))}>{`${index + 1}. ${t(REMINDER_CHAIN_LABELS[link])}`}</Tag>)}
          {draft.chain.length < REMINDER_RULE_LIMITS.maxChain && remaining.length ? <MenuButton size="compact" label={t("Add")}
            items={remaining.map((link) => ({ id: link, label: t(REMINDER_CHAIN_LABELS[link]) }))} onAction={(link) => set("chain", [...draft.chain, link as ReminderChainLink])} /> : null}
        </div>
      </div> : null}
      <div className={styles.field} role="group" aria-label={t("Channels")}>
        <span className={styles.fieldLabel}>{t("Channels")}</span>
        <div className={styles.chips}>{channels.map((channel) => <Checkbox key={channel} isSelected={draft.channels.includes(channel)}
          isDisabled={draft.channels.length === 1 && draft.channels.includes(channel)}
          onChange={(selected) => set("channels", orderedChannels(selected ? [...draft.channels, channel] : draft.channels.filter((value) => value !== channel)))}>
          {t(REMINDER_CHANNEL_LABELS[channel])}</Checkbox>)}</div>
      </div>
      {!rule.critical && rule.audience === "staff" ? <Switch isSelected={draft.digest} onChange={(value) => set("digest", value)}>{t("In the daily digest")}</Switch> : null}
    </div> : null}
    <footer className={styles.ruleFooter}>
      {problem ? <Problem problem={problem} onReload={onReload} /> : null}
      <span className={styles.ruleActions}>
        {!rule.isDefault ? <Button size="compact" variant="quiet" isLoading={busy === "reset"} isDisabled={busy !== null} onPress={() => void run("reset")}>{t("Reset to default")}</Button> : null}
        <Button size="compact" variant="primary" aria-label={t("Save {name}", { name })} isDisabled={!dirty || busy !== null} isLoading={busy === "save"} onPress={() => void run("save")}>{t("Save")}</Button>
      </span>
    </footer>
    {adding ? <AddOffsetDialog unit={draft.unit} taken={draft.offsets} onClose={() => setAdding(false)}
      onAdd={(offset) => { set("offsets", [...draft.offsets, offset].sort((a, b) => a - b)); setAdding(false); }} /> : null}
  </article>;
}

/** One more reminder: before, on or after the due moment, by whole days (or hours for an hourly rule). */
function AddOffsetDialog({ unit, taken, onClose, onAdd }: { unit: ReminderRuleDto["unit"]; taken: number[]; onClose: () => void; onAdd: (offset: number) => void }) {
  const t = useT();
  const [when, setWhen] = useState<"before" | "on" | "after">("after");
  const [amount, setAmount] = useState(1);
  const max = REMINDER_RULE_LIMITS.offsetRange[unit];
  return <FormDialog title={t("Add a reminder")} submitLabel={t("Add")} onClose={onClose} validation="caller" onSubmit={() => {
    const count = Math.round(amount);
    const offset = when === "on" ? 0 : when === "before" ? -count : count;
    if (when !== "on" && (!Number.isFinite(count) || count < 1 || count > max)) throw new Error(t("Choose between 1 and {max}.", { max }));
    if (taken.includes(offset)) throw new Error(t("That reminder is already on the list."));
    onAdd(offset);
  }}>
    <SelectField label={t("When")} selectedKey={when} onSelectionChange={(key) => key && setWhen(key as typeof when)}
      items={[{ id: "before", label: t("Before") }, { id: "on", label: unit === "hour" ? t("At the time") : t("On the day") }, { id: "after", label: t("After") }]} />
    {when !== "on" ? <NumericInput label={unit === "hour" ? t("Hours") : t("Days")} minValue={1} maxValue={max} step={1} value={amount} onChange={(value) => setAmount(value)} /> : null}
  </FormDialog>;
}


