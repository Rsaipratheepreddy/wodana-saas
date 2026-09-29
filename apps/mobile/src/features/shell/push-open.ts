import { appRouteFor } from '../../core/deep-links';

/**
 * What a tapped push carries (the worker sends `notificationId`, `workspaceId` and `deepLink`) and what
 * opening it does, without native code so node tests can import it.
 */
export type PushData = Record<string, unknown> | null | undefined;
export type PushOpening = {
  /** The app screen for its link; null when the app can't read the link (the server is asked). */
  route: string | null;
  /** The notice to mark opened on the server (and to resolve when `route` is null). */
  notificationId: string | null;
  /** Sent for another workspace than the one signed in: nothing opens in this one. */
  otherWorkspace: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

export function pushOpening(data: PushData, workspaceId: string): PushOpening {
  const workspace = text(data?.workspaceId);
  const notificationId = text(data?.notificationId);
  return {
    route: appRouteFor(text(data?.deepLink) ?? text(data?.url)),
    notificationId: notificationId && UUID.test(notificationId) ? notificationId : null,
    otherWorkspace: !!workspace && workspace !== workspaceId,
  };
}
