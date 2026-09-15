import { describe, expect, it } from "vitest";
import { normalizeWorkspacePrimaryColor, workspacePrimaryColorStyle } from "./primary-color";

describe("workspace primary colour", () => {
  it("normalizes valid six-digit colours and rejects unsafe values", () => {
    expect(normalizeWorkspacePrimaryColor(" #6f4da0 ")).toBe("#6F4DA0");
    expect(normalizeWorkspacePrimaryColor("#fff")).toBeNull();
    expect(normalizeWorkspacePrimaryColor("red")).toBeNull();
  });

  it("derives complete light and dark tokens from one tenant colour", () => {
    const style = workspacePrimaryColorStyle("#F2C94C");
    expect(style?.["--wd-workspace-brand-light-600"]).toBe("#F2C94C");
    expect(style?.["--wd-workspace-brand-light-on"]).toBe("#111111");
    expect(style?.["--wd-workspace-brand-dark-600"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(style?.["--wd-workspace-brand-dark-on"]).toMatch(/^#(?:FFFFFF|111111)$/);
  });

  it("does not override the current product defaults when unset", () => {
    expect(workspacePrimaryColorStyle(null)).toBeUndefined();
    expect(workspacePrimaryColorStyle("not-a-colour")).toBeUndefined();
  });
});
