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
  slots: Array<{ date: string; startTime: string; endTime: string }>;
  acknowledgement: string;
};

export function portfolioCalendarEvents(rows: PortfolioBookingRow[], from: string, to: string) {
  const events = rows.flatMap((row) => (Array.isArray(row.slots) ? row.slots : [])
    .filter((slot) => slot.date >= from && slot.date <= to)
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
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: [row.dealReference, row.clientName, department.visibleName, row.resourceName, memberNames.join(", ")]
          .filter(Boolean)
          .join(" — "),
        acknowledgement: row.acknowledgement,
        overlapIds: [] as string[],
      };
    }));

  for (const event of events) {
    event.overlapIds = events
      .filter((candidate) => candidate.id !== event.id
        && candidate.department.id === event.department.id
        && candidate.date === event.date
        && event.startTime < candidate.endTime
        && candidate.startTime < event.endTime)
      .map((candidate) => candidate.id);
  }
  return events.sort((left, right) => `${left.date}T${left.startTime}`.localeCompare(`${right.date}T${right.startTime}`));
}
