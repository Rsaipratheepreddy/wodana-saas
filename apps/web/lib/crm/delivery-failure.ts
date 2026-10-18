import { tKey, type Translate } from "@/lib/i18n/keys";
import { failureReason } from "@/lib/workspace/delivery-health";

/**
 * Why a message to a client wasn't delivered, in Wodana's words. WhatsApp reports numeric codes (131047…), email
 * and Gmail report Wodana codes; neither the code nor the provider's own text is shown to people.
 */
const WHATSAPP_REASONS: Record<string, string> = {
  "131047": tKey("More than 24 hours since the client's last message. Send an approved template."),
  "470": tKey("More than 24 hours since the client's last message. Send an approved template."),
  "131026": tKey("This number can't receive WhatsApp messages."),
  "131049": tKey("WhatsApp held it back to protect the client's experience. Try again later."),
  "131056": tKey("Too many messages to this number. Try again in a few minutes."),
  "131048": tKey("WhatsApp limited this number for now. Try again later."),
  "368": tKey("WhatsApp limited this number for now. Try again later."),
  "131051": tKey("WhatsApp doesn't support this kind of message."),
  "131053": tKey("WhatsApp couldn't send this file."),
  "131031": tKey("The WhatsApp account is locked. Check it in Connections."),
  "131042": tKey("The WhatsApp account has a payment issue. Check it in Connections."),
};

export function deliveryFailureReason(t: Translate, code: unknown): string {
  const value = String(code ?? "").trim();
  if (WHATSAPP_REASONS[value]) return t(WHATSAPP_REASONS[value] as never);
  if (/^132\d{3}$/.test(value)) return t("The message template isn't approved or doesn't match.");
  if (/^\d+$/.test(value)) return t("WhatsApp didn't deliver it. Try again later.");
  // Email, Gmail and push failures share the delivery-health sentences.
  const reason = value ? failureReason(t, { code: value, message: null, at: "" }) : "";
  return reason && reason !== value ? reason : t("The provider didn't deliver it. Try again later.");
}
