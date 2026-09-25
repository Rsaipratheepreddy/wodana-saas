import { expect, it } from "vitest";
import { customerDisplayName } from "./customer-name";

it("shows only the customer's name when legacy records contain a prefix", () => {
  expect(customerDisplayName("DEMO CLIENT · Sara Al Nuaimi")).toBe("Sara Al Nuaimi");
  expect(customerDisplayName("Example Client · Omar Al Mansoori")).toBe("Omar Al Mansoori");
  expect(customerDisplayName("Aisha Rahman")).toBe("Aisha Rahman");
});
