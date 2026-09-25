import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");
const roleStyles = readFileSync(resolve(process.cwd(), "components/workspace/roles-permissions-page.module.css"), "utf8");

describe("current Wodana size and font contract", () => {
  it("uses the existing tenant-capable geometric type stack", () => {
    expect(tokens).toMatch(/--wd-font-sans:\s*var\(--wd-workspace-font-body, var\(--font-jakarta/);
    expect(tokens).toMatch(/--wd-font-arabic:\s*var\(--font-noto-arabic\)/);
    expect(tokens).toMatch(/--wd-font-display:\s*var\(--wd-workspace-font-heading/);
  });

  it("keeps shared actions and table density compact", () => {
    expect(tokens).toMatch(/--wd-control-xs:\s*1\.75rem/);
    expect(tokens).toMatch(/--wd-control-sm:\s*2rem/);
    expect(tokens).toMatch(/--wd-button-height-compact:\s*var\(--wd-control-xs\)/);
    expect(tokens).toMatch(/--wd-button-height-standard:\s*var\(--wd-control-sm\)/);
    expect(tokens).toMatch(/--wd-button-height-large:\s*2\.5rem/);
    expect(tokens).toMatch(/--wd-table-row:\s*2\.5rem/);
    expect(tokens).toMatch(/--wd-table-row-compact:\s*2rem/);
  });

  it("keeps restrained glass and tokenized tenant colour seams", () => {
    expect(tokens).toMatch(/--wd-glass-blur:\s*12px/);
    expect(tokens).toContain("--wd-workspace-action-light-primary");
    expect(tokens).toContain("--wd-workspace-module-projects");
    expect(tokens).toContain("--wd-color-action-primary");
  });

  it("uses shared form-control density without permanent elevation in Company Settings", () => {
    expect(roleStyles).toMatch(/\.form :global\(\.wd-input-group\) \{ min-block-size: var\(--wd-control-md\)/);
    expect(roleStyles).not.toMatch(/\.form :global\(\.(?:wd-input-group|wd-textarea-frame)\) \{[^}]*box-shadow: 0 1px/);
  });
});
