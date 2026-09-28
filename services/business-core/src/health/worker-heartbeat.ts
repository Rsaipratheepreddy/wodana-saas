import { createClient } from "redis";

/** Written by the Python worker every loop (wodana_intelligence/worker/runtime.py, CrmWorker.heartbeat_key). */
export const WORKER_HEARTBEAT_KEY = "wodana:worker:heartbeat";
/** The worker loops every few seconds; two minutes without a beat means it has stopped. */
export const WORKER_STALE_SECONDS = 120;
/**
 * A freshly started Business Core waits this long before a missing or stale worker makes it not ready,
 * so a first deploy can start the core, then the worker that depends on it.
 */
export const WORKER_STARTUP_GRACE_SECONDS = 180;

export type WorkerBeat = {
  status: "ok" | "stale" | "not-reporting";
  /** "ok", "stale (Ns)" or "not-reporting" (no beat within its one-day expiry: never started, or long gone). */
  label: string;
  at: string | null;
  ageSeconds: number | null;
  /** The release whose worker wrote the beat, and its delivery mode (live, test or unconfigured). */
  release: string | null;
  adapter: string | null;
};

export function readWorkerBeat(raw: string | null, now = Date.now()): WorkerBeat {
  if (!raw) return { status: "not-reporting", label: "not-reporting", at: null, ageSeconds: null, release: null, adapter: null };
  let payload: { at?: unknown; release?: unknown; adapter?: unknown } = {};
  try { payload = JSON.parse(raw) as typeof payload; } catch { /* unreadable counts as stale */ }
  const at = Date.parse(String(payload.at));
  const age = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null);
  const common = { at: age === null ? null : new Date(at).toISOString(), ageSeconds: age, release: text(payload.release), adapter: text(payload.adapter) };
  if (age !== null && age <= WORKER_STALE_SECONDS) return { status: "ok", label: "ok", ...common };
  return { status: "stale", label: `stale (${age === null ? "unreadable" : `${age}s`})`, ...common };
}

/** "ok", "stale (Ns)" or "not-reporting". */
export function workerHeartbeat(raw: string | null, now = Date.now()) {
  return readWorkerBeat(raw, now).label;
}

/** The latest beat, or null when Redis isn't configured; throws when Redis can't be reached. */
export async function fetchWorkerBeat(redisUrl: string | undefined | null): Promise<WorkerBeat | null> {
  if (!redisUrl) return null;
  const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    return readWorkerBeat(await redis.get(WORKER_HEARTBEAT_KEY));
  } finally {
    if (redis.isOpen) await redis.quit().catch(() => redis.destroy());
  }
}
