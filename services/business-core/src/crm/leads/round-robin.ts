/**
 * How a Sales queue shares new enquiries and chats among its people:
 *   balanced     the eligible person with the lightest load against their capacity and weight (the cursor breaks ties);
 *   round_robin  strict turns through the queue's people, whatever their load (capacity still caps).
 */
export const QUEUE_ASSIGNMENT_MODES = ["balanced", "round_robin"] as const;
export type QueueAssignmentMode = (typeof QUEUE_ASSIGNMENT_MODES)[number];

export const queueAssignmentMode = (value: unknown): QueueAssignmentMode => (value === "round_robin" ? "round_robin" : "balanced");

/** The queue's people in their fixed turn order (by membership), so a turn means the same person on every call. */
export function inTurnOrder<T extends { membershipId: string }>(people: readonly T[]): T[] {
  return [...people].sort((left, right) => (left.membershipId < right.membershipId ? -1 : left.membershipId > right.membershipId ? 1 : 0));
}

/**
 * Strict turns: starting at the person the cursor points to, the first one who can take it now gets it, and the cursor
 * moves to the person after them. Someone who can't take it now (away, full, the wrong skill, the owner it is taken
 * from) is passed over for this turn only. Null when nobody can take it; the cursor then stays where it is.
 */
export function takeTurn<T>(people: readonly T[], cursor: number, canTake: (person: T) => boolean): { person: T; next: number } | null {
  const size = people.length;
  if (!size) return null;
  const start = ((Math.trunc(Number.isFinite(cursor) ? cursor : 0) % size) + size) % size;
  for (let step = 0; step < size; step += 1) {
    const index = (start + step) % size;
    if (canTake(people[index])) return { person: people[index], next: (index + 1) % size };
  }
  return null;
}
