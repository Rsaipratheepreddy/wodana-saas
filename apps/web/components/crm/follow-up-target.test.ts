import { expect, it } from "vitest";
import { leadTargetLabel } from "./follow-up-editor";

it("doesn't repeat the customer's name when the enquiry is titled after them", () => {
  expect(leadTargetLabel("Aisha Karim", "Aisha Karim (Jumeirah, Dubai)")).toBe("Aisha Karim · Jumeirah, Dubai");
  expect(leadTargetLabel("Aisha Karim", "Aisha Karim — Jumeirah, Dubai")).toBe("Aisha Karim · Jumeirah, Dubai");
  expect(leadTargetLabel("Aisha Karim", "Kitchen renovation")).toBe("Aisha Karim · Kitchen renovation");
  expect(leadTargetLabel("Aisha Karim", "Aisha Karim")).toBe("Aisha Karim");
});
