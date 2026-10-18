"use client";

import { useEffect, useMemo, useState } from "react";
import type { JourneyChapter } from "./journey";

/**
 * §0.3 P10: the one place a screen learns what's next for a record: its job's journey, read in batches from the server.
 * Lists and record pages use this instead of working the next step out themselves.
 */
export type RecordType = "lead" | "opportunity" | "case" | "project";
export type JobNow = {
  type: RecordType; id: string; jobId: string; reference: string; chapter: JourneyChapter | null;
  now: { label: string; owner: string | null; dueAt: string | null; late: boolean; href: string | null } | null;
};

const TTL = 30_000;
const cache = new Map<string, { at: number; value: JobNow | null }>();
const keyOf = (type: RecordType, id: string) => `${type}:${id.toLowerCase()}`;

async function fetchNow(workspaceId: string, keys: string[]) {
  for (let start = 0; start < keys.length; start += 200) {
    const batch = keys.slice(start, start + 200);
    const response = await fetch(`/api/workspace/jobs/now?workspaceId=${encodeURIComponent(workspaceId)}&records=${batch.join(",")}`, { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) as { items?: JobNow[] } | null : null;
    if (!data?.items) continue;
    const at = Date.now();
    for (const key of batch) cache.set(key, { at, value: null });
    for (const item of data.items) cache.set(keyOf(item.type, item.id), { at, value: item });
  }
}

/** Each record's job now (null: no job, or not visible); `ready` once the first answer is in. */
export function useJobNow(workspaceId: string, records: Array<{ type: RecordType; id: string }>) {
  const keys = useMemo(() => [...new Set(records.map((record) => keyOf(record.type, record.id)))].sort(), [records]);
  const signature = keys.join(",");
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!workspaceId || !keys.length) { setReady(true); return; }
    const stale = keys.filter((key) => { const hit = cache.get(key); return !hit || Date.now() - hit.at > TTL; });
    if (!stale.length) { setReady(true); return; }
    let live = true;
    void fetchNow(workspaceId, stale).then(() => { if (live) { setReady(true); setVersion((value) => value + 1); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature stands for the keys
  }, [workspaceId, signature]);
  const lookup = useMemo(() => (type: RecordType, id: string) => cache.get(keyOf(type, id))?.value ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the cache after each answer
    [version, signature]);
  return { ready, lookup };
}

/** Test seam: forget every cached answer. */
export function clearJobNowCache() { cache.clear(); }
