import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// §0.3 P10: a job's next step is decided in one place, its journey on the server, and every screen reads it from there
// (useJobNow / JobNowBar). Lists and record pages must not work it out again on their own.
const sources = execSync("git ls-files 'lib/**/*.ts' 'lib/**/*.tsx' 'components/**/*.ts' 'components/**/*.tsx' 'app/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter((file) => file && !/\.(test|stories)\.tsx?$/.test(file) && existsSync(file));
const read = (file: string) => readFileSync(file, "utf8");

describe("one source for what's next (§0.3 P10)", () => {
  it("has no second next-step calculator for a case or a list", () => {
    const offenders = sources.filter((file) => /function (caseNextStep|caseListStep|nextStepPhrase)\b/.test(read(file)));
    expect(offenders, "read the job's step now with useJobNow / JobNowBar").toEqual([]);
  });

  it("keeps the opportunity's own checklist (the flow gate's Win steps) on the opportunity page only", () => {
    const callers = sources.filter((file) => /\bnowPlan\(/.test(read(file)) && file !== "lib/crm/now-step.ts");
    expect(callers).toEqual(["components/crm/crm-record-workbench.tsx"]);
  });

  it("has the lists read the journey", () => {
    for (const file of ["components/crm/crm-opportunities.tsx", "components/pre-project/planning-list.tsx", "components/project-core/projects-page.tsx"])
      expect(read(file), file).toMatch(/useJobNow\(/);
  });
});
