import { describe, expect, it } from "vitest";
import { checkPasses, DEFAULT_STAGES, HARD_CHECKS, TASK_CHECKS, type CheckFacts } from "../project-core/project-checks";
import { stageTaskAssignee } from "../project-core/project-stage-tasks";
import { clashes, parsePeople, parseVehicle, permitAlert, permitCollected, permitFor, permitProblem, permitReminderOn, renewalsDue, slotKey, type PermitFact, type Slot } from "./logistics.domain";

const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };
const collected = (id: string, validFrom: string, validTo: string): PermitFact => ({ id, status: "collected", validFrom, validTo, collectOn: null });
const slot = (over: Partial<Slot>): Slot => ({ key: "delivery:p1", kind: "delivery", projectId: "p1", opportunityId: null, workOrderId: null, permitId: null, project: "PRJ-1 · Villa",
  start: "2026-10-12", end: "2026-10-12", workerIds: [], driverId: null, vehicleId: null, ...over });

describe("bookings (PLM-135)", () => {
  it("names each booking by its source record", () => {
    expect(slotKey("delivery", { projectId: "p" })).toBe("delivery:p");
    expect(slotKey("factory_slot", { projectId: "p" })).toBe("factory-slot:p");
    expect(slotKey("production", { projectId: "p", workOrderId: "w" })).toBe("work-order:w");
    expect(slotKey("permit", { projectId: "p", permitId: "x" })).toBe("permit:x");
    expect(slotKey("delivery", { opportunityId: "o" })).toBe("deal-delivery:o");
  });

  it("warns when a person (on a crew or driving) or a vehicle is booked elsewhere on an overlapping day", () => {
    const others = [
      slot({ key: "installation:p2", kind: "installation", project: "PRJ-2", workerIds: ["ali", "sam"] }),
      slot({ key: "delivery:p3", project: "PRJ-3", driverId: "omar", vehicleId: "van" }),
      slot({ key: "work-order:w", kind: "production", project: "PRJ-4", start: "2026-10-10", end: "2026-10-14", workerIds: ["joe"] }),
      slot({ key: "delivery:p5", project: "PRJ-5", start: "2026-10-13", end: "2026-10-13", workerIds: ["ali"], vehicleId: "van" }),
    ];
    const found = clashes({ key: "delivery:p1", start: "2026-10-12", end: "2026-10-12", workerIds: ["ali", "joe"], driverId: "omar", vehicleId: "van" }, others);
    expect(found).toEqual([
      { kind: "person", id: "ali", key: "installation:p2", what: "installation", project: "PRJ-2", day: "2026-10-12" },
      { kind: "person", id: "omar", key: "delivery:p3", what: "delivery", project: "PRJ-3", day: "2026-10-12" },
      { kind: "vehicle", id: "van", key: "delivery:p3", what: "delivery", project: "PRJ-3", day: "2026-10-12" },
      { kind: "person", id: "joe", key: "work-order:w", what: "production", project: "PRJ-4", day: "2026-10-12" },
    ]);
    // A booking never clashes with itself, and other days are free.
    expect(clashes({ key: "installation:p2", start: "2026-10-12", end: "2026-10-12", workerIds: ["ali"], driverId: null, vehicleId: null }, others.slice(0, 1))).toEqual([]);
    expect(clashes({ key: "delivery:p1", start: "2026-10-20", end: "2026-10-20", workerIds: ["ali"], driverId: null, vehicleId: "van" }, others)).toEqual([]);
  });

  it("keeps each person once with at most one lead, and needs a vehicle's name or plate", () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    expect(parsePeople([{ workerId: id(1), lead: true }, { workerId: id(2), lead: true }, { workerId: id(1) }])).toEqual({ people: [{ workerId: id(1), lead: true }, { workerId: id(2), lead: false }] });
    expect(parsePeople(undefined)).toEqual({ people: undefined });
    expect(parsePeople([{ workerId: "nope" }])).toEqual({ problem: "Choose people from the list." });
    expect(parseVehicle({ name: "", plate: " " })).toEqual({ problem: "Name the vehicle or give its plate." });
    expect(parseVehicle({ plate: "DXB  A 12345", kind: "Truck" })).toEqual({ vehicle: { name: "DXB A 12345", plate: "DXB A 12345", kind: "Truck", capacityNote: "", active: true } });
  });
});

