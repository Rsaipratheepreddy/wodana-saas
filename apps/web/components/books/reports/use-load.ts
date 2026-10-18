"use client";

import { useCallback, useEffect, useState } from "react";

/** Loads what a Ledger view shows whenever `key` changes; an older answer never replaces a newer one. */
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ key, data, error: null }); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setState({ key, data: null, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => controller.abort();
    // `load` closes over what `key` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: key !== null && !current, stale: state.data, reload };
}
