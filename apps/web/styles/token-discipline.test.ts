import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { EXCLUDED, snapCss } from "../scripts/snap-to-tokens.mjs";

// Component CSS uses the scale: spacing on the 4px grid (φ tokens for page rhythm), the type scale
// and the radius scale, so tenant co-branding and density change everything from tokens.css.
const files = execSync("git ls-files 'app/**/*.css' 'components/**/*.css' 'design-system/**/*.css'", { encoding: "utf8" })
  // A file deleted in the working tree (not yet staged) has nothing left to check.
  .split("\n").filter((file) => file && !(EXCLUDED as RegExp).test(file) && existsSync(file));

// Raw hex colours bypass themes (dark mode, tenant brand). Lower this number as modules are rebuilt; never raise it.
const RAW_HEX_CEILING = 386;

// Native checkboxes and radios miss the shared box, hit area, focus ring and indeterminate state:
// every choice is a Checkbox, RadioSet or Switch.
const views = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx' 'design-system/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter((file) => file && !/\.(test|stories)\.tsx$/.test(file) && existsSync(file));

// Lists people work in use DataGrid / RecordTable and documents use DocumentTable. The quotation document
// and builder keep their own tables until the quotation rebuild; nothing else adds one.
const RAW_TABLE_ALLOWED = new Set([
  "components/commercial/quotation-document.tsx",
  "components/commercial/quotation-document-page.tsx",
  "components/commercial/quotation-linked-block.tsx",
  "components/commercial/quotation-scope-grid.tsx",
]);

describe("design token discipline", () => {
  it("uses spacing, type and radius tokens instead of raw values", () => {
    const offenders = files.filter((file) => {
      const css = readFileSync(file, "utf8");
      return (snapCss as (css: string) => string)(css) !== css;
    });
    expect(offenders, "run: node scripts/snap-to-tokens.mjs").toEqual([]);
  });

  it("does not add raw hex colours", () => {
    const count = files.reduce((sum, file) => sum + (readFileSync(file, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0), 0);
    expect(count).toBeLessThanOrEqual(RAW_HEX_CEILING);
  });

  it("renders tables through the shared table components", () => {
    const offenders = views.filter((file) => !file.startsWith("design-system/") && !RAW_TABLE_ALLOWED.has(file) && /<table[\s>]/.test(readFileSync(file, "utf8")));
    expect(offenders, "use DataGrid, RecordTable or DocumentTable from @/design-system").toEqual([]);
  });

  it("has no native checkboxes or radios", () => {
    const offenders = views.filter((file) => /type=["'](?:checkbox|radio)["']/.test(readFileSync(file, "utf8")));
    expect(offenders, "use Checkbox, RadioSet or Switch from @/design-system").toEqual([]);
  });
});
