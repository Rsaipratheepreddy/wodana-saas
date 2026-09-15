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
}

export interface ActorUser extends RequestActor {
  userId: string;
}
