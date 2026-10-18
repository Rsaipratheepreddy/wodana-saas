import { computeSlots, type HostAvailability, type Slot, type WorkCalendar } from "../../booking/booking.domain";
import { allSteps, type FlowDefinition } from "../flows/flow-definition";

/**
 * PLM-080 / PLM-044: a joinery job's site visit is measured by the salesperson and a designer together, so it is
 * booked only in time both have free (the booking slot engine: working week and hours, holidays, leave, overrides,
 * meetings, other bookings and connected calendars). The Account Manager is invited. Pure.
 */
export const SITE_VISIT_MINUTES = { min: 30, max: 480, default: 120, step: 30 } as const;

/** The job's steps include a site visit before Won (the joinery path). */
export const siteVisitApplies = (definition: FlowDefinition) => allSteps(definition).some((step) => step.check === "site_visit_recorded");

/** A visit's length: whole half hours from 30 minutes to 8 hours. */
export function visitMinutes(value: unknown) {
  const minutes = value === undefined || value === null || value === "" ? SITE_VISIT_MINUTES.default : Number(value);
  return Number.isInteger(minutes) && minutes >= SITE_VISIT_MINUTES.min && minutes <= SITE_VISIT_MINUTES.max && minutes % SITE_VISIT_MINUTES.step === 0 ? minutes : null;
}

/**
 * Slots in which every one of `people` is free (staff booking: no visitor notice, a year ahead, no daily cap). The
 * engine lists, per slot, everyone free for it; a joint slot is one that lists them all.
 */
export function jointSlots(input: { calendar: WorkCalendar; hosts: HostAvailability[]; people: string[]; from: string; to: string; minutes: number; now: Date }): Slot[] {
  const slots = computeSlots({
    rules: { durationMinutes: input.minutes, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 0, windowDays: 366, maxPerDay: null, stepMinutes: SITE_VISIT_MINUTES.step },
    calendar: input.calendar, hosts: input.hosts, from: input.from, to: input.to, now: input.now,
  });
  return slots.filter((slot) => input.people.every((person) => slot.hostIds.includes(person)));
}
