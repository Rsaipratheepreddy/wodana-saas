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
});
