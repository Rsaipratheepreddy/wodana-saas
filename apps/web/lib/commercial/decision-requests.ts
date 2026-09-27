import { tKey, translatorFor, type MessageKey, type Translate } from "@/lib/i18n/keys";

type DecisionPolicy = {
  escalationMinutes: number | null;
  notificationPolicy: {
    remindersEnabled: boolean;
    channels: Array<"in_app" | "email" | "whatsapp">;
  };
};

const channelLabels: Record<DecisionPolicy["notificationPolicy"]["channels"][number], string> = {
  in_app: "Wodana",
  email: tKey("email"),
  whatsapp: "WhatsApp",
};

function escalation(minutes: number, t: Translate) {
  if (minutes === 0) return t("Escalates immediately");
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return days === 1 ? t("Escalates 1 day after the due date") : t("Escalates {count} days after the due date", { count: days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? t("Escalates 1 hour after the due date") : t("Escalates {count} hours after the due date", { count: hours });
  }
  return t("Escalates {count} minutes after the due date", { count: minutes });
}

export function decisionPolicySummary(policy: DecisionPolicy, t: Translate = translatorFor({})) {
  const reminders = policy.notificationPolicy.remindersEnabled
    ? t("Reminders: {channels}", { channels: policy.notificationPolicy.channels.map((channel) => t(channelLabels[channel] as MessageKey)).join(", ") })
    : t("Reminders off");
  const escalationText = policy.escalationMinutes == null
    ? t("No automatic escalation")
    : escalation(policy.escalationMinutes, t);
  return `${reminders} · ${escalationText}`;
}
