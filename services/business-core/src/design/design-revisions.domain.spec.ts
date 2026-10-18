import { describe, expect, it } from "vitest";
import type { ChangeStatus } from "../change-requests/change-request.domain";
import {
  askKind, changesAsked, DEFAULT_INCLUDED_REVISIONS, extraRevisionAgreed, extraRevisionTitle, includedRevisions, stepRevisions, WAITING_FOR_EXTRA_REVISION,
} from "./design-revisions.domain";

const link = (revision: number, status: ChangeStatus, paid = true) =>
  ({ revision, changeRequestId: "c1", reference: "CR-004", projectId: null, change: { status, paid } });

describe("free design revisions, then a chargeable change (PLM-049/051)", () => {
  it("takes the package's free revisions, 2 when the package doesn't say", () => {
    expect(DEFAULT_INCLUDED_REVISIONS).toBe(2);
    expect(includedRevisions(null)).toBe(2);
    expect(includedRevisions(undefined)).toBe(2);
    expect(includedRevisions(-1)).toBe(2);
    expect(includedRevisions(1.5)).toBe(2);
    expect(includedRevisions(0)).toBe(0);
    expect(includedRevisions(4)).toBe(4);
  });

  it("counts a step's revisions from the changes asked: the most on any one deliverable", () => {
    expect(changesAsked({ presentations: 0, files: [] })).toBe(0);
    expect(changesAsked({ presentations: 2, files: [] })).toBe(2);
    // Files reviewed side by side in the same round use one revision, not one each.
    expect(changesAsked({ presentations: 0, files: [1, 1, 1] })).toBe(1);
    expect(changesAsked({ presentations: 1, files: [3, 2] })).toBe(3);
  });

  it("keeps the first N asks free and makes the next one chargeable", () => {
    expect(askKind(1, 2)).toEqual({ revision: 1, chargeable: false });
    expect(askKind(2, 2)).toEqual({ revision: 2, chargeable: false });
    expect(askKind(3, 2)).toEqual({ revision: 3, chargeable: true });
    expect(askKind(1, 0)).toEqual({ revision: 1, chargeable: true });
  });

  it("within the free revisions the step never waits", () => {
    expect(stepRevisions(0, 2, null)).toEqual({ used: 0, included: 2, chargeable: false, extra: null, waiting: false });
    expect(stepRevisions(2, 2, null)).toEqual({ used: 2, included: 2, chargeable: false, extra: null, waiting: false });
  });

  it("beyond them the step waits for the extra revision's change, drafted or not", () => {
    expect(stepRevisions(3, 2, null)).toMatchObject({ chargeable: true, waiting: true, extra: { revision: 3, changeRequestId: null, state: "waiting" } });
    for (const status of ["draft", "pending_approval", "with_client", "pricing", "to_send"] as const)
      expect(stepRevisions(3, 2, link(3, status))).toMatchObject({ waiting: true, extra: { changeRequestId: "c1", reference: "CR-004", status, state: "waiting" } });
  });

  it("an approved change unlocks the revision once it is paid where the firm asks for it", () => {
    expect(extraRevisionAgreed({ status: "approved", paid: true })).toBe(true);
    expect(extraRevisionAgreed({ status: "applied", paid: true })).toBe(true);
    expect(extraRevisionAgreed({ status: "approved", paid: false })).toBe(false);
    expect(extraRevisionAgreed({ status: "with_client", paid: true })).toBe(false);
    expect(extraRevisionAgreed(null)).toBe(false);
    expect(stepRevisions(3, 2, link(3, "approved"))).toMatchObject({ waiting: false, extra: { state: "agreed" } });
    expect(stepRevisions(3, 2, link(3, "applied", false))).toMatchObject({ waiting: true, extra: { state: "waiting" } });
  });

  it("a declined or withdrawn change keeps the step waiting, marked declined", () => {
    expect(stepRevisions(3, 2, link(3, "declined"))).toMatchObject({ waiting: true, extra: { state: "declined" } });
    expect(stepRevisions(3, 2, link(3, "withdrawn"))).toMatchObject({ waiting: true, extra: { state: "declined" } });
  });

  it("each extra revision needs its own change: an agreed one for revision 3 doesn't cover revision 4", () => {
    expect(stepRevisions(4, 2, link(3, "approved"))).toMatchObject({ waiting: true, extra: { revision: 4, changeRequestId: null, state: "waiting" } });
  });

  it("names the change after the step", () => {
    expect(extraRevisionTitle("Concepts")).toBe("Extra revision: Concepts");
    expect(WAITING_FOR_EXTRA_REVISION).toBe("Waiting for the extra revision to be agreed");
  });
});
