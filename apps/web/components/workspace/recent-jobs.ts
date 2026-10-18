/** The jobs this viewer opened lately, newest first (a per-browser convenience for the quick panel; never shared). */
const KEY = "wd-recent-jobs";
const LIMIT = 12;

export function recentJobs(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export function rememberJob(jobId: string) {
  try { window.localStorage.setItem(KEY, JSON.stringify([jobId, ...recentJobs().filter((id) => id !== jobId)].slice(0, LIMIT))); } catch { /* storage off: nothing to remember */ }
}
