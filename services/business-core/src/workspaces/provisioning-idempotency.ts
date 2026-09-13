import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

export function provisioningRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function assertValidIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new Error(
      "Idempotency-Key must contain 8-160 letters, numbers, dots, underscores, colons, or hyphens",
    );
  }
  return key;
}
