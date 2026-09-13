import { describe, expect, it } from "vitest";
import { validateAutomationDefinition } from "./automation-definition.validator";
import { DEFAULT_CRM_AUTOMATION_TEMPLATES } from "./default-automation-templates";

describe("automation definition validation", () => {
  it("accepts a bounded, connected workflow", () => {
    const result = validateAutomationDefinition({
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.enquiry.ready.v1"] } },
        { key: "assign", type: "assign", configuration: {} },
        { key: "finish", type: "end", configuration: {} },
      ],
      edges: [{ from: "start", to: "assign" }, { from: "assign", to: "finish" }],
    });
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("rejects unbounded cycles and unsafe record types", () => {
    const result = validateAutomationDefinition({
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.lead.assigned.v1"] } },
        { key: "write", type: "update_record", configuration: { entityType: "invoice", fields: { status: "open" } } },
        { key: "finish", type: "end" },
      ],
      edges: [{ from: "start", to: "write" }, { from: "write", to: "start" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("write: update_record entityType is not permitted");
    expect(result.errors.some((error) => error.startsWith("Unbounded cycle"))).toBe(true);
  });

  it("requires approved-template references for sends", () => {
    const result = validateAutomationDefinition({
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.lead.assigned.v1"] } },
        { key: "send", type: "send_template" },
        { key: "finish", type: "end" },
      ],
      edges: [{ from: "start", to: "send" }, { from: "send", to: "finish" }],
    });
    expect(result.errors).toContain("send: send_template requires templateId or templateCode");
  });

  it("rejects unreachable nodes and incomplete control flow", () => {
    const result = validateAutomationDefinition({
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: [] } },
        { key: "filter", type: "filter", configuration: { condition: { path: "score", operator: "gte", value: 80 } } },
        { key: "orphan", type: "end" },
      ],
      edges: [{ from: "start", to: "filter" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("start: trigger requires one or more eventTypes");
    expect(result.errors).toContain("filter: filter requires true and false edges");
    expect(result.errors).toContain("orphan: node is unreachable from the trigger");
  });

  it("accepts a cycle only when the bounded node has continue and done paths", () => {
    const result = validateAutomationDefinition({
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.activity.completed.v1"] } },
        { key: "repeat", type: "bounded_iteration", configuration: { maxIterations: 3 } },
        { key: "lookup", type: "lookup", configuration: { path: "event.items" } },
        { key: "finish", type: "end" },
      ],
      edges: [
        { from: "start", to: "repeat" },
        { from: "repeat", to: "lookup", when: "continue" },
        { from: "repeat", to: "finish", when: "done" },
        { from: "lookup", to: "repeat" },
      ],
    });
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("ships only valid disabled-workspace templates", () => {
    expect(DEFAULT_CRM_AUTOMATION_TEMPLATES).toHaveLength(6);
    for (const template of DEFAULT_CRM_AUTOMATION_TEMPLATES) {
      expect(validateAutomationDefinition(template.definition), template.code)
        .toEqual({ valid: true, errors: [], warnings: [] });
    }
  });

  it("keeps reminder timing and consent protection safe by default", () => {
    const appointment = DEFAULT_CRM_AUTOMATION_TEMPLATES.find((item) => item.code === "appointment_reminder")!;
    const appointmentNodes = appointment.definition.nodes as Array<{ key: string; configuration: Record<string, unknown> }>;
    expect(appointmentNodes.find((node) => node.key === "wait")?.configuration).toEqual({
      dueAt: "$event.startsAt",
      offsetMinutes: -60,
    });

    const consent = DEFAULT_CRM_AUTOMATION_TEMPLATES.find((item) => item.code === "consent_withdrawal_stop_outreach")!;
    const consentNodes = consent.definition.nodes as Array<{ key: string; type: string; configuration: Record<string, unknown> }>;
    expect(consentNodes.find((node) => node.key === "not_granted")).toMatchObject({
      type: "filter",
      configuration: { condition: { path: "event.status", operator: "not_equals", value: "granted" } },
    });
  });
});
