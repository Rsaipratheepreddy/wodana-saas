import { expect, it } from "vitest";
import { matchCsvHeader, parseLeadCsv } from "./import-csv";

it("reads quoted commas and line breaks without changing mapped values", () => {
  expect(parseLeadCsv('\uFEFFCustomer name,Mobile,Area\r\n"Asha, Rao",+971501234567,"Dubai\nMarina"')).toEqual({
    headers: ["Customer name", "Mobile", "Area"], rows: [["Asha, Rao", "+971501234567", "Dubai\nMarina"]],
  });
  expect(matchCsvHeader(["Customer Name", "Phone"], ["customer_name"])).toBe("Customer Name");
});

it("rejects malformed or ambiguous files", () => {
  expect(() => parseLeadCsv("Name,Name\nA,B")).toThrow("unique");
  expect(() => parseLeadCsv('Name,Mobile\n"Asha,+971501234567')).toThrow("unclosed");
  expect(() => parseLeadCsv("Name,Mobile\nAsha")).toThrow("same number");
});
