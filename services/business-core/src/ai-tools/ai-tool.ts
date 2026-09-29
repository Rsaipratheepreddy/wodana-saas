import type { RequestActor } from "../auth/actor";

/**
 * Woddy's tools (W-1). A tool declares what it is (name, input schema, kind), what it calls (the module
 * command or service), the permissions the person needs for it to be offered at all, and its confirmation
 * rule. The registry is the one catalogue: the agent loop offers it to the model, and an MCP server (W-5)
 * can list the same tools.
 *
 * - read: runs at once, under the person's own permissions and RLS; its result goes back to the model as data.
 * - write: never changes anything by itself. It returns a proposed action (what changes, exactly, and where)
 *   that the person confirms or cancels; confirming runs the module's own command as that person.
 * - draft: text for the person to edit and send themselves (the inbox composer); nothing is sent.
 */
export type AiToolKind = "read" | "write" | "draft";
/** `none`: reads. `confirm`: the person confirms a card before anything changes. `composer`: text goes to the composer. */
export type AiConfirmationRule = "none" | "confirm" | "composer";

/** The JSON-schema subset both providers read (and the one the registry validates). */
export type ToolProperty = {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  required?: string[];
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
};
export type ToolSchema = { type: "object"; properties: Record<string, ToolProperty>; required?: string[] };

/** A record Woddy read or will change, with the label people know it by (e.g. "ENQ-118", "Q-118 R2"). */
export type RecordRef = { type: string; id: string; label: string; href?: string | null };

export type AiToolContext = {
  actor: RequestActor;
  workspaceId: string;
  userId: string;
  membershipId: string;
  runId: string;
  /** The workspace's time zone and locale (region pack): relative times are read in it. */
  timeZone: string;
  locale: string;
  now: Date;
  /** The permissions the person holds among those the catalogue uses. */
  permissions: ReadonlySet<string>;
  /** The record open where the person asked, and what they had selected (e.g. chats in the inbox). */
  record: { type: string; id: string } | null;
  selection: { type: string; ids: string[] } | null;
  /**
   * Registers a record a read tool returned as a source of the answer (W-4) and gives its key ("S1"); the
   * data sent to the model carries the key, so the answer can say which record a fact came from.
   */
  cite(record: RecordRef): string;
};

export type ReadResult = { data: unknown };

/** One line of a proposal: a field and its value before (when it changes) and after. */
export type PreviewField = { label: string; before?: string | null; after: string | null };
export type ProposalTarget = RecordRef & { detail?: string | null };
/**
 * What the person sees before confirming: the fields a create sets or an update changes (a diff), the
 * records a change applies to (each can be unticked when `selectable`), or the exact text.
 */
export type ProposalPreview =
  | { kind: "fields"; fields: PreviewField[] }
  | { kind: "targets"; items: ProposalTarget[]; selectable: boolean; fields: PreviewField[] }
  | { kind: "text"; text: string; fields: PreviewField[] };

export type Proposal = {
  /** One plain line: what confirming does. */
  summary: string;
  /** The record it changes (and the version the proposal was made against), when there is one. */
  target: (RecordRef & { version: number | null }) | null;
  preview: ProposalPreview;
  /** The exact input confirming runs: stored with the proposal and never taken from the model again. */
  command: Record<string, unknown>;
};

export type StoredProposal = {
  id: string;
  runId: string;
  tool: string;
  targetType: string | null;
  targetId: string | null;
  targetVersion: number | null;
  command: Record<string, unknown>;
  /** The item ids the person kept ticked (a `targets` proposal), or null for all. */
  selection: string[] | null;
  idempotencyKey: string;
};

export type Execution = {
  /** A short, stable result (ids, versions, counts) kept with the proposal. */
  result: Record<string, unknown>;
  /** The record the person can open now. */
  record: RecordRef | null;
  /** Items of a multi-record change that the module refused, with its own message. */
  failures?: Array<{ id: string; label: string; message: string }>;
};

export type DraftResult = { text: string; conversationId: string | null };

export interface AiTool {
  name: string;
  /** What the model reads to choose the tool. */
  description: string;
  kind: AiToolKind;
  parameters: ToolSchema;
  /** The module command or service the tool calls. */
  calls: string;
  /** The person needs all of these for the tool to be offered. */
  permissions: string[];
  /** ...and at least one of these, when set (e.g. assign chats or enquiries). */
  anyPermissions?: string[];
  confirmation: AiConfirmationRule;
  run?(context: AiToolContext, input: Record<string, unknown>): Promise<ReadResult>;
  propose?(context: AiToolContext, input: Record<string, unknown>): Promise<Proposal>;
  execute?(context: AiToolContext, proposal: StoredProposal): Promise<Execution>;
  draft?(context: AiToolContext, input: Record<string, unknown>): Promise<DraftResult>;
}

/** The input does not fit the tool: the model is told why and may try again. */
export class ToolInputError extends Error {
  constructor(message: string) { super(message); this.name = "ToolInputError"; }
}

/**
 * The tool cannot go on without the person: two clients match, the client may already exist, a required
 * choice is missing. The model is told to ask, with the options.
 */
export class ToolQuestion extends Error {
  constructor(message: string, readonly options: Array<RecordRef & { detail?: string | null }> = []) { super(message); this.name = "ToolQuestion"; }
}

/** Every item of a multi-record change was refused; the message is the module's own, for the first one. */
export class ItemsFailedError extends Error {
  constructor(readonly failures: Array<{ id: string; label: string; message: string }>) { super(failures[0]?.message ?? "Nothing could be changed."); this.name = "ItemsFailedError"; }
}
