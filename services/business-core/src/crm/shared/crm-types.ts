import { createHash, randomUUID } from "node:crypto";

export interface PageCursor {
  value: string;
  id: string;
}

export interface DomainChange {
  workspaceId: string;
  actorUserId: string | null;
  source: "user" | "integration" | "automation" | "system";
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlationId?: string;
  causationId?: string | null;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value?: string): PageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !parsed || typeof parsed !== "object"
      || typeof (parsed as PageCursor).value !== "string"
      || typeof (parsed as PageCursor).id !== "string"
    ) {
      return null;
    }
    return parsed as PageCursor;
  } catch {
    return null;
  }
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function correlationId(value?: string): string {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : randomUUID();
}

export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

export function normalizeEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeLoosePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}
