import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateBusinessUnitDto } from "./dto/create-business-unit.dto";
import { UpdateBusinessUnitDto } from "./dto/update-business-unit.dto";

const base = {
  legalEntityId: "11111111-1111-4111-8111-111111111111",
  code: "DESIGN",
  name: "Design",
  type: "department",
  timezone: "Asia/Dubai",
};

describe("business unit calendar colors", () => {
  it("accepts and canonicalizes a six-digit hex color", async () => {
    const input = plainToInstance(CreateBusinessUnitDto, { ...base, color: " #dc2626 " });
    expect(await validate(input)).toEqual([]);
    expect(input.color).toBe("#DC2626");
  });

  it("keeps color optional and rejects unsafe or shorthand values", async () => {
    expect(await validate(plainToInstance(CreateBusinessUnitDto, base))).toEqual([]);
    for (const color of ["red", "#FFF", "#12345678", "var(--red)"]) {
      const errors = await validate(plainToInstance(UpdateBusinessUnitDto, { version: 1, color }));
      expect(errors.some(error => error.property === "color")).toBe(true);
    }
  });
});
