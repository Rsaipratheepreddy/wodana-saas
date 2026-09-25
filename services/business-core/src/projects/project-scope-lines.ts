import type { ProjectData, ReleasedScopeLine } from "./execution.types";

/**
 * Returns the contractual scope that is currently executable. Deducted lines
 * remain in the audit trail but are deliberately excluded from new planning.
 */
export function activeReleasedScopeLines(data: ProjectData): ReleasedScopeLine[] {
  const deducted = new Set(
    (data.variations ?? [])
      .filter((variation) => variation.direction === "deduction")
      .flatMap((variation) => variation.lines)
      .map((line) => line.deductsLineId)
      .filter((id): id is string => Boolean(id)),
  );
  return [
    ...(data.scope?.lines ?? []),
    ...(data.variations ?? [])
      .filter((variation) => variation.direction !== "deduction")
      .flatMap((variation) => variation.lines),
  ].filter((line) => !deducted.has(line.id));
}

