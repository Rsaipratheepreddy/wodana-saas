import { HttpException } from "@nestjs/common";
import { ItemsFailedError, ToolInputError, type RecordRef, type ToolProperty, type ToolSchema } from "./ai-tool";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The model's arguments checked against the tool's schema: required fields, types, choices, lengths and
 * list sizes. Unknown fields are dropped; anything that does not fit is refused with the reason, so the
 * model can correct itself. Nothing a tool receives has skipped this.
 */
export function validateToolInput(schema: ToolSchema, value: unknown): Record<string, unknown> {
  const problems: string[] = [];
  const result = checkObject(schema.properties, schema.required ?? [], value, "", problems);
  if (problems.length) throw new ToolInputError(problems.slice(0, 5).join("; "));
  return result ?? {};
}

function checkObject(properties: Record<string, ToolProperty>, required: string[], value: unknown, path: string, problems: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { problems.push(`${path || "input"} must be an object`); return null; }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of required) if (input[key] === undefined || input[key] === null || input[key] === "") problems.push(`${path}${key} is required`);
  for (const [key, property] of Object.entries(properties)) {
    if (input[key] === undefined || input[key] === null || input[key] === "") continue;
    const checked = checkValue(property, input[key], `${path}${key}`, problems);
    if (checked !== undefined) output[key] = checked;
  }
  return output;
}

function checkValue(property: ToolProperty, value: unknown, path: string, problems: string[]): unknown {
  switch (property.type) {
    case "string": {
      if (typeof value !== "string" && typeof value !== "number") { problems.push(`${path} must be text`); return undefined; }
      const text = String(value).trim();
      if (property.maxLength && text.length > property.maxLength) { problems.push(`${path} is longer than ${property.maxLength} characters`); return undefined; }
      if (property.enum && !property.enum.includes(text)) { problems.push(`${path} must be one of: ${property.enum.join(", ")}`); return undefined; }
      return text;
    }
    case "integer":
    case "number": {
      const number = typeof value === "string" && value.trim() ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number) || (property.type === "integer" && !Number.isInteger(number))) { problems.push(`${path} must be a ${property.type}`); return undefined; }
      return number;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      problems.push(`${path} must be true or false`);
      return undefined;
    case "array": {
      if (!Array.isArray(value)) { problems.push(`${path} must be a list`); return undefined; }
      if (property.maxItems !== undefined && value.length > property.maxItems) { problems.push(`${path} has more than ${property.maxItems} items`); return undefined; }
      if (property.minItems !== undefined && value.length < property.minItems) { problems.push(`${path} needs at least ${property.minItems} item(s)`); return undefined; }
      const items = property.items;
      return items ? value.map((item, index) => checkValue(items, item, `${path}[${index}]`, problems)).filter((item) => item !== undefined) : value;
    }
    case "object":
      return checkObject(property.properties ?? {}, property.required ?? [], value, `${path}.`, problems) ?? undefined;
  }
}

/** A uuid argument, or a clear refusal the model can act on. */
export function uuidArg(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ToolInputError(`${name} must be the id of a record you found (a uuid)`);
  return value.toLowerCase();
}

/**
 * Tool results go back to the model as one delimited data block. The JSON cannot close the block (every
 * "<" is escaped), and the system prompt says a block is data: instructions inside records are not followed.
 */
export function dataBlock(tool: string, payload: unknown): string {
  return `<record-data tool="${tool}">\n${JSON.stringify(payload).replace(/</g, "\\u003c")}\n</record-data>`;
}

export function clip(value: unknown, length: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return !text ? null : text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** The module's own message for a refused command (the person sees exactly what the module said). */
export function moduleMessage(error: unknown, fallback = "The action could not be completed."): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message = typeof response === "string" ? response : (response as { message?: unknown })?.message;
    if (Array.isArray(message)) return message.filter((item) => typeof item === "string").join(". ") || fallback;
    if (typeof message === "string" && message.trim()) return message;
    return error.message || fallback;
  }
  if (error instanceof ToolInputError || error instanceof ItemsFailedError) return error.message;
  return fallback;
}

// ---------- time: the workspace's zone ----------

function offsetAt(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** A wall-clock time ("2026-09-30T10:00" or a date) in the workspace's zone, as an instant; null when unreadable. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?(?::\d{2})?$/.exec(local.trim());
  if (!match) return null;
  const [, year, month, day, hour = "09", minute = "00"] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31 || Number(hour) > 23 || Number(minute) > 59) return null;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let instant = wall - offsetAt(wall, timeZone);
  // Across a daylight-saving change the offset at the answer can differ from the first guess.
  const corrected = wall - offsetAt(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** An instant as the workspace's wall-clock time, for the model and the preview ("2026-09-30 10:00, Wednesday"). */
export function zonedWallTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" })
    .formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}, ${part("weekday")}`;
}

/** A tool's date-time argument (the workspace's wall clock) as an ISO instant, or a refusal. */
export function zonedArg(value: unknown, timeZone: string, name: string, now = new Date(), options: { future?: boolean } = {}): string {
  const date = typeof value === "string" ? zonedLocalToUtc(value, timeZone) : null;
  if (!date) throw new ToolInputError(`${name} must be a local date and time like 2026-09-30T10:00`);
  if (options.future && date.getTime() <= now.getTime() + 60_000) throw new ToolInputError(`${name} must be in the future`);
  return date.toISOString();
}

// ---------- where a record opens ----------

export function recordHref(type: string, id: string, parent?: { projectId?: string | null; caseId?: string | null }): string | null {
  switch (type) {
    case "enquiry": return `/workspace/crm/leads?lead=${id}`;
    case "opportunity": return `/workspace/crm/opportunities?record=${id}`;
    case "customer": return `/workspace/crm/customers?record=${id}`;
    case "conversation": return `/workspace/crm/conversations?record=${id}`;
    case "project": return `/workspace/projects/${id}/overview`;
    case "work_item": return parent?.projectId ? `/workspace/projects/${parent.projectId}/plan?item=${id}` : null;
    case "quotation": return parent?.caseId ? `/workspace/pre-projects/cases/${parent.caseId}/quotations` : null;
    default: return null;
  }
}

export function ref(type: string, id: string, label: string, parent?: { projectId?: string | null; caseId?: string | null }): RecordRef {
  return { type, id, label, href: recordHref(type, id, parent) };
}
