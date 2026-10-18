import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectWorkflowTemplate } from "../projects/project-workflow";

type Profile = { kind: string; code: string; version: number; configuration: Record<string, unknown>; selectable: boolean };

/** Reads the seeded reference rows exactly as the v2 baseline inserts them. */
const profiles: Profile[] = [
  ...readFileSync(resolve(__dirname, "../../drizzle/0000_v2_baseline.sql"), "utf8").matchAll(
    /^INSERT INTO public\.tenant_setup_profiles VALUES \('([^']+)', '([^']+)', (\d+), '(.*)', '[^']+', (true|false)\);$/gm,
  ),
].map((match) => ({
  kind: match[1],
  code: match[2],
  version: Number(match[3]),
  configuration: JSON.parse(match[4].replace(/''/g, "'")) as Record<string, unknown>,
  selectable: match[5] === "true",
}));

const selectable = (kind: string) => profiles.filter((profile) => profile.kind === kind && profile.selectable);

describe("region and firm-kit setup profiles", () => {
  it("publishes independent UAE and India v2 regions without claiming regulatory approval", () => {
    const regions = selectable("region");
    expect(regions.map(({ code, version }) => `${code}:${version}`)).toEqual(["AE:2", "IN:2"]);
    for (const { configuration } of regions) {
      expect(configuration).toMatchObject({
        regulatoryStatus: "requires_validation",
        taxPolicy: { version: 1, status: "requires_validation", rates: [] },
        privacyPolicy: { version: 1, status: "requires_validation", noticeTemplate: null },
        providerPolicy: { version: 1, defaults: {}, connectionsRequired: true },
      });
      expect(configuration.calendarPolicy).toBeDefined();
      expect(JSON.stringify(configuration)).not.toMatch(/taxRate|approvedTax|compliant/i);
    }
  });

  it("publishes every firm kit with explicit applicable Job sections", () => {
    const kits = selectable("firm_kit");
    expect(kits.map((kit) => kit.code).sort()).toEqual([
      "blank", "design_build", "fitout_contractor", "interior_studio", "joinery_furniture",
    ]);
    expect(kits.find((kit) => kit.code === "design_build")?.version).toBe(3);
    for (const kit of kits) {
      expect(kit.configuration.applicableJobSections).toEqual(expect.arrayContaining([
        "overview", "scope", "quote", "handover", "files", "timeline",
      ]));
      if (kit.code !== "design_build") {
        expect(parseProjectWorkflowTemplate(kit.configuration.projectWorkflow)).toMatchObject({
          version: 1,
          isDefault: true,
        });
      }
    }
  });

  it("does not invent design or factory work in the neutral blank kit", () => {
    const blank = selectable("firm_kit").find((kit) => kit.code === "blank")!;
    expect(blank.configuration.applicableJobSections).not.toEqual(expect.arrayContaining(["design"]));
    const workflow = blank.configuration.projectWorkflow as { stages: { key: string; visibleName: string }[] };
    expect(workflow.stages.map((stage) => `${stage.key}:${stage.visibleName}`).join(" ")).not.toMatch(/factory|manufactur|survey/i);
  });
});
