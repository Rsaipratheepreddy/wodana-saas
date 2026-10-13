import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The portal's home (plan §5b, §6.22, AI2), built only from the client's own projection of the project — what the
 * tenant shows and staff published, field by field — so nothing reaches the feed or the digest that the client
 * couldn't already see:
 *   - the feed: typed cards, newest first (days on site, updates, designs and concepts shared, documents, quotes and
 *     changes sent, invoices and payments, the team's replies, handover packs);
 *   - "what changed since you last looked": the same events counted since this contact's previous visit, worded by
 *     the web app (a deterministic summary; AI wording is optional and not needed for it).
 */
export type FeedKind = "day" | "update" | "design" | "presentation" | "document" | "quote" | "change" | "invoice" | "payment" | "reply" | "handover" | "choice";
export type FeedCard = { kind: FeedKind; id: string; at: string; title: string; note: string | null; status: string | null };

/** The fields of a client projection the feed reads (every one already passed the projection's allow-list). */
export type FeedSource = {
  progress: null | {
    updates: Array<{ id: string; at: string; text: string }>;
    cards?: Array<{ id: string; date: string; sentAt: string; summary: string }>;
  };
  /** The design review's versions (the review keeps them loosely typed; the feed reads id, number, status and when shared). */
  design?: null | { designs: Array<{ title: string; versions: Array<Record<string, unknown>> }> };
  choices?: null | {
    presentations: Array<{ id: string; label: string; round: number; status: string; presentedAt: string | null }>;
    choices: Array<{ entryId: string; versionId: string; title: string; number: number; status: string; recordedAt?: string | null }>;
  };
  decisions: null | {
    quotes: Array<{ id: string; title: string; number: number; status: string; issuedAt: string | null; expired?: boolean }>;
    handovers: Array<{ id: string; title: string; revision: number; status: string; issuedAt: string }>;
  };
  documents: null | Array<{ id: string; kind: string; title: string; date: string | null; version?: number; changed?: boolean; at?: string | null }>;
  payments: null | { milestones: Array<{ id: string; title: string; status: string; left: string | null; invoice: { id: string; number: string; issueDate: string } | null;
    receipts: Array<{ id: string; amount: string | null; receivedOn: string | null }> }> };
  messages: null | { requests: Array<{ id: string; title: string; comments: Array<{ id: string; at: string; text: string; fromClient: boolean }> }> };
  changes?: Array<{ id: string; reference: string; title: string; status: string; sharedAt: string | null; decidedAt: string | null; createdAt: string; raisedByClient: boolean }> | null;
};

const day = (date: string) => `${date.slice(0, 10)}T00:00:00.000Z`;

/** Every event of the projection as a typed card, newest first. */
export function feedCards(project: FeedSource, limit = 40): FeedCard[] {
  const cards: FeedCard[] = [];
  for (const card of project.progress?.cards ?? []) cards.push({ kind: "day", id: card.id, at: card.sentAt, title: card.date, note: card.summary || null, status: null });
  for (const update of project.progress?.updates ?? []) cards.push({ kind: "update", id: update.id, at: update.at, title: update.text, note: null, status: null });
  for (const design of project.design?.designs ?? [])
    for (const version of design.versions)
      if (typeof version.sharedAt === "string" && typeof version.id === "string")
        cards.push({ kind: "design", id: version.id, at: version.sharedAt, title: `${design.title} · V${String(version.number)}`, note: null, status: typeof version.status === "string" ? version.status : null });
  for (const presentation of project.choices?.presentations ?? [])
    if (presentation.presentedAt) cards.push({ kind: "presentation", id: presentation.id, at: presentation.presentedAt, title: presentation.label, note: `R${presentation.round}`, status: presentation.status });
  for (const choice of project.choices?.choices ?? [])
    if (choice.recordedAt && choice.number > 1) cards.push({ kind: "choice", id: choice.versionId, at: choice.recordedAt, title: `${choice.title} · V${choice.number}`, note: null, status: choice.status });
  for (const document of project.documents ?? [])
    if (document.at || document.date) cards.push({ kind: "document", id: `${document.kind}:${document.id}`, at: document.at ?? day(document.date!), title: document.title,
      note: document.version ? `V${document.version}` : null,
      status: document.changed ? "changed" : null });
  for (const quote of project.decisions?.quotes ?? [])
    // QA-016: a quotation past its validity reads Expired (the client asks for a new version), not Waiting for you.
    if (quote.issuedAt) cards.push({ kind: "quote", id: quote.id, at: quote.issuedAt, title: `${quote.title} · V${quote.number}`, note: null,
      status: quote.expired && quote.status === "issued" ? "expired" : quote.status });
  for (const pack of project.decisions?.handovers ?? []) cards.push({ kind: "handover", id: pack.id, at: pack.issuedAt, title: `${pack.title} · R${pack.revision}`, note: null, status: pack.status });
  for (const change of project.changes ?? []) {
    const at = change.decidedAt ?? change.sharedAt ?? (change.raisedByClient ? change.createdAt : null);
    if (at) cards.push({ kind: "change", id: change.id, at, title: `${change.reference} · ${change.title}`, note: null, status: change.status });
  }
  for (const milestone of project.payments?.milestones ?? []) {
    if (milestone.invoice) cards.push({ kind: "invoice", id: milestone.id, at: day(milestone.invoice.issueDate), title: `${milestone.invoice.number} · ${milestone.title}`, note: milestone.left,
      status: milestone.status });
    for (const receipt of milestone.receipts) if (receipt.receivedOn)
      cards.push({ kind: "payment", id: receipt.id, at: day(receipt.receivedOn), title: milestone.title, note: receipt.amount, status: null });
  }
  for (const request of project.messages?.requests ?? []) {
    const reply = [...request.comments].reverse().find((comment) => !comment.fromClient);
    if (reply) cards.push({ kind: "reply", id: request.id, at: reply.at, title: request.title, note: reply.text, status: null });
  }
  return cards.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.kind.localeCompare(b.kind))).slice(0, limit);
}

