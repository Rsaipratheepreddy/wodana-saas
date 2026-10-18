import type { DayCard, DayFeed, DayReport } from '../../../../web/lib/site/types';

/** The project's days on the phone: one card per day with a report, and a marker for each working day without one; newest first. Pure. */
export type FeedItem = { key: string; date: string; card: DayCard | null };

export function feedItems(feed: DayFeed | undefined | null): FeedItem[] {
  if (!feed) return [];
  return [...feed.cards.map((card) => ({ key: card.date, date: card.date, card })), ...feed.missing.map((date) => ({ key: `missing-${date}`, date, card: null }))]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** A day's work as lines: what was finished (done), what moved forward (with how far), and what was installed. */
export function workLines(card: DayCard) {
  return card.work.map((item) => ({
    id: item.id, title: item.title, done: item.kind === 'installed' || (item.progress ?? 0) >= 100,
    progress: item.kind === 'task' && item.progress !== null && item.progress < 100 ? item.progress : null,
    quantity: item.kind === 'installed' ? { value: item.quantity ?? '0', unit: item.unit } : null,
    stage: item.stageName,
  }));
}

/** The report of a day the phone opens: mine first (to continue or read), else the first waiting for review, else the first. */
export function reportToOpen(card: DayCard, me: string): DayReport | null {
  return card.reports.find((report) => report.authorId === me) ?? card.reports.find((report) => report.status === 'submitted') ?? card.reports[0] ?? null;
}

/** Issues still open, the most serious first (the card's own order already is). */
export const openIssues = (card: DayCard) => card.issues.filter((issue) => issue.status === 'open');
