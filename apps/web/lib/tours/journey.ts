/**
 * The job a tour follows, picked before it starts so every step shows real work on the same job:
 * - `furthest-job`: the one that has gone furthest (a released project and its planning case);
 * - `quote-in-progress`: a case whose quote is still being prepared (a draft with lines), for the quoting tour.
 * Read-only lookups (GET), so they pass the demo guard; nothing is chosen by a fixed id.
 */
export type JourneyRecords = { case?: string; project?: string };
export type JourneyMode = "furthest-job" | "quote-in-progress";

export type JourneyCase = { id: string; projectId?: string | null; status?: string; qualifiedLead?: boolean };
export type JourneyProject = { id: string; status?: string; stage?: { position: number; count: number } | null };
export type JourneyQuote = { status: string; kind?: string; round?: string; lines?: unknown[] };

const DONE = new Set(["completed"]);
const GONE = new Set(["cancelled", "archived"]);
/** How many planning cases are looked into for a quote in progress. */
const LOOK_INTO = 8;

/** How far a project has got: finished first, then the furthest stage. */
function progress(project: JourneyProject | undefined): number {
  if (!project) return -1;
  if (project.status && DONE.has(project.status)) return 2;
  return project.stage && project.stage.count ? project.stage.position / project.stage.count : 0;
}

/** Real planning cases: never a qualified lead that has no case yet, never a cancelled one. */
function realCases(cases: JourneyCase[]) {
  return cases.filter((item) => item.status !== "cancelled" && item.status !== "qualified" && !item.qualifiedLead);
}

/**
 * Prefers a planning case whose project has been released (the furthest along, then the first listed);
 * otherwise the first planning case. Cancelled cases and leads without a case are never picked.
 */
export function pickJourney(cases: JourneyCase[], projects: JourneyProject[]): JourneyRecords {
  const open = realCases(cases);
  const byId = new Map(projects.map((project) => [project.id, project]));
  let best: { item: JourneyCase; score: number } | null = null;
  for (const item of open) {
    const project = item.projectId ? byId.get(item.projectId) : undefined;
    if (!project || (project.status && GONE.has(project.status))) continue;
    const score = progress(project);
    if (!best || score > best.score) best = { item, score };
  }
  if (best) return { case: best.item.id, project: best.item.projectId! };
  return open[0] ? { case: open[0].id } : {};
}

/** A quote someone is still preparing: a draft main quotation with lines first, then any draft with lines, then any quote. */
function quoteScore(quotes: JourneyQuote[]): number {
  const lined = (quote: JourneyQuote) => (quote.lines?.length ?? 0) > 0;
  if (quotes.some((quote) => quote.status === "draft" && lined(quote) && quote.kind === "quotation" && quote.round !== "design")) return 3;
  if (quotes.some((quote) => quote.status === "draft" && lined(quote))) return 2;
  return quotes.length ? 1 : 0;
}

/** The case (not yet a project) whose quote is still being prepared and has real lines to show; the first listed wins a tie. */
export function pickQuoteInProgress(cases: Array<JourneyCase & { quotes: JourneyQuote[] }>): JourneyRecords {
  let best: { id: string; score: number } | null = null;
  for (const item of cases) {
    const score = quoteScore(item.quotes);
    if (!best || score > best.score) best = { id: item.id, score };
  }
  return best ? { case: best.id } : {};
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function json<T>(request: Fetch, url: string): Promise<T | null> {
  try {
    const response = await request(url, { cache: "no-store" });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

/** Reads the workspace's planning cases (and projects or quotes) and picks the job to follow; empty when nothing is there. */
export async function loadJourney(workspaceId: string, mode: JourneyMode = "furthest-job", request: Fetch = (...args) => fetch(...args)): Promise<JourneyRecords> {
  if (!workspaceId) return {};
  const query = new URLSearchParams({ workspaceId });
  const cases = (await json<{ items?: JourneyCase[] }>(request, `/api/workspace/pre-projects?${query}`))?.items ?? [];
  if (mode === "quote-in-progress") {
    const candidates = realCases(cases).filter((item) => !item.projectId).slice(0, LOOK_INTO);
    const withQuotes = await Promise.all(candidates.map(async (item) => ({
      ...item,
      quotes: (await json<{ data?: { quotes?: JourneyQuote[] } }>(request, `/api/commercial/cases/${encodeURIComponent(item.id)}?${query}`))?.data?.quotes ?? [],
    })));
    return pickQuoteInProgress(withQuotes);
  }
  const projects = (await json<{ projects?: JourneyProject[] }>(request, `/api/project-core/projects?${query}`))?.projects ?? [];
  return pickJourney(cases, projects);
}
