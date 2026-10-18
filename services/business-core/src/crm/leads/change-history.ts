/** PLM-094: field-level changes (from → to) derived from immutable audit before/after snapshots. */
export type FieldChange = { field: string; from: string | null; to: string | null };

const IGNORED = new Set(["id", "version", "workspaceId", "createdAt", "updatedAt", "created_at", "updated_at", "correlationId", "assignment", "explanation", "activityId", "opportunities", "qualification", "qualificationState", "assignments", "sla", "enquiry"]);

function flatten(value: unknown, prefix = "", into: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value) && depth < 2) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (IGNORED.has(key)) continue;
      flatten(inner, prefix ? `${prefix}.${key}` : key, into, depth + 1);
    }
    return into;
  }
  if (prefix) into[prefix] = value;
  return into;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join(", ") : null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  const from = flatten(before ?? {});
  const to = flatten(after ?? {});
  const fields = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  return fields
    .map((field) => ({ field, from: text(from[field]), to: text(to[field]) }))
    .filter((change) => change.from !== change.to && (before !== null && before !== undefined ? true : change.to !== null));
}
