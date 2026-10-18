"use client";

import { useCallback, useState } from "react";

/**
 * Where a module page is (its tab, and anything else its address carries), moved without a trip to
 * the server. The page already holds its data, so a tab — or a record opened with `?order=…` — changes
 * the address in place and shows at once; `useSearchParams` and `usePathname` follow the new address.
 * When the server renders the page for another place (a link from elsewhere), that place wins.
 * `key` identifies the server's value when it isn't a string.
 */
export function useSection<V>(initial: V, key: string = String(initial)) {
  const [state, setState] = useState({ key, value: initial });
  if (state.key !== key) setState({ key, value: initial });
  const current = state.key === key ? state.value : initial;
  const go = useCallback((value: V, href: string) => {
    setState((previous) => ({ ...previous, value }));
    window.history.replaceState(null, "", href);
  }, []);
  return [current, go] as const;
}
