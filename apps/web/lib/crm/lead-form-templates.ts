import { fieldQuestion, type EnquiryField } from "./enquiry-fields";
import type { LeadFormSchema } from "./lead-forms";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";

type TemplateQuestion = [field: string, title?: MessageKey, required?: boolean];
export type LeadFormTemplate = { id: string; name: MessageKey; use: MessageKey; title: MessageKey; description: MessageKey; questions: TemplateQuestion[] };

/**
 * Starting points for the places forms are shared: the website, a showroom QR code, WhatsApp, events.
 * Built only from enquiry fields, so every answer lands on the enquiry. Name, mobile, region and enquiry
 * type are always asked (a template may reword them); phone comes early where people fill in on a phone.
 */
export const LEAD_FORM_TEMPLATES: LeadFormTemplate[] = [
  { id: "website", name: tKey("Website enquiry"), use: tKey("Website"), title: tKey("Tell us about your project"), description: tKey("Share a few details and our team will get in touch."),
    questions: [["displayName"], ["mobile"], ["email"], ["emirate"], ["area"], ["serviceType"], ["budgetRange"], ["summary"]] },
  { id: "walk-in", name: tKey("Showroom walk-in (QR)"), use: tKey("QR code"), title: tKey("Welcome to our showroom"), description: tKey("Leave your details and a designer will follow up."),
    questions: [["mobile"], ["displayName"], ["emirate"], ["serviceType", tKey("What are you looking for?")], ["summary", tKey("Anything we should know?")]] },
  { id: "site-visit", name: tKey("Site visit request"), use: tKey("Website"), title: tKey("Book a site visit"), description: tKey("Tell us where the site is and when suits you."),
    questions: [["displayName"], ["mobile"], ["emirate"], ["area", tKey("Site location"), true], ["serviceType"], ["summary", tKey("Preferred day and time"), true]] },
  { id: "callback", name: tKey("Callback request"), use: tKey("WhatsApp"), title: tKey("Request a callback"), description: tKey("We will call you back at a time that suits you."),
    questions: [["mobile"], ["displayName"], ["emirate"], ["serviceType", tKey("What should we call about?")], ["summary", tKey("Best time to call")]] },
  { id: "event", name: tKey("Event / exhibition lead"), use: tKey("Events"), title: tKey("Great to meet you"), description: tKey("Leave your details and we will send you ideas for your space."),
    questions: [["mobile"], ["displayName"], ["email"], ["emirate"], ["serviceType"], ["budgetRange"]] },
  { id: "referral", name: tKey("Referral from a client"), use: tKey("WhatsApp"), title: tKey("You were referred to us"), description: tKey("Tell us about your project and who sent you."),
    questions: [["displayName"], ["mobile"], ["emirate"], ["serviceType"], ["summary", tKey("Who referred you, and what do you need?"), true]] },
  { id: "quick-quote", name: tKey("Kitchen / wardrobe quick quote"), use: tKey("Website"), title: tKey("Get a quick quote"), description: tKey("A few details and we will send an estimate."),
    questions: [["displayName"], ["mobile"], ["emirate"], ["area"], ["serviceType", tKey("Kitchen, wardrobe or both?")], ["budgetRange"], ["summary", tKey("Rooms, sizes and timeline"), true]] },
  { id: "service", name: tKey("Warranty / service request"), use: tKey("After handover"), title: tKey("Request service"), description: tKey("Tell us what needs attention and we will arrange a visit."),
    questions: [["displayName"], ["mobile"], ["emirate"], ["area", tKey("Property location")], ["serviceType", tKey("Service needed")], ["summary", tKey("Describe the issue"), true]] },
  { id: "feedback", name: tKey("Feedback after handover"), use: tKey("After handover"), title: tKey("How did we do?"), description: tKey("Your feedback helps us improve."),
    questions: [["displayName"], ["mobile"], ["emirate"], ["serviceType", tKey("Which project was it?")], ["summary", tKey("Your feedback"), true]] },
];

/**
 * A template applied to a newly created form: the server's default questions keep their choices; fields the
 * workspace hides are left out, and the always-asked fields stay required.
 */
export function applyLeadFormTemplate(template: LeadFormTemplate, base: LeadFormSchema, fields: EnquiryField[], t: Translate, required: Set<string>): LeadFormSchema {
  const questions = template.questions.flatMap(([field, title, isRequired]) => {
    const existing = base.questions.find(question => question.field === field);
    const enquiryField = fields.find(item => item.formField === field && item.visible);
    if (!existing && !enquiryField) return [];
    const question = existing ? structuredClone(existing) : fieldQuestion(enquiryField!);
    return [{ ...question, ...(title ? { title: t(title) } : {}), required: required.has(field) || Boolean(isRequired) || (existing?.required ?? false) }];
  });
  // Anything the server always asks, but the template does not name, stays at the end.
  const missing = base.questions.filter(question => required.has(question.field ?? "") && !questions.some(item => item.field === question.field));
  return { ...base, title: t(template.title), description: t(template.description), questions: [...questions, ...missing] };
}
