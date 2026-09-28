import { describe, expect, it } from "vitest";
import { PLATFORM_OPERATOR_PERMISSION_KEY } from "../../auth/platform-operator-permission.guard";
import { platformOperatorCan, type PlatformOperatorPermission } from "../../auth/platform-operator-policy";
import { OperatorSalesContactFormController, OperatorSalesEnquiriesController } from "./sales-enquiries.controller";
import {
  csvCell,
  DEFAULT_SALES_FORM,
  nextSalesEnquiryStatuses,
  normalizeSubmission,
  planStatusChange,
  publicFormView,
  readFormConfiguration,
  SalesEnquiryRuleError,
  salesEnquiryReference,
  spamVerdict,
  toCsv,
  validateFormConfiguration,
} from "./sales-enquiry.domain";

const submission = {
  name: "  Lena   Fischer ", email: "Lena@Studio-Nord.test", company: "Studio Nord", countryCode: "de",
  phone: "030 901820", phoneCountry: "DE", teamSize: "11-50", message: "We run 30 fit-out jobs a year.", consent: true,
};

describe("contact form configuration", () => {
  it("always keeps name and email on and required", () => {
    const saved = validateFormConfiguration({ ...DEFAULT_SALES_FORM, fields: { ...DEFAULT_SALES_FORM.fields,
      name: { enabled: false, required: false, label: "Your name" }, email: { enabled: false, required: false, label: null } } });
    expect(saved.fields.name).toEqual({ enabled: true, required: true, label: "Your name" });
    expect(saved.fields.email).toEqual({ enabled: true, required: true, label: null });
  });

  it("drops the required flag of a field that is off and trims labels", () => {
    const saved = validateFormConfiguration({ ...DEFAULT_SALES_FORM, fields: { ...DEFAULT_SALES_FORM.fields,
      phone: { enabled: false, required: true, label: "  Mobile   number " } } });
    expect(saved.fields.phone).toEqual({ enabled: false, required: false, label: "Mobile number" });
  });

  it("checks recipients and team sizes", () => {
    expect(validateFormConfiguration({ ...DEFAULT_SALES_FORM, recipients: [" Sales@Wodana.test ", "sales@wodana.test"] }).recipients)
      .toEqual(["sales@wodana.test"]);
    expect(() => validateFormConfiguration({ ...DEFAULT_SALES_FORM, recipients: ["not-an-address"] })).toThrow(SalesEnquiryRuleError);
    expect(() => validateFormConfiguration({ ...DEFAULT_SALES_FORM, teamSizes: [] })).toThrow("Add at least one team size");
    expect(() => validateFormConfiguration({ ...DEFAULT_SALES_FORM, teamSizes: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }))
      .toThrow("different");
    expect(validateFormConfiguration({ ...DEFAULT_SALES_FORM, teamSizes: [{ label: "500+" }] }).teamSizes).toEqual([{ id: "500-plus", label: "500+" }]);
  });

  it("never shows the recipients to the public page, and reads a partial stored version with defaults", () => {
    const view = publicFormView(3, { ...DEFAULT_SALES_FORM, recipients: ["sales@wodana.test"] });
    expect(view).not.toHaveProperty("recipients");
    expect(view.version).toBe(3);
    expect(readFormConfiguration({ thankYouTitle: "Thanks" }).fields.company.required).toBe(true);
    expect(readFormConfiguration("broken")).toEqual(DEFAULT_SALES_FORM);
  });
});

