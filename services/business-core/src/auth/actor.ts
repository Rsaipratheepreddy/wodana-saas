import type { ViewAsContext } from "./view-as/view-as.context";

export interface RequestActor {
  subject: string;
  email: string;
  displayName: string;
  provider: string;
  sessionId?: string;
  authenticationMethods?: string[];
  mfaVerifiedAt?: Date;
  mfaSessionVersion?: number;
  mfaEnrollmentDeadline?: Date;
  /** Set by `ViewAsGuard` while this sign-in session views the workspace as someone (read-only). */
  viewAs?: ViewAsContext;
}

export interface ActorUser extends RequestActor {
  userId: string;
}
