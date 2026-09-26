import { describe, expect, it } from "vitest";
import { DEFAULT_LEAD_OPTIONS } from "../leads/lead-options";
import { completeLeadForm, defaultLeadForm, parseLeadForm, requiredFormFields, validateFormAnswers } from "./lead-form-schema";

const CHOICES = { ...DEFAULT_LEAD_OPTIONS, emirates: [{ id: "dubai", label: "Dubai" }, { id: "other", label: "Other" }], areas: {} };
const REQUIRED = requiredFormFields(CHOICES);

const schema = () => defaultLeadForm(CHOICES);
const answers = (form = schema()) => Object.fromEntries(form.questions.map(question => [question.id, ({ displayName: "A customer", mobile: "+971501234567", email: "customer@example.com", emirate: "dubai", area: "", serviceType: "not_sure", budgetRange: "not_sure", summary: "" } as Record<string, string>)[question.field]]));
describe("Customer enquiry forms", () => {
  it("does not impose one company's enquiry types on a new workspace", () => {
    expect(DEFAULT_LEAD_OPTIONS.enquiryTypes).toEqual([{ id: "not_sure", label: "Not Sure Yet" }]);
    expect(schema().questions.find(question => question.field === "serviceType")?.options).toEqual(DEFAULT_LEAD_OPTIONS.enquiryTypes);
  });
  it("requires name, mobile, Emirate and enquiry type when publishing", () => {
    const form = schema();
    expect(() => parseLeadForm({ ...form, questions: form.questions.filter(q => q.field !== "displayName") }, true, REQUIRED)).toThrow("customer name");
    for (const field of ["mobile", "emirate", "serviceType"]) expect(() => parseLeadForm({ ...form, questions: form.questions.filter(q => q.field !== field) }, true, REQUIRED)).toThrow(field === "serviceType" ? "enquiry type" : field);
    expect(parseLeadForm({ ...form, questions: form.questions.map(q => q.field === "mobile" ? { ...q, required: false } : q) }, true, REQUIRED).questions.find(q => q.field === "mobile")?.required).toBe(true);
  });
  it("upgrades an older location question without duplicating an existing Area question", () => {
    const form = schema();
    form.questions.push({ id: "old_location", title: "Location", description: "", type: "text", field: "location", required: false, options: [] });
    const upgraded = completeLeadForm(form, CHOICES);
    expect(upgraded.questions.filter(question => question.field === "area")).toHaveLength(1);
    expect(upgraded.questions.some(question => question.field === "location")).toBe(false);
    expect(parseLeadForm(upgraded, true, REQUIRED).questions.filter(question => question.required).map(question => question.field)).toEqual(expect.arrayContaining(["displayName", "mobile", "emirate", "serviceType"]));
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
    expect(validateFormAnswers(form, values).fields.emirate).toBe("dubai");
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
    expect(validateFormAnswers(form, { ...answers(form), preferences: ["oak", "stone"] }).responses.at(-1)).toMatchObject({ field: "custom", value: ["Oak", "Stone"] });
    expect(() => validateFormAnswers(form, { ...answers(form), preferences: ["other"] })).toThrow("Choose valid answers");
  });
  it("rejects invalid dates and non-finite custom numbers", () => {
    const form = schema(); form.questions.push({ id: "visit", title: "Visit", description: "", type: "date", field: "custom", required: true, options: [] });
    for (const value of ["2026-02-31", "2026-99-99", "tomorrow"]) expect(() => validateFormAnswers(form, { ...answers(form), visit: value })).toThrow("valid date");
    form.questions.at(-1)!.type = "number";
    expect(() => validateFormAnswers(form, { ...answers(form), visit: "Infinity" })).toThrow("Enter a number");
  });
  it("links questions to custom enquiry fields and returns their answers apart from the fixed fields", () => {
    const form = schema(), fieldId = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f", roomsId = "8e2c7d2f-3a1b-4d66-8e8f-1b2c3d4e5f60";
    form.questions.push({ id: "floor", title: "Which floor?", description: "", type: "text", field: `cf:${fieldId}`, required: false, options: [] });
    form.questions.push({ id: "rooms", title: "Rooms", description: "", type: "checkboxes", field: `cf:${roomsId}`, required: false, options: [{ id: "Kitchen", label: "Kitchen" }, { id: "Bath", label: "Bath" }] });
    const parsed = parseLeadForm(form, true, REQUIRED);
    expect(parsed.questions.find(q => q.id === "floor")?.field).toBe(`cf:${fieldId}`);
    const result = validateFormAnswers(parsed, { ...answers(parsed), floor: "3rd", rooms: ["Kitchen", "Bath"] });
    expect(result.custom).toEqual({ [fieldId]: "3rd", [roomsId]: ["Kitchen", "Bath"] });
    expect(result.fields).not.toHaveProperty(`cf:${fieldId}`);
    expect(() => parseLeadForm({ ...parsed, questions: [...parsed.questions, { ...parsed.questions.at(-1)!, id: "again" }] })).toThrow("Each lead field");
    expect(parseLeadForm({ ...form, questions: [{ ...form.questions[0], field: "cf:not-a-uuid" }, ...form.questions.slice(1)] }).questions[0].field).toBe("custom");
  });
  it("does not ask for or require a region when the workspace lists none", () => {
    const none = { ...CHOICES, emirates: [] };
    const form = defaultLeadForm(none);
    expect(form.questions.some(question => question.field === "emirate")).toBe(false);
    expect(requiredFormFields(none)).toEqual(["displayName", "mobile", "serviceType"]);
    const older = completeLeadForm({ ...form, questions: [...form.questions, { id: "old_region", title: "Emirate", description: "", type: "dropdown", field: "emirate", required: true, options: [{ id: "dubai", label: "Dubai" }] }] }, none);
    expect(older.questions.find(question => question.field === "emirate")).toMatchObject({ required: false, options: [] });
  });
  it("refuses to publish a question that isn't linked to an enquiry field", () => {
    const form = schema();
    form.questions.push({ id: "loose", title: "Pets?", description: "", type: "text", field: "custom", required: false, options: [] });
    expect(() => parseLeadForm(form, true, REQUIRED)).toThrow("Link “Pets?”");
    expect(parseLeadForm(form, false, REQUIRED).questions.at(-1)?.field).toBe("custom");
  });
});