describe("building permits (PLM-136)", () => {
  const permits = [collected("a", "2026-10-01", "2026-10-15"), { id: "b", status: "planned", validFrom: null, validTo: null, collectOn: "2026-10-09" } as PermitFact];

  it("lets a delivery through only on a day a collected permit covers", () => {
    expect(permitFor(permits, "2026-10-12")?.id).toBe("a");
    expect(permitProblem(permits, "2026-10-12")).toBeNull();
    expect(permitProblem([], "2026-10-12")).toBe("Collect the building permit before booking the delivery.");
    expect(permitProblem(permits.slice(1), "2026-10-12")).toBe("Collect the building permit before booking the delivery.");
    expect(permitProblem(permits, "2026-10-20")).toBe("The building permit ends on 2026-10-15, before the delivery day. Renew it first.");
    expect(permitProblem([], "2026-10-12", undefined, "installation")).toBe("Collect the building permit before booking the installation.");
    expect(permitProblem([collected("c", "2026-11-01", "2026-11-30")], "2026-10-20")).toBe("The building permit is valid from 2026-11-01. Choose a delivery day it covers.");
    // A renewal covering the day wins.
    expect(permitFor([...permits, collected("d", "2026-10-14", "2026-12-31")], "2026-10-15")?.id).toBe("d");
  });

  it("passes the stage check for the delivery and installation days, or (before either is booked) while a permit is still valid", () => {
    expect(permitCollected(permits, ["2026-10-12", "2026-10-14"], "2026-10-05")).toBe(true);
    expect(permitCollected(permits, ["2026-10-12", "2026-10-20"], "2026-10-05")).toBe(false);
    expect(permitCollected(permits, [null, null], "2026-10-05")).toBe(true);
    expect(permitCollected(permits, [null], "2026-10-16")).toBe(false);
    const facts = { filledRoles: new Set<string>(), confirmed: new Set<string>(), productionPaid: false, materialsSignedOff: false, everythingOrdered: false, everythingMade: false,
      openSnags: 0, openCriticalSnags: 0, handedOver: false } satisfies CheckFacts;
    expect(checkPasses({ key: "permit", kind: "permit_collected" }, { ...facts, permitCollected: true })).toBe(true);
    expect(checkPasses({ key: "permit", kind: "permit_collected" }, facts)).toBe(false);
  });

  it("raises a permit ending before the delivery at once, and a missing one the firm's working days before", () => {
    // Delivery Monday 19 Oct; three working days before is Wednesday 14 Oct.
    const base = { days: [{ use: "delivery" as const, day: "2026-10-19" }], permits: [] as PermitFact[], warningDays: 3, calendar };
    const missing = { use: "delivery", day: "2026-10-19", kind: "missing" };
    expect(permitAlert({ ...base, today: "2026-10-13" })).toBeNull();
    expect(permitAlert({ ...base, today: "2026-10-14" })).toEqual(missing);
    expect(permitAlert({ ...base, today: "2026-10-19" })).toEqual(missing);
    expect(permitAlert({ ...base, today: "2026-10-20" })).toBeNull();
    expect(permitAlert({ ...base, today: "2026-10-02", permits: [collected("a", "2026-10-01", "2026-10-15")] }))
      .toEqual({ use: "delivery", day: "2026-10-19", kind: "expiring", until: "2026-10-15", permitId: "a" });
    expect(permitAlert({ ...base, today: "2026-10-02", permits: [collected("a", "2026-10-01", "2026-10-30")] })).toBeNull();
    expect(permitAlert({ ...base, today: "2026-10-16", warningDays: 0 })).toBeNull();
    expect(permitAlert({ ...base, today: "2026-10-19", warningDays: 0 })).toEqual(missing);
    expect(permitAlert({ ...base, days: [{ use: "delivery", day: null }], today: "2026-10-14" })).toBeNull();
    // The installation needs it too: the first day not covered is raised.
    expect(permitAlert({ ...base, days: [{ use: "delivery", day: "2026-10-12" }, { use: "installation", day: "2026-10-19" }], today: "2026-10-14",
      permits: [collected("a", "2026-10-01", "2026-10-15")] })).toEqual({ use: "installation", day: "2026-10-19", kind: "expiring", until: "2026-10-15", permitId: "a" });
  });

  it("puts Permit collection in the generic route after production and before delivery, unskippable, as a task for the installation team", () => {
    expect(DEFAULT_STAGES.map((stage) => stage.key).slice(4, 7)).toEqual(["production", "permit", "installation"]);
    expect(DEFAULT_STAGES.find((item) => item.key === "permit")!.checks.map((check) => check.kind)).toEqual(["permit_collected"]);
    expect(HARD_CHECKS).toContain("permit_collected");
    expect(TASK_CHECKS).toContain("permit_collected");
    const team = [{ membershipId: "pm", name: "PM", roles: ["project_manager"], lead: true }, { membershipId: "inst", name: "Installer", roles: ["installation_lead"], lead: false }];
    expect(stageTaskAssignee("permit_collected", "installation_lead", team)).toBe("inst");
    expect(stageTaskAssignee("permit_collected", "site_supervisor", team.slice(0, 1))).toBe("pm");
  });
});

describe("permit expiry reminders (PLM-136)", () => {
  const permit = (id: string, validTo: string, reminderDays: number | null = null, remindedAt: string | null = null) =>
    ({ id, status: "collected" as const, validTo, reminderDays, remindedAt });
  it("remind each permit its own days before it ends, else the firm's", () => {
    expect(permitReminderOn("2026-10-20", null, 7)).toBe("2026-10-13");
    expect(permitReminderOn("2026-10-20", 2, 7)).toBe("2026-10-18");
    expect(permitReminderOn("2026-10-20", 0, 7)).toBe("2026-10-20");
  });
  it("keep a long-lasting permit quiet until its day, then remind once", () => {
    expect(renewalsDue([permit("long", "2027-06-30")], "2026-10-06", 7)).toEqual([]);
    expect(renewalsDue([permit("short", "2026-10-10")], "2026-10-06", 7).map((item) => item.id)).toEqual(["short"]);
    expect(renewalsDue([permit("short", "2026-10-10", null, "2026-10-04T08:00:00Z")], "2026-10-06", 7)).toEqual([]);
    // Its own 2 days: not yet.
    expect(renewalsDue([permit("short", "2026-10-10", 2)], "2026-10-06", 7)).toEqual([]);
    // Ended already: nothing to renew from a reminder.
    expect(renewalsDue([permit("gone", "2026-10-05")], "2026-10-06", 7)).toEqual([]);
  });
  it("stay quiet once a later permit renewed it", () => {
    expect(renewalsDue([permit("old", "2026-10-10"), permit("new", "2026-12-31")], "2026-10-06", 7)).toEqual([]);
  });
});
