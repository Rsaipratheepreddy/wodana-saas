"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FormDialog, InlineNotice, SelectField, Skeleton, TextAreaField, formatDate, useDesignSystem } from "@/design-system";
import { crmRequest, rows } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useCrmResource } from "./crm-workbench";

type Person = { membershipId: string; name: string | null };
export type SiteVisitView = {
  applies: boolean; step: { key: string; name: string; state: string } | null; salesperson: Person | null; designer: Person | null; caseId: string | null;
  visit: { status: string; version: number; startsAt: string | null; endsAt: string | null; completedAt: string | null; kind: string; measurements: number } | null;
  version: number; timezone: string; minutes: number;
};
type Slots = { timezone: string; minutes: number; slots: Array<{ start: string; end: string; date: string }> };
const LENGTHS = [60, 90, 120, 180, 240];

/**
 * PLM-080 / PLM-044: the joinery site visit. The salesperson and a designer measure the walls together, so only
 * times both have free are offered (the booking slot engine); the Account Manager is invited. The visit itself —
 * measurements, photos and the question list — is recorded on the case's Site page.
 */
export function SiteVisitDialog({ workspaceId, opportunityId, onClose, onBooked }: { workspaceId: string; opportunityId: string; onClose: () => void; onBooked: () => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [view, setView] = useState<SiteVisitView | null>(null);
  const [failure, setFailure] = useState("");
  const [designer, setDesigner] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const [address, setAddress] = useState("");
  const members = useCrmResource<unknown>(workspaceId, "members");
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<SiteVisitView>(workspaceId, `opportunities/${opportunityId}/site-visit`, "GET", undefined, controller.signal)
      .then((next) => { setView(next); setDesigner(next.designer?.membershipId ?? ""); setMinutes(next.minutes); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, opportunityId]);
  useEffect(() => {
    if (!designer || !view?.salesperson) return;
    const controller = new AbortController();
    crmRequest<Slots>(workspaceId, `opportunities/${opportunityId}/site-visit/slots?designerMembershipId=${designer}&minutes=${minutes}`, "GET", undefined, controller.signal)
      .then((next) => { setSlots(next); setFailure(""); })
      .catch((cause: Error) => { if (!controller.signal.aborted) { setSlots(null); setFailure(cause.message); } });
    return () => controller.abort();
  }, [workspaceId, opportunityId, designer, minutes, view?.salesperson]);
  const people = (rows(members.data) as Array<{ id?: unknown; displayName?: unknown; name?: unknown }>)
    .map((member) => ({ id: String(member.id), label: String(member.displayName ?? member.name ?? "") }))
    .filter((member) => member.label && member.id !== view?.salesperson?.membershipId);
  const days = useMemo(() => [...new Set((slots?.slots ?? []).map((slot) => slot.date))], [slots]);
  const timezone = slots?.timezone ?? view?.timezone ?? "UTC";
  const chosenDay = days.includes(day) ? day : days[0] ?? "";
  const times = (slots?.slots ?? []).filter((slot) => slot.date === chosenDay);
  const chosen = times.some((slot) => slot.start === start) ? start : "";
  const booked = view?.visit?.startsAt ? `${formatDate(view.visit.startsAt, { locale, timeZone: view.timezone }, { dateStyle: "full", timeStyle: "short" })}` : null;
  return <FormDialog title={t("Book the site visit")} description={view?.salesperson?.name ? t("With {name} and a designer, in time both have free", { name: view.salesperson.name }) : undefined}
    submitLabel={booked ? t("Move the visit") : t("Book")} error={failure || undefined} isSubmitDisabled={!view || !designer || !chosen} onClose={onClose}
    onSubmit={async () => {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/site-visit`, "POST", { designerMembershipId: designer, startsAt: chosen, minutes, timezone, address: address.trim() || undefined, version: view!.version });
      onBooked();
    }}>
    {!view ? (failure ? null : <Skeleton lines={4} shape="form" />) : <>
      {!view.salesperson ? <InlineNotice tone="error" message={t("Assign a sales owner first")} /> : null}
      {booked ? <InlineNotice message={t("Booked for {when}. Measurements and photos are recorded on the case.", { when: booked })} /> : null}
      {view.caseId ? <Link href={`/workspace/pre-projects/cases/${view.caseId}/site`}>{t("Open the site visit")}</Link> : null}
      <SelectField isRequired isDisabled={Boolean(view.designer)} label={t("Designer")} selectedKey={designer || null} onSelectionChange={(key) => setDesigner(String(key ?? ""))}
        items={view.designer ? [{ id: view.designer.membershipId, label: view.designer.name ?? "" }] : people}
        description={view.designer ? t("The dedicated designer goes") : undefined} />
      <SelectField isRequired label={t("Length")} selectedKey={String(minutes)} onSelectionChange={(key) => setMinutes(Number(key))}
        items={LENGTHS.map((value) => ({ id: String(value), label: value % 60 ? t("{hours} h {minutes} min", { hours: Math.floor(value / 60), minutes: value % 60 }) : t("{count} hours", { count: value / 60 }) }))} />
      {designer && slots && !slots.slots.length ? <InlineNotice message={t("No time both are free in the next two weeks")} /> : null}
      {days.length ? <>
        <SelectField isRequired label={t("Day")} selectedKey={chosenDay} onSelectionChange={(key) => { setDay(String(key)); setStart(""); }}
          items={days.map((date) => ({ id: date, label: formatDate(`${date}T12:00:00Z`, { locale, timeZone: "UTC" }, { weekday: "short", day: "numeric", month: "short" }) }))} />
        <SelectField isRequired label={t("Time")} selectedKey={chosen || null} onSelectionChange={(key) => setStart(String(key))}
          items={times.map((slot) => ({ id: slot.start, label: `${formatDate(slot.start, { locale, timeZone: timezone }, { timeStyle: "short" })}–${formatDate(slot.end, { locale, timeZone: timezone }, { timeStyle: "short" })}` }))}
          description={t("Times in {zone}", { zone: timezone })} />
      </> : null}
      <TextAreaField label={t("Site address")} maxLength={500} value={address} onChange={setAddress} />
    </>}
  </FormDialog>;
}
