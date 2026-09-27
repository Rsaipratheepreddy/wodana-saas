"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogChoice } from "@/lib/pre-project/content";
import { commercialPath } from "@/lib/commercial/client";
import { tKey } from "@/lib/i18n/keys";
type Choice = CatalogChoice & { description?: string };
const TTL = 30_000;
type Entry = { items: Choice[]; at: number };
export class CatalogOptionsCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Choice[]>>();
  peek(key: string) {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.at < TTL ? entry.items : undefined;
  }
  load(key: string, force = false): Promise<Choice[]> {
    if (!force) {
      const hit = this.peek(key);
      if (hit) return Promise.resolve(hit);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = fetch(key)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.message ?? tKey("Catalogs could not be loaded."));
        if (!Array.isArray(data.items))
          throw new Error(tKey("Catalogs could not be loaded."));
        if (this.entries.size >= 100)
          this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { items: data.items, at: Date.now() });
        return data.items as Choice[];
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
const Context = createContext<CatalogOptionsCache | null>(null);
export function catalogOptionsUrl(
  workspaceId: string,
  caseId: string,
  kind: string,
  search = "",
  linkedTo?: string,
  catalogId?: string,
) {
  return `${commercialPath(workspaceId, `cases/${caseId}/catalog-options`)}&${new URLSearchParams({ kind, search, ...(linkedTo ? { linkedTo } : {}), ...(catalogId ? { catalogId } : {}) })}`;
}
export function CatalogOptionsProvider({
  workspaceId,
  caseId,
  children,
}: {
  workspaceId: string;
  caseId: string;
  children: ReactNode;
}) {
  const [cache] = useState(() => new CatalogOptionsCache());
  useEffect(() => {
    for (const kind of ["room", "work", "material"])
      void cache
        .load(catalogOptionsUrl(workspaceId, caseId, kind))
        .catch(() => {});
  }, [cache, workspaceId, caseId]);
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export function useCatalogOptions(
  workspaceId: string,
  caseId: string,
  kind: string,
  search: string,
  linkedTo?: string,
  catalogId?: string,
  enabled = true,
) {
  const context = useContext(Context);
  const [local] = useState(() => new CatalogOptionsCache());
  const cache = context ?? local;
  const key = catalogOptionsUrl(
    workspaceId,
    caseId,
    kind,
    search,
    linkedTo,
    catalogId,
  );
  const baseKey = catalogOptionsUrl(
    workspaceId,
    caseId,
    kind,
    "",
    linkedTo,
    catalogId,
  );
  const [result, setResult] = useState<{
    key: string;
    items: Choice[];
    error: string;
  }>({ key: "", items: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  const forceNext = useRef(false);
  const exact = cache.peek(key),
    base = cache.peek(baseKey);
  const filter = (items: Choice[]) =>
    items.filter((item) =>
      `${item.name} ${item.code} ${item.catalogName ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    // The endpoint returns at most 100. A smaller base result is complete and can be searched locally.
    const complete = cache.peek(baseKey);
    const run = async () => {
      try {
        const force = forceNext.current;
        forceNext.current = false;
        const items =
          !force && complete && complete.length < 100
            ? complete.filter((item) =>
                `${item.name} ${item.code} ${item.catalogName ?? ""}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
            : await cache.load(key, force);
        if (!disposed) setResult({ key, items, error: "" });
      } catch (error) {
        if (!disposed)
          setResult({ key, items: [], error: (error as Error).message });
      }
    };
    const timer = setTimeout(
      run,
      search && !(complete && complete.length < 100) && !cache.peek(key)
        ? 140
        : 0,
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [cache, key, baseKey, search, attempt, enabled]);
  const items =
    result.key === key ? result.items : (exact ?? (base ? filter(base) : []));
  return {
    items: enabled ? items : [],
    error: enabled && result.key === key ? result.error : "",
    loading: enabled && result.key !== key && !exact && !(base && base.length < 100),
    refresh: () => {
      forceNext.current = true;
      setResult({ key: "", items: [], error: "" });
      setAttempt((n) => n + 1);
    },
  };
}
