import { describe, expect, it } from "vitest";
import { inboxTemplateReason, matchesMetaTemplate, templateBody, type MetaTemplate } from "./whatsapp-templates";
const template: MetaTemplate = { id: "meta-id", name: "business_update", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Your update is ready." }] };
describe("WhatsApp approved template mapping", () => {
  it("maps actual approved business templates to the exact provider version and language", () => {
    expect(inboxTemplateReason(template)).toBeNull();
    const stored = { id: "local", providerTemplateId: "meta-id", code: template.name, channel: "whatsapp", locale: "en_US", bodyTemplate: templateBody(template), versionNumber: 1, status: "approved" };
    expect(matchesMetaTemplate(stored, template)).toBe(true);
    expect(matchesMetaTemplate({ ...stored, locale: "ar" }, template)).toBe(false);
    expect(matchesMetaTemplate({ ...stored, bodyTemplate: "Old content" }, template)).toBe(false);
  });
  it("keeps OTP, unapproved and parameterized/media templates out of static inbox delivery", () => {
    expect(inboxTemplateReason({ ...template, category: "AUTHENTICATION" })).toContain("portal login");
    expect(inboxTemplateReason({ ...template, status: "PENDING" })).toContain("approval");
    for (const component of [{ type: "BODY", text: "Hello {{1}}" }, { type: "HEADER", format: "IMAGE" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/{{1}}" }] }]) {
      expect(inboxTemplateReason({ ...template, components: [...template.components!, component] })).not.toBeNull();
    }
  });
});
