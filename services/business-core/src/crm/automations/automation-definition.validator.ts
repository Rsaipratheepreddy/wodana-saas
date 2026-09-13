export interface AutomationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

type Node = { key?: unknown; type?: unknown; configuration?: unknown };
type Edge = {
  from?: unknown;
  to?: unknown;
  when?: unknown;
  default?: unknown;
  condition?: unknown;
};

const ALLOWED_NODES = new Set([
  "trigger",
  "filter",
  "lookup",
  "branch",
  "delay_until",
  "sla_timer",
  "assign",
  "create_task",
  "update_record",
  "enroll_sequence",
  "stop_sequence",
  "send_template",
  "request_approval",
  "emit_webhook",
  "create_project_handoff",
  "bounded_iteration",
  "end",
]);

const ACTION_NODES = new Set([
  "assign",
  "create_task",
  "update_record",
  "enroll_sequence",
  "stop_sequence",
  "send_template",
  "emit_webhook",
  "create_project_handoff",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

function validateConfiguration(key: string, type: string, config: Record<string, unknown>, errors: string[]) {
  if (type === "trigger") {
    if (!Array.isArray(config.eventTypes) || !config.eventTypes.length || !config.eventTypes.every(isNonEmptyString)) {
      errors.push(`${key}: trigger requires one or more eventTypes`);
    }
  }
  if (type === "create_task" && !isNonEmptyString(config.title)) {
    errors.push(`${key}: create_task requires title`);
  }
  if (type === "send_template" && !isNonEmptyString(config.templateId) && !isNonEmptyString(config.templateCode)) {
    errors.push(`${key}: send_template requires templateId or templateCode`);
  }
  if (type === "emit_webhook" && !isNonEmptyString(config.templateCode)) {
    errors.push(`${key}: emit_webhook requires templateCode`);
  }
  if (type === "enroll_sequence" && !isNonEmptyString(config.sequenceId)) {
    errors.push(`${key}: enroll_sequence requires sequenceId`);
  }
  if (["delay_until", "sla_timer"].includes(type)) {
    const dueAtValue = isNonEmptyString(config.dueAt) ? String(config.dueAt) : "";
    const dueAt = dueAtValue && !dueAtValue.startsWith("$") ? new Date(dueAtValue) : null;
    const hasDueAt = /^\$[a-zA-Z0-9_.-]+$/.test(dueAtValue)
      || Boolean(dueAt && !Number.isNaN(dueAt.getTime()) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(dueAtValue));
    const minutes = config.delayMinutes ?? config.minutes;
    const hasMinutes = typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0;
    if (!hasDueAt && !hasMinutes) errors.push(`${key}: ${type} requires a timezone-aware dueAt or non-negative delayMinutes`);
    if (config.offsetMinutes !== undefined && (typeof config.offsetMinutes !== "number" || !Number.isFinite(config.offsetMinutes) || Math.abs(config.offsetMinutes) > 525_600)) {
      errors.push(`${key}: offsetMinutes must be a finite number within one year`);
    }
    if (config.offsetMinutes !== undefined && !hasDueAt) errors.push(`${key}: offsetMinutes requires dueAt`);
  }
  if (type === "bounded_iteration" && (!Number.isInteger(config.maxIterations) || Number(config.maxIterations) < 1 || Number(config.maxIterations) > 100)) {
    errors.push(`${key}: bounded_iteration requires maxIterations from 1 to 100`);
  }
  if (type === "update_record") {
    if (!["lead", "opportunity", "activity"].includes(String(config.entityType ?? ""))) {
      errors.push(`${key}: update_record entityType is not permitted`);
    }
    if (!isRecord(config.fields) || !Object.keys(config.fields).length) {
      errors.push(`${key}: update_record requires fields`);
    }
  }
  if (["filter", "branch"].includes(type) && config.condition !== undefined && !isRecord(config.condition)) {
    errors.push(`${key}: condition must be an object`);
  }
}

export function validateAutomationDefinition(definition: Record<string, unknown>): AutomationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = Array.isArray(definition.nodes) ? definition.nodes as Node[] : [];
  const edges = Array.isArray(definition.edges) ? definition.edges as Edge[] : [];
  if (!nodes.length) errors.push("At least one node is required");
  if (nodes.length > 200) errors.push("An automation may contain at most 200 nodes");
  if (edges.length > 500) errors.push("An automation may contain at most 500 edges");

  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    const key = typeof node.key === "string" ? node.key : "";
    const type = typeof node.type === "string" ? node.type : "";
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key)) errors.push("Every node needs a valid unique key");
    else if (nodeMap.has(key)) errors.push(`Duplicate node key: ${key}`);
    else nodeMap.set(key, node);
    if (!ALLOWED_NODES.has(type)) errors.push(`Unsupported node type: ${type || "missing"}`);
    if (ALLOWED_NODES.has(type)) {
      if (node.configuration !== undefined && !isRecord(node.configuration)) errors.push(`${key}: configuration must be an object`);
      validateConfiguration(key, type, isRecord(node.configuration) ? node.configuration : {}, errors);
    }
  }

  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    const from = typeof edge.from === "string" ? edge.from : "";
    const to = typeof edge.to === "string" ? edge.to : "";
    if (!nodeMap.has(from) || !nodeMap.has(to)) {
      errors.push(`Edge references an unknown node: ${from} -> ${to}`);
      continue;
    }
    const edgeKey = JSON.stringify([from, to, edge.when ?? null, edge.default ?? null, edge.condition ?? null]);
    if (edgeKeys.has(edgeKey)) errors.push(`Duplicate edge: ${from} -> ${to}`);
    edgeKeys.add(edgeKey);
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge]);
    incoming.set(to, [...(incoming.get(to) ?? []), edge]);
  }

  const triggers = nodes.filter((node) => node.type === "trigger");
  if (triggers.length !== 1) errors.push("Exactly one trigger node is required");
  if (!nodes.some((node) => node.type === "end")) warnings.push("Workflow has no explicit end node");

  for (const [key, node] of nodeMap) {
    const type = String(node.type);
    const next = outgoing.get(key) ?? [];
    if (type === "trigger" && (incoming.get(key)?.length ?? 0) > 0) errors.push(`${key}: trigger cannot have incoming edges`);
    if (type === "end" && next.length) errors.push(`${key}: end cannot have outgoing edges`);
    if (type !== "end" && !next.length) errors.push(`${key}: ${type} requires an outgoing edge`);
    if (type === "filter") {
      const labels = new Set(next.map((edge) => String(edge.when).toLowerCase()));
      if (next.length !== 2 || !labels.has("true") || !labels.has("false")) errors.push(`${key}: filter requires true and false edges`);
    }
    if (type === "branch") {
      const defaults = next.filter((edge) => edge.default === true);
      const conditional = next.filter((edge) => isRecord(edge.condition));
      if (defaults.length !== 1 || conditional.length < 1) errors.push(`${key}: branch requires conditional edges and exactly one default edge`);
    }
    if (type === "bounded_iteration") {
      const labels = new Set(next.map((edge) => String(edge.when).toLowerCase()));
      if (!labels.has("continue") || !labels.has("done")) errors.push(`${key}: bounded_iteration requires continue and done edges`);
    }
    if (ACTION_NODES.has(type) && next.length > 1) errors.push(`${key}: ${type} may have only one outgoing edge`);
  }

  const triggerKey = typeof triggers[0]?.key === "string" ? triggers[0].key : null;
  const reachable = new Set<string>();
  if (triggerKey) {
    const queue = [triggerKey];
    while (queue.length) {
      const key = queue.shift()!;
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const edge of outgoing.get(key) ?? []) if (typeof edge.to === "string") queue.push(edge.to);
    }
  }
  for (const key of nodeMap.keys()) if (!reachable.has(key)) errors.push(`${key}: node is unreachable from the trigger`);

  const visited = new Set<string>();
  const path: string[] = [];
  const walk = (key: string) => {
    const cycleStart = path.indexOf(key);
    if (cycleStart >= 0) {
      const cycle = path.slice(cycleStart);
      if (!cycle.some((entry) => nodeMap.get(entry)?.type === "bounded_iteration")) errors.push(`Unbounded cycle detected at ${key}`);
      return;
    }
    if (visited.has(key)) return;
    path.push(key);
    for (const edge of outgoing.get(key) ?? []) if (typeof edge.to === "string") walk(edge.to);
    path.pop();
    visited.add(key);
  };
  if (triggerKey) walk(triggerKey);

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
