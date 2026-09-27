import { tKey } from "@/lib/i18n/keys";

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; url?: string }>;
  }>;
};
export function templateBody(template: MetaTemplate): string {
  return (
    template.components?.find((component) => component.type === "BODY")?.text ??
    ""
  );
}
// Inbox delivery currently supports static templates; parameterized messages use provider tools.
// The reason is an i18n key: show it with `translateKnown`.
export function inboxTemplateReason(template: MetaTemplate): string | null {
  if (template.status !== "APPROVED") return tKey("Awaiting Meta approval");
  if (template.category === "AUTHENTICATION")
    return tKey("Used for secure portal login");
  if (!templateBody(template)) return tKey("This template has no message body");
  if (!/^[a-z][a-z0-9_.-]{0,98}$/.test(template.name))
    return tKey("Use this template from integration tools");
  if (
    template.components?.some(
      (component) =>
        /\{\{/.test(component.text ?? "") ||
        (component.type === "HEADER" && component.format !== "TEXT") ||
        !["BODY", "HEADER", "FOOTER", "BUTTONS"].includes(component.type) ||
        component.buttons?.some(
          (button) =>
            /\{\{/.test(button.url ?? "") ||
            !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type),
        ),
    )
  ) {
    return tKey("Requires additional details in integration tools");
  }
  return null;
}
export type StoredTemplate = {
  id: string;
  code: string;
  locale: string;
  channel: string;
  status: string;
  bodyTemplate: string;
  providerTemplateId?: string;
  versionNumber: number;
};
export function matchesMetaTemplate(
  stored: StoredTemplate,
  meta: MetaTemplate,
) {
  return (
    stored.channel === "whatsapp" &&
    stored.code === meta.name &&
    stored.locale === meta.language &&
    stored.providerTemplateId === meta.id &&
    stored.bodyTemplate === templateBody(meta)
  );
}
