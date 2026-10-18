import type { ChangeStatus } from "../change-requests/change-request.domain";

/**
 * Free design revisions, then a chargeable change (PLM-049/051): the pure rules. A step's revisions are counted from
 * the client's "changes requested" records on its deliverables, never from a typed counter. The firm's design package
 * includes a number of free revisions per step (frozen on the journey when it starts; 2 when the package doesn't say).
 * The ask beyond them drafts a change request for the extra revision; the revision itself starts once that change is
 * approved, and paid where the firm's change rules ask for payment before the work.
 */
export const DEFAULT_INCLUDED_REVISIONS = 2;

/** The free revisions per step: the package's number, else the default. */
export function includedRevisions(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_INCLUDED_REVISIONS;
}

/**
 * The revisions a step has used: the most changes asked on any one of its deliverables (its presentation rounds, or one
 * of its files), so files reviewed side by side in the same round use one revision, not one each.
 */
export function changesAsked(input: { presentations: number; files: readonly number[] }) {
  return Math.max(0, input.presentations, ...input.files);
}

/** What a new ask for changes is: the n-th revision of the step, free within the package, else chargeable. */
export function askKind(asked: number, included: number): { revision: number; chargeable: boolean } {
  return { revision: asked, chargeable: asked > included };
}

/** The change request of an extra revision as it stands: its status and whether the payment the firm asks for before the work is in. */
export type ExtraChange = { status: ChangeStatus; paid: boolean };

/** Approved by the client (applied, on a started project) and paid where the firm's rules ask for it before the work. */
export function extraRevisionAgreed(change: ExtraChange | null | undefined) {
  return Boolean(change && (change.status === "approved" || change.status === "applied") && change.paid);
}

/** A change that will never be agreed as it is: the client declined it or the team withdrew it. */
export const extraRevisionClosed = (change: ExtraChange | null | undefined) => Boolean(change && (change.status === "declined" || change.status === "withdrawn"));

export type ExtraRevisionState = "waiting" | "agreed" | "declined";

export type StepRevisions = {
  /** Revisions asked for on the step (changes requested). */
  used: number;
  /** Free revisions the package includes. */
  included: number;
  /** The step went beyond its free revisions. */
  chargeable: boolean;
  /** The extra revision being asked for now (the latest one beyond the free ones), with its change request. */
  extra: null | {
    revision: number; changeRequestId: string | null; reference: string | null; status: ChangeStatus | null; projectId: string | null;
    state: ExtraRevisionState;
  };
  /** The next revision can't start until the extra revision is agreed. */
  waiting: boolean;
};

/**
 * A step's revision state: how many it used of the free ones and, beyond them, the extra revision's change and whether
 * the step waits for it. `link` is the change linked to the latest revision asked for (none when it was never drafted).
 */
export function stepRevisions(used: number, included: number, link: null | { revision: number; changeRequestId: string; reference: string; projectId: string | null; change: ExtraChange }): StepRevisions {
  const chargeable = used > included;
  if (!chargeable) return { used, included, chargeable, extra: null, waiting: false };
  const current = link && link.revision === used ? link : null;
  const agreed = extraRevisionAgreed(current?.change);
  const state: ExtraRevisionState = agreed ? "agreed" : extraRevisionClosed(current?.change) ? "declined" : "waiting";
  return {
    used, included, chargeable, waiting: !agreed,
    extra: { revision: used, changeRequestId: current?.changeRequestId ?? null, reference: current?.reference ?? null, status: current?.change.status ?? null,
      projectId: current?.projectId ?? null, state },
  };
}

/** The title of the change request an extra revision drafts. */
export const extraRevisionTitle = (stepLabel: string) => `Extra revision: ${stepLabel}`.slice(0, 240);

/** Why the next revision of a step can't start yet. */
export const WAITING_FOR_EXTRA_REVISION = "Waiting for the extra revision to be agreed";
