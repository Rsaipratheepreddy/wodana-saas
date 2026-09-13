export interface RequestActor {
  subject: string;
  email: string;
  displayName: string;
  provider: string;
}

export interface ActorUser extends RequestActor {
  userId: string;
}