describe("contact form submissions", () => {
  it("normalizes the answers it stores", () => {
    expect(normalizeSubmission(DEFAULT_SALES_FORM, submission)).toEqual({
      name: "Lena Fischer", email: "lena@studio-nord.test", company: "Studio Nord", countryCode: "DE",
      phone: "+4930901820", teamSize: "11-50", teamSizeLabel: "11–50", message: "We run 30 fit-out jobs a year.",
    });
  });

  it("follows the configured required fields and ignores fields that are off", () => {
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, company: " " })).toThrow("Enter your company.");
    const relaxed = validateFormConfiguration({ ...DEFAULT_SALES_FORM, fields: { ...DEFAULT_SALES_FORM.fields,
      company: { enabled: false }, country: { enabled: true, required: false }, message: { enabled: true, required: true } } });
    expect(() => normalizeSubmission(relaxed, { ...submission, message: "" })).toThrow("Tell us a little");
    const saved = normalizeSubmission(relaxed, { ...submission, company: "Ignored", countryCode: undefined });
    expect(saved.company).toBeNull();
    expect(saved.countryCode).toBeNull();
  });

  it("rejects bad answers with a message the form can show", () => {
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, consent: false })).toThrow("Confirm that we may contact you");
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, email: "lena@" })).toThrow("valid work email");
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, countryCode: "ZZ" })).toThrow("valid country");
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, phone: "12" })).toThrow("valid phone number");
    expect(() => normalizeSubmission(DEFAULT_SALES_FORM, { ...submission, teamSize: "huge" })).toThrow("team size from the list");
  });

  it("flags the honeypot and a form filled faster than a person can", () => {
    expect(spamVerdict({ website: "https://spam.example", elapsedMs: 60_000 })).toBe("honeypot");
    expect(spamVerdict({ website: "", elapsedMs: 900 })).toBe("too_fast");
    expect(spamVerdict({ elapsedMs: 12_000 })).toBeNull();
  });
});

describe("enquiry workflow", () => {
  it("moves new → contacted → qualified → won or lost, and reopens a closed enquiry", () => {
    expect(nextSalesEnquiryStatuses("new")).toEqual(["contacted", "lost"]);
    expect(nextSalesEnquiryStatuses("qualified")).toEqual(["won", "lost"]);
    expect(nextSalesEnquiryStatuses("lost")).toEqual(["contacted"]);
    const now = new Date("2026-09-28T10:00:00Z");
    expect(planStatusChange("new", "contacted", now)).toMatchObject({ status: "contacted", contactedAt: now, closedAt: null, reopened: false });
    expect(planStatusChange("qualified", "won", now)).toMatchObject({ closedAt: now });
    expect(planStatusChange("won", "qualified", now)).toMatchObject({ reopened: true, closedAt: null });
    expect(planStatusChange("contacted", "contacted")).toBeNull();
    expect(() => planStatusChange("new", "won")).toThrow(SalesEnquiryRuleError);
  });

  it("gives every enquiry a short reference", () => {
    expect(salesEnquiryReference(7)).toBe("SE-0007");
    expect(salesEnquiryReference("12345")).toBe("SE-12345");
  });

  it("exports CSV that a spreadsheet cannot run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe(`""`);
    expect(toCsv(["A", "B"], [["1", "two, three"]])).toBe(`"A","B"\r\n"1","two, three"\r\n`);
  });
});

describe("sales enquiry route policies", () => {
  const permission = (target: object, method: string) => Reflect.getMetadata(PLATFORM_OPERATOR_PERMISSION_KEY,
    (target as Record<string, unknown>)[method] as object) as PlatformOperatorPermission | undefined;

  it("separates reading enquiries from changing them and the form", () => {
    const expected: Record<string, PlatformOperatorPermission> = {
      list: "sales.read", export: "sales.read", assignees: "sales.read", detail: "sales.read",
      changeStatus: "sales.manage", assign: "sales.manage", addNote: "sales.manage",
    };
    const declared = Object.getOwnPropertyNames(OperatorSalesEnquiriesController.prototype).filter((name) => name !== "constructor");
    expect(declared.sort()).toEqual(Object.keys(expected).sort());
    for (const [method, required] of Object.entries(expected)) {
      expect(permission(OperatorSalesEnquiriesController.prototype, method), method).toBe(required);
    }
    expect(permission(OperatorSalesContactFormController.prototype, "settings")).toBe("sales.read");
    expect(permission(OperatorSalesContactFormController.prototype, "save")).toBe("sales.manage");
  });

  it("gives sales work to billing operators, read access to provisioning, and nothing to support observers", () => {
    expect(platformOperatorCan("account_billing_operator", "sales.manage")).toBe(true);
    expect(platformOperatorCan("provisioning_operator", "sales.read")).toBe(true);
    expect(platformOperatorCan("provisioning_operator", "sales.manage")).toBe(false);
    expect(platformOperatorCan("support_observer", "sales.read")).toBe(false);
  });
});
