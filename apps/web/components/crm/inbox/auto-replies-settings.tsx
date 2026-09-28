"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Time } from "@internationalized/date";
import { Button, Checkbox, ErrorState, InlineNotice, NumericInput, SelectField, SettingsRow, SettingsSection, Skeleton, Switch, TextAreaField, TimeField, useDesignSystem } from "@/design-system";
import { weekStart } from "@/components/hrms/hrms-format";
import { crmRequest } from "@/lib/crm/client";
import { AUTO_REPLY_FIELDS, renderAutoReply, TEMPLATE_SOURCE_LABELS, type AutoRepliesState, type AutoReplyField, type AutoReplyScope } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { timeZoneOptions } from "@/lib/workspace/regional-options";
import styles from "./inbox-parts.module.css";

const toTime = (value: string) => { const [hour, minute] = value.split(":").map(Number); return new Time(hour, minute); };
const hhmm = (value: { hour: number; minute: number }) => `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
const same = (a: AutoReplyScope | null, b: AutoReplyScope | null) => JSON.stringify(a) === JSON.stringify(b);
const isState = (value: unknown): value is AutoRepliesState => Boolean(value && typeof value === "object" && "workspace" in value && Array.isArray((value as AutoRepliesState).numbers));

/**
 * Settings → Inbox → Auto replies: the greeting (a client's first message, or the first after a quiet spell) and
 * the away message (outside business hours, once per chat in a window). With several WhatsApp numbers, a number
 * can have its own. Each message shows a preview as the client will read it.
 */
export function AutoRepliesSection({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [data, setData] = useState<AutoRepliesState | null>(null);
  const [failure, setFailure] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [draft, setDraft] = useState<AutoReplyScope | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => crmRequest<AutoRepliesState>(workspaceId, "inbox/auto-replies").then((next) => {
    if (!isState(next)) throw new Error(t("Auto replies could not be loaded."));
    setData(next); setFailure("");
  }).catch((reason: Error) => setFailure(reason.message)), [workspaceId, t]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const number = data?.numbers.find((item) => item.connectionId === scopeId) ?? null;
  // What is saved for the chosen scope: the workspace's, or the number's own (null while it follows the workspace).
  const saved = !data ? null : number ? number.override : data.workspace;
  useEffect(() => { const timer = setTimeout(() => setDraft(saved ? structuredClone(saved) : null), 0); return () => clearTimeout(timer); }, [saved]);
  const week = useMemo(() => {
    const first = weekStart(locale);
    const name = (day: number, style: "short" | "long") => new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)));
    return Array.from({ length: 7 }, (_, index) => (first + index) % 7).map((day) => ({ day, short: name(day, "short"), long: name(day, "long") }));
  }, [locale]);
  const zones = useMemo(() => timeZoneOptions(), []);

  if (failure && !data) return <SettingsSection id="inbox-auto-replies" title={t("Auto replies")}><ErrorState description={failure} onRetry={() => void load()} /></SettingsSection>;
  if (!data) return <SettingsSection id="inbox-auto-replies" title={t("Auto replies")}><Skeleton lines={4} shape="rows" /></SettingsSection>;
  const canManage = data.canManage;
  const changed = Boolean(draft) && !same(draft, saved);
  const fieldNames: Record<AutoReplyField, string> = {
    "contact.first_name": `[${t(TEMPLATE_SOURCE_LABELS["contact.first_name"])}]`, "contact.name": `[${t(TEMPLATE_SOURCE_LABELS["contact.name"])}]`,
    "business.name": data.businessName ?? `[${t(TEMPLATE_SOURCE_LABELS["business.name"])}]`,
  };
  const set = (change: (current: AutoReplyScope) => AutoReplyScope) => { setDraft((current) => current && change(current)); setNotice(""); setError(""); };
  const run = async (work: () => Promise<AutoRepliesState>, success: string) => {
    setSaving(true); setError(""); setNotice("");
    try { const next = await work(); if (isState(next)) setData(next); else await load(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("Auto replies could not be saved.")); } finally { setSaving(false); }
  };
  const save = () => {
    if (!draft) return;
    if (draft.greeting.enabled && !draft.greeting.text.trim()) { setError(t("Write the greeting message.")); return; }
    if (draft.away.enabled && !draft.away.text.trim()) { setError(t("Write the away message.")); return; }
    if (draft.hours.start && draft.hours.start === draft.hours.end) { setError(t("The closing time must differ from the opening time.")); return; }
    if (draft.hours.workingDays && !draft.hours.workingDays.length) { setError(t("Choose at least one working day.")); return; }
    void run(() => crmRequest<AutoRepliesState>(workspaceId, "inbox/auto-replies", "PUT", {
      ...(scopeId ? { connectionId: scopeId } : {}), version: draft.version,
      greetingEnabled: draft.greeting.enabled, greetingText: draft.greeting.text, greetingSilenceDays: draft.greeting.silenceDays,
      awayEnabled: draft.away.enabled, awayText: draft.away.text, awayWindowHours: draft.away.windowHours,
      workingDays: draft.hours.workingDays, dayStart: draft.hours.start, dayEnd: draft.hours.end, timeZone: draft.hours.timeZone,
    }), t("Auto replies saved."));
  };
  const ownHours = Boolean(draft?.hours.start);
  const hoursSummary = [
    week.filter((day) => data.defaults.workingDays.includes(day.day)).map((day) => day.short).join(" "),
    `${data.defaults.start}–${data.defaults.end}`, data.defaults.timeZone.replaceAll("_", " "),
  ].join(" · ");
  const disabled = !canManage || saving;

  return <SettingsSection id="inbox-auto-replies" title={t("Auto replies")}
    actions={canManage && draft ? <Button size="compact" variant="primary" isDisabled={!changed} isLoading={saving} onPress={save}>{t("Save")}</Button> : null}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {data.numbers.length > 1 ? <SettingsRow label={t("Number")}>
      <span className={styles.inline}>
        <SelectField aria-label={t("Number")} label={null} items={[{ id: "", label: t("All numbers") }, ...data.numbers.map((item) => ({ id: item.connectionId, label: [item.number, item.accountName].filter(Boolean).join(" · ") || t("WhatsApp number") }))]}
          selectedKey={scopeId} onSelectionChange={(key) => { setScopeId(key ? String(key) : ""); setError(""); setNotice(""); }} />
        {number?.override && canManage ? <Button size="compact" variant="quiet" isDisabled={saving}
          onPress={() => void run(() => crmRequest<AutoRepliesState>(workspaceId, `inbox/auto-replies/${number.connectionId}?version=${number.override!.version}`, "DELETE"), t("This number now uses the auto replies for all numbers."))}>{t("Use the settings for all numbers")}</Button> : null}
      </span>
    </SettingsRow> : null}
    {number && !number.override ? <SettingsRow label={t("This number")} hint={t("Uses the auto replies for all numbers.")}>
      {canManage ? <Button size="compact" onPress={() => setDraft({ ...structuredClone(data.workspace), connectionId: number.connectionId, version: 0 })} isDisabled={Boolean(draft)}>{t("Customise for this number")}</Button> : null}
    </SettingsRow> : null}
    {draft ? <>
      <SettingsRow label={t("Greeting message")} hint={t("A client's first message, or the first after {count} quiet days.", { count: draft.greeting.silenceDays })}>
        <Switch aria-label={t("Greeting message")} isDisabled={disabled} isSelected={draft.greeting.enabled} onChange={(enabled) => set((current) => ({ ...current, greeting: { ...current.greeting, enabled } }))}>{draft.greeting.enabled ? t("On") : t("Off")}</Switch>
      </SettingsRow>
      {draft.greeting.enabled ? <>
        <SettingsRow label={t("Greeting")} align="start">
          <MessageField label={t("Greeting")} value={draft.greeting.text} isDisabled={disabled} preview={renderAutoReply(draft.greeting.text, fieldNames)}
            onChange={(text) => set((current) => ({ ...current, greeting: { ...current.greeting, text } }))} />
        </SettingsRow>
        <SettingsRow label={t("Quiet days")} hint={t("Greet again after this many days without a message.")}>
          <span className={styles.inline}><NumericInput aria-label={t("Quiet days")} label={undefined} minValue={1} maxValue={365} step={1} isDisabled={disabled} suffix={t("days")} value={draft.greeting.silenceDays}
            onChange={(value) => { if (Number.isInteger(value)) set((current) => ({ ...current, greeting: { ...current.greeting, silenceDays: value } })); }} /></span>
        </SettingsRow>
      </> : null}
      <SettingsRow label={t("Away message")} hint={t("A client's message outside business hours.")}>
        <Switch aria-label={t("Away message")} isDisabled={disabled} isSelected={draft.away.enabled} onChange={(enabled) => set((current) => ({ ...current, away: { ...current.away, enabled } }))}>{draft.away.enabled ? t("On") : t("Off")}</Switch>
      </SettingsRow>
      {draft.away.enabled ? <>
        <SettingsRow label={t("Away")} align="start">
          <MessageField label={t("Away")} value={draft.away.text} isDisabled={disabled} preview={renderAutoReply(draft.away.text, fieldNames)}
            onChange={(text) => set((current) => ({ ...current, away: { ...current.away, text } }))} />
        </SettingsRow>
        <SettingsRow label={t("Business hours")} hint={ownHours ? undefined : hoursSummary} align="start">
          <div className={styles.hours}>
            <Checkbox isDisabled={disabled} isSelected={!ownHours} onChange={(follow) => set((current) => ({ ...current, hours: follow
              ? { workingDays: null, start: null, end: null, timeZone: null }
              : { workingDays: [...data.defaults.workingDays], start: data.defaults.start, end: data.defaults.end, timeZone: data.defaults.timeZone } }))}>{t("Same as the work calendar")}</Checkbox>
            {ownHours && draft.hours.start && draft.hours.end ? <>
              <fieldset className={styles.weekdays}>
                <legend>{t("Working days")}</legend>
                <div>{week.map((day) => <Checkbox key={day.day} aria-label={day.long} isDisabled={disabled} isSelected={(draft.hours.workingDays ?? []).includes(day.day)}
                  onChange={(on) => set((current) => { const days = current.hours.workingDays ?? []; return { ...current, hours: { ...current.hours, workingDays: (on ? [...days, day.day] : days.filter((item) => item !== day.day)).sort((a, b) => a - b) } }; })}>{day.short}</Checkbox>)}</div>
              </fieldset>
              <div className={styles.pair}>
                <TimeField label={t("Opens")} hourCycle={24} isDisabled={disabled} value={toTime(draft.hours.start)} onChange={(value) => { if (value) set((current) => ({ ...current, hours: { ...current.hours, start: hhmm(value) } })); }} />
                <TimeField label={t("Closes")} hourCycle={24} isDisabled={disabled} value={toTime(draft.hours.end)} onChange={(value) => { if (value) set((current) => ({ ...current, hours: { ...current.hours, end: hhmm(value) } })); }} />
              </div>
              <SelectField label={t("Time zone")} isDisabled={disabled} items={zones.some((zone) => zone.id === draft.hours.timeZone) ? zones : [{ id: draft.hours.timeZone ?? data.defaults.timeZone, label: (draft.hours.timeZone ?? data.defaults.timeZone).replaceAll("_", " ") }, ...zones]}
                selectedKey={draft.hours.timeZone ?? data.defaults.timeZone} onSelectionChange={(key) => { if (key) set((current) => ({ ...current, hours: { ...current.hours, timeZone: String(key) } })); }} />
            </> : null}
          </div>
        </SettingsRow>
        <SettingsRow label={t("Send again after")} hint={t("At most once per chat in this time.")}>
          <span className={styles.inline}><NumericInput aria-label={t("Send again after")} label={undefined} minValue={1} maxValue={168} step={1} isDisabled={disabled} suffix={t("hours")} value={draft.away.windowHours}
            onChange={(value) => { if (Number.isInteger(value)) set((current) => ({ ...current, away: { ...current.away, windowHours: value } })); }} /></span>
        </SettingsRow>
      </> : null}
    </> : null}
  </SettingsSection>;
}

/** The message, buttons that insert a field, and the preview as the client reads it. */
function MessageField({ label, value, preview, isDisabled, onChange }: { label: string; value: string; preview: string; isDisabled: boolean; onChange: (value: string) => void }) {
  const t = useT();
  return <div className={styles.message}>
    <TextAreaField aria-label={label} label={undefined} maxLength={1024} isDisabled={isDisabled} value={value} onChange={onChange} />
    {!isDisabled ? <div className={styles.fields} role="group" aria-label={t("Insert a field")}>
      {AUTO_REPLY_FIELDS.map((field) => <Button key={field} size="compact" variant="quiet" onPress={() => onChange(`${value}{{${field}}}`)}>{t(TEMPLATE_SOURCE_LABELS[field])}</Button>)}
    </div> : null}
    <p className={styles.preview} aria-label={t("Preview")} dir="auto">{preview || t("Nothing to send yet")}</p>
  </div>;
}
