import { describe, expect, it } from "vitest";
import { checkPasses, DEFAULT_STAGES, TASK_CHECKS } from "./project-checks";
import { deliveryStatus, installationDates, installationRoles, installationStatus } from "./project-installation";
import { DEFAULT_KEEP_INFORMED, normaliseKeepInformed, parseKeepInformed } from "./project-keep-informed";
import { stageTaskAssignee, stageTaskLinks } from "./project-stage-tasks";

const facts = { deliveryOn: null as string | null, today: "2026-10-10", arrived: false, outstanding: true, inTransit: false };

describe("delivery and installation (PLM-069)", () => {
  it("reads the delivery status from what reached the site and what's still to come", () => {
    expect(deliveryStatus(facts)).toBe("not_booked");
    expect(deliveryStatus({ ...facts, deliveryOn: "2026-10-12" })).toBe("booked");
    expect(deliveryStatus({ ...facts, inTransit: true })).toBe("booked");
    expect(deliveryStatus({ ...facts, arrived: true })).toBe("part_delivered");
    expect(deliveryStatus({ ...facts, arrived: true, outstanding: false })).toBe("delivered");
    // Goods not kept as stock: delivered once nothing is still to come and the booked day has come.
    expect(deliveryStatus({ ...facts, outstanding: false, deliveryOn: "2026-10-10" })).toBe("delivered");
    expect(deliveryStatus({ ...facts, outstanding: false, deliveryOn: "2026-10-11" })).toBe("booked");
  });

  it("reads the installation status from the site work", () => {
    expect(installationStatus({ siteStartedOn: null, siteFinishedOn: null, installed: false })).toBe("not_started");
    expect(installationStatus({ siteStartedOn: null, siteFinishedOn: null, installed: true })).toBe("in_progress");
    expect(installationStatus({ siteStartedOn: "2026-10-01", siteFinishedOn: null, installed: false })).toBe("in_progress");
    expect(installationStatus({ siteStartedOn: "2026-10-01", siteFinishedOn: "2026-10-09", installed: true })).toBe("done");
  });

  it("needs the installation day, with delivery no later than it", () => {
    expect(installationDates({ deliveryOn: null, installationOn: null })).toBe("Choose the installation day.");
    expect(installationDates({ deliveryOn: "2026-10-12", installationOn: "2026-10-11" })).toBe("Delivery can't be after the installation day.");
    expect(installationDates({ deliveryOn: "2026-10-11", installationOn: "2026-10-11" })).toBeNull();
  });

  it("names the installation team after the route: the owner of a stage with a delivery or installation check", () => {
    const check = (kind: string) => ({ key: kind, kind }) as never;
    expect(installationRoles([{ status: "upcoming", ownerRole: "factory_lead", checks: [check("installation_scheduled")] },
      { status: "upcoming", ownerRole: "project_manager", checks: [check("snags_closed")] }])).toEqual(["factory_lead"]);
    // A skipped stage doesn't count; with none, the default installation lead.
    expect(installationRoles([{ status: "skipped", ownerRole: "factory_lead", checks: [check("goods_delivered")] }])).toEqual(["installation_lead"]);
  });

  it("checks the stage from the records and opens the scheduling task for the installation team", () => {
    const base = { filledRoles: new Set<string>(), confirmed: new Set<string>(), productionPaid: false, materialsSignedOff: false, everythingOrdered: false, everythingMade: false,
      openSnags: 0, openCriticalSnags: 0, handedOver: false };
    const installation = { scheduled: true, delivered: false, installed: false };
    expect(checkPasses({ key: "a", kind: "installation_scheduled" }, { ...base, installation })).toBe(true);
    expect(checkPasses({ key: "b", kind: "goods_delivered" }, { ...base, installation })).toBe(false);
    expect(checkPasses({ key: "c", kind: "installation_done" }, base)).toBe(false);
    expect(TASK_CHECKS).toContain("installation_scheduled");
    expect(DEFAULT_STAGES.find((stage) => stage.key === "installation")!.checks.map((item) => item.kind)).toEqual(["installation_scheduled", "goods_delivered", "installation_done"]);
    const team = [{ membershipId: "pm", name: "P", roles: ["project_manager"], lead: true }, { membershipId: "fx", name: "F", roles: ["factory_lead"], lead: false }];
    expect(stageTaskAssignee("installation_scheduled", "factory_lead", team)).toBe("fx");
    expect(stageTaskAssignee("installation_scheduled", "installation_lead", team)).toBe("pm");
    expect(stageTaskLinks("installation_scheduled", { id: "p1", caseId: "c1" })).toEqual([{ key: "installation", href: "/workspace/projects/p1" }]);
  });
});

describe("keep informed (PLM-055)", () => {
  const roles = [{ key: "project_manager", label: "Project manager" }, { key: "designer", label: "Interior Designer" }, { key: "account_manager", label: "Account manager" }];

  it("tells the designer at each key moment by default, and drops roles that no longer exist", () => {
    expect(normaliseKeepInformed(null, roles)).toEqual(DEFAULT_KEEP_INFORMED);
    expect(normaliseKeepInformed({ drawings_started: ["designer", "gone"], production_started: [] }, roles))
      .toEqual({ drawings_started: ["designer"], production_started: [], installation_scheduled: [] });
  });

  it("accepts only the firm's roles for the known moments", () => {
    expect(parseKeepInformed({ installation_scheduled: ["designer", "account_manager", "designer"] }, roles))
      .toEqual({ drawings_started: [], production_started: [], installation_scheduled: ["designer", "account_manager"] });
    expect(() => parseKeepInformed({ handover: ["designer"] }, roles)).toThrow("Unknown moment");
    expect(() => parseKeepInformed({ drawings_started: ["visualiser"] }, roles)).toThrow("project roles");
    expect(() => parseKeepInformed([], roles)).toThrow("kept informed");
  });
});
