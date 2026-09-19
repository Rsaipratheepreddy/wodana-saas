import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectWorkflowTemplate } from "../projects/project-workflow";

const sql = readFileSync(
  resolve(__dirname, "../../drizzle/0099_region_firm_kit_profiles.sql"),
  "utf8",
);

function firmKits() {
  const inserted = [...sql.matchAll(/\('firm_kit',\s*'([^']+)',\s*2,\s*'(\{[\s\S]*?\})'::jsonb,\s*true\)/g)]
    .map((match) => ({ code: match[1], version: 2, configuration: JSON.parse(match[2]) as Record<string, unknown> }));
  const designSections = sql.match(/configuration \|\| '(\{[\s\S]*?applicableJobSections[\s\S]*?\})'::jsonb,[\s\S]*?FROM tenant_setup_profiles[\s\S]*?code = 'design_build' AND version = 2/);
  if (!designSections) throw new Error("Design & build v3 configuration not found");
  return [
    { code: "design_build", version: 3, configuration: JSON.parse(designSections[1]) as Record<string, unknown> },
    ...inserted,
  ];
}

describe("region and firm-kit setup profiles", () => {
  it("publishes independent UAE and India v2 regions without claiming regulatory approval", () => {
    expect(sql).toContain("WHERE kind = 'region' AND version = 1");
    expect(sql).toContain('"regulatoryStatus":"requires_validation"');
    expect(sql).toContain('"calendarPolicy"');
    expect(sql).toContain('"taxPolicy":{"version":1,"status":"requires_validation","rates":[]}');
    expect(sql).toContain('"privacyPolicy":{"version":1,"status":"requires_validation","noticeTemplate":null}');
    expect(sql).toContain('"providerPolicy":{"version":1,"defaults":{},"connectionsRequired":true}');
    expect(sql).not.toMatch(/taxRate|approvedTax|compliant/i);
  });

  it("publishes every firm kit with explicit applicable Job sections", () => {
    const kits = firmKits();
    expect(kits.map((kit) => kit.code)).toEqual([
      "design_build",
      "interior_studio",
      "fitout_contractor",
      "joinery_furniture",
      "blank",
    ]);
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
    const blank = firmKits().find((kit) => kit.code === "blank")!;
    expect(blank.configuration.applicableJobSections).not.toEqual(expect.arrayContaining(["design"]));
    const workflow = blank.configuration.projectWorkflow as { stages: { key: string; visibleName: string }[] };
    expect(workflow.stages.map((stage) => `${stage.key}:${stage.visibleName}`).join(" ")).not.toMatch(/factory|manufactur|survey/i);
  });
});
