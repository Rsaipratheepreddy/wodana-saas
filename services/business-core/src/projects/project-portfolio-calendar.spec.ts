import { describe, expect, it } from "vitest";
import { portfolioCalendarEvents, type PortfolioBookingRow } from "./project-portfolio-calendar";

const booking = (id: string, overrides: Partial<PortfolioBookingRow> = {}): PortfolioBookingRow => ({
  id,
  projectId: `project-${id}`,
  projectName: `Project ${id}`,
  dealReference: `DEAL-${id}`,
  clientName: `Client ${id}`,
  taskId: `task-${id}`,
  taskTitle: `Task ${id}`,
  resourceId: `resource-${id}`,
  resourceName: "Design Team",
  resourceKind: "crew",
  businessUnitId: "design",
  businessUnitCode: "DESIGN",
  businessUnitName: "Design",
  businessUnitColor: "#DC2626",
  members: [{ id: `member-${id}`, name: `Designer ${id}` }],
  slots: [{ date: "2026-09-08", startTime: "13:00", endTime: "14:00" }],
  acknowledgement: "",
  ...overrides,
});

describe("portfolio calendar events", () => {
  it("builds the client-facing title and flags same-department overlaps", () => {
    const events = portfolioCalendarEvents([
      booking("A"),
      booking("B", { slots: [{ date: "2026-09-08", startTime: "13:30", endTime: "14:30" }] }),
      booking("C", { businessUnitId: "production", businessUnitName: "Production", businessUnitColor: "#7C3AED" }),
    ], "2026-09-06", "2026-09-12");

    expect(events[0].title).toBe("DEAL-A — Client A — Design — Design Team — Designer A");
    expect(events[0].department).toMatchObject({ code: "DESIGN", name: "Design", visibleName: "Design" });
    expect(events.find((event) => event.bookingId === "A")?.overlapIds).toEqual(["B:2026-09-08"]);
    expect(events.find((event) => event.bookingId === "C")?.overlapIds).toEqual([]);
  });

  it("returns one event per in-range working slot and has a safe unassigned color", () => {
    const events = portfolioCalendarEvents([booking("A", {
      businessUnitId: null,
      businessUnitName: null,
      businessUnitColor: null,
      slots: [
        { date: "2026-09-05", startTime: "09:00", endTime: "10:00" },
        { date: "2026-09-06", startTime: "09:00", endTime: "10:00" },
        { date: "2026-09-13", startTime: "09:00", endTime: "10:00" },
      ],
    })], "2026-09-06", "2026-09-12");

    expect(events).toHaveLength(1);
    expect(events[0].department).toEqual({ id: "unassigned", code: "UNASSIGNED", name: "Unassigned", visibleName: "Unassigned", color: "#64748B" });
  });
});
