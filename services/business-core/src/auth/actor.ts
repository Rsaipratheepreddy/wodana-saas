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
  /**
   * Set for a call from a connected AI app (MCP, W-5): the person its access token acts as, already verified
   * from the token (connection not revoked, token not expired). Everything runs under their own permissions.
   */
  mcp?: { userId: string; connectionId: string; tokenId: string; clientName: string };
}

export interface ActorUser extends RequestActor {
  userId: string;
}
