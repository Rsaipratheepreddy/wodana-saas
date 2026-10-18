import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ProjectState } from "@/lib/projects/execution";
import { ProjectCalendar, projectCalendarEvents } from "./project-calendar";

const state = {
  id: "p", workspaceId: "w", caseId: "c", name: "Villa", customer: "Client", memberId: "m",
  canManage: true, canReview: true, canReport: true, canBuy: true, commercialReady: true, timezone: "Asia/Dubai",
  members: [{ id: "m", name: "Manager" }],
  resources: [{ id: "r", name: "Joinery workshop", kind: "factory", members: [], active: true, calendar: { weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "17:00", holidays: [] } }],
  bookings: [{ id: "b", projectId: "p", projectName: "Villa", taskId: "t", taskTitle: "Fabricate wardrobe", resourceId: "r", start: "2026-09-21", end: "2026-09-23", status: "confirmed" }],
  pulse: { health: "clear", counts: {}, nextActions: [] },
  data: {
    revision: 1, phase: "active", scope: null, reports: [], documents: [], snags: [], handovers: [], comments: [], audit: [], processed: [], budget: 0, forecast: 0, financeClosed: false, financeEvidence: "",
    tasks: [{ id: "t", title: "Fabricate wardrobe", parentId: "", area: "Bedroom", location: "factory", status: "in_progress", start: "2026-09-21", end: "2026-09-25", scopeIds: [], predecessors: [], readiness: { scope: true, access: true, materials: true }, quantity: 1, unit: "nos", approved: 0, weight: 1, ownerId: "m", assigneeIds: [], resourceId: "r", package: "", description: "", baselineStart: "2026-09-21", baselineEnd: "2026-09-25", priority: "normal", inspectionRequired: false, drawingId: "", blocker: "" }],
    milestones: [{ id: "ms", title: "Client walkthrough", dueDate: "2026-09-30", ownerId: "m", taskIds: ["t"], acceptedAt: "" }],
    materials: [{ id: "mat", title: "Oak veneer board", specification: "18mm", catalogId: "", catalogVersion: 0, unit: "sheet", required: 12, supply: "company", taskId: "t", needBy: "2026-09-19", movements: [], reservations: [] }],
    orders: [{ id: "po", number: "PO-001", title: "Boards", vendor: "Al Noor", vendorContact: "", kind: "material", materialId: "mat", taskId: "t", quantity: 10, unit: "sheet", unitCost: 100, currency: "AED", promisedDate: "2026-09-24", status: "acknowledged", acknowledgement: "", receipts: [] }],
  },
} as unknown as ProjectState;

describe("project calendar", () => {
  it("collects every dated record into calendar events", () => {
    const events = projectCalendarEvents(state, "2026-09-20");
    expect(events.map((event) => event.kind)).toEqual(["material", "task", "booking", "delivery", "milestone"]);
    expect(events.find((event) => event.kind === "material")?.tone).toBe("danger");
    expect(events.find((event) => event.kind === "delivery")?.href).toBe("/workspace/projects/p/procurement?record=po");
  });
  it("renders the month grid with chips, filters and a day agenda that opens tasks", () => {
    const onOpen = vi.fn();
    render(<ProjectCalendar busy={false} onOpen={onOpen} run={vi.fn()} state={state} today="2026-09-20" />);
    expect(screen.getByRole("group", { name: "Calendar · September 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Monday 21 September/ }));
    const agenda = screen.getByRole("region", { name: /Agenda · Monday 21 September/ });
    fireEvent.click(within(agenda).getByRole("button", { name: /^Fabricate wardrobe/ }));
    expect(onOpen).toHaveBeenCalledWith("t");
    fireEvent.click(screen.getByRole("checkbox", { name: /Tasks · 1/ }));
    expect(within(screen.getByRole("region", { name: /Agenda/ })).queryByRole("button", { name: /^Fabricate wardrobe/ })).toBeNull();
    expect(screen.getByRole("table", { name: "Resource calendars" })).toBeTruthy();
  });
});
