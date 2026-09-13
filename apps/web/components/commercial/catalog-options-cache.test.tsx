import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogOptionsCache, useCatalogOptions } from "./catalog-options-cache";
const room = { id: "room", name: "Living room", code: "LIV", version: 1 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Quotation catalog loading", () => {
  it("shares in-flight requests and reuses the response without crossing workspace keys", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ items: [room] }) }));
    vi.stubGlobal("fetch", fetcher);
    const cache = new CatalogOptionsCache();
    const first = cache.load("/workspace-a/rooms");
    expect(cache.load("/workspace-a/rooms")).toBe(first);
    await first;
    await cache.load("/workspace-a/rooms");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await cache.load("/workspace-b/rooms");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("searches a complete room catalog immediately without another request and refreshes newly added rooms", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ items: [room] }) }));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ search }) => useCatalogOptions("workspace", "case", "room", search), { initialProps: { search: "" } });
    await waitFor(() => expect(result.current.items).toEqual([room]));
    rerender({ search: "Living" });
    expect(result.current.items).toEqual([room]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => ({ ok: true, json: async () => ({ items: [room, { ...room, id: "new", name: "Living annex" }] }) }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("searches beyond the first 100 results and drops obsolete responses", async () => {
    let resolveOld!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const search = new URL(url, "http://localhost").searchParams.get("search");
      if (search === "old") return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ items: search ? [{ ...room, id: "new", name: "New material" }] : Array.from({ length: 100 }, (_, i) => ({ ...room, id: String(i) })) }) });
    }));
    const { result, rerender } = renderHook(({ search }) => useCatalogOptions("workspace", "case", "material", search), { initialProps: { search: "" } });
    await waitFor(() => expect(result.current.items).toHaveLength(100));
    rerender({ search: "old" });
    await waitFor(() => expect(resolveOld).toBeDefined());
    rerender({ search: "new" });
    await waitFor(() => expect(result.current.items[0]?.id).toBe("new"));
    await act(async () => resolveOld({ ok: true, json: async () => ({ items: [room] }) }));
    expect(result.current.items[0]?.id).toBe("new");
  });
  it("does not cache failures and expires catalog entries", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Unavailable" }) }).mockResolvedValue({ ok: true, json: async () => ({ items: [room] }) });
    vi.stubGlobal("fetch", fetcher);
    const cache = new CatalogOptionsCache();
    await expect(cache.load("rooms")).rejects.toThrow("Unavailable");
    expect(cache.peek("rooms")).toBeUndefined();
    await cache.load("rooms");
    vi.advanceTimersByTime(30001);
    expect(cache.peek("rooms")).toBeUndefined();
    await cache.load("rooms");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
