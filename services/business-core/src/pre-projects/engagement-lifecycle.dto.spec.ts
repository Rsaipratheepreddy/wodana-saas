import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { TransitionEngagementDto, UpdateEngagementProfileDto } from "./pre-projects.dto";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

describe("engagement lifecycle DTOs", () => {
  it("accepts a calendar date without converting it to a timestamp", async () => {
    const input = plainToInstance(UpdateEngagementProfileDto, { requestId, version: 1, targetDate: "2026-10-15", priority: "high", riskLevel: "medium" });
    await expect(validate(input)).resolves.toEqual([]);
    expect(input.targetDate).toBe("2026-10-15");
    await expect(validate(plainToInstance(UpdateEngagementProfileDto, { requestId, version: 1, targetDate: null }))).resolves.toEqual([]);
  });

  it.each(["2026-02-30", "15-10-2026", "2026-10-15T00:00:00Z"])("rejects malformed target date %s", async (targetDate) => {
    const errors = await validate(plainToInstance(UpdateEngagementProfileDto, { requestId, version: 1, targetDate }));
    expect(errors.some((error) => error.property === "targetDate")).toBe(true);
  });

  it("rejects unknown lifecycle actions and phases", async () => {
    const actionErrors = await validate(plainToInstance(TransitionEngagementDto, { requestId, version: 1, action: "delete" }));
    const phaseErrors = await validate(plainToInstance(TransitionEngagementDto, { requestId, version: 1, action: "set_phase", phase: "manufacturing" }));
    expect(actionErrors.some((error) => error.property === "action")).toBe(true);
    expect(phaseErrors.some((error) => error.property === "phase")).toBe(true);
  });
});
