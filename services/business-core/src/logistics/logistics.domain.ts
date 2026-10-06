import { workdays, type WorkCalendar } from "../project-core/work-calendar";

/**
 * Factory and installation bookings (PLM-063, PLM-069; PLM-135 and PLM-136 from Palm's answers of 6 Oct). A booking is
 * a day on its source record (a project's delivery, installation or factory slot, a permit collection, a production
 * work order, a deal's delivery) plus who goes: HRMS workers booked by name (crews and installers aren't all Wodana
 * users), a lead among them, and for a delivery the vehicle and its driver. A person booked twice on a day warns; a
 * vehicle can't be booked twice.
 */
export const LOGISTICS_KINDS = ["delivery", "installation", "factory_slot", "permit", "production"] as const;
export type LogisticsKind = (typeof LOGISTICS_KINDS)[number];
export const isLogisticsKind = (value: unknown): value is LogisticsKind => typeof value === "string" && (LOGISTICS_KINDS as readonly string[]).includes(value);

export const KIND_LABEL: Record<LogisticsKind, string> = {
  delivery: "Delivery", installation: "Installation", factory_slot: "Factory slot", permit: "Permit collection", production: "Production",
};

/** Who books from the factory and logistics calendar, anywhere. */
export const BOOKERS = ["logistics.manage", "factory.manage"];

/** A booked span with who and what goes on it. Days are calendar days (YYYY-MM-DD), `end` inclusive. */
export type Slot = {
  key: string; kind: LogisticsKind; projectId: string | null; opportunityId: string | null; workOrderId: string | null; permitId: string | null; project: string;
  start: string; end: string; workerIds: string[]; driverId: string | null; vehicleId: string | null;
};

export type Clash = { kind: "person" | "vehicle"; id: string; key: string; what: LogisticsKind; project: string; day: string };

/** The key a booking is known by on the calendar (the same as its calendar entry). */
export function slotKey(kind: LogisticsKind, subject: { projectId?: string | null; opportunityId?: string | null; workOrderId?: string | null; permitId?: string | null }) {
  if (kind === "production") return `work-order:${subject.workOrderId}`;
  if (kind === "permit") return `permit:${subject.permitId}`;
  if (!subject.projectId && subject.opportunityId) return `deal-delivery:${subject.opportunityId}`;
  return `${kind === "factory_slot" ? "factory-slot" : kind}:${subject.projectId}`;
}

const overlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;

/**
 * Who or what is already booked elsewhere on the candidate's days: a person (on the crew or driving) or a vehicle on
 * another booking that overlaps. The booking itself (same key) never clashes with itself.
 */
export function clashes(candidate: { key: string; start: string; end: string; workerIds: string[]; driverId: string | null; vehicleId: string | null }, slots: Slot[]): Clash[] {
  const people = new Set([...candidate.workerIds, ...(candidate.driverId ? [candidate.driverId] : [])]);
  const found: Clash[] = [];
  for (const slot of slots) {
    if (slot.key === candidate.key || !overlap(candidate, slot)) continue;
    const day = candidate.start > slot.start ? candidate.start : slot.start;
    const theirs = new Set([...slot.workerIds, ...(slot.driverId ? [slot.driverId] : [])]);
    for (const id of people) if (theirs.has(id)) found.push({ kind: "person", id, key: slot.key, what: slot.kind, project: slot.project, day });
    if (candidate.vehicleId && candidate.vehicleId === slot.vehicleId) found.push({ kind: "vehicle", id: candidate.vehicleId, key: slot.key, what: slot.kind, project: slot.project, day });
  }
  return found;
}

export type PermitFact = { id: string; status: "planned" | "collected" | "cancelled"; validFrom: string | null; validTo: string | null; collectOn: string | null };

/** A collected permit covering the day: the one valid longest, so a renewal wins. */
export function permitFor(permits: PermitFact[], day: string) {
  return permits.filter((permit) => permit.status === "collected" && permit.validFrom && permit.validTo && permit.validFrom <= day && day <= permit.validTo)
    .sort((a, b) => b.validTo!.localeCompare(a.validTo!))[0] ?? null;
}

/** What a permit lets in: the delivery or the installation (PLM-136: neither is booked without one). */
export type PermitUse = "delivery" | "installation";

