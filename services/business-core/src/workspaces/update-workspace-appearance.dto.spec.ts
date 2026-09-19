import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateWorkspaceAppearanceDto } from "./dto/update-workspace-appearance.dto";

describe("UpdateWorkspaceAppearanceDto", () => {
  it("normalizes a six-digit colour and allows restoring the default", async () => {
    const custom = plainToInstance(UpdateWorkspaceAppearanceDto, { workspaceVersion: 1, primaryColor: " #6f4da0 " });
    await expect(validate(custom)).resolves.toEqual([]);
    expect(custom.primaryColor).toBe("#6F4DA0");
    await expect(validate(plainToInstance(UpdateWorkspaceAppearanceDto, { workspaceVersion: 1, primaryColor: null }))).resolves.toEqual([]);
  });

  it("rejects shorthand, missing, and malformed colours", async () => {
    for (const primaryColor of ["#fff", "purple", undefined]) {
      const errors = await validate(plainToInstance(UpdateWorkspaceAppearanceDto, { workspaceVersion: 1, primaryColor }));
      expect(errors.some((error) => error.property === "primaryColor")).toBe(true);
    }
  });

  it("normalizes the Palm secondary colour and accepts only approved font tokens", async () => {
    const palm = plainToInstance(UpdateWorkspaceAppearanceDto, {
      workspaceVersion: 1,
      primaryColor: "#E4E3DE",
      secondaryColor: " #000000 ",
      headingFont: "alta",
      bodyFont: "montserrat",
    });
    await expect(validate(palm)).resolves.toEqual([]);
    expect(palm.secondaryColor).toBe("#000000");
    const invalid = await validate(plainToInstance(UpdateWorkspaceAppearanceDto, {
      workspaceVersion: 1, primaryColor: "#E4E3DE", headingFont: "comic-sans", bodyFont: "arial",
    }));
    expect(invalid.map((error) => error.property)).toEqual(expect.arrayContaining(["headingFont", "bodyFont"]));
  });
});
