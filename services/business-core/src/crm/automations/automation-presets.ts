export const AUTOMATION_PRESETS = [
  {
    code: "enquiry_ownership",
    definitionCode: "new_enquiry_assignment",
    eventType: null,
    name: "New enquiry ownership",
    description: "Assign every new enquiry using the CRM queue and create its first response action.",
    setupHref: "/workspace/crm/leads?section=assignment",
    availableChannels: ["in_app"],
  },
  {
    code: "response_escalation",
    definitionCode: "sla_breach_escalation",
    eventType: null,
    name: "Missed response escalation",
    description: "Create an urgent action when the configured response target is missed.",
    setupHref: "/workspace/crm/leads?section=sla",
    availableChannels: ["in_app"],
  },
  {
    code: "decision_reminders",
    definitionCode: null,
    eventType: "commercial.decision.reminder",
    name: "Client decision reminders",
    description: "Remind the request owner when an unanswered revision-bound client decision reaches its due date.",
    setupHref: "/workspace/pre-projects/variations",
    availableChannels: ["in_app"],
  },
  {
    code: "weekly_progress",
    definitionCode: null,
    eventType: "project.weekly_progress",
    name: "Weekly project progress",
    description: "Send each assigned project team member a concise weekly progress summary.",
    setupHref: "/workspace/projects",
    availableChannels: ["in_app", "email"],
  },
] as const;

export type AutomationPresetCode = (typeof AUTOMATION_PRESETS)[number]["code"];

export function automationPreset(code: string) {
  return AUTOMATION_PRESETS.find((preset) => preset.code === code) ?? null;
}

export function providerCapability(input: {
  channel: "in_app" | "email" | "whatsapp" | "push";
  connected: boolean;
  delivered: number;
  failed: number;
  lastDeliveredAt: string | null;
}) {
  const pricing = input.channel === "in_app" || input.channel === "push"
    ? "Included with Wodana"
    : input.channel === "email"
      ? "Your email provider plan applies"
      : "Meta conversation pricing applies";
  return {
    ...input,
    pricing,
    receiptState: input.channel === "in_app"
      ? "built_in"
      : input.delivered > 0
        ? "verified"
        : input.connected
          ? "awaiting_test_receipt"
          : "not_connected",
  };
}
