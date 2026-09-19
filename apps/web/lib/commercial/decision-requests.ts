type DecisionPolicy = {
  escalationMinutes: number | null;
  notificationPolicy: {
    remindersEnabled: boolean;
    channels: Array<"in_app" | "email" | "whatsapp">;
  };
};

const channelLabels: Record<DecisionPolicy["notificationPolicy"]["channels"][number], string> = {
  in_app: "Wodana",
  email: "email",
  whatsapp: "WhatsApp",
};

function duration(minutes: number) {
  if (minutes === 0) return "immediately";
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days} ${days === 1 ? "day" : "days"} after the due date`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"} after the due date`;
  }
  return `${minutes} minutes after the due date`;
}

export function decisionPolicySummary(policy: DecisionPolicy) {
  const reminders = policy.notificationPolicy.remindersEnabled
    ? `Reminders: ${policy.notificationPolicy.channels.map((channel) => channelLabels[channel]).join(", ")}`
    : "Reminders off";
  const escalation = policy.escalationMinutes == null
    ? "No automatic escalation"
    : `Escalates ${duration(policy.escalationMinutes)}`;
  return `${reminders} · ${escalation}`;
}
