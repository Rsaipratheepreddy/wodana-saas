import { describe, expect, it } from "vitest";
import { DEFAULT_LEAD_OPTIONS } from "../leads/lead-options";
import { defaultLeadForm, parseLeadForm, validateFormAnswers } from "./lead-form-schema";

const schema = () => defaultLeadForm(DEFAULT_LEAD_OPTIONS);
const answers = (form = schema()) => Object.fromEntries(form.questions.map(question => [question.id, ({ displayName: "A customer", mobile: "+971501234567", email: "customer@example.com", location: "Dubai", serviceType: "not_sure", budgetRange: "not_sure", summary: "" } as Record<string, string>)[question.field]]));
describe("Customer enquiry forms", () => {
  it("does not impose one company's enquiry types on a new workspace", () => {
    expect(DEFAULT_LEAD_OPTIONS.enquiryTypes).toEqual([{ id: "not_sure", label: "Not Sure Yet" }]);
    expect(schema().questions.find(question => question.field === "serviceType")?.options).toEqual(DEFAULT_LEAD_OPTIONS.enquiryTypes);
  });
  it("keeps a required name and at least one required contact method when publishing", () => {
    const form = schema();
    expect(() => parseLeadForm({ ...form, questions: form.questions.filter(q => q.field !== "displayName") }, true)).toThrow("customer name");
    expect(() => parseLeadForm({ ...form, questions: form.questions.filter(q => !["email", "mobile"].includes(q.field)) }, true)).toThrow("email or mobile");
    expect(() => parseLeadForm({ ...form, questions: form.questions.map(q => ["email", "mobile"].includes(q.field) ? { ...q, required: false } : q) }, true)).toThrow("Require at least one contact method");

    const emailOnly = { ...form, questions: form.questions.filter(q => q.field !== "mobile").map(q => q.field === "email" ? { ...q, required: true } : q) };
    expect(parseLeadForm(emailOnly, true).questions.find(q => q.field === "email")?.required).toBe(true);
  });
  it("rejects duplicate question IDs and duplicate linked fields", () => {
    const form = schema();
    expect(() => parseLeadForm({ ...form, questions: [...form.questions, form.questions[0]] })).toThrow("Question IDs");
    expect(() => parseLeadForm({ ...form, questions: [...form.questions, { ...form.questions[0], id: "second" }] })).toThrow("Each lead field");
  });
  it("uses productive generic defaults without forcing email", () => {
    const form = schema(), values = answers(form);
    expect(form.questions.find(q => q.field === "email")?.required).toBe(false);
    expect(form.questions.find(q => q.field === "serviceType")?.required).toBe(true);
    delete values[form.questions.find(q => q.field === "budgetRange")!.id];
    delete values[form.questions.find(q => q.field === "email")!.id];
    expect(validateFormAnswers(form, values).fields.location).toBe("Dubai");
    delete values[form.questions.find(q => q.field === "mobile")!.id];
    expect(() => validateFormAnswers(form, values)).toThrow("Mobile number is required");
  });
  it("rejects internal field injection, invented choices and malformed emails", () => {
    const form = schema(), values = answers(form);
    expect(() => validateFormAnswers(form, { ...values, ownerMembershipId: "someone" })).toThrow("form changed");
    expect(() => validateFormAnswers(form, { ...values, [form.questions.find(q => q.field === "serviceType")!.id]: "unlisted" })).toThrow("Choose an answer");
    expect(() => validateFormAnswers(form, { ...values, [form.questions.find(q => q.field === "email")!.id]: "invalid" })).toThrow("valid email");
  });
  it("validates custom checkbox answers and stores readable labels", () => {
    const form = schema(); form.questions.push({ id: "preferences", title: "Preferences", description: "", type: "checkboxes", field: "custom", required: true, options: [{ id: "oak", label: "Oak" }, { id: "stone", label: "Stone" }] });
    expect(validateFormAnswers(form, { ...answers(form), preferences: ["oak", "stone"] }).responses.at(-1)?.value).toEqual(["Oak", "Stone"]);
    expect(() => validateFormAnswers(form, { ...answers(form), preferences: ["other"] })).toThrow("Choose valid answers");
  });
  it("rejects invalid dates and non-finite custom numbers", () => {
    const form = schema(); form.questions.push({ id: "visit", title: "Visit", description: "", type: "date", field: "custom", required: true, options: [] });
    for (const value of ["2026-02-31", "2026-99-99", "tomorrow"]) expect(() => validateFormAnswers(form, { ...answers(form), visit: value })).toThrow("valid date");
    form.questions.at(-1)!.type = "number";
    expect(() => validateFormAnswers(form, { ...answers(form), visit: "Infinity" })).toThrow("Enter a number");
  });
});
