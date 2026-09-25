import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import type { ProjectWorkPackage, ReleasedScopeLine } from "./execution.types";

const actor: ExecutionActor = { id: "pm", name: "PM", manage: true, review: false, buy: false, report: false, released: true, memberIds: ["pm"], resourceIds: [], now: "2026-09-22T00:00:00Z", today: "2026-09-26" };
const line: ReleasedScopeLine = { id: "line", title: "Wardrobes", quantity: 4, unit: "nos", room: "Bedroom", material: "Oak", sourceScopeVersion: 1 };
const work: ProjectWorkPackage = { id: "w", title: "Wardrobes", scopeLineIds: ["line"], area: "Bedroom", deliveryRoute: "mixed", status: "planning", ownerId: "pm", plannedStart: "2026-10-01", plannedEnd: "", blocker: "", createdAt: actor.now, updatedAt: actor.now };
const fixture = () => ({
  ...emptyProject(),
  scope: { quotationId: "q", version: 1, releasedAt: actor.now, value: 1000, lines: [{ ...line }] } as ReturnType<typeof emptyProject>["scope"],
  workPackages: [structuredClone(work)],
});
const apply = (data: ReturnType<typeof fixture>, template: string, who = actor) => applyExecution(data, "package_tasks", { id: "w", template }, who);

describe("package task templates", () => {
  it("plans a manufactured item as a dated, dependent chain linked to its released scope", () => {
    const data = fixture();
    apply(data, "manufactured");

    expect(data.tasks.map((task) => [task.title, task.location, task.start, task.end, task.quantity, task.unit])).toEqual([
      ["Measure site · Wardrobes", "site", "2026-10-01", "2026-10-01", 1, "visit"],
      ["Shop drawing · Wardrobes", "office", "2026-10-02", "2026-10-04", 1, "set"],
      ["Produce · Wardrobes", "factory", "2026-10-05", "2026-10-14", 4, "nos"],
      ["Install · Wardrobes", "site", "2026-10-15", "2026-10-17", 4, "nos"],
    ]);
    expect(data.tasks.map((task) => task.predecessors)).toEqual([[], [data.tasks[0].id], [data.tasks[1].id], [data.tasks[2].id]]);
    expect(data.tasks.every((task) => task.packageId === "w" && task.status === "planned" && task.ownerId === "")).toBe(true);
    expect(data.tasks.filter((task) => task.scopeIds.includes("line")).map((task) => task.title)).toEqual(["Produce · Wardrobes", "Install · Wardrobes"]);
    expect(data.tasks.at(-1)?.inspectionRequired).toBe(true);
    expect(data.tasks.every((task) => !task.readiness.scope && !task.readiness.access && !task.readiness.materials)).toBe(true);
    expect(data.audit.at(-1)).toMatchObject({ action: "package_tasks", recordId: "w", note: "Planned 4 tasks from the manufactured template." });
  });

  it("plans ready-made furniture without factory work and starts today when the package has no date", () => {
    const data = fixture();
    data.workPackages[0].plannedStart = "";
    apply(data, "ready_made");
    expect(data.tasks.map((task) => [task.title, task.location, task.start])).toEqual([
      ["Order · Wardrobes", "office", "2026-09-26"],
      ["Deliver and install · Wardrobes", "site", "2026-09-28"],
    ]);
    expect(data.tasks.some((task) => task.location === "factory")).toBe(false);
  });

  it("refuses a second template, closed packages, unknown templates and non-planners without changes", () => {
    const planned = fixture();
    apply(planned, "site_work");
    const snapshot = structuredClone(planned);
    expect(() => apply(planned, "design")).toThrow("already has tasks");
    expect(planned).toEqual(snapshot);

    const closed = fixture();
    closed.workPackages[0].status = "cancelled";
    expect(() => apply(closed, "design")).toThrow("closed");

    expect(() => apply(fixture(), "anything")).toThrow();
    expect(() => apply(fixture(), "design", { ...actor, manage: false })).toThrow();
    expect(fixture().tasks).toEqual([]);
  });

  it("needs a released quantity and unit before planning", () => {
    const data = fixture();
    data.scope!.lines[0] = { ...line, quantity: 0 };
    expect(() => apply(data, "site_work")).toThrow("quantity and unit");
    expect(data.tasks).toEqual([]);
  });
});
