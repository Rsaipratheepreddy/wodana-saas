import { describe, it, expect } from "vitest";
import { applyControls, assertCloseout } from "./execution-controls";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import { validateCalendar, bookingSlots, slotsClash, calendarContainsSlot } from "./project-calendar";
import type { Task } from "./execution.types";
const actor: ExecutionActor = {
  id: "manager",
  name: "Manager",
  manage: true,
  review: true,
  buy: true,
  report: true,
  released: true,
  memberIds: ["manager", "foreman", "reviewer"],
  resourceIds: [],
  now: "2026-09-07T08:00:00Z",
  today: "2026-09-07",
};
const reviewer = { ...actor, id: "reviewer" };
function setup() {
  const d = emptyProject();
  d.phase = "active";
  d.scope = {
    quoteId: "q",
    quoteNumber: 1,
    currency: "AED",
    value: 1000,
    lines: [],
  };
  d.tasks = [
    {
      id: "factory",
      title: "Fabrication",
      area: "Bedroom",
      location: "factory",
      status: "completed",
      quantity: 4,
      approved: 4,
      unit: "nos",
      ownerId: "foreman",
      assigneeIds: [],
      parentId: "",
    } as Task,
    {
      id: "site",
      title: "Install",
      area: "Bedroom",
      location: "site",
      status: "completed",
      quantity: 4,
      approved: 4,
      unit: "nos",
      ownerId: "foreman",
      assigneeIds: [],
      parentId: "",
      predecessors: ["factory"],
    } as Task,
  ];
  d.documents = [
    {
      id: "doc",
      title: "Drawing",
      kind: "drawing",
      status: "approved",
      revision: "R1",
      url: "",
      note: "DR-1",
      replaces: "",
      published: false,
    },
  ];
  // Approved output is the source of truth for factory completion. Keeping
  // this in the fixture means unrelated actions (such as closing a delivery
  // snag) cannot accidentally erase the factory's verified output.
  d.reports = [
    {
      id: "factory-output",
      date: "2026-09-07",
      shift: "Day",
      location: "factory",
      authorId: "foreman",
      author: "Foreman",
      status: "approved",
      entries: [{ taskId: "factory", quantity: 4 }],
      hours: 8,
      people: 1,
      materials: "",
      issues: "",
      tomorrow: "",
      evidence: "Factory output record",
      note: "",
    },
  ];
  return d;
}
describe("delivery closeout controls", () => {
  it("lets the assigned site owner receive independently but denies unrelated staff", () => {
    const d = setup();
    d.tasks[1].status = "planned";
    applyControls(d, "dispatch", { record: {
      id: "assigned-delivery", title: "Wardrobes", taskId: "factory",
      receivingTaskId: "site", quantity: 4, destination: "Site", dueDate: "2026-09-07",
    } }, actor);
    applyControls(d, "dispatch_status", { id: "assigned-delivery", status: "ready" }, reviewer);
    applyControls(d, "dispatch_status", {
      id: "assigned-delivery", status: "dispatched", carrier: "Carrier", reference: "DN-2",
    }, actor);
    expect(() => applyControls(d, "dispatch_status", {
      id: "assigned-delivery", status: "received", accepted: 4, rejected: 0, evidence: "GRN-2",
    }, { ...actor, id: "unrelated", manage: false, review: false })).toThrow(/assigned/);
    expect(() => applyControls(d, "dispatch_status", {
      id: "assigned-delivery", status: "received", accepted: 4, rejected: 0, evidence: "GRN-2",
    }, { ...actor, id: "foreman", manage: false, review: false })).not.toThrow();
  });
  it("prevents excess dispatch and tracks rejection without accepting it as delivered", () => {
    const d = setup();
    d.tasks[1].status = "planned";
    applyControls(
      d,
      "dispatch",
      {
        record: {
          id: "d1",
          title: "Wardrobes",
          taskId: "factory",
          receivingTaskId: "site",
          quantity: 4,
          destination: "Site",
          dueDate: "2026-09-07",
        },
      },
      actor,
    );
    expect(() => applyControls(d, "dispatch_status", { id: "d1", status: "ready" }, actor))
      .toThrow(/Another reviewer/);
    applyControls(
      d,
      "dispatch_status",
      { id: "d1", status: "ready" },
      reviewer,
    );
    applyControls(
      d,
      "dispatch",
      {
        record: {
          id: "d2",
          title: "Duplicate",
          taskId: "factory",
          receivingTaskId: "site",
          quantity: 1,
          destination: "Site",
          dueDate: "2026-09-07",
        },
      },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "dispatch_status",
        { id: "d2", status: "ready" },
        reviewer,
      ),
    ).toThrow(/remaining/);
    applyControls(
      d,
      "dispatch_status",
      {
        id: "d1",
        status: "dispatched",
        carrier: "Demo courier",
        reference: "DN-1",
      },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "dispatch_status",
        {
          id: "d1",
          status: "received",
          accepted: 3,
          rejected: 1,
          evidence: "GRN-1",
        },
        actor,
      ),
    ).toThrow(/Another/);
    applyControls(
      d,
      "dispatch_status",
      {
        id: "d1",
        status: "received",
        accepted: 3,
        rejected: 1,
        evidence: "GRN-1",
      },
      reviewer,
    );
    expect(d.dispatches![0].accepted).toBe(3);
    expect(d.snags[0].severity).toBe("major");
    expect(d.dispatches![0].rejectionSnagId).toBe(d.snags[0].id);
    expect(() => applyControls(d, "dispatch_status", { id: "d2", status: "ready" }, reviewer))
      .toThrow(/Correct and independently close/);
    applyExecution(d, "snag_status", { id: d.snags[0].id, status: "ready", note: "Refinished and photographed" }, actor);
    expect(() => applyExecution(d, "snag_status", { id: d.snags[0].id, status: "closed", note: "Self-verified" }, actor))
      .toThrow(/Another reviewer/);
    applyExecution(d, "snag_status", { id: d.snags[0].id, status: "closed", note: "Replacement finish verified" }, reviewer);
    expect(() => applyControls(d, "dispatch_status", { id: "d2", status: "ready" }, reviewer)).toThrow(/remaining approved output/);
    applyControls(d, "dispatch_return", {id:"d1",quantity:1,evidence:"Returned to factory after correction"},actor);
    expect(() => applyControls(d, "dispatch_status", { id: "d2", status: "ready" }, reviewer))
      .not.toThrow();
    expect(() =>
      applyControls(
        d,
        "dispatch_status",
        {
          id: "d1",
          status: "received",
          accepted: 4,
          rejected: 0,
          evidence: "Replay",
        },
        reviewer,
      ),
    ).toThrow(/dispatched/);
  });
  it("requires independent passing commissioning and preserves failed checks for correction", () => {
    const d = setup();
    applyControls(
      d,
      "commissioning",
      {
        record: {
          id: "c",
          title: "Water pressure",
          taskId: "site",
          system: "Water",
          ownerId: "manager",
          dueDate: "2026-09-07",
          evidence: "TEST-1",
          readings: [
            { name: "Pressure", value: 1, unit: "bar", min: 2, max: 4 },
          ],
        },
      },
      actor,
    );
    applyControls(
      d,
      "commissioning_status",
      { id: "c", status: "submitted" },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "commissioning_status",
        { id: "c", status: "passed", note: "Review" },
        reviewer,
      ),
    ).toThrow(/Out-of-range/);
    expect(() => assertCloseout(d, ["site"])).toThrow(/commissioning/);
    applyControls(
      d,
      "commissioning_status",
      { id: "c", status: "returned", note: "Retest at specified pressure" },
      reviewer,
    );
    applyControls(
      d,
      "commissioning",
      {
        record: {
          ...d.commissioning![0],
          readings: [
            { name: "Pressure", value: 3, unit: "bar", min: 2, max: 4 },
          ],
        },
      },
      actor,
    );
    applyControls(
      d,
      "commissioning_status",
      { id: "c", status: "submitted" },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "commissioning_status",
        { id: "c", status: "passed", note: "Self review" },
        actor,
      ),
    ).toThrow(/Another/);
    applyControls(
      d,
      "commissioning_status",
      { id: "c", status: "passed", note: "Witnessed TEST-2" },
      reviewer,
    );
    expect(d.commissioning![0].revisions?.[0].readings[0].value).toBe(1);
    expect(() => assertCloseout(d, ["site"])).not.toThrow();
  });
  it("fixes transmitted revisions and requires recipient acknowledgement evidence", () => {
    const d = setup();
    applyControls(
      d,
      "transmittal",
      {
        record: {
          id: "tr",
          title: "Issued drawings",
          recipient: "Site manager",
          dueDate: "2026-09-07",
          documentIds: ["doc"],
          purpose: "For construction",
        },
      },
      actor,
    );
    applyControls(
      d,
      "transmittal_status",
      { id: "tr", status: "issued", evidence: "Shared via controlled folder" },
      actor,
    );
    expect(() =>
      applyControls(d, "transmittal", { record: { id: "tr" } }, actor),
    ).toThrow(/draft/);
    expect(() =>
      applyControls(
        d,
        "transmittal_status",
        { id: "tr", status: "acknowledged" },
        actor,
      ),
    ).toThrow(/required/);
    applyControls(
      d,
      "transmittal_status",
      { id: "tr", status: "acknowledged", evidence: "Recipient receipt" },
      actor,
    );
    expect(d.transmittals![0].documents[0].revision).toBe("R1");
  });
  it("requires reviewed technical responses without silently unblocking work", () => {
    const d = setup();
    d.tasks[1].status = "planned";
    applyControls(
      d,
      "technical_query",
      {
        record: {
          id: "rfi",
          title: "Opening dimension",
          taskIds: ["site"],
          ownerId: "manager",
          dueDate: "2026-09-07",
          question: "Confirm opening.",
        },
      },
      actor,
    );
    expect(d.tasks[1].status).toBe("blocked");
    applyControls(
      d,
      "technical_query_status",
      {
        id: "rfi",
        status: "answered",
        response: "Use approved R1",
        documentIds: ["doc"],
      },
      actor,
    );
    expect(() => assertCloseout(d, ["site"])).toThrow(/technical/);
    applyControls(
      d,
      "technical_query_status",
      { id: "rfi", status: "closed", note: "Reviewed against drawing" },
      reviewer,
    );
    expect(d.tasks[1].status).toBe("blocked");
  });
  it("keeps retention due-date release and accounting evidence separate", () => {
    const d = setup();
    applyControls(
      d,
      "retention",
      {
        record: {
          id: "r",
          title: "Defects retention",
          amount: 100,
          dueDate: "2027-09-07",
          condition: "Defects period completed",
        },
      },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "retention_status",
        { id: "r", status: "released", evidence: "Early" },
        actor,
      ),
    ).toThrow(/not yet due/);
    applyControls(
      d,
      "retention",
      { record: { ...d.retentions![0], dueDate: "2026-09-07" } },
      actor,
    );
    applyControls(
      d,
      "retention_status",
      { id: "r", status: "released", evidence: "Defects cleared" },
      actor,
    );
    expect(() =>
      applyControls(
        d,
        "retention_status",
        { id: "r", status: "verified", reference: "" },
        reviewer,
      ),
    ).toThrow(/required/);
    applyControls(
      d,
      "retention_status",
      {
        id: "r",
        status: "verified",
        reference: "QB-REC-1",
        evidence: "Accounting record reconciled",
      },
      reviewer,
    );
    expect(d.retentions![0].status).toBe("verified");
  });
  it("cannot return more than received or reserved stock, and cannot invent supplier credit", () => {
    const d = setup();
    d.materials = [
      {
        id: "m",
        title: "Boards",
        specification: "18mm",
        catalogId: "",
        catalogVersion: 0,
        unit: "sheet",
        required: 5,
        supply: "company",
        taskId: "factory",
        needBy: "2026-09-07",
        reservations: [],
        movements: [
          {
            id: "m1",
            kind: "receive",
            quantity: 5,
            reference: "GRN",
            at: actor.now,
          },
        ],
      },
    ];
    d.orders = [
      {
        id: "po",
        number: "PO-1",
        title: "Boards",
        vendor: "Vendor",
        vendorContact: "",
        kind: "material",
        materialId: "m",
        taskId: "factory",
        quantity: 5,
        unit: "sheet",
        unitCost: 20,
        currency: "AED",
        promisedDate: "2026-09-07",
        status: "closed",
        acknowledgement: "ACK",
        receipts: [
          { id: "gr", accepted: 5, rejected: 0, evidence: "GR", at: actor.now },
        ],
      },
    ];
    applyControls(
      d,
      "supplier_return",
      {
        record: {
          id: "r",
          orderId: "po",
          quantity: 2,
          creditAmount: 40,
          reason: "Damaged after acceptance",
        },
      },
      actor,
    );
    d.materials[0].reservations = [
      { taskId: "factory", quantity: 4, reference: "RES", at: actor.now },
    ];
    expect(() =>
      applyControls(
        d,
        "supplier_return_status",
        { id: "r", status: "approved" },
        reviewer,
      ),
    ).toThrow(/stock/);
    d.materials[0].reservations = [];
    applyControls(
      d,
      "supplier_return_status",
      { id: "r", status: "approved" },
      reviewer,
    );
    applyControls(
      d,
      "supplier_return_status",
      {
        id: "r",
        status: "dispatched",
        reference: "RN1",
        evidence: "Collected",
      },
      actor,
    );
    expect(d.materials[0].movements[1].kind).toBe("supplier_return");
    expect(() =>
      applyControls(
        d,
        "supplier_return_status",
        {
          id: "r",
          status: "credited",
          reference: "CN1",
          creditAmount: 80,
          evidence: "Books",
        },
        reviewer,
      ),
    ).toThrow(/match/);
    applyControls(
      d,
      "supplier_return_status",
      {
        id: "r",
        status: "credited",
        reference: "CN1",
        creditAmount: 40,
        evidence: "Books",
      },
      reviewer,
    );
    expect(d.supplierReturns![0].status).toBe("credited");
  });
});
describe("work calendars and capacity slots", () => {
  const cal = validateCalendar({
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "17:00",
    holidays: [{ date: "2026-09-08", reason: "Site closure" }],
  });
  it("excludes nonworking days and explicit exceptions", () => {
    expect(
      bookingSlots("2026-09-07", "2026-09-13", cal).map((x) => x.date),
    ).toEqual(["2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11"]);
  });
  it("allows successive same-day shifts but blocks overlapping member or crew time", () => {
    const morning = bookingSlots(
      "2026-09-07",
      "2026-09-07",
      cal,
      "08:00",
      "12:00",
    );
    expect(
      slotsClash(
        morning,
        bookingSlots("2026-09-07", "2026-09-07", cal, "12:00", "17:00"),
      ),
    ).toBe(false);
    expect(
      slotsClash(
        morning,
        bookingSlots("2026-09-07", "2026-09-07", cal, "11:00", "17:00"),
      ),
    ).toBe(true);
    expect(() =>
      bookingSlots("2026-09-07", "2026-09-07", cal, "07:00", "12:00"),
    ).toThrow(/within/);
  });
  it("rejects empty work periods and malformed dates", () => {
    expect(() => bookingSlots("2026-09-12", "2026-09-13", cal)).toThrow(
      /no working/,
    );
    expect(() =>
      validateCalendar({
        ...cal,
        holidays: [{ date: "2026-02-30", reason: "Invalid" }],
      }),
    ).toThrow(/valid/);
  });
  it("checks ordinary and overnight slots against the same calendar boundary", () => {
    expect(calendarContainsSlot(cal, { date: "2026-09-07", startTime: "08:00", endTime: "12:00" })).toBe(true);
    expect(calendarContainsSlot(cal, { date: "2026-09-07", startTime: "07:00", endTime: "12:00" })).toBe(false);
    const night = validateCalendar({ weekdays: [1], startTime: "20:00", endTime: "06:00", holidays: [] });
    expect(calendarContainsSlot(night, { date: "2026-09-07", endDate: "2026-09-08", startTime: "22:00", endTime: "02:00" })).toBe(true);
    expect(slotsClash(
      [{ date: "2026-09-07", endDate: "2026-09-08", startTime: "22:00", endTime: "02:00" }],
      [{ date: "2026-09-08", startTime: "01:00", endTime: "03:00" }],
    )).toBe(true);
  });
});
