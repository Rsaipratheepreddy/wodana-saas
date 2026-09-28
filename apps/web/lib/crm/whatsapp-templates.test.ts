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
  it("accepts numbered body variables, which the inbox mapping fills", () => {
    expect(inboxTemplateReason({ ...template, components: [{ type: "BODY", text: "Hi {{1}}, quote {{2}} is ready. {{1}}, reply here." }] })).toBeNull();
    expect(inboxTemplateReason({ ...template, components: [{ type: "BODY", text: "Hi {{1}}, quote {{3}}" }] })).not.toBeNull();
    expect(inboxTemplateReason({ ...template, components: [{ type: "BODY", text: "Hi {{name}}" }] })).not.toBeNull();
  });
  it("keeps OTP, unapproved, header/button variable and media templates out of inbox delivery", () => {
    expect(inboxTemplateReason({ ...template, category: "AUTHENTICATION" })).toContain("portal login");
    expect(inboxTemplateReason({ ...template, status: "PENDING" })).toContain("approval");
    for (const component of [{ type: "HEADER", format: "TEXT", text: "Hello {{1}}" }, { type: "HEADER", format: "IMAGE" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/{{1}}" }] }]) {
      expect(inboxTemplateReason({ ...template, components: [...template.components!, component] })).not.toBeNull();
    }
  });
});
