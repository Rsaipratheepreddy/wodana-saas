import { BadRequestException } from "@nestjs/common";
import {
  bookingSlots,
  fullCalendar,
  slotMinutes,
  type BookingSlot,
  type WorkCalendar,
} from "./project-calendar";

export type ScheduleBookingStatus =
  | "draft"
  | "tentative"
  | "confirmed"
  | "completed"
  | "cancelled";
export type ResourceCapacityMode = "exclusive" | "pooled";

export type CapacityResource = {
  id: string;
  businessUnitId?: string | null;
  capacityMode?: ResourceCapacityMode;
  capacity?: number;
  calendar?: WorkCalendar;
};

export type CapacityBookingSlot = BookingSlot & {
  bookingId: string;
  resourceId: string;
  status: ScheduleBookingStatus;
  units: number;
};

export type CapacityDemand = {
  slots: BookingSlot[];
  units: number;
};

export function scheduleStatus(value: unknown): ScheduleBookingStatus {
  if (!["draft", "tentative", "confirmed", "completed", "cancelled"].includes(String(value)))
    throw new BadRequestException("Choose a valid booking status.");
  return value as ScheduleBookingStatus;
}

export function capacityConfiguration(
  kind: "crew" | "person" | "factory" | "vendor",
  modeValue: unknown,
  capacityValue: unknown,
): { capacityMode: ResourceCapacityMode; capacity: number } {
  const capacityMode = String(modeValue ?? "exclusive") as ResourceCapacityMode;
  const capacity = Number(capacityValue ?? 1);
  if (!["exclusive", "pooled"].includes(capacityMode))
    throw new BadRequestException("Choose exclusive or pooled capacity.");
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 100000)
    throw new BadRequestException("Capacity must be greater than zero and no more than 100000.");
  if (["crew", "person"].includes(kind) && (capacityMode !== "exclusive" || capacity !== 1))
    throw new BadRequestException("People and crews use one exclusive capacity slot.");
  if (capacityMode === "exclusive" && capacity !== 1)
    throw new BadRequestException("Exclusive resources use a capacity of one.");
  return { capacityMode, capacity };
}

export function exceedsPooledCapacity(
  requestedSlots: BookingSlot[],
  requestedUnits: number,
  existing: CapacityDemand[],
  capacity: number,
): boolean {
  const absolute = (slot: BookingSlot) => {
    const span = slotMinutes(slot);
    const midnight = Date.parse(slot.date) / 60000;
    return { start: midnight + span.start, end: midnight + span.end };
  };
  const demands = existing.map((demand) => ({
    units: demand.units,
    spans: demand.slots.map(absolute),
  }));
  return requestedSlots.some((slot) => {
    const requested = absolute(slot);
    const boundaries = [...new Set([
      requested.start,
      requested.end,
      ...demands.flatMap((demand) => demand.spans.flatMap((span) =>
        span.start < requested.end && requested.start < span.end
          ? [Math.max(requested.start, span.start), Math.min(requested.end, span.end)]
          : [])),
    ])].sort((left, right) => left - right);
    return boundaries.slice(0, -1).some((start, index) => {
      const end = boundaries[index + 1];
      const used = demands
        .filter((demand) => demand.spans.some((span) => span.start < end && start < span.end))
        .reduce((total, demand) => total + demand.units, requestedUnits);
      return used > capacity;
    });
  });
}

function segmentsForDay(
  working: BookingSlot,
  bookings: CapacityBookingSlot[],
  capacity: number,
) {
  const workingSpan = slotMinutes(working);
  const relevant = bookings
    .map((booking) => {
      const span = slotMinutes(booking);
      const offset = (Date.parse(booking.date) - Date.parse(working.date)) / 60000;
      return { booking, start: span.start + offset, end: span.end + offset };
    })
    .filter(({ start, end }) => start < workingSpan.end && workingSpan.start < end);
  const boundaries = [...new Set([
    workingSpan.start,
    workingSpan.end,
    ...relevant.flatMap(({ start, end }) => [
      Math.max(start, workingSpan.start),
      Math.min(end, workingSpan.end),
    ]),
  ])].sort((left, right) => left - right);
  const clock = (minutes: number) => {
    const normalized = minutes % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
  };
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const active = relevant.filter((slot) => slot.start < end && start < slot.end);
    const confirmed = active
      .filter(({ booking }) => booking.status === "confirmed")
      .reduce((total, { booking }) => total + booking.units, 0);
    const tentative = active
      .filter(({ booking }) => booking.status === "tentative")
      .reduce((total, { booking }) => total + booking.units, 0);
    return {
      date: working.date,
      ...(end > 1440 ? { endDate: working.endDate } : {}),
      startTime: clock(start),
      endTime: clock(end),
      durationMinutes: end - start,
      capacity,
      confirmed,
      tentative,
      remaining: Math.max(0, capacity - confirmed),
      overCapacity: confirmed > capacity,
      confirmedBookingIds: active
        .filter(({ booking }) => booking.status === "confirmed")
        .map(({ booking }) => booking.bookingId),
      tentativeBookingIds: active
        .filter(({ booking }) => booking.status === "tentative")
        .map(({ booking }) => booking.bookingId),
    };
  });
}

export function resourceAvailability(
  resources: CapacityResource[],
  bookingRows: CapacityBookingSlot[],
  from: string,
  to: string,
) {
  return resources.map((resource) => {
    const capacity = resource.capacity ?? 1;
    const calendar = resource.calendar ?? fullCalendar;
    const overnight = calendar.endTime <= calendar.startTime;
    const workingFrom = overnight
      ? new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10)
      : from;
    let working: BookingSlot[] = [];
    try {
      working = bookingSlots(workingFrom, to, calendar)
        .filter((slot) => (slot.endDate ?? slot.date) >= from && slot.date <= to);
    } catch {
      // A bounded range can legitimately contain only weekends or holidays.
      working = [];
    }
    const bookings = bookingRows.filter((booking) => booking.resourceId === resource.id);
    const segments = working.flatMap((slot) => segmentsForDay(slot, bookings, capacity));
    return {
      resourceId: resource.id,
      businessUnitId: resource.businessUnitId ?? null,
      capacityMode: resource.capacityMode ?? "exclusive",
      capacity,
      segments,
      gapCount: segments.filter((segment) => segment.remaining > 0).length,
      gapMinutes: segments
        .filter((segment) => segment.remaining > 0)
        .reduce((total, segment) => total + segment.durationMinutes, 0),
      availableCapacityMinutes: segments.reduce(
        (total, segment) => total + segment.durationMinutes * segment.remaining,
        0,
      ),
      conflictCount: segments.filter((segment) => segment.overCapacity).length,
    };
  });
}
