import { useAuth } from '../auth/provider';
import type { Membership, Profile, TenantModuleId } from '../auth/client';
import { makeAccess, type Access } from './access';

export type Session = Access & {
  profile: Profile;
  membership: Membership;
  workspaceId: string;
  /** This person inside the workspace (assignee and owner fields hold it). */
  membershipId: string;
  /** The person's user id (authors of site reports, who fixed a snag). */
  userId: string;
};

/**
 * The signed-in person in the active workspace. What they can see and do comes only from the server's
 * permission codes and modules — never from role names — and the server still decides every request.
 */
let last: Session | null = null;

export function useSession(): Session {
  const { state } = useAuth();
  if (state.status !== 'signedIn') {
    // Signing out unmounts the signed-in screens; for that last render they keep the old session.
    if (last) return last;
    throw new Error('useSession is only available while signed in.');
  }
  const membership = state.profile.memberships.find((item) => item.workspaceId === state.workspaceId)!;
  return last = {
    ...makeAccess(membership.allowedPermissions ?? [], membership.allowedModules as TenantModuleId[]),
    profile: state.profile,
    membership,
    workspaceId: state.workspaceId,
    membershipId: membership.id ?? '',
    userId: state.profile.id,
  };
}