export type Digest = { since: string; items: Array<{ kind: FeedKind; count: number; titles: string[] }> };

/**
 * AI2, deterministic: what happened since `since`, by kind (how many, and the first few titles). Nothing on a first
 * visit (there is no "last time"); the client's own actions are not news to them.
 */
export function whatChanged(project: FeedSource, since: string | null): Digest | null {
  if (!since) return null;
  const fresh = feedCards(project, 500).filter((card) => card.at > since && card.status !== "with_team");
  const kinds = new Map<FeedKind, string[]>();
  for (const card of fresh) kinds.set(card.kind, [...(kinds.get(card.kind) ?? []), card.title]);
  return { since, items: [...kinds].map(([kind, titles]) => ({ kind, count: titles.length, titles: titles.slice(0, 3) })) };
}

/** A visit counts once per half hour of use: the previous visit is what "since you last looked" starts from. */
const SESSION_MINUTES = 30;

/** When each of the contact's grants last looked before this visit, and records this visit. */
export async function recordVisits(db: Db, workspaceId: string, grantIds: string[]) {
  const since = new Map<string, string | null>();
  for (const grantId of grantIds) {
    const row = (await db.query<{ previous: Date | null }>(
      `INSERT INTO client_portal_visits (workspace_id, grant_id, last_seen_at, previous_seen_at) VALUES ($1, $2, now(), NULL)
       ON CONFLICT (workspace_id, grant_id) DO UPDATE SET
         previous_seen_at = CASE WHEN client_portal_visits.last_seen_at < now() - make_interval(mins => ${SESSION_MINUTES}) THEN client_portal_visits.last_seen_at
                                 ELSE client_portal_visits.previous_seen_at END,
         last_seen_at = now()
       RETURNING previous_seen_at AS previous`, [workspaceId, grantId])).rows[0];
    since.set(grantId, row?.previous ? new Date(row.previous).toISOString() : null);
  }
  return since;
}
