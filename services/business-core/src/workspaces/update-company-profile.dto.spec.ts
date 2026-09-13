import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto";

const validInput = {
  workspaceVersion: 1,
  legalEntityId: "c235c573-f4b1-4da6-b041-887ffcdeaf49",
  legalEntityVersion: 1,
  name: " Iglo Architects ",
  registeredName: " Iglo Architects LLC ",
  countryCode: "ae",
  defaultCurrency: "aed",
  defaultLocale: "en-AE",
  defaultTimezone: "Asia/Dubai",
  unitSystem: "metric",
  weekStartsOn: 1,
  registrationNumber: " CN-47291 ",
  taxRegistrationNumber: " 100000000000003 ",
  address: {
    line1: " Dubai Design District ",
    city: " Dubai ",
    region: " Dubai ",
    postalCode: " 00000 ",
  },
};

describe("UpdateCompanyProfileDto", () => {
  it("normalizes and accepts a complete company profile", async () => {
    const input = plainToInstance(UpdateCompanyProfileDto, validInput);
    await expect(validate(input)).resolves.toEqual([]);
    expect(input).toMatchObject({
      name: "Iglo Architects",
      registeredName: "Iglo Architects LLC",
      countryCode: "AE",
      registrationNumber: "CN-47291",
      address: { line1: "Dubai Design District", city: "Dubai" },
    });
  });

  it("rejects malformed identity and nested address values", async () => {
    const input = plainToInstance(UpdateCompanyProfileDto, {
      ...validInput,
      countryCode: "UAE",
      address: { ...validInput.address, line1: "x".repeat(161) },
    });
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "countryCode",
      "address",
    ]));
  });
});
