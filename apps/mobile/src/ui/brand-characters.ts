// The brand characters bundled with the app. The files are copies of packages/brand (node packages/brand/sync.mjs);
// Metro needs each require spelled out, so the tables list every file.
import type { AvatarRole, AvatarVariant, WoddyPose } from '../../../../packages/contracts/src/brand';
import { avatarVariant, roleAvatarKey } from '../../../../packages/contracts/src/brand';

/* eslint-disable @typescript-eslint/no-require-imports */
const avatars: Record<`${AvatarRole}-${AvatarVariant}`, number> = {
  'owner-f': require('../../assets/brand/avatars/owner-f.webp'),
  'owner-m': require('../../assets/brand/avatars/owner-m.webp'),
  'sales-f': require('../../assets/brand/avatars/sales-f.webp'),
  'sales-m': require('../../assets/brand/avatars/sales-m.webp'),
  'designer-f': require('../../assets/brand/avatars/designer-f.webp'),
  'designer-m': require('../../assets/brand/avatars/designer-m.webp'),
  'estimator-f': require('../../assets/brand/avatars/estimator-f.webp'),
  'estimator-m': require('../../assets/brand/avatars/estimator-m.webp'),
  'project_manager-f': require('../../assets/brand/avatars/project_manager-f.webp'),
  'project_manager-m': require('../../assets/brand/avatars/project_manager-m.webp'),
  'site_supervisor-f': require('../../assets/brand/avatars/site_supervisor-f.webp'),
  'site_supervisor-m': require('../../assets/brand/avatars/site_supervisor-m.webp'),
  'purchasing-f': require('../../assets/brand/avatars/purchasing-f.webp'),
  'purchasing-m': require('../../assets/brand/avatars/purchasing-m.webp'),
  'finance-f': require('../../assets/brand/avatars/finance-f.webp'),
  'finance-m': require('../../assets/brand/avatars/finance-m.webp'),
  'people-f': require('../../assets/brand/avatars/people-f.webp'),
  'people-m': require('../../assets/brand/avatars/people-m.webp'),
  'factory-f': require('../../assets/brand/avatars/factory-f.webp'),
  'factory-m': require('../../assets/brand/avatars/factory-m.webp'),
  'carpenter-f': require('../../assets/brand/avatars/carpenter-f.webp'),
  'carpenter-m': require('../../assets/brand/avatars/carpenter-m.webp'),
  'electrician-f': require('../../assets/brand/avatars/electrician-f.webp'),
  'electrician-m': require('../../assets/brand/avatars/electrician-m.webp'),
  'painter-f': require('../../assets/brand/avatars/painter-f.webp'),
  'painter-m': require('../../assets/brand/avatars/painter-m.webp'),
  'installer-f': require('../../assets/brand/avatars/installer-f.webp'),
  'installer-m': require('../../assets/brand/avatars/installer-m.webp'),
  'client-f': require('../../assets/brand/avatars/client-f.webp'),
  'client-m': require('../../assets/brand/avatars/client-m.webp'),
  'default-f': require('../../assets/brand/avatars/default-f.webp'),
  'default-m': require('../../assets/brand/avatars/default-m.webp'),
};

export const woddy: Record<WoddyPose, number> = {
  main: require('../../assets/brand/woddy/main.webp'),
  hello: require('../../assets/brand/woddy/hello.webp'),
  thinking: require('../../assets/brand/woddy/thinking.webp'),
  working: require('../../assets/brand/woddy/working.webp'),
  celebrating: require('../../assets/brand/woddy/celebrating.webp'),
  oops: require('../../assets/brand/woddy/oops.webp'),
  idle: require('../../assets/brand/woddy/idle.webp'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The default picture for a person: their main role's avatar, woman or man chosen from the seed (their id). */
export function roleAvatar(roles: ReadonlyArray<string | null | undefined> | string | null | undefined, seed: string | null | undefined): number {
  return avatars[`${roleAvatarKey(roles)}-${avatarVariant(seed)}`];
}
