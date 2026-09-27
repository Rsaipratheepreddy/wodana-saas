import { key, useT } from '../core/i18n';
import { Chip, type ChipTone } from './primitives';

/**
 * One status, one chip, the same colour for the same meaning everywhere: neutral (draft), blue (in
 * progress), amber (waiting / at risk), red (blocked / overdue), green (done), grey (cancelled).
 */
const STATUS: Record<string, [string, ChipTone]> = {
  draft: [key('Draft'), 'neutral'],
  pending: [key('Waiting'), 'warning'],
  submitted: [key('Submitted'), 'warning'],
  approved: [key('Approved'), 'success'],
  rejected: [key('Not approved'), 'danger'],
  returned: [key('Sent back'), 'warning'],
  withdrawn: [key('Withdrawn'), 'neutral'],
  cancelled: [key('Cancelled'), 'neutral'],
  cancellation_pending: [key('Cancelling'), 'warning'],
  todo: [key('To do'), 'neutral'],
  in_progress: [key('In progress'), 'info'],
  in_review: [key('In review'), 'warning'],
  done: [key('Done'), 'success'],
  active: [key('Active'), 'info'],
  on_hold: [key('On hold'), 'warning'],
  completed: [key('Completed'), 'success'],
  archived: [key('Archived'), 'neutral'],
  pending_approval: [key('To approve'), 'warning'],
  sent: [key('Sent'), 'info'],
  confirmed: [key('Confirmed'), 'info'],
  partly_received: [key('Part received'), 'info'],
  received: [key('Received'), 'success'],
  closed: [key('Closed'), 'neutral'],
  planned: [key('Planned'), 'neutral'],
  released: [key('Released'), 'info'],
  in_production: [key('In production'), 'info'],
  ready: [key('Ready'), 'success'],
  short_closed: [key('Short closed'), 'neutral'],
  valid: [key('Valid'), 'success'],
  expiring: [key('Expiring'), 'warning'],
  expired: [key('Expired'), 'danger'],
  missing_checkout: [key('No check-out'), 'danger'],
  checked_in: [key('Checked in'), 'info'],
  needs_review: [key('To review'), 'warning'],
  complete: [key('Complete'), 'success'],
  on_leave: [key('On leave'), 'info'],
  not_checked_in: [key('Not in'), 'neutral'],
  new: [key('New'), 'info'],
  attempting_contact: [key('Contacting'), 'info'],
  connected: [key('Connected'), 'info'],
  nurturing: [key('Nurturing'), 'info'],
  qualified: [key('Qualified'), 'success'],
  disqualified: [key('Disqualified'), 'neutral'],
  paused: [key('Paused'), 'warning'],
  duplicate: [key('Duplicate'), 'neutral'],
  open: [key('Open'), 'info'],
  won: [key('Won'), 'success'],
  lost: [key('Lost'), 'neutral'],
  abandoned: [key('Abandoned'), 'neutral'],
  in_transit: [key('On the way'), 'info'],
  on_track: [key('On track'), 'success'],
  at_risk: [key('At risk'), 'warning'],
  off_track: [key('Off track'), 'danger'],
  upcoming: [key('Upcoming'), 'neutral'],
  current: [key('Current'), 'info'],
  skipped: [key('Skipped'), 'neutral'],
  issued: [key('Issued'), 'info'],
  accepted: [key('Accepted'), 'success'],
  refused: [key('Refused'), 'danger'],
  reimbursed: [key('Paid'), 'success'],
  minor: [key('Minor'), 'neutral'],
  major: [key('Major'), 'warning'],
  critical: [key('Critical'), 'danger'],
  overdue: [key('Overdue'), 'danger'],
  blocked: [key('Blocked'), 'danger'],
  urgent: [key('Urgent'), 'danger'],
  high: [key('High'), 'warning'],
};

export const statusLabel = (status: string) => STATUS[status]?.[0] ?? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const statusTone = (status: string): ChipTone => STATUS[status]?.[1] ?? 'neutral';

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const t = useT();
  return <Chip label={label ?? t(statusLabel(status))} tone={statusTone(status)} />;
}
