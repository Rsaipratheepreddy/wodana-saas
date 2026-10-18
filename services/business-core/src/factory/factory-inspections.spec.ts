import { describe, expect, it } from "vitest";
import { workOrderNext } from "./factory";
import {
  DEFAULT_INSPECTION_STAGES, inspectionSettings, normaliseInspectionStages, parseInspectionSettings, parseInspectionStages, parseSnagLines, stageName, stagesFor, stageState,
  type InspectionSettings,
} from "./factory-inspections";

const settings = (patch: Partial<InspectionSettings> = {}): InspectionSettings => ({
  enabled: true, stages: DEFAULT_INSPECTION_STAGES, workPackageIds: [], inspectorRole: "designer", directorRole: null, directorPackages: [], days: 2, ...patch,
});
const choices = { roles: ["designer", "project_manager", "creative_director"], workPackages: ["wp-joinery", "wp-furniture"], designPackages: ["creative_director", "bespoke"] };

describe("design inspections at the factory (PLM-150)", () => {
  it("keeps one or two stages, the last after finishing, in their order", () => {
    expect(normaliseInspectionStages(null)).toEqual(DEFAULT_INSPECTION_STAGES);
    expect(normaliseInspectionStages([{ kind: "final", label: " Finished " }, { kind: "raw", label: "Raw" }, { kind: "raw" }, { kind: "polish" }]))
      .toEqual([{ kind: "raw", label: "Raw" }, { kind: "final", label: "Finished" }]);
    // Inspection 1 skipped by configuration: only the inspection after finishing.
    expect(normaliseInspectionStages([{ kind: "final", label: "" }])).toEqual([{ kind: "final", label: "" }]);
    // Never without the inspection before dispatch.
    expect(normaliseInspectionStages([{ kind: "raw", label: "" }])).toEqual(DEFAULT_INSPECTION_STAGES);
    expect(parseInspectionStages([{ kind: "final", label: "Before dispatch" }])).toEqual([{ kind: "final", label: "Before dispatch" }]);
    expect(() => parseInspectionStages([])).toThrow("one or two");
    expect(() => parseInspectionStages([{ kind: "final" }, { kind: "raw" }])).toThrow("after finishing");
    expect(() => parseInspectionStages([{ kind: "final" }, { kind: "final" }])).toThrow("once");
    expect(() => parseInspectionStages([{ kind: "raw", label: "x".repeat(61) }, { kind: "final" }])).toThrow("60");
  });

  it("validates its settings against the firm's roles, trades and design packages", () => {
    const current = inspectionSettings({ inspectionsEnabled: false, inspectionStages: null, inspectionWorkPackages: [], inspectorRole: "designer", directorRole: null,
      directorPackages: [], inspectionDays: 2 });
    expect(current).toEqual(settings({ enabled: false }));
    const next = parseInspectionSettings({ inspectionsEnabled: true, inspectionWorkPackages: ["wp-joinery", "wp-joinery"], directorRole: "creative_director",
      directorPackages: ["creative_director"], inspectionDays: 3 }, current, choices);
    expect(next).toEqual(settings({ workPackageIds: ["wp-joinery"], directorRole: "creative_director", directorPackages: ["creative_director"], days: 3 }));
    // Left out: kept.
    expect(parseInspectionSettings({}, next, choices)).toEqual(next);
    expect(parseInspectionSettings({ directorRole: null }, next, choices).directorRole).toBeNull();
    expect(() => parseInspectionSettings({ inspectorRole: "lead_designer" }, current, choices)).toThrow("project role");
    expect(() => parseInspectionSettings({ inspectionWorkPackages: ["wp-other"] }, current, choices)).toThrow("trades");
    expect(() => parseInspectionSettings({ directorPackages: ["concept"] }, current, choices)).toThrow("design packages");
    expect(() => parseInspectionSettings({ inspectionDays: 0 }, current, choices)).toThrow("1 to 30");
  });

  it("asks it of made items of the listed trades only (an item without a trade is inspected), and nothing while it's off", () => {
    expect(stagesFor(settings(), null)).toEqual(["raw", "final"]);
    expect(stagesFor(settings({ enabled: false }), "wp-joinery")).toEqual([]);
    expect(stagesFor(settings({ workPackageIds: ["wp-joinery"] }), "wp-joinery")).toEqual(["raw", "final"]);
    expect(stagesFor(settings({ workPackageIds: ["wp-joinery"] }), "wp-glass")).toEqual([]);
    expect(stagesFor(settings({ workPackageIds: ["wp-joinery"] }), null)).toEqual(["raw", "final"]);
    expect(stagesFor(settings({ stages: [{ kind: "final", label: "" }] }), null)).toEqual(["final"]);
  });

  it("names a stage in the firm's words, else Inspection 1 and 2", () => {
    expect(stageName("raw", DEFAULT_INSPECTION_STAGES)).toBe("Inspection 1");
    expect(stageName("final", DEFAULT_INSPECTION_STAGES)).toBe("Inspection 2");
    expect(stageName("final", [{ kind: "final", label: "" }])).toBe("the design inspection");
    expect(stageName("raw", [{ kind: "raw", label: "Before veneer" }, { kind: "final", label: "" }])).toBe("Before veneer");
  });

  it("reads where a stage stands from its rounds: failed twice, fixed, passed, and made again after site", () => {
    expect(stageState(false, [], true)).toBe("not_needed");
    expect(stageState(true, [], true)).toBe("to_request");
    expect(stageState(true, [{ status: "due", openSnags: 0, reworkedAfter: false }], true)).toBe("due");
    const failed = { status: "failed" as const, openSnags: 2, reworkedAfter: false };
    expect(stageState(true, [failed], true)).toBe("snags");
    // Failed twice: the second round's snags are what's open now.
    expect(stageState(true, [{ ...failed, openSnags: 0 }, failed], true)).toBe("snags");
    expect(stageState(true, [{ ...failed, openSnags: 0 }], true)).toBe("to_request");
    expect(stageState(true, [failed, { status: "passed", openSnags: 0, reworkedAfter: false }], true)).toBe("passed");
    // Rejected at site and made again: the last inspection is due again; the first stays passed.
    expect(stageState(true, [{ status: "passed", openSnags: 0, reworkedAfter: true }], true)).toBe("to_request");
    expect(stageState(true, [{ status: "passed", openSnags: 0, reworkedAfter: true }], false)).toBe("passed");
    expect(stageState(true, [{ status: "cancelled", openSnags: 0, reworkedAfter: false }], true)).toBe("to_request");
  });

  it("takes 1 to 30 named snag lines, major unless said", () => {
    expect(parseSnagLines([{ title: " Veneer lifting on the left door " }, { title: "Handle loose", severity: "minor" }]))
      .toEqual([{ title: "Veneer lifting on the left door", severity: "major" }, { title: "Handle loose", severity: "minor" }]);
    expect(() => parseSnagLines([])).toThrow("at least one");
    expect(() => parseSnagLines([{ title: "" }])).toThrow("Name each snag");
    expect(() => parseSnagLines([{ title: "Scratch", severity: "cosmetic" }])).toThrow("serious");
    expect(() => parseSnagLines(Array.from({ length: 31 }, () => ({ title: "x" })))).toThrow("30");
  });

  it("puts the inspection in the work order's one next step", () => {
    const rights = { blocked: false, atFactory: "0", requireCheck: true, canManage: false, canReport: true, canApprove: false, canSend: false };
    const making = { status: "in_production" as const, pending: "0", toCheck: "0", left: "1", holdKind: null };
    expect(workOrderNext(making, { ...rights, inspection: { raw: "to_request", final: "to_request" } })).toEqual({ step: "request_inspection", mine: true });
    expect(workOrderNext(making, { ...rights, inspection: { raw: "due", final: "to_request" } })).toEqual({ step: "inspection", mine: false });
    expect(workOrderNext(making, { ...rights, inspection: { raw: "snags", final: "to_request" } })).toEqual({ step: "snags", mine: true });
    expect(workOrderNext(making, { ...rights, inspection: { raw: "passed", final: "to_request" } })).toEqual({ step: "report", mine: true });
    // Inspection 1 skipped by configuration, or a work order from before inspections: as before.
    expect(workOrderNext(making, { ...rights, inspection: { raw: "not_needed", final: "to_request" } })).toEqual({ step: "report", mine: true });
    expect(workOrderNext(making, rights)).toEqual({ step: "report", mine: true });
    const ready = { status: "ready" as const, pending: "0", toCheck: "0", left: "0", holdKind: null };
    const sender = { ...rights, atFactory: "1", canSend: true };
    expect(workOrderNext(ready, { ...sender, inspection: { raw: "passed", final: "due" } })).toEqual({ step: "inspection", mine: false });
    expect(workOrderNext(ready, { ...sender, inspection: { raw: "passed", final: "passed" } })).toEqual({ step: "send", mine: true });
    expect(workOrderNext(ready, sender)).toEqual({ step: "send", mine: true });
  });
});
