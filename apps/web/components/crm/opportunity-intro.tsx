"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, UserRoundPen } from "lucide-react";
import { parseDate, parseTime } from "@internationalized/date";
import { Badge, Button, DateField, FormDialog, FormRow, InlineNotice, SelectField, SettingsRow, SettingsSection, Skeleton, TextAreaField, TextInput, TimeField, useWorkingCalendar } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, rows } from "@/lib/crm/client";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { useCrmResource } from "./crm-workbench";
import styles from "./opportunity-intro.module.css";

type Location = { mode?: "in_person" | "online"; url?: string | null; address?: string | null };
export type IntroView = {
  designer: { membershipId: string; name: string; version: number } | null;
  intro: { activityId: string; status: string; title: string; startsAt: string | null; endsAt: string | null; timezone: string | null; location: Location | null } | null;
  history: Array<{ id: string; reason: string | null; changedAt: string; fromName: string | null; toName: string; changedByName: string | null }>;
  blockers: Array<{ key: string; label: string }>;
  timezone: string;
  canChangeDesigner: boolean;
};
type Member = { id: string; displayName?: string; name?: string };

const DURATIONS = [30, 45, 60, 90, 120];

/** PLM-043 / PLM-088: book the intro meeting in a designer's calendar; that designer stays with the client. */
export function OpportunityIntro({ workspaceId, opportunityId, locale, onSaved, startBooking, onBookingStarted }: {
  workspaceId: string; opportunityId: string; locale?: string; onSaved?: () => void | Promise<void>;
  /** The Now card asked to book: the booking opens once the view has loaded (when nothing blocks it). */
  startBooking?: boolean; onBookingStarted?: () => void;
}) {
  const t = useT();
  const resource = useCrmResource<IntroView>(workspaceId, `opportunities/${opportunityId}/intro`);
  const members = useCrmResource<unknown>(workspaceId, "members");
  const [dialog, setDialog] = useState<"book" | "designer" | null>(null);
  const [notice, setNotice] = useState("");
  // Only a well-formed intro view is used; anything else waits or shows the error.
  const view = resource.data && typeof resource.data === "object" && Array.isArray((resource.data as { blockers?: unknown }).blockers) ? resource.data : undefined;
  const canBook = Boolean(view && !view.blockers.length && view.intro?.status !== "pending");
  // Nothing to open (already booked, or facts missing): the request is done.
  useEffect(() => { if (startBooking && view && !canBook) onBookingStarted?.(); }, [startBooking, view, canBook, onBookingStarted]);
  const showBooking = dialog === "book" || Boolean(startBooking && canBook);
  const closeBooking = () => { setDialog(null); if (startBooking) onBookingStarted?.(); };
  if (resource.failure) return <InlineNotice message={resource.failure} tone="error" />;
  if (!view) return <Skeleton lines={4} shape="facts" />;

  const people = (rows(members.data) as Member[]).map((member) => ({ id: String(member.id), label: String(member.displayName ?? member.name ?? "") })).filter((member) => member.label);
  const labelOf = (item: { key: string; label: string }) => ({ floorPlan: t("Floor plan"), area: t("Area"), clientEmail: t("Client email") } as Record<string, string>)[item.key] ?? item.label;
  const intro = view.intro;
  const booked = intro && intro.status === "pending";
  const done = async (message: string) => { closeBooking(); setNotice(message); resource.refresh(); await onSaved?.(); };

  return <div className={styles.intro}>
    {view.blockers.length && !intro ? <InlineNotice tone="info" message={`${t("Add these on Discovery first")}: ${view.blockers.map(labelOf).join(", ")}`} /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}
    <SettingsSection actions={!booked ? <Button isDisabled={view.blockers.length > 0} size="compact" variant="primary" onPress={() => setDialog("book")}><CalendarPlus aria-hidden="true" size={14} />{t("Book intro meeting")}</Button> : null} id="intro-meeting" title={t("Intro meeting")}>
      <SettingsRow label={t("Meeting")}>
        {intro?.startsAt && intro.endsAt ? <span className={styles.meeting}>
          <strong>{when(intro.startsAt, intro.endsAt, intro.timezone ?? view.timezone, locale)}</strong>
          <small>{intro.location?.mode === "online" ? (intro.location.url ? <a href={intro.location.url} rel="noreferrer" target="_blank">{t("Online meeting link")}</a> : t("Online")) : intro.location?.address || t("In person")}</small>
          <Badge tone={intro.status === "completed" ? "success" : intro.status === "cancelled" ? "neutral" : "info"}>{intro.status === "completed" ? t("Held") : intro.status === "cancelled" ? t("Cancelled") : t("Booked")}</Badge>
        </span> : <span className={styles.empty}>{t("Not booked")}</span>}
      </SettingsRow>
      <SettingsRow label={t("Designer")}>
        <span className={styles.designer}>
          {view.designer ? <strong>{view.designer.name}</strong> : <span className={styles.empty}>{t("Chosen when the intro is booked")}</span>}
          {view.designer && view.canChangeDesigner ? <Button size="compact" variant="secondary" onPress={() => setDialog("designer")}><UserRoundPen aria-hidden="true" size={13} />{t("Change")}</Button> : null}
        </span>
      </SettingsRow>
    </SettingsSection>
    {view.history.length > 1 ? <SettingsSection id="designer-history" title={t("Designer changes")}>
      {view.history.map((entry) => <SettingsRow key={entry.id} label={dateTime(entry.changedAt, locale)}>
        <span className={styles.change}><strong>{entry.fromName ? `${entry.fromName} → ${entry.toName}` : entry.toName}</strong>{entry.reason ? <small>{entry.reason}</small> : null}{entry.changedByName ? <small>{entry.changedByName}</small> : null}</span>
      </SettingsRow>)}
    </SettingsSection> : null}
    {showBooking ? <BookIntroDialog workspaceId={workspaceId} opportunityId={opportunityId} people={people} view={view} onClose={closeBooking} onBooked={() => done(t("Intro meeting booked. The designer has been invited."))} /> : null}
    {dialog === "designer" && view.designer ? <ChangeDesignerDialog workspaceId={workspaceId} opportunityId={opportunityId} people={people.filter((person) => person.id !== view.designer!.membershipId)} version={view.designer.version} onClose={() => setDialog(null)} onChanged={() => done(t("Designer changed."))} /> : null}
  </div>;
}

