import { SetMetadata } from "@nestjs/common";

export const ALLOW_DURING_VIEW_AS_KEY = "wodana:allow-during-view-as";
export const HIDDEN_DURING_VIEW_AS_KEY = "wodana:hidden-during-view-as";

/** A route the viewer still needs while viewing as someone: leaving the session. It runs as the viewer, not read-only. */
export const AllowDuringViewAs = () => SetMetadata(ALLOW_DURING_VIEW_AS_KEY, true);

/**
 * A read that stays private to the person even from an owner viewing as them: HR documents, security settings
 * and sessions, personal drafts and private to-dos. Refused with `view_as_private` while viewing as someone.
 */
export const HiddenDuringViewAs = () => SetMetadata(HIDDEN_DURING_VIEW_AS_KEY, true);
