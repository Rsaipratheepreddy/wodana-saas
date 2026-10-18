import { describe, expect, it, vi } from "vitest";
import { commercialRepository } from "./commercial-repository";

describe("commercial repository", () => {
  it("gives commands the column's revision, not the document's older copy", async () => {
    // A quote-builder edit bumped the column (5) without rewriting the document (still 2).
    const query = vi.fn().mockResolvedValue({ rows: [{ content: { revision: 2, quotes: [] }, revision: 5 }] });
    const loaded = await commercialRepository.load({ query } as never, "workspace", "case");
    expect(loaded?.revision).toBe(5);
    expect(loaded?.content.revision).toBe(5);
  });

  it("returns nothing for a case without commercial data", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await commercialRepository.load({ query } as never, "workspace", "case")).toBeUndefined();
  });
});

describe("a case saved before the service path rename (Q-37)", () => {
  it("reads its former key as servicePath, and leaves a new case as it is", async () => {
    const { servicePathAlias } = await import("./commercial-repository");
    const path = { scope: { design: true }, selectedAt: "2026-09-01T00:00:00.000Z", selectedBy: "Sara" };
    expect(servicePathAlias({ palmFlow: path, requests: [] } as never)).toEqual({ servicePath: path, requests: [] });
    expect(servicePathAlias({ servicePath: path } as never)).toEqual({ servicePath: path });
  });
});

