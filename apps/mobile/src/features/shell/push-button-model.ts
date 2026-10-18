import type { T } from '../../core/i18n';
import { OPEN_ACTION } from './approval-action-model';

/** Dismisses the notice without opening anything (a "Later" button). */
export const LATER_ACTION = 'later';
export type PushButtonSet = 'open' | 'review' | 'reply' | 'pay';

/**
 * §0.3 Push like a delivery app: the button each moment's push shows, chosen by the firm in Setup → Push
 * notifications (the server sends it as the push's category). Every button but Later opens the push's own screen.
 */
export function pushButtons(t: T): Record<PushButtonSet, Array<{ identifier: string; buttonTitle: string; options: { opensAppToForeground: boolean } }>> {
  const opens = (title: string) => ({ identifier: OPEN_ACTION, buttonTitle: title, options: { opensAppToForeground: true } });
  return {
    open: [opens(t('Open'))],
    review: [opens(t('Review')), { identifier: LATER_ACTION, buttonTitle: t('Later'), options: { opensAppToForeground: false } }],
    reply: [opens(t('Reply'))],
    pay: [opens(t('Pay now'))],
  };
}

export const isLater = (actionIdentifier: string | null | undefined) => actionIdentifier === LATER_ACTION;
