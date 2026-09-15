import { exceedsPooledCapacity } from "./project-schedule-capacity";

export type PortfolioBookingRow = {
  id: string;
  projectId: string;
  projectName: string;
  dealReference: string;
  clientName: string;
  taskId: string;
  taskTitle: string;
  resourceId: string;
  resourceName: string;
  resourceKind: string;
  businessUnitId: string | null;
  businessUnitCode: string | null;
  businessUnitName: string | null;
  businessUnitColor: string | null;
  members: Array<{ id: string; name: string }>;
  slots: Array<{ date: string; endDate?: string; startTime: string; endTime: string }>;
  acknowledgement: string;
  status?: "tentative" | "confirmed";
  units?: number;
  capacityMode?: "exclusive" | "pooled";
  capacity?: number;
};

export function portfolioCalendarEvents(rows: PortfolioBookingRow[], from: string, to: string) {
  const events = rows.flatMap((row) => (Array.isArray(row.slots) ? row.slots : [])
    .filter((slot) => (slot.endDate ?? slot.date) >= from && slot.date <= to)
    .map((slot) => {
      const assigned = Boolean(row.businessUnitId);
      const department = {
        id: row.businessUnitId ?? "unassigned",
        code: assigned ? (row.businessUnitCode ?? "UNASSIGNED") : "UNASSIGNED",
        name: assigned ? (row.businessUnitName ?? "Unassigned") : "Unassigned",
        visibleName: assigned ? (row.businessUnitName ?? "Unassigned") : "Unassigned",
        color: assigned ? (row.businessUnitColor ?? "#64748B") : "#64748B",
      };
      const memberNames = row.members.map((member) => member.name).filter(Boolean);
      return {
        id: `${row.id}:${slot.date}`,
        bookingId: row.id,
        projectId: row.projectId,
        projectName: row.projectName,
        dealReference: row.dealReference,
        clientName: row.clientName,
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        department,
        resource: { id: row.resourceId, name: row.resourceName, kind: row.resourceKind },
        members: row.members,
        date: slot.date,
        endDate: slot.endDate ?? slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: [row.dealReference, row.clientName, department.visibleName, row.resourceName, memberNames.join(", ")]
          .filter(Boolean)
          .join(" — "),
        acknowledgement: row.acknowledgement,
        bookingStatus: row.status ?? "confirmed",
        units: Number(row.units ?? 1),
        overlapIds: [] as string[],
        conflictIds: [] as string[],
      };
    }));

  for (const event of events) {
    event.overlapIds = events
      .filter((candidate) => candidate.id !== event.id
        && candidate.department.id === event.department.id
        && eventsOverlap(event, candidate))
      .map((candidate) => candidate.id);
    const hard = events.filter((candidate) => candidate.id !== event.id
      && candidate.bookingStatus === "confirmed"
      && event.bookingStatus === "confirmed"
      && eventsOverlap(event, candidate)
      && (
        candidate.resource.id === event.resource.id
        || candidate.members.some((member) => event.members.some((own) => own.id === member.id))
      ));
    const pooledCapacityExceeded = event.bookingStatus === "confirmed"
      && exceedsPooledCapacity(
        [{ date: event.date, endDate: event.endDate, startTime: event.startTime, endTime: event.endTime }],
        event.units,
        events.filter((candidate) => candidate.id !== event.id
            && candidate.bookingStatus === "confirmed"
            && candidate.resource.id === event.resource.id)
          .map((candidate) => ({
            units: candidate.units,
            slots: [{
              date: candidate.date,
              endDate: candidate.endDate,
              startTime: candidate.startTime,
              endTime: candidate.endTime,
            }],
          })),
        Number(rowForEvent(rows, event.bookingId)?.capacity ?? 1),
      );
    const capacityExceeded = rowForEvent(rows, event.bookingId)?.capacityMode === "pooled"
      && pooledCapacityExceeded;
    event.conflictIds = hard
      .filter((candidate) => {
        const sharesMember = candidate.members.some((member) =>
          event.members.some((own) => own.id === member.id));
        return sharesMember
          || candidate.resource.id !== event.resource.id
          || rowForEvent(rows, event.bookingId)?.capacityMode !== "pooled"
          || capacityExceeded;
      })
      .map((candidate) => candidate.id);
  }
  return events.sort((left, right) => `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`));
}

function rowForEvent(rows: PortfolioBookingRow[], bookingId: string) {
  return rows.find((row) => row.id === bookingId);
}

function eventsOverlap(
  left: { date: string; endDate: string; startTime: string; endTime: string },
  right: { date: string; endDate: string; startTime: string; endTime: string },
) {
  const minute = (date: string, time: string) => Date.parse(date) / 60000
    + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const leftStart = minute(left.date, left.startTime);
  const leftEnd = minute(left.endDate, left.endTime);
  const rightStart = minute(right.date, right.startTime);
  const rightEnd = minute(right.endDate, right.endTime);
  return leftStart < leftEnd && rightStart < rightEnd
    && leftStart < rightEnd && rightStart < leftEnd;
}