/**
 * Why a delivery or installation can't be booked for a day where the building permit is required: none collected, or
 * none valid that day. Null when a collected permit covers it.
 */
export function permitProblem(permits: PermitFact[], day: string, format: (day: string) => string = (value) => value, use: PermitUse = "delivery") {
  if (permitFor(permits, day)) return null;
  const collected = permits.filter((permit) => permit.status === "collected");
  if (!collected.length) return `Collect the building permit before booking the ${use}.`;
  const later = collected.filter((permit) => permit.validFrom! > day).sort((a, b) => a.validFrom!.localeCompare(b.validFrom!))[0];
  if (later) return `The building permit is valid from ${format(later.validFrom!)}. Choose a ${use} day it covers.`;
  const last = [...collected].sort((a, b) => b.validTo!.localeCompare(a.validTo!))[0];
  return `The building permit ends on ${format(last.validTo!)}, before the ${use} day. Renew it first.`;
}

/**
 * The "Building permit collected" check: collected permits covering each booked day (the delivery and the
 * installation); before either is booked, a collected permit still valid today.
 */
export function permitCollected(permits: PermitFact[], days: Array<string | null>, today: string) {
  const booked = days.filter((day): day is string => Boolean(day));
  if (booked.length) return booked.every((day) => Boolean(permitFor(permits, day)));
  return permits.some((permit) => permit.status === "collected" && permit.validTo !== null && permit.validTo >= today);
}

export type PermitAlert = { use: PermitUse; day: string } & ({ kind: "expiring"; until: string; permitId: string } | { kind: "missing" });

/**
 * What the team hears about a booked day's permit (daily), for the first delivery or installation day not covered:
 * the permit ends before it (as soon as that is known), or there is none for it once the day is `warningDays` working
 * days away (or closer).
 */
export function permitAlert(input: { days: Array<{ use: PermitUse; day: string | null }>; today: string; permits: PermitFact[]; warningDays: number; calendar: WorkCalendar }): PermitAlert | null {
  const { today, permits } = input;
  const next = input.days.filter((item): item is { use: PermitUse; day: string } => Boolean(item.day) && item.day! >= today && !permitFor(permits, item.day!))
    .sort((a, b) => a.day.localeCompare(b.day))[0];
  if (!next) return null;
  const ending = permits.filter((permit) => permit.status === "collected" && permit.validTo && permit.validFrom && permit.validFrom <= next.day && permit.validTo >= today && permit.validTo < next.day)
    .sort((a, b) => b.validTo!.localeCompare(a.validTo!))[0];
  if (ending) return { ...next, kind: "expiring", until: ending.validTo!, permitId: ending.id };
  const from = workdays(input.calendar).shift(next.day, -Math.max(0, input.warningDays));
  return today >= from ? { ...next, kind: "missing" } : null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(value));

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "").slice(0, max);

/** A vehicle in the register: a name or plate is needed. */
export function parseVehicle(input: { name?: unknown; plate?: unknown; kind?: unknown; capacityNote?: unknown; active?: unknown }) {
  const name = text(input.name, 121), plate = text(input.plate, 41), kind = text(input.kind, 61), capacityNote = text(input.capacityNote, 201);
  if (!name && !plate) return { problem: "Name the vehicle or give its plate." } as const;
  if (name.length > 120 || plate.length > 40 || kind.length > 60 || capacityNote.length > 200) return { problem: "Keep the vehicle's details short." } as const;
  return { vehicle: { name: name || plate, plate, kind, capacityNote, active: input.active !== false } } as const;
}

export type PersonInput = { workerId: string; lead?: boolean };

/** The people on a booking: each once, at most one lead (the first one marked). */
export function parsePeople(input: unknown) {
  if (input === undefined) return { people: undefined } as const;
  if (!Array.isArray(input) || input.length > 40) return { problem: "Book at most 40 people at once." } as const;
  const seen = new Set<string>();
  let lead = false;
  const people: Array<{ workerId: string; lead: boolean }> = [];
  for (const raw of input as PersonInput[]) {
    const workerId = String(raw?.workerId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(workerId)) return { problem: "Choose people from the list." } as const;
    if (seen.has(workerId)) continue;
    seen.add(workerId);
    const isLead: boolean = Boolean(raw?.lead) && !lead;
    lead ||= isLead;
    people.push({ workerId, lead: isLead });
  }
  return { people } as const;
}
