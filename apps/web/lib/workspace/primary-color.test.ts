import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_PRIMARY_COLOR, normalizeWorkspacePrimaryColor, workspacePrimaryColorStyle } from "./primary-color";

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("workspace primary colour", () => {
  it("normalizes valid six-digit colours and rejects unsafe values", () => {
    expect(normalizeWorkspacePrimaryColor(" #6f4da0 ")).toBe("#6F4DA0");
    expect(normalizeWorkspacePrimaryColor("#fff")).toBeNull();
    expect(normalizeWorkspacePrimaryColor("red")).toBeNull();
  });

  it("derives complete light and dark tokens from one tenant colour", () => {
    const style = workspacePrimaryColorStyle("#F2C94C");
    expect(style?.["--wd-workspace-brand-light-on"]).toBe("#FFFFFF");
    expect(style?.["--wd-workspace-brand-dark-600"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(style?.["--wd-workspace-brand-dark-on"]).toMatch(/^#(?:FFFFFF|111111)$/);
    expect(contrast(style!["--wd-workspace-brand-light-600"], style!["--wd-workspace-brand-light-on"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(style!["--wd-workspace-brand-light-700"], "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(style!["--wd-workspace-brand-dark-600"], style!["--wd-workspace-brand-dark-on"])).toBeGreaterThanOrEqual(4.5);
  });

  it("preserves an already-readable brand fill and gives light and dark modes distinct ramps", () => {
    const style = workspacePrimaryColorStyle(DEFAULT_WORKSPACE_PRIMARY_COLOR)!;
    expect(style["--wd-workspace-brand-light-600"]).toBe(DEFAULT_WORKSPACE_PRIMARY_COLOR);
    expect(style["--wd-workspace-brand-dark-600"]).not.toBe(style["--wd-workspace-brand-light-600"]);
    expect(contrast(style["--wd-workspace-brand-dark-700"], "#181818")).toBeGreaterThanOrEqual(4.5);
  });

  it("does not override the current product defaults when unset", () => {
    expect(workspacePrimaryColorStyle(null)).toBeUndefined();
    expect(workspacePrimaryColorStyle("not-a-colour")).toBeUndefined();
  });

  it("keeps a pale tenant primary as a surface while using its secondary for accessible actions", () => {
    const style = workspacePrimaryColorStyle({
      primaryColor: "#E4E3DE",
      secondaryColor: "#000000",
      headingFont: "alta",
      bodyFont: "montserrat",
    })!;
    expect(style["--wd-workspace-brand-light-200"]).toBe("#E4E3DE");
    expect(style["--wd-workspace-brand-light-600"]).toBe("#000000");
    expect(style["--wd-workspace-brand-light-on"]).toBe("#FFFFFF");
    expect(style["--wd-workspace-font-heading"]).toContain("Alta");
    expect(style["--wd-workspace-font-body"]).toContain("Montserrat");
    expect(style["--wd-workspace-heading-transform"]).toBe("uppercase");
    expect(style["--wd-workspace-heading-tracking"]).toBe("0.045em");
  });
});
