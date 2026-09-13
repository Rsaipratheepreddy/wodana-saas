import { describe, expect, it } from "vitest";
import { connectFlow, createFlowStep, edgePort, flowConnectionIssues, flowPorts, recordFlowChange, redoFlow, undoFlow, type FlowDefinition, type FlowHistory } from "./flow-editor";

const fixture = (): FlowDefinition => ({
  revisionNote: "preserve metadata",
  nodes: [
    { key: "start", type: "trigger", configuration: { eventTypes: ["crm.enquiry.ready.v1"] } },
    { key: "task", type: "create_task", configuration: { title: "Call customer", customFlag: true }, position: { x: 50, y: 200 } },
    { key: "wait", type: "delay_until", configuration: { delayMinutes: 60 } },
    { key: "end", type: "end", configuration: {} },
  ],
  edges: [{ from: "start", to: "task" }, { from: "task", to: "end", customFlag: "keep" }],
});

describe("automation flow editing", () => {
  it("connects a dropped step and preserves positions, configuration, and edge metadata", () => {
    const original = fixture();
    const inserted = connectFlow(original, "task", "wait");
    expect(inserted.error).toBeUndefined();
    expect(inserted.definition.edges[1]).toEqual({ from: "task", to: "wait", customFlag: "keep" });
    const complete = connectFlow(inserted.definition, "wait", "end");
    expect(flowConnectionIssues(complete.definition)).toEqual([]);
    expect(complete.definition.nodes).toEqual(original.nodes);
    expect(complete.definition.revisionNote).toBe("preserve metadata");
    expect(original.edges[1].to).toBe("end");
  });

  it("keeps Yes and No routes independent when reconnecting a condition", () => {
    const definition = fixture();
    definition.nodes.push({ key: "check", type: "filter", configuration: { condition: { path: "event.leadId", operator: "exists" } } });
    let result = connectFlow(definition, "check", "task", "true").definition;
    result = connectFlow(result, "check", "end", "false").definition;
    result = connectFlow(result, "check", "wait", "true").definition;
    expect(result.edges.filter((edge) => edge.from === "check")).toEqual([{ from: "check", to: "wait", when: "true" }, { from: "check", to: "end", when: "false" }]);
    expect(flowPorts(result, result.nodes.at(-1)!)).toEqual([{ id: "true", label: "Yes" }, { id: "false", label: "No" }]);
  });

  it("retargets an existing branch without losing its condition or default route", () => {
    const definition = fixture();
    definition.nodes.push({ key: "branch", type: "branch", configuration: {} });
    definition.edges.push({ from: "branch", to: "task", condition: { path: "event.score", operator: "gt", value: 80 }, audit: "keep" }, { from: "branch", to: "end", default: true });
    const result = connectFlow(definition, "branch", "wait", "route-2");
    expect(result.definition.edges[2]).toEqual({ ...definition.edges[2], to: "wait" });
    expect(result.definition.edges[3]).toEqual(definition.edges[3]);
    expect(edgePort(result.definition, result.definition.edges[3], 3)).toBe("route-3");
  });

  it.each([
    ["task", "task", "next"], ["task", "start", "next"], ["end", "task", "next"],
    ["missing", "task", "next"], ["task", "missing", "next"], ["task", "wait", "true"],
  ])("rejects invalid connection %s → %s (%s) without mutating the draft", (source, target, port) => {
    const definition = fixture(), result = connectFlow(definition, source, target, port);
    expect(result.error).toBeTruthy();
    expect(result.definition).toBe(definition);
  });

  it("rejects cycles and ambiguous outputs, but a duplicate connection is a no-op", () => {
    const definition = connectFlow(fixture(), "wait", "task").definition;
    expect(connectFlow(definition, "task", "wait").error).toMatch(/loop/);
    expect(connectFlow(definition, "task", "end").definition).toBe(definition);
    definition.edges.push({ from: "task", to: "wait" });
    expect(connectFlow(definition, "task", "end").error).toMatch(/multiple/);
  });

  it("reports disconnected nodes and missing condition outputs before saving", () => {
    const definition = fixture();
    definition.nodes.push({ key: "check", type: "filter", configuration: {} });
    expect(flowConnectionIssues(definition)).toEqual(expect.arrayContaining([
      "Wait: connect this step to the trigger’s path.", "Wait: connect the Next output.",
      "Condition: connect the Yes output.", "Condition: connect the No output.",
    ]));
  });

  it("only creates supported palette steps with valid canvas coordinates", () => {
    expect(createFlowStep("create_task", "new", { x: -200, y: 300 })).toMatchObject({ type: "create_task", configuration: { isNextAction: true }, position: { x: -200, y: 300 } });
    expect(createFlowStep("filter", "check", { x: 1, y: 2 })?.configuration).toEqual({ condition: { path: "event.leadId", operator: "exists" } });
    expect(createFlowStep("trigger", "second-trigger", { x: 1, y: 2 })).toBeNull();
    expect(createFlowStep("arbitrary-script", "bad", { x: 1, y: 2 })).toBeNull();
    expect(createFlowStep("end", "bad", { x: NaN, y: Infinity })).toBeNull();
  });

  it("restores full graphs on undo/redo and clears redo after a different edit", () => {
    const original = fixture();
    const history: FlowHistory = { past: [], present: original, future: [] };
    const changed = recordFlowChange(history, connectFlow(original, "task", "wait").definition);
    expect(undoFlow(changed).present).toEqual(original);
    expect(redoFlow(undoFlow(changed))).toEqual(changed);
    expect(recordFlowChange(undoFlow(changed), connectFlow(original, "wait", "end").definition).future).toEqual([]);
    expect(recordFlowChange(history, structuredClone(original))).toBe(history);
    expect(undoFlow(history)).toBe(history);
    expect(redoFlow(history)).toBe(history);
  });

  it("limits undo history to 50 snapshots", () => {
    let history: FlowHistory = { past: [], present: fixture(), future: [] };
    for (let index = 0; index < 70; index++) history = recordFlowChange(history, { ...history.present, revisionNote: `Change ${index}` });
    expect(history.past).toHaveLength(50);
  });
});
