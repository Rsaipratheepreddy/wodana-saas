import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PUBLIC_SALES_FORM, loadPublicSalesForm, resetPublicSalesFormCache } from "./contact-form";

const saved = { ...DEFAULT_PUBLIC_SALES_FORM, thankYouTitle: "Saved form" };

afterEach(() => { vi.unstubAllGlobals(); resetPublicSalesFormCache(); });

describe("loadPublicSalesForm", () => {
  it("reads the form once a minute", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicSalesForm("https://core.test/form", 1_000)).resolves.toEqual(saved);
    await expect(loadPublicSalesForm("https://core.test/form", 30_000)).resolves.toEqual(saved);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadPublicSalesForm("https://core.test/form", 62_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good form when the core is slow or down, and falls back to the default before that", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(loadPublicSalesForm("https://core.test/form", 1_000)).resolves.toEqual(DEFAULT_PUBLIC_SALES_FORM);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => saved }));
    await loadPublicSalesForm("https://core.test/form", 2_000);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(loadPublicSalesForm("https://core.test/form", 70_000)).resolves.toEqual(saved);
  });
});
