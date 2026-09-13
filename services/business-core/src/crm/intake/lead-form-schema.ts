import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { loadLeadOptions } from "../leads/lead-options";

export type FormQuestion = {
  id: string; title: string; description: string; type: string; required: boolean;
  field: string; options: { id: string; label: string }[];
};
export type LeadFormSchema = { title: string; description: string; source: string; channel: string; questions: FormQuestion[] };
export const QUESTION_TYPES = ["text", "paragraph", "email", "tel", "radio", "checkboxes", "dropdown", "number", "date"];
export const CORE_FIELDS = ["displayName", "email", "mobile", "location", "serviceType", "budgetRange", "summary"];
const CONTACT_FIELDS = ["email", "mobile"];

export function defaultLeadForm(choices: Awaited<ReturnType<typeof loadLeadOptions>>): LeadFormSchema {
  const question = (field: string, title: string, type: string, required: boolean, options: FormQuestion["options"] = []): FormQuestion => ({ id: randomUUID(), title, type, required, field, options, description: "" });
  return { title: "Tell us about your project", description: "Share a few details and our team will get in touch.", source: "company", channel: "website", questions: [
    question("displayName", "Your name", "text", true), question("mobile", "Mobile number", "tel", true),
    question("email", "Email address", "email", false), question("location", "Property location", "text", true),
    question("serviceType", "What can we help with?", "dropdown", true, choices.enquiryTypes),
    question("budgetRange", "Estimated budget", "dropdown", false, choices.budgetRanges),
    question("summary", "Tell us about your project", "paragraph", false),
  ] };
}

export function parseLeadForm(value: unknown, publishing = false): LeadFormSchema {
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 100000) throw new BadRequestException("Invalid form");
  const input = value as Record<string, any>;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
  if (!Array.isArray(input.questions) || input.questions.length > 50) throw new BadRequestException("A form can contain up to 50 questions");
  const questions: FormQuestion[] = input.questions.map((raw: any) => {
    if (!raw || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id) || !QUESTION_TYPES.includes(raw.type)) throw new BadRequestException("Invalid question");
    const field = CORE_FIELDS.includes(raw.field) ? raw.field : "custom";
    const options = Array.isArray(raw.options) ? raw.options.slice(0, 50).map((option: any) => ({ id: text(option?.id, 80), label: text(option?.label, 160) })) : [];
    if (new Set(options.map((option: { id: string }) => option.id)).size !== options.length || options.some((option: { id: string; label: string }) => !option.id || !option.label)) throw new BadRequestException("Each answer choice needs a unique value and label");
    const type = field === "email" ? "email" : field === "mobile" ? "tel" : field === "summary" ? "paragraph" : ["serviceType", "budgetRange"].includes(field) ? "dropdown" : ["displayName", "location"].includes(field) ? "text" : raw.type;
    const question = { id: raw.id, title: text(raw.title, 240), description: text(raw.description, 1000), type, required: raw.required === true, field, options };
    if (publishing && !question.title) throw new BadRequestException("Give every question a title before publishing");
    if (publishing && ["radio", "checkboxes", "dropdown"].includes(type) && !options.length) throw new BadRequestException("Add answer choices before publishing");
    return question;
  });
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw new BadRequestException("Question IDs must be unique");
  const fields = questions.filter(q => q.field !== "custom").map(q => q.field);
  if (new Set(fields).size !== fields.length) throw new BadRequestException("Each lead field can be linked to one question");
  if (publishing) {
    const name = questions.find(question => question.field === "displayName");
    const contacts = questions.filter(question => CONTACT_FIELDS.includes(question.field));
    if (!name?.required) throw new BadRequestException("Keep customer name as a required question");
    if (!contacts.length) throw new BadRequestException("Keep an email or mobile question in the form");
    if (!contacts.some(question => question.required)) throw new BadRequestException("Require at least one contact method: email or mobile");
  }
  const schema = { title: text(input.title, 160), description: text(input.description, 2000), source: text(input.source, 100), channel: text(input.channel, 60), questions };
  if (!schema.title) throw new BadRequestException("Enter a form title");
  return schema;
}

export function validateFormAnswers(schema: LeadFormSchema, answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || JSON.stringify(answers).length > 50000) throw new BadRequestException("Enter valid form answers");
  const input = answers as Record<string, unknown>;
  if (Object.keys(input).some(id => !schema.questions.some(q => q.id === id))) throw new BadRequestException("The form changed. Reload and try again");
  const fields: Record<string, string> = {};
  const responses = schema.questions.map(q => {
    const value = input[q.id];
    const blank = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
    if (blank && q.required) throw new BadRequestException(`${q.title} is required`);
    if (blank) return { questionId: q.id, title: q.title, type: q.type, value: "" };
    let normalized: string | string[];
    if (q.type === "checkboxes") {
      if (!Array.isArray(value) || value.length > q.options.length || value.some(v => typeof v !== "string" || !q.options.some(o => o.id === v))) throw new BadRequestException(`Choose valid answers for ${q.title}`);
      normalized = [...new Set(value)] as string[];
    } else {
      if (typeof value !== "string" || !value.trim() || value.length > (q.type === "paragraph" ? 10000 : ["displayName", "location"].includes(q.field) ? 240 : q.type === "tel" ? 80 : 500)) throw new BadRequestException(`Enter a valid answer for ${q.title}`);
      normalized = value.trim();
      if (["radio", "dropdown"].includes(q.type) && !q.options.some(o => o.id === normalized)) throw new BadRequestException(`Choose an answer for ${q.title}`);
      if (q.type === "email" && !/^\S+@\S+\.\S+$/.test(normalized)) throw new BadRequestException("Enter a valid email address");
      if (q.type === "tel" && !/^\+?[\d\s().-]{7,30}$/.test(normalized)) throw new BadRequestException("Enter a valid mobile number");
      if (q.type === "number" && !Number.isFinite(Number(normalized))) throw new BadRequestException(`Enter a number for ${q.title}`);
      if (q.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(normalized)) || new Date(normalized).toISOString().slice(0,10) !== normalized)) throw new BadRequestException(`Enter a valid date for ${q.title}`);
    }
    if (q.field !== "custom") fields[q.field] = String(normalized);
    return { questionId: q.id, title: q.title, type: q.type, value: Array.isArray(normalized) ? normalized.map(id => q.options.find(o => o.id === id)!.label) : q.options.find(o => o.id === normalized)?.label ?? normalized };
  });
  return { fields, responses };
}
