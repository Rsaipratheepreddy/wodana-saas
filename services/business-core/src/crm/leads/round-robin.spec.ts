import { describe, expect, it } from "vitest";
import { inTurnOrder, queueAssignmentMode, takeTurn } from "./round-robin";

const people = ["c", "a", "b"].map((membershipId) => ({ membershipId }));

describe("round-robin turns", () => {
  it("orders the queue by membership, so a turn names the same person every time", () => {
    expect(inTurnOrder(people).map((person) => person.membershipId)).toEqual(["a", "b", "c"]);
  });

  it("gives each person a turn in order and wraps around", () => {
    const ordered = inTurnOrder(people);
    let cursor = 0;
    const picked: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const turn = takeTurn(ordered, cursor, () => true)!;
      picked.push(turn.person.membershipId);
      cursor = turn.next;
    }
    expect(picked).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("passes over someone who can't take it now, and the next turn continues after the one who took it", () => {
    const ordered = inTurnOrder(people);
    const first = takeTurn(ordered, 1, (person) => person.membershipId !== "b")!;
    expect(first.person.membershipId).toBe("c");
    expect(first.next).toBe(0);
    expect(takeTurn(ordered, first.next, () => true)!.person.membershipId).toBe("a");
  });

  it("returns nobody when no one can take it, and copes with an old or out-of-range cursor", () => {
    expect(takeTurn(inTurnOrder(people), 0, () => false)).toBeNull();
    expect(takeTurn([], 0, () => true)).toBeNull();
    expect(takeTurn(inTurnOrder(people), 7, () => true)!.person.membershipId).toBe("b");
    expect(takeTurn(inTurnOrder(people), -1, () => true)!.person.membershipId).toBe("c");
  });

  it("reads anything but round_robin as balanced", () => {
    expect(queueAssignmentMode("round_robin")).toBe("round_robin");
    expect(queueAssignmentMode(null)).toBe("balanced");
    expect(queueAssignmentMode("other")).toBe("balanced");
  });
});
