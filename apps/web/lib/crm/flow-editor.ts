export type FlowStep = { key: string; type: string; configuration: Record<string, unknown>; position?: unknown; [key: string]: unknown };
export type FlowEdge = { from: string; to: string; when?: unknown; default?: unknown; condition?: unknown; [key: string]: unknown };
export type FlowDefinition = { nodes: FlowStep[]; edges: FlowEdge[]; [key: string]: unknown };
export type FlowPoint = { x: number; y: number };

export const flowPalette = [
  { type: "create_task", title: "Follow-up task", description: "Create the next commitment" },
  { type: "delay_until", title: "Wait", description: "Pause before the next step" },
  { type: "assign", title: "Assign lead manager", description: "Use a queue’s routing policy" },
  { type: "filter", title: "Condition", description: "Split into Yes and No paths" },
  { type: "end", title: "End", description: "Finish this workflow path" },
] as const;

export function createFlowStep(type: string, key: string, position: FlowPoint): FlowStep | null {
  if (!flowPalette.some((item) => item.type === type) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const configuration = type === "create_task" ? { title: "Follow up with customer", priority: "normal", delayMinutes: 60, isNextAction: true }
    : type === "delay_until" ? { delayMinutes: 60 }
    : type === "filter" ? { condition: { path: "event.leadId", operator: "exists" } } : {};
  return { key, type, configuration, position };
}

export function flowPorts(definition: FlowDefinition, step: FlowStep) {
  if (step.type === "end") return [];
  if (step.type === "filter") return [{ id: "true", label: "Yes" }, { id: "false", label: "No" }];
  if (step.type === "bounded_iteration") return [{ id: "continue", label: "Continue" }, { id: "done", label: "Done" }];
  if (step.type === "branch") return definition.edges.flatMap((edge, index) => edge.from === step.key ? [{ id: `route-${index}`, label: edge.default ? "Otherwise" : `Rule ${index + 1}` }] : []);
  return [{ id: "next", label: "Next" }];
}

export function edgePort(definition: FlowDefinition, edge: FlowEdge, index: number) {
  const type = definition.nodes.find((step) => step.key === edge.from)?.type;
  return type === "filter" || type === "bounded_iteration" ? String(edge.when).toLowerCase() : type === "branch" ? `route-${index}` : "next";
}

// Each source port owns exactly one route. Retargeting it preserves its rule metadata.
export function connectFlow(definition: FlowDefinition, sourceKey: string, targetKey: string, port = "next"): { definition: FlowDefinition; error?: string } {
  const reject = (error: string) => ({ definition, error });
  const source = definition.nodes.find((step) => step.key === sourceKey), target = definition.nodes.find((step) => step.key === targetKey);
  if (!source || !target) return reject("Both steps must exist before connecting them.");
  if (sourceKey === targetKey) return reject("A step cannot connect to itself.");
  if (source.type === "end" || target.type === "trigger") return reject("Connections go from a trigger or action toward an action or End.");
  if (!flowPorts(definition, source).some((item) => item.id === port)) return reject("Choose a valid output on this step.");
  const indexes = definition.edges.flatMap((edge, index) => edge.from === sourceKey && edgePort(definition, edge, index) === port ? [index] : []);
  if (indexes.length > 1) return reject("This output has multiple existing routes. Remove the extra connections before reconnecting it.");
  const index = indexes[0];
  const previous = index === undefined ? undefined : definition.edges[index];
  if (previous?.to === targetKey) return { definition };
  const retained = definition.edges.filter((_, edgeIndex) => edgeIndex !== index);
  if (!previous && retained.length >= 500) return reject("A workflow can contain at most 500 connections.");
  const visited = new Set<string>(), pending = [targetKey];
  while (pending.length) {
    const key = pending.pop()!;
    if (key === sourceKey) return reject("This connection would create a loop. Existing bounded loops are preserved; new unbounded loops are not allowed.");
    if (visited.has(key)) continue;
    visited.add(key);
    retained.filter((edge) => edge.from === key).forEach((edge) => pending.push(edge.to));
  }
  const edge: FlowEdge = previous ? { ...previous, to: targetKey } : { from: sourceKey, to: targetKey, ...(["filter", "bounded_iteration"].includes(source.type) ? { when: port } : {}) };
  return { definition: { ...definition, edges: previous ? definition.edges.map((old, i) => i === index ? edge : old) : [...retained, edge] } };
}

export function flowConnectionIssues(definition: FlowDefinition): string[] {
  const issues: string[] = [];
  const triggers = definition.nodes.filter((node) => node.type === "trigger");
  if (triggers.length !== 1) issues.push("Keep exactly one trigger in the workflow.");
  const reachable = new Set<string>(), queue = triggers.map((node) => node.key);
  while (queue.length) {
    const key = queue.shift()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    definition.edges.filter((edge) => edge.from === key).forEach((edge) => queue.push(edge.to));
  }
  for (const node of definition.nodes) {
    const title = String(node.configuration.title ?? flowPalette.find((item) => item.type === node.type)?.title ?? node.type);
    if (!reachable.has(node.key)) issues.push(`${title}: connect this step to the trigger’s path.`);
    for (const port of flowPorts(definition, node)) {
      if (!definition.edges.some((edge, index) => edge.from === node.key && edgePort(definition, edge, index) === port.id)) issues.push(`${title}: connect the ${port.label} output.`);
    }
  }
  return issues;
}

export type FlowHistory = { past: FlowDefinition[]; present: FlowDefinition; future: FlowDefinition[] };
export function recordFlowChange(history: FlowHistory, definition: FlowDefinition): FlowHistory {
  if (JSON.stringify(history.present) === JSON.stringify(definition)) return history;
  return { past: [...history.past, history.present].slice(-50), present: definition, future: [] };
}
export function undoFlow(history: FlowHistory): FlowHistory {
  return history.past.length ? { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] } : history;
}
export function redoFlow(history: FlowHistory): FlowHistory {
  return history.future.length ? { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) } : history;
}
