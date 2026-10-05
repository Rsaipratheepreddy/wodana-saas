import type { GridDefault, GridDefaultsSource } from "@/design-system/foundations/grid-defaults";
import { tKey } from "@/lib/i18n/keys";

/** Reads and saves list defaults (plan §0.7 R14) for one workspace, through the web API proxy. */
export function createGridDefaultsSource(workspaceId: string, request: typeof fetch = (...args) => fetch(...args)): GridDefaultsSource {
  const url = (gridKey: string) => `/api/workspace/grid-settings/${encodeURIComponent(gridKey)}?workspaceId=${encodeURIComponent(workspaceId)}`;
  const read = async (response: Response, fallback: string): Promise<GridDefault> => {
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.message === "string" ? result.message : fallback);
    return { hiddenColumns: Array.isArray(result?.hiddenColumns) ? result.hiddenColumns.filter((id: unknown) => typeof id === "string") : [], version: Number(result?.version ?? 0), canManage: result?.canManage === true };
  };
  // Lists opened again within a minute reuse the answer; a save replaces it at once.
  const cache = new Map<string, { at: number; value: Promise<GridDefault> }>();
  return {
    load(gridKey) {
      const cached = cache.get(gridKey);
      if (cached && Date.now() - cached.at < 60_000) return cached.value;
      const pending = request(url(gridKey), { cache: "no-store" }).then((response) => read(response, tKey("The list default could not be loaded.")));
      pending.catch(() => cache.delete(gridKey));
      cache.set(gridKey, { at: Date.now(), value: pending });
      return pending;
    },
    async save(gridKey, input) {
      const saved = await read(await request(url(gridKey), { method: "PUT", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), tKey("The list default could not be saved."));
      cache.set(gridKey, { at: Date.now(), value: Promise.resolve(saved) });
      return saved;
    },
  };
}
