import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { EXCLUDED, snapCss } from "../scripts/snap-to-tokens.mjs";

// Component CSS uses the scale: spacing on the 4px grid (φ tokens for page rhythm), the type scale
// and the radius scale, so tenant co-branding and density change everything from tokens.css.
const files = execSync("git ls-files 'app/**/*.css' 'components/**/*.css' 'design-system/**/*.css'", { encoding: "utf8" })
  .split("\n").filter((file) => file && !(EXCLUDED as RegExp).test(file));

// Raw hex colours bypass themes (dark mode, tenant brand). Lower this number as modules are rebuilt; never raise it.
const RAW_HEX_CEILING = 427;

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
});
