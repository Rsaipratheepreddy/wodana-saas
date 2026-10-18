/**
 * One request per resource per page: callers asking for the same key while a read is in flight share it, and
 * (unless they force a fresh read) reuse a settled answer younger than `maxAgeMs`. A failed read is forgotten so
 * the next caller asks again. Used by the shell's always-mounted readers (notifications, setup progress) so React's
 * double effects, remounts and several components reading the same thing cost one request.
 */
type Entry = { at: number; settled: boolean; value: Promise<unknown> };

const entries = new Map<string, Entry>();

export function sharedRequest<T>(key: string, load: () => Promise<T>, { maxAgeMs = 0, force = false }: { maxAgeMs?: number; force?: boolean } = {}): Promise<T> {
  const current = entries.get(key);
  if (current && (!current.settled || (!force && Date.now() - current.at < maxAgeMs))) return current.value as Promise<T>;
  const entry: Entry = { at: Date.now(), settled: false, value: Promise.resolve() };
  entry.value = load().then(
    (value) => { entry.settled = true; entry.at = Date.now(); return value; },
    (error: unknown) => { if (entries.get(key) === entry) entries.delete(key); throw error; },
  );
  entries.set(key, entry);
  return entry.value as Promise<T>;
}

/** Forgets every shared answer (a signed-out device, or a test starting clean). */
export function resetSharedRequests() {
  entries.clear();
}
