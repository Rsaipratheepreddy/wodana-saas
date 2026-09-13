import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { IsCountryCode, IsCurrencyCode, IsLocale, IsTimeZone } from "./regional.validators";

class RegionalSettingsFixture {
  currency!: string;
  country!: string;
  locale!: string;
  timezone!: string;
}

IsCurrencyCode()(RegionalSettingsFixture.prototype, "currency");
IsCountryCode()(RegionalSettingsFixture.prototype, "country");
IsLocale()(RegionalSettingsFixture.prototype, "locale");
IsTimeZone()(RegionalSettingsFixture.prototype, "timezone");

describe("regional validators", () => {
  it("accepts valid global settings", async () => {
    const fixture = Object.assign(new RegionalSettingsFixture(), {
      currency: "AED", country: "AE", locale: "en-AE", timezone: "Asia/Dubai",
    });

    await expect(validate(fixture)).resolves.toEqual([]);
  });

  it("rejects malformed region data", async () => {
    const fixture = Object.assign(new RegionalSettingsFixture(), {
      currency: "DIRHAM",
      country: "UAE",
      locale: "not_a_locale",
      timezone: "Dubai",
    });

    const errors = await validate(fixture);
    expect(errors.map((error) => error.property).sort()).toEqual([
      "country",
      "currency",
      "locale",
      "timezone",
    ]);
  });
});