function BookIntroDialog({ workspaceId, opportunityId, people, view, onClose, onBooked }: { workspaceId: string; opportunityId: string; people: Array<{ id: string; label: string }>; view: IntroView; onClose: () => void; onBooked: () => void }) {
  const t = useT();
  // The meeting starts on the next working day at 10:00, the usual length, in person.
  const calendar = useWorkingCalendar();
  const [start] = useState(() => ({ designer: view.designer?.membershipId ?? "", date: calendar.nextWorkingDayFromToday().toString(), time: "10:00", minutes: "60", mode: "in_person", place: "", note: "", reason: "" }));
  const [value, setValue] = useState(start);
  const set = (key: keyof typeof value) => (next: string) => setValue((current) => ({ ...current, [key]: next }));
  const changing = Boolean(view.designer && value.designer && value.designer !== view.designer.membershipId);
  const book = async () => {
    const startsAt = zonedToUtc(value.date, value.time, view.timezone);
    if (!value.designer) throw new Error(t("Choose the designer."));
    if (!startsAt) throw new Error(t("Choose the date and time."));
    if (changing && !value.reason.trim()) throw new Error(t("Give a reason for changing the designer."));
    await crmRequest(workspaceId, `opportunities/${opportunityId}/intro`, "POST", {
      designerMembershipId: value.designer, startsAt, endsAt: new Date(Date.parse(startsAt) + Number(value.minutes) * 60000).toISOString(), timezone: view.timezone,
      mode: value.mode, place: value.place.trim() || null, note: value.note.trim() || null, changeReason: changing ? value.reason.trim() : null,
    });
    onBooked();
  };
  return <FormDialog isDirty={JSON.stringify(value) !== JSON.stringify(start)} onClose={onClose} onSubmit={book} submitLabel={t("Book")} title={t("Book intro meeting")}>
    <SelectField isRequired items={people} label={t("Designer")} onSelectionChange={(key) => set("designer")(String(key ?? ""))} placeholder={t("Choose the designer")} selectedKey={value.designer || null} />
    {changing ? <TextInput isRequired label={t("Reason for changing the designer")} maxLength={500} onChange={set("reason")} value={value.reason} /> : null}
    <DateField isRequired label={t("Date")} onChange={(next) => set("date")(next?.toString() ?? "")} quickPicks="inline" value={value.date ? parseDate(value.date) : null} />
    <FormRow>
      <TimeField description={t("Times are in {zone}", { zone: view.timezone })} granularity="minute" isRequired label={t("Start")} onChange={(next) => set("time")(next ? next.toString().slice(0, 5) : "")} value={value.time ? parseTime(value.time) : null} />
      <SelectField items={DURATIONS.map((minutes) => ({ id: String(minutes), label: t("{count} min", { count: minutes }) }))} label={t("Length")} onSelectionChange={(key) => set("minutes")(String(key))} selectedKey={value.minutes} />
    </FormRow>
    <SelectField items={[{ id: "in_person", label: t("In person") }, { id: "online", label: t("Online") }]} label={t("Where")} onSelectionChange={(key) => set("mode")(String(key))} selectedKey={value.mode} />
    <TextInput label={value.mode === "online" ? t("Meeting link") : t("Address")} maxLength={500} onChange={set("place")} placeholder={value.mode === "online" ? "https://" : undefined} value={value.place} />
    <TextAreaField label={t("Note for the designer")} maxLength={2000} onChange={set("note")} value={value.note} />
  </FormDialog>;
}

function ChangeDesignerDialog({ workspaceId, opportunityId, people, version, onClose, onChanged }: { workspaceId: string; opportunityId: string; people: Array<{ id: string; label: string }>; version: number; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [designer, setDesigner] = useState("");
  const [reason, setReason] = useState("");
  const save = async () => {
    if (!designer) throw new Error(t("Choose the designer."));
    if (!reason.trim()) throw new Error(t("Give a reason for changing the designer."));
    await crmRequest(workspaceId, `opportunities/${opportunityId}/designer`, "PUT", { membershipId: designer, reason: reason.trim(), version });
    onChanged();
  };
  return <FormDialog isDirty={Boolean(designer || reason.trim())} onClose={onClose} onSubmit={save} submitLabel={t("Change designer")} title={t("Change designer")}>
    <SelectField isRequired items={people} label={t("New designer")} onSelectionChange={(key) => setDesigner(String(key ?? ""))} placeholder={t("Choose the designer")} selectedKey={designer || null} />
    <TextAreaField isRequired label={t("Reason")} maxLength={500} onChange={setReason} value={reason} />
  </FormDialog>;
}

function when(startsAt: string, endsAt: string, timeZone: string, locale?: string) {
  try {
    const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(startsAt));
    const end = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(endsAt));
    return `${day} – ${end}`;
  } catch { return startsAt; }
}

function dateTime(value: string, locale?: string) {
  try { return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); } catch { return value; }
}
