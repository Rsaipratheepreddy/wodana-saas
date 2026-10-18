"use client";

import { useMemo } from "react";
import { parseTime } from "@internationalized/date";
import { Button, ComboboxField, SettingsRow, SettingsSection, Switch, TimeField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { NOTICE_CHANNEL_LABELS, NOTIFICATION_MODULES, choiceEnabled, type NoticeChannel, type NoticeChoicesInput, type NoticeChoicesView, type NotificationModule } from "@/lib/workspace/notification-modules";
import { timeZoneOptions } from "@/lib/workspace/regional-options";
import styles from "./notification-settings.module.css";

const timeValue = (value: string | null | undefined) => { try { return value ? parseTime(value) : null; } catch { return null; } };
const timeText = (value: { hour: number; minute: number } | null) => (value ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}` : null);

/** The channels the workspace has turned on, labelled, in order. */
function useChannels(view: NoticeChoicesView) {
  const t = useT();
  return view.channels.map((channel) => ({ id: channel, label: t(NOTICE_CHANNEL_LABELS[channel] as never) }));
}

/**
 * Each group on each channel the workspace has turned on, as switches, and the alert row that can't be switched off.
 */
export function NoticeChannelGrid({ view, draft, onChange, isDisabled }: { view: NoticeChoicesView; draft: NoticeChoicesInput; onChange: (next: NoticeChoicesInput) => void; isDisabled?: boolean }) {
  const t = useT();
  const channels = useChannels(view);
  const set = (group: NotificationModule, channel: NoticeChannel, enabled: boolean) => onChange({
    ...draft, choices: [...draft.choices.filter((cell) => cell.group !== group || cell.channel !== channel), { group, channel, enabled }],
  });
  const groups = NOTIFICATION_MODULES.filter((module) => view.groups.includes(module.id));
  const alerts = t("Alerts");
  return <SettingsSection id="channels" title={t("What you're told")}>
    <div className={styles.header} data-columns={channels.length} aria-hidden="true"><span />{channels.map((channel) => <span key={channel.id}>{channel.label}</span>)}</div>
    {groups.map((module) => {
      const name = t(module.label as never);
      return <SettingsRow key={module.id} label={name}>
        <div className={styles.switches} data-columns={channels.length}>{channels.map((channel) => <Switch key={channel.id} aria-label={t("{module}: {channel}", { module: name, channel: channel.label })}
          isDisabled={isDisabled} isSelected={choiceEnabled(draft.choices, module.id, channel.id)} onChange={(enabled) => set(module.id, channel.id, enabled)} />)}</div>
      </SettingsRow>;
    })}
    <SettingsRow label={alerts} hint={t("Always on: in the app and your fastest channel")}>
      <div className={styles.switches} data-columns={channels.length}>{channels.map((channel) => <Switch key={channel.id} aria-label={t("{module}: {channel}", { module: alerts, channel: channel.label })} isSelected isDisabled />)}</div>
    </SettingsRow>
  </SettingsSection>;
}

/**
 * The person's own quiet hours (email, WhatsApp and push wait; in-app notices land silently), their daily digest and
 * the zone both are in. Unset values follow the workspace's.
 */
export function PersonNotificationSettings({ view, draft, onChange, isDisabled }: { view: NoticeChoicesView; draft: NoticeChoicesInput; onChange: (next: NoticeChoicesInput) => void; isDisabled?: boolean }) {
  const t = useT();
  const zones = useMemo(() => timeZoneOptions(), []);
  const quiet = draft.quietHours;
  const set = (patch: Partial<NoticeChoicesInput>) => onChange({ ...draft, ...patch });
  // The zone the hours are in: the one chosen here, else the one in force (the phone's, else the workspace's region).
  const zone = draft.timeZone ?? (view.timeZone ? view.workspaceTimeZone : view.effectiveTimeZone);
  return <>
    <SettingsSection id="quiet-hours" title={t("Quiet hours")}>
      <SettingsRow label={t("My own quiet hours")} hint={quiet ? undefined : t("Workspace hours {start}–{end}", { start: view.firm.quietStart, end: view.firm.quietEnd })}>
        <Switch aria-label={t("My own quiet hours")} isDisabled={isDisabled} isSelected={Boolean(quiet)}
          onChange={(on) => set({ quietHours: on ? { start: view.firm.quietStart, end: view.firm.quietEnd } : null })} />
      </SettingsRow>
      {quiet ? <SettingsRow label={t("Between")} hint={zone}>
        <div className={styles.times}>
          <TimeField aria-label={t("From")} label={undefined} hourCycle={24} isDisabled={isDisabled} value={timeValue(quiet.start)}
            onChange={(value) => set({ quietHours: { start: timeText(value) ?? quiet.start, end: quiet.end } })} />
          <TimeField aria-label={t("To")} label={undefined} hourCycle={24} isDisabled={isDisabled} value={timeValue(quiet.end)}
            onChange={(value) => set({ quietHours: { start: quiet.start, end: timeText(value) ?? quiet.end } })} />
        </div>
      </SettingsRow> : null}
      <SettingsRow label={t("Time zone")} hint={draft.timeZone ? undefined : t("Now {zone}", { zone })}>
        <ComboboxField aria-label={t("Time zone")} label={null} isDisabled={isDisabled} selectedKey={draft.timeZone ?? "auto"}
          items={[{ id: "auto", label: t("Automatic") }, ...zones.filter((item) => item.id !== "auto")]}
          onSelectionChange={(key) => { if (key) set({ timeZone: key === "auto" ? null : String(key) }); }} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="digest" title={t("Daily digest")}>
      <SettingsRow label={t("Send me a daily digest")}>
        <Switch aria-label={t("Send me a daily digest")} isDisabled={isDisabled} isSelected={draft.digestEnabled} onChange={(on) => set({ digestEnabled: on })} />
      </SettingsRow>
      {draft.digestEnabled ? <SettingsRow label={t("Digest time")} hint={draft.digestTime ? undefined : t("Workspace time {time}", { time: view.firm.digestTime })}>
        <div className={styles.times}>
          <TimeField aria-label={t("Digest time")} label={undefined} hourCycle={24} isDisabled={isDisabled} value={timeValue(draft.digestTime)}
            placeholderValue={timeValue(view.firm.digestTime) ?? undefined} onChange={(value) => set({ digestTime: timeText(value) })} />
          {draft.digestTime ? <Button size="compact" variant="quiet" isDisabled={isDisabled} onPress={() => set({ digestTime: null })}>{t("Use the workspace time")}</Button> : null}
        </div>
      </SettingsRow> : null}
    </SettingsSection>
  </>;
}
